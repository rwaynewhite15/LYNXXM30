/**
 * Single-file build.
 *
 *   node tools/bundle.mjs
 *
 * Produces dist/lynx-xm30.html: the whole game — three.js, every module, the
 * stylesheet — inlined into one HTML file that runs from disk or from any
 * static host with no import map and no separate requests.
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
  .replace('<link rel="stylesheet" href="styles/hud.css" />', inline(`<style>\n${css}\n</style>`))
  .replace(/<script type="importmap">[\s\S]*?<\/script>\s*/, inline(''))
  .replace(
    '<script type="module" src="./src/main.js"></script>',
    // A literal `</script>` inside the bundle would close the tag early.
    inline(`<script type="module">\n${js.replace(/<\/script>/gi, () => '<\\/script>')}\n</script>`),
  );

if (html.includes('src="./src/main.js"') || html.includes('importmap')) {
  throw new Error('bundle: an inline replacement did not take');
}

const outFile = join(OUT, 'lynx-xm30.html');
await writeFile(outFile, html);
const kb = (Buffer.byteLength(html) / 1024).toFixed(0);
console.log(`wrote ${outFile}  (${kb} KB)`);
