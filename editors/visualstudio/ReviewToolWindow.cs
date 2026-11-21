using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
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
        public const string ToolWindowGuidString = "d4e5f6a7-8b9c-4d0e-9f11-2a3b4c5d6e7f";

        private readonly WebView2 _webView = new WebView2();
        private bool _showing;
        private readonly TextBlock _hint = new TextBlock
        {
            Margin = new Thickness(16),
            TextWrapping = TextWrapping.Wrap,
            Text = "Building the review of the current branch…",
        };

        public ReviewToolWindow() : base(null)
        {
            Caption = "PR Review";
            Content = _hint;
            ((FrameworkElement)Content).Loaded += OnLoaded;
        }

        private void OnLoaded(object sender, RoutedEventArgs e)
        {
            _ = ShowReviewAsync();
        }

        /// <summary>Starts the server (once) and points WebView2 at the page.</summary>
        internal async System.Threading.Tasks.Task ShowReviewAsync()
        {
            if (_showing) return;
            _showing = true;
            var runner = PrReviewPackage.Runner;
            if (runner == null)
            {
                _hint.Text = "PR Review is not initialized yet.";
                return;
            }

            try
            {
                // Reading the solution folder has to happen on the UI thread; it
                // is also the only thing here that does, so it runs first.
                var cwd = await FindRepositoryRootAsync();
                var info = runner.Info ?? await runner.StartAsync(NodePath(), CliPath(), cwd, "branch", null);

                Content = _webView;
                await _webView.EnsureCoreWebView2Async();
                _webView.Source = new Uri(info.Url);

                Caption = $"PR Review: {info.Branch} (+{info.Additions} / -{info.Deletions})";
            }
            catch (Exception error)
            {
                Content = _hint;
                _hint.Text = "PR Review failed to start:\n" + error.Message;
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
        private async System.Threading.Tasks.Task<string> FindRepositoryRootAsync()
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
