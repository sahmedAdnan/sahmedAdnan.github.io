/* =============================================================
   Engine: one WebGL2 draw call for the whole site.
   Scenes live as layers of a float texture array; the vertex
   shader reads two of them and morphs between them as you scroll.
   Light theme multiplies coloured ink onto the paper, dark theme
   adds coloured light — the same dots, printed or projected.
   ============================================================= */
window.SA = window.SA || {};

(() => {
  const MAX_STATES = 14;
  const TEX_W = 256;

  const VERT = `#version 300 es
  precision highp float;
  precision highp int;
  precision highp sampler2DArray;

  uniform sampler2DArray uPos;
  uniform int   uTexW;
  uniform int   uCount;
  uniform int   uLayer[${MAX_STATES}];
  uniform vec4  uAnchor[${MAX_STATES}];  // centre x, centre y, scale x, scale y (css px)
  uniform vec4  uLook[${MAX_STATES}];    // alpha, point size, colour mode, animation
  uniform vec4  uFeel[${MAX_STATES}];    // tilt, pointer repulsion, ext y, —
  uniform vec2  uRes, uMouse, uTilt, uSplit;
  uniform float uState, uTime, uIntro, uMotion, uDpr, uDark;
  uniform int   uShape;                    // 0 dots · 1 pixels · 2 marks · 3 hatch
  uniform int   uFlow;                     // 0 swirl · 1 diffuse · 2 scan
  uniform vec3  uChan[3];
  uniform vec3  uPal[7];
  uniform vec3  uHot;
  uniform vec2  uTer[2];
  uniform vec2  uTrail[4];                // the lamp (thesis) or the pointer (end), now and a moment ago
  uniform vec4  uClk[4];                  // seconds each scene has been on screen
  uniform vec4  uCent[8];                 // cluster centres in feature space
  uniform vec4  uSlot[8];                 // where each named specimen lies in the drawer
  uniform float uVert;                    // narrow screens
  uniform vec3  uVis;                     // the end: fill and edge points per subject; 1 when it runs down the screen
  uniform vec4  uHead;                    // the hero: where the face is on screen (x, y, radius), kept clear; w: right edge of the text

  // what a scene does to a point besides moving it
  struct Fx { float alpha; float hot; float size; vec3 col; float own; };

  out vec3  vColor;
  out float vAlpha;
  out float vAngle;

  float hash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
  vec3 rotY(float a, vec3 p) { float c = cos(a), s = sin(a); return vec3(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
  vec3 rotX(float a, vec3 p) { float c = cos(a), s = sin(a); return vec3(p.x, c * p.y - s * p.z, s * p.y + c * p.z); }

  vec4 fetchState(int s, int v) { return texelFetch(uPos, ivec3(v % uTexW, v / uTexW, uLayer[s]), 0); }

  float clockOf(int s) { vec4 q = uClk[s / 4]; int i = s - (s / 4) * 4; return i == 0 ? q.x : i == 1 ? q.y : i == 2 ? q.z : q.w; }
  float pick(vec4 a, int i) { return i == 0 ? a.x : i == 1 ? a.y : i == 2 ? a.z : a.w; }
  vec3 unpackRGB(float w) { float q = w - 100.0; return vec3(floor(q / 1024.0), mod(floor(q / 32.0), 32.0), mod(q, 32.0)) / 31.0; }
  float ease5(float x) { x = clamp(x, 0.0, 1.0); return x * x * x * (x * (x * 6.0 - 15.0) + 10.0); }
  vec2 rot2(vec2 p, float a) { float c = cos(a), s = sin(a); return vec2(c * p.x - s * p.y, s * p.x + c * p.y); }

  /* ---- moths at the light trap (fields.js trapGrid, GRID) */
  vec3 mothOrbit(float id, float t) {
    float h1 = hash(id * 7.31 + 1.0), h2 = hash(id * 3.17 + 2.0), h3 = hash(id * 5.71 + 3.0), h4 = hash(id * 9.13 + 4.0);
    float speed = (0.45 + 0.75 * h2) * (h1 < 0.5 ? -1.0 : 1.0);
    float R = (0.18 + 0.62 * h3) * (0.82 + 0.18 * sin(t * (0.3 + 0.3 * h4) + h1 * 6.283));
    float th = t * speed + h4 * 6.283;
    vec3 c = rotX(0.3 + (h2 - 0.5) * 0.9, vec3(cos(th) * R, 0.0, sin(th) * R));
    c = rotY((h3 - 0.5) * 0.8, c);
    c.y += (h1 - 0.5) * 0.34;
    c.xy += 0.03 * vec2(sin(t * (3.1 + h1 * 2.0) + h2 * 9.0), cos(t * (2.7 + h3 * 2.0) + h4 * 9.0));
    return c;
  }
  vec2 trailAt(float k) {
    int i = int(floor(k));
    return mix(uTrail[i], uTrail[min(i + 1, 3)], fract(k));
  }
  vec2 tileCentre(float k) {
    float col = mod(k, 6.0), row = floor(k / 6.0);
    return vec2(-1.57 + col * 0.54 + 0.22, 0.58 - 1.03 + row * 0.54 + 0.22);
  }

  /* ---- the captioning model (fields.js caption): which frame each word looks at */
  const int ATT[5] = int[5](0, 2, 1, 1, 3);
  const float FRAME_X[4] = float[4](-0.755, -0.253, 0.252, 0.755);

  /* ---- the end: inside the eye (fields.js visionScene, VISION) */
  const int SGROUP[9] = int[9](0, 2, 1, 1, 0, 2, 2, 1, 0);
  const int SMEMBER[9] = int[9](0, 0, 0, 1, 1, 1, 2, 2, 2);
  // the layout keeps subjects, eye and display apart under any sway or pointer turn (fields.js visionScene ext)
  bool tight() { return uVis.z > 0.5; }                // a phone: the story runs down the screen
  #define EYE (tight() ? 0.9 : 1.0)
  #define BR (0.75 * EYE)                              // the eye's radius; its axis runs back along +z
  #define Z_PIX (0.6 * EYE)
  #define Z_EDGE (1.2 * EYE)
  #define Z_NET (1.8 * EYE)
  #define Z_OUT (2.4 * EYE)
  #define Z_BACK (2.8 * EYE)
  vec3 outW() { return tight() ? vec3(1.6, 0.0, 1.6) : vec3(2.0, 0.0, 1.7); }     // the display beside the eye
  // the subjects: a grid facing the camera, its columns stepping along the camera's right
  vec2 gridA() { return tight() ? vec2(-0.85, -0.85) : vec2(-0.9, -0.85); }
  vec2 gridStep() { return tight() ? vec2(0.32, 0.19) : vec2(0.34, 0.2); }
  float gridDy() { return tight() ? 0.88 : 0.56; }
  float subjS() { return 0.28; }
  vec3 tealInk() { return mix(vec3(0.0, 0.52, 0.6), vec3(0.22, 0.9, 0.95), uDark); }
  vec3 groupInk(int g) { return g == 0 ? tealInk() : g == 1 ? uHot : mix(vec3(0.3, 0.34, 0.42), vec3(0.75, 0.8, 0.9), uDark); }
  vec2 subjectLocal(int st, int i, int j) { return fetchState(st, (i * int(uVis.x + uVis.y + 0.5) + j) * 3).zw; }
  // the camera sees the eye at an angle, so we look into it; it sways, and turns a little with the pointer.
  // On a phone it is rolled a quarter turn, so the story runs down the screen instead of across it
  vec3 view(vec3 w, float t) {
    vec3 p = w - vec3(0.0, 0.0, 0.9);
    float yaw = 0.66 + 0.04 * sin(t * 0.17) * uMotion + 0.07 * clamp(uTrail[0].x / 2.2, -1.0, 1.0) * clamp(uTrail[1].x, 0.0, 1.0);
    p = rotX(0.2 + 0.04 * sin(t * 0.13) * uMotion - 0.05 * clamp(uTrail[0].y, -1.0, 1.0) * clamp(uTrail[1].x, 0.0, 1.0), rotY(yaw, p));
    float k = 4.0 / (4.0 + p.z);
    vec2 xy = p.xy * k + (tight() ? vec2(0.3, -0.14) : vec2(-0.06, -0.14));
    return vec3(tight() ? vec2(-xy.y, xy.x) : xy, k);
  }
  vec3 subjectW(int i, float t) {
    int c = i - (i / 3) * 3, r = i / 3;
    vec2 A = gridA(), st = gridStep();
    return vec3(A.x + float(c - 1) * st.x, float(r - 1) * gridDy(), A.y + float(c - 1) * st.y)
         + vec3(sin(t * 0.7 + float(i) * 1.9), cos(t * 0.6 + float(i) * 2.3), 0.0) * 0.02 * uMotion;
  }
  float ringR(int l) { return (l == 0 ? 0.55 : l == 1 ? 0.36 : 0.17) * EYE; }
  float ringN(int l) { return tight() ? (l == 0 ? 8.0 : l == 1 ? 6.0 : 4.0) : (l == 0 ? 10.0 : l == 1 ? 8.0 : 6.0); }
  vec2 ringNode(int l, float a, float t) {
    float th = a / ringN(l) * 6.2831853 + t * (l == 0 ? 0.45 : l == 1 ? -0.6 : 0.85) + float(l) * 0.4;
    return vec2(cos(th), sin(th)) * ringR(l);
  }
  /* the display: what the eye makes of what it saw, one task after another (8 s each) */
  // everything on the display stays inside its frame, DISPLAY_HALF
  const vec2 DISPLAY_HALF = vec2(0.56, 0.46), BOX_HALF = vec2(0.16, 0.14);
  vec2 detectAt(int b) { return b == 0 ? vec2(-0.36, 0.14) : b == 1 ? vec2(0.0, -0.15) : vec2(0.36, 0.14); }   // boxes never meet
  int detectSubject(int b) { return b == 0 ? 0 : b == 1 ? 1 : 3; }      // a bird, a gear, a flower
  vec2 clusterAt(int g) { return g == 0 ? vec2(-0.32, -0.16) : g == 1 ? vec2(0.32, -0.16) : vec2(0.0, 0.2); }
  // where point (subject i, sample j) sits in task m, in the display's units, with its colour and size
  vec3 taskPoint(int st, int m, int i, int j, float t, out vec3 colr) {
    vec3 ink = vec3(uDark);
    if (m == 0) {                                      // grouping: similar subjects gather
      int g = SGROUP[i];
      float a = float(SMEMBER[i]) * 2.0944 + t * 0.4;
      colr = groupInk(g);
      return vec3(clusterAt(g) + vec2(cos(a), sin(a)) * 0.11 + subjectLocal(st, i, j) * 0.11, 1.0);
    }
    int b = int(mod(float(i), 3.0)), S = detectSubject(b);
    vec2 l = subjectLocal(st, S, int(mod(float(j), uVis.x)));
    if (m == 1) { colr = mix(ink, tealInk(), 0.25); return vec3(detectAt(b) + l * 0.26, 1.0); }     // detection
    if (m == 2) { colr = groupInk(SGROUP[S]); return vec3(detectAt(b) + l * 0.26, 1.2); }         // segmentation
    // depth: a subject rebuilt as a point cloud with depth, turning
    vec2 lf = subjectLocal(st, 4, int(mod(float(j), uVis.x)));
    float d = 0.2 * (1.0 - smoothstep(0.0, 0.55, length(lf)));
    vec3 p = rotX(0.35, rotY(t * 0.8, vec3(lf * 0.78, -d * 1.3)));
    colr = mix(uHot, tealInk(), d / 0.2);
    return vec3(p.xy / (1.0 - p.z * 0.6), 1.0);
  }

  // the scan: a line sweeping to and fro over the subjects (in the subjects' own height)
  float scanY(float t) { float u = fract(t / 6.0); return mix(-1.0, 1.0, smoothstep(0.0, 1.0, u < 0.5 ? u * 2.0 : 2.0 - u * 2.0)) * (gridDy() + 0.15); }

  vec3 animate(int s, vec4 P, int v, float tid, inout Fx fx) {
    int anim = int(uLook[s].w + 0.5);
    float t = uTime, w = P.w;
    vec3 p = P.xyz;

    if (anim == 8) {                                     // the hero: a lens around the portrait (fields.js aperture)
      const float N = 9.0, TAU = 6.2831853;
      float breathe = sin(t * 0.25) * uMotion, phi = 0.14 * breathe;
      float Ro = 0.74 + 0.05 * breathe, Rb = 0.98, ring = t * 0.015 + uTilt.x * 0.25;
      vec2 cen = vec2(0.0, -0.12);
      float part = p.z;
      // the opening: a nine-sided iris with softly curved sides
      float th, rad;
      if (part < 0.5) {
        th = p.x * TAU;
        float sec = mod(th - phi, TAU / N) - 3.14159 / N;
        rad = mix(Ro * cos(3.14159 / N) / cos(sec), Ro, 0.35);
        fx.alpha = 0.75;
      } else if (part < 1.5) {                           // a blade's edge, sweeping out from the opening
        th = p.x * TAU + phi + 0.62 * p.y;
        rad = mix(Ro, Rb, p.y);
        fx.alpha = 0.6;
      } else if (part < 2.5) {                           // shading on the blades, each a little different
        th = p.x * TAU;
        float blade = floor(mod(th - phi - 0.62 * p.y, TAU) / (TAU / N));
        rad = mix(Ro * 1.02, Rb, p.y);
        fx.alpha = 0.12 + 0.12 * hash(blade + 3.0) + 0.1 * p.y;
        fx.size = 0.8;
      } else if (part < 3.5) {                           // the focus rings
        th = p.x * TAU + ring;
        rad = p.y < 0.5 ? 1.04 : 1.1;
        fx.alpha = p.y < 0.5 ? 0.7 : 0.4;
      } else {                                           // the scale on the barrel
        float k = floor(p.x * 72.0);
        th = p.x * TAU + ring;
        bool major = mod(k, 6.0) < 0.5;
        rad = 1.12 + p.y * (major ? 0.07 : 0.035);
        fx.alpha = major ? 0.75 : 0.45;
        if (k < 0.5) { fx.hot = 1.0; fx.alpha = 1.0; }   // the focus mark
      }
      return vec3(cen + vec2(cos(th), sin(th)) * rad, 0.0);
    }

    if (anim == 13) {                                    // the light trap fills a contact sheet
      if (p.z < -0.5) return vec3(uTrail[0] + p.xy * (1.0 + 0.05 * sin(t * 21.0 + tid) * uMotion), 0.12);
      float cyc = mod(uMotion > 0.5 ? clockOf(s) : 14.0, 17.4);
      float k = floor(p.z + 0.01), role = p.z - k;
      float land = 0.8 + k * 0.42;
      float up = ease5((cyc - 15.4 - hash(k + 3.0) * 0.6) / 1.3);   // the sheet is cleared and every moth takes off again
      float e = ease5((cyc - land) / 0.75) * (1.0 - up);
      if (role < 0.4) {
        vec2 loc = p.xy - tileCentre(k);
        vec3 c = mothOrbit(k, t), c2 = mothOrbit(k, t + 0.05);
        vec2 vel = c2.xy - c.xy;
        float ang = atan(vel.y, vel.x) + 1.5708;                      // the head leads
        float flap = 0.25 + 0.75 * abs(sin(t * (9.0 + 5.0 * hash(k + 5.0)) + k * 1.7));
        vec2 fly = trailAt(hash(k * 9.13 + 4.0) * 3.0) + c.xy * vec2(1.0, 0.7) + rot2(vec2(loc.x * flap, loc.y) * 0.46, ang);
        vec2 pos = mix(fly, p.xy, e) + vec2(0.35 * (hash(k + 8.0) - 0.5), 0.0) * sin(e * 3.14159);
        return vec3(pos, mix(c.z * 1.2, 0.0, e));
      }
      // its tile appears, with a flash, as the moth is photographed
      fx.alpha = smoothstep(0.6, 1.0, e);
      fx.hot = step(0.001, e) * (1.0 - smoothstep(0.0, 0.7, cyc - land - 0.75));
      return vec3(p.xy, 0.0);
    }

    if (anim == 14) {                                    // the end: inside the eye
      int base = int(tid) * 3;
      vec4 d0 = fetchState(s, base), d1 = fetchState(s, base + 1);
      int role = int(d0.x + 0.5);
      if (role == 15) { fx.alpha = 0.0; return vec3(0.0); }
      vec3 ink = vec3(uDark);
      float sy = scanY(t);
      fx.own = 1.0;
      fx.col = ink;

      if (role <= 1) {                                   // a subject floating in front of the eye, facing us
        int i = int(d0.y + 0.5);
        vec3 w = subjectW(i, t);
        vec3 c = view(w, t);
        vec2 l = d0.zw;
        float lineY = w.y + (tight() ? -l.x : l.y) * subjS();
        float line = exp(-pow((lineY - sy) / 0.03, 2.0));
        float near = exp(-pow((w.y - sy) / 0.3, 2.0));
        fx.alpha = role == 1 ? 1.0 : 0.6;
        fx.size = (role == 1 ? 1.1 : 0.9) * (1.0 + line * 0.8) * (0.7 + 0.4 * c.z);
        fx.col = mix(ink, tealInk(), max(line, near * 0.25));
        return vec3(c.xy + l * subjS() * c.z, 0.0);
      }
      if (role == 7) {                                   // the scanning field: from the rim of the iris to the scan line
        float th = d0.y * 6.2831853;
        vec3 rim = view(vec3(cos(th) * BR, sin(th) * BR * 0.9, 0.0), t);
        vec2 A = gridA(), st = gridStep() * 1.5;
        vec3 lft = view(vec3(A.x - st.x, sy, A.y - st.y), t), rgt = view(vec3(A.x + st.x, sy, A.y + st.y), t);
        vec2 tip = mix(lft.xy, rgt.xy, d0.w);
        float pulse = 0.4 + 0.6 * smoothstep(0.7, 1.0, fract(d0.z * 3.0 - t * 1.4));
        fx.col = tealInk();
        fx.alpha = (d0.z > 0.97 ? 0.75 : 0.1 * pulse);
        fx.size = 0.8;
        return vec3(mix(rim.xy, tip, d0.z), 0.0);
      }
      if (role == 8) {                                   // a point of a subject: drawn in, carried through the eye, then onto the display
        int i = int(d0.y + 0.5), j = int(d0.z + 0.5);
        float ph = fract(t / 7.5 + d1.x);
        vec2 l = subjectLocal(s, i, j);
        vec3 c0 = view(subjectW(i, t), t);
        vec2 k0 = c0.xy + l * subjS() * c0.z;
        float a = d1.y * 6.2831853;
        vec3 k1 = view(vec3(cos(a), sin(a), 0.0) * 0.18 * EYE * sqrt(d0.w), t);                  // through the iris
        vec3 k2 = view(vec3((floor(l * 9.5) + 0.5) / 9.5 * 0.95 * EYE, Z_PIX), t);               // as pixels
        vec3 k3 = view(vec3(subjectLocal(s, i, int(uVis.x + 0.5) + int(mod(float(j), uVis.y))) * 0.95 * EYE, Z_EDGE), t);   // as an outline
        int rl = int(mod(float(j), 3.0));
        vec3 k4 = view(vec3(ringNode(rl, floor(d0.w * ringN(rl)), t), Z_NET), t);                  // through the network
        vec3 k5 = view(vec3(vec2(cos(a), sin(a)) * 0.12 * EYE, Z_BACK + 0.12), t);                 // out at the back
        // on the display: the current task, blending from the last one as it changes
        vec3 O = view(outW(), t);
        float m = mod(floor(t / 8.0), 4.0), bl = smoothstep(0.0, 1.4, mod(t, 8.0));
        vec3 ca, cb;
        vec3 ta = taskPoint(s, int(mod(m + 3.0, 4.0)), i, j, t, ca), tb = taskPoint(s, int(m), i, j, t, cb);
        vec3 tk = mix(ta, tb, bl);
        vec2 k6 = O.xy + tk.xy * O.z;
        vec3 c6 = mix(ca, cb, bl);
        vec2 p; float kk = 1.0; vec3 colr;
        if (ph < 0.1) { float e = ease5(ph / 0.1); p = mix(k0, k1.xy, e); kk = mix(c0.z, k1.z, e); colr = tealInk(); }
        else if (ph < 0.2) { float e = ease5((ph - 0.1) / 0.1); p = mix(k1.xy, k2.xy, e); kk = mix(k1.z, k2.z, e); colr = mix(tealInk(), ink, e); }
        else if (ph < 0.3) { float e = ease5((ph - 0.2) / 0.1); p = mix(k2.xy, k3.xy, e); kk = mix(k2.z, k3.z, e); colr = mix(ink, tealInk(), e); }
        else if (ph < 0.4) { float e = ease5((ph - 0.3) / 0.1); p = mix(k3.xy, k4.xy, e); kk = mix(k3.z, k4.z, e); colr = mix(tealInk(), uHot, e); }
        else if (ph < 0.48) { float e = ease5((ph - 0.4) / 0.08); p = mix(k4.xy, k5.xy, e); kk = mix(k4.z, k5.z, e); colr = uHot; }
        else if (ph < 0.6) { float e = ease5((ph - 0.48) / 0.12); p = mix(k5.xy, k6, e); kk = mix(k5.z, O.z, e); colr = mix(uHot, c6, e); }
        else { p = k6; kk = O.z * tk.z; colr = c6; }
        fx.col = colr;
        fx.alpha = smoothstep(0.0, 0.03, ph) * (1.0 - smoothstep(0.94, 1.0, ph)) * 0.88;
        fx.size = 0.85 * (0.6 + 0.5 * kk);
        return vec3(p, 0.0);
      }
      if (role == 13) {                                  // corner marks: round the display, and round each detected object
        int b = int(d0.y + 0.5), c = int(d0.z + 0.5), arm = int(d0.w + 0.5);
        vec3 O = view(outW(), t);
        vec2 ctr = b == 3 ? vec2(0.0) : detectAt(b);
        vec2 hsz = b == 3 ? DISPLAY_HALF : BOX_HALF;
        vec2 sgn = vec2(c == 0 || c == 3 ? -1.0 : 1.0, c < 2 ? -1.0 : 1.0);
        vec2 corner = ctr + sgn * hsz;
        float len = (b == 3 ? 0.08 : 0.05) * d1.x;
        vec2 q = corner - (arm == 0 ? vec2(sgn.x * len, 0.0) : vec2(0.0, sgn.y * len));
        float m = mod(floor(t / 8.0), 4.0), bl = smoothstep(0.0, 1.4, mod(t, 8.0));
        float on = b == 3 ? 1.0 : (m > 0.5 && m < 1.5 ? bl : (m > 1.5 && m < 2.5 ? 1.0 - bl : 0.0));
        fx.col = b == 3 ? tealInk() : uHot;
        fx.alpha = 0.9 * on;
        fx.size = 0.9;
        return vec3(O.xy + q * O.z, 0.0);
      }
      if (role == 2) {                                   // the eye's body: a front rim with its scale, rings along the barrel, struts
        int part = int(d0.y + 0.5);
        float th = d0.z * 6.2831853;
        vec3 w;
        if (part == 0) { w = vec3(cos(th), sin(th), 0.0) * BR * (d0.w < 0.5 ? 1.0 : 1.07); fx.alpha = 0.85; }
        else if (part == 3) {
          th += t * 0.12;
          bool major = mod(floor(d0.z * 72.0), 6.0) < 0.5;
          w = vec3(cos(th), sin(th), 0.0) * BR * (1.1 + d0.w * (major ? 0.07 : 0.035));
          fx.alpha = major ? 0.8 : 0.45;
          if (floor(d0.z * 72.0) < 0.5) { fx.col = tealInk(); fx.alpha = 1.0; }
        } else if (part == 1) {
          float z = d0.w < 0.5 ? Z_PIX : d0.w < 1.5 ? Z_EDGE : d0.w < 2.5 ? Z_NET : d0.w < 3.5 ? Z_OUT : Z_BACK;
          w = vec3(cos(th), sin(th), 0.0) * BR * (d0.w > 3.5 ? 0.92 : 1.0) + vec3(0.0, 0.0, z);
          fx.alpha = 0.32;
          fx.size = 0.8;
        } else {
          th = d0.z * 6.2831853 + t * 0.05;
          w = vec3(cos(th) * BR, sin(th) * BR, d0.w * Z_BACK);
          fx.alpha = 0.16;
          fx.size = 0.7;
        }
        vec3 c = view(w, t);
        fx.size *= 0.7 + 0.4 * c.z;
        return vec3(c.xy, 0.0);
      }
      if (role == 3) {                                   // the iris at the front: blades that open, close and turn
        float breathe = sin(t * 0.8) * uMotion;
        float Ro = (0.26 + 0.05 * breathe) * BR / 0.75, Rb = BR * 0.97, phi = t * 0.25 + 0.2 * breathe;
        int part = int(d0.y + 0.5);
        float th, rad;
        if (part == 0) { th = d0.z * 6.2831853 + phi + 0.62 * d0.w; rad = mix(Ro, Rb, d0.w); fx.alpha = 0.6; }
        else if (part == 1) {
          th = d0.z * 6.2831853; rad = mix(Ro * 1.05, Rb, d0.w);
          float blade = floor(mod(th - phi - 0.62 * d0.w, 6.2831853) / (6.2831853 / 9.0));
          fx.alpha = 0.1 + 0.1 * hash(blade + 3.0) + 0.08 * d0.w;
          fx.size = 0.8;
        } else { th = d0.z * 6.2831853; rad = Ro; fx.alpha = 0.85; fx.col = tealInk(); }
        vec3 c = view(vec3(cos(th), sin(th), 0.0) * rad, t);
        return vec3(c.xy, 0.0);
      }
      if (role == 9) {                                   // the pixel plane: a faint grid of cells
        vec2 q = (vec2(d0.y, d0.z) - 5.0) / 9.5 * 0.95 * EYE;
        vec3 c = view(vec3(q, Z_PIX), t);
        fx.alpha = 0.22;
        fx.size = 0.75;
        return vec3(c.xy, 0.0);
      }
      if (role == 10) {                                  // a ring round each group on the display, while grouping
        int g = int(d0.y + 0.5);
        float th = d0.z * 6.2831853 + t * 0.2;
        vec3 O = view(outW(), t);
        float m = mod(floor(t / 8.0), 4.0), bl = smoothstep(0.0, 1.4, mod(t, 8.0));
        float on = m < 0.5 ? bl : (m > 2.5 ? 0.0 : (m < 1.5 ? 1.0 - bl : 0.0));
        fx.col = groupInk(g);
        fx.alpha = 0.5 * on;
        fx.size = 0.8;
        return vec3(O.xy + (clusterAt(g) + vec2(cos(th), sin(th)) * 0.2) * O.z, 0.0);
      }
      if (role == 4) {                                   // the network's nodes, deep in the eye
        int l = int(d0.y + 0.5);
        float act = 0.35 + 0.65 * pow(0.5 + 0.5 * sin(t * 3.2 + d0.z * 2.3 + float(l) * 1.7), 3.0);
        float a = d0.w * 6.2831853;
        vec3 c = view(vec3(ringNode(l, d0.z, t) + vec2(cos(a), sin(a)) * 0.016 * sqrt(hash(tid * 1.3)), Z_NET), t);
        fx.col = mix(ink, uHot, act);
        fx.alpha = 0.6 + 0.4 * act;
        fx.size = 1.0 + 0.4 * act;
        return vec3(c.xy, 0.0);
      }
      // roles 5 and 6: the network's links, and signals spiralling inward
      int l = int(d0.y + 0.5);
      if (role == 5) {
        vec3 c = view(vec3(mix(ringNode(l, d0.z, t), ringNode(l + 1, d0.w, t), d1.x), Z_NET), t);
        fx.alpha = 0.3;
        fx.size = 0.7;
        return vec3(c.xy, 0.0);
      }
      float ph = fract(t * 1.1 + d1.x);
      vec2 a = ringNode(l, d0.z, t);
      vec2 b = l < 2 ? ringNode(l + 1, floor(d0.z * ringN(l + 1) / ringN(l)), t) : vec2(0.0);
      vec3 c = view(vec3(mix(a, b, ph), Z_NET), t);
      fx.col = uHot;
      fx.alpha = sin(ph * 3.14159) * 0.85;
      fx.size = 0.9;
      return vec3(c.xy, 0.0);
    }

    if (anim == 1) {                                     // the tank: clear, then turbid, then bubbling water (fields.js underwater)
      float cyc = mod(uMotion > 0.5 ? clockOf(s) : 0.0, 15.0);
      float turb = smoothstep(4.4, 5.4, cyc) * (1.0 - smoothstep(9.4, 10.4, cyc));
      float bub = smoothstep(9.4, 10.4, cyc) * (1.0 - smoothstep(14.2, 15.0, cyc));
      float lc = mod(cyc, 5.0), hh = uFeel[s].z;
      bool obj = w > 9.5, part = w > 2.5 && w < 3.5;
      p.x += sin(p.y * 10.0 + t * 1.3) * 0.006 * uMotion;
      p.y += sin(p.x * 8.0 + t * 1.0) * 0.005 * uMotion;
      if (obj) { float b = w - 10.0; p.xy += vec2(sin(t * 0.7 + b * 2.1) * 0.014, cos(t * 0.9 + b * 1.3) * 0.01) * uMotion; }
      if (part) {
        if (hash(tid * 1.7) < 0.5) {                     // sediment hangs and drifts
          p.x += sin(t * 0.21 + tid) * 0.05 * uMotion;
          p.y += cos(t * 0.17 + tid * 1.3) * 0.03 * uMotion;
          fx.alpha = mix(0.05, 0.8, turb);
          fx.size = 0.9 + 0.6 * hash(tid + 2.0);
        } else {                                         // bubbles rise and wrap
          p.y = mod(p.y + hh - t * (0.09 + 0.12 * hash(tid)) * uMotion, 2.0 * hh) - hh;
          p.x += sin(t * 2.3 + tid) * 0.012 * uMotion;
          fx.alpha = bub;
          fx.size = 0.8 + 1.0 * hash(tid + 3.0);
        }
      } else {                                           // turbid water blurs and greys the picture
        vec2 warp = vec2(sin(p.y * 17.0 + t * 0.9) + 0.6 * sin(p.y * 41.0 - t * 1.3 + p.x * 9.0),
                         cos(p.x * 13.0 - t * 0.7) + 0.6 * cos(p.x * 37.0 + t * 1.1 - p.y * 7.0));
        p.xy += warp * 0.011 * turb;
        fx.alpha = 1.0 - 0.5 * turb - 0.12 * bub;
        fx.size = 1.0 + 0.35 * turb;
      }
      // once in each condition a colour threshold sweeps across and keeps only the objects;
      // murky water fools it a little: some object dots are lost, some specks pass
      float sweepX = -1.15 + (lc - 1.4) * 2.8, lift = smoothstep(3.5, 4.1, lc), armed = step(1.4, lc) * (1.0 - lift);
      if (p.x < sweepX && armed > 0.0) {
        if (obj) { bool lost = hash(float(v) * 1.9) < turb * 0.35 + bub * 0.2; fx.hot = lost ? 0.0 : 1.0; fx.size *= lost ? 1.0 : 1.3; fx.alpha = lost ? 0.15 : 1.0; }
        else if (part) { bool slip = hash(tid * 2.9) < turb * 0.25 + bub * 0.35; fx.hot = slip ? 1.0 : 0.0; fx.alpha *= slip ? 1.0 : 0.3; }
        else fx.alpha *= 0.12;
      }
      fx.hot = max(fx.hot, smoothstep(0.05, 0.0, abs(p.x - sweepX)) * armed * 0.8);
      return p;
    }

    if (anim == 12) {                                    // the captioning model reads the frames both ways, then writes
      float cyc = mod(uMotion > 0.5 ? clockOf(s) : 9.0, 12.5);
      float wi = (cyc - 2.9) / 0.8;                      // the word being written
      if (w < 0.5) {
        int fr = int(clamp(floor((p.x + 1.0) * 2.0), 0.0, 3.0));
        float band = cyc < 1.55 ? mix(-1.25, 1.25, (cyc - 0.4) / 1.15) : mix(1.25, -1.25, (cyc - 1.55) / 1.15);
        float near = exp(-pow((p.x - band) / 0.14, 2.0)) * step(0.4, cyc) * step(cyc, 2.7);
        fx.hot = near * 0.75;
        fx.size = 1.0 + 0.5 * near;
        if (wi > 0.0 && wi < 5.0) {                      // soft attention on the frame behind the word
          bool on = fr == ATT[int(wi)];
          fx.hot = max(fx.hot, on ? 0.55 * sin(clamp(fract(wi) * 1.25, 0.0, 1.0) * 3.14159) : 0.0);
          fx.alpha = on ? 1.0 : 0.62;
        }
        p.y += sin(t * 0.6 + p.x * 2.0) * 0.004 * uMotion;
        return p;
      }
      int i = int(w + 0.5) - 1;
      float pr = clamp((cyc - 2.9 - float(i) * 0.8) / 0.75, 0.0, 1.0), e = ease5(pr);
      vec2 src = vec2(FRAME_X[ATT[i]], -0.19) + (vec2(hash(tid * 1.1), hash(tid * 2.3)) - 0.5) * vec2(0.4, 0.28);
      p.xy = mix(src, p.xy, e) + vec2(0.2 * (hash(tid * 3.1) - 0.5) * sin(e * 3.14159), 0.0);
      fx.alpha = smoothstep(0.0, 0.12, pr) * (1.0 - smoothstep(11.3, 12.2, cyc));
      fx.hot = (1.0 - e) * 0.9;
      return p;
    }

    if (anim == 3) {                                     // feature space, slowly orbiting
      if (w > -0.5 && w < 7.5) {                         // each cluster also turns about its own centre
        vec3 cc = uCent[int(w + 0.5)].xyz;
        p = cc + rotY(t * (0.3 + 0.08 * w) * uMotion, p - cc);
      } else if (w > 49.5) {                             // loose embeddings drift
        p += vec3(sin(t * 0.5 + hash(tid) * 6.283), cos(t * 0.43 + hash(tid + 1.0) * 6.283), sin(t * 0.37 + hash(tid + 2.0) * 6.283)) * 0.03 * uMotion;
      }
      return rotY(sin(t * 0.25) * 0.38 * uMotion, p);
    }
    if (anim == 11) {                                    // named specimens: wings open and close a little
      vec4 sl = uSlot[int(w + 0.5)];
      p.x = sl.x + (p.x - sl.x) * mix(1.0, 0.9 + 0.1 * cos(t * 1.6 + w * 1.7), uMotion);
      return p;
    }
    if (anim == 2) {                                     // dust drift
      p.x += sin(t * 0.13 + hash(tid) * 6.283) * 0.04 * uMotion;
      p.y += cos(t * 0.11 + hash(tid + 3.0) * 6.283) * 0.05 * uMotion;
    } else if (anim == 4) {                              // floating patches
      p.z += sin(t * 0.8 + p.x * 3.0 + p.y * 2.0) * 0.05 * uMotion;
    } else if (anim == 6) {                              // three plates, told apart by depth (see fields.js TRI)
      float plate = p.z < -0.2 ? 0.0 : (p.z > 0.2 ? 2.0 : 1.0);
      if (plate < 0.5) {                                 // water moves in the first
        p.x += sin(p.y * 16.0 + t * 1.5) * 0.004 * uMotion;
        p.y += sin(p.x * 12.0 + t * 1.2) * 0.003 * uMotion;
      } else if (plate > 1.5 && w > 99.5) {              // the moth's wings beat slowly in the last
        float k = mix(1.0, 0.86 + 0.14 * cos(t * 2.2), uMotion);
        p.x = 0.56 + (p.x - 0.56) * k;
      }
      p.y += sin(t * 0.6 + plate * 2.1) * 0.012 * uMotion;
    }
    return p;
  }

  vec3 project(int s, vec3 p) {
    float tilt = uFeel[s].x;
    p = rotY(uTilt.x * 0.3 * tilt, rotX(-uTilt.y * 0.22 * tilt, p));
    float persp = 1.0 / (1.0 - clamp(p.z, -1.5, 1.5) * 0.25);
    vec4 A = uAnchor[s];
    return vec3(A.xy + p.xy * A.zw * persp, persp);
  }

  // one member of a triplet, chosen so the three together reproduce the target colour
  vec3 member(vec3 target) {
    return mix(pow(max(target, vec3(0.0)), vec3(1.0 / 3.0)), target * 0.42, uDark);
  }

  /* a comet runs along the route: bright head, fading tail, then a pause */
  float routeGlow(float w) {
    float along = w - 1.0, head = fract(uTime * 0.16) * 1.35;
    return step(along, head) * smoothstep(0.3, 0.0, head - along);
  }

  vec4 look(int s, vec4 P, int c) {
    float w = P.w;
    int mode = int(uLook[s].z + 0.5);
    float a = w < -1.5 ? 0.0 : 1.0;
    vec3 col = uChan[c];
    if (mode == 5) {                                     // natural colour packed as 100 + 15-bit RGB, 50 = ink
      if (w > 99.5) {
        float q = w - 100.0;
        vec3 rgb = vec3(floor(q / 1024.0), mod(floor(q / 32.0), 32.0), mod(q, 32.0)) / 31.0;
        col = member(rgb);
      }
    } else if (mode == 1) {
      col = member(uPal[int(mod(w, 7.0))]);
    } else if (mode == 2) {                              // network highlight
      if (w > 1.5) col = member(uHot);
      else if (w > 0.5) col = member(uHot * mix(0.85, 0.9, uDark));
      else if (w < -0.5 && w > -1.5) a *= 0.14;
    } else if (mode == 6) {                              // map: land in ink, the route and both cities in accent
      if (w > 2.5) col = member(uHot);
      else if (w > 0.5) {
        col = member(uHot);
        a *= 0.18 + 0.82 * routeGlow(w);
      }
    }
    return vec4(col, a);
  }

  float hotScale(int s, float w) {
    int mode = int(uLook[s].z + 0.5);
    if (mode == 6 && w > 0.5) return w > 2.5 ? 1.3 : 1.0 + 2.8 * pow(routeGlow(w), 2.0);
    if (mode != 2 || w < 0.5) return 1.0;
    return w > 1.5 ? 1.75 : 1.45;
  }

  void main() {
    int v = gl_VertexID;
    int c = v % 3;
    float tid = float(v / 3);
    float r1 = hash(tid), r2 = hash(tid + 7.13), r3 = hash(float(v) + 3.7);

    float st = clamp(uState, 0.0, float(uCount - 1));
    int k0 = int(floor(st));
    int k1 = min(k0 + 1, uCount - 1);
    float f = st - float(k0);
    vec4 A = fetchState(k0, v);
    vec4 B = fetchState(k1, v);

    // points leave a little out of step, so a shape flows rather than jumps;
    // scan arrives row by row, like an image being read
    Fx fa = Fx(1.0, 0.0, 1.0, vec3(0.0), 0.0), fb = fa;
    vec3 pa = project(k0, animate(k0, A, v, tid, fa));
    vec3 pb = project(k1, animate(k1, B, v, tid, fb));
    // points leave in random order, so one shape dissolves while the next condenses
    const float D = 0.4;
    float order = uFlow == 2 ? clamp(0.5 + B.y * 0.45, 0.0, 1.0) * 0.9 + r1 * 0.1 : r1;
    // in the hero nothing is drawn on the face, and little behind the text
    if (k0 == 0) fa.alpha *= smoothstep(uHead.z, uHead.z * 1.7, length((pa.xy - uHead.xy) * vec2(1.0, 0.8))) * mix(0.22, 1.0, smoothstep(uHead.w - 80.0, uHead.w + 60.0, pa.x));
    if (k1 == 0) fb.alpha *= smoothstep(uHead.z, uHead.z * 1.7, length((pb.xy - uHead.xy) * vec2(1.0, 0.8))) * mix(0.22, 1.0, smoothstep(uHead.w - 80.0, uHead.w + 60.0, pb.x));
    float fp = clamp((f - order * D - float(c) * 0.02) / (1.0 - D - 0.04), 0.0, 1.0);
    fp = fp * fp * fp * (fp * (fp * 6.0 - 15.0) + 10.0);
    vec2 scr = mix(pa.xy, pb.xy, fp);
    float persp = mix(pa.z, pb.z, fp);

    float transit = sin(fp * 3.14159);
    if (uFlow == 1) {
      // diffuse: noise is added and then taken away again, like a denoising model
      float step = floor(uTime * 24.0);
      vec2 n = vec2(hash(tid + step * 1.37) - 0.5, hash(tid * 1.7 + step * 2.11) - 0.5);
      scr += n * pow(transit, 0.7) * 120.0 * uMotion;
    } else if (uFlow == 0) {
      scr += vec2(sin(r2 * 40.0), cos(r3 * 40.0)) * transit * 40.0 * uMotion;
    }
    // the three colour channels part slightly in flight and register again on arrival
    float splitAmt = mix(uFeel[k0].w, uFeel[k1].w, fp);
    scr += (float(c) - 1.0) * (uSplit * splitAmt + vec2(5.0, 2.0) * transit * uMotion);

    // intro: the image condenses out of the whole window
    vec2 start = uRes * (vec2(hash(tid + 1.7), hash(tid + 9.1)) * 1.4 - 0.2) + (float(c) - 1.0) * vec2(70.0, 24.0);
    float fi = clamp(uIntro * 1.6 - r2 * 0.6, 0.0, 1.0);
    fi = 1.0 - pow(1.0 - fi, 3.0);
    scr = mix(start, scr, fi);

    float repel = mix(uFeel[k0].y, uFeel[k1].y, fp);
    vec2 d = scr - uMouse;
    float dist = length(d);
    scr += (d / max(dist, 1.0)) * smoothstep(130.0, 0.0, dist) * 40.0 * repel * uMotion;

    gl_Position = vec4(scr.x / uRes.x * 2.0 - 1.0, 1.0 - scr.y / uRes.y * 2.0, 0.0, 1.0);
    float shapeSize = uShape == 3 ? 2.4 : uShape == 2 ? 2.1 : uShape == 1 ? 0.9 : 1.0;
    float size = mix(uLook[k0].y * hotScale(k0, A.w) * fa.size, uLook[k1].y * hotScale(k1, B.w) * fb.size, fp) * (0.75 + r2 * 0.5) * persp * shapeSize;
    gl_PointSize = max(size * uDpr, 1.0);
    // hatch strokes follow a slow field, like an engraver's lines, and turn into the motion while moving
    vec2 mv = pb.xy - pa.xy;
    float field = 0.7 + 0.5 * sin(scr.x * 0.012 + scr.y * 0.004) + 0.4 * cos(scr.y * 0.017);
    vAngle = mix(field, atan(mv.y, mv.x), transit * step(4.0, length(mv)));

    vec4 la = look(k0, A, c), lb = look(k1, B, c);
    if (fa.own > 0.5) la.rgb = member(fa.col);
    if (fb.own > 0.5) lb.rgb = member(fb.col);
    vColor = mix(mix(la.rgb, member(uHot), clamp(fa.hot, 0.0, 1.0) * 0.85), mix(lb.rgb, member(uHot), clamp(fb.hot, 0.0, 1.0) * 0.85), fp);
    vAlpha = mix(uLook[k0].x * la.a * fa.alpha, uLook[k1].x * lb.a * fb.alpha, fp) * fi * (1.0 - 0.22 * transit);
  }`;

  const FRAG = `#version 300 es
  precision mediump float;
  in vec3 vColor;
  in float vAlpha;
  in float vAngle;
  uniform highp float uDark;
  uniform highp int uShape;
  out vec4 outColor;
  void main() {
    vec2 q = gl_PointCoord - 0.5;
    float m;
    if (uShape == 1) {                                   // pixels
      m = step(max(abs(q.x), abs(q.y)), 0.42);
    } else if (uShape == 2) {                            // registration marks
      float bar = 0.07;
      m = max(step(abs(q.x), bar) * step(abs(q.y), 0.42), step(abs(q.y), bar) * step(abs(q.x), 0.42));
    } else if (uShape == 3) {                            // engraved hatch
      float cs = cos(vAngle), sn = sin(vAngle);
      vec2 r = vec2(cs * q.x + sn * q.y, -sn * q.x + cs * q.y);
      m = smoothstep(0.09, 0.04, abs(r.y)) * smoothstep(0.5, 0.42, abs(r.x));
    } else {                                             // dots
      m = smoothstep(0.5, 0.22, length(q));
    }
    float a = m * vAlpha;
    if (a < 0.01) discard;
    outColor = vec4(mix(mix(vec3(1.0), vColor, a), vColor * a, uDark), 1.0);
  }`;

  /* Process inks on paper, phosphors on screen. */
  const THEMES = {
    light: {
      chan: [[0.0, 0.66, 0.92], [0.93, 0.05, 0.56], [1.0, 0.9, 0.0]],
      pal: [[0.0, 0.6, 0.86], [0.88, 0.12, 0.52], [0.86, 0.62, 0.06], [0.2, 0.3, 0.76], [0.84, 0.24, 0.16], [0.12, 0.58, 0.36], [0.46, 0.22, 0.7]],
      hot: [0.12, 0.32, 0.86],
      bg: [0.9655, 0.9574, 0.941],
    },
    dark: {
      chan: [[1.0, 0.12, 0.1], [0.1, 1.0, 0.28], [0.14, 0.32, 1.0]],
      pal: [[0.25, 0.85, 1.0], [1.0, 0.35, 0.75], [1.0, 0.85, 0.3], [0.45, 0.58, 1.0], [1.0, 0.45, 0.32], [0.38, 1.0, 0.58], [0.76, 0.52, 1.0]],
      hot: [0.12, 0.5, 1.0],
      bg: [0.0358, 0.0398, 0.0463],
    },
  };

  const rotY = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [c * x + s * z, y, -s * x + c * z]; };
  const rotX = (a, [x, y, z]) => { const c = Math.cos(a), s = Math.sin(a); return [x, c * y - s * z, s * y + c * z]; };

  function compile(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh));
    return sh;
  }

  class Engine {
    constructor(canvas, { triplets, layers, reduced = false }) {
      const gl = canvas.getContext('webgl2', { alpha: false, antialias: false, depth: false, powerPreference: 'high-performance' });
      if (!gl) throw new Error('WebGL2 unavailable');
      this.gl = gl;
      this.canvas = canvas;
      this.reduced = reduced;
      this.nT = triplets;
      this.nV = triplets * 3;
      this.texH = Math.ceil(this.nV / TEX_W);
      this.texels = TEX_W * this.texH;

      const prog = gl.createProgram();
      gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
      this.prog = prog;
      gl.useProgram(prog);
      this.u = {};
      const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
      for (let i = 0; i < n; i++) {
        const name = gl.getActiveUniform(prog, i).name.replace(/\[0\]$/, '');
        this.u[name] = gl.getUniformLocation(prog, name);
      }

      this.tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA32F, TEX_W, this.texH, layers);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      this.vao = gl.createVertexArray();
      this.ext = new Array(layers).fill([1, 1]);
      this.ready = new Array(layers).fill(false);
      this.scratch = new Float32Array(TEX_W * this.texH * 4);

      this.states = [];
      this.anchorData = new Float32Array(MAX_STATES * 4);
      this.state = 0;
      this.target = 0;
      this.vel = 0;
      this.terOff = new Float32Array(4);
      this.trail = new Float32Array(8);
      this.clk = new Float32Array(16);
      this.vis = new Float32Array([1, 1, 0]);
      this.head = new Float32Array([-1e4, -1e4, 1, 0]);
      this.cent = new Float32Array(8 * 4);
      this.slot = new Float32Array(8 * 4);
      this.vert = 0;

      this.intro = reduced ? 1 : 0;
      this.introTarget = this.intro;
      this.time = 0;
      this.mouse = { x: -1e4, y: -1e4, tx: -1e4, ty: -1e4, vx: 0, vy: 0, lx: null, ly: null };
      this.tilt = { x: 0, y: 0 };
      this.split = { x: 0, y: 0 };
      this.listeners = [];
      this.before = [];

      gl.uniform1i(this.u.uTexW, TEX_W);
      gl.uniform1i(this.u.uPos, 0);

      this.resize = this.resize.bind(this);
      this.frame = this.frame.bind(this);
      new ResizeObserver(this.resize).observe(canvas);
      this.resize();
      addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse') return;
        this.mouse.tx = e.clientX; this.mouse.ty = e.clientY;
      }, { passive: true });
      document.addEventListener('pointerleave', () => { this.mouse.tx = this.mouse.ty = -1e4; });
      this.setTheme(false);
    }

    /* scene data for a layer */
    upload(layer, field) {
      const gl = this.gl;
      this.scratch.fill(0);
      this.scratch.set(field.data.subarray(0, Math.min(field.data.length, this.scratch.length)));
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.texSubImage3D(gl.TEXTURE_2D_ARRAY, 0, 0, 0, layer, TEX_W, this.texH, 1, gl.RGBA, gl.FLOAT, this.scratch);
      this.ext[layer] = field.ext;
      this.ready[layer] = true;
      this.pushStates();
    }

    /* states: [{ layer, anchor, pad, alpha, size, color, anim, tilt, repel }] in page order */
    setStates(states) { this.states = states; this.pushStates(); }
    setAnchor(i, el, pad) { if (this.states[i]) { this.states[i].anchor = el; if (pad) this.states[i].pad = pad; } }
    pushStates() {
      const gl = this.gl, S = this.states;
      gl.useProgram(this.prog);
      gl.uniform1i(this.u.uCount, S.length);
      gl.uniform1iv(this.u.uLayer, S.map((s) => s.layer).concat(new Array(MAX_STATES - S.length).fill(0)));
      const look = new Float32Array(MAX_STATES * 4), feel = new Float32Array(MAX_STATES * 4);
      S.forEach((s, i) => {
        look.set([this.ready[s.layer] ? s.alpha : 0, s.size, s.color || 0, s.anim || 0], i * 4);
        feel.set([s.tilt ?? 1, s.repel ?? 1, this.ext[s.layer][1], s.split ?? 1], i * 4);
      });
      gl.uniform4fv(this.u.uLook, look);
      gl.uniform4fv(this.u.uFeel, feel);
    }

    /* point shape and transition style, for side-by-side comparison */
    setStyle(points, flow) {
      const SH = { dots: 0, pixels: 1, marks: 2, hatch: 3 }, FL = { swirl: 0, diffuse: 1, scan: 2 };
      const gl = this.gl;
      gl.useProgram(this.prog);
      gl.uniform1i(this.u.uShape, SH[points] ?? 0);
      gl.uniform1i(this.u.uFlow, FL[flow] ?? 0);
    }

    setTheme(dark) {
      const t = THEMES[dark ? 'dark' : 'light'], gl = this.gl;
      gl.useProgram(this.prog);
      gl.uniform3fv(this.u.uChan, t.chan.flat());
      gl.uniform3fv(this.u.uPal, t.pal.flat());
      gl.uniform3fv(this.u.uHot, t.hot);
      gl.uniform1f(this.u.uDark, dark ? 1 : 0);
      this.dark = dark;
      this.bg = t.bg;
    }

    setTrail(arr) { this.trail.set(arr); }
    setVision(nf, ne, down) { this.vis.set([nf, ne, down ? 1 : 0]); }
    setHead(x, y, r, textRight) { this.head.set([x, y, r, textRight]); }
    setCentres(list) { this.cent.fill(0); list.forEach((c, i) => this.cent.set(c, i * 4)); }
    setSlots(list) { this.slot.fill(0); list.forEach((c, i) => this.slot.set(c, i * 4)); }
    setVertical(on) { this.vert = on ? 1 : 0; }

    clockOf(i) { return this.clk[i] || 0; }
    setTerrainOffset(i, [x, y]) { this.terOff[i * 2] = x; this.terOff[i * 2 + 1] = y; }
    setTarget(v) { this.target = Math.max(0, Math.min(this.states.length - 1, v)); }
    setAlpha(i, a) { if (this.states[i] && this.states[i].alpha !== a) { this.states[i].alpha = a; this.pushStates(); } }
    beforePoints(fn) { this.before.push(fn); }
    playIntro() { this.introTarget = 1; }
    onFrame(fn) { this.listeners.push(fn); }

    anchorOf(i) {
      const s = this.states[i];
      const [ex, ey] = this.ext[s.layer];
      if (!s.anchor) return [this.w / 2, this.h / 2, this.w / 2 / ex, this.h / 2 / ey];
      const r = s.anchor.getBoundingClientRect();
      const k = Math.min(r.width / (2 * ex), r.height / (2 * ey)) * (s.pad || 1);
      return [r.left + r.width / 2, r.top + r.height / 2, k, k];
    }

    /* the same transform as the shader, for HTML overlays that must sit on the points */
    project(i, x, y, z = 0) {
      const s = this.states[i], a = this.anchorOf(i);
      let p = [x, y, z];
      if (s.anim === 3) p = rotY(Math.sin(this.time * 0.25) * 0.38 * (this.reduced ? 0 : 1), p);
      const tilt = s.tilt ?? 1;
      p = rotY(this.tilt.x * 0.3 * tilt, rotX(-this.tilt.y * 0.22 * tilt, p));
      const persp = 1 / (1 - Math.max(-1.5, Math.min(1.5, p[2])) * 0.25);
      return { x: a[0] + p[0] * a[2] * persp, y: a[1] + p[1] * a[3] * persp, depth: p[2] };
    }

    resize() {
      this.dpr = Math.min(devicePixelRatio || 1, 2);
      this.w = this.canvas.clientWidth;
      this.h = this.canvas.clientHeight;
      this.canvas.width = Math.round(this.w * this.dpr);
      this.canvas.height = Math.round(this.h * this.dpr);
    }

    start() {
      if (this.running) return;
      this.running = true;
      this.last = performance.now();
      requestAnimationFrame(this.frame);
    }

    frame(now) {
      requestAnimationFrame(this.frame);
      if (document.hidden) { this.last = now; return; }
      const dt = Math.max(0, Math.min((now - this.last) / 1000, 0.05));
      this.last = now;
      const motion = this.reduced ? 0 : 1;
      this.time += dt * motion;

      // a critically damped spring follows the scroll: no jolt when it starts, stops or turns.
      // Its speed is capped, so even a quick flick gives every morph about a second and a half
      // to play out; when it falls far behind (a jump down the page) the cap opens up.
      if (this.reduced || dt <= 0) { if (this.reduced) this.state = this.target; }
      else {
        const T = 0.6, omega = 2 / T, x = omega * dt;
        const ex = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x);
        const lag = Math.abs(this.target - this.state);
        const to = this.target, maxC = (0.75 + 2.2 * Math.max(0, lag - 1.1)) * T;
        const change = Math.max(-maxC, Math.min(maxC, this.state - to));
        const goal = this.state - change;
        const temp = (this.vel + omega * change) * dt;
        this.vel = (this.vel - omega * temp) * ex;
        let out = goal + (change + temp) * ex;
        if ((to - this.state > 0) === (out > to)) { out = to; this.vel = 0; }
        this.state = out;
      }
      this.intro += (this.introTarget - this.intro) * (1 - Math.exp(-dt * 1.7));
      if (this.introTarget === 1 && this.intro > 0.999) this.intro = 1;

      // every scene keeps its own clock while it is on screen, for the stories it plays
      for (let i = 0; i < this.states.length; i++) {
        const d = Math.abs(this.state - i);
        if (d < 0.6) this.clk[i] += dt * motion;
        else if (d > 1.3) this.clk[i] = 0;
      }

      // pointer: smoothed position, tilt, and a chromatic split along its velocity
      const m = this.mouse, k = 1 - Math.exp(-dt * 7);
      if (m.tx < -1e3) { m.x = m.tx; m.y = m.ty; m.lx = null; }
      else {
        m.x += (m.tx - m.x) * k; m.y += (m.ty - m.y) * k;
        if (m.lx !== null && dt > 0) { m.vx += ((m.tx - m.lx) / dt - m.vx) * 0.2; m.vy += ((m.ty - m.ly) / dt - m.vy) * 0.2; }
        m.lx = m.tx; m.ly = m.ty;
      }
      m.vx *= 0.9; m.vy *= 0.9;
      const tx = m.tx < -1e3 ? 0 : (m.tx / this.w) * 2 - 1, ty = m.tx < -1e3 ? 0 : (m.ty / this.h) * 2 - 1;
      this.tilt.x += (tx - this.tilt.x) * k * 0.4;
      this.tilt.y += (ty - this.tilt.y) * k * 0.4;
      const sp = Math.min(Math.hypot(m.vx, m.vy) * 0.012, 16) * motion;
      const ang = Math.atan2(m.vy, m.vx);
      this.split.x += (Math.cos(ang) * sp - this.split.x) * 0.25;
      this.split.y += (Math.sin(ang) * sp - this.split.y) * 0.25;

      const n = this.states.length;
      if (!n) return;
      const k0 = Math.min(n - 1, Math.floor(this.state)), k1 = Math.min(k0 + 1, n - 1);
      this.anchorData.set(this.anchorOf(k0), k0 * 4);
      this.anchorData.set(this.anchorOf(k1), k1 * 4);

      const gl = this.gl, u = this.u;
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(this.bg[0], this.bg[1], this.bg[2], 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
      for (const fn of this.before) fn(gl, this, dt);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      if (this.dark) gl.blendFunc(gl.ONE, gl.ONE);
      else gl.blendFunc(gl.DST_COLOR, gl.ZERO);
      gl.enable(gl.BLEND);
      gl.useProgram(this.prog);
      gl.bindVertexArray(this.vao);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.tex);
      gl.uniform4fv(u.uAnchor, this.anchorData);
      gl.uniform2f(u.uRes, this.w, this.h);
      gl.uniform2f(u.uMouse, m.x, m.y);
      gl.uniform2f(u.uTilt, this.tilt.x * motion, this.tilt.y * motion);
      gl.uniform2f(u.uSplit, this.split.x, this.split.y);
      gl.uniform1f(u.uState, this.state);
      gl.uniform1f(u.uTime, this.time);
      gl.uniform1f(u.uIntro, this.intro);
      gl.uniform1f(u.uMotion, motion);
      gl.uniform1f(u.uDpr, this.dpr);
      gl.uniform4fv(u.uClk, this.clk);
      gl.uniform3fv(u.uVis, this.vis);
      gl.uniform4fv(u.uHead, this.head);

      gl.uniform4fv(u.uCent, this.cent);
      gl.uniform4fv(u.uSlot, this.slot);
      gl.uniform1f(u.uVert, this.vert);

      gl.uniform2fv(u.uTer, this.terOff);
      gl.uniform2fv(u.uTrail, this.trail);
      const vis = (i) => (this.ready[this.states[i].layer] ? this.states[i].alpha : 0);
      if (vis(k0) + vis(k1) > 0.001) gl.drawArrays(gl.POINTS, 0, this.nV);

      for (const fn of this.listeners) fn(this, dt);
    }
  }

  SA.Engine = Engine;
})();
