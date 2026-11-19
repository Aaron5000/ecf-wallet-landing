/* ECF artwork: a ray-marched 3D key dithered to ASCII blocks, and a layered Ethereum landscape.
   The key is a signed-distance model (bow, trefoil holes, spokes, ETH hub relief, collars, shaft,
   bevelled bit) lit in a WebGL fragment shader at character-cell resolution: four sub-samples per
   cell are thresholded against a Bayer matrix into quadrant blocks, coloured white / cyan / blue by
   light. It tumbles in from the dark, lands at the classic tilt, then rolls slowly on its long axis
   and leans toward the pointer. Without WebGL the original flat procedural key is drawn instead. */
(() => {
  "use strict";
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

  // The ASCII set's eight colours (imagery.py PAL); blue lifted a touch so it reads on screens.
  const PAL = {
    w: "#ffffff", r: "#ff2d2d", g: "#00ff00", c: "#00ffff",
    y: "#ffff00", m: "#ff00ff", b: "#2a2aff", o: "#ff8000",
  };
  // Quadrant / half blocks drawn as rects so they tile without seams. Bits: 1 TL, 2 TR, 4 BL, 8 BR.
  const QUAD = {
    "▘": 1, "▝": 2, "▀": 3, "▖": 4, "▌": 5, "▞": 6, "▛": 7, "▗": 8,
    "▚": 9, "▐": 10, "▜": 11, "▄": 12, "▙": 13, "▟": 14, "█": 15,
  };
  // Halftone dot glyphs: radius as a fraction of the cell width, two dots per cell.
  const DOTS = { "·": 0.16, "∘": 0.24, "•": 0.32, "●": 0.42 };
  const FONT_STACK = 'Menlo, "SF Mono", "DejaVu Sans Mono", Consolas, "Liberation Mono", monospace';
  const KEY_GLYPHS = [" ", "▘", "▝", "▀", "▖", "▌", "▞", "▛", "▗", "▚", "▐", "▜", "▄", "▙", "▟", "█"];
  const KEY_BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map(n => n / 16 + 1 / 32);
  const KEY_FPS = 24;
  const KEY_LOOP = 12;            // seconds per roll of the 3D key
  const KEY_TILT = 36 * Math.PI / 180;   // 3D key: y up, bow lower left, bit upper right
  const KEY_REVEAL = 2200;        // ms for the tumble-in
  const KEY_REGIONS = [[-650, -290, -180, 180], [-300, 621, -62, 62], [395, 585, 20, 150]];
  const keyTube = (distance, radius, base, strength) =>
    base + strength * Math.sqrt(Math.max(0, 1 - (distance / radius) ** 2));


  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const ease = v => { v = clamp(v, 0, 1); return v * v * (3 - 2 * v); };

  // Original projected diamond outline, in source cells (Y doubled for square units).
  const diamondHull = [[160, 9.83], [196.02, 48.47], [160, 71.67], [121.52, 44.74]]
    .map(([x, y]) => [x, y * 2]);
  function withinDiamond(x, y) {
    y *= 2;
    let inside = false;
    for (let i = 0, j = diamondHull.length - 1; i < diamondHull.length; j = i++) {
      const [ax, ay] = diamondHull[j], [bx, by] = diamondHull[i];
      const dx = bx - ax, dy = by - ay;
      const along = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
      if (Math.hypot(x - ax - along * dx, y - ay - along * dy) <= 1.25) return true;
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) inside = !inside;
    }
    return inside;
  }

  function decode(p) {
    const n = p.cols * p.rows;
    const chars = new Array(n).fill(" ");
    for (let y = 0; y < p.rows; y++) {
      const row = p.chars[y];
      for (let x = 0; x < row.length; x++) chars[y * p.cols + x] = row[x];
    }
    const colors = new Array(n);
    let i = 0;
    const re = /([a-z_])(\d+)/g;
    let m;
    while ((m = re.exec(p.color))) {
      for (let j = +m[2]; j > 0; j--) colors[i++] = m[1];
    }
    const cells = [];
    for (let k = 0; k < n; k++) if (chars[k] !== " ") cells.push(k);
    return { cols: p.cols, rows: p.rows, chars, colors, cells: Uint32Array.from(cells) };
  }


  // ---------------------------------------------------------------- 3D key (WebGL ray marcher)
  // World units are the 1920x1200 artwork pixels with the origin at the centre, y up, camera on +z.
  const KEY_FRAG = `#version 300 es
precision highp float;
uniform vec2 u_grid;      // cols, rows
uniform mat3 u_rot;       // world -> key space (orthonormal)
uniform vec3 u_pos;       // key origin in world space
uniform float u_expo;     // exposure 0..1
out vec4 o;
const float EYE = 3000.0;
const vec3 L1 = normalize(vec3(-0.42, 0.52, 0.74));   // key light: upper left, in front
const vec3 L2 = normalize(vec3(0.70, -0.25, 0.45));   // fill: lower right
const float B[16] = float[16](0.03125, 0.53125, 0.15625, 0.65625, 0.78125, 0.28125, 0.90625, 0.40625,
                              0.21875, 0.71875, 0.09375, 0.59375, 0.96875, 0.46875, 0.84375, 0.34375);

float sdBox(vec3 p, vec3 h) { vec3 q = abs(p) - h; return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0); }
float sdBox2(vec2 p, vec2 h) { vec2 q = abs(p) - h; return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0); }
// a 2D shape (distance d2) extruded to half thickness hz with rounded edges rr
float extrude(float d2, float z, float hz, float rr) {
  vec2 q = vec2(d2 + rr, abs(z) - hz + rr);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}
float sdCylX(vec3 p, float h, float r, float rr) {           // rounded cylinder along x, half length h
  vec2 q = vec2(length(p.yz) - r + rr, abs(p.x) - h + rr);
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - rr;
}
float sdCapsuleX(vec3 p, float x0, float x1, float r) { p.x -= clamp(p.x, x0, x1); return length(p) - r; }
float sdKite(vec2 p) {                                       // ETH silhouette: apex (0,58), waist y=-10 half width 36, foot (0,-58)
  p.x = abs(p.x);
  vec2 a = vec2(0.0, 58.0), b = vec2(36.0, -10.0), c = vec2(0.0, -58.0);
  vec2 e1 = b - a, e2 = c - b;
  float d1 = ((p.y - a.y) * e1.x - (p.x - a.x) * e1.y) / length(e1);   // signed distance, >0 outside
  float d2 = ((p.y - b.y) * e2.x - (p.x - b.x) * e2.y) / length(e2);
  return max(d1, d2);
}

float map(vec3 p) {
  // bow: rounded flat ring, hub with a raised ETH mark, three spokes, three trefoil holes
  vec2 c = p.xy - vec2(-470.0, 0.0);
  float r = length(c);
  float d = extrude(abs(r - 144.0) - 36.0, p.z, 16.0, 8.0);
  d = min(d, extrude(r - 60.0, p.z, 14.0, 6.0));
  d = min(d, extrude(sdKite(c), p.z, 21.0, 4.0));
  for (int k = 0; k < 3; k++) {
    float a = radians(30.0 + 120.0 * float(k));
    vec2 q = vec2(cos(a) * c.x + sin(a) * c.y, -sin(a) * c.x + cos(a) * c.y);
    d = min(d, extrude(sdBox2(q - vec2(84.0, 0.0), vec2(40.0, 9.0)), p.z, 12.0, 5.0));
  }
  float holes = min(min(length(c - vec2(0.0, 142.0)), length(c - vec2(-122.98, -71.0))), length(c - vec2(122.98, -71.0))) - 24.0;
  d = max(d, -holes);
  // collars and shaft
  d = min(d, sdCylX(p - vec3(-270.0, 0.0, 0.0), 30.0, 54.0, 7.0));
  d = min(d, sdCylX(p - vec3(-227.0, 0.0, 0.0), 13.0, 44.0, 5.0));
  d = min(d, sdCapsuleX(p, -300.0, 585.0, 32.0));
  // bit: a bevelled plate with four notches cut from the top
  float bit = sdBox(p - vec3(490.0, 85.0, 0.0), vec3(92.0, 62.0, 7.0)) - 3.0;
  float n = sdBox2(p.xy - vec2(437.5, 130.0), vec2(17.5, 40.0));
  n = min(n, sdBox2(p.xy - vec2(495.0, 102.5), vec2(15.0, 67.5)));
  n = min(n, sdBox2(p.xy - vec2(547.5, 130.0), vec2(12.5, 40.0)));
  n = min(n, sdBox2(p.xy - vec2(402.5, 110.0), vec2(7.5, 60.0)));
  bit = max(bit, -n);
  return min(d, bit);
}
vec3 normal(vec3 p) {
  const vec2 e = vec2(0.7, -0.7);
  return normalize(e.xyy * map(p + e.xyy) + e.yyx * map(p + e.yyx) + e.yxy * map(p + e.yxy) + e.xxx * map(p + e.xxx));
}
float shadow(vec3 ro, vec3 rd) {
  float res = 1.0, t = 6.0;
  for (int i = 0; i < 40; i++) {
    float h = map(ro + rd * t);
    if (h < 0.4) return 0.0;
    res = min(res, 10.0 * h / t);
    t += clamp(h, 3.0, 50.0);
    if (t > 1400.0) break;
  }
  return clamp(res, 0.0, 1.0);
}
float occlusion(vec3 p, vec3 n) {
  float occ = 0.0, sca = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 7.0 * float(i);
    occ += (h - map(p + n * h)) * sca;
    sca *= 0.65;
  }
  return clamp(1.0 - occ / 45.0, 0.0, 1.0);
}
// light reaching the camera from the sub-sample at artwork position (px, py); 0 = background
float trace(vec2 px) {
  vec3 eye = vec3(0.0, 0.0, EYE);
  vec3 rdw = normalize(vec3(px, -EYE));
  vec3 ro = u_rot * (eye - u_pos);
  vec3 rd = u_rot * rdw;
  // bounding sphere of the key in key space
  vec3 oc = ro - vec3(-15.0, 0.0, 0.0);
  float b = dot(oc, rd), cc = dot(oc, oc) - 720.0 * 720.0;
  float disc = b * b - cc;
  if (disc < 0.0) return 0.0;
  float t = max(0.0, -b - sqrt(disc)), tmax = -b + sqrt(disc);
  bool hit = false;
  for (int i = 0; i < 110; i++) {
    float h = map(ro + rd * t);
    if (h < 0.45) { hit = true; break; }
    t += h;
    if (t > tmax) break;
  }
  if (!hit) return 0.0;
  vec3 p = ro + rd * t;
  vec3 n = normal(p);
  vec3 nw = n * u_rot;                                      // key space -> world
  vec3 l1 = u_rot * L1, l2 = u_rot * L2;
  float sh = shadow(p + n * 1.5, l1);
  float ao = occlusion(p, n);
  float diff = max(dot(n, l1), 0.0) * sh;
  float fill = max(dot(n, l2), 0.0);
  float spec = pow(max(dot(nw, normalize(L1 - rdw)), 0.0), 36.0) * sh;
  float rim = pow(1.0 - max(dot(nw, -rdw), 0.0), 3.0);
  float light = 0.10 * ao + 0.72 * diff + 0.22 * fill * ao + 0.55 * spec + 0.22 * rim * ao;
  return clamp(light * u_expo, 0.0, 1.0);
}
void main() {
  int x = int(gl_FragCoord.x);
  int y = int(u_grid.y) - 1 - int(gl_FragCoord.y);          // rows count from the top
  float sx = 1920.0 / u_grid.x, sy = 1200.0 / u_grid.y;
  int bx = (x * 2) & 3, by = (y * 2) & 3;
  int mask = 0, hits = 0;
  float sum = 0.0;
  for (int j = 0; j < 2; j++) for (int i = 0; i < 2; i++) {
    vec2 px = vec2((float(x) + 0.25 + 0.5 * float(i)) * sx - 960.0, 600.0 - (float(y) + 0.25 + 0.5 * float(j)) * sy);
    float l = trace(px);
    if (l <= 0.0) continue;
    hits++; sum += l;
    if (l > B[((by + j) & 3) * 4 + ((bx + i) & 3)]) mask |= 1 << (j * 2 + i);
  }
  float mean = hits > 0 ? sum / float(hits) : 0.0;
  int cls = mask == 0 ? 0 : mean >= 0.74 ? 3 : mean >= 0.42 ? 2 : 1;
  o = vec4(float(mask) / 255.0, float(cls) / 255.0, mean, 1.0);
}`;
  const KEY_VERT = `#version 300 es
void main() { vec2 v = vec2(gl_VertexID == 1 ? 3.0 : -1.0, gl_VertexID == 2 ? 3.0 : -1.0); gl_Position = vec4(v, 0.0, 1.0); }`;

  class KeyGL {
    constructor(cols, rows) {
      const canvas = document.createElement("canvas");
      canvas.width = cols; canvas.height = rows;
      const gl = canvas.getContext("webgl2", { antialias: false, alpha: false, depth: false, stencil: false,
        premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: "low-power" });
      if (!gl) throw new Error("WebGL2 unavailable");
      const compile = (type, src) => {
        const sh = gl.createShader(type);
        gl.shaderSource(sh, src); gl.compileShader(sh);
        if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) || "shader");
        return sh;
      };
      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl.VERTEX_SHADER, KEY_VERT));
      gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, KEY_FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) || "link");
      gl.useProgram(prog);
      gl.bindVertexArray(gl.createVertexArray());
      gl.viewport(0, 0, cols, rows);
      gl.uniform2f(gl.getUniformLocation(prog, "u_grid"), cols, rows);
      this.u = { rot: gl.getUniformLocation(prog, "u_rot"), pos: gl.getUniformLocation(prog, "u_pos"),
        expo: gl.getUniformLocation(prog, "u_expo") };
      this.gl = gl; this.cols = cols; this.rows = rows;
      this.pixels = new Uint8Array(cols * rows * 4);
      this.lost = false;
      canvas.addEventListener("webglcontextlost", e => { e.preventDefault(); this.lost = true; });
    }

    // rot: 9 numbers, row-major world->key; pos: [x, y, z]
    render(rot, pos, expo) {
      const gl = this.gl;
      if (this.lost || gl.isContextLost()) return null;
      gl.uniformMatrix3fv(this.u.rot, true, rot);
      gl.uniform3f(this.u.pos, pos[0], pos[1], pos[2]);
      gl.uniform1f(this.u.expo, expo);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.readPixels(0, 0, this.cols, this.rows, gl.RGBA, gl.UNSIGNED_BYTE, this.pixels);
      return this.pixels;
    }
  }

  // Rotation helpers (row-major 3x3).
  const matMul = (A, Bm) => {
    const M = new Array(9);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++)
      M[i * 3 + j] = A[i * 3] * Bm[j] + A[i * 3 + 1] * Bm[3 + j] + A[i * 3 + 2] * Bm[6 + j];
    return M;
  };
  const rotX = a => [1, 0, 0, 0, Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a)];
  const rotY = a => [Math.cos(a), 0, Math.sin(a), 0, 1, 0, -Math.sin(a), 0, Math.cos(a)];
  const rotZ = a => [Math.cos(a), -Math.sin(a), 0, Math.sin(a), Math.cos(a), 0, 0, 0, 1];
  const transpose = M => [M[0], M[3], M[6], M[1], M[4], M[7], M[2], M[5], M[8]];
  const easeOutCubic = v => 1 - Math.pow(1 - clamp(v, 0, 1), 3);
  const backOut = (v, k = 1.4) => { v = clamp(v, 0, 1) - 1; return 1 + v * v * ((k + 1) * v + k); };

  class ArtCanvas {
    constructor(el, art) {
      this.el = el;
      this.art = art;
      this.ctx = el.getContext("2d");
      if (!this.ctx) throw new Error("Canvas unavailable");
      this.figure = el.closest(".support-art");
      this.landscape = el.dataset.art === "ethscape";
      this.scale = clamp(Number(el.dataset.scale) || 1, 0.5, 1);
      this.fit = el.dataset.fit === "cover" ? "cover" : "contain";
      const f = (el.dataset.focus || "0.5 0.5").split(/\s+/).map(Number);
      this.fx = Number.isFinite(f[0]) ? clamp(f[0], 0, 1) : 0.5;
      this.fy = Number.isFinite(f[1]) ? clamp(f[1], 0, 1) : 0.5;
      this.setState("idle"); // idle -> revealing -> done
      this.keyGL = null;
      this.pointer = { x: 0, y: 0, tx: 0, ty: 0 };
      if (!this.landscape) {
        try { this.keyGL = new KeyGL(art.cols, art.rows); } catch (e) { this.keyGL = null; console.warn("3D key unavailable:", e.message); }
        if (this.figure && window.matchMedia("(hover: hover)").matches) {
          this.figure.addEventListener("pointermove", e => {
            const r = this.figure.getBoundingClientRect();
            if (!r.width || !r.height) return;
            this.pointer.tx = clamp((e.clientX - r.left) / r.width * 2 - 1, -1, 1);
            this.pointer.ty = clamp((e.clientY - r.top) / r.height * 2 - 1, -1, 1);
          });
          this.figure.addEventListener("pointerleave", () => { this.pointer.tx = 0; this.pointer.ty = 0; });
        }
      }
      this.visible = false;
      this.ambientTime = 0;
      this.ambientStamp = 0;
      this.elapsed = 0;
      this.lastFrame = 0;
    }

    setState(state) {
      this.state = this.el.dataset.state = state;
    }

    layout() {
      const w = this.el.clientWidth;
      const h = this.el.clientHeight;
      if (!w || !h) return false;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const W = Math.round(w * dpr);
      const H = Math.round(h * dpr);
      if (W === this.W && H === this.H) return false;
      if (this.el.width !== W) this.el.width = W;
      if (this.el.height !== H) this.el.height = H;
      const { cols, rows } = this.art;
      const sx = w / cols;
      const sy = h / (rows * 2); // cells are 1:2
      const cw = (this.fit === "cover" ? Math.max(sx, sy) : Math.min(sx, sy)) * this.scale;
      const aw = cols * cw;
      const ah = rows * cw * 2;
      let ox, oy;
      if (this.fit === "cover") {
        ox = aw > w ? clamp(w / 2 - this.fx * aw, w - aw, 0) : (w - aw) / 2;
        oy = ah > h ? clamp(h / 2 - this.fy * ah, h - ah, 0) : (h - ah) / 2;
      } else {
        ox = (w - aw) / 2;
        oy = (h - ah) / 2;
      }
      this.dpr = dpr;
      this.W = W;
      this.H = H;
      this.cw = cw * dpr;
      this.ch = this.cw * 2;
      this.ox = ox * dpr;
      this.oy = oy * dpr;
      // Smaller scenes need less stroke reinforcement to keep the hills from merging.
      this.detail = clamp((w - 400) / 150, 0, 1);
      this.font = `bold ${(this.ch * (this.landscape ? 0.88 + this.detail * 0.04 : 0.82)).toFixed(2)}px ${FONT_STACK}`;
      this.lw = Math.max(dpr * (this.landscape ? 0.4 + this.detail * 0.2 : 0.45), this.cw * 0.19);
      const x0 = Math.max(0, Math.floor(-this.ox / this.cw));
      const x1 = Math.min(cols, Math.ceil((W - this.ox) / this.cw));
      const y0 = Math.max(0, Math.floor(-this.oy / this.ch));
      const y1 = Math.min(rows, Math.ceil((H - this.oy) / this.ch));
      const vis = [];
      for (const k of this.art.cells) {
        const x = k % cols;
        const y = (k / cols) | 0;
        if (x >= x0 && x < x1 && y >= y0 && y < y1) vis.push(k);
      }
      this.cells = Uint32Array.from(vis);
      if (this.landscape) {
        this.prepareCells();
        this.cacheArt();
      } else {
        this.prepareKeyGrid(x0, x1, y0, y1);
        this.duration = this.keyGL ? KEY_REVEAL : 1600;
      }
      return true;
    }

    prep(ctx = this.ctx) {
      ctx.font = this.font;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineCap = "square";
      ctx.lineWidth = this.lw;
    }

    bounds(k) {
      const cols = this.art.cols;
      const x = k % cols;
      const y = (k / cols) | 0;
      return [
        Math.round(this.ox + x * this.cw),
        Math.round(this.oy + y * this.ch),
        Math.round(this.ox + (x + 1) * this.cw),
        Math.round(this.oy + (y + 1) * this.ch),
      ];
    }

    glyph(c, X0, Y0, X1, Y1, ctx = this.ctx) {
      const q = QUAD[c];
      if (q) {
        const mx = Math.round((X0 + X1) / 2);
        const my = Math.round((Y0 + Y1) / 2);
        if (q & 1) ctx.fillRect(X0, Y0, mx - X0, my - Y0);
        if (q & 2) ctx.fillRect(mx, Y0, X1 - mx, my - Y0);
        if (q & 4) ctx.fillRect(X0, my, mx - X0, Y1 - my);
        if (q & 8) ctx.fillRect(mx, my, X1 - mx, Y1 - my);
        return;
      }
      const w = X1 - X0;
      const h = Y1 - Y0;
      const d = DOTS[c];
      if (d) {
        const r = Math.max(0.6, d * w);
        const cx = X0 + w / 2;
        ctx.beginPath();
        ctx.arc(cx, Y0 + h * 0.25, r, 0, 6.2832);
        ctx.arc(cx, Y0 + h * 0.75, r, 0, 6.2832);
        ctx.fill();
        return;
      }
      const lw = this.lw;
      switch (c) {
        case "-":
        case "_":
        case "─":
        case "━": {
          const t = Math.max(1, Math.round(c === "━" ? lw * 2 : lw));
          ctx.fillRect(X0, c === "_" ? Y1 - t : Math.round((Y0 + Y1 - t) / 2), w, t);
          return;
        }
        case "|":
        case "│":
        case "┃": {
          const t = Math.max(1, Math.round(c === "┃" ? lw * 2 : lw));
          ctx.fillRect(Math.round((X0 + X1 - t) / 2), Y0, t, h);
          return;
        }
        case "/":
        case "╱":
          ctx.beginPath();
          ctx.moveTo(X0, Y1);
          ctx.lineTo(X1, Y0);
          ctx.stroke();
          return;
        case "\\":
        case "╲":
          ctx.beginPath();
          ctx.moveTo(X0, Y0);
          ctx.lineTo(X1, Y1);
          ctx.stroke();
          return;
        default:
          ctx.fillText(c, X0 + w / 2, Y0 + h / 2);
          if (this.landscape && this.detail > 0 && /[#@%*+]/.test(c)) {
            ctx.lineWidth = this.dpr * 0.22 * this.detail;
            ctx.strokeText(c, X0 + w / 2, Y0 + h / 2);
            ctx.lineWidth = this.lw;
          }
      }
    }

    prepareCells() {
      const { cols, rows, colors } = this.art;
      let minAxis = Infinity, maxAxis = -Infinity;
      this.paintCells = Array.from(this.cells, k => {
        const x = k % cols, y = Math.floor(k / cols);
        const u = x / cols, v = y / rows;
        const diamond = this.landscape && withinDiamond(x + 0.5, y + 0.5);
        const water = v >= 0.74 && u > 0.20 && u < 0.81;
        const region = diamond ? "diamond" : water ? "water" : v < 0.48 ? "sky" : "shore";
        const axis = x - y * 2;
        minAxis = Math.min(minAxis, axis);
        maxAxis = Math.max(maxAxis, axis);
        return { k, x, y, u, v, axis, region, color: PAL[colors[k]] || PAL.w, bounds: this.bounds(k) };
      });
      for (const cell of this.paintCells) {
        cell.axis = (cell.axis - minAxis) / Math.max(1, maxAxis - minAxis);
        if (!this.landscape) cell.delay = cell.axis * 1050;
        else if (cell.region === "diamond") cell.delay = Math.max(0, cell.v - 0.075) * 750;
        else if (cell.region === "water") cell.delay = 1050 + (cell.v - 0.74) * 1600;
        else if (cell.region === "sky") cell.delay = 650 + cell.u * 380;
        else cell.delay = 550 + Math.abs(cell.u - 0.5) * 850 + cell.v * 180;
      }
      this.duration = this.landscape ? Math.max(0, ...this.paintCells.map(c => c.delay)) + 480 : 1450;
      this.water = this.paintCells.filter(c => c.region === "water" && (c.x + c.y) % 2 === 0);
      const starAreas = new Map();
      for (const cell of this.paintCells) {
        if (cell.region !== "sky" || cell.v >= 0.44 || !/[·.:+]/.test(this.art.chars[cell.k])) continue;
        const area = `${Math.floor(cell.x / 10)},${Math.floor(cell.y / 4)}`;
        if (!starAreas.has(area)) starAreas.set(area, cell);
      }
      const stars = [...starAreas.values()];
      const stride = Math.max(1, Math.ceil(stars.length / 30));
      this.stars = stars.filter((_, i) => i % stride === 0);
    }

    layer() {
      const canvas = document.createElement("canvas");
      canvas.width = this.W;
      canvas.height = this.H;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas unavailable");
      this.prep(ctx);
      return { canvas, ctx };
    }

    paint(cell, ctx, color = cell.color) {
      ctx.fillStyle = ctx.strokeStyle = color;
      this.glyph(this.art.chars[cell.k], ...cell.bounds, ctx);
    }

    cacheArt() {
      this.base = this.layer();
      this.scene = this.landscape ? this.layer() : null;
      this.diamond = this.landscape ? this.layer() : null;
      for (const cell of this.paintCells) {
        this.paint(cell, this.base.ctx);
        if (this.landscape) this.paint(cell, cell.region === "diamond" ? this.diamond.ctx : this.scene.ctx);
      }
    }

    drawAll() {
      if (!this.landscape) { this.drawKeyFrame("still", 0, true); return; }
      this.ctx.globalAlpha = 1;
      this.ctx.clearRect(0, 0, this.W, this.H);
      this.ctx.drawImage(this.base.canvas, 0, 0);
    }

    prepareKeyGrid(x0, x1, y0, y1) {
      const { cols, rows } = this.art;
      const sx = 1920 / cols, sy = 1200 / rows;
      this.keyGrid = [];
      this.keyRows = Array.from({ length: y1 - y0 }, () => ({ left: x1, right: x0 }));
      this.keyBounds = { x0, x1, y0, y1, sx, sy, stride: x1 - x0 };
      for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
        const k = y * cols + x;
        const bx = (x * 2) & 3, by = (y * 2) & 3;
        this.keyGrid.push({ k, bounds: this.bounds(k),
          x: (x + 0.25) * sx - 980, y: (y + 0.25) * sy - 610,
          thresholds: [KEY_BAYER[by * 4 + bx], KEY_BAYER[by * 4 + ((bx + 1) & 3)],
            KEY_BAYER[((by + 1) & 3) * 4 + bx], KEY_BAYER[((by + 1) & 3) * 4 + ((bx + 1) & 3)]] });
      }
      this.keySampleX = sx / 2;
      this.keySampleY = sy / 2;
      this.lastKeyFrame = null;
    }

    // The original scene_key geometry, sampled afresh before ordered ASCII dithering.
    keyLight(u, v, pose) {
      if (u < -655 || u > 625 || v < -185 || v > 185) return 0;
      let light = 0;
      const rr = Math.hypot(u + 470, v);
      const ring = rr < 180 && rr > 108;
      if (ring) light = keyTube(Math.abs(rr - 144), 36, 0.3, 0.6);
      // Trefoil openings cut the bow before the central hub and shaft are added.
      if ((u + 470) ** 2 + (v - 142) ** 2 < 576 ||
          (u + 592.9756) ** 2 + (v + 71) ** 2 < 576 ||
          (u + 347.0244) ** 2 + (v + 71) ** 2 < 576) light = 0;
      if (rr < 60) light = keyTube(rr, 60, 0.35, 0.55);
      if (u > -300 && u < -240 && Math.abs(v) < 62) light = keyTube(Math.abs(v), 62, 0.35, 0.6);
      if (u > -240 && u < -215 && Math.abs(v) < 48) light = keyTube(Math.abs(v), 48, 0.3, 0.55);
      const shaft = u > -300 && u < 585 && Math.abs(v) < 36;
      if (shaft) light = keyTube(Math.abs(v + 6 - pose.lightShift), 42, 0.28, 0.62);
      if ((u - 585) ** 2 + v * v < 1296) light = keyTube(Math.hypot(u - 585, v + 6 - pose.lightShift), 42, 0.28, 0.62);
      if (u > 395 && u < 585 && v >= 20 && v < 150)
        light = 0.42 + 0.35 * clamp((150 - v) / 130, 0, 1) + 0.1 * clamp((u - 395) / 190, 0, 1);
      if (v < 150 && ((u > 420 && u < 455 && v > 90) || (u > 480 && u < 510 && v > 35) ||
          (u > 535 && u < 560 && v > 90) || (u > 395 && u < 410 && v > 50))) light = 0;
      if (shaft && Math.abs(v + 16 - pose.lightShift) < 5) light = Math.min(1, light + 0.3);
      if (ring && Math.abs(rr - 158) < 5 && v < 0) light = Math.min(1, light + 0.25);
      if (light > 0) {
        const gleam = Math.max(0, 1 - Math.abs(u - pose.gleam) / 65);
        light = Math.min(1, light * pose.light + gleam * gleam * 0.35);
      }
      return light;
    }

    keySample(x, y, pose) {
      y -= pose.drop;
      // Inverse perspective projection of the procedural face; no canvas/sprite transform.
      const a = pose.a - x * pose.zx, b = pose.b - x * pose.zy;
      const c = pose.c - y * pose.zx, d = pose.d - y * pose.zy;
      const determinant = a * d - b * c;
      return this.keyLight((x * d - y * b) / determinant, (y * a - x * c) / determinant, pose);
    }

    // Pose of the 3D key: world = Rz(tilt) Rx(pitch) Ry(yaw) Rx(roll) key, key centre at `at`.
    keyPose3D(kind, seconds) {
      let tilt = KEY_TILT, yaw = 0, pitch = 0, roll = 0, expo = 1;
      const at = [0, 0, 0];
      if (kind === "drop") {
        const k = clamp(seconds / (this.duration / 1000), 0, 1);
        const e = easeOutCubic(k);
        const er = backOut(k, 0.9);
        roll = (1 - er) * 3 * Math.PI;
        yaw = (1 - e) * -1.25;
        pitch = (1 - e) * 0.55;
        tilt += (1 - e) * 0.5;
        at[0] = (1 - e) * -260; at[1] = (1 - e) * 140; at[2] = -(1 - e) * 7000;
        expo = clamp(k / 0.3, 0, 1);
      } else if (kind === "loop") {
        // one roll per loop, lingering face-on and flipping quickly through edge-on
        const th = 2 * Math.PI * (seconds % KEY_LOOP) / KEY_LOOP;
        roll = th - 0.42 * Math.sin(2 * th);
        yaw = 0.10 * Math.sin(2 * Math.PI * seconds / 6) + this.pointer.x * 0.26;
        pitch = 0.06 * Math.sin(2 * Math.PI * seconds / 12 + 1) + this.pointer.y * 0.18;
      }
      const R = matMul(matMul(rotZ(tilt), rotX(pitch)), matMul(rotY(yaw), rotX(roll)));
      // key origin = centre - R * (-15, 0, 0)
      const pos = [at[0] + R[0] * 15, at[1] + R[3] * 15, at[2] + R[6] * 15];
      return { rot: transpose(R), pos, expo };
    }

    drawKeyFrame3D(kind, seconds, tag) {
      const pose = this.keyPose3D(kind, seconds);
      const px = this.keyGL.render(pose.rot, pose.pos, pose.expo);
      if (!px) { this.keyGL = null; return false; }
      const ctx = this.ctx;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.W, this.H);
      const { cols, rows } = this.art;
      const b = this.keyBounds;
      let checksum = 2166136261, occupied = 0, color = -1;
      for (let y = b.y0; y < b.y1; y++) {
        const base = (rows - 1 - y) * cols * 4;             // readPixels rows run bottom-up
        for (let x = b.x0; x < b.x1; x++) {
          const k = y * cols + x;
          const mask = px[base + x * 4];
          if (!mask) continue;
          const cls = px[base + x * 4 + 1];
          if (cls !== color) { color = cls; ctx.fillStyle = cls >= 3 ? PAL.w : cls === 2 ? PAL.c : PAL.b; }
          this.glyph(KEY_GLYPHS[mask], ...this.keyGrid[(y - b.y0) * b.stride + x - b.x0].bounds);
          checksum = Math.imul(checksum ^ (k * 16 + mask), 16777619) >>> 0;
          occupied++;
        }
      }
      this.el.dataset.frame = tag;
      this.el.dataset.glyphChecksum = checksum.toString(16);
      this.el.dataset.glyphCount = String(occupied);
      return true;
    }

    drawKeyFrame(kind, time, force = false) {
      const frame = kind === "still" ? 0 : Math.floor(time * KEY_FPS / 1000);
      const tag = `${kind}:${kind === "loop" ? frame % (KEY_FPS * 12) : frame}`;
      if (!force && tag === this.lastKeyFrame) return;
      this.lastKeyFrame = tag;
      const seconds = frame / KEY_FPS;
      if (this.keyGL && this.drawKeyFrame3D(kind, seconds, tag)) return;
      let angle = -KEY_TILT, pitch = 0, yaw = 0, drop = 0, gleam = -1000;
      if (kind === "drop") {
        const progress = clamp(seconds / (this.duration / 1000), 0, 1);
        const falling = clamp(progress / 0.7, 0, 1);
        const settling = clamp((progress - 0.7) / 0.3, 0, 1);
        const remaining = 1 - falling * falling;
        drop = -1130 * remaining - Math.sin(settling * Math.PI) * (1 - settling) * 26;
        angle -= remaining * 8 * Math.PI / 180;
        pitch = remaining * -0.32;
        yaw = remaining * 0.25;
      } else if (kind === "loop") {
        const phase = seconds % 12 / 12 * Math.PI * 2;
        angle += Math.sin(phase) * 2.2 * Math.PI / 180;
        pitch = Math.sin(phase * 2) * 0.08;
        yaw = Math.sin(phase) * 0.07;
        const pass = seconds % 4 / 4;
        if (pass < 0.52) gleam = -720 + pass / 0.52 * 1450;
      }
      const ca = Math.cos(angle), sa = Math.sin(angle);
      const cp = Math.cos(pitch), sp = Math.sin(pitch), cy = Math.cos(yaw), sy = Math.sin(yaw);
      const pose = { a: ca * cy, b: ca * sy * sp - sa * cp,
        c: sa * cy, d: sa * sy * sp + ca * cp,
        zx: -sy / 3000, zy: cy * sp / 3000, drop, gleam,
        lightShift: sp * 38, light: 1 + sy * 0.25 };
      const ctx = this.ctx;
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.W, this.H);
      const bounds = this.keyBounds;
      for (const row of this.keyRows) { row.left = bounds.x1; row.right = bounds.x0; }
      // Bound the ring, stem and teeth in the fixed output grid. Empty rows never
      // invoke the procedural sampler; bounds are geometry, not moving sprites.
      for (const region of KEY_REGIONS) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < 4; i++) {
          const u = region[i & 1], v = region[2 + (i >> 1)];
          const depth = 1 + pose.zx * u + pose.zy * v;
          const x = (pose.a * u + pose.b * v) / depth;
          const y = (pose.c * u + pose.d * v) / depth + drop;
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
        const left = Math.max(bounds.x0, Math.floor((minX + 980) / bounds.sx) - 1);
        const right = Math.min(bounds.x1, Math.ceil((maxX + 980) / bounds.sx) + 1);
        const top = Math.max(bounds.y0, Math.floor((minY + 610) / bounds.sy) - 1);
        const bottom = Math.min(bounds.y1, Math.ceil((maxY + 610) / bounds.sy) + 1);
        for (let y = top; y < bottom; y++) {
          const row = this.keyRows[y - bounds.y0];
          row.left = Math.min(row.left, left); row.right = Math.max(row.right, right);
        }
      }
      let checksum = 2166136261, occupied = 0;
      for (let rowIndex = 0; rowIndex < this.keyRows.length; rowIndex++) {
        const row = this.keyRows[rowIndex];
        for (let column = row.left; column < row.right; column++) {
          const cell = this.keyGrid[rowIndex * bounds.stride + column - bounds.x0];
          const x = cell.x, y = cell.y, dx = this.keySampleX, dy = this.keySampleY;
          const q0 = this.keySample(x, y, pose), q1 = this.keySample(x + dx, y, pose);
          const q2 = this.keySample(x, y + dy, pose), q3 = this.keySample(x + dx, y + dy, pose);
          const mask = (q0 > cell.thresholds[0] ? 1 : 0) | (q1 > cell.thresholds[1] ? 2 : 0) |
            (q2 > cell.thresholds[2] ? 4 : 0) | (q3 > cell.thresholds[3] ? 8 : 0);
          if (!mask) continue;
          const light = (q0 + q1 + q2 + q3) / 4;
          ctx.fillStyle = light >= 0.74 ? PAL.w : light >= 0.42 ? PAL.c : PAL.b;
          this.glyph(KEY_GLYPHS[mask], ...cell.bounds);
          checksum = Math.imul(checksum ^ (cell.k * 16 + mask), 16777619) >>> 0;
          occupied++;
        }
      }
      this.el.dataset.frame = tag;
      this.el.dataset.glyphChecksum = checksum.toString(16);
      this.el.dataset.glyphCount = String(occupied);
    }

    // The key drops into place; the scene builds diamond, shore, then reflection.
    reveal() {
      if (!this.W || !this.H) return;
      if (reduceMotion.matches) { this.finish(); return; }
      this.elapsed = 0;
      this.lastFrame = 0;
      this.finishedCells = this.landscape ? new Uint8Array(this.paintCells.length) : null;
      this.setState("revealing");
      this.el.dataset.progress = "0";
      if (!this.landscape) {
        this.drawKeyFrame("drop", 0, true);
        this.figure?.classList.add("art-ready");
        return;
      }
      this.ctx.clearRect(0, 0, this.W, this.H);
      this.ctx.globalAlpha = 0.035;
      this.ctx.drawImage(this.base.canvas, 0, 0);
      this.ctx.globalAlpha = 1;
      this.figure?.classList.add("art-ready");
    }

    finish() {
      if (!this.W || !this.H) return;
      this.setState("done");
      this.el.dataset.progress = "1";
      this.drawAll();
      this.figure?.classList.add("art-ready");
      this.finishedCells = null;
      this.lastFrame = 0;
      this.ambientStamp = 0;
    }

    step(now) {
      if (this.lastFrame) this.elapsed += now - this.lastFrame;
      this.lastFrame = now;
      const t = this.elapsed;
      const ctx = this.ctx;
      if (!this.landscape) {
        const progress = Math.min(1, t / this.duration);
        this.drawKeyFrame("drop", t);
        this.el.dataset.progress = progress.toFixed(3);
        if (progress >= 1) this.finish();
        return;
      }
      this.prep();
      for (let i = 0; i < this.paintCells.length; i++) {
        if (this.finishedCells[i]) continue;
        const cell = this.paintCells[i];
        const progress = (t - cell.delay) / 480;
        if (progress < 0) continue;
        const [x0, y0, x1, y1] = cell.bounds;
        const w = x1 - x0, h = y1 - y0;
        ctx.clearRect(x0, y0, w, h);
        if (progress >= 1) {
          ctx.globalAlpha = 1;
          ctx.drawImage(this.base.canvas, x0, y0, w, h, x0, y0, w, h);
          this.finishedCells[i] = 1;
        } else {
          ctx.globalAlpha = ease(progress);
          ctx.drawImage(this.base.canvas, x0, y0, w, h, x0, y0, w, h);
          // A narrow cyan edge follows the actual glyphs; there is no random noise field.
          ctx.globalAlpha = Math.sin(Math.PI * progress) ** 2 * 0.85;
          this.paint(cell, ctx, PAL.c);
        }
      }
      ctx.globalAlpha = 1;
      this.el.dataset.progress = Math.min(1, t / this.duration).toFixed(3);
      if (t >= this.duration) this.finish();
    }

    ambient(now) {
      if (this.ambientStamp) this.ambientTime += now - this.ambientStamp;
      this.ambientStamp = now;
      const t = this.ambientTime;
      if (!this.landscape) {
        this.pointer.x += (this.pointer.tx - this.pointer.x) * 0.1;
        this.pointer.y += (this.pointer.ty - this.pointer.y) * 0.1;
        this.drawKeyFrame("loop", t);
        return;
      }
      const ctx = this.ctx;
      this.prep();
      ctx.globalAlpha = 1;
      ctx.clearRect(0, 0, this.W, this.H);
      {
        ctx.save();
        ctx.translate(Math.sin(t / 4200) * this.dpr * 0.7, Math.sin(t / 5100) * this.dpr * 0.3);
        ctx.drawImage(this.scene.canvas, 0, 0);
        for (const cell of this.water) {
          const wave = Math.max(0, Math.sin(cell.v * 38 - t / 1600 + cell.u * 3));
          if (wave < 0.75) continue;
          ctx.globalAlpha = wave ** 10 * 0.40;
          this.paint(cell, ctx, PAL.c);
        }
        this.stars.forEach((cell, i) => {
          const period = 3500 + (i % 6) * 470;
          const pulse = (0.5 + 0.5 * Math.sin(t / period * Math.PI * 2 + i * 2.399)) ** 3;
          const [x0, y0, x1, y1] = cell.bounds;
          const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
          const size = 1 + pulse * 0.6;
          ctx.save();
          ctx.translate(cx, cy);
          ctx.scale(size, size);
          ctx.translate(-cx, -cy);
          ctx.globalAlpha = 0.08 + pulse * 0.9;
          this.paint(cell, ctx, PAL.w);
          if (pulse > 0.75) {
            ctx.globalAlpha = (pulse - 0.75) * 3;
            ctx.fillStyle = PAL.w;
            ctx.fillRect(cx - this.dpr * 0.5, cy - this.dpr * 0.5, this.dpr, this.dpr);
          }
          ctx.restore();
        });
        ctx.restore();

        // Foreground tilt and parallax pivot around the original diamond, not the frame.
        const cx = this.ox + 160 * this.cw, cy = this.oy + 41 * this.ch;
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.translate(cx + Math.sin(t / 2900) * this.dpr * 2, cy - Math.sin(t / 2300) * this.dpr * 4);
        ctx.transform(1 + Math.sin(t / 2500) * 0.025, Math.sin(t / 3700) * 0.008,
          Math.sin(t / 3100) * 0.025, 1 + Math.sin(t / 4100) * 0.006, 0, 0);
        ctx.drawImage(this.diamond.canvas, -cx, -cy);
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
  }

  const data = window.ECF_ART || {};
  const decoded = new Map();
  const arts = [];
  document.querySelectorAll(".support-art canvas.art[data-art]").forEach(el => {
    const key = el.dataset.art;
    if (!data[key]) return;
    try {
      if (!decoded.has(key)) decoded.set(key, decode(data[key]));
      const art = new ArtCanvas(el, decoded.get(key));
      art.layout();
      if (reduceMotion.matches) art.finish();
      // The canvas owns the figure from here: the fallback image is only for no-canvas
      // browsers, so hide it now rather than when the reveal starts (that showed a flash).
      art.figure?.classList.add("art-ready");
      arts.push(art);
    } catch {
      // The original image remains visible if enhancement is unavailable.
      el.closest(".support-art")?.classList.remove("art-ready");
    }
  });
  if (!arts.length) return;

  // ?art-debug: no observers or timers; frames are drawn on request (used for frame QA).
  if (new URLSearchParams(location.search).has("art-debug")) {
    window.ecfArt = {
      arts,
      key(kind, ms) {
        for (const a of arts) {
          if (a.landscape) continue;
          a.layout();
          a.setState("done");
          a.drawKeyFrame(kind, ms, true);
          a.figure?.classList.add("art-ready");
        }
      },
    };
    return;
  }

  let frame = 0;
  let ambientTimer = 0;
  const canMove = () => !reduceMotion.matches && !document.hidden;

  function schedule() {
    const active = canMove();
    const revealing = active && arts.some(a => a.visible && a.state === "revealing");
    const settled = active && arts.some(a => a.visible && a.state === "done");
    if (revealing && !frame) frame = requestAnimationFrame(animate);
    if (!revealing && frame) { cancelAnimationFrame(frame); frame = 0; }
    if (settled && !ambientTimer) ambientTimer = setTimeout(ambient, 40);
    if (!settled && ambientTimer) { clearTimeout(ambientTimer); ambientTimer = 0; }
  }

  function animate(now) {
    frame = 0;
    if (canMove()) {
      for (const art of arts) if (art.visible && art.state === "revealing") art.step(now);
    }
    schedule();
  }

  function ambient() {
    ambientTimer = 0;
    if (canMove()) {
      const now = performance.now();
      for (const art of arts) if (art.visible && art.state === "done") art.ambient(now);
    }
    schedule();
  }

  const byEl = new Map(arts.map(a => [a.el, a]));
  const resize = new ResizeObserver(entries => {
    for (const entry of entries) {
      const art = byEl.get(entry.target);
      if (!art || !art.layout()) continue;
      // A new size gets a crisp final render; resizing never repeats the reveal.
      if (art.state !== "idle" || reduceMotion.matches) art.finish();
      else if (art.visible) art.reveal();
    }
    schedule();
  });
  const intersection = new IntersectionObserver(entries => {
    for (const entry of entries) {
      const art = byEl.get(entry.target);
      if (!art) continue;
      art.visible = entry.isIntersecting;
      art.lastFrame = 0;
      art.ambientStamp = 0;
      if (art.visible && art.state === "idle") {
        art.layout();
        art.reveal();
      } else if (!art.visible && art.state === "done") {
        art.drawAll();
      }
    }
    schedule();
  }, { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });

  for (const art of arts) {
    resize.observe(art.el);
    intersection.observe(art.el);
  }
  reduceMotion.addEventListener("change", () => {
    for (const art of arts) {
      art.lastFrame = 0;
      art.ambientStamp = 0;
      if (reduceMotion.matches) art.finish();
    }
    schedule();
  });
  document.addEventListener("visibilitychange", () => {
    for (const art of arts) {
      art.lastFrame = 0;
      art.ambientStamp = 0;
      if (document.hidden && art.state === "done") art.drawAll();
    }
    schedule();
  });
})();
