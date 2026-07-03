# WorldBuilder — Roadmap

A commercial 2.5D top-down world builder. Steam-first (desktop), solo-developed in Godot 4.7.
This is a living document — check items off, log decisions, and revise scope as reality hits.

> **North star:** Players build their own worlds — terrain, biomes, roads, bridges, buildings — and share them.
> **Scope rule:** When in doubt, cut. Ship the smallest version that's genuinely fun, then expand.

---

## Vision & pillars

- **The world is authored data.** A chunked tile grid + placed objects, saved to a versioned, shareable file. This is the heart of the game — everything else is a view or a tool over it.
- **Building feels good.** Snappy placement, instant undo, readable feedback. The toolset *is* the gameplay.
- **Sharing is the growth engine.** Steam Workshop for user-made worlds is a launch feature, not an afterthought. Design the save format for it from day one.
- **Performance is a feature.** Big worlds must stay smooth. Chunk streaming and batching are non-negotiable, not "later."

---

## Config decisions to confirm (do these first)

Your current `project.godot` has some defaults worth a deliberate choice:

- [ ] **Renderer — currently `Mobile`.** Fine and efficient for 2D on desktop. Only switch to **Forward+** if you need advanced 2D lighting/normal maps or ever add 3D. Decide and lock it.
- [x] **Physics — set to Godot default (resolved 2026-07-02).** You're building 2D top-down, so 3D physics is unused either way; use `Area2D`/manual grid math for placement and overlap checks.
- [x] **Language — GDScript (resolved 2026-07-02).** Fastest iteration for solo dev; reserve C#/GDExtension for hot simulation loops only if profiling later demands it.
- [ ] **Version control — make sure `.godot/` is gitignored** (it's a build cache). Commit `project.godot`, `addons/`, scenes, scripts, and assets.
- [ ] **`claudot` addon** — keep for in-editor AI help, but don't ship it in release exports (exclude from export presets).

---

## Phase 0 — Foundations
*Goal: a clean project skeleton you can build on for a year without regret.*

- [ ] Lock config decisions above.
- [x] Define folder structure: `world/` (data + chunks), `render/` (tilemap, camera), `ui/`. _(add `tools/`, `data/`, `assets/` as needed)_
- [x] Set up a `WorldConfig` Resource (world size in tiles, seed, tile size, sea level).
- [x] Autoload a single `Game` singleton for global state; avoid scattering globals.
- [ ] Adopt a coding standard (naming, one class per file) and write it into `.claude/CLAUDE.md`.

**Done when:** project opens clean, runs an empty scene, and the folder layout is committed.

---

## Phase 1 — Core world data model & rendering *(the heart — spend real time here)*
*Goal: pan/zoom across a chunked tile world that saves and loads.*

- [x] **Chunk system (finite bounded world):** fixed-size chunks across a known map extent; generated on demand, cached, streamed by camera view. `world/chunk.gd`, `world/world.gd`.
- [x] **Ground rendering** via a single `TileMapLayer` with a runtime placeholder TileSet (flat colours per biome); chunks streamed in/out around the camera. `render/world_renderer.gd`.
- [x] **Camera2D controller:** drag-pan (middle/right), WASD/arrows, zoom-to-cursor with min/max clamps, optional edge-scroll. `render/camera_controller.gd`.
- [x] **Save format v1:** versioned binary via `FileAccess.store_var` + `PackedByteArray` per chunk, `format_version` field included. `world/world_save.gd` (F5 to save).
- [x] **Load format v1** + a "New World" flow (auto-generated on launch; F9 to load).

**Done when:** you can scroll a multi-chunk world, close the app, reopen, and see the same world. _(Runs; needs a hands-on test pass in the Godot editor — see "How to run" below.)_

---

## Phase 2 — Terrain generation *(port your WorldForge work)*
*Goal: procedurally generate a believable starting world; edit it.*

- [x] Port the fractal/noise heightmap to GDScript with **domain warping** for natural coastlines. `world/terrain_generator.gd`.
- [x] Sea level → deep/shallow water, sand coast; island falloff so the bounded map is sea-ringed.
- [x] **Biome assignment** via elevation + **temperature (latitude bands)** + moisture → all 13 tile types (Whittaker-style matrix).
- [x] **Noise-based rivers** winding across low/mid land. _(True downhill/hydraulic rivers are a later upgrade needing a global pass.)_
- [x] **Terrain paint tools:** Paint (any biome), Raise/Lower (elevation ladder), Smooth (neighbour mode), radius brush + cursor. `tools/brush_tool.gd`.

**Done when:** "New World" produces varied terrain with biomes, and you can paint/reshape it. _(Runs; needs a hands-on pass in Godot.)_

**Later upgrades for this phase:** hill-shade tinting, hydraulic rivers, coastline erosion, undo/redo (moves up from Phase 4 the moment editing feels essential).

---

## Phase 3 — Placement & structures *(this is where it becomes a "builder")*
*Goal: place buildings, draw roads, span bridges — the core loop.*

- [ ] **Object layer:** a Y-sorted (`YSort`) layer above ground so buildings/props/trees overlap correctly with depth (the 2.5D effect).
- [ ] **Grid-snap building placement:** ghost preview, valid/invalid coloring, rotate, place, delete.
- [ ] **Road/path tool:** click-drag or spline; auto-connect segments; tile-based road network.
- [ ] **Bridges:** roads that remain valid over water tiles; visual transition.
- [ ] **Objects in the save format:** extend v1 to store placed objects (type, position, rotation) per chunk.

**Done when:** you can generate a world, lay roads, bridge a river, drop buildings, save, and reload it all intact.

---

## Phase 4 — Builder UX
*Goal: the tools feel professional, not like a prototype.*

- [ ] **Undo/redo stack** (command pattern) — critical for any builder; retrofitting later is painful, so add it early in this phase.
- [ ] Tool palette / toolbar + context HUD (current tool, brush size, selected object).
- [ ] Selection: click, box-select, move, delete, copy/paste.
- [ ] Minimap / world overview.
- [ ] Keybindings via Godot input map (rebindable later in Settings).

**Done when:** a first-time player can build for 10 minutes without confusion or a lost edit.

---

## Phase 5 — Sandbox depth & retention
*Goal: in a pure sandbox, retention comes from tool variety, expression, and sharing — not imposed goals.*

- [ ] **Breadth of tools & content:** more tilesets, building sets, props, decorations. In a sandbox, variety *is* the depth.
- [ ] **Quality-of-life power tools:** copy/paste regions, blueprints/stamps, symmetry & mirroring, templates — these make large builds joyful and are what sandbox players rave about.
- [ ] **Expression:** color/theme variants, decals, water and road styling.
- [ ] **Ambience (optional, high ROI for screenshots):** day/night, seasons, weather — sandbox players love a pretty world to show off.
- [ ] **Screenshot/photo mode:** clean capture and export of finished worlds — free marketing every time a player shares one.

**Done when:** playtesters keep building unprompted and want to show others what they made.

---

## Phase 6 — Sharing & Steam
*Goal: Steam-ready with the sharing loop that drives growth.*

- [ ] Harden the save format; treat world files as portable, versioned documents.
- [ ] **GodotSteam** integration: achievements, Steam Cloud saves.
- [ ] **Steam Workshop:** publish/subscribe to worlds. This is your marketing engine — prioritize it.
- [ ] Settings menu: resolution, fullscreen, keybinding, audio.

**Done when:** you can publish a world to Workshop and someone else loads it from a separate install.

---

## Phase 7 — Polish & launch
*Goal: a title people pay for.*

- [ ] Performance profiling: chunk streaming, draw-call batching, memory; set a target (e.g. 60fps on a mid GPU at your biggest world).
- [ ] Main menu, onboarding/tutorial world, save-slot management.
- [ ] Audio pass (music + SFX) — cheap way to raise perceived quality a lot.
- [ ] Steam page live **early** with capsule art + trailer to collect wishlists before launch.
- [ ] Free **demo** build; consider Steam Next Fest.
- [ ] Pay **Steam Direct fee: $100 USD (~$142 CAD)**, recoupable against your first $1,000 in sales; Valve takes 30%.

**Done when:** the store page converts, the demo is fun, and the build is stable.

---

## Cross-cutting concerns

- **Art strategy — decide make vs buy early.** Solo art is a major time sink. A cohesive top-down tileset/asset pack (Godot Asset Library, itch.io, or a paid pack) can save months; budget for it. Consistency beats quantity.
- **Performance budget.** Profile from Phase 1, not Phase 7. Chunk unloading and node reuse (pools) prevent the "it dies at big worlds" trap.
- **Testing.** Keep a set of stress-test worlds (huge, dense, edge-case rivers). Automate save/load round-trip tests.
- **Backups.** Commit often; tag milestone builds.

---

## Honest timeline

- **Vertical slice** (Phases 0–3 minimal: generate + paint + place a building + one road + save/load): **~3–6 months part-time.**
- **Commercial launch:** realistically **1.5–3 years part-time.** Scope creep is the #1 killer. Protect the vertical slice; expand only what playtesters ask for.

---

## Decisions log
*Record choices so future-you knows why.*

| Date | Decision | Reasoning |
|------|----------|-----------|
| 2026-07-02 | Engine: Godot 4.7 | Free, no royalties, best-in-class 2D, exports to Steam desktop + mobile |
| 2026-07-02 | Style: 2.5D top-down | ~10x less work than full 3D; still commercially viable |
| 2026-07-02 | Platform: Steam-first | Desktop input, monetization, Workshop |
| 2026-07-02 | Physics: Godot default (3D unused) | Building 2D top-down |
| 2026-07-02 | Language: GDScript | Fastest iteration for a solo dev |
| 2026-07-02 | The "hook": full creative sandbox | Freedom + sharing is the draw; no imposed goals |
| 2026-07-02 | World scale: finite bounded map | Simpler chunk design, known extents |
| 2026-07-02 | Art: self-made, buy/commission if blocked | Control cost, unblock when stuck |
| _TBD_ | Renderer (currently Mobile) | _decide: Mobile is fine for 2D desktop_ |

---

## Open questions

**Resolved (2026-07-02):**
1. ~~The hook~~ → **full creative sandbox.**
2. ~~World scale~~ → **finite bounded map.**
3. ~~Art~~ → **self-made; buy/commission only when blocked.**

**Still open:**
4. **Working title & Steam page timing.** An earlier page means more wishlists before launch — worth naming the game soon.

---

## How to run
1. Open the `world-builder` project in **Godot 4.7**.
2. Press **F5** (Run Project). `main.tscn` is the main scene and builds everything in code.
3. You should see a generated island with biome bands and rivers.

**Controls**

| Action | Input |
|--------|-------|
| Pan | Drag (middle/right mouse) or WASD/arrows |
| Zoom | Mouse wheel (toward cursor) |
| Paint | Left mouse (hold + drag) |
| Cycle tool (Paint/Raise/Lower/Smooth) | Q |
| Brush size | `[` and `]` |
| Pick paint tile | Number keys 1–9, 0 |
| Save / Load world | F5 / F9 |

If anything errors, it shows in Godot's Output/Debugger — paste it and I'll fix it (I can't run Godot from here, so your launch is the real test).

## Immediate next steps
1. **Run it** and confirm terrain + painting + save/load behave.
2. Confirm the **renderer** (only remaining config decision — Mobile is fine for 2D desktop).
3. **Undo/redo** is the next high-value add now that editing exists (pulled forward from Phase 4).
4. Pick a **working title** so we can stand up a Steam page early for wishlists.
