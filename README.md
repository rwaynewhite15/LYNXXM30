# LYNX XM30 — crew-station trainer

A browser game built around a dimensionally-faithful 3D model of the **XM30**
Mechanized Infantry Combat Vehicle — the American Rheinmetall offering derived
from the Rheinmetall **Lynx KF41**, re-armed with the 50 mm XM913.

You ride a straight 4 km route through a built-up area. The driver keeps the
vehicle moving; you direct them around what is in the road, and you work the
targets in the windows, on the balconies and on the rooftops — from either the
**gunner's** seat or the **commander/spotter's** seat, in **first person**
through the sight or in **third person** outside the vehicle.

```
git clone <this repo> && cd LYNXXM30
npm start            # or: python3 -m http.server 8080
```

Then open <http://localhost:8080/>. There is no build step and no network
dependency — three.js is vendored into `vendor/`.

Works on a phone or tablet: see [Playing on a phone](#playing-on-a-phone).
To host it, see [GitHub Pages](#hosting-on-github-pages).

- `index.html` — the game
- `inspect.html` — a standalone model inspector: orbit the vehicle, work the
  turret, gun and commander's sight, and read the measured envelope

Append `?seed=12345` to the game URL to replay an identical route.

---

## The four viewpoints

|              | First person (`V`)                              | Third person (`V`)                        |
| ------------ | ----------------------------------------------- | ----------------------------------------- |
| **Gunner**   | Primary sight, boresighted to the 50 mm. Fields of view 18° / 6° / 2°, ballistic reticle with mil graduations. | Chase camera; the reticle moves to where the gun is actually looking. |
| **Spotter**  | Commander's panoramic sight, traversing independently of the turret. 30° / 10° / 3.4°. | Same cameras, with the panoramic sight's lay shown. |

`Tab` swaps seat, `V` swaps between the sight and outside, `C` cycles the
external camera. Each seat keeps its own lay and its own magnification — swap
back and your sight is where you left it.

The spotter's job is finding; the gunner's is killing. Put the panoramic sight
on something and press the left button to **designate** it: the contact jumps
up the recognition ladder and the turret slews onto it. That is the
hunter–killer arrangement the real turret is built around.

---

## The perception model

This is the part the 3D exists to serve. Targets are 1.78 m figures placed at
true scale on real positions, so a shooter 600 m away is small because they are
600 m away. Everything else falls out of the mil-relation:

```
subtense (mils) = target height (m) × 1000 ÷ range (m)
```

A standing figure subtends about **3 mils at 600 m** and **18 mils at 100 m**.
Multiply by the sight's magnification and you have the *apparent* size, which
is the single number that decides what you can make of a contact:

| Apparent size | State         | What the HUD tells you |
| ------------- | ------------- | ---------------------- |
| ≥ 2.5 mils    | **DETECT**    | Something is there. Range to the nearest 50 m. |
| ≥ 9 mils      | **RECOGNISE** | Personnel. Exact range. |
| ≥ 22 mils     | **IDENTIFY**  | What they are carrying — RPG, MG, ATGM, rifle. |

Each rung also needs dwell time with the sight on the contact, so sweeping past
something is not the same as looking at it.

The consequence is the actual gameplay loop: you can climb the ladder by
**closing the range** or by **narrowing the field of view** — and narrowing it
costs you the area you can search. The spotter runs wide and finds things; the
gunner runs narrow and identifies them. A contact that ducks behind a parapet
drops off the live symbology but stays in the contact list in brackets, because
a crew does not un-know what it has already identified.

Ranging works the same way in reverse, which is what the **LRF / MIL-RELATION**
panel is for. Bracket a figure against the reticle's vertical stadia, read the
mils, and:

```
range (m) = height (m) × 1000 ÷ mils
```

The panel shows you the reading and the answer as you do it. Right mouse lases
for an exact range instead — but the laser has a cycle time, and it tells the
world where you are looking.

**Ranging is not cosmetic.** The gun is laid for whatever range solution you
last obtained: the fire-control system computes superelevation for the drop
over that distance and corrects the parallax between the sight head and the
bore. Range it wrong and the round goes over or under. The chevrons stacked
below the aiming cross are aim-off marks for other ranges, in hundreds of
metres.

---

## Controls

| Key | Action |
| --- | ------ |
| Mouse | Traverse and elevate the sight you are looking through |
| Left button | Fire the 50 mm *(gunner)* · Designate the cued contact *(spotter)* |
| Right button | Lase for range |
| `Space` | Coaxial machine gun |
| `1` `2` `3` | Magnification: wide / medium / narrow |
| `X` | Sight channel: day → white-hot → black-hot |
| `R` | Ammunition: 50 mm AP ↔ airburst |
| `Tab` | Swap seat |
| `V` | Sight ↔ external view |
| `C` | Cycle the external camera |
| `T` | Slew the turret onto the designated contact |
| `A` `D` | Direct the driver — steer around what is in the road |
| `W` `S` | Order more or less road speed |
| `Q` | Graphics quality: low / balanced / high |
| `G` | GPU and performance readout |
| `H` / `P` | Controls / pause |

Hitting an obstacle costs mobility and hull; a slower vehicle hits softer.
Score rewards engaging a shooter **before it fires at you**, identifying it
first, and taking it at range.

---

## Playing on a phone

The phone is the primary target, not an afterthought. Touch controls appear
automatically on any device with a touchscreen, the game installs to the home
screen, and it runs with no network at all.

**Install it.** On Android, the title card shows an **INSTALL** button; on iOS,
use Share → Add to Home Screen. Installed, it launches fullscreen in landscape
with no browser chrome. A service worker precaches the entire shell — three.js
is vendored and every texture is generated at runtime, so there is nothing left
to fetch — which means it works on a plane, on the Underground, or with the
radio off. The verification suite proves this by switching the browser offline
and reloading.

**Landscape is better, portrait works.** Turn the phone sideways and you get
the full sight picture with controls under your thumbs. Upright, the controls
become full-width bands below the view and the panels split into two columns —
less to see, still playable. You get told this once, and then never again.

| Control | Action |
| --- | --- |
| **Drag anywhere on the view** | Slew the sight. This is the primary interaction, so it gets the whole screen rather than a thumbstick. |
| **STEER** pad, bottom left | Slide to direct the driver. Proportional, not on/off — a nudge changes lane, a full push swerves. Springs back to centre. |
| **SLOW / FAST** | Order a speed change. |
| **FIRE** | Main gun. Relabels to **MARK** in the spotter's seat, where the action is designating rather than shooting. |
| **LASE** | Range the target. Do this before you fire. |
| **COAX** | Machine gun; hold it. |
| **ZOOM / SEAT / VIEW / AMMO** | Magnification, swap seat, sight ↔ external, ammunition. |

Aiming and firing are deliberately on separate controls. A tap-to-fire scheme
reads well in a screenshot but makes it impossible to track a target and shoot
it at the same moment, which is most of this game.

### Handling

The title card carries three settings on a touch device, all remembered:

- **Controls: right / left handed.** Mirrors the whole scheme. Which hand holds
  a phone is not a preference the way a colour scheme is — reaching across the
  screen for FIRE means holding the device wrong for an entire run.
- **Look speed.** 0.4× to 2.2× on the drag-to-slew gain.
- **Vibration.** Short haptics on firing, on taking a hit, and on a kill.

### What it does with the handset

- **Keeps the screen awake** while a run is in progress, and gives the lock back
  the moment you pause.
- **Stands down when you put it away.** Backgrounding the app, taking a call, or
  the screen locking pauses the run rather than letting the vehicle drive itself
  into a wall.
- **Asks for landscape** when you go fullscreen, where the browser permits it.

None of these APIs exist everywhere — iPhone Safari has no Fullscreen API and no
orientation lock — so each is optional and failing is silent.

The HUD switches to a compact layout below roughly 560 px of height: the panels
stack into two columns clear of your thumbs, the optic surround becomes an
ellipse rather than a circle so a 2.2:1 phone screen isn't half black, and the
turret repeater and hint bar drop out. Every touch target clears 44 px, and the
whole HUD is inset from the notch and home indicator via `env(safe-area-inset-*)`.

Phones default to the **LOW** graphics preset — `Q` on a keyboard raises it, or
cycle it from the pause screen. The adaptive scaler pulls resolution back if
frames run long, so a slower device degrades gracefully rather than stuttering.

---

## Hosting on GitHub Pages

Yes — it's a static site with no build step, and every path in it is relative,
so it works from a project subpath like `https://<user>.github.io/LYNXXM30/`.
The verification suite runs the whole game from exactly that kind of subpath so
an absolute path can't creep back in unnoticed.

`.github/workflows/pages.yml` is already here, and it switches Pages on by
itself: `actions/configure-pages` is given `enablement: true`, which creates the
Pages site and sets its source to GitHub Actions using the run's own
`pages: write` permission. No repository setting has to be changed by hand.

**Deployments must come from the default branch.** When Pages is enabled,
GitHub creates a `github-pages` environment whose deployment-branch rule
permits only the default branch. A push to a feature branch will build and
upload the artifact and then fail at the deploy step with *"Branch is not
allowed to deploy to github-pages due to environment protection rules"*. Either
merge to `main`, or widen the rule under **Settings → Environments →
github-pages → Deployment branches**.

The workflow copies only what the browser loads — the two entry points,
`styles/`, `src/`, `vendor/`, `icons/`, the manifest and the service worker —
adds a `.nojekyll` marker so Pages doesn't run the tree through Jekyll, checks
the precache list hasn't drifted, and fails the build if it finds a
root-absolute `src` or `href` in either entry point.

If you'd rather not use Actions, the `gh-pages`-branch route works too: the
repository root is already a valid site, so pointing Pages at a branch and the
`/` folder serves it as-is.

---

## Graphics and the GPU

Rendering is WebGL2 throughout, so the work lands on your GPU — the renderer
asks for the high-performance adapter explicitly, and nothing in the game
forces a software path. Press **`G`** for a readout that names the adapter
actually doing the work, alongside frame time, render scale, draw calls and
triangle count. If your browser has fallen back to software rasterisation
(SwiftShader, llvmpipe), the panel says so in amber rather than leaving you to
guess why it feels slow.

**`Q`** cycles three presets, which move the four settings that actually cost
something together:

| | Render scale | Shadows | Shadow map / range | Filtering | Route built ahead |
| --- | --- | --- | --- | --- | --- |
| **LOW** | 1.0× | off | — | none | 460 m |
| **BALANCED** | 1.5× | soft | 2048 / 90 m | 8× | 780 m |
| **HIGH** | 2.0× | soft | 4096 / 150 m | 16× | 1150 m |

Render scale is absolute, not a fraction of your display's device pixel ratio.
On a 1× monitor **HIGH** supersamples to 2× and downsamples back, which is
where a strong GPU buys you a visibly cleaner picture; on a Retina panel
**LOW** halves the buffer and saves a lot of fill rate. Your choice is
remembered in browser storage.

On top of the preset, an adaptive scaler trims render resolution when frames
run long and gives it back when they don't, so a laptop iGPU stays playable
without holding a discrete card to the same picture.

If the readout says software rendering, it's a browser setting rather than
anything in the game: check `chrome://gpu` (or `about:support` in Firefox) and
turn hardware acceleration back on.

---

## Model accuracy

`src/spec/xm30.js` is the single source of truth for the vehicle's geometry,
and every figure in it is tagged with where it came from:

- `[P]` **published** — Rheinmetall/Army figures: 7.73 m long, 3.60 m wide,
  3.30 m over the turret, 44 t, 1,140 hp Liebherr V8, 70 km/h, seven road
  wheels a side, crew of three plus dismounts, 50 mm main armament.
- `[D]` **derived** — computed from a published figure plus a proportion
  measured off published side views.
- `[E]` **estimated** — scaled off reference photography by eye.

The hull is not a stack of boxes: `hullProfile()` derives the side profile from
the spec's plate angles and extrudes it across the width in two bands — the
narrow tub below the sponson line, full width above it — which is how the real
hull goes together. The track band is generated as the convex hull of the
sprocket, road wheels, idler and return rollers, because that is physically
what a tensioned track is. The turret is lofted from a base plan outline to an
inset roof outline, giving the Lance-lineage converging cheeks in one pass.

The inspector reports the measured envelope, and `tools/verify.mjs` asserts it
against the published numbers on every run.

**This is a game asset.** It is faithful at the envelope level and honest about
proportion everywhere else. It is not CAD, it contains nothing controlled, and
it should not be used as engineering data.

---

## Layout

```
index.html            the game
inspect.html          model inspector
styles/hud.css        crew-station HUD
src/
  config.js           every tunable, in one place
  spec/xm30.js        vehicle dimensions, with provenance
  model/
    materials.js      procedural textures — NATO camo, asphalt, concrete
    geo.js            profile extrusion, track band, batching
    hull.js           hull derived from the spec's plate angles
    turret.js         lofted turret, 50 mm, sights, smoke, ATGM
    running-gear.js   seven stations a side, sprocket, idler, track
    vehicle-model.js  assembly and the articulated node handles
    figures.js        enemy figures at true 1.78 m
  world/
    world.js          chunk streaming, road strips, line of sight
    buildings.js      facades, window recesses, balconies, rooftops
    props.js          wrecks, barriers, craters, rubble, scenery
  game/
    views.js          seats, sights, cameras, gun lay
    perception.js     the detect / recognise / identify ladder
    gunnery.js        ammunition, the 50 mm, the coax, the LRF
    effects.js        projectiles with time of flight and drop
    enemies.js        spawning, engagement behaviour, hit resolution
    driving.js        speed, steering, suspension, collisions
    hud.js            reticle generation, symbology, panels
    input.js          pointer lock and latched keys
    audio.js          synthesised — no sample files
    graphics.js       quality presets, adaptive resolution, GPU readout
    touch.js          touch controls, feeding the same input state as a mouse
    settings.js       persisted handedness, sensitivity, haptics
    mobile.js         wake lock, background pause, orientation lock
sw.js                 service worker — precaches the whole shell for offline
manifest.webmanifest  install metadata
icons/                generated app icons
tools/
  verify.mjs          end-to-end checks in a real browser
  shoot.mjs           headless screenshots of the model and the game
  bundle.mjs          single-file build
  balance.mjs         unattended survivability probe
  icons.mjs           regenerates the app icons from SVG artwork
  precache.mjs        regenerates the service worker's asset list
.github/workflows/
  pages.yml           static deploy to GitHub Pages
vendor/three/         three.js r185, MIT
```

## Development

```
node tools/verify.mjs            # 81 end-to-end checks, exits non-zero on failure
node tools/shoot.mjs inspect     # renders the model from six angles into .shots/
node tools/shoot.mjs game 40     # boots the game, simulates 40 s, screenshots it
node tools/bundle.mjs            # writes dist/lynx-xm30.html, one self-contained file
node tools/shoot.mjs bundle      # smoke-tests that build: must boot with zero sub-requests
node tools/balance.mjs           # how far each difficulty gets with no player input
node tools/shoot.mjs mobile      # renders the phone layout, landscape and portrait
node tools/precache.mjs          # after changing any file the browser loads
node tools/precache.mjs --check  # fails if the precache list has drifted
```

`tools/shoot.mjs` and `tools/verify.mjs` drive a real browser through
Playwright and advance the simulation deterministically with
`window.__game.simulate(seconds)`, so results do not depend on how fast the
software renderer happens to be. Tests that exercise the controls themselves
use `window.__game.tickOnce(dt)` instead, which runs a whole frame's logic —
input included — without rendering.

The mobile checks run in a second browser context with `hasTouch` and no mouse,
and drive the real pointer handlers with synthesised touch events rather than
calling internals. The offline claim is tested by switching that context
offline and reloading — if the shell were incomplete, the reload would fail.

**After changing any file the browser loads, run `node tools/precache.mjs`.**
The service worker's asset list and cache name are generated from the tree; the
suite and the deploy workflow both fail if it has drifted, because an installed
copy would otherwise be missing files that shipped.

## Licence

MIT. three.js is bundled under its own MIT licence (`vendor/three/LICENSE`).
