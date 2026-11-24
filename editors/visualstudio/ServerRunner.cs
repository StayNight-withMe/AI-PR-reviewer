using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
namespace PrReview.VisualStudio
{

    internal sealed class ServerRunner : IDisposable
    {
        private const string ReadyPrefix = "PR_REVIEW_READY ";
        private const string ErrorPrefix = "PR_REVIEW_ERROR ";
        private const int StartTimeoutMs = 60_000;

        private Process? _process;

        private static readonly JsonSerializerOptions JsonOptions = new JsonSerializerOptions
        {
            PropertyNameCaseInsensitive = true,
        };

        public ReviewInfo? Info { get; private set; }

        public event EventHandler? Stopped;

        public async Task<ReviewInfo> StartAsync(string nodePath, string cliPath, string cwd, string mode, string? baseRef)
        {
            Stop();

            var args = BuildArguments(cliPath, cwd, mode, baseRef);
            var startInfo = new ProcessStartInfo(nodePath, args)
            {
                WorkingDirectory = cwd,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            };

            var process = new Process { StartInfo = startInfo, EnableRaisingEvents = true };
            process.Exited += (_, _) => Stopped?.Invoke(this, EventArgs.Empty);
            process.Start();
            _process = process;

            var info = await ReadReadyAsync(process).ConfigureAwait(true);
            Info = info;
            return info;
        }

        public void Stop()
        {
            var process = _process;
            _process = null;
            Info = null;
            if (process == null) return;

            try
            {
                if (!process.HasExited) process.Kill();
            }
            catch
            {

            }

            process.Dispose();
        }

        private static string BuildArguments(string cliPath, string cwd, string mode, string? baseRef)
        {
            var builder = new StringBuilder();
            builder.Append('"').Append(cliPath).Append('"');
            builder.Append(" --repo \"").Append(cwd).Append('"');
            builder.Append(" --mode ").Append(mode);
            if (!string.IsNullOrWhiteSpace(baseRef)) builder.Append(" --base \"").Append(baseRef).Append('"');
            builder.Append(" --json");
            return builder.ToString();
        }

        private static async Task<ReviewInfo> ReadReadyAsync(Process process)
        {
            var stderr = new StringBuilder();
            process.ErrorDataReceived += (_, e) => { if (e.Data != null) stderr.AppendLine(e.Data); };
            process.BeginErrorReadLine();

            var readTask = ReadLineAsync(process);
            var completed = await Task.WhenAny(readTask, Task.Delay(StartTimeoutMs)).ConfigureAwait(false);
            if (completed != readTask)
            {
                throw new InvalidOperationException("The review server did not start in time.");
            }

            var line = await readTask.ConfigureAwait(false);
            if (line != null && line.StartsWith(ReadyPrefix, StringComparison.Ordinal))
            {
                var json = line.Substring(ReadyPrefix.Length);
                var info = JsonSerializer.Deserialize<ReviewInfo>(json, JsonOptions);
                if (info == null) throw new InvalidOperationException("The review server sent an unreadable reply.");
                return info;
            }

            if (line != null && line.StartsWith(ErrorPrefix, StringComparison.Ordinal))
            {
                throw new InvalidOperationException(line.Substring(ErrorPrefix.Length));
            }

            throw new InvalidOperationException(stderr.Length > 0
                ? stderr.ToString().Trim()
                : "The review server did not start in time.");
        }

        private static Task<string?> ReadLineAsync(Process process)
        {
            return Task.Run(async () =>
            {
                string? line;
                while ((line = await process.StandardOutput.ReadLineAsync().ConfigureAwait(false)) != null)
                {
                    if (line.StartsWith(ReadyPrefix, StringComparison.Ordinal) ||
                        line.StartsWith(ErrorPrefix, StringComparison.Ordinal))
                    {
                        return line;
                    }
                }
                return null;
            });
        }

        public void Dispose() => Stop();
    }

    internal sealed class ReviewInfo
    {
        public string Url { get; set; } = string.Empty;
        public string ReviewId { get; set; } = string.Empty;
        public int Port { get; set; }
        public string Repo { get; set; } = string.Empty;
        public string Branch { get; set; } = string.Empty;
        public string Mode { get; set; } = string.Empty;
        public int Files { get; set; }
        public int Additions { get; set; }
        public int Deletions { get; set; }
    }
}
