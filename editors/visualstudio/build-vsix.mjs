
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
// NuGet resolves the global cache from %NUGET_PACKAGES% and falls back to
// %USERPROFILE%\.nuget\packages; both must work, a hard-coded profile breaks
// wherever the cache moved.
const VSSDK = join(process.env.NUGET_PACKAGES
  ?? join(process.env.USERPROFILE ?? process.env.HOME ?? P.EMPTY, ".nuget", "packages"),
  "microsoft.vssdk.buildtools", "17.9.3168", "tools", "VSSDK");
const IDE = "C:\\Program Files\\Microsoft Visual Studio\\18\\Insiders\\Common7\\IDE";


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


async function build() {




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


async function stage() {
  await rm(STAGE, { recursive: true, force: true });
  await mkdir(STAGE, { recursive: true });

  const shared = await sharedWithEditor();



  for (const entry of await readdir(BUILD)) {
    if (entry.endsWith(".vsix") || entry.endsWith(".pdb") || entry.endsWith(".xml")) continue;
    const source = join(BUILD, entry);
    if (!(await stat(source)).isFile()) continue;
    if (entry.endsWith(".dll") && shared.has(entry)) continue;
    await cp(source, join(STAGE, entry));
  }




  for (const entry of ["Microsoft.Web.WebView2.Wpf.dll", "Microsoft.Web.WebView2.Core.dll", "WebView2Loader.dll"]) {
    if (!shared.has(entry)) continue;
    await rm(join(STAGE, entry), { force: true });
  }



  await cp(join(HERE, "server"), join(STAGE, "server"), { recursive: true });
}


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


function column(header, entry, directory) {
  header.writeUInt32LE(0, 38);
  header.writeUInt32LE(entry.offset, 42);
  directory.push(header, entry.name);
}


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



const shared = await sharedWithEditor();
const shipped = files.map((file) => file.name).filter((name) => shared.has(name));
if (shipped.length) {
  throw new Error(`the package ships assemblies Visual Studio provides: ${shipped.join(", ")}`);
}

console.log(`Built ${OUTPUT} — ${files.length} files, ${Math.round(size / 1024)} KB`);
