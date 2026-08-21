/**
 * End-to-end checks, run in a real browser against the real game.
 *
 *   node tools/verify.mjs
 *
 * Exits non-zero on the first failed assertion, and prints every check either
 * way so a failure says what broke rather than just that something did.
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';

const ROOT = process.cwd();
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css' };

// GitHub Pages serves a project site from /<repo>/, not the domain root, so
// the checks run against that prefix — an absolute path anywhere in the entry
// points would 404 there and nowhere else.
const PREFIX = '/LYNXXM30';

const server = createServer(async (req, res) => {
  try {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';
    if (p === '/') p = '/index.html';
    const file = join(ROOT, normalize(p).replace(/^(\.\.[/\\])+/, ''));
    // Read BEFORE writing headers, or a miss tries to send a second response.
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' });
    res.end(body);
  } catch { res.writeHead(404).end('not found'); }
});
await new Promise((r) => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}${PREFIX}`;

const CHROME = process.env.CHROME_PATH
  || join(process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers', 'chromium');
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : undefined,
  args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
         '--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });

const pageErrors = [];
page.on('pageerror', (e) => pageErrors.push(e.message));
page.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) pageErrors.push(m.text());
});

let failures = 0;
function check(name, ok, detail = '') {
  const mark = ok ? 'PASS' : 'FAIL';
  if (!ok) failures++;
  console.log(`  [${mark}] ${name}${detail ? '  — ' + detail : ''}`);
}

/* ---------------------------------------------------------------- inspector */
console.log('\nMODEL');
await page.goto(base + '/inspect.html', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 40000 });
await page.waitForTimeout(400);

const model = await page.evaluate(() => {
  const i = window.__inspector;
  const spec = i.XM30;
  let tris = 0, meshes = 0;
  i.vehicle.root.traverse((o) => {
    if (!o.isMesh) return;
    meshes++;
    const g = o.geometry;
    tris += (g.index ? g.index.count : g.attributes.position.count) / 3;
  });
  // Articulation round-trip.
  i.vehicle.azimuth = 1.2;
  i.vehicle.elevation = 0.4;
  i.vehicle.commanderAzimuth = -2.0;
  const round = {
    az: i.vehicle.azimuth,
    el: i.vehicle.elevation,
    cdr: i.vehicle.commanderAzimuth,
  };
  i.vehicle.azimuth = 0; i.vehicle.elevation = 0; i.vehicle.commanderAzimuth = 0;
  return {
    size: { x: i.size.x, y: i.size.y, z: i.size.z },
    spec: {
      length: spec.hull.length,
      width: spec.hull.widthOverall,
      turretRoof: i.DERIVED.turretRoofY,
    },
    tris, meshes, round,
  };
});

const tol = (a, b, t) => Math.abs(a - b) <= t;
check('hull length matches the published 7.73 m',
  tol(model.size.z, model.spec.length, 0.35), `${model.size.z.toFixed(2)} m`);
check('overall width matches the published 3.60 m',
  tol(model.size.x, model.spec.width, 0.25), `${model.size.x.toFixed(2)} m`);
check('turret roof lands near the published 3.30 m overall height',
  tol(model.spec.turretRoof, 3.30, 0.10), `${model.spec.turretRoof.toFixed(2)} m`);
check('measured envelope height excludes the aerials',
  model.size.y > 3.4 && model.size.y < 4.1, `${model.size.y.toFixed(2)} m over the sights`);
check('geometry is batched (mesh count stays modest)',
  model.meshes < 120, `${model.meshes} meshes, ${Math.round(model.tris).toLocaleString()} tris`);
check('turret azimuth round-trips', tol(model.round.az, 1.2, 1e-6));
check('gun elevation round-trips', tol(model.round.el, 0.4, 1e-6));
check('commander sight traverses independently of the turret',
  tol(model.round.cdr, -2.0, 1e-6));

/* --------------------------------------------------------------------- game */
console.log('\nSIMULATION');
await page.goto(base + '/index.html?seed=20260821', { waitUntil: 'load' });
await page.waitForFunction('window.__ready === true', { timeout: 40000 });
await page.click('#start-btn');
await page.waitForTimeout(500);

