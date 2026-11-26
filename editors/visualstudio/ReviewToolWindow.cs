using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Microsoft.VisualStudio.PlatformUI;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;
namespace PrReview.VisualStudio
{

    [Guid(ToolWindowGuidString)]
    public sealed class ReviewToolWindow : ToolWindowPane
    {
        public const string ToolWindowGuidString = "f7c3d961-2a84-4b5e-9f16-73d0a8c24b51";

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

            // A TextBlock inherits the theme foreground only when it is set
            // explicitly: without this it falls back to black and disappears
            // on the dark tool-window background.
            SetResourceForeground(_hint);

            _root.Children.Add(_hint);
            _root.Children.Add(_webView);
            Content = _root;

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

        private static void SetResourceForeground(TextBlock block)
        {
            // VS theme brushes: EnvironmentForeground follows the theme, so the
            // hint stays readable on a dark and on a light tool window instead
            // of falling back to black.
            var owner = Application.Current;
            var brush = owner?.TryFindResource(EnvironmentColors.ToolWindowTextBrushKey)
                ?? owner?.TryFindResource(EnvironmentColors.SystemWindowTextBrushKey);
            if (brush is System.Windows.Media.Brush textBrush) block.Foreground = textBrush;
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

        private void ShowHint(string text)
        {
            _hint.Text = text;
            _hint.Visibility = Visibility.Visible;
            _webView.Visibility = Visibility.Collapsed;
        }

        public override void OnToolWindowCreated()
        {
            base.OnToolWindowCreated();

            _ = EnsureReviewAsync();
        }

        internal async Task EnsureReviewAsync()
        {
            if (_started) return;
            _started = true;
            await ShowReviewAsync();
        }

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

        private static string CliPath()
        {
            var configured = Environment.GetEnvironmentVariable("PR_REVIEW_CLI");
            if (!string.IsNullOrWhiteSpace(configured) && File.Exists(configured)) return configured;

            var assemblyDirectory = Path.GetDirectoryName(typeof(ReviewToolWindow).Assembly.Location) ?? ".";
            return Path.Combine(assemblyDirectory, "server", "src", "cli.js");
        }
    }
}
