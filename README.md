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
| `H` / `P` | Controls / pause |

Hitting an obstacle costs mobility and hull; a slower vehicle hits softer.
Score rewards engaging a shooter **before it fires at you**, identifying it
first, and taking it at range.

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
tools/
  verify.mjs          end-to-end checks in a real browser
  shoot.mjs           headless screenshots of the model and the game
  bundle.mjs          single-file build
  balance.mjs         unattended survivability probe
vendor/three/         three.js r185, MIT
```

## Development

```
node tools/verify.mjs            # 33 end-to-end checks, exits non-zero on failure
node tools/shoot.mjs inspect     # renders the model from six angles into .shots/
node tools/shoot.mjs game 40     # boots the game, simulates 40 s, screenshots it
node tools/bundle.mjs            # writes dist/lynx-xm30.html, one self-contained file
node tools/shoot.mjs bundle      # smoke-tests that build: must boot with zero sub-requests
node tools/balance.mjs           # how far each difficulty gets with no player input
```

`tools/shoot.mjs` and `tools/verify.mjs` drive a real browser through
Playwright and advance the simulation deterministically with
`window.__game.simulate(seconds)`, so results do not depend on how fast the
software renderer happens to be.

## Licence

MIT. three.js is bundled under its own MIT licence (`vendor/three/LICENSE`).
