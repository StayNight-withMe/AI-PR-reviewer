using System;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Controls;
using Microsoft.VisualStudio.Shell;
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
        private async System.Threading.Tasks.Task ShowReviewAsync()
        {
            var runner = PrReviewPackage.Runner;
            if (runner == null)
            {
                _hint.Text = "PR Review is not initialized yet.";
                return;
            }

            try
            {
                var cwd = FindRepositoryRoot();
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

        /// <summary>The repository of the open solution, or the current directory.</summary>
        private static string FindRepositoryRoot()
        {
            var directory = new DirectoryInfo(Environment.CurrentDirectory);
            while (directory != null)
            {
                if (Directory.Exists(Path.Combine(directory.FullName, ".git"))) return directory.FullName;
                directory = directory.Parent;
            }

            return Environment.CurrentDirectory;
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
