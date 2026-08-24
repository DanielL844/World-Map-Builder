import { program } from './gl';

const VERT = `#version 300 es
layout(location = 0) in vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Flat illustrative terrain. No live procedural noise: just sample the height you've drawn
// (edit texture + composited tiles) and the painted biome, color it, draw a crisp coast, and
// an optional cheap relief from the height gradient. Cheap enough for phones.
const FRAG = `#version 300 es
precision highp float;
// GLSL ES 3.00 does NOT give samplers the default float precision: they default to lowp in the
// fragment shader. Desktop and software GL silently promote everything to highp, so this only
// bites on phone GPUs -- where the height sampled out of uEdit/uAccum was being quantised to
// roughly 8 bits. Near sea level that turns a smooth field into plateaus a fraction of a metre
// apart, and the land/sea test then dithers pixel by pixel: the stippled coastline.
precision highp sampler2D;
out vec4 outColor;

uniform vec2  uRes;
uniform vec2  uOrigin;
uniform float uScale;
uniform float uSea;
uniform float uRelief;     // 0 = flat; higher = subtle shaded relief from drawn height
uniform float uBaseLand;   // default flat-plain height (blank canvas)
uniform highp sampler2D uEdit;   // region-scale height edits / baked presets
uniform float uVMax;
uniform highp sampler2D uBiome;   // painted biome color (rgb) + coverage (a)
uniform highp sampler2D uAccum;   // composited deep tile edits (screen-space)
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

  // Height above sea level, and how much it changes across one pixel. Everything below is phrased
  // in terms of these two so the shoreline behaves the same at 40 km/px and at 1 m/px.
  float d = e - uSea;
  float aa = max(fwidth(d), 1e-7);

  vec3 sea = seaColor(e);
  sea = mix(sea, bio.rgb, bio.a);                      // frozen sea ice (biome painted on polar ocean)

  vec3 ground = landColor(e);
  ground = mix(ground, bio.rgb, bio.a);                // biome paint overrides the color
  if (uRelief > 0.001) {                               // relief from the SMOOTH base only, so deep-tile
    float slope = clamp((dFdx(eS) + dFdy(eS)) * 6.0, -0.6, 0.6); // boundaries don't cast hard hillshade lines
    ground *= clamp(0.85 + slope * uRelief, 0.6, 1.05);
  }
  // Darker sand at the water's edge. A fixed 0.004 height band is a few pixels when zoomed out but
  // swallows the whole screen once a pixel is metres wide, which is why zoomed-in land went flat and
  // colourless. Track the pixel footprint instead, and never exceed the old width.
  float coast = smoothstep(0.0, clamp(aa * 2.5, 0.00015, 0.004), d);
  ground = mix(vec3(0.42, 0.37, 0.28), ground, coast * 0.6 + 0.4);

  // Analytic antialiasing of the waterline. A hard if (e < uSea) test is one sample per pixel, so any
  // wobble in the height -- filtering, quantisation, the deep-tile blur -- flips whole pixels
  // between sea and land and stipples the coast. Blending over one pixel of height change gives a
  // smooth edge at every zoom and turns residual noise into a soft rim instead of speckle.
  float land = smoothstep(-aa, aa, d);
  outColor = vec4(mix(sea, ground, land), 1.0);
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
