/**
 * Builds an installable .vsix for the Visual Studio extension without needing
 * the "Visual Studio extension development" workload.
 *
 * That workload supplies MSBuild targets; the tools they call ship inside the
 * Microsoft.VSSDK.BuildTools package, so running those directly produces the
 * same package on a plain machine.
 *
 * `VsixUtil package` writes the container (content types, catalog and file
 * manifest) but flattens every file to the archive root. The engine has to keep
 * its folders, so the archive is rebuilt with the same parts and its manifest
 * corrected: only the physical entry names change.
 *
 * Run: node editors/visualstudio/build-vsix.mjs
 */
import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { crc32, deflateRawSync } from "node:zlib";

const exec = promisify(execFile);
const HERE = dirname(fileURLToPath(import.meta.url));
const BUILD = join(HERE, "bin", "Release", "net48");
const STAGE = join(HERE, "obj", "vsix-stage");
const TEMP = join(HERE, "obj", "vsix-flat.vsix");
const OUTPUT = join(BUILD, "PrReview.VisualStudio.vsix");
const VSSDK = "C:\\Users\\Rog\\.nuget\\packages\\microsoft.vssdk.buildtools\\17.9.3168\\tools\\VSSDK";
const IDE = "C:\\Program Files\\Microsoft Visual Studio\\18\\Insiders\\Common7\\IDE";

/**
 * Assemblies Visual Studio itself supplies.
 *
 * The build copies every dependency into `bin`, and shipping those copies is
 * what broke the editor: an extension folder that contains its own
 * `Microsoft.VisualStudio.Shell.15.0.dll` loads that file instead of the
 * installation's, and the packages that need the real one fail with "did not
 * load correctly". Only assemblies Visual Studio does not have may travel.
 */
async function sharedWithEditor() {
  const roots = [join(IDE, "PublicAssemblies"), join(IDE, "PrivateAssemblies"), IDE];
  const shared = new Set();

  for (const entry of await readdir(BUILD)) {
    if (!entry.endsWith(".dll")) continue;
    for (const root of roots) {
      if (await exists(join(root, entry))) {
        shared.add(entry);
        break;
      }
    }
  }
  return shared;
}

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

/** Compiles the project and produces the .pkgdef the package registration needs. */
async function build() {
  // Use the .NET SDK MSBuild host rather than Visual Studio's MSBuild.exe:
  // the latter cannot resolve SDK-style projects when the machine's global
  // dotnet installation is incomplete. DOTNET_ROOT may point at a working SDK;
  // otherwise fall back to the local SDK installed for this machine.
  const dotnetRoots = [
    process.env.DOTNET_ROOT,
    "Z:\\system\\temp\\dotnet-sdk",
    "C:\\Program Files\\dotnet",
  ].filter(Boolean);
  let dotnet = null;
  let dotnetRoot = null;
  for (const root of dotnetRoots) {
    const candidate = join(root, "dotnet.exe");
    if (await exists(candidate)) {
      dotnet = candidate;
      dotnetRoot = root;
      break;
    }
  }
  if (!dotnet) throw new Error("No dotnet.exe found; set DOTNET_ROOT to a complete .NET SDK");
  await exec(dotnet, ["msbuild", "PrReview.VisualStudio.csproj", "/t:Rebuild", "/p:Configuration=Release", "/v:minimal", "/nologo"], {
    cwd: HERE,
    env: {
      ...process.env,
      DOTNET_ROOT: dotnetRoot,
      PATH: `${dotnetRoot};${process.env.PATH ?? ""}`,
    },
  });

  const createPkgDef = join(VSSDK, "bin", "CreatePkgDef.exe");
  await exec(createPkgDef, [`/out=${join(BUILD, "PrReview.VisualStudio.pkgdef")}`,
    join(BUILD, "PrReview.VisualStudio.dll")]);
}

/** Copies what the package has to contain into one folder, keeping folders. */
async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  const shared = await sharedWithEditor();

  // The assembly, the registration file and only the dependencies Visual Studio
  // does not already provide.
  for (const entry of await readdir(BUILD)) {
    if (entry.endsWith(".vsix") || entry.endsWith(".pdb") || entry.endsWith(".xml")) continue;
    const source = join(BUILD, entry);
    if (!(await stat(source)).isFile()) continue;
    if (entry.endsWith(".dll") && shared.has(entry)) continue;
    await cp(source, join(STAGE, entry));
  }

  // WebView2 is host-provided by Visual Studio; its WPF wrapper, core assembly,
  // and native loader must come from that same VS installation. The NuGet
  // package's WPF wrapper may not match the IDE's private WebView2 runtime.
  for (const entry of ["Microsoft.Web.WebView2.Wpf.dll", "Microsoft.Web.WebView2.Core.dll", "WebView2Loader.dll"]) {
    if (!shared.has(entry)) continue;
    await rm(join(STAGE, entry), { force: true });
  }

  // The engine the extension starts, already copied by `npm run bundle:server`.
  // Without it an installed copy has nothing to launch.
  await cp(join(HERE, "server"), join(STAGE, "server"), { recursive: true });
}

/** The staged files, as the packer's flat list. */
async function stagedFiles() {
  const entries = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else entries.push({ full, name: relative(STAGE, full).split("\\").join("/") });
    }
  }
  await walk(STAGE);
  return entries;
}

