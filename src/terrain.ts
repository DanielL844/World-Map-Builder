import { program } from './gl';

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Flat illustrative terrain. No live procedural noise: just sample the height you've drawn
// (edit texture + composited tiles) and the painted biome, color it, draw a crisp coast, and
// an optional cheap relief from the height gradient. Cheap enough for phones.
const FRAG = `#version 300 es
precision highp float;
out vec4 outColor;

uniform vec2  uRes;
uniform vec2  uOrigin;
uniform float uScale;
uniform float uSea;
uniform float uRelief;     // 0 = flat; higher = subtle shaded relief from drawn height
uniform float uBaseLand;   // default flat-plain height (blank canvas)
uniform sampler2D uEdit;   // region-scale height edits / baked presets
uniform float uVMax;
uniform sampler2D uBiome;   // painted biome color (rgb) + coverage (a)
uniform sampler2D uAccum;   // composited deep tile edits (screen-space)
uniform float uHasAccum;

vec3 landColor(float e) {
  float t = clamp((e - uSea) / max(1.0 - uSea, 0.001), 0.0, 1.0);
  vec3 c = vec3(0.86, 0.82, 0.62);                                  // beach / sand
  c = mix(c, vec3(0.50, 0.62, 0.37), smoothstep(0.00, 0.05, t));    // green (most of the range)
  c = mix(c, vec3(0.60, 0.56, 0.40), smoothstep(0.55, 0.80, t));    // upland (only when high)
  c = mix(c, vec3(0.58, 0.54, 0.50), smoothstep(0.82, 0.93, t));    // rock (very high)
  c = mix(c, vec3(0.93, 0.94, 0.96), smoothstep(0.94, 1.00, t));    // snow (peaks)
  return c;
}
vec3 seaColor(float e) {
  float d = clamp((uSea - e) / max(uSea, 0.001), 0.0, 1.0);
  return mix(vec3(0.56, 0.74, 0.86), vec3(0.20, 0.42, 0.62), d);
}

void main() {
  vec2 scr = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y);
  vec2 w = (scr - uOrigin) / uScale;
  vec2 euv = vec2(w.x, w.y / uVMax);
  bool inDom = euv.x >= 0.0 && euv.x <= 1.0 && euv.y >= 0.0 && euv.y <= 1.0;
  float ed = inDom ? texture(uEdit, euv).r : 0.0;
  vec4 bio = inDom ? texture(uBiome, euv) : vec4(0.0);
  // Deep-tile edits (M7), blurred in screen space so tile / LOD / coverage boundaries don't
  // show as hard seams when zoomed out (9-tap gaussian over the screen-space accum).
  float edTiles = 0.0;
  if (uHasAccum > 0.5) {
    vec2 auv = gl_FragCoord.xy / uRes, px = 1.0 / uRes; float o = 2.0;
    edTiles =
      texture(uAccum, auv).r * 0.25 +
      (texture(uAccum, auv + vec2( o, 0.0) * px).r + texture(uAccum, auv + vec2(-o, 0.0) * px).r +
       texture(uAccum, auv + vec2(0.0,  o) * px).r + texture(uAccum, auv + vec2(0.0, -o) * px).r) * 0.125 +
      (texture(uAccum, auv + vec2( o,  o) * px).r + texture(uAccum, auv + vec2( o, -o) * px).r +
       texture(uAccum, auv + vec2(-o,  o) * px).r + texture(uAccum, auv + vec2(-o, -o) * px).r) * 0.0625;
  }

  float eS = clamp(uBaseLand + ed, 0.0, 1.0);          // smooth region base (no deep tiles)
  float e  = clamp(eS + edTiles, 0.0, 1.0);            // + deep-tile detail (drives color + land/sea)

  vec3 col;
  if (e < uSea) {
    col = seaColor(e);
    col = mix(col, bio.rgb, bio.a);                    // frozen sea ice (biome painted on polar ocean)
  } else {
    col = landColor(e);
    col = mix(col, bio.rgb, bio.a);                    // biome paint overrides the color
    if (uRelief > 0.001) {                             // relief from the SMOOTH base only, so deep-tile
      float slope = clamp((dFdx(eS) + dFdy(eS)) * 6.0, -0.6, 0.6); // boundaries don't cast hard hillshade lines
      col *= clamp(0.85 + slope * uRelief, 0.6, 1.05);
    }
    float coast = smoothstep(0.0, 0.004, e - uSea);    // crisp, lighter coastline
    col = mix(vec3(0.42, 0.37, 0.28), col, coast * 0.6 + 0.4);
  }
  outColor = vec4(col, 1.0);
}`;

export class Terrain {
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private vao: WebGLVertexArrayObject;
  private u: Record<string, WebGLUniformLocation | null>;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.prog = program(gl, VERT, FRAG);
    const vao = gl.createVertexArray();
    if (!vao) throw new Error('createVertexArray failed');
    gl.bindVertexArray(vao);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
    this.vao = vao;
    const loc = (n: string) => gl.getUniformLocation(this.prog, n);
    this.u = {
      res: loc('uRes'), origin: loc('uOrigin'), scale: loc('uScale'), sea: loc('uSea'),
      relief: loc('uRelief'), baseLand: loc('uBaseLand'), edit: loc('uEdit'), vmax: loc('uVMax'),
      biomeTex: loc('uBiome'), accum: loc('uAccum'), hasAccum: loc('uHasAccum'),
    };
  }

  draw(origin: [number, number], scale: number, res: [number, number], sea: number, relief: number,
       editTex: WebGLTexture, biomeTex: WebGLTexture, vMax: number,
       accumTex: WebGLTexture | null, hasAccum: boolean, baseLand: number): void {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindVertexArray(this.vao);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, editTex); gl.uniform1i(this.u.edit, 0);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, biomeTex); gl.uniform1i(this.u.biomeTex, 1);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, accumTex || editTex); gl.uniform1i(this.u.accum, 2);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1f(this.u.hasAccum, hasAccum ? 1 : 0);
    gl.uniform2f(this.u.res, res[0], res[1]);
    gl.uniform2f(this.u.origin, origin[0], origin[1]);
    gl.uniform1f(this.u.scale, scale);
    gl.uniform1f(this.u.sea, sea);
    gl.uniform1f(this.u.relief, relief);
    gl.uniform1f(this.u.baseLand, baseLand);
    gl.uniform1f(this.u.vmax, vMax);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }
}
