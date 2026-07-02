// Camera maps world coordinates (u, v) to screen pixels (CSS px).
//   screenX = cam.x + u * cam.scale
//   screenY = cam.y + v * cam.scale
// u is in [0, 1] across the world width; v in [0, vMax] (= heightKm / widthKm).
export interface Camera { x: number; y: number; scale: number; }
export interface WorldPoint { u: number; v: number; }

export function clamp(v: number, a: number, b: number): number {
  return v < a ? a : v > b ? b : v;
}

export function screenToWorld(cam: Camera, sx: number, sy: number): WorldPoint {
  return { u: (sx - cam.x) / cam.scale, v: (sy - cam.y) / cam.scale };
}

export function worldToScreen(cam: Camera, u: number, v: number): { x: number; y: number } {
  return { x: cam.x + u * cam.scale, y: cam.y + v * cam.scale };
}

// Zoom by `factor` while keeping the world point under (sx, sy) fixed on screen.
export function zoomAt(cam: Camera, sx: number, sy: number, factor: number, minScale: number, maxScale: number): void {
  const w = screenToWorld(cam, sx, sy);
  cam.scale = clamp(cam.scale * factor, minScale, maxScale);
  cam.x = sx - w.u * cam.scale;
  cam.y = sy - w.v * cam.scale;
}
