import { Builder } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
const driver = await new Builder()
  .forBrowser("firefox")
  .setFirefoxOptions(new firefox.Options().addArguments("-headless"))
  .build();
await driver.get(process.argv[2] ?? "http://127.0.0.1:5454/");
await new Promise((r) => setTimeout(r, 2500));
const report = await driver.executeScript(`
  return (async () => {
    // Ask the server for the real content of every changed C# file, then run the
    // exact client highlight pipeline on it and count distinct token colours.
    const paths = PR.state.files.map((f) => f.path).filter((p) => p.endsWith('.cs') || p.endsWith('.csproj') || p.endsWith('.gitignore'));
    const res = await fetch('/api/files', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ paths }),
    });
    const data = (await res.json()).files;

    const probe = document.createElement('div');
    probe.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px';
    document.body.appendChild(probe);

    const out = [];
    for (const path of Object.keys(data).slice(0, 25)) {
      const file = data[path];
      if (!file || !file.lines) continue;

      probe.innerHTML = '';
      const pre = document.createElement('pre');
      pre.className = 'hljs';
      pre.innerHTML = PR.highlightLines(file.lines.join('\\n'), file.language).join('\\n');
      probe.appendChild(pre);

      const colours = new Set();
      let spans = 0;
      for (const span of pre.querySelectorAll('span')) {
        spans += 1;
        colours.add(getComputedStyle(span).color);
      }
      out.push({ path: path.split('/').pop(), language: file.language, spans, distinct: colours.size });
    }
    probe.remove();
    return out;
  })();
`);
