/**
 * Unattended survivability probe.
 *
 *   node tools/balance.mjs [seed]
 *
 * Runs each difficulty with NO player input at all — no steering, no return
 * fire — and reports how far the vehicle gets. This is the floor, not the
 * expected experience: a crew that steers around the obstacles and engages
 * shooters before they shoot should comfortably beat these numbers.
 *
 * Use it after changing damage, spawn density or hazard placement, to check
 * the change moved the floor in the direction you intended.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const SEED = process.argv[2] || '4242';
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

const CHROME = join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium');
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});

console.log(`seed ${SEED} — unattended run, no steering and no return fire\n`);
console.log('difficulty  outcome    metres  hull  mob  struck  hit');

for (const diff of ['training', 'standard', 'gunnery']) {
  const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
  await page.goto(`${base}/index.html?seed=${SEED}`, { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 40000 });
  await page.click(`.diff-btn[data-diff="${diff}"]`);
  await page.click('#start-btn');
  await page.waitForTimeout(300);

  const r = await page.evaluate(() => {
    const g = window.__game;
    for (let t = 0; t < 900 && g.state === 'running'; t += 10) g.simulate(10);
    return {
      state: g.state,
      m: Math.round(g.driving.distance),
      hull: Math.round(g.driving.hull),
      mob: Math.round(g.driving.mobility),
      strikes: g.score.strikes,
      hits: g.score.hitsTaken,
    };
  });
  const outcome = r.state === 'running' ? 'survived' : 'lost';
  console.log(
    `${diff.padEnd(11)} ${outcome.padEnd(10)} ${String(r.m).padStart(5)} ` +
    `${String(r.hull).padStart(5)} ${String(r.mob).padStart(4)} ` +
    `${String(r.strikes).padStart(7)} ${String(r.hits).padStart(4)}`,
  );
  await page.close();
}

await browser.close();
server.close();