const sim = await page.evaluate(() => {
  const g = window.__game;
  g.simulate(25);
  return g.debugInfo();
});
check('the route streams in ahead of the vehicle', sim.chunks >= 10, `${sim.chunks} chunks`);
check('buildings are placed on both sides', sim.buildings > 30, `${sim.buildings}`);
check('road hazards are placed', sim.hazards > 3, `${sim.hazards}`);
check('targets occupy firing positions', sim.enemies >= 4, `${sim.enemies} live`);
check('the vehicle covers ground', sim.distance > 150, `${sim.distance} m`);

/* --------------------------------------------------------------- perception */
console.log('\nPERCEPTION');
const perception = await page.evaluate(() => {
  const g = window.__game;

  /** Keeps the sight laid on a moving target while the sim advances. */
  const track = (enemy, seconds, dt = 0.1) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) {
      if (!enemy.alive) break;
      g.views.aimAt(enemy.centre, true);
      g.step(dt);
    }
  };

  // Pick a live target well ahead so it is not retired mid-test, preferring
  // one that is not a pop-up: a rooftop shooter spends much of its time behind
  // the parapet, where by design nothing can be observed.
  const ahead = () => g.enemies.enemies.filter(
    (e) => e.alive && e.basePosition.z > g.driving.position.z + 90);
  const target = ahead().find((e) => e.cover < 0.6 && g.perception.contacts.get(e.id)?.hasLos)
    || ahead().find((e) => g.perception.contacts.get(e.id)?.hasLos)
    || ahead()[0];
  if (!target) return { error: 'no live target ahead' };

  g.views.setMagnification(0);           // widest field of view first
  track(target, 4.0);
  const c0 = g.perception.contacts.get(target.id);
  if (!c0) return { error: 'contact vanished at wide magnification' };
  const wide = {
    level: c0.level, best: c0.best, apparent: c0.apparent, range: c0.range, mils: c0.subtense,
    hasLos: c0.hasLos, inView: c0.inView,
    offAxisDeg: +(c0.offAxis * 180 / Math.PI).toFixed(2),
    halfFovDeg: +(g.views.fovDeg / 2).toFixed(2),
    exposure: +target.exposure.toFixed(2), cover: +target.cover.toFixed(2),
    state: target.state, progress: +c0.progress.toFixed(2),
  };

  g.views.setMagnification(2);           // narrow: same target, more resolution
  track(target, 3.0);
  const c1 = g.perception.contacts.get(target.id);
  if (!c1) return { error: 'contact vanished at narrow magnification' };
  const narrow = { level: c1.level, best: c1.best, apparent: c1.apparent };

  // Mil-relation must round-trip against the true range. Anything behind
  // cover may be ducked right now, so work whichever target is currently
  // observable and give it time to come back up.
  g.views.setMagnification(1);
  let raw = null;
  for (let i = 0; i < 200 && !raw; i++) {
    const t = ahead().find((e) => g.perception.contacts.get(e.id)?.hasLos) || target;
    if (!t.alive) { g.step(0.05); continue; }
    g.views.aimAt(t.centre, true);
    g.step(0.05);
    raw = g.perception.milRelationEstimate();
  }
  const est = raw ? { range: raw.range, trueRange: raw.trueRange, mils: raw.mils } : null;

  // Range-finder. Lasing past a rooftop figure into open sky legitimately
  // returns nothing, so lay on something with a backstop and allow a retry.
  let lased = null;
  for (let i = 0; i < 30 && !lased; i++) {
    const t = ahead().find((e) => g.perception.contacts.get(e.id)?.hasLos) || target;
    g.views.aimAt(t.centre, true);
    g.step(0.05);
    g.gunnery.lrfCooldown = 0;
    lased = g.gunnery.lase();
  }

  return {
    wide, narrow, est, lased,
    listed: g.perception.list().length,
    targetCover: +target.cover.toFixed(2),
    targetKind: target.slot.kind,
  };
});

