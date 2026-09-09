# THE BACKROOMS — Level 0 (sandbox)

A browser first-person liminal exploration sandbox. Three.js, procedural
geometry and textures, WebAudio. No build step, no extra libraries.

This build is **exploration only**. No story, notes, acts, or hostiles except
the Pit Arm that reaches from floor holes. Ready for a new narrative on top.

## Run

ES modules need `http://` (not `file://`):

```bash
cd backrooms
npx serve .
# or
python -m http.server 8080
```

Open the printed URL. **NEW GAME**, then click the view to lock the mouse.

Offline: `vendor/` is included (Three.js r160). No CDN required for the engine.

Add `?debug=1` to the URL for noclip (`N`) and a small debug HUD.
Add `?seed=12345` so **NEW GAME** uses that seed.

Saves use localStorage key `backrooms_save_v1` with payload `version: 3`.
Older story saves still load position/items; story fields are ignored.

## Controls

| Key | Action |
|---|---|
| `W A S D` | Move |
| Mouse | Look |
| `Shift` | Sprint |
| `C` | Crouch |
| `E` | Interact (batteries) |
| `F` | Flashlight |
| `V` | Camcorder |
| `Tab` | Inventory |
| `M` | Map |
| `Esc` | Pause (closes inventory / map first) |
| `N` | Noclip fly — **debug only** (`?debug=1`). Space up, Ctrl down, Shift faster |

## What is here

Walk the maze. Zones still change the halls (Lights-Out, Manila, Pillar Hall,
Tight Halls, Pit Pockets, Utility). Floor holes in Pit Pockets can grab you.
Batteries refill the flashlight. Record if you want. That is the loop.

## Graphics

Mono-yellow Level 0: chevron wallpaper, moist yellow carpet, T-bar acoustic
ceiling, recessed fluorescent **grid**. Rooms are almost empty (one wrong chair
at spawn; rare dead vending). **Lights-Out** pockets (~2×2 chunks): tighter
halls, sagging 2.15–2.45 m ceilings, dead fixtures, puddles, mold.
**Manila Room**: one tall (~5.5 m) pale hall, dry, table. **Pillar Hall**:
warehouse floor, ~7.5 m ceiling, column grid, dry. **Tight Halls**: 1-cell
corridors, ~2.1 m ceiling, dripping puddles. **Pit Pockets**: lobby rooms with
holes in the carpet. Linger and an arm reaches. Back away. **Utility**:
grey-green service halls, mixed 2.2 / 3.2 m ceilings, pipes, a standing-water
trench you walk through, loud buzz.
Yellow fog/fill so the maze recedes into yellow, not black.
Working fluorescents bake fill onto walls and carpet. Flashlight is the
personal punch in dark pockets. Shadows off.

Default audio is fluorescent **hum-buzz** (60/120 Hz + high whine).

## Voice

Drop files at `assets/voice/<id>.mp3` and register them in
`src/audio/VoiceSystem.js` (`VOICE_LINES`). Missing files fail silently.
The registry ships empty.

## Performance

- 3×3 chunk stream, at most one chunk meshed per frame
- Camcorder grain is low-res and throttled (~10 Hz)

## Architecture

```
src/
  core/            Random, EventBus, PlayerController
  world/           LevelGenerator, ChunkMesher, Materials, World, Zones
  entities/        Entity, PitArm
  systems/         Flashlight, Camcorder, Inventory, Interactables,
                   MapSystem, SaveSystem, Settings
  audio/           AudioSystem, VoiceSystem
  ui/              UIController
  main.js          Loop + wiring
```

Sandbox leftovers: no bundled voice mp3s; no story; no Level 1.
