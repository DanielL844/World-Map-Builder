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
2. In the GitHub repo, open **Settings > Pages** and set **Build and deployment > Source** to **GitHub Actions**.
3. Push a change to `main`, or run the **Deploy WorldForge** workflow manually from the **Actions** tab.
4. When the workflow finishes, open the Pages `https://...` URL on your phone.
5. Install it:
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

GitHub Pages rebuilds `dist/` on each push to `main`. The production build generates a fresh service worker cache, so
installed copies detect the new version. When the app shows **Update ready**, tap **Reload**. If the phone keeps showing
the old version, fully close and reopen the installed app once.

If the deploy sits at `deployment_queued` until it times out, re-check **Settings > Pages** and confirm **Source** is
**GitHub Actions**, then rerun the workflow. The workflow uses current Node 24 GitHub Actions, so Node deprecation
warnings are not expected after this update.

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
```

## Verify
```
npm run build   # type-check + production build
npm test        # 16 unit tests (camera, brush, vectors, storage, biome)
```

## Status
Core feature set is complete (M1–M6). Possible future work: deeper-than-region raw sculpt resolution
(tile-pyramid), procedural rivers, biome legend, true cross-device sync. None are required for normal use.