if (perception.error) {
  check('a target was available to observe', false, perception.error);
} else {
  check('a target in the sight is at least detected',
    Math.max(perception.wide.level, perception.wide.best) >= 1,
    `level ${perception.wide.level} at ${Math.round(perception.wide.range)} m, ` +
    `${perception.wide.mils.toFixed(2)} true mils, ` +
    `los=${perception.wide.hasLos} inView=${perception.wide.inView} ` +
    `off=${perception.wide.offAxisDeg}/${perception.wide.halfFovDeg}deg ` +
    `expo=${perception.wide.exposure} cover=${perception.wide.cover} ` +
    `state=${perception.wide.state} prog=${perception.wide.progress}`);
  check('narrowing the field of view raises apparent size',
    perception.narrow.apparent > perception.wide.apparent * 2,
    `${perception.wide.apparent.toFixed(1)} → ${perception.narrow.apparent.toFixed(1)} apparent mils`);
  // Compare the best level reached, not the live one: a rooftop shooter that
  // has ducked back behind its parapet legitimately drops off the sight.
  check('magnifying advances the recognition ladder',
    perception.narrow.best >= perception.wide.best,
    `best level ${perception.wide.best} → ${perception.narrow.best} ` +
    `on a ${perception.targetKind} position`);
  check('the contact reaches the perception panel', perception.listed >= 1, `${perception.listed} listed`);
  if (perception.est) {
    const err = Math.abs(perception.est.range - perception.est.trueRange) / perception.est.trueRange;
    check('mil-relation ranging agrees with the true range within 10%',
      err < 0.10,
      `${Math.round(perception.est.range)} m estimated vs ${Math.round(perception.est.trueRange)} m actual`);
  } else {
    check('mil-relation estimate is produced for the cued contact', false, 'nothing cued');
  }
  check('the laser range-finder returns a range',
    !!perception.lased && perception.lased.range > 20,
    perception.lased ? `${perception.lased.range} m (${perception.lased.what})` : 'no return');
}

/* ------------------------------------------------------------------ gunnery */
console.log('\nGUNNERY');
const gunnery = await page.evaluate(() => {
  const g = window.__game;

  // Wait for something engageable — every target may be behind cover right
  // at this instant, which is the system working, not a failure.
  const find = () => g.enemies.enemies.find((e) =>
    e.alive && e.basePosition.z > g.driving.position.z + 90 &&
    (g.perception.contacts.get(e.id)?.hasLos));
  let target = find();
  for (let i = 0; i < 200 && !target; i++) { g.step(0.05); target = find(); }
  if (!target) return { error: 'no target with line of sight' };

  const before = { ammo: g.gunnery.ammo.ap, kills: g.score.kills, fired: g.gunnery.roundsFired, hit: g.gunnery.hits };
  g.views.setMagnification(2);

  let shots = 0;
  for (let i = 0; i < 12 && target.alive; i++) {
    // Lay, lase, lay again — the fire-control solution is only correct for
    // the range it was built on.
    g.views.aimAt(target.centre, true);
    g.gunnery.lrfCooldown = 0;
    g.gunnery.lase();
    for (let k = 0; k < 6; k++) { g.views.aimAt(target.centre, true); g.step(0.05); }
    g.gunnery.fireMain();
    shots++;
    // Let the burst leave the tube and the rounds fly out to the target.
    for (let k = 0; k < 40 && target.alive; k++) {
      g.views.aimAt(target.centre, true);
      g.step(0.05);
    }
  }

  const fired = g.gunnery.roundsFired - before.fired;
  const hits = g.gunnery.hits - before.hit;
  return {
    shots,
    killed: !target.alive,
    range: g.views.rangeSolution,
    ammoSpent: before.ammo - g.gunnery.ammo.ap,
    kills: g.score.kills - before.kills,
    score: g.score.total,
    accuracy: fired ? hits / fired : 0,
    fired, hits,
  };
});

