package com.prreview.jetbrains
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.util.SystemInfo
import java.awt.Desktop
import java.io.BufferedReader
import java.io.File
import java.net.URI
import java.util.concurrent.TimeUnit
/**
 * Starts and stops the review engine.
 *
 * The scope, the diff and the page all live in the bundled Node program, so
 * this class only runs it, reads the one PR_REVIEW_READY line from stdout and
 * keeps the process alive while the review is open. This is the exact contract
 * every other editor integration uses.
 */
object ReviewServer {

    private const val READY_PREFIX = "PR_REVIEW_READY "
    private const val ERROR_PREFIX = "PR_REVIEW_ERROR "
    private const val START_TIMEOUT_MS = 60_000L

    @Volatile
    private var process: Process? = null

    @Volatile
    private var url: String? = null

    val isOpen: Boolean get() = process?.isAlive == true && url != null

    /** Builds the review and opens it, or reopens the one already running. */
    fun open(project: Project) {
        url?.let {
            browse(it)
            return
        }

        val cli = resolveCli() ?: run {
            Messages.showErrorDialog(
                project,
                "The review server was not found. Set the pr.review.cliPath setting or bundle it.",
                "PR Review",
            )
            return
        }

        val repo = repoRoot(project)
        val command = buildList {
            add(nodePath())
            add(cli.absolutePath)
            add("--repo"); add(repo)
            add("--mode"); add("branch")
            add("--json")
        }

        try {
            val started = ProcessBuilder(command)
                .directory(File(repo))
                .redirectErrorStream(false)
                .start()
            process = started

            val line = readReadyLine(started) ?: run {
                stop()
                Messages.showErrorDialog(project, "The review server did not start in time.", "PR Review")
                return
            }

            if (line.startsWith(ERROR_PREFIX)) {
                stop()
                Messages.showErrorDialog(project, line.substring(ERROR_PREFIX.length), "PR Review")
                return
            }

            val ready = parseReady(line.substring(READY_PREFIX.length))
            url = ready.url
            if (ready.url.isNotBlank()) browse(ready.url)
        } catch (error: Exception) {
            stop()
            Messages.showErrorDialog(project, "PR Review failed to start: ${error.message}", "PR Review")
        }
    }

    /** Stops the engine; the page does not outlive it. */
    fun stop() {
        val running = process
        process = null
        url = null
        running?.destroy()
        if (running != null && !running.waitFor(3, TimeUnit.SECONDS)) {
            running.destroyForcibly()
        }
    }

    /** Reads stdout until the ready or error line, or the timeout. */
    private fun readReadyLine(started: Process): String? {
        val reader: BufferedReader = started.inputStream.bufferedReader()
        val deadline = System.currentTimeMillis() + START_TIMEOUT_MS
        while (System.currentTimeMillis() < deadline) {
            if (reader.ready()) {
                val line = reader.readLine() ?: return null
                if (line.startsWith(READY_PREFIX) || line.startsWith(ERROR_PREFIX)) return line
            } else {
                Thread.sleep(50)
            }
        }
        return null
    }

    /** The fields the host needs from the ready payload, read without a JSON lib. */
    private data class Ready(val url: String)

    private fun parseReady(json: String): Ready {
        val match = Regex("\"url\"\\s*:\\s*\"([^\"]*)\"").find(json)
        return Ready(match?.groupValues?.get(1) ?: "")
    }

    private fun browse(address: String) {
        try {
            if (Desktop.isDesktopSupported() && Desktop.getDesktop().isSupported(Desktop.Action.BROWSE)) {
                Desktop.getDesktop().browse(URI(address))
            }
        } catch (_: Exception) {
            // A headless session has no browser; the review is still served.
        }
    }

    /** The repository of the project, or the project base directory. */
    private fun repoRoot(project: Project): String {
        val base = project.basePath ?: System.getProperty("user.dir")
        var directory: File? = File(base)
        while (directory != null) {
            if (File(directory, ".git").exists()) return directory.absolutePath
            directory = directory.parentFile
        }
        return base
    }

    /** Node on PATH, or a well-known installation. */
    private fun nodePath(): String {
        System.getenv("PR_REVIEW_NODE")?.let { if (File(it).isFile) return it }

        val candidates = buildList {
            if (SystemInfo.isWindows) {
                add("C:\\Program Files\\nodejs\\node.exe")
                add("C:\\Program Files (x86)\\nodejs\\node.exe")
            } else {
                add("/usr/local/bin/node")
                add("/usr/bin/node")
            }
        }
        candidates.firstOrNull { File(it).isFile }?.let { return it }
        return "node"
    }

    /** The bundled engine, or the checkout named by the environment. */
    private fun resolveCli(): File? {
        System.getenv("PR_REVIEW_CLI")?.let { if (File(it).isFile) return File(it) }
        return bundledCli()
    }
}
/**
 * Finds the bundled engine next to the plugin.
 *
 * The engine ships inside the plugin jar, because the IntelliJ platform loads a
 * plugin as a jar rather than a folder. A Node process needs real files on disk,
 * so the jar's `server/` tree is unpacked once into a cache folder and the path
 * to that copy is returned.
 */
fun bundledCli(): File? {
    val fromClasses = locateFrom(ReviewServer::class.java.protectionDomain?.codeSource?.location?.toURI())
    if (fromClasses != null) return fromClasses

    val extracted = unpackFromJar()
    if (extracted != null) return extracted

    // A development checkout: ~/.pr-review-mcp/server/src/cli.js.
    val home = System.getProperty("user.home") ?: return null
    return File(home, ".pr-review-mcp/server/src/cli.js").takeIf { it.isFile }
}

/**
 * Unpacks the engine that travels inside the plugin jar.
 *
 * Called once per process: the cache folder is keyed by the jar's size and
 * timestamp, so a plugin update unpacks the new engine instead of running the
 * previous one forever.
 */
private fun unpackFromJar(): File? {
    val jar = ReviewServer::class.java.protectionDomain?.codeSource?.location?.toURI()
        ?.let { File(it) }?.takeIf { it.isFile } ?: return null

    val stamp = "${jar.length()}-${jar.lastModified()}"
    val cache = File(System.getProperty("java.io.tmpdir"), "pr-review-engine/$stamp")
    val cli = File(cache, "server/src/cli.js")
    if (cli.isFile) return cli

    return try {
        java.util.jar.JarFile(jar).use { archive ->
            val entries = archive.entries()
            while (entries.hasMoreElements()) {
                val entry = entries.nextElement()
                if (entry.isDirectory || !entry.name.startsWith("server/")) continue
                val target = File(cache, entry.name)
                target.parentFile?.mkdirs()
                archive.getInputStream(entry).use { input -> target.outputStream().use { input.copyTo(it) } }
            }
        }
        cli.takeIf { it.isFile }
    } catch (_: Exception) {
        null
    }
}

private fun locateFrom(codeSource: java.net.URI?): File? {
    if (codeSource == null) return null
    var directory = File(codeSource).let { if (it.isFile) it.parentFile else it }
    // Walk up a few levels: out/production/classes, out/classes, lib, ...
    repeat(6) {
        val candidate = File(directory, "server/src/cli.js")
        if (candidate.isFile) return candidate
        directory = directory.parentFile ?: return null
    }
    return null
}
