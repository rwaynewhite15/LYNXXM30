/**
 * Single-file build.
 *
 *   node tools/bundle.mjs             -> dist/lynx-xm30.html
 *   node tools/bundle.mjs --artifact  -> dist/lynx-xm30.artifact.html
 *
 * The first is a complete HTML document: the whole game — three.js, every
 * module, the stylesheet — inlined into one file that runs from disk or from
 * any static host with no import map and no separate requests.
 *
 * The second is the same payload without the <!doctype>/<html>/<head>/<body>
 * scaffolding, for hosts that supply their own document skeleton.
 */
import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = process.cwd();
const OUT = join(ROOT, 'dist');
await mkdir(OUT, { recursive: true });

// three is vendored rather than installed, so point the bare specifier at it.
const result = await build({
  entryPoints: [join(ROOT, 'src/main.js')],
  bundle: true,
  format: 'esm',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  alias: { three: join(ROOT, 'vendor/three/three.module.min.js') },
  write: false,
  logLevel: 'warning',
});

const js = result.outputFiles[0].text;
const css = await readFile(join(ROOT, 'styles/hud.css'), 'utf8');
let html = await readFile(join(ROOT, 'index.html'), 'utf8');

// Swap the linked stylesheet, the import map and the module entry for inline
// equivalents.
//
// Every replacement goes through a FUNCTION, not a string. A string
// replacement expands `$&`, `$1`, "$`" and friends — and minified JavaScript
// is full of `$&&x` and `$1`, so a string replacement silently splices the
// matched HTML into the middle of the bundle. That failure is invisible until
// the page refuses to parse.
const inline = (v) => () => v;

html = html
  // The single file has no sibling manifest, icons or service worker to fetch,
  // and requesting them would only produce console errors in an embed.
  .replace(/<link rel="manifest"[^>]*>\s*/, inline(''))
  .replace(/<link rel="icon"[^>]*>\s*/, inline(''))
  .replace(/<link rel="apple-touch-icon"[^>]*>\s*/, inline(''))
  .replace('<link rel="stylesheet" href="styles/hud.css" />', inline(`<style>\n${css}\n</style>`))
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, inline(''))
  .replace(
    '<script type="module" src="./src/main.js"></script>',
    // A literal `</script>` inside the bundle would close the tag early.
    inline(
      '<script>window.__SINGLE_FILE__ = true;<\/script>\n'
      + `<script type="module">\n${js.replace(/<\/script>/gi, () => '<\\/script>')}\n</script>`,
    ),
  );

if (html.includes('src="./src/main.js"') || html.includes('importmap')) {
  throw new Error('bundle: an inline replacement did not take');
}

const report = async (name, text) => {
  const file = join(OUT, name);
  await writeFile(file, text);
  console.log(`wrote ${file}  (${(Buffer.byteLength(text) / 1024).toFixed(0)} KB)`);
};

await report('lynx-xm30.html', html);

if (process.argv.includes('--artifact')) {
  // Strip the document scaffolding, keeping the title first so a host that
  // scans only the head of the file still finds it.
  const title = html.match(/<title>[\s\S]*?<\/title>/i)?.[0] ?? '<title>LYNX XM30</title>';
  const body = html.match(/<body[^>]*>([\s\S]*)<\/body>/i)?.[1];
  if (!body) throw new Error('bundle: could not find the document body');
  const style = html.match(/<style>[\s\S]*?<\/style>/i)?.[0] ?? '';
  await report('lynx-xm30.artifact.html', `${title}\n${style}\n${body.trim()}\n`);
}
