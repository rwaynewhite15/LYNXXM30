/**
 * Regenerates the service worker's precache list.
 *
 *   node tools/precache.mjs            rewrite the list
 *   node tools/precache.mjs --check    exit non-zero if it is stale, write nothing
 *
 * Walks the files the browser actually loads, writes them into sw.js between
 * the generated markers, and stamps a cache name derived from a hash of their
 * contents — so changing any asset produces a new cache and every installed
 * copy picks the change up, with no version number for anyone to forget to
 * bump.
 */
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, relative, posix } from 'node:path';

const ROOT = process.cwd();

/** Directories walked in full, and the extensions taken from them. */
const TREES = [
  { dir: 'src', exts: ['.js'] },
  { dir: 'styles', exts: ['.css'] },
  { dir: 'vendor', exts: ['.js'] },
  { dir: 'icons', exts: ['.png'] },
];
const SINGLES = ['index.html', 'inspect.html', 'manifest.webmanifest'];

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(join(ROOT, dir), { withFileTypes: true })) {
    const rel = posix.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(rel));
    else out.push(rel);
  }
  return out;
}

const files = [...SINGLES];
for (const { dir, exts } of TREES) {
  const found = await walk(dir);
  files.push(...found.filter((f) => exts.some((e) => f.endsWith(e))));
}
files.sort();

// Cache name follows the content, so a stale cache cannot outlive an edit.
const hash = createHash('sha256');
for (const f of files) hash.update(f).update(await readFile(join(ROOT, f)));
const version = hash.digest('hex').slice(0, 12);

// './' is the navigation entry; the rest are relative so the whole thing works
// unchanged under a GitHub Pages project subpath.
const list = ["'./'", ...files.map((f) => `'./${f}'`)];
const body = list.map((l) => `  ${l},`).join('\n');

const swPath = join(ROOT, 'sw.js');
const current = await readFile(swPath, 'utf8');
const updated = current.replace(
  /(\/\* GENERATED:BEGIN \*\/)[\s\S]*?(\/\* GENERATED:END \*\/)/,
  () => `/* GENERATED:BEGIN */\nconst CACHE = 'xm30-${version}';\nconst ASSETS = [\n${body}\n];\n/* GENERATED:END */`,
);

// --check must not write. A verification step that repairs the thing it is
// verifying passes on its second run and hides the drift it was meant to catch.
if (process.argv.includes('--check')) {
  if (current === updated) {
    console.log(`precache: current — ${files.length} files, cache xm30-${version}`);
  } else {
    console.error(`precache: STALE — run \`node tools/precache.mjs\` (expected xm30-${version})`);
    process.exit(1);
  }
} else {
  await writeFile(swPath, updated);
  console.log(`precache: ${files.length} files, cache xm30-${version}`);
}
