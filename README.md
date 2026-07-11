# WorldForge — local deep-zoom world map builder

A from-scratch, GPU-rendered world map editor that runs locally in your browser.
Built in tested milestones rather than one throwaway file.

## Run it (Windows)

**First time:** install **Node.js LTS** once — https://nodejs.org/ (or `winget install OpenJS.NodeJS.LTS`).

- **To build a world (live editing):** double-click **`start.bat`**, then open the `http://localhost:5173` link.
- **To run it as an installable app:** double-click **`start-app.bat`** (builds + serves the production app on
  `http://localhost:4173`). Open that in Chrome/Edge and click the **Install** icon in the address bar — it gets
  its own window, an icon, and works offline after the first load.

From a terminal instead: `npm install`, then `npm run dev` (editing) or `npm run app` (installable).
Phone: the local **Network:** address is useful for same-Wi-Fi testing, but real phone install/update should use a
hosted `https://` URL. Most phone browsers will not install a PWA from `http://192.168...`.

## Install on your phone

This repo includes a GitHub Pages deploy workflow in `.github/workflows/deploy-pages.yml`.

1. Push the repo to GitHub on the `main` branch.
2. Push a change to `main`, or run the **Deploy WorldForge** workflow manually from the **Actions** tab.
3. The workflow builds `dist/` and publishes it to a `gh-pages` branch.
4. In the GitHub repo, open **Settings > Pages** and set **Build and deployment > Source** to **Deploy from a branch**,
   then select **Branch: gh-pages** and **Folder: /(root)**.
5. When GitHub shows the Pages `https://...` URL, open it on your phone.
6. Install it:
   - **Android Chrome:** menu > **Install app** or **Add to Home screen**.
   - **iPhone Safari:** Share > **Add to Home Screen**.

The installed app keeps working offline after the first successful load.

## Update the installed app

Make changes locally, then run:

```
npm run build
npm test
git add .
git commit -m "Describe the change"
git push
```

GitHub Pages publishes the `gh-pages` branch after each push to `main`. The production build generates a fresh service
worker cache, so installed copies detect the new version. When the app shows **Update ready**, tap **Reload**. If the
phone keeps showing the old version, fully close and reopen the installed app once.

This workflow avoids the GitHub Actions Pages deployment poller because that path can sit at `deployment_queued` until
it times out. If the workflow succeeds but the site URL does not update, re-check **Settings > Pages** and confirm
**Source: Deploy from a branch**, **Branch: gh-pages**, and **Folder: /(root)**.

## What it does

- **Terrain:** GPU continents, sea level, hill-shading, biome coloring; continuous deep zoom with fractal detail
  that sharpens as you zoom. World size is set in km and is genuinely bigger (more continents), not just rescaled.
- **Sculpt:** Raise / Lower / Smooth brushes; edits move the coastline and show as a coarse footprint when zoomed out.
- **Biomes:** a Biome brush paints Forest / Jungle / Grass / Savanna / Desert / Badlands / Tundra / Snow / Swamp (+ Erase).
- **Vectors (crisp at any zoom):** River / Road / Border lines, Label and Town markers, Erase.
- **Project:** auto-save (survives reloads), Save/Open `.wfmap.json` files, **Export PNG** of the view or the **whole world**.
- **Installable app (PWA):** standalone window + offline.

## Controls
- **Draw:** pick a tool, draw with stylus/mouse (a ring shows the brush size). Label/Town prompt for text.
- **Pan while a tool is active:** two-finger drag, right/middle-mouse drag, or hold **Space** and drag.
- **Pan tool / Zoom:** drag; wheel or pinch.
- **Undo/Redo:** top-right or Ctrl/⌘+Z, Shift+Ctrl+Z.
- **☰ menu** (top-right): world size, save/load, export (view or whole world), new.
- **Sea level / Relief:** sliders, top-left.

## Project layout
```
src/main.ts        bootstrap, render loop, tool routing, undo, persistence, export
src/terrain.ts     WebGL2 terrain shader (base + edit + biome + detail)
src/editlayer.ts   height edit field <-> mip-mapped R16F texture
src/biomelayer.ts  biome paint field <-> mip-mapped RGBA texture
src/brush.ts / biome.ts   pure paint ops + palette (unit-tested)
src/vectors.ts     vector store + geometry (unit-tested)
src/overlay.ts     Canvas2D vectors, world boundary, brush ring
src/storage.ts     gzip + project encode/decode + resample + IndexedDB (unit-tested)
src/menu.ts / toolbar.ts / modal.ts / interaction.ts / camera.ts / gl.ts / hud.ts
scripts/generate-sw.mjs   generates the production service worker after each build
public/            manifest.webmanifest + icons (PWA)
world-builder/     Godot 4.7 Steam-first prototype and its detailed roadmap
```

## Verify
```
npm run build   # type-check + production build
npm test        # unit tests for camera, painting, terrain, storage, tiles, and vectors
```

## Status
The browser editor's core feature set is complete, including deep tile-pyramid sculpting. Possible future browser work
includes procedural rivers, a biome legend, and true cross-device sync.

The repo also contains a separate Godot 4.7 prototype in `world-builder/` aimed at the longer-term Steam builder. Its
chunked terrain, generation, editing, and save/load foundations are implemented; buildings, roads, bridges, and the
commercial builder UX are the next phases. See `world-builder/ROADMAP.md` for the detailed plan.
