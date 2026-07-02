// Shared, mutable tool state (framework-free).
export type ToolId =
  | 'pan'
  | 'raise' | 'lower' | 'smooth' | 'flatten'   // height brushes
  | 'river' | 'road' | 'border'         // vector lines
  | 'label' | 'town' | 'erase'          // tap tools
  | 'biome';                            // biome paint

export interface ToolState {
  tool: ToolId;
  brushPx: number;    // height brush radius, screen CSS px
  strength: number;   // 0..1
  borderColor: string;
  biome: number; // index into BIOMES, -1 = erase
}

export const tools: ToolState = { tool: 'raise', brushPx: 40, strength: 0.5, borderColor: '#ffcf5a', biome: 0 };

export function isBrush(t: ToolId): boolean { return t === 'raise' || t === 'lower' || t === 'smooth' || t === 'flatten'; }
export function isLineTool(t: ToolId): boolean { return t === 'river' || t === 'road' || t === 'border'; }
export function isTapTool(t: ToolId): boolean { return t === 'label' || t === 'town' || t === 'erase'; }
// Anything that should capture the pointer to draw/act instead of panning.
export function isDrawTool(t: ToolId): boolean { return isBrush(t) || isLineTool(t) || isTapTool(t) || t === 'biome'; }
