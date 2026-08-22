/**
 * Generates the app icons.
 *
 *   node tools/icons.mjs
 *
 * The artwork is an SVG defined here and rasterised by the headless browser
 * that is already a dependency for the test harness, so there is no image
 * library to install and the source of truth is a few lines of markup rather
 * than a binary someone has to open an editor to change.
 *
 * Outputs are committed; re-run this only when the artwork changes.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(process.cwd(), 'icons');
mkdirSync(OUT, { recursive: true });

const GROUND = '#0a1410';
const GREEN = '#7dfda6';
const DIM = '#3f9e63';

/**
 * The vehicle in side profile, nose right, drawn to roughly the proportions of
 * the real thing: long hull, sloped glacis, low turret set back of centre, a
 * gun about half the hull length again.
 *
 * @param {boolean} maskable  keep the artwork inside the centre 80%, which is
 *                            the safe zone Android may crop a maskable icon to
 */
function svg(maskable) {
  const s = maskable ? 0.72 : 0.9;          // artwork scale within the tile
  const t = (512 - 512 * s) / 2;            // centring offset

  return `
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${GROUND}"/>

  <!-- range rings, kept faint so they read as texture rather than clutter -->
  <g stroke="${DIM}" fill="none" opacity="0.30">
    <circle cx="256" cy="256" r="210" stroke-width="3"/>
    <path d="M256 30 V86 M256 426 V482 M30 256 H86 M426 256 H482" stroke-width="7"
          stroke-linecap="round"/>
  </g>

  <g transform="translate(${t} ${t}) scale(${s})">
    <!-- running gear -->
    <rect x="52" y="376" width="404" height="40" rx="20" fill="${DIM}"/>
    <g fill="${GROUND}">
      ${[96, 152, 208, 264, 320, 376, 420].map((x) =>
        `<circle cx="${x}" cy="396" r="13"/>`).join('\n      ')}
    </g>

    <!-- hull: flat roof, long sloped glacis to a blunt prow -->
    <path d="M 58 372 L 58 300 L 330 300 L 430 342 L 442 360 L 442 372 Z"
          fill="${GREEN}"/>
    <!-- side armour module, a shade darker so the hull reads as layered -->
    <rect x="86" y="316" width="210" height="40" fill="${GROUND}" opacity="0.28"/>

    <!-- turret: faceted, set aft of centre, with the sight head proud of it -->
    <path d="M 150 300 L 168 244 L 286 244 L 310 268 L 310 300 Z" fill="${GREEN}"/>
    <rect x="188" y="222" width="34" height="24" rx="4" fill="${GREEN}"/>

    <!-- 50 mm gun -->
    <rect x="304" y="266" width="168" height="17" rx="6" fill="${GREEN}"/>
    <rect x="452" y="261" width="22" height="27" rx="5" fill="${GREEN}"/>
  </g>
</svg>`;
}

const browser = await chromium.launch({
  executablePath: existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const targets = [
  { file: 'icon-192.png', size: 192, maskable: false },
  { file: 'icon-512.png', size: 512, maskable: false },
  { file: 'icon-maskable-512.png', size: 512, maskable: true },
  { file: 'apple-touch-icon.png', size: 180, maskable: true },
  { file: 'favicon-32.png', size: 32, maskable: false },
];

for (const { file, size, maskable } of targets) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(
    `<style>html,body{margin:0;padding:0;background:${GROUND}}svg{display:block;width:${size}px;height:${size}px}</style>`
    + svg(maskable),
  );
  await page.screenshot({ path: join(OUT, file), omitBackground: false });
  await page.close();
  console.log(`wrote icons/${file}  (${size}x${size}${maskable ? ', maskable' : ''})`);
}

await browser.close();