/** Runs the official packer to get a valid container. */
async function packFlat(files) {
  const listFile = join(HERE, "obj", "vsix-files.json");
  await writeFile(listFile, JSON.stringify({
    files: files.map((file) => ({ path: file.full })),
  }, null, 2), "utf8");

  await rm(TEMP, { force: true });
  await exec(join(VSSDK, "bin", "VsixUtil.exe"), [
    "package",
    "-outputPath", TEMP,
    "-files", listFile,
    "-sourceManifest", join(HERE, "source.extension.vsixmanifest"),
    "-noValidate",
  ]);
}

/** A stored ZIP with the entries in the order they are added. */
function zip(files) {
  const chunks = [];
  const central = [];
  let offset = 0;
  const dosDate = ((new Date().getFullYear() - 1980) << 9) | ((new Date().getMonth() + 1) << 5) | new Date().getDate();

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const payload = file.stored ? file.data : deflateRawSync(file.data);
    const checksum = crc32(file.data) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(file.stored ? 0 : 8, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(dosDate, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(file.data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, name, payload);
    central.push({ name, checksum, payload: payload.length, size: file.data.length, offset });
    offset += local.length + name.length + payload.length;
  }

  const directory = [];
  let directorySize = 0;
  for (const entry of central) {
    const header = Buffer.alloc(46);
    header.writeUInt32LE(0x02014b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(20, 6);
    header.writeUInt16LE(0, 8);
    header.writeUInt16LE(8, 10);
    header.writeUInt16LE(0, 12);
    header.writeUInt16LE(dosDate, 14);
    header.writeUInt32LE(entry.checksum, 16);
    header.writeUInt32LE(entry.payload, 20);
    header.writeUInt32LE(entry.size, 24);
    header.writeUInt16LE(entry.name.length, 28);
    header.writeUInt16LE(0, 30);
    header.writeUInt16LE(0, 32);
    header.writeUInt16LE(0, 34);
    header.writeUInt16LE(0, 36);
    header.writeUInt32LE(0, 38);
    header.writeUInt32LE(entry.offset, 42);
    directory.push(header, entry.name);
    directorySize += header.length + entry.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length, 8);
  end.writeUInt16LE(central.length, 10);
  end.writeUInt32LE(directorySize, 12);
  end.writeUInt32LE(offset, 16);

  return Buffer.concat([...chunks, ...directory, end]);
}

/** The directory record of one entry. */
function column(header, entry, directory) {
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  directory.push(header, entry.name);
}

/** Reads the entries of the packed archive. */
async function entriesOf(path) {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${path}')`,
    "$z.Entries | ForEach-Object { $_.FullName } | ConvertTo-Json -Compress",
    "$z.Dispose()",
  ].join("; ");
  const { stdout } = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return JSON.parse(stdout);
}

/** Reads one entry of the packed archive as text. */
async function entryText(path, name) {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${path}')`,
    `$e=$z.Entries | Where-Object { $_.FullName -eq '${name}' }`,
    "$r=New-Object System.IO.StreamReader($e.Open())",
    "-join ($r.ReadToEnd() -split \"`n\")",
    "$r.Dispose()",
    "$z.Dispose()",
  ].join("; ");
  const { stdout } = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script]);
  return stdout;
}

/** Reads one entry of the packed archive as bytes. */
async function entryBinary(path, name) {
  const script = [
    "Add-Type -AssemblyName System.IO.Compression.FileSystem",
    `$z=[System.IO.Compression.ZipFile]::OpenRead('${path}')`,
    `$e=$z.Entries | Where-Object { $_.FullName -eq '${name}' }`,
    "$s=$e.Open()",
    "$m=New-Object System.IO.MemoryStream",
    "$s.CopyTo($m)",
    "[Convert]::ToBase64String($m.ToArray())",
    "$m.Dispose()",
    "$s.Dispose()",
    "$z.Dispose()",
  ].join("; ");
  const { stdout } = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", script],
    { maxBuffer: 64 * 1024 * 1024 });
  return Buffer.from(stdout.trim(), "base64");
}

/**
 * Two files can share a base name — `src/core.js` and `src/assets/core.js` — and
 * the packer flattens the archive, so one would overwrite the other. Its own
 * output is therefore used only for the container parts (content types, catalog);
 * every file is written from the staged folder under its real path.
 */
async function rebuild(files) {
  const names = await entriesOf(TEMP);
  const manifestText = await entryText(TEMP, "manifest.json");
  const manifest = JSON.parse(manifestText);

  const container = names.filter((name) =>
    name === "extension.vsixmanifest" || name === "manifest.json"
    || name === "catalog.json" || name === "[Content_Types].xml");

  manifest.files = [
    { fileName: "/extension.vsixmanifest", sha256: null },
    ...files.map((file) => ({ fileName: `/${file.name}`, sha256: null })),
  ];

  const packed = [];
  for (const name of container) {
    const data = name === "manifest.json"
      ? Buffer.from(JSON.stringify(manifest), "utf8")
      : await entryBinary(TEMP, name);
    packed.push({ name, data });
  }
  for (const file of files) {
    packed.push({ name: file.name, data: await readFile(file.full) });
  }

  await writeFile(OUTPUT, zip(packed));
}

await build();
await stage();
const files = await stagedFiles();
await packFlat(files);
await rebuild(files);
const size = (await stat(OUTPUT)).size;

// A package that shadows the editor's own assemblies installs cleanly and then
// breaks the editor, which is far worse than a failed build.
const shared = await sharedWithEditor();
const shipped = files.map((file) => file.name).filter((name) => shared.has(name));
if (shipped.length) {
  throw new Error(`the package ships assemblies Visual Studio provides: ${shipped.join(", ")}`);
}

console.log(`Built ${OUTPUT} — ${files.length} files, ${Math.round(size / 1024)} KB`);
