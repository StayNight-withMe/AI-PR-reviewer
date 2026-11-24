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

    [PackageRegistration(UseManagedResourcesOnly = true, AllowsBackgroundLoading = true)]
    [InstalledProductRegistration("PR Review", "Reviews the current branch in a tab.", "0.1.12")]
    [ProvideMenuResource("Menus.ctmenu", 1)]

    [ProvideAutoLoad(UIContextGuids80.SolutionExists, PackageAutoLoadFlags.BackgroundLoad)]

    [ProvideToolWindow(typeof(ReviewToolWindow), Style = VsDockStyle.MDI, MultiInstances = false)]
    [Guid(PackageGuidString)]
    public sealed class PrReviewPackage : AsyncPackage
    {
        public const string PackageGuidString = "b7a1c6e2-3f4d-4a9b-8c21-5de6f0a1b2c3";

        private ServerRunner? _runner;

        internal static ServerRunner? Runner { get; private set; }
        internal static PrReviewPackage? Current { get; private set; }

        protected override async Task InitializeAsync(CancellationToken cancellationToken, IProgress<ServiceProgressData> progress)
        {
            await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);

            _runner = new ServerRunner();
            Runner = _runner;
            Current = this;

            var commandService = await GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;

            for (var attempt = 0; commandService == null && attempt < 40; attempt++)
            {
                await Task.Delay(250, cancellationToken);
                await JoinableTaskFactory.SwitchToMainThreadAsync(cancellationToken);
                commandService = await GetServiceAsync(typeof(IMenuCommandService)) as OleMenuCommandService;
            }

            if (commandService != null)
            {
                var commandId = new CommandID(new Guid(CommandGuids.CommandSetGuidString), CommandIds.OpenReview);
                commandService.AddCommand(new MenuCommand(OpenReview, commandId));
            }
        }

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

        internal string? SolutionDirectory()
        {
            ThreadHelper.ThrowIfNotOnUIThread();
            var solution = GetService(typeof(SVsSolution)) as IVsSolution;
            if (solution == null) return null;

            var hr = solution.GetSolutionInfo(out string directory, out string file, out _);
            if (hr != 0) return null;
            if (!string.IsNullOrWhiteSpace(directory)) return directory;
            if (!string.IsNullOrWhiteSpace(file)) return Path.GetDirectoryName(file);

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

    internal static class CommandGuids
    {
        public const string CommandSetGuidString = "1c2e9f34-7a5b-4d68-9e01-2b3c4d5e6f70";
    }

    internal static class CommandIds
    {
        public const int OpenReview = 0x0100;
    }
}
