using System;
using System.ComponentModel.Design;
using System.IO;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Microsoft.VisualStudio.Shell;
using Microsoft.VisualStudio.Shell.Interop;
using Task = System.Threading.Tasks.Task;
namespace PrReview.VisualStudio
{
    /// <summary>
    /// The VS 2022 integration entry point.
    ///
    /// A menu button opens a tool window that hosts the review page in WebView2.
    /// Everything the user reviews comes from the bundled Node server, so this
    /// package is only a thin host: it starts the server and shows its URL.
    /// </summary>
    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("PR Review", "Reviews the current branch in a tab.", "0.1.0")]
    [ProvideMenuResource("Menus.ctmenu", 1)]
    [ProvideAutoLoad(UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]
    [ProvideToolWindow(typeof(ReviewToolWindow), Style = VsDockStyle.Tabbed, Window = ToolWindowGuids80.SolutionExplorer)]
    [Guid(PackageGuidString)]
    public sealed class PrReviewPackage : AsyncPackage
    {
        public const string PackageGuidString = "b7a1c6e2-3f4d-4a9b-8c21-5de6f0a1b2c3";

        private ServerRunner? _runner;

        /// <summary>The one running server, shared with the tool window.</summary>
        internal static ServerRunner? Runner { get; private set; }
        internal static PrReviewPackage? Current { get; private set; }

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            _runner = new ServerRunner();
            Runner = _runner;
            Current = this;

            var commandService = await GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
            if (commandService != null)
            {
                var commandId = new CommandID(new Guid(CommandGuids.CommandSetGuidString), CommandIds.OpenReview);
                commandService.AddCommand(new MenuCommand(OpenReview, commandId));
            }
        }

        /// <summary>Opens the tool window, starting the server on first use.</summary>
        private void OpenReview(object sender, EventArgs e)
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var window = FindToolWindow(typeof(ReviewToolWindow), 0, true);
            if (window?.Frame is not IVsWindowFrame frame)
            {
                throw new NotSupportedException("The PR Review window could not be created.");
            }

            var result = frame.Show();
            Marshal.ThrowExceptionForHR(result);
            if (window is ReviewToolWindow review)
            {
                _ = review.ShowReviewAsync();
            }
        }

        /// <summary>
        /// The folder of the open solution, or null when none is open.
        ///
        /// A Visual Studio process starts in its own installation folder, so the
        /// tool window cannot use the current directory to find the code the user
        /// opened.
        /// </summary>
        internal string? SolutionDirectory()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var solution = GetService(typeof(SVsSolution)) as IVsSolution;
            if (solution == null) return null;

            var hr = solution.GetSolutionInfo(out string directory, out string file, out _);
            if (hr != 0) return null;
            if (!string.IsNullOrWhiteSpace(directory)) return directory;
            if (!string.IsNullOrWhiteSpace(file)) return Path.GetDirectoryName(file);

            // Visual Studio 18 Insiders can report an open solution while
            // GetSolutionInfo returns empty strings. Fall back to the first
            // loaded project, whose canonical path identifies the same folder.
            var empty = Guid.Empty;
            if (solution.GetProjectEnum((uint)__VSENUMPROJFLAGS.EPF_LOADEDINSOLUTION, ref empty, out IEnumHierarchies projects) == 0 &&
                projects != null)
            {
                var hierarchies = new IVsHierarchy[1];
                if (projects.Next(1, hierarchies, out uint fetched) == 0 && fetched == 1)
                {
                    hierarchies[0].GetCanonicalName(unchecked((uint)-4000), out string projectPath);
                    if (!string.IsNullOrWhiteSpace(projectPath))
                    {
                        return Path.GetDirectoryName(projectPath);
                    }
                }
            }

            // Some Visual Studio 18 builds expose the solution through DTE
            // before the IVsSolution path is populated. The selected document
            // is a reliable fallback and identifies the same repository.
            if (GetService(typeof(IVsMonitorSelection)) is IVsMonitorSelection selection)
            {
                selection.GetCurrentSelection(out IntPtr hierarchyPointer, out uint itemId, out _, out _);
                if (hierarchyPointer != IntPtr.Zero)
                {
                    var hierarchy = (IVsHierarchy)Marshal.GetObjectForIUnknown(hierarchyPointer);
                    hierarchy.GetCanonicalName(itemId, out string selectedPath);
                    if (!string.IsNullOrWhiteSpace(selectedPath))
                    {
                        return Path.GetDirectoryName(selectedPath);
                    }
                }
            }

            return null;
        }

        protected override void Dispose(bool disposing)
        {
            if (disposing)
            {
                _runner?.Dispose();
                Runner = null;
                Current = null;
            }

            base.Dispose(disposing);
        }
    }

    /// <summary>Identifiers shared by the command table and the package.</summary>
    internal static class CommandGuids
    {
        public const string CommandSetGuidString = "1c2e9f34-7a5b-4d68-9e01-2b3c4d5e6f70";
    }

    internal static class CommandIds
    {
        public const int OpenReview = 0x0100;
    }
}