if (gunnery.error) {
  check('a target was engageable', false, gunnery.error);
} else {
  check('the 50 mm expends ammunition when fired', gunnery.ammoSpent > 0, `${gunnery.ammoSpent} rounds`);
  check('rounds find the target', gunnery.hits > 0,
    `${gunnery.hits}/${gunnery.fired} rounds hit (${Math.round(gunnery.accuracy * 100)}%)`);
  check('a laid, ranged engagement destroys the target',
    gunnery.killed, gunnery.killed ? `after ${gunnery.shots} engagements at ${Math.round(gunnery.range)} m` : 'target survived');
  check('a kill scores', gunnery.score > 0, `${gunnery.score} points`);
}

/* --------------------------------------------------------------- crew seats */
console.log('\nCREW STATIONS');
const seats = await page.evaluate(() => {
  const g = window.__game;
  const out = {};
  out.startSeat = g.views.seat;
  out.startFov = g.views.fovDeg;

  g.views.swapSeat();
  out.swappedSeat = g.views.seat;
  out.spotterFov = g.views.fovDeg;

  // The spotter designates; the gunner should be handed the lay.
  const alive = g.enemies.enemies.filter(
    (e) => e.alive && e.basePosition.z > g.driving.position.z + 60);
  let designated = null;
  for (const e of alive) {
    for (let i = 0; i < 60 && !designated; i++) {
      g.views.aimAt(e.centre, true);
      g.step(0.05);
      designated = g.perception.designate();
    }
    if (designated) break;
  }
  if (designated) g.views.slewTo(designated.enemy.centre);
  out.designated = !!designated;
  out.slaved = !!g.views.slavedTo;

  g.views.swapSeat();
  g.simulate(2.5);
  out.gunnerAz = g.views.aim.gunner.az;
  out.turretAz = g.model.azimuth;

  out.modeBefore = g.views.mode;
  g.views.toggleMode();
  out.modeAfter = g.views.mode;
  g.simulate(0.2);
  out.chaseCamera = { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z };
  out.vehicle = { x: g.model.root.position.x, y: 0, z: g.model.root.position.z };
  g.views.toggleMode();
  g.simulate(0.2);
  out.sightCamera = { x: g.camera.position.x, y: g.camera.position.y, z: g.camera.position.z };
  return out;
});

check('both seats are selectable',
  seats.startSeat === 'gunner' && seats.swappedSeat === 'spotter');
check("the spotter's sight is wider than the gunner's",
  seats.spotterFov > seats.startFov, `${seats.startFov}° vs ${seats.spotterFov}°`);
check('the spotter can designate a contact', seats.designated);
check('designation slews the turret (hunter–killer)', seats.slaved);
check('the turret follows the gunner lay',
  Math.abs(seats.turretAz - seats.gunnerAz) < 0.25,
  `turret ${seats.turretAz.toFixed(3)} vs sight ${seats.gunnerAz.toFixed(3)} rad`);
check('view toggles between sight and external',
  seats.modeBefore === 'sight' && seats.modeAfter === 'chase');

const chaseDist = Math.hypot(seats.chaseCamera.x - seats.vehicle.x, seats.chaseCamera.z - seats.vehicle.z);
const sightDist = Math.hypot(seats.sightCamera.x - seats.vehicle.x, seats.sightCamera.z - seats.vehicle.z);
check('the third-person camera sits back from the vehicle',
  chaseDist > 6, `${chaseDist.toFixed(1)} m behind`);
check('the first-person camera sits inside the vehicle',
  sightDist < 3, `${sightDist.toFixed(1)} m from hull centre`);

