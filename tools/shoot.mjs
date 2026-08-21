/**
 * Headless screenshot harness.
 *   node tools/shoot.mjs inspect  iso side front rear top detail
 *   node tools/shoot.mjs game     [seconds]
 * Writes PNGs into the directory given by SHOT_DIR (default ./.shots).
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, writeFile } from 'node:fs/promises';
import { mkdirSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const OUT = process.env.SHOT_DIR || join(ROOT, '.shots');
mkdirSync(OUT, { recursive: true });

const MIME = {
  '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.css': 'text/css', '.json': 'application/json', '.png': 'image/png',
};

// Optionally serve under a prefix, so the harness can reproduce the way
// GitHub Pages hosts a project site at /<repo>/ rather than the domain root.
const PREFIX = process.env.SERVE_PREFIX || '';

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (PREFIX && p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch {
    res.writeHead(404).end('not found');
  }
});
await new Promise((r) => server.listen(0, r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}${PREFIX}`;

const mode = process.argv[2] || 'inspect';
const args = process.argv.slice(3);

// The container ships a Chromium at PLAYWRIGHT_BROWSERS_PATH; use it directly
// rather than letting playwright try to download a pinned build.
const CHROME = process.env.CHROME_PATH
  || join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium');
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: [
    '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--disable-lcd-text', '--no-sandbox', '--disable-dev-shm-usage',
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });

const errors = [];
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
page.on('console', (m) => {
  if (m.type() !== 'error') return;
  const t = m.text();
  if (t.includes('favicon')) return;
  errors.push('CONSOLE: ' + t);
});
page.on('requestfailed', (r) => {
  if (!r.url().includes('favicon')) errors.push('REQFAIL: ' + r.url());
});

if (mode === 'mobile') {
  // A phone held in landscape, with touch and no mouse.
  const [w, h] = (args[0] || '844x390').split('x').map(Number);
  const phone = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: 3,
    hasTouch: true,
    isMobile: true,
  });
  const mp = await phone.newPage();
  mp.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message));
  await mp.goto(base + '/index.html?seed=20260821', { waitUntil: 'load', timeout: 90000 });
  await mp.waitForFunction('window.__ready === true', { timeout: 40000 });
  await mp.screenshot({ path: join(OUT, 'mobile-boot.png'), animations: 'disabled', timeout: 90000 });
  console.log('shot mobile-boot.png');

  await mp.click('#start-btn');
  await mp.waitForTimeout(400);
  await mp.evaluate(() => {
    const g = window.__game;
    g.simulate(40);
    // Lay on a target so the perception symbology is exercised too.
    const t = g.enemies.enemies.find((e) => {
      const c = g.perception.contacts.get(e.id);
      return e.alive && c && c.hasLos && e.basePosition.z > g.driving.position.z + 70;
    });
    if (t) {
      g.views.setMagnification(1);
      for (let i = 0; i < 50; i++) { g.views.aimAt(t.centre, true); g.step(0.05); }
      g.gunnery.lrfCooldown = 0;
      g.gunnery.lase();
      g.views.aimAt(t.centre, true);
      g.step(0.05);
    }
    for (let i = 0; i < 20; i++) g.hud.update(0.05, g);
  });
  await mp.waitForTimeout(500);
  await mp.screenshot({ path: join(OUT, 'mobile-play.png'), animations: 'disabled', timeout: 90000 });
  console.log('shot mobile-play.png');

  await mp.setViewportSize({ width: h, height: w });
  await mp.waitForTimeout(400);
  await mp.screenshot({ path: join(OUT, 'mobile-portrait.png'), animations: 'disabled', timeout: 90000 });
  console.log('shot mobile-portrait.png');
  await phone.close();
} else if (mode === 'bundle') {
  // Smoke-test the single-file build: it must boot and run with no import map
  // and no separate requests. If an artifact fragment was also built, wrap it
  // in a minimal skeleton the way a host would and check that too.
  const fragment = join(ROOT, 'dist/lynx-xm30.artifact.html');
  if (existsSync(fragment)) {
    const body = await readFile(fragment, 'utf8');
    await writeFile(join(ROOT, 'dist/_artifact-wrapped.html'),
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width, initial-scale=1">` +
      `</head><body>${body}</body></html>`);
    const errs = [];
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    p2.on('pageerror', (e) => errs.push(e.message));
    await p2.goto(base + '/dist/_artifact-wrapped.html', { waitUntil: 'load' });
    const ok = await p2.waitForFunction('window.__ready === true', { timeout: 20000 })
      .then(() => true).catch(() => false);
    if (ok) {
      await p2.click('#start-btn');
      await p2.waitForTimeout(400);
      const info = await p2.evaluate(() => { window.__game.simulate(8); return window.__game.debugInfo(); });
      console.log('artifact fragment:', JSON.stringify({ state: info.state, enemies: info.enemies, calls: info.calls }));
      await p2.screenshot({ path: join(OUT, 'artifact.png'), animations: 'disabled', timeout: 90000 });
      console.log('shot artifact.png');
    } else {
      console.log('artifact fragment FAILED to boot:', errs.slice(0, 3).join(' | '));
      process.exitCode = 1;
    }
    await p2.close();
  }

  const requests = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.goto(base + '/dist/lynx-xm30.html', { waitUntil: 'load' });
  try {
    await page.waitForFunction('window.__ready === true', { timeout: 20000 });
  } catch {
    console.log('bundle failed to boot');
    for (const e of errors.slice(0, 10)) console.log(' ', e);
    await browser.close(); server.close();
    process.exit(1);
  }
  await page.click('#start-btn');
  await page.waitForTimeout(500);
  const info = await page.evaluate(() => { window.__game.simulate(12); return window.__game.debugInfo(); });
  console.log('bundle:', JSON.stringify(info));
  const external = requests.filter((u) => !u.endsWith('/dist/lynx-xm30.html'));
  console.log(`sub-resource requests: ${external.length}`, external.slice(0, 5).join(' '));
  await page.screenshot({ path: join(OUT, 'bundle.png'), animations: 'disabled', timeout: 90000 });
  console.log('shot bundle.png');
} else if (mode === 'inspect') {
  await page.goto(base + '/inspect.html', { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 25000 }).catch(() => {});
  await page.waitForTimeout(1200);

  const stats = await page.evaluate(() => {
    const i = window.__inspector;
    if (!i) return null;
    return { size: { x: i.size.x, y: i.size.y, z: i.size.z } };
  });
  console.log('measured:', JSON.stringify(stats));

  const views = args.length ? args : ['iso', 'side', 'front', 'rear', 'top', 'detail'];
  for (const v of views) {
    await page.evaluate((name) => window.__inspector.setView(name), v);
    await page.waitForTimeout(450);
    await page.screenshot({ path: join(OUT, `inspect-${v}.png`) });
    console.log('shot', v);
  }
} else {
  const seconds = Number(args[0] || 3);
  const shot = async (name) => {
    try {
      await page.screenshot({ path: join(OUT, name), animations: 'disabled', timeout: 90000 });
      console.log('shot', name);
    } catch (e) {
      console.log('SHOT FAILED', name, e.message.split('\n')[0]);
    }
  };

  await page.goto(base + '/index.html', { waitUntil: 'load' });
  await page.waitForFunction('window.__ready === true', { timeout: 30000 }).catch(() => {});
  await shot('game-boot.png');

  // Apply any requested pre-start setup (seat / difficulty) then start.
  for (const a of args.slice(1)) {
    if (a.startsWith('seat=')) await page.click(`.seat-btn[data-seat="${a.slice(5)}"]`).catch(() => {});
    if (a.startsWith('diff=')) await page.click(`.diff-btn[data-diff="${a.slice(5)}"]`).catch(() => {});
  }
  await page.click('#start-btn').catch(() => {});
  await page.waitForTimeout(600);

  // Advance the simulation deterministically — software GL renders far too
  // slowly to accumulate meaningful game state in real time.
  await page.evaluate((sec) => window.__game.simulate(sec), seconds).catch((e) => {
    console.log('SIM FAILED', e.message.split('\n')[0]);
  });
  // Lay the sight on a live target so the perception symbology is exercised.
  await page.evaluate(() => {
    const g = window.__game;
    const t = g.enemies.enemies.find((e) => {
      const c = g.perception.contacts.get(e.id);
      return e.alive && c && c.hasLos && e.basePosition.z > g.driving.position.z + 90;
    });
    if (!t) return;
    g.views.setMagnification(1);
    for (let i = 0; i < 60; i++) { g.views.aimAt(t.centre, true); g.step(0.05); }
    g.gunnery.lrfCooldown = 0;
    g.gunnery.lase();
    g.views.aimAt(t.centre, true);
    g.step(0.05);
  }).catch(() => {});
  // Let the HUD settle (damage vignettes and tickers are time-based).
  await page.evaluate(() => { for (let i = 0; i < 20; i++) window.__game.hud.update(0.05, window.__game); })
    .catch(() => {});
  await page.waitForTimeout(300);

  const info = await page.evaluate(() => (window.__game ? window.__game.debugInfo() : null))
    .catch((e) => ({ evalError: e.message }));
  console.log('game:', JSON.stringify(info));
  await shot('game-play.png');

  // With the GPU readout open, so the panel is covered by a render too.
  await page.evaluate(() => {
    const g = window.__game;
    g.showDiagnostics = true;
    for (let i = 0; i < 8; i++) { g.step(0.05); g.hud.update(0.3, g); }
  }).catch(() => {});
  await page.waitForTimeout(400);
  await shot('game-diagnostics.png');
  await page.evaluate(() => { window.__game.showDiagnostics = false; }).catch(() => {});

  // Close-up on a target through the narrow field of view, to check that a
  // figure in a window actually reads at gunnery range.
  await page.evaluate(() => {
    const g = window.__game;
    const near = g.enemies.enemies
      .filter((e) => e.alive && e.basePosition.z > g.driving.position.z + 60)
      .sort((a, b) => a.basePosition.z - b.basePosition.z)[0];
    if (!near) return;
    g.views.setMagnification(2);
    for (let i = 0; i < 40; i++) { g.views.aimAt(near.centre, true); g.step(0.05); }
    g.views.aimAt(near.centre, true);
    g.step(0.02);
    for (let i = 0; i < 20; i++) g.hud.update(0.05, g);
  }).catch(() => {});
  await page.waitForTimeout(500);
  await shot('game-target.png');

  // A second capture from the external view, which exercises the other camera.
  await page.evaluate(() => {
    const g = window.__game;
    g.views.toggleMode();
    g.step(0.05);
    for (let i = 0; i < 20; i++) g.hud.update(0.05, g);
  }).catch(() => {});
  await page.waitForTimeout(900);
  await shot('game-external.png');
}

if (errors.length) {
  console.log('\n--- page errors ---');
  for (const e of errors.slice(0, 25)) console.log(e);
  process.exitCode = 1;
} else {
  console.log('\nno page errors');
}

await browser.close();
server.close();
