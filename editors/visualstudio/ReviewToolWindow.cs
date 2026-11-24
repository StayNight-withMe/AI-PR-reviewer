using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace PrReview.VisualStudio
{
    /// <summary>
    /// A dockable window that shows the review page.
    ///
    /// The page is a normal localhost HTTP app; WebView2 renders it exactly as
    /// a browser would, so comments, screenshots and the "send to the AI" button
    /// all behave the same as in the standalone page.
    /// </summary>
    [Guid(ToolWindowGuidString)]
    public sealed class ReviewToolWindow : ToolWindowPane
    {
        public const string ToolWindowGuidString = "f7c3d961-2a84-4b5e-9f16-73d0a8c24b51";

        /*
         * Visual Studio builds the tool window UI once, from the pane's Content,
         * when the frame is created. Replacing Content afterwards does not
         * re-host the frame: the window keeps showing the element it was built
         * with, and any control added later never enters the visual tree, so it
         * never receives a native window handle. WebView2 needs that handle to
         * initialize, which is why a swapped-in browser stayed blank forever.
         *
         * Both children therefore exist from the start and the pane only toggles
         * their visibility.
         */
        private readonly Grid _root = new Grid();
        private readonly WebView2 _webView = new WebView2 { Visibility = Visibility.Collapsed };
        private readonly TextBlock _hint = new TextBlock
        {
            Margin = new Thickness(16),
            TextWrapping = TextWrapping.Wrap,
            Text = "Building the review of the current branch…",
        };

        private bool _showing;
        private bool _started;

        public ReviewToolWindow() : base(null)
        {
            Caption = "PR Review";
            _root.Children.Add(_hint);
            _root.Children.Add(_webView);
            Content = _root;

            // WebView2's managed assemblies are host-provided. Its native loader
            // lives in the IDE's PrivateAssemblies folder, which the extension
            // folder does not inherit, so that folder is added to the search path
            // before the browser starts. Nothing is copied into the install.
            var assemblyDirectory = Path.GetDirectoryName(typeof(PrReviewPackage).Assembly.Location) ?? string.Empty;
            var idePrivateAssemblies = Path.GetFullPath(Path.Combine(
                assemblyDirectory, "..", "..", "..", "..", "..", "Common7", "IDE", "PrivateAssemblies"));
            if (Directory.Exists(idePrivateAssemblies))
            {
                var searchPath = Environment.GetEnvironmentVariable("PATH") ?? string.Empty;
                var alreadyListed = Array.Exists(searchPath.Split(';'),
                    entry => string.Equals(entry.Trim(), idePrivateAssemblies, StringComparison.OrdinalIgnoreCase));
                if (!alreadyListed)
                {
                    Environment.SetEnvironmentVariable("PATH", idePrivateAssemblies + ";" + searchPath);
                }
            }

            // A profile shared by several Visual Studio processes is locked by
            // the first one, so each process gets its own folder.
            var userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "PR Review", "WebView2",
                System.Diagnostics.Process.GetCurrentProcess().Id.ToString());
            Directory.CreateDirectory(userData);
            _webView.CreationProperties = new CoreWebView2CreationProperties
            {
                UserDataFolder = userData,
            };

            _webView.NavigationCompleted += OnNavigationCompleted;
            _webView.CoreWebView2InitializationCompleted += OnInitializationCompleted;
        }

        private void OnInitializationCompleted(object? sender, CoreWebView2InitializationCompletedEventArgs e)
        {
            if (e.IsSuccess) return;

            _showing = false;
            ShowHint("PR Review could not start the embedded browser:\n"
                + (e.InitializationException?.Message ?? "WebView2 initialization failed."));
        }

        private void OnNavigationCompleted(object? sender, CoreWebView2NavigationCompletedEventArgs e)
        {
            if (e.IsSuccess)
            {
                _showing = false;
                return;
            }

            _showing = false;
            ShowHint("PR Review could not load the review page: " + e.WebErrorStatus);
        }

        /// <summary>Shows a message instead of the page.</summary>
        private void ShowHint(string text)
        {
            _hint.Text = text;
            _hint.Visibility = Visibility.Visible;
            _webView.Visibility = Visibility.Collapsed;
        }

        /// <summary>The pane was created (View > Other Windows > PR Review too).</summary>
        public override void OnToolWindowCreated()
        {
            base.OnToolWindowCreated();
            // Build the review once, so opening the window from View > Other
            // Windows is enough. The toolbar/menu command owns later rebuilds.
            _ = EnsureReviewAsync();
        }

        /// <summary>Builds the review once per session; no-op when already built.</summary>
        internal async Task EnsureReviewAsync()
        {
            if (_started) return;
            _started = true;
            await ShowReviewAsync();
        }

        /// <summary>Builds a fresh review and loads it into WebView2.</summary>
        internal async Task ShowReviewAsync()
        {
            if (_showing) return;
            _showing = true;
            _started = true;
            var runner = PrReviewPackage.Runner;
            if (runner == null)
            {
                ShowHint("PR Review is not initialized yet.");
                _showing = false;
                return;
            }

            try
            {
                // Reading the solution folder has to happen on the UI thread; it
                // is also the only thing here that does, so it runs first.
                var cwd = await FindRepositoryRootAsync();
                _hint.Text = "Building the review of the current branch…";
                var info = await runner.StartAsync(NodePath(), CliPath(), cwd, "branch", null);

                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                Caption = $"PR Review: {info.Branch} (+{info.Additions} / -{info.Deletions})";
                await NavigateAsync(info.Url);
            }
            catch (Exception error)
            {
                _started = false;
                _showing = false;
                ShowHint("PR Review failed to start:\n" + error.Message);
            }
        }

        /// <summary>Brings the browser to the front and loads the page.</summary>
        private async Task NavigateAsync(string url)
        {
            try
            {
                await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
                _hint.Visibility = Visibility.Collapsed;
                _webView.Visibility = Visibility.Visible;
                _webView.Source = new Uri(url);
            }
            catch (Exception error)
            {
                _showing = false;
                ShowHint("PR Review could not start the embedded browser:\n" + error.Message);
            }
        }

        /// <summary>
        /// The repository of the open solution, or the current directory.
        ///
        /// A Visual Studio process starts in its own installation folder, so
        /// walking up from the current directory found nothing on a normal launch
        /// and the review ran against whatever happened to be there. The solution
        /// folder is the answer: it is where the code the user opened lives.
        /// </summary>
        private async Task<string> FindRepositoryRootAsync()
        {
            await ThreadHelper.JoinableTaskFactory.SwitchToMainThreadAsync();
            var configured = Environment.GetEnvironmentVariable("PR_REVIEW_REPO");
            var start = !string.IsNullOrWhiteSpace(configured)
                ? configured
                : PrReviewPackage.Current?.SolutionDirectory() ?? Environment.CurrentDirectory;
            var directory = new DirectoryInfo(start);
            while (directory != null)
            {
                if (Directory.Exists(Path.Combine(directory.FullName, ".git"))) return directory.FullName;
                directory = directory.Parent;
            }

            return start;
        }

        /// <summary>Node on PATH, or a well-known installation.</summary>
        private static string NodePath()
        {
            var configured = Environment.GetEnvironmentVariable("PR_REVIEW_NODE");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

            var candidates = new[]
            {
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "nodejs", "node.exe"),
                Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "nodejs", "node.exe"),
            };

            foreach (var candidate in candidates)
            {
                if (File.Exists(candidate)) return candidate;
            }

            return "node";
        }

        /// <summary>The bundled server, or the checkout named by the environment.</summary>
        private static string CliPath()
        {
            var configured = Environment.GetEnvironmentVariable("PR_REVIEW_CLI");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

            var assemblyDirectory = Path.GetDirectoryName(typeof(ReviewToolWindow).Assembly.Location) ?? ".";
            return Path.Combine(assemblyDirectory, "server", "src", "cli.js");
        }
    }
}