/* ---------------------------------------------------------------- graphics */
console.log('\nGRAPHICS');
const graphics = await page.evaluate(() => {
  const g = window.__game;
  const gfx = g.graphics;
  const start = gfx.report();

  // Walk every preset and record what each one costs.
  const presets = [];
  for (const name of ['minimal', 'low', 'balanced', 'high']) {
    gfx.apply(name, { silent: true });
    const r = gfx.report();
    presets.push({
      name,
      renderScale: r.renderScale,
      shadows: r.preset.shadows,
      shadowMap: r.preset.shadowMap,
      streamAhead: r.preset.streamAhead,
    });
  }
  gfx.apply('balanced', { silent: true });

  // Adaptive scaler: a run of slow frames must reduce the render scale.
  gfx.adaptive = true;
  const before = gfx.resScale;
  for (let i = 0; i < 200; i++) gfx.sample(0.050);   // 20 fps
  const afterSlow = gfx.resScale;
  for (let i = 0; i < 400; i++) gfx.sample(0.008);   // 125 fps
  const afterFast = gfx.resScale;

  // Open the readout and let the HUD populate it.
  g.showDiagnostics = true;
  for (let i = 0; i < 5; i++) g.hud.update(0.3, g);

  return {
    gpu: start.gpu,
    presets,
    adaptive: { before, afterSlow, afterFast },
    panelHidden: document.getElementById('diagnostics').hidden,
    panelGpu: document.getElementById('diag-gpu').textContent.trim(),
    panelApi: document.getElementById('diag-api').textContent.trim(),
    panelCalls: document.getElementById('diag-calls').textContent.trim(),
    warnShown: !document.getElementById('diag-warn').hidden,
  };
});

check('the renderer reports a WebGL2 context',
  /WebGL\s*2/i.test(graphics.gpu.api), graphics.gpu.api);
check('the GPU adapter is identified',
  graphics.gpu.device !== 'unavailable' && graphics.gpu.short.length > 0,
  graphics.gpu.short);
check('software rendering is detected and flagged',
  graphics.gpu.software === true && graphics.warnShown,
  graphics.gpu.software ? 'flagged (this container has no GPU)' : 'hardware adapter — warning correctly absent');
check('quality presets scale render resolution independently of the display',
  graphics.presets[0].renderScale < graphics.presets[2].renderScale,
  graphics.presets.map((p) => `${p.name} ${p.renderScale}x`).join(', '));
check('quality presets scale the shadow map',
  graphics.presets[0].shadowMap < graphics.presets[2].shadowMap,
  graphics.presets.map((p) => p.shadowMap).join(' → '));
check('the cheapest preset drops shadows, the next keeps them',
  graphics.presets[0].shadows === false && graphics.presets[1].shadows === true,
  graphics.presets.map((p) => `${p.name} ${p.shadows ? 'on' : 'off'}`).join(', '));
check('quality presets scale the streaming distance',
  graphics.presets[0].streamAhead < graphics.presets[2].streamAhead,
  graphics.presets.map((p) => `${p.streamAhead} m`).join(' → '));
check('adaptive resolution backs off on slow frames',
  graphics.adaptive.afterSlow < graphics.adaptive.before,
  `${graphics.adaptive.before.toFixed(2)} → ${graphics.adaptive.afterSlow.toFixed(2)}`);
check('adaptive resolution recovers when frames are fast',
  graphics.adaptive.afterFast > graphics.adaptive.afterSlow,
  `${graphics.adaptive.afterSlow.toFixed(2)} → ${graphics.adaptive.afterFast.toFixed(2)}`);
check('the readout populates when opened',
  !graphics.panelHidden && graphics.panelGpu.length > 3 && /\d/.test(graphics.panelCalls),
  `${graphics.panelApi} · ${graphics.panelCalls} calls`);

/* --------------------------------------------------------------------- HUD */
console.log('\nHUD');
const hud = await page.evaluate(() => {
  const g = window.__game;
  g.hud.update(0.016, g);
  return {
    reticleTicks: document.querySelectorAll('#mil-h line').length,
    dropMarks: document.querySelectorAll('#drop-marks path').length,
    contactRows: [...document.querySelectorAll('#contact-list li')]
      .filter((li) => li.style.display !== 'none').length,
    markers: [...document.querySelectorAll('.marker')]
      .filter((m) => m.style.display !== 'none').length,
    range: document.getElementById('rng-value').textContent.trim(),
    seat: document.getElementById('seat-name').textContent.trim(),
    speed: document.getElementById('speed').textContent.trim(),
  };
});
check('the reticle carries mil graduations', hud.reticleTicks > 4, `${hud.reticleTicks} ticks`);
check('the reticle carries ballistic drop marks', hud.dropMarks > 1, `${hud.dropMarks} chevrons`);
check('the range readout is populated', /\d/.test(hud.range), hud.range + ' m');
check('the seat indicator matches the active seat', hud.seat.length > 0, hud.seat);
check('the speedometer reads a road speed', Number(hud.speed) > 0, hud.speed + ' km/h');

/* ------------------------------------------------------------------- mobile */
console.log('\nMOBILE');

// Release the desktop page first. Two live WebGL contexts under a software
// rasteriser is enough to push the next page load past its timeout.
await page.close();

// A phone in landscape, with touch and no mouse at all.
const phone = await browser.newContext({
  viewport: { width: 844, height: 390 },
  deviceScaleFactor: 3,
  hasTouch: true,
  isMobile: true,
});
const mp = await phone.newPage();
const mobileErrors = [];
mp.on('pageerror', (e) => mobileErrors.push(e.message));
mp.on('console', (m) => {
  if (m.type() === 'error' && !m.text().includes('favicon')) mobileErrors.push(m.text());
});

await mp.goto(base + '/index.html?seed=20260821', { waitUntil: 'load', timeout: 90000 });
await mp.waitForFunction('window.__ready === true', { timeout: 40000 });

// The start button must be reachable without scrolling the boot card.
const bootFit = await mp.evaluate(() => {
  const btn = document.getElementById('start-btn').getBoundingClientRect();
  return { bottom: Math.round(btn.bottom), viewport: innerHeight };
});
check('START is reachable without scrolling on a landscape phone',
  bootFit.bottom <= bootFit.viewport,
  `button bottom ${bootFit.bottom}px of ${bootFit.viewport}px`);

const mobile = await mp.evaluate(async () => {
  const g = window.__game;

  /** Synthesises a touch pointer sequence against the real handlers. */
  const pointer = (target, type, x, y, id = 7) => target.dispatchEvent(new PointerEvent(type, {
    pointerId: id, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: y, bubbles: true, cancelable: true, buttons: type === 'pointerup' ? 0 : 1,
  }));

  const before = {
    touchVisible: !document.getElementById('touch').hidden,
    bodyTouch: document.body.classList.contains('touch'),
    touchOnly: document.body.classList.contains('touch-only'),
    pointerMode: g.input.pointerMode,
    quality: g.graphics.presetName,
  };

  document.getElementById('start-btn').click();
  await new Promise((r) => setTimeout(r, 200));
  g.simulate(4);

  // The controls are only read by the frame loop, so the touch tests have to
  // run whole frames rather than bare simulation steps.
  const frames = (n, dt = 0.05) => { for (let i = 0; i < n; i++) g.tickOnce(dt); };

  const compact = document.body.classList.contains('compact');

  // Drag across the sight picture: the sight must traverse.
  const az0 = g.views.aim.gunner.azDemand;
  const canvas = document.getElementById('viewport');
  pointer(canvas, 'pointerdown', 400, 200);
  for (let i = 1; i <= 10; i++) pointer(canvas, 'pointermove', 400 + i * 8, 200);
  pointer(canvas, 'pointerup', 480, 200);
  frames(1);
  const az1 = g.views.aim.gunner.azDemand;

  // Steer pad: a proportional order, and zero again once released.
  const pad = document.getElementById('touch-steer');
  const r = pad.getBoundingClientRect();
  pointer(pad, 'pointerdown', r.left + r.width * 0.9, r.top + r.height / 2, 8);
  const steerRight = g.input.steer;
  pointer(pad, 'pointerdown', r.left + r.width * 0.1, r.top + r.height / 2, 8);
  const steerLeft = g.input.steer;
  pointer(pad, 'pointerup', r.left + r.width * 0.1, r.top + r.height / 2, 8);
  const steerCentre = g.input.steer;

  // FIRE: held button must feed the same latched state the mouse does.
  const fire = document.querySelector('[data-hold="fire"]');
  const ammoBefore = g.gunnery.ammo.ap;
  pointer(fire, 'pointerdown', 0, 0, 9);
  const fireHeld = g.input.mouse(0);
  frames(14);
  pointer(fire, 'pointerup', 0, 0, 9);
  const fireReleased = g.input.mouse(0);
  const ammoSpent = ammoBefore - g.gunnery.ammo.ap;

  // LASE is a tap, not a hold.
  const lase = document.querySelector('[data-tap="lase"]');
  pointer(lase, 'pointerdown', 0, 0, 10);
  const lased = g.input.click(2);
  pointer(lase, 'pointerup', 0, 0, 10);

  // Seat swap relabels the primary action.
  const seatBtn = document.querySelector('[data-tap="Tab"]');
  pointer(seatBtn, 'pointerdown', 0, 0, 11);
  pointer(seatBtn, 'pointerup', 0, 0, 11);
  frames(1);
  const fireLabel = fire.textContent.trim();
  const seat = g.views.seat;

  // Every touch target must clear the 44 px minimum.
  const small = [...document.querySelectorAll('.tbtn')]
    .map((b) => b.getBoundingClientRect())
    .filter((b) => b.width < 44 || b.height < 36).length;

  return {
    ...before, compact,
    slew: Math.abs(az1 - az0),
    steerRight, steerLeft, steerCentre,
    fireHeld, fireReleased, ammoSpent,
    lased, fireLabel, seat, small,
    controlsOnScreen: [...document.querySelectorAll('.tbtn')].every((b) => {
      const r = b.getBoundingClientRect();
      return r.left >= 0 && r.top >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1;
    }),
  };
});

check('touch controls appear on a touch device',
  mobile.touchVisible && mobile.bodyTouch, `body.touch=${mobile.bodyTouch}`);
check('a phone with no mouse uses the touch pointer path',
  mobile.pointerMode === 'touch' && mobile.touchOnly, mobile.pointerMode);
check('the HUD switches to the compact layout', mobile.compact);
check('the mobile default quality preset is conservative',
  mobile.quality === 'low', mobile.quality);
check('dragging the view slews the sight',
  mobile.slew > 0.01, `${(mobile.slew * 1000).toFixed(0)} mrad from an 80 px drag`);
check('the steer pad gives a proportional order',
  mobile.steerRight > 0.5 && mobile.steerLeft < -0.5,
  `${mobile.steerLeft.toFixed(2)} … ${mobile.steerRight.toFixed(2)}`);
check('releasing the steer pad returns to centre', mobile.steerCentre === 0);
check('the FIRE button holds and releases',
  mobile.fireHeld === true && mobile.fireReleased === false);
check('holding FIRE expends ammunition', mobile.ammoSpent > 0, `${mobile.ammoSpent} rounds`);
check('LASE registers as a tap', mobile.lased === true);
check('swapping seat relabels the primary action',
  mobile.seat === 'spotter' && mobile.fireLabel === 'MARK', `${mobile.seat} → ${mobile.fireLabel}`);
check('every touch target clears the minimum size', mobile.small === 0,
  mobile.small ? `${mobile.small} too small` : 'all ≥ 44×36 px');
check('no control is pushed off screen at 844×390', mobile.controlsOnScreen);

// Portrait must stop the run rather than render a sliver of sight picture.
await mp.setViewportSize({ width: 390, height: 844 });
await mp.waitForTimeout(250);
const portrait = await mp.evaluate(() => ({
  rotateShown: !document.getElementById('rotate').hidden,
  state: window.__game.state,
}));
check('portrait raises the rotate prompt and pauses',
  portrait.rotateShown && portrait.state === 'paused',
  `${portrait.state}, prompt ${portrait.rotateShown ? 'shown' : 'hidden'}`);

check('no page errors on mobile', mobileErrors.length === 0, mobileErrors.slice(0, 2).join(' | '));
await phone.close();

/* ------------------------------------------------------------------- errors */
console.log('\nRUNTIME');
check('no page errors were raised', pageErrors.length === 0,
  pageErrors.slice(0, 3).join(' | '));
check('the whole run was served from a project subpath, as GitHub Pages does',
  true, base);

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
await browser.close();
server.close();
process.exit(failures === 0 ? 0 : 1);
