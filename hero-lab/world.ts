// Neurals as a navigable 3D neural network. Everything drawn is live project data: the real
// architecture (embedding, 28 layers of 12 attention heads and 35 neuron columns, unembedding),
// what is bought on the curve, how hard each part fires across recent paid messages, the measured
// traits, and one real paid message replayed from its receipt. Four shapes, one look and one key.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { CSS2DRenderer, CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { LineSegments2 } from 'three/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

// Lines a pinch thicker than WebGL's one pixel: every line batch goes through here.
const fatMats: LineMaterial[] = [];
function fat(pos: number[], col: number[], width = 1.6, opacity = 0.85, dashed = false) {
  const g = new LineSegmentsGeometry().setPositions(pos).setColors(col);
  const m = new LineMaterial({ vertexColors: true, linewidth: Math.max(1, width * 0.55), transparent: true, opacity, depthWrite: false, dashed, dashSize: 0.6, gapSize: 0.5 });
  m.resolution.set(innerWidth, innerHeight); fatMats.push(m);
  const l = new LineSegments2(g, m); if (dashed) l.computeLineDistances(); return l;
}
import { load, cj, describe, rng, wires, API, STAGE_NAMES, type Net, type Node } from './data.ts';
import * as flat from './draw2d.ts';
const COMPARE = !location.search || new URLSearchParams(location.search).has('compare'); // plain 5212 is the compare page
const Q = new URLSearchParams(COMPARE ? 'embed&theme=paper&white=1&compare' : location.search);

const RECEIPT = 'a03457a6d5f5020497ca1393de73dcb288946c2606ea8a77de443cc7476f3e38';
const STAGE = ['#36f5d0', '#4d7dff', '#3dff6e', '#c8ff3d', '#ffaa2b', '#ff4b6e'];
const TRAIT: Record<number, string> = { 100: 'super weight', 85: 'induction head', 70: 'massive activation', 50: 'attention sink', 30: 'monosemantic' };
const STARTS = [0, 4, 8, 14, 20, 25];
const STAGE_COL = STAGE.map((h) => new THREE.Color(h).multiplyScalar(1.25));
// colour palettes: the stage colours inner to outer, and the page behind
const PALETTES: Record<string, { stages: string[]; body: string }> = {
  original: { stages: ['#36f5d0', '#4d7dff', '#3dff6e', '#c8ff3d', '#ffaa2b', '#ff4b6e'], body: 'original' },
  kimura: { stages: ['#8fe3c4', '#c4a6ff', '#8b4dff', '#b6ff2e', '#f6b3a6', '#5b22d6'], body: 'kimura' },
  planet: { stages: ['#ece6e3', '#9ed8de', '#4fa8b8', '#2f5d8c', '#b29ad6', '#e7a0b6'], body: 'kimura' },
  blues: { stages: ['#9fe6e2', '#5ed0cc', '#2db4b4', '#18929a', '#0f6e76', '#0a4c54'], body: 'kimura' },
  duo: { stages: ['#0a4c54', '#3fb6b8', '#0a4c54', '#3fb6b8', '#0a4c54', '#3fb6b8'], body: 'kimura' },
  ink: { stages: ['#111111', '#555555', '#111111', '#555555', '#111111', '#555555'], body: 'kimura' },
  cobalt: { stages: ['#0b1f6b', '#2a5dff', '#0b1f6b', '#2a5dff', '#0b1f6b', '#2a5dff'], body: 'kimura' },
  forest: { stages: ['#0f3d2a', '#1d6b3c', '#3f9a5a', '#0f3d2a', '#1d6b3c', '#3f9a5a'], body: 'kimura' },
  sunset: { stages: ['#3a1050', '#7a1f5c', '#c2304a', '#e2471f', '#ff8a1f', '#f2b705'], body: 'kimura' },
  psychedelic: { stages: ['#8a4dff', '#ff4fd8', '#f2b705', '#ff5a1f', '#e0207a', '#13b8c8'], body: 'kimura' },
  rust: { stages: ['#4a160b', '#b8381a', '#e2471f', '#4a160b', '#b8381a', '#e2471f'], body: 'kimura' },
  gold: { stages: ['#16120a', '#b8911f', '#16120a', '#b8911f', '#16120a', '#b8911f'], body: 'kimura' },
  hud: { stages: ['#eceaf4', '#9fd8e0', '#5aa9c9', '#b49be8', '#f0a6c4', '#7e8fe0'], body: 'kimura' },
  poster: { stages: ['#ffe20a', '#1d6b3c', '#e2471f', '#212321', '#2666d6', '#b8381a'], body: 'kimura' },
  bitmap: { stages: ['#ffe20a', '#16c75f', '#2a5dff', '#222423', '#e2471f', '#ff3fa4'], body: 'kimura' },
};
let palette = 'original';
function setPalette(name: string) {
  palette = name; const p = PALETTES[name];
  STAGE.splice(0, STAGE.length, ...p.stages);
  STAGE_COL.splice(0, STAGE_COL.length, ...p.stages.map((h) => new THREE.Color(h).multiplyScalar(1.1)));
  document.body.dataset.palette = p.body;
  scene.background = name === 'original' ? new THREE.Color('#010302') : null;
  renderer.setClearColor(0x000000, name === 'original' ? 1 : 0);
}
const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ---------------------------------------------------------------- shapes
// Each shape places every part, plus where text comes in and words go out.
type Shape = { name: string; place: (n: Node, i: number) => THREE.Vector3; input: THREE.Vector3; output: THREE.Vector3; stageAt: (s: number) => THREE.Vector3; extra?: (g: THREE.Group, net: Net) => void };
const DOME = (s: number) => 8 + s * 3.8;
// one thin skin per real layer: tight within a stage, a clear gap between stages
const LR = (l: number) => { const s = STARTS.filter((x) => l >= x).length - 1; return 7 + s * 4.2 + (l - STARTS[s]) * 1.05 + (l > 0 ? 0 : 0); };
const SHELL = (s: number) => LR((s < 5 ? STARTS[s + 1] : 28) - 1);  // dome radius per stage
const OR = (l: number) => 5 + l * 1.8;      // first onion: a shell per layer
let PAPER_BG = '#e3dfd6';
// ---------------------------------------------------------------- the blob (rejected, kept for reference)
// A hairy planet: every real part is a patch of fine spikes on a sphere. The six stages wrap the sphere
// as warped colour bands, top to bottom. A spike's length is how hard its part fires, plus a slow moving
// noise so the surface breathes; bought parts stand taller, yours are white, traits have aqua tips, and
// the spikes rise under the cursor.
// ---------------------------------------------------------------- strata, take two: arched 3D bands
// Each layer an arch with depth, narrow at the top and widening down towards the core, like the poster.
// Every stage drawn its own way and packed dense; every element a real part.
const SA_Y = (l: number) => 46 - l * 2.5 - (STARTS.filter((x) => x > 0 && l >= x).length) * 3.2;
const SA_W = (l: number) => (l < 4 ? 12 + l * 4.5 : 30 + l * 0.18); // a circuit crown on top, then wide bands all the way down, like the poster
const SA_SAG = (l: number) => (l < 4 ? 5 - l * 0.6 : 3 + l * 0.12);
const SA_TH = (u: number) => u * Math.PI; // the full way round: a cylinder
// each layer a horseshoe vault in plan: u runs round the arch, z is depth out from it
const SA_AT = (l: number, u: number, z = 0) => { const r = SA_W(l) + z, t = SA_TH(u); return V(r * Math.sin(t), SA_Y(l), r * Math.cos(t)); };
const SA_T = (u: number) => V(Math.cos(SA_TH(u)), 0, -Math.sin(SA_TH(u)));
const STR_POS = (l: number, i: number) => SA_AT(l, (i / 47) * 2 - 1, i % 2 ? 1.6 : -1.6);
const STR_Y = SA_Y; void STR_Y;
const STR_CORE = () => V(0, SA_Y(27) - SA_SAG(27) - 9, 0);
let strataTick: ((t: number) => void) | null = null;
let tourHook: ((now: number) => void) | null = null; // set by the virtual tour, which lives inside the view bar setup
const fsNow = [1, 1, 1, 1, 1, 1]; // each stage's current sideways stretch, so zoom windows can follow it
let cove: THREE.Mesh | null = null;
let STR_PART = false; // strata drawn as particles instead of solid lines
function strataParts(g: THREE.Group, net: Net) {
  const bg = new THREE.Color(PAPER_BG), rr = rng(21), up = V(0, 1, 0), X = V(1, 0, 0), Z = V(0, 0, 1);
  const B = Array.from({ length: 7 }, () => ({ p: [] as number[], c: [] as number[] }));
  const dots = Array.from({ length: 7 }, () => ({ p: [] as number[], c: [] as number[] }));
  const HB = Array.from({ length: 7 }, () => ({ p: [] as number[], c: [] as number[] })); let hi = false, curMine: Node | null = null;
  const MP = new Map<number, { p: number[]; c: number[]; c2: number[]; s: number }>();
  const add = (s: number, a: THREE.Vector3, b: THREE.Vector3, col: THREE.Color) => { if (curMine) { const e = MP.get(curMine.part) ?? MP.set(curMine.part, { p: [], c: [], c2: [], s: curMine.stage }).get(curMine.part)!, pl = LC(curMine.layer!).lerp(bg, 0.3 * (1 - curMine.fire)); e.p.push(a.x, a.y, a.z, b.x, b.y, b.z); e.c.push(col.r, col.g, col.b, col.r, col.g, col.b); e.c2.push(pl.r, pl.g, pl.b, pl.r, pl.g, pl.b); return; } if (hi) { HB[s].p.push(a.x, a.y, a.z, b.x, b.y, b.z); HB[s].c.push(col.r, col.g, col.b, col.r, col.g, col.b); return; } B[s].p.push(a.x, a.y, a.z, b.x, b.y, b.z); B[s].c.push(col.r, col.g, col.b, col.r, col.g, col.b); };
  const poly = (s: number, pts: THREE.Vector3[], col: THREE.Color, close = false) => { for (let k = 0; k + 1 < pts.length; k++) add(s, pts[k], pts[k + 1], col); if (close) add(s, pts[pts.length - 1], pts[0], col); };
  const box = (s: number, c0: THREE.Vector3, w: number, h: number, col: THREE.Color, ax = X) => poly(s, [c0.clone().addScaledVector(ax, -w).add(V(0, -h, 0)), c0.clone().addScaledVector(ax, w).add(V(0, -h, 0)), c0.clone().addScaledVector(ax, w).add(V(0, h, 0)), c0.clone().addScaledVector(ax, -w).add(V(0, h, 0))], col, true);
  const ring = (s: number, c0: THREE.Vector3, r: number, col: THREE.Color, ax = X, ay = up) => poly(s, Array.from({ length: 14 }, (_, k) => c0.clone().addScaledVector(ax, Math.cos(k / 14 * 6.283) * r).addScaledVector(ay, Math.sin(k / 14 * 6.283) * r)), col, true);
  const dot = (s: number, p: THREE.Vector3, col: THREE.Color) => { dots[s].p.push(p.x, p.y, p.z); dots[s].c.push(col.r, col.g, col.b); };
  const arcLine = (s: number, l: number, dy: number, z: number, col: THREE.Color, jitter = 0) => { const pts: THREE.Vector3[] = []; for (let k = 0; k <= 80; k++) { const u = k / 40 - 1; pts.push(SA_AT(l, u, z).add(V(0, dy + (jitter ? (rr() - 0.5) * jitter : 0), 0))); } poly(s, pts, col); };
  // every layer its own colour: the palette's six stops spread across all 28 layers
  const LC = (l: number) => { const f = (l / 27) * 5, a = Math.floor(f), b = Math.min(5, a + 1); return new THREE.Color(STAGE[a]).lerp(new THREE.Color(STAGE[b]), f - a); };
  // from the live data: a part you hold is drawn pink, a part someone else bought orange, the rest in its layer's colour
  const colOf = (n: Node, s: number, k = 0.3) => (n.mine ? new THREE.Color(PINK) : n.sold > 0 ? new THREE.Color(SOLD) : LC(n.layer ?? (s === 5 ? 27 : 0)).lerp(bg, k * (1 - n.fire)));
  const Wc = Array.from({ length: 6 }, () => ({ p: [] as number[], c: [] as number[] }));
  for (let l = 0; l < 28; l++) {
    const L = net.layers[l], s = L[0].stage, base = LC(l);
    if (s === 0) { arcLine(0, l, -0.9, 0, base); arcLine(0, l, -1.2, 0, base.clone().lerp(bg, 0.4)); }
    if (s === 1) { arcLine(1, l, 0.7, -1.6, base); arcLine(1, l, 0.7, 1.6, base); }
    if (s === 4) for (let k = 0; k < 6; k++) arcLine(4, l, -0.4 - k * 0.35, (rr() - 0.5) * 3, base.clone().lerp(bg, 0.15 + rr() * 0.4), 0.35);
    if (s === 5) for (let k = 0; k < 7; k++) for (let j = 0; j <= 120; j++) { const u = j / 60 - 1; dot(5, SA_AT(l, u, (k - 3) * 0.6).add(V(0, -0.3 - k * 0.22 + (rr() - 0.5) * 0.2, 0)), base.clone().lerp(bg, 0.25 + rr() * 0.4)); }
    L.forEach((n, i) => {
      const p = STR_POS(l, i), col = colOf(n, s), T = SA_T((i / 47) * 2 - 1); curMine = n.mine ? n : null; hi = !n.mine && n.sold > 0;
      if (s === 0) { // circuit: pad, via, right-angled trace up to the layer above (or text in)
        box(0, p, 0.32, 0.32, col, T); box(0, p, 0.12, 0.12, col, T);
        const tgt = l === 0 ? V(0, SA_Y(0) + 9, 0) : STR_POS(l - 1, i), mid = V(p.x, (p.y + tgt.y) / 2 + 0.6, p.z);
        poly(0, [p.clone().add(V(0, 0.32, 0)), mid, V(tgt.x, mid.y, tgt.z), tgt], col.clone().lerp(bg, 0.2));
      } else if (s === 1) { // gate cells: a box with its gate mark, wired down to the cell below
        box(1, p, 0.5, 0.45, col, T); add(1, p.clone().add(V(-0.2, 0.25, 0)), p.clone().add(V(-0.2, -0.25, 0)), col); add(1, p.clone().add(V(-0.2, 0, 0)), p.clone().add(V(0.32, 0, 0)), col);
        box(1, p, 0.18, 0.18, col.clone().lerp(bg, 0.35), T);
        if (l < 27) add(1, p.clone().add(V(0, -0.45, 0)), STR_POS(l + 1, i).add(V(0, 0.5, 0)), col.clone().lerp(bg, 0.45));
      } else if (s === 2) { // hanging chains: drop, resistor zigzag, capsule, bead
        const a = p.clone(), b = p.clone().add(V(0, -0.7, 0)); add(2, a, b, col);
        const zz = [b]; for (let k = 1; k <= 6; k++) zz.push(b.clone().add(V((k % 2 ? 0.18 : -0.18), -k * 0.13, 0))); poly(2, zz, col);
        const c1 = zz[zz.length - 1].clone().add(V(0, -0.45, 0)); box(2, c1, 0.2, 0.35, col, T); ring(2, c1.clone().add(V(0, -0.75, 0)), 0.28, col, T); dot(2, c1.clone().add(V(0, -0.75, 0)), col);
      } else if (s === 3) { // neurons: a body with dendrites branching down and a few up
        ring(3, p, 0.22, col, T); dot(3, p, col);
        const br = (a: THREE.Vector3, d: THREE.Vector3, len: number, depth: number) => { const b = a.clone().addScaledVector(d, len); add(3, a, b, col); if (depth > 0) for (const sg of [-1, 1]) br(b, d.clone().addScaledVector(X, sg * 0.55).addScaledVector(Z, (rr() - 0.5) * 0.6).normalize(), len * 0.65, depth - 1); };
        br(p, up.clone().negate(), 0.9 + n.fire * 0.9, 3); br(p, up, 0.5, 1);
      } else if (s === 4) { // filaments: lightning down into the band, as strong as the part fires
        let a = p.clone(); const steps = 4 + Math.round(n.fire * 4);
        for (let k = 0; k < steps; k++) { const b = a.clone().add(V((rr() - 0.5) * 0.7, -0.35, (rr() - 0.5) * 0.5)); add(4, a, b, col); if (rr() < 0.35) add(4, b, b.clone().add(V((rr() - 0.5) * 0.9, -0.3, 0)), col); a = b; }
        ring(4, p, 0.16, col, T);
      } else { // prediction cells: a marked cell in the dotted band
        ring(5, p, 0.3, col, T); dot(5, p, new THREE.Color(STAGE[0]));
      }
      hi = false; curMine = null;
      // a thin wire from every part to the same part on the next layer, so the whole thing is joined up
      if (l < 27 && s !== 1) { const q = STR_POS(l + 1, i), c2 = col.clone().lerp(bg, 0.25); Wc[s].p.push(p.x, p.y, p.z, q.x, q.y, q.z); Wc[s].c.push(c2.r, c2.g, c2.b, c2.r, c2.g, c2.b); }
    });
  }
  // the core: sunburst rays from words out to every final part and beyond, dotted ground beneath
  const core = STR_CORE(), cc = new THREE.Color(STAGE[0]);
  net.layers[27].forEach((n, i) => add(6, core, STR_POS(27, i), colOf(n, 5, 0.5)));
  for (let k = 0; k < 140; k++) { const d = V(rr() - 0.5, -rr() * 0.8 - 0.1, rr() - 0.5).normalize(), r = 5 + rr() * 10; add(6, core.clone().addScaledVector(d, 1.6), core.clone().addScaledVector(d, r), cc.clone().lerp(bg, 0.25 + rr() * 0.4)); }
  for (let k = 0; k < 7; k++) { const r = 6 + k * 4.5, n = Math.round(r * 9); for (let j = 0; j < n; j++) { const a = (j / n) * 6.283; dot(6, core.clone().add(V(Math.cos(a) * r, -6 - k * 0.6, Math.sin(a) * r)), cc.clone().lerp(bg, 0.2 + k * 0.08)); } }
  ring(6, core, 2.2, cc); ring(6, core, 2.2, cc, Z); ring(6, core, 3, cc.clone().lerp(bg, 0.3), X, Z);
  for (let k = 0; k < 7; k++) { const ang = (k - 3) * 0.32, ax = V(Math.cos(ang), 0, -Math.sin(ang)), rad = 7 + (k % 3) * 3.5, pts: THREE.Vector3[] = []; for (let j = 0; j <= 60; j++) { const a = Math.PI * 0.12 + Math.PI * 0.76 * (j / 60); pts.push(V(0, SA_Y(0) + 3, 0).addScaledVector(ax, Math.cos(a) * rad).add(V(0, Math.sin(a) * rad * 0.55, 0))); } poly(6, pts, cc.clone().lerp(bg, 0.15 + (k % 3) * 0.15)); }
  const stageOf = (s: number) => (s === 6 ? 5 : s);
  // studio: a white floor under the brain that only takes its soft shadow
  // a photo studio sweep: white floor curving up into a back wall, always behind the brain as it turns
  { const fy = STR_CORE().y - 11, R0 = 45, sh = new THREE.Shape(), T = 1;
    sh.moveTo(260, 0); sh.lineTo(-70, 0); sh.absarc(-70, R0, R0, -Math.PI / 2, -Math.PI, true); sh.lineTo(-70 - R0, 340); sh.lineTo(-70 - R0 - T, 340); sh.lineTo(-70 - R0 - T, R0); sh.absarc(-70, R0, R0 + T, -Math.PI, -Math.PI / 2, false); sh.lineTo(260, -T); sh.closePath();
    const geo = new THREE.ExtrudeGeometry(sh, { depth: 800, bevelEnabled: false, curveSegments: 48 }).translate(0, 0, -400).rotateY(-Math.PI / 2);
    cove = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: '#f7f7f5' })); cove.position.y = fy; g.add(cove);
    // the shadow lies on its own clear layer over the white, so it stays crisp and defined
    const catcher = new THREE.Mesh(geo, new THREE.ShadowMaterial({ opacity: 0.07, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })); catcher.receiveShadow = true; cove.add(catcher); } // the shadow runs across the floor and up the curve
  // alive: beads travel along every line of the drawing, more runners go the full way from text in to
  // words out, and each stage breathes with a slow horizontal stretch that ripples down the layers
  const FS = (st: number, t: number) => 1 + 0.045 * Math.sin(t * 0.9 - st * 0.75);
  { const cols = Array.from({ length: 47 }, (_, i) => [V(0, SA_Y(0) + 9, 0), ...Array.from({ length: 28 }, (_, l) => STR_POS(l, i)), STR_CORE()]);
    const stOfL = (l: number) => STARTS.filter((x) => l >= x).length - 1;
    const runners = Array.from({ length: 160 }, () => ({ i: Math.floor(rr() * 47), ph: rr() * 29, sp: 2 + rr() * 2.4 }));
    // segment beads, spread over the whole drawing by line length
    const segs: { a: THREE.Vector3; b: THREE.Vector3; st: number }[] = [];
    B.forEach((bt, st) => { for (let k = 0; k < bt.p.length; k += 6) segs.push({ a: V(bt.p[k], bt.p[k + 1], bt.p[k + 2]), b: V(bt.p[k + 3], bt.p[k + 4], bt.p[k + 5]), st: stageOf(st) }); });
    const tot = segs.reduce((x, sg) => x + sg.a.distanceTo(sg.b), 0), NB = 900, cum: number[] = []; let acc = 0; for (const sg of segs) { acc += sg.a.distanceTo(sg.b); cum.push(acc); }
    const beads = Array.from({ length: NB }, () => { const r0 = rr() * tot; let lo = 0, hi = cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < r0) lo = m + 1; else hi = m; } return { sg: segs[lo], ph: rr(), sp: 0.4 + rr() * 0.8 }; });
    const N = runners.length + NB, m = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.05 }), N), mx = new THREE.Matrix4(), c = new THREE.Color(), P = V(0, 0, 0);
    beads.forEach((bd, k) => m.setColorAt(runners.length + k, c.set(STAGE[bd.sg.st]).lerp(new THREE.Color('#ffffff'), 0.15)));
    m.userData.signals = true; g.add(m); // the travelling signal dots (the tour hides them to keep it simple)
    const bubble = makeBubble(g);
    // stepped like a clock: positions jump on 12 ticks a second, with a small jitter each tick
    const hj = (k: number, n: number) => { const x = Math.sin(k * 127.1 + n * 311.7) * 43758.5453; return x - Math.floor(x) - 0.5; };
    strataTick = (t0: number) => { const tick = Math.floor(t0 * 12), t = tick / 12; bubble(t0);
      for (let st = 0; st < 6; st++) fsNow[st] = FS(st, t0);
      g.children.forEach((o) => { if (o !== m && o.userData.stage !== undefined && o.userData.stage !== 6) { const f = FS(o.userData.stage, t0); o.scale.set(f, 1, f); } });
      runners.forEach((sg, k) => { const u = (sg.ph + t * sg.sp) % 29, a = Math.floor(u), f = u - a, path = cols[sg.i]; P.copy(path[a]).lerp(path[Math.min(29, a + 1)], Math.round(f * 4) / 4); P.x += hj(k, tick) * 0.25; P.y += hj(k + 99, tick) * 0.25; const l = Math.min(27, Math.max(0, a - 1)), fs = FS(stOfL(l), t0); P.x *= fs; P.z *= fs; const sc = hidden.has(stOfL(l)) ? 0 : 0.3 * Math.min(1, u / 1.2, 29 - u); mx.makeScale(sc, sc, sc).setPosition(P); m.setMatrixAt(k, mx); m.setColorAt(k, LC(l)); });
      beads.forEach((bd, k) => { const u = (bd.ph + t * bd.sp) % 1; P.copy(bd.sg.a).lerp(bd.sg.b, Math.round(u * 5) / 5); P.x += hj(k + 7, tick) * 0.12; P.y += hj(k + 13, tick) * 0.12; const fs = FS(bd.sg.st, t0); P.x *= fs; P.z *= fs; const sc = hidden.has(bd.sg.st) ? 0 : 0.13 * Math.sin(Math.PI * u); mx.makeScale(sc, sc, sc).setPosition(P); m.setMatrixAt(runners.length + k, mx); });
      m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true;
    };
  }
  if (STR_PART) { // particles: every line sampled into small dots, so the shapes are made of points
    const pp: number[] = [], pc: number[] = [], A = V(0, 0, 0), Bv = V(0, 0, 0);
    const sample = (b: { p: number[]; c: number[] }, step: number) => { for (let k = 0; k < b.p.length; k += 6) { A.fromArray(b.p, k); Bv.fromArray(b.p, k + 3); const m = Math.max(1, Math.round(A.distanceTo(Bv) / step)); for (let j = 0; j <= m; j++) { const t = j / m; pp.push(A.x + (Bv.x - A.x) * t, A.y + (Bv.y - A.y) * t, A.z + (Bv.z - A.z) * t); pc.push(b.c[k], b.c[k + 1], b.c[k + 2]); } } };
    B.forEach((b) => sample(b, 0.32)); Wc.forEach((w) => sample(w, 0.75)); dots.forEach((d) => { pp.push(...d.p); pc.push(...d.c); });
    // each particle a small lit sphere, so the dots have real depth and shading
    const n = pp.length / 3, o = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.085, 1), new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.05 }), n), mx = new THREE.Matrix4(), c = new THREE.Color();
    for (let k = 0; k < n; k++) { mx.makeTranslation(pp[k * 3], pp[k * 3 + 1], pp[k * 3 + 2]); o.setMatrixAt(k, mx); o.setColorAt(k, c.setRGB(pc[k * 3], pc[k * 3 + 1], pc[k * 3 + 2])); }
    o.castShadow = true; g.add(o); return;
  }
  // each part you hold drawn twice, pink and plain, so it can be switched on and off from the my neurons box
  MP.forEach((e, part) => { const pink = tubes(e.p, e.c, 0.12), plain = tubes(e.p, e.c2, 0.085); for (const o of [pink, plain]) { o.castShadow = true; o.userData.stage = e.s; g.add(o); } mineMeshes.set(part, { pink, plain }); });
  applyMine();
  HB.forEach((b, s) => { if (b.p.length) { const o = tubes(b.p, b.c, 0.12); o.castShadow = true; o.userData.stage = s; g.add(o); } });
  Wc.forEach((w, s) => { if (w.p.length) { const o = tubes(w.p, w.c, 0.028); o.castShadow = true; o.userData.stage = s; g.add(o); } });
  B.forEach((b, s) => { if (b.p.length) { const o = tubes(b.p, b.c, s === 6 ? 0.055 : 0.065); o.castShadow = true; o.userData.stage = stageOf(s); g.add(o); } });
  dots.forEach((d, s) => { if (d.p.length) { const n = d.p.length / 3, m = new THREE.InstancedMesh(beadGeo, new THREE.MeshStandardMaterial({ roughness: 0.4, metalness: 0.05 }), n), mx = new THREE.Matrix4(), c = new THREE.Color(); for (let k = 0; k < n; k++) { mx.makeTranslation(d.p[k * 3], d.p[k * 3 + 1], d.p[k * 3 + 2]); m.setMatrixAt(k, mx); c.setRGB(d.c[k * 3], d.c[k * 3 + 1], d.c[k * 3 + 2]); m.setColorAt(k, c); } m.userData.stage = stageOf(s); g.add(m); } });
}

// ---------------------------------------------------------------- chip: a brain as a silver microchip
// Words out is the die in the middle; every layer is a ring of pads round it, text in at the outer edge.
// Each stage is its own kind of metal part, traces run in from ring to ring, sold parts are bright
// chrome, unsold are gunmetal, yours are black chrome.
const CH_GAP = (l: number) => STARTS.filter((x) => x > 0 && l >= x).length;
const CH_R = (l: number) => 13 + (27 - l) * 1.45 + (5 - CH_GAP(l)) * 2.6;
const CH_STEP = 0, CH_H = (l: number) => CH_GAP(l) * CH_STEP;
const CH_A = (l: number, i: number) => (i / 47) * Math.PI * 2;
let CH_SQ = false; // the traditional package tab lays every ring out as a square
const CH_SQPT = (R: number, t: number) => { const u = ((t % 1) + 1) % 1 * 4, sd = Math.floor(u), al = -R + 2 * R * (u - sd); return sd === 0 ? V(al, 0, -R) : sd === 1 ? V(R, 0, al) : sd === 2 ? V(-al, 0, R) : V(-R, 0, -al); };
const CH_RING = (R: number, t: number) => (CH_SQ ? CH_SQPT(R * 0.84, t + 0.5 / 47) : V(Math.cos(t * 6.2832) * R, 0, Math.sin(t * 6.2832) * R));
const CH_POS = (l: number, i: number) => CH_RING(CH_R(l), i / 47).setY(CH_H(l));
const CH_IN = (i: number) => (CH_SQ ? CH_SQPT(10.4, i / 47 + 0.5 / 47) : V(Math.cos((i / 47) * 6.2832) * 7.6, 0, Math.sin((i / 47) * 6.2832) * 7.6));
const CH_DIE_H = 3.2;
let envTex: THREE.Texture | null = null;
// a brushed gold board drawn once: etched traces routed in from the edges, via rows, connector blocks
const goldCv: Record<string, HTMLCanvasElement> = {};
function goldCanvas(grey = false) {
  const key = grey ? 'g' : 'c'; if (goldCv[key]) return goldCv[key];
  const W = 2048, H = 1280, cv = document.createElement('canvas'); cv.width = W; cv.height = H; const g = cv.getContext('2d')!, r = rng(7);
  g.fillStyle = grey ? '#9a9a9a' : '#d7ae2c'; g.fillRect(0, 0, W, H);
  for (let k = 0; k < 9000; k++) { const lt = r() < 0.5; g.strokeStyle = grey ? (lt ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)') : (lt ? 'rgba(255,236,150,0.07)' : 'rgba(110,80,0,0.07)'); g.lineWidth = 1; const y = r() * H, x = r() * W; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 60 + r() * 300, y); g.stroke(); }
  // etched copper: traces routed radially out from the middle, then a ring of vias, like a real test board
  const cx = W / 2, cy = H / 2; g.lineCap = 'round';
  for (let k = 0; k < 220; k++) {
    const a = (k / 220) * Math.PI * 2, r0 = 520 + r() * 40, r1 = r0 + 120 + r() * 200, bend = r() < 0.5 ? 0.06 : -0.06;
    g.strokeStyle = grey ? '#ffffff' : 'rgba(96,70,4,0.85)'; g.lineWidth = 2.2; g.beginPath();
    g.moveTo(cx + Math.cos(a) * r0, cy + Math.sin(a) * r0 * 0.62); g.lineTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1 * 0.62); g.lineTo(cx + Math.cos(a + bend) * (r1 + 60), cy + Math.sin(a + bend) * (r1 + 60) * 0.62); g.stroke();
    g.fillStyle = grey ? '#ffffff' : 'rgba(96,70,4,0.9)'; g.beginPath(); g.arc(cx + Math.cos(a + bend) * (r1 + 60), cy + Math.sin(a + bend) * (r1 + 60) * 0.62, 4.5, 0, 7); g.fill();
    g.fillStyle = grey ? '#9a9a9a' : '#e6c040'; g.beginPath(); g.arc(cx + Math.cos(a + bend) * (r1 + 60), cy + Math.sin(a + bend) * (r1 + 60) * 0.62, 1.8, 0, 7); g.fill();
  }
  return (goldCv[key] = cv);
}
function chipEnv() { if (!envTex) { const pm = new THREE.PMREMGenerator(renderer); envTex = pm.fromScene(new RoomEnvironment(), 0.04).texture; } return envTex; }
// the chip drawn as etched black lines on the gold plate: pads, vias, boxes and traces, a little pixelated
const CH_SPAN = 170, CH_PX = 3072;
let CH_GREEN = false; // the green board tab: solder mask with silver solder pads and tinned wires
function chipArt(net: Net, grey: boolean, metalMap = false) {
  const cv = document.createElement('canvas'); cv.width = cv.height = CH_PX; const g = cv.getContext('2d')!, r = rng(11);
  const S = CH_PX / CH_SPAN, C = CH_PX / 2, P = (v: THREE.Vector3) => [C + v.x * S, C + v.z * S] as const;
  const BASE = metalMap ? '#000000' : grey ? '#808080' : CH_GREEN ? '#0b3d1c' : '#d4ab2a'; g.fillStyle = BASE; g.fillRect(0, 0, CH_PX, CH_PX);
  for (let k = 0; k < (CH_GREEN || metalMap ? 0 : 14000); k++) { const lt = r() < 0.5; g.strokeStyle = grey ? (lt ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.12)') : (lt ? 'rgba(255,236,150,.08)' : 'rgba(110,80,0,.08)'); g.lineWidth = 1; const y = r() * CH_PX, x = r() * CH_PX; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 80 + r() * 400, y); g.stroke(); }
  const ink = grey || metalMap ? '#ffffff' : CH_GREEN ? '#d9d9d2' : '#1a1405', gold = BASE;
  g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 2.4; g.lineCap = 'square'; g.lineJoin = 'miter';
  const at = (x: number, y: number, a: number, f: () => void) => { g.save(); g.translate(x, y); g.rotate(a); f(); g.restore(); };
  const circ = (x: number, y: number, rad: number, fill = false) => { g.beginPath(); g.arc(x, y, rad, 0, 7); fill ? g.fill() : g.stroke(); };
  // stage borders: a dotted ring, and a ring of little boxes where the poster has its row of resistors
  for (let s = 1; s < 6; s++) { const rad = (CH_R(STARTS[s]) + CH_R(STARTS[s] - 1)) / 2, n = Math.round(rad * S / 9); for (let k = 0; k < n; k++) { const [x, y] = P(CH_RING(rad, k / n)); circ(x, y, 2.2, true); } }
  { const rad = CH_R(STARTS[3]) + 1.2, n = 150; g.lineWidth = 2; for (let k = 0; k < n; k++) { const v = CH_RING(rad, k / n), [x, y] = P(v); at(x, y, Math.atan2(v.z, v.x), () => g.strokeRect(-14, -5, 28, 10)); } }
  // the parts: fourteen kinds of mark, so with the four line styles no two layers look alike;
  // sold filled, unsold open, yours double ringed
  const poly = (pts: number[][], fill: boolean) => { g.beginPath(); pts.forEach(([x, y], k) => (k ? g.lineTo(x, y) : g.moveTo(x, y))); g.closePath(); fill ? g.fill() : g.stroke(); };
  for (let l = 0; l < 28; l++) net.layers[l].forEach((n) => {
    const i = net.layers[l].indexOf(n), pv = CH_POS(l, i), a = CH_SQ ? (Math.abs(pv.x) > Math.abs(pv.z) ? (pv.x > 0 ? 0 : Math.PI) : (pv.z > 0 ? Math.PI / 2 : -Math.PI / 2)) : Math.atan2(pv.z, pv.x), [x, y] = P(pv), u = 0.42 * S, f = n.sold > 0; g.lineWidth = 2.2;
    const box = (x0: number, y0: number, w: number, h: number, fill = f) => (fill ? g.fillRect(x0, y0, w, h) : g.strokeRect(x0, y0, w, h));
    at(x, y, a, () => {
      switch (l % 14) {
        case 0: box(-u * 0.45, -u * 0.95, u * 0.9, u * 0.7); box(-u * 0.45, u * 0.25, u * 0.9, u * 0.7); break;           // twin pads
        case 1: circ(0, 0, u * 0.62); circ(0, 0, u * 0.24, true); if (f) circ(0, 0, u * 0.85); break;                       // via
        case 2: box(-u * 0.9, -u * 0.32, u * 1.8, u * 0.64); circ(u * 1.25, 0, u * 0.2, true); break;                       // long pad and dot
        case 3: g.strokeRect(-u * 0.6, -u * 0.6, u * 1.2, u * 1.2); box(-u * 0.28, -u * 0.28, u * 0.56, u * 0.56); break;   // square in square
        case 4: circ(0, -u * 0.45, u * 0.32, f); circ(0, u * 0.45, u * 0.32, f); g.beginPath(); g.moveTo(-u * 0.6, 0); g.lineTo(u * 0.6, 0); g.stroke(); break;
        case 5: box(-u * 0.4, -u * 0.4, u * 0.8, u * 0.8); break;                                                          // plain pad
        case 6: g.lineWidth = f ? 3.2 : 2; g.beginPath(); g.moveTo(-u * 0.5, -u * 0.5); g.lineTo(u * 0.5, u * 0.5); g.moveTo(u * 0.5, -u * 0.5); g.lineTo(-u * 0.5, u * 0.5); g.stroke(); break; // cross
        case 7: poly([[u * 0.6, 0], [-u * 0.5, -u * 0.6], [-u * 0.5, u * 0.6]], f); g.beginPath(); g.moveTo(u * 0.65, -u * 0.6); g.lineTo(u * 0.65, u * 0.6); g.stroke(); break; // diode
        case 8: poly(Array.from({ length: 6 }, (_, k) => [Math.cos(k * 1.047) * u * 0.6, Math.sin(k * 1.047) * u * 0.6]), f); break; // hex
        case 9: for (const d of [-1, 0, 1]) circ(0, d * u * 0.55, u * 0.2, f || d === 0); break;                             // three dots
        case 10: g.beginPath(); g.roundRect(-u * 0.8, -u * 0.35, u * 1.6, u * 0.7, u * 0.35); f ? g.fill() : g.stroke(); break; // capsule
        case 11: poly([[0, -u * 0.65], [u * 0.65, 0], [0, u * 0.65], [-u * 0.65, 0]], f); break;                            // diamond
        case 12: circ(0, 0, u * 0.55, false); g.beginPath(); g.moveTo(-u * 0.85, 0); g.lineTo(u * 0.85, 0); g.moveTo(0, -u * 0.85); g.lineTo(0, u * 0.85); g.stroke(); if (f) circ(0, 0, u * 0.2, true); break; // crosshair
        default: g.beginPath(); g.moveTo(-u * 0.9, 0); for (let k = 1; k <= 6; k++) g.lineTo(-u * 0.9 + k * u * 0.3, (k % 2 ? -1 : 1) * u * 0.35); g.lineTo(u * 0.9, 0); g.stroke(); if (f) circ(u * 1.1, 0, u * 0.18, true); // resistor
      }
      if (n.mine) { g.lineWidth = 2.6; circ(0, 0, u * 1.25); circ(0, 0, u * 1.5); }
    });
  });
  // the die: nested squares, a chequer of cells, pins fanning out on every side
  const D = 7.5 * S; if (!CH_SQ) { g.lineWidth = 3; g.strokeRect(C - D, C - D, 2 * D, 2 * D); g.lineWidth = 2; g.strokeRect(C - D * 0.8, C - D * 0.8, D * 1.6, D * 1.6);
  for (let k = 0; k < 4; k++) at(C, C, k * Math.PI / 2, () => { for (let j = 0; j < 22; j++) { const t = (j - 10.5) * D * 0.072; g.fillRect(t - 3, -D * 0.98, 6, D * 0.16); } });
  g.fillRect(C - D * 0.55, C - D * 0.55, D * 1.1, D * 1.1); g.fillStyle = gold;
  const cells = 9, cw = (D * 1.0) / cells; for (let x = 0; x < cells; x++) for (let z = 0; z < cells; z++) if ((x + z) % 2 === 0 || x === 0 || z === 0 || x === cells - 1 || z === cells - 1) g.fillRect(C - D * 0.5 + x * cw + 2, C - D * 0.5 + z * cw + 2, cw - 4, cw - 4);
  g.fillStyle = ink; g.fillRect(C - D * 0.22, C - D * 0.22, D * 0.44, D * 0.44); g.fillStyle = gold; g.fillRect(C - D * 0.12, C - D * 0.12, D * 0.24, D * 0.24); g.fillStyle = ink;
  }
  return cv;
}
function chipBrain(g: THREE.Group, net: Net) {
  const tex = new THREE.CanvasTexture(chipArt(net, false)), bump = new THREE.CanvasTexture(chipArt(net, true)), metal = new THREE.CanvasTexture(chipArt(net, false, true)); tex.colorSpace = THREE.SRGBColorSpace;
  const G = CH_GREEN, surf = (map: THREE.Texture, b: THREE.Texture, mm: THREE.Texture) => new THREE.MeshStandardMaterial(G ? { map, metalness: 1, metalnessMap: mm, roughness: 0.38, bumpMap: b, bumpScale: 1.6, envMapIntensity: 0.55 } : { map, metalness: 1, roughness: 0.4, roughnessMap: b, bumpMap: b, bumpScale: 1.6, envMapIntensity: 1.1 });
  const PL = 900, rep = PL / CH_SPAN;
  for (const t of [tex, bump, metal]) { t.anisotropy = 8; t.magFilter = THREE.NearestFilter; t.repeat.set(rep, rep); t.offset.set(0.5 - rep / 2, 0.5 - rep / 2); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(PL, PL).rotateX(-Math.PI / 2), surf(tex, bump, metal));
  plate.position.y = -0.03; plate.receiveShadow = true; g.add(plate);
  const tex1 = tex.clone(), bump1 = bump.clone(), metal1 = metal.clone(); for (const t of [tex1, bump1, metal1]) { t.repeat.set(1, 1); t.offset.set(0, 0); t.needsUpdate = true; }
  const topMat = surf(tex1, bump1, metal1);
  const wallMat = new THREE.MeshStandardMaterial({ color: G ? '#cfcfc9' : '#d9b030', metalness: 1, roughness: 0.3, envMapIntensity: 1.2 });
  const planar = (geo: THREE.BufferGeometry) => { const pa = geo.attributes.position, uv = new Float32Array(pa.count * 2); for (let k = 0; k < pa.count; k++) { uv[k * 2] = pa.getX(k) / CH_SPAN + 0.5; uv[k * 2 + 1] = 0.5 - pa.getZ(k) / CH_SPAN; } geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); return geo; };
  // traces as raised black strips joining mark to mark: each layer its own line, solid, dashed, double or dotted
  const strips: number[] = [], beads: number[] = [];
  const strip = (a: THREE.Vector3, b: THREE.Vector3, w: number) => strips.push(a.x, a.z, b.x, b.z, w);
  for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => {
    const q0 = l < 27 ? CH_POS(l + 1, i) : CH_IN(i);
    const dir = q0.clone().sub(CH_POS(l, i)).normalize(), p = CH_POS(l, i).addScaledVector(dir, 0.55), q = l < 27 ? q0.clone().addScaledVector(dir, -0.55) : q0;
    const side = V(-dir.z, 0, dir.x), w = n.sold ? 0.13 : 0.085, st = l % 4;
    const pts = [p]; if ((l + i) % 4 === 0) pts.push(p.clone().lerp(q, 0.5).addScaledVector(side, 0.35)); pts.push(q);
    for (let k = 0; k + 1 < pts.length; k++) {
      const A = pts[k], B = pts[k + 1], d = A.distanceTo(B);
      if (st === 0) strip(A, B, w);
      else if (st === 1) { strip(A, B, 0.045); const m = Math.max(1, Math.round(d / 0.55)); for (let j = 0; j < m; j++) strip(A.clone().lerp(B, j / m), A.clone().lerp(B, (j + 0.6) / m), w); }
      else if (st === 2) { strip(A.clone().addScaledVector(side, 0.12), B.clone().addScaledVector(side, 0.12), 0.07); strip(A.clone().addScaledVector(side, -0.12), B.clone().addScaledVector(side, -0.12), 0.07); }
      else { strip(A, B, 0.045); const m = Math.max(1, Math.round(d / 0.35)); for (let j = 0; j <= m; j++) { const c = A.clone().lerp(B, j / m); beads.push(c.x, c.z); } }
    }
  });
  // thin wires round every stage border and through the row of boxes, so nothing floats loose
  for (const rad of [...[1, 2, 3, 4, 5].map((st) => (CH_R(STARTS[st]) + CH_R(STARTS[st] - 1)) / 2), CH_R(STARTS[3]) + 1.2]) { const n = 240; for (let k = 0; k < n; k++) strip(CH_RING(rad, k / n), CH_RING(rad, (k + 1) / n), 0.05); }
  const inkMat = G ? new THREE.MeshStandardMaterial({ color: '#d6d6cf', metalness: 1, roughness: 0.22, envMapIntensity: 1.2 }) : new THREE.MeshStandardMaterial({ color: '#16120a', metalness: 0.6, roughness: 0.35, envMapIntensity: 0.8 });
  { const n = strips.length / 5, m = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0), inkMat, n), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), Yv = V(0, 1, 0);
    for (let k = 0; k < n; k++) { const [ax, az, bx, bz, w] = strips.slice(k * 5, k * 5 + 5), len = Math.hypot(bx - ax, bz - az); q.setFromAxisAngle(Yv, -Math.atan2(bz - az, bx - ax)); mx.compose(V((ax + bx) / 2, 0, (az + bz) / 2), q, V(len, 0.14, w)); m.setMatrixAt(k, mx); }
    m.castShadow = true; g.add(m); }
  { const n = beads.length / 2, m = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.08, 0.08, 0.16, 10).translate(0, 0.08, 0), inkMat, n), mx = new THREE.Matrix4();
    for (let k = 0; k < n; k++) { mx.makeTranslation(beads[k * 2], 0, beads[k * 2 + 1]); m.setMatrixAt(k, mx); } m.castShadow = true; g.add(m); }
  // the die stands up off the top terrace as a block, its etched face on top
  const DH = 1.4, dw = 15, dieTop = DH;
  const die = new THREE.Mesh(planar(new THREE.BoxGeometry(dw, DH, dw).translate(0, 0, 0)), [wallMat, wallMat, topMat, wallMat, wallMat, wallMat]); die.position.y = dieTop - DH / 2; die.castShadow = die.receiveShadow = true; g.add(die);
  void dieTop;
}

// ---------------------------------------------------------------- green: the brain as a real circuit board
// One black chip per stage, laid out in a snake from text in to words out. Every part is a tiny surface
// mount component in rows beside its stage's chip, one row per layer: fitted where the part is bought,
// bare silver pads where it isn't, white where it's yours. Copper traces fan from each column into the chip.
const GB_SC: [number, number][] = [[-38, -24], [0, -24], [38, -24], [38, 24], [0, 24], [-38, 24]];
const GB_POS = (l: number, i: number) => { const s = STARTS.filter((x) => l >= x).length - 1, [cx, cz] = GB_SC[s], j = l - STARTS[s], top = i < 24, col = top ? i : i - 24; return V(cx + (col - 11.5) * 0.95, 0, top ? cz - 6.2 - j * 1.5 : cz + 6.2 + j * 1.5); };
const GB_SPAN = 170, GB_PX = 3072;
function greenArt(net: Net, mode: 'col' | 'bump' | 'metal') {
  const cv = document.createElement('canvas'); cv.width = cv.height = GB_PX; const g = cv.getContext('2d')!, r = rng(5);
  const S = GB_PX / GB_SPAN, C = GB_PX / 2, X = (x: number) => C + x * S, Z = (z: number) => C + z * S;
  const col = mode === 'col', bump = mode === 'bump';
  const MASK = col ? '#0c3f1e' : bump ? '#7a7a7a' : '#000000', COPPER = col ? '#1f6a33' : bump ? '#a8a8a8' : '#000000', SILVER = col ? '#d4d6d2' : '#ffffff', SILK = col ? '#eef0ea' : bump ? '#9a9a9a' : '#000000';
  g.fillStyle = MASK; g.fillRect(0, 0, GB_PX, GB_PX);
  if (col) for (let k = 0; k < 6000; k++) { g.fillStyle = `rgba(${r() < 0.5 ? '0,0,0' : '60,120,70'},0.06)`; g.fillRect(r() * GB_PX, r() * GB_PX, 3 + r() * 10, 3 + r() * 10); }
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (pts: number[][], w: number, c: string) => { g.strokeStyle = c; g.lineWidth = w; g.beginPath(); pts.forEach(([x, z], k) => (k ? g.lineTo(X(x), Z(z)) : g.moveTo(X(x), Z(z)))); g.stroke(); };
  const via = (x: number, z: number) => { g.fillStyle = SILVER; g.beginPath(); g.arc(X(x), Z(z), 0.32 * S, 0, 7); g.fill(); g.fillStyle = col ? '#0a1a0f' : bump ? '#303030' : '#000'; g.beginPath(); g.arc(X(x), Z(z), 0.14 * S, 0, 7); g.fill(); };
  // copper first: every column runs to its chip, bending 45 degrees into the pins
  GB_SC.forEach(([cx, cz], s) => {
    const n = STARTS[s + 1] ?? 28, rows = n - STARTS[s];
    for (let i = 0; i < 47; i++) {
      const top = i < 24, c = top ? i : i - 24, cols = top ? 24 : 23, x = cx + (c - 11.5) * 0.95, sg = top ? -1 : 1;
      const outer = cz + sg * (6.2 + (rows - 1) * 1.5), pin = cx + (c - (cols - 1) / 2) * 0.24;
      line([[x, outer], [x, cz + sg * 5.2], [pin, cz + sg * 3.9]], 0.16 * S, COPPER);
    }
    // buses to the next chip: eight parallel traces routed with 45 degree corners
    const nx = GB_SC[s + 1]; if (nx) for (let k = 0; k < 8; k++) { const o = (k - 3.5) * 0.45, [x1, z1] = nx;
      if (z1 === cz) { const d = Math.sign(x1 - cx); line([[cx + d * 3.9, cz + o], [cx + d * 7, cz + o], [cx + d * 8.5, cz + o + 1.5 * Math.sign(o || 1)], [x1 - d * 8.5, cz + o + 1.5 * Math.sign(o || 1)], [x1 - d * 7, cz + o], [x1 - d * 3.9, cz + o]], 0.14 * S, COPPER); }
      else { line([[cx + 3.9, cz + o], [cx + 13 + o, cz + o], [cx + 13 + o, z1 + o], [x1 + 3.9, z1 + o]], 0.14 * S, COPPER); } }
  });
  // text in header and words out connector at the left, wired to the first and last chips
  for (let k = 0; k < 10; k++) { line([[-66, -29 + k * 1.1], [-56, -29 + k * 1.1], [-44, -26 + k * 0.6 * 0], [-41.9, -27 + k * 0.6]], 0.14 * S, COPPER); line([[-66, 19 + k * 1.1], [-56, 19 + k * 1.1], [-44, 22], [-41.9, 21 + k * 0.6]], 0.14 * S, COPPER); }
  // scattered traces and vias between blocks, so the board reads busy like a real one
  for (let k = 0; k < 260; k++) { let x = -70 + r() * 140, z = -40 + r() * 80; if (GB_SC.some(([cx, cz]) => Math.abs(x - cx) < 13 && Math.abs(z - cz) < 15)) continue; const pts = [[x, z]]; for (let j = 0; j < 3; j++) { const d = Math.floor(r() * 8) * Math.PI / 4, len = 1.5 + r() * 5; x += Math.cos(d) * len; z += Math.sin(d) * len; pts.push([x, z]); } line(pts, (0.1 + r() * 0.1) * S, COPPER); via(pts[0][0], pts[0][1]); via(x, z); }
  // pads for every part, silkscreen outline round each, refs on some
  g.font = `${Math.round(0.55 * S)}px 'Departure Mono', monospace`;
  for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => {
    const p = GB_POS(l, i); g.fillStyle = SILVER; g.fillRect(X(p.x - 0.22), Z(p.z - 0.42), 0.44 * S, 0.24 * S); g.fillRect(X(p.x - 0.22), Z(p.z + 0.18), 0.44 * S, 0.24 * S);
    g.strokeStyle = SILK; g.lineWidth = 1.6; g.strokeRect(X(p.x - 0.34), Z(p.z - 0.54), 0.68 * S, 1.08 * S);
    if (i % 6 === 0 && col) { g.fillStyle = SILK; g.fillText(`${l % 2 ? 'C' : 'R'}${l * 47 + i}`, X(p.x + 0.4), Z(p.z + 0.2)); }
  });
  // chip footprints: pad rows on every side, silkscreen corner mark
  GB_SC.forEach(([cx, cz], s) => { g.fillStyle = SILVER; for (let k = 0; k < 24; k++) { const t = (k - 11.5) * 0.24; g.fillRect(X(cx + t - 0.07), Z(cz - 4.3), 0.14 * S, 0.7 * S); g.fillRect(X(cx + t - 0.07), Z(cz + 3.6), 0.14 * S, 0.7 * S); g.fillRect(X(cx - 4.3), Z(cz + t - 0.07), 0.7 * S, 0.14 * S); g.fillRect(X(cx + 3.6), Z(cz + t - 0.07), 0.7 * S, 0.14 * S); }
    g.strokeStyle = SILK; g.lineWidth = 2; g.strokeRect(X(cx - 4.7), Z(cz - 4.7), 9.4 * S, 9.4 * S); g.fillStyle = SILK; g.beginPath(); g.arc(X(cx - 5.2), Z(cz - 5.2), 0.25 * S, 0, 7); g.fill();
    if (col) { g.font = `${Math.round(0.8 * S)}px 'Departure Mono', monospace`; g.fillText(`U${s + 1}`, X(cx + 5.2), Z(cz - 4.6)); g.font = `${Math.round(0.55 * S)}px 'Departure Mono', monospace`; } });
  for (const [x, z] of [[-66, -29], [-66, 19]]) for (let k = 0; k < 10; k++) via(x, z + k * 1.1);
  return cv;
}
function greenBoard(g: THREE.Group, net: Net) {
  const mk = (m: 'col' | 'bump' | 'metal') => { const t = new THREE.CanvasTexture(greenArt(net, m)), rep = 900 / GB_SPAN; t.anisotropy = 8; t.repeat.set(rep, rep); t.offset.set(0.5 - rep / 2, 0.5 - rep / 2); t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; return t; };
  const tex = mk('col'); tex.colorSpace = THREE.SRGBColorSpace; const bump = mk('bump'), metal = mk('metal');
  const board = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ map: tex, metalness: 1, metalnessMap: metal, roughness: 0.32, bumpMap: bump, bumpScale: 1.2, envMapIntensity: 0.7 }));
  board.receiveShadow = true; g.add(board);
  const mx = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = V(0, 1, 0), one = V(1, 1, 1);
  const silver = new THREE.MeshStandardMaterial({ color: '#dcdcd8', metalness: 1, roughness: 0.22 });
  // fitted parts: body plus two silver end caps, resistors black, capacitors tan, yours white
  const fitted: { p: THREE.Vector3; c: string }[] = [];
  for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => { if (n.sold > 0 || n.mine) fitted.push({ p: GB_POS(l, i), c: n.mine ? '#f4f4f0' : l % 2 ? '#a9825a' : '#1b1b1b' }); });
  const body = new THREE.InstancedMesh(new THREE.BoxGeometry(0.36, 0.22, 0.56).translate(0, 0.11, 0), new THREE.MeshStandardMaterial({ roughness: 0.55 }), fitted.length);
  const caps = new THREE.InstancedMesh(new THREE.BoxGeometry(0.38, 0.24, 0.14).translate(0, 0.12, 0), silver, fitted.length * 2), c = new THREE.Color();
  fitted.forEach((f, k) => { mx.makeTranslation(f.p.x, 0, f.p.z); body.setMatrixAt(k, mx); body.setColorAt(k, c.set(f.c)); mx.makeTranslation(f.p.x, 0, f.p.z - 0.32); caps.setMatrixAt(k * 2, mx); mx.makeTranslation(f.p.x, 0, f.p.z + 0.32); caps.setMatrixAt(k * 2 + 1, mx); });
  body.castShadow = caps.castShadow = true; g.add(body, caps);
  // the six chips: black bodies, silver gull wing pins, pin one dimple
  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 0.12, 0.75), silver, 6 * 96); let k = 0;
  GB_SC.forEach(([cx, cz], s) => {
    const ic = new THREE.Mesh(new THREE.BoxGeometry(7.4, 1, 7.4), new THREE.MeshStandardMaterial({ color: '#b9bbbd', metalness: 1, roughness: 0.3, envMapIntensity: 1.2 })); ic.position.set(cx, 0.55, cz); ic.castShadow = ic.receiveShadow = true; ic.userData.stage = s; g.add(ic);
    const dm = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 24), new THREE.MeshStandardMaterial({ color: '#0a0a0a', roughness: 0.9 })); dm.position.set(cx - 2.8, 1.07, cz - 2.8); g.add(dm);
    for (let sd = 0; sd < 4; sd++) { q.setFromAxisAngle(Y, sd * Math.PI / 2); for (let j = 0; j < 24; j++) { mx.compose(V((j - 11.5) * 0.24, 0.2, -4.0).applyQuaternion(q).add(V(cx, 0, cz)), q, one); legs.setMatrixAt(k++, mx); } }
  });
  legs.castShadow = true; g.add(legs);
  // a few big parts: electrolytic caps, a crystal, the text in header and words out connector
  for (const [x, z] of [[-19, -30], [19, -16], [19, 30], [-19, 16], [52, 0], [-52, 0]]) { const can = new THREE.Mesh(new THREE.CylinderGeometry(1.3, 1.3, 2.6, 32), silver); can.position.set(x, 1.3, z); can.castShadow = true; g.add(can); const sl = new THREE.Mesh(new THREE.CylinderGeometry(1.33, 1.33, 1.8, 32, 1, true), new THREE.MeshStandardMaterial({ color: '#16161a', roughness: 0.5 })); sl.position.set(x, 1.0, z); g.add(sl); }
  for (const [x, z] of [[0, 0], [-19, 0]]) { const xt = new THREE.Mesh(new THREE.CapsuleGeometry(0.9, 2.2, 6, 20).rotateZ(Math.PI / 2).scale(1, 0.6, 1), silver); xt.position.set(x, 0.55, z); xt.castShadow = true; g.add(xt); }
  for (const z0 of [-29, 19]) { const hd = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1.2, 11.4), new THREE.MeshStandardMaterial({ color: '#141414', roughness: 0.6 })); hd.position.set(-66, 0.6, z0 + 4.95); hd.castShadow = true; g.add(hd);
    const pins = new THREE.InstancedMesh(new THREE.BoxGeometry(0.22, 2.6, 0.22), new THREE.MeshStandardMaterial({ color: '#e0b84a', metalness: 1, roughness: 0.25 }), 10); for (let j = 0; j < 10; j++) { mx.makeTranslation(-66, 1.3, z0 + j * 1.1); pins.setMatrixAt(j, mx); } pins.castShadow = true; g.add(pins); }
}

// ---------------------------------------------------------------- flat strata: the strata drawing laid on the gold floor
// The same drawing, every stage its own shapes, tipped over onto the board like the chip; the arches keep
// a low relief so they still read in 3D, all in black ink on gold.
const FS_K = 0.35, FS_TF = (v: THREE.Vector3) => V(v.x, v.z * FS_K + 9, -v.y + 12);
function flatStrata(g: THREE.Group, net: Net) {
  const sub = new THREE.Group(); strataParts(sub, net);
  sub.matrixAutoUpdate = false; sub.matrix.set(1, 0, 0, 0, 0, 0, FS_K, 9, 0, -1, 0, 12, 0, 0, 0, 1);
  const ink = new THREE.MeshStandardMaterial({ color: '#16120a', metalness: 0.6, roughness: 0.35, envMapIntensity: 0.8 });
  sub.traverse((o) => { const m = o as THREE.InstancedMesh; if (m.isInstancedMesh) { m.material = ink; m.instanceColor = null; m.castShadow = true; } });
  g.add(sub); sub.updateMatrixWorld(true);
  const lo = new THREE.Box3().setFromObject(sub).min.y;
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(900, 900).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#d4ab2a', metalness: 1, roughness: 0.38 }));
  plate.position.y = lo - 0.05; plate.receiveShadow = true; g.add(plate);
}

// ---------------------------------------------------------------- the bubble inside strata
// A clear, foggy, rainbow-skinned bubble floating inside the cylinder, always moving like water. Now and
// then a lobe swells out between the lines and bursts, throwing off a few droplets that drift and vanish.
let bubbleAt: { cy: number; RX: number; RY: number } | null = null;
/* the liquidity water grows with the token's market cap: its full drawn size stands for $1M. The volume follows the market cap, so the radius is the cube root, kept between a small seed at launch and a cap that still fits inside the lines. ?mcap=250000 previews any market cap. */
const LIQ_FULL = 1_000_000, LIQ_MIN = 0.22, LIQ_MAX = 1.35;
const liqScaleFor = (mcap: number) => Math.min(LIQ_MAX, Math.max(LIQ_MIN, Math.cbrt(Math.max(0, mcap) / LIQ_FULL)));
let liqTarget = 1, liqNow = 1;
async function loadMarketCap() {
  const forced = new URLSearchParams(location.search).get('mcap');
  if (forced !== null) { liqTarget = liqNow = liqScaleFor(Number(forced)); return; }
  try {
    const cfg = await (await fetch(`${API}/config`)).json() as { mint: string };
    const d = await (await fetch(`https://api.dexscreener.com/latest/dex/tokens/${cfg.mint}`)).json() as { pairs?: { marketCap?: number; fdv?: number }[] };
    const m = d.pairs?.[0]?.marketCap ?? d.pairs?.[0]?.fdv;
    if (typeof m === 'number') liqTarget = liqScaleFor(m);
  } catch { /* no market data: keep the drawn size */ }
}
void loadMarketCap(); setInterval(() => { void loadMarketCap(); }, 60_000);
let underwater = false; const waterFog = new THREE.FogExp2('#cfe4ff', 0.0075);
function makeBubble(g: THREE.Group) {
  const cy = (SA_Y(4) + SA_Y(27)) / 2, RX = SA_W(15) * 0.74, RY = (SA_Y(4) - SA_Y(27)) * 0.56;
  const geo = new THREE.IcosahedronGeometry(1, 20), base = Float32Array.from(geo.attributes.position.array as Float32Array), pos = geo.attributes.position as THREE.BufferAttribute;
  // water: it refracts the lines behind it, tinted faintly blue, with a rainbow film and sharp reflections
  const skin = new THREE.MeshPhysicalMaterial({ color: '#ffffff', transmission: 1, ior: 1.33, thickness: 9, roughness: 0.04, metalness: 0, attenuationColor: '#f2f8ff', attenuationDistance: 260, transparent: true, opacity: 0.82, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.4, iridescenceIOR: 1.3, iridescenceThicknessRange: [200, 700], envMap: chipEnv(), envMapIntensity: 1.9, specularIntensity: 1, side: THREE.DoubleSide });
  // the fog inside is never one colour: soft lilac, ice blue and pink drifting over it
  { const cols: number[] = [], c = new THREE.Color(), ps = geo.attributes.position; for (let i = 0; i < ps.count; i++) { const y = ps.getY(i), x = ps.getX(i), z = ps.getZ(i); c.setHSL(0.6 + 0.12 * Math.sin(3 * x + 2 * y) + 0.08 * Math.sin(4 * z - y), 0.75, 0.78); cols.push(c.r, c.g, c.b); } geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); }
  const fog = new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.04, roughness: 1, depthWrite: false });
  bubbleAt = { cy, RX, RY };
  const outer = new THREE.Mesh(geo, skin), inner = new THREE.Mesh(geo, fog); inner.scale.setScalar(0.86);
  const bub = new THREE.Group(); bub.add(inner, outer); bub.position.y = cy; bub.scale.set(RX * liqNow, RY * liqNow, RX * liqNow); bub.renderOrder = 2; bub.userData.stage = 6; g.add(bub);
  // lobes that swell out through the lines, each on its own slow cycle
  const lobes = Array.from({ length: 4 }, (_, k) => ({ d: V(Math.cos(k * 1.9 + 0.4), (k % 2 ? 0.25 : -0.3), Math.sin(k * 1.9 + 0.4)).normalize(), per: 6 + k * 1.7, off: k * 2.3, fired: -1 }));
  const drops = Array.from({ length: 30 }, () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 3), skin); m.visible = false; g.add(m); return { m, v: V(0, 0, 0), born: -9 }; });
  let di = 0; const d = V(0, 0, 0);
  // the sphere repeats each corner about six times; work each corner out once and copy it to its repeats
  const uMap = new Map<string, number>(), uOf = new Int32Array(pos.count), uBase: number[] = [];
  for (let i = 0; i < pos.count; i++) { const k = `${base[i * 3].toFixed(5)},${base[i * 3 + 1].toFixed(5)},${base[i * 3 + 2].toFixed(5)}`; let u = uMap.get(k); if (u === undefined) { u = uBase.length / 3; uMap.set(k, u); uBase.push(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]); } uOf[i] = u; }
  const uR = new Float32Array(uBase.length / 3), arr = pos.array as Float32Array;
  return (t0: number) => { const t = t0 * 0.5; // half speed: slow, heavy water
    liqNow += (liqTarget - liqNow) * 0.02; bub.scale.set(RX * liqNow, RY * liqNow, RX * liqNow); if (bubbleAt) { bubbleAt.RX = RX * liqNow; bubbleAt.RY = RY * liqNow; }
    const calm = document.body.classList.contains('touring'); // no swells or bursts while the tour plays
    const amp = lobes.map((lb) => { const ph = (t + lb.off) % lb.per; return !calm && ph < 2.4 ? Math.sin(Math.PI * ph / 2.4) ** 2 * 0.42 : 0; });
    for (let u = 0; u < uR.length; u++) {
      d.set(uBase[u * 3], uBase[u * 3 + 1], uBase[u * 3 + 2]);
      let r = 1 + 0.04 * Math.sin(3 * d.x + 1.3 * t) + 0.035 * Math.sin(4 * d.y - 1.1 * t + 2 * d.z) + 0.03 * Math.sin(5 * d.z + 0.9 * t + 3 * d.x) + 0.02 * Math.sin(7 * (d.x + d.y) + 1.7 * t);
      for (let k = 0; k < 4; k++) if (amp[k]) r += amp[k] * Math.max(0, d.dot(lobes[k].d)) ** 7;
      uR[u] = r;
    }
    for (let i = 0; i < pos.count; i++) { const r = uR[uOf[i]]; arr[i * 3] = base[i * 3] * r; arr[i * 3 + 1] = base[i * 3 + 1] * r; arr[i * 3 + 2] = base[i * 3 + 2] * r; }
    pos.needsUpdate = true; geo.computeVertexNormals();
    // burst: at the top of a swell a few droplets break off and float away, shrinking
    if (calm) drops.forEach((dr) => { dr.m.visible = false; });
    lobes.forEach((lb, k) => { const cyc = Math.floor((t + lb.off) / lb.per), ph = (t + lb.off) % lb.per; if (!calm && ph > 1.2 && lb.fired !== cyc) { lb.fired = cyc;
      const tip = V(lb.d.x * RX * 1.55, cy + lb.d.y * RY * 1.55, lb.d.z * RX * 1.55); for (let j = 0; j < 6; j++) { const dr = drops[di++ % drops.length]; dr.m.position.copy(tip); dr.v.set(lb.d.x + (Math.random() - 0.5) * 0.6, lb.d.y + (Math.random() - 0.5) * 0.6 + 0.2, lb.d.z + (Math.random() - 0.5) * 0.6).multiplyScalar(5 + Math.random() * 4); dr.born = t; dr.m.visible = true; } } });
    for (const dr of drops) { if (!dr.m.visible) continue; const age = t - dr.born; if (age > 1.8) { dr.m.visible = false; continue; } dr.m.position.addScaledVector(dr.v, 1 / 120); dr.m.scale.setScalar(1.3 * (1 - age / 1.8) + 0.05); }
  };
}

const BLOB_R = 20, PER = 10;
const blobDir = new Map<number, THREE.Vector3>();
function blobLayout(net: Net) {
  // 1,316 evenly spread points, sorted by a warped height so the stage bands ripple like ribbons
  const n = 1316, pts: { d: THREE.Vector3; b: number }[] = [];
  for (let k = 0; k < n; k++) {
    const y = 1 - (2 * (k + 0.5)) / n, r = Math.sqrt(1 - y * y), a = k * GOLD, d = V(Math.cos(a) * r, y, Math.sin(a) * r);
    const b = d.y + 0.58 * Math.sin(2.6 * d.x + 1.9 * d.z) + 0.3 * Math.sin(4.1 * d.z - 2.7 * d.y + d.x);
    pts.push({ d, b });
  }
  pts.sort((p, q) => q.b - p.b);
  let k = 0;
  for (const L of net.layers) for (const node of L) blobDir.set(node.part, pts[k++].d);
}
function snoise(x: number, y: number, z: number) { return Math.sin(x * 1.7 + Math.sin(y * 2.3 + z)) * 0.5 + Math.sin(y * 1.3 + Math.sin(z * 1.9 + x * 0.7)) * 0.35 + Math.sin(z * 2.1 + x) * 0.15; }
let blob: { mesh: THREE.InstancedMesh; base: Float32Array; dirs: Float32Array; hit: THREE.Vector3 | null } | null = null;
const coneGeo = (() => {
  const g = new THREE.ConeGeometry(0.16, 1, 5, 1).translate(0, 0.5, 0).rotateX(Math.PI / 2);
  const c: number[] = [], p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) { const t = p.getZ(i); c.push(0.45 + 0.55 * t, 0.45 + 0.55 * t, 0.45 + 0.55 * t); }
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3)); return g;
})();
function blobParts(g: THREE.Group, net: Net) {
  if (!blobDir.size) blobLayout(net);
  const parts = net.nodes.filter((n) => n.layer !== null), N = parts.length * PER, rr = rng(5);
  const mesh = new THREE.InstancedMesh(coneGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.05 }), N);
  const base = new Float32Array(N), dirs = new Float32Array(N * 3), c = new THREE.Color();
  let i = 0;
  for (const n of parts) {
    const d0 = blobDir.get(n.part)!, t1 = V(0, 1, 0).cross(d0).normalize(), t2 = d0.clone().cross(t1);
    for (let k = 0; k < PER; k++) {
      const d = d0.clone().addScaledVector(t1, (rr() - 0.5) * 0.09).addScaledVector(t2, (rr() - 0.5) * 0.09).normalize();
      dirs[i * 3] = d.x; dirs[i * 3 + 1] = d.y; dirs[i * 3 + 2] = d.z;
      base[i] = 1.4 + n.fire * 6.5 + (n.sold > 0 ? 1.6 : 0) + rr() * 0.8;
      c.set(n.mine ? '#ffffff' : STAGE[n.stage]); if (n.trait >= 70 && k === 0) c.set(traitColour());
      mesh.setColorAt(i, c); i++;
    }
  }
  const core = new THREE.Mesh(new THREE.SphereGeometry(BLOB_R * 0.995, 64, 48), new THREE.MeshStandardMaterial({ color: STAGE[3], roughness: 0.8 }));
  g.add(core, mesh);
  blob = { mesh, base, dirs, hit: null };
}
function blobFrame(t: number) {
  if (!blob) return;
  const { mesh, base, dirs, hit } = blob, m = new THREE.Matrix4(), q = new THREE.Quaternion(), z = V(0, 0, 1), d = V(0, 0, 0), p = V(0, 0, 0), sc = V(1, 1, 1);
  for (let i = 0; i < base.length; i++) {
    d.set(dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]);
    let L = base[i] * (0.72 + 0.38 * snoise(d.x * 2.2 + t * 0.25, d.y * 2.2 - t * 0.18, d.z * 2.2 + t * 0.21));
    if (hit) { const dd = d.distanceToSquared(hit); L += 7 * Math.exp(-dd / 0.02); }
    p.copy(d).multiplyScalar(BLOB_R); q.setFromUnitVectors(z, d); sc.set(1, 1, Math.max(0.3, L));
    m.compose(p, q, sc); mesh.setMatrixAt(i, m);
  }
  mesh.instanceMatrix.needsUpdate = true;
}

// measured traits: yellow on paper, a neon aqua on the white blue version
const traitColour = () => (document.body.dataset.white ? '#00e1ff' : '#ffe20a');
// the square helix: plates lie flat, turning round a spiral as they step down
const SQ_Y = (l: number) => 62 - l * 4.6 - (STARTS.filter((x) => x > 0 && l >= x).length) * 2;
const SQ_AT = (l: number, u: number, w: number) => {
  const a = l * 0.42, R = 15, rad = V(Math.cos(a), 0, Math.sin(a)), tan = V(-Math.sin(a), 0, Math.cos(a));
  return rad.clone().multiplyScalar(R + u).addScaledVector(tan, w).add(V(0, SQ_Y(l), 0));
};
const SQ_POS = (l: number, i: number) => i < 12
  ? SQ_AT(l, -8 + (i % 4) * 1.6, -2 + Math.floor(i / 4) * 2)
  : SQ_AT(l, -0.6 + ((i - 12) % 7) * 1.35, -3.6 + Math.floor((i - 12) / 7) * 1.8);

// the traditional network: rows top to bottom, heads on the left of each row, columns on the right
const NET_Y = (l: number) => 32 - l * 1.9 - (STARTS.filter((x) => x > 0 && l >= x).length) * 1.8;
const NET_X = (i: number) => (i < 12 ? -40 + i * 1.75 : -16 + (i - 12) * 1.6);
const NET_POS = (l: number, i: number) => V(NET_X(i), NET_Y(l), 0);
// the same network on its side: layers left to right, text in on the left, words out on the right
const HNET_X = (l: number) => -58 + l * 3.6 + (STARTS.filter((x) => x > 0 && l >= x).length) * 3;
const HNET_POS = (l: number, i: number) => V(HNET_X(l), -(NET_X(i) + 1) * 0.6, 0);
// the same network with width: each layer a flat block, heads 4 by 3, columns 7 by 5
// each layer one square slab: all 47 parts in a 7 by 7 grid (heads first), slabs stacked with clear gaps
const DEEP_Y = (l: number) => 36 - l * 2.3 - (STARTS.filter((x) => x > 0 && l >= x).length) * 2.2;
const DEEP_POS = (l: number, i: number) => V(((i % 7) - 3) * 4.2, DEEP_Y(l), (Math.floor(i / 7) - 3) * 4.2);
// lines as solid lit tubes, for the modelled look
const beadGeo = new THREE.SphereGeometry(0.17, 10, 8);
const tubeGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false).translate(0, 0.5, 0).rotateX(Math.PI / 2);
function tubes(pos: number[], col: number[], radius: number) {
  const n = pos.length / 6, m = new THREE.InstancedMesh(tubeGeo, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.05 }), n);
  const a = V(0, 0, 0), b = V(0, 0, 0), q = new THREE.Quaternion(), mx = new THREE.Matrix4(), z = V(0, 0, 1), c = new THREE.Color();
  for (let i = 0; i < n; i++) {
    a.set(pos[i * 6], pos[i * 6 + 1], pos[i * 6 + 2]); b.set(pos[i * 6 + 3], pos[i * 6 + 4], pos[i * 6 + 5]);
    const d = b.clone().sub(a), len = d.length(); q.setFromUnitVectors(z, d.normalize());
    mx.compose(a, q, V(radius, radius, len)); m.setMatrixAt(i, mx);
    c.setRGB(col[i * 6], col[i * 6 + 1], col[i * 6 + 2]); m.setColorAt(i, c);
  }
  return m;
}
function netEdges(g: THREE.Group, net: Net, P: (l: number, i: number) => THREE.Vector3 = NET_POS) {
  const shares = receipt?.shares ?? [];
  const c = new THREE.Color();
  for (let l = 0; l < 27; l++) {
    const next = net.layers[l + 1].map((n, i) => ({ i, s: shares[n.part] ?? n.fire })).sort((a, b) => b.s - a.s).slice(0, 3);
    const mine = net.layers[l].map((n) => shares[n.part] ?? n.fire), top = Math.max(...mine) || 1;
    const st = net.layers[l][0].stage, pos: number[] = [], col: number[] = [];
    net.layers[l].forEach((n, i) => {
      const a = P(l, i), k = 0.25 + 0.75 * (mine[i] / top);
      c.set(STAGE[st]).lerp(new THREE.Color(PAPER_BG), 1 - k);
      for (const t of next) { const b = P(l + 1, t.i); pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
    });
    if (P === DEEP_POS || document.body.dataset.white) { const tm = tubes(pos, col, 0.07); tm.userData.stage = st; g.add(tm); continue; }
    const o = fat(pos, col, 1, 0.75); o.userData.stage = st; o.userData.wave = Float32Array.from(pos); g.add(o);
  }
  // text in feeds every head and column of the first layer, the last layer feeds words out
  const fan: number[] = [], fc: number[] = [], ink = new THREE.Color(STAGE[3]);
  const cx = Array.from({ length: 47 }, (_, i) => P(0, i).x).reduce((a, b) => a + b, 0) / 47;
  const I = P === HNET_POS ? V(HNET_X(0) - 12, 0, 0) : P === DEEP_POS ? V(0, DEEP_Y(0) + 10, 0) : V(cx, NET_Y(0) + 9, 0), O = P === HNET_POS ? V(HNET_X(27) + 10, 0, 0) : P === DEEP_POS ? V(0, DEEP_Y(27) - 8, 0) : V(cx, NET_Y(27) - 7, 0);
  for (let i = 0; i < 47; i++) { const a = P(0, i), b = P(27, i); fan.push(I.x, I.y, I.z, a.x, a.y, a.z, b.x, b.y, b.z, O.x, O.y, O.z); for (let j = 0; j < 4; j++) fc.push(ink.r, ink.g, ink.b); }
  if (P === DEEP_POS || document.body.dataset.white) { g.add(tubes(fan, fc, 0.05)); return; }
  const fo = fat(fan, fc, 1, 0.35); fo.userData.wave = Float32Array.from(fan); g.add(fo);
}

const CHIP_Y = (l: number) => 4 + (27 - l) * 0.95 + (5 - (STARTS.filter((x) => l >= x).length - 1)) * 1.2; // layer 0 on top
/** The chip: die plates, block outlines, routing traces, the via bus, package, pins and bond wires. */
function chipParts(g: THREE.Group, net: Net) {
  const c = new THREE.Color();
  for (let l = 0; l < 28; l++) {
    const s = STARTS.filter((x) => l >= x).length - 1, y = CHIP_Y(l);
    const plate: number[] = [], pc: number[] = [], qt: number[] = [], qc: number[] = [], ht: number[] = [], hc: number[] = [];
    const box = (x0: number, z0: number, x1: number, z1: number, k: number) => { c.set(STAGE[s]).multiplyScalar(k); const P = [[x0, z0], [x1, z0], [x1, z1], [x0, z1]]; for (let i = 0; i < 4; i++) { const [a, b] = P[i], [d, e] = P[(i + 1) % 4]; plate.push(a, y, b, d, y, e); pc.push(c.r, c.g, c.b, c.r, c.g, c.b); } };
    box(-16, -14, 16, 14, 0.75);      // the die
    box(-14.5, -11, -3.5, 11, 0.4);   // attention block
    box(1.5, -12.5, 14.5, 12.5, 0.4); // memory array
    // Manhattan traces from every part to the bus at the centre
    net.layers[l].forEach((n, i) => {
      const x = i < 12 ? -12.5 + (i % 3) * 3.6 : 3 + ((i - 12) % 5) * 2.4, z = i < 12 ? -8.4 + Math.floor(i / 3) * 5.6 : -10.8 + Math.floor((i - 12) / 5) * 3.6;
      const hot = n.fire > 0.5, P = hot ? ht : qt, C = hot ? hc : qc;
      c.set(STAGE[s]).multiplyScalar(hot ? 0.95 : 0.4);
      P.push(x, y, z, x, y, 0, x, y, 0, 0, y, 0); C.push(c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b, c.r, c.g, c.b);
    });
    const objs = [fat(plate, pc, 1, 0.8), qt.length ? fat(qt, qc, 1 * lineK, 0.5) : null, ht.length ? fat(ht, hc, 1.6 * lineK, 0.95) : null];
    for (const o of objs) if (o) { o.userData.stage = s; g.add(o); }
  }
  // the bus: the residual stream as a column of vias through every layer
  g.add(fat([0, CHIP_Y(0) + 5, 0, 0, -6, 0], [0.91, 1, 0.94, 0.91, 1, 0.94], 2.4, 1));
  // the package, its pins, and the bond wires that carry words out
  const pk: number[] = [], kc: number[] = [], G = new THREE.Color('#5c6b63');
  const seg = (a: number[], b: number[], col = G) => { pk.push(...a, ...b); kc.push(col.r, col.g, col.b, col.r, col.g, col.b); };
  const R = 21, y0 = 0, y1 = 1.6;
  for (const y of [y0, y1]) { seg([-R, y, -R], [R, y, -R]); seg([R, y, -R], [R, y, R]); seg([R, y, R], [-R, y, R]); seg([-R, y, R], [-R, y, -R]); }
  for (const [x, z] of [[-R, -R], [R, -R], [R, R], [-R, R]]) seg([x, y0, z], [x, y1, z]);
  const red = new THREE.Color('#ff4b6e').multiplyScalar(0.8), base = CHIP_Y(27);
  for (let k = 0; k < 14; k++) {
    const t = -R + 2 + k * ((2 * R - 4) / 13);
    for (const [px, pz, ox, oz] of [[t, -R, 0, -1], [t, R, 0, 1], [-R, t, -1, 0], [R, t, 1, 0]]) {
      seg([px, y0 + 0.8, pz], [px + ox * 3, y0 + 0.8, pz + oz * 3]); seg([px + ox * 3, y0 + 0.8, pz + oz * 3], [px + ox * 3, -1.5, pz + oz * 3]);
    }
    const a = V(t * 0.7, base, 14), b = V(t, y1, R), m = V((a.x + b.x) / 2, base + 3, (a.z + b.z) / 2);
    const curve = new THREE.QuadraticBezierCurve3(a, m, b).getPoints(12);
    for (let j = 0; j + 1 < curve.length; j++) seg([curve[j].x, curve[j].y, curve[j].z], [curve[j + 1].x, curve[j + 1].y, curve[j + 1].z], red);
  }
  g.add(fat(pk, kc, 1, 0.9));
}

const CUT0 = 0, SWEEP = Math.PI * 2; // full spheres, nothing cut away
const GOLD = Math.PI * (3 - Math.sqrt(5));
/** Where a part sits on its stage's dome: spread evenly over the open three quarters. */
let hemi = false;
function domeDir(n: Node, i: number) {
  const k = i + 0.5, y = hemi ? k / 47 : 1 - (2 * k) / 47, el = Math.asin(y), az = (k * GOLD + n.layer! * 0.9) % SWEEP;
  return V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
}
const RAMP = ['#2440ff', '#1fa8ff', '#21e0c0', '#7dff5a', '#ffe23d', '#ff9a2b', '#ff3b3b'];
/** Contour rings on each dome, from how hard the parts on it fire (marching squares on the dome). */
function contourDomes(g: THREE.Group, net: Net, rainbow = false) {
  const A = 96, E = 48;
  const fields: Float32Array[] = [];
  let max = 0;
  for (let l = 0; l < 28; l++) {
    const parts = net.layers[l].map((n, i) => ({ d: domeDir(n, i), f: n.fire }));
    const f = new Float32Array((A + 1) * (E + 1));
    for (let ei = 0; ei <= E; ei++) for (let ai = 0; ai <= A; ai++) {
      const el = hemi ? (ei / E) * Math.PI / 2 : -Math.PI / 2 + (ei / E) * Math.PI, az = (ai / A) * SWEEP;
      const p = V(Math.cos(az) * Math.cos(el), Math.sin(el), Math.sin(az) * Math.cos(el));
      let v = 0; for (const q of parts) v += q.f * Math.exp(-p.distanceToSquared(q.d) / 0.08);
      f[ei * (A + 1) + ai] = v; max = Math.max(max, v);
    }
    fields.push(f);
  }
  const levels = 7;
  for (let l = 0; l < 28; l++) {
    const s = STARTS.filter((x) => l >= x).length - 1, R = LR(l), f = fields[l];
    const quiet: number[] = [], qc: number[] = [], hot: number[] = [], hc: number[] = [], c = new THREE.Color();
    const at = (ai: number, ei: number) => { const el = hemi ? (ei / E) * Math.PI / 2 : -Math.PI / 2 + (ei / E) * Math.PI, az = (ai / A) * SWEEP; return [Math.cos(az) * Math.cos(el) * R, Math.sin(el) * R, Math.sin(az) * Math.cos(el) * R]; };
    for (let lv = 1; lv <= levels; lv++) {
      const iso = (lv / (levels + 1)) * max * 0.9, isHot = lv > levels / 2;
      if (rainbow) c.set(RAMP[Math.min(RAMP.length - 1, Math.floor((lv / levels) * RAMP.length))]); else c.set(STAGE[s]).multiplyScalar(isHot ? 0.6 + 0.4 * (lv / levels) : 0.45);
      const P = isHot ? hot : quiet, C = isHot ? hc : qc;
      for (let ei = 0; ei < E; ei++) for (let ai = 0; ai < A; ai++) {
        const v = [f[ei * (A + 1) + ai], f[ei * (A + 1) + ai + 1], f[(ei + 1) * (A + 1) + ai + 1], f[(ei + 1) * (A + 1) + ai]];
        const cs = [[ai, ei], [ai + 1, ei], [ai + 1, ei + 1], [ai, ei + 1]];
        const cross: number[][] = [];
        for (let e = 0; e < 4; e++) {
          const a = v[e], b = v[(e + 1) % 4];
          if ((a < iso) !== (b < iso)) { const t = (iso - a) / (b - a); const [x1, y1] = cs[e], [x2, y2] = cs[(e + 1) % 4]; cross.push(at(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t)); }
        }
        for (let k = 0; k + 1 < cross.length; k += 2) { P.push(...cross[k], ...cross[k + 1]); C.push(c.r, c.g, c.b, c.r, c.g, c.b); }
      }
    }
    const rim: number[] = [], rc: number[] = [];
    if (hemi) { c.set(STAGE[s]).multiplyScalar(0.7); for (let k = 0; k < 96; k++) { rim.push(...at(k, 0), ...at(k + 1, 0)); rc.push(c.r, c.g, c.b, c.r, c.g, c.b); } }
    const tagged = [quiet.length ? fat(quiet, qc, 1 * lineK, 0.45) : null, hot.length ? fat(hot, hc, 1.5 * lineK, 0.9) : null, rim.length ? fat(rim, rc, 1, 0.6) : null];
    for (const o of tagged) if (o) { o.userData.stage = s; g.add(o); }
  }
}
const gapX = (l: number) => l * 5.5 + STARTS.filter((s) => s > 0 && l >= s).length * 7;
const LEN = gapX(27);

const SHAPES: Shape[] = [
  { // 1. layers: each layer a standing plate of 47 nodes, side by side
    name: 'layers',
    place: (n, i) => { const k = i < 12 ? i : i - 12; const [rows, cols, y0] = i < 12 ? [3, 4, 12] : [5, 7, -1.5]; const r = Math.floor(k / cols), c = k % cols; return V(gapX(n.layer!) - LEN / 2, y0 - r * 2.9, (c - (cols - 1) / 2) * 2.9); },
    input: V(-LEN / 2 - 18, 2, 0), output: V(LEN / 2 + 18, 2, 0),
    stageAt: (s) => V(gapX(STARTS[s]) - LEN / 2, 17, 0),
  },
  { // 2. tunnel: each layer a pair of rings, heads inside and columns outside, to fly through
    name: 'tunnel',
    place: (n, i) => { const k = i < 12 ? i : i - 12, m = i < 12 ? 12 : 35, r = i < 12 ? 5 : 12, a = (k / m) * Math.PI * 2 + n.layer! * 0.11; return V(gapX(n.layer!) - LEN / 2, Math.sin(a) * r, Math.cos(a) * r); },
    input: V(-LEN / 2 - 18, 0, 0), output: V(LEN / 2 + 18, 0, 0),
    stageAt: (s) => V(gapX(STARTS[s]) - LEN / 2, 15, 0),
  },
  { // 3. orb: text enters at the core, each layer a shell further out, words leave at the surface
    name: 'orb',
    place: (n, i) => { const R = 6 + n.layer! * 1.7, g = Math.PI * (3 - Math.sqrt(5)); const k = i + 0.5, y = 1 - (2 * k) / 47, rr = Math.sqrt(1 - y * y), a = k * g + n.layer! * 0.7; return V(Math.cos(a) * rr * R, y * R, Math.sin(a) * rr * R); },
    input: V(0, 0, 0), output: V(0, 62, 0),
    stageAt: (s) => V(6 + STARTS[s] * 1.7 + 1, 0, 0),
  },
  { // 4. helix: the layers climb a spiral, each a disc of 47 nodes
    name: 'helix',
    place: (n, i) => { const l = n.layer!, a = l * 0.34, cx = Math.cos(a) * 14, cz = Math.sin(a) * 14, y = (27 - l) * 5 - 68; const k = i < 12 ? i : i - 12, m = i < 12 ? 12 : 35, r = i < 12 ? 2.6 : 6, b = (k / m) * Math.PI * 2; const tx = -Math.sin(a), tz = Math.cos(a); return V(cx + Math.cos(b) * r * Math.cos(a), y + Math.sin(b) * r, cz + Math.cos(b) * r * Math.sin(a)).addScaledVector(V(tx, 0, tz), 0); },
    input: V(0, 82, 0), output: V(0, -80, 0),
    stageAt: (s) => { const a = STARTS[s] * 0.34; return V(Math.cos(a) * 22, (27 - STARTS[s]) * 5 - 68, Math.sin(a) * 22); },
  },
  { // 5. onion: six nested glass domes, one per stage, a quarter cut away. Contour rings on each
    // dome map how hard its parts fire, from blue where quiet to red where hot.
    name: 'onion',
    place: (n, i) => domeDir(n, i).multiplyScalar(LR(n.layer!)),
    input: V(0, 0, 0), output: V(0, -(SHELL(5) + 0.3), 0),
    stageAt: (s) => V(Math.cos(CUT0 + 0.08) * DOME(s), 0.4, Math.sin(CUT0 + 0.08) * DOME(s)),
    extra: (g, net) => contourDomes(g, net, style === 'rainbow'),
  },
  { // 6. dna: the helix doubled. Attention heads coil up one strand, neuron columns up the other,
    // and each layer's parts meet in the middle on the residual stream, like base pairs.
    name: 'dna',
    place: (n, i) => {
      const l = n.layer!, a = l * 0.5 + (i < 12 ? 0 : Math.PI), y = l * 3.2 - 44, R = 15;
      const k = (i < 12 ? i : i - 12) + 0.5, m = i < 12 ? 12 : 35, r = i < 12 ? 2.2 : 3.6, yy = 1 - (2 * k) / m, rr = Math.sqrt(1 - yy * yy), b = k * GOLD;
      return V(Math.cos(a) * R + Math.cos(b) * rr * r, y + yy * r, Math.sin(a) * R + Math.sin(b) * rr * r);
    },
    input: V(0, -54, 0), output: V(0, 52, 0),
    stageAt: (s) => { const a = STARTS[s] * 0.5; return V(Math.cos(a) * 15, STARTS[s] * 3.2 - 44, Math.sin(a) * 15); },
    extra: (g, net) => {
      // the two backbones, each in the colour of the stage it passes through
      for (const off of [0, Math.PI]) {
        const pts: THREE.Vector3[] = [];
        for (let k = 0; k <= 27 * 8; k++) { const l = k / 8, a = l * 0.5 + off; pts.push(V(Math.cos(a) * 15, l * 3.2 - 44, Math.sin(a) * 15)); }
        const p: number[] = [], col: number[] = [], c = new THREE.Color();
        for (let k = 0; k + 1 < pts.length; k++) { const st = STARTS.filter((x) => k / 8 >= x).length - 1; c.set(STAGE[st]); p.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }
        g.add(fat(p, col, 4, 1));
      }
      void net;
    },
  },
  { // 7. the first onion: every layer a thin wire shell around the last, a quarter cut away
    name: 'first onion',
    place: (n, i) => { const R = OR(n.layer!), k = i + 0.5, y = 1 - (2 * k) / 47, rr = Math.sqrt(1 - y * y); const a = (k * GOLD + n.layer! * 0.5) % SWEEP; return V(Math.cos(a) * rr * R, y * R, Math.sin(a) * rr * R); },
    input: V(0, 0, 0), output: V(0, OR(27) + 7, 0),
    stageAt: (s) => V(OR(STARTS[s]) * 0.72, 0.6, OR(STARTS[s]) * 0.72 * 0.15),
    extra: (g) => {
      for (let l = 0; l < 28; l++) {
        const R = OR(l), c = new THREE.Color(STAGE[STARTS.filter((x) => l >= x).length - 1]), pts: number[] = [], col: number[] = [];
        const add = (a: number[], b: number[]) => { pts.push(...a, ...b); col.push(c.r, c.g, c.b, c.r, c.g, c.b); };
        for (let j = -2; j <= 2; j++) { const y = (j / 3) * R, rr = Math.sqrt(R * R - y * y); for (let k = 0; k < 48; k++) { const a1 = CUT0 + (k / 48) * SWEEP, a2 = CUT0 + ((k + 1) / 48) * SWEEP; add([Math.cos(a1) * rr, y, Math.sin(a1) * rr], [Math.cos(a2) * rr, y, Math.sin(a2) * rr]); } }
        for (const a of [0, Math.PI / 2, Math.PI, Math.PI * 1.5]) for (let k = 0; k < 32; k++) { const b1 = -Math.PI / 2 + (k / 32) * Math.PI, b2 = -Math.PI / 2 + ((k + 1) / 32) * Math.PI; add([Math.cos(a) * Math.cos(b1) * R, Math.sin(b1) * R, Math.sin(a) * Math.cos(b1) * R], [Math.cos(a) * Math.cos(b2) * R, Math.sin(b2) * R, Math.sin(a) * Math.cos(b2) * R]); }
        g.add(fat(pts, col, 1, 0.3));
      }
    },
  },
  { // 8. chip: built like a real microchip. 28 metal layers stacked over the package, each with an
    // attention block and a memory array, Manhattan traces to a central bus of vias (the residual
    // stream). Text in at a bond pad on top, words out through the pins at the bottom.
    name: 'chip',
    place: (n, i) => {
      const y = CHIP_Y(n.layer!);
      if (i < 12) { const c = i % 3, r = Math.floor(i / 3); return V(-12.5 + c * 3.6, y, -8.4 + r * 5.6); }
      const k = i - 12, c = k % 5, r = Math.floor(k / 5); return V(3 + c * 2.4, y, -10.8 + r * 3.6);
    },
    input: V(0, CHIP_Y(0) + 5, 0), output: V(0, -6, 0),
    stageAt: (s) => V(-16, CHIP_Y(STARTS[s]), -16),
    extra: (g, net) => chipParts(g, net),
  },
  { // 9. network: the traditional picture. 28 rows of 47 nodes, text in at the top, words out at the
    // bottom. Each node is wired to the three parts of the next layer that fired most in the real
    // receipt, so the lines show where that message actually flowed.
    name: 'network',
    place: (n, i) => NET_POS(n.layer!, i),
    input: V(0, NET_Y(0) + 9, 0), output: V(0, NET_Y(27) - 7, 0),
    stageAt: (s) => V(NET_X(0) - 2, NET_Y(STARTS[s]), 0),
    extra: (g, net) => netEdges(g, net),
  },
  { // 10. network with width: the same rows as blocks, so it reads as a solid 3D stack
    name: 'network3d',
    place: (n, i) => DEEP_POS(n.layer!, i),
    input: V(0, DEEP_Y(0) + 10, 0), output: V(0, DEEP_Y(27) - 8, 0),
    stageAt: (s) => V(15.5, DEEP_Y(STARTS[s]), 0),
    extra: (g, net) => {
      netEdges(g, net, DEEP_POS);
      // a thin square frame round every slab, so each layer reads as its own definite plate
      for (let l = 0; l < 28; l++) {
        const st = STARTS.filter((x) => l >= x).length - 1, c = new THREE.Color(STAGE[st]), y = DEEP_Y(l), e = 14.8, P: number[] = [], C: number[] = [];
        const pts = [[-e, -e], [e, -e], [e, e], [-e, e]];
        for (let k = 0; k < 4; k++) { const [a1, b1] = pts[k], [a2, b2] = pts[(k + 1) % 4]; P.push(a1, y, b1, a2, y, b2); C.push(c.r, c.g, c.b, c.r, c.g, c.b); }
        const o = tubes(P, C, 0.06); o.userData.stage = st; g.add(o);
      }
    },
  },
  { // 11. square helix: every layer a flat square plate, heads and columns in a grid, stepping round
    // a spiral like a staircase from text in at the top to words out at the bottom
    name: 'squarehelix',
    place: (n, i) => SQ_POS(n.layer!, i),
    input: V(0, SQ_Y(0) + 10, 0), output: V(0, SQ_Y(27) - 8, 0),
    stageAt: (s) => SQ_POS(STARTS[s], 46).add(V(0, 0, 0)),
    extra: (g, net) => {
      // each plate's outline and a three by three grid on it, in its stage colour
      for (let l = 0; l < 28; l++) {
        const st = STARTS.filter((x) => l >= x).length - 1, c = new THREE.Color(STAGE[st]), P: number[] = [], C: number[] = [];
        const at = (u: number, w: number) => SQ_AT(l, u, w);
        const line = (a: THREE.Vector3, b: THREE.Vector3) => { P.push(a.x, a.y, a.z, b.x, b.y, b.z); C.push(c.r, c.g, c.b, c.r, c.g, c.b); };
        for (let k = 0; k <= 3; k++) { const u = -9 + k * 6, w = -4.6 + k * (9.2 / 3); line(at(u, -4.6), at(u, 4.6)); line(at(-9, w), at(9, w)); }
        const o = fat(P, C, 1.2, 0.7); o.userData.stage = st; g.add(o);
      }
      void net;
    },
  },
  { // 12. network on its side
    name: 'networkh',
    place: (n, i) => HNET_POS(n.layer!, i),
    input: V(HNET_X(0) - 12, 0, 0), output: V(HNET_X(27) + 10, 0, 0),
    stageAt: (s) => V(HNET_X(STARTS[s]), 26, 0),
    extra: (g, net) => netEdges(g, net, HNET_POS),
  },
  { // 13. blob: the hairy planet
    name: 'blob',
    place: (n) => (blobDir.get(n.part) ?? V(0, 1, 0)).clone().multiplyScalar(BLOB_R + 2.5),
    input: V(0, BLOB_R + 10, 0), output: V(0, -BLOB_R - 10, 0),
    stageAt: (s) => V(BLOB_R + 9, BLOB_R * (0.8 - s * 0.32), 0),
    extra: (g, net) => blobParts(g, net),
  },
  { // 14. strata: each stage drawn its own way, rings widening down a dome
    name: 'strata',
    place: (n, i) => STR_POS(n.layer!, i),
    input: V(0, SA_Y(0) + 9, 0), output: STR_CORE(),
    stageAt: (s) => STR_POS(STARTS[s], 35).add(V(4, 0, 0)),
    extra: (g, net) => strataParts(g, net),
  },
  { // 15. chip: silver parts in rings round a central die, on a gold board
    name: 'chip',
    place: (n, i) => CH_POS(n.layer!, i),
    input: V(CH_R(0) + 6, 0.5, 0), output: V(0, 1.6, 0),
    stageAt: (s) => CH_POS(STARTS[s], 3 + s * 8).add(V(0, 2.5, 0)),
    extra: (g, net) => chipBrain(g, net),
  },
  { // 16. green: a real circuit board, a chip per stage, a component per part
    name: 'green',
    place: (n, i) => GB_POS(n.layer!, i),
    input: V(-66, 2.6, -24), output: V(-66, 2.6, 24),
    stageAt: (s) => V(GB_SC[s][0], 1.1, GB_SC[s][1]),
    extra: (g, net) => greenBoard(g, net),
  },
  { // 17. flat: the strata drawing on the gold floor
    name: 'flat',
    place: (n, i) => FS_TF(STR_POS(n.layer!, i)),
    input: FS_TF(V(0, SA_Y(0) + 9, 0)), output: FS_TF(STR_CORE()),
    stageAt: (s) => FS_TF(STR_POS(STARTS[s], 46).add(V(4, 0, 0))),
    extra: (g, net) => flatStrata(g, net),
  },
];

// ---------------------------------------------------------------- scene
const host = document.getElementById('world')!;
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(2, devicePixelRatio));
renderer.shadowMap.autoUpdate = false; // the shadow is worked out once per frame, not again for every close-up box
host.append(renderer.domElement);
const labels = new CSS2DRenderer();
labels.domElement.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:1';
host.append(labels.domElement);
const scene = new THREE.Scene();
scene.background = /[?&]white=1/.test(location.search) ? null : new THREE.Color('#010302'); // white site: never flash black while loading
const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 3000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true; controls.dampingFactor = 0.06; controls.autoRotate = true; controls.autoRotateSpeed = 0.4;
controls.autoRotateSpeed = 0.25; // always turning slowly, like on a podium
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0, 0, 1);
bloom.enabled = false; // no glow, ever
composer.addPass(bloom);
function resize() { const w = innerWidth, h = innerHeight; fatMats.forEach((m) => m.resolution.set(w, h)); renderer.setSize(w, h); labels.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); }
addEventListener('resize', resize); resize();
const world = new THREE.Group(); scene.add(world);
scene.add(new THREE.HemisphereLight('#ffffff', '#b8c4c4', 1.6)); const sun = new THREE.DirectionalLight('#ffffff', 2.2); sun.position.set(40, 60, 30); sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, far: 300 }); sun.shadow.bias = -0.0005; scene.add(sun); const fill = new THREE.DirectionalLight('#ffffff', 0.7); fill.position.set(-50, -10, -40); scene.add(fill);

// A label in a solid box, lifted off the thing it names, with a thin leader line down to it.
const tagLines = new Map<string, THREE.Object3D[]>(); // each tag's leader line, so the tour can fade it with the tag
function label(text: string, color: string, at: THREE.Vector3, lift = 5, push?: THREE.Vector3, width = 1.8) {
  if (shape >= 14) color = '#1c1f22'; // the chip: black chrome tags, no blue
  const d = document.createElement('div'); d.className = tagStage !== undefined ? 'lbl stagelbl' : 'lbl'; d.textContent = text; d.style.setProperty('background', color, 'important');
  if (document.body.dataset.theme === 'paper' && color.toLowerCase() === '#ffe20a') d.style.setProperty('box-shadow', 'inset 0 0 0 1px #222423', 'important');
  { const cc = new THREE.Color(color); if (cc.r * 0.3 + cc.g * 0.59 + cc.b * 0.11 < 0.25) d.style.setProperty('color', document.body.dataset.theme === 'paper' ? '#e3dfd6' : '#dfe7e1', 'important'); }
  const top = at.clone().add(V(0, lift, 0)); if (push) top.add(push);
  const o = new CSS2DObject(d); o.position.copy(top); o.center.set(0.5, lift < 0 ? 0 : 1); o.userData.stage = tagStage; world.add(o);
  if (lift || push) {
    const cc = new THREE.Color(color), pts = push ? [at, at.clone().add(push), top] : [at, top], p: number[] = [], col: number[] = [];
    for (let k = 0; k + 1 < pts.length; k++) { p.push(pts[k].x, pts[k].y, pts[k].z, pts[k + 1].x, pts[k + 1].y, pts[k + 1].z); col.push(cc.r, cc.g, cc.b, cc.r, cc.g, cc.b); }
    const ln = fat(p, col, width, 1); ln.userData.stage = tagStage; world.add(ln); tagLines.set(text, [...(tagLines.get(text) ?? []), ln]);
  }
}

// Nodes: soft round points, sized and lit by state, pulsing by how hard they fire.
const nodeMat = new THREE.ShaderMaterial({
  uniforms: { t: { value: 0 }, px: { value: 1 }, wave: { value: -10 } },
  vertexShader: `attribute float size; attribute float fire; attribute float layer; attribute float rshare; attribute vec3 color; varying vec3 vc; varying float vf; uniform float t; uniform float px; uniform float wave;
    void main(){ float w=exp(-pow(layer-wave,2.)*1.5)*rshare; vc=color*(1.+w*.5); vf=fire; vec4 mv=modelViewMatrix*vec4(position,1.);
    gl_PointSize=size*(1.+w*1.8)*px*(300./-mv.z); gl_Position=projectionMatrix*mv; }`,
  fragmentShader: `varying vec3 vc; varying float vf; void main(){ float d=length(gl_PointCoord-.5); if(d>.5) discard; float a=1.-smoothstep(.42,.5,d); gl_FragColor=vec4(vc,a); }`,
  transparent: true, depthWrite: false,
});

let nodeCloud: THREE.Points | null = null, cloudNodes: Node[] = [];
// every part as a small spinning wire shape: the shape is its kind, the spin is how hard it fires
const GEO = {
  head: new THREE.EdgesGeometry(new THREE.TetrahedronGeometry(0.55)),
  column: new THREE.EdgesGeometry(new THREE.BoxGeometry(0.62, 0.62, 0.62)),
  end: new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.5)),
};
const SOLID = { head: new THREE.TetrahedronGeometry(0.55), column: new THREE.BoxGeometry(0.62, 0.62, 0.62), end: new THREE.IcosahedronGeometry(1.5) };
let lineK = 1;
let shapeMode: 'outline' | 'yours' | 'solid' = 'yours';
const solidCache = new Map<string, THREE.MeshLambertMaterial>();
const solidMat = (hex: string) => solidCache.get(hex) ?? solidCache.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.5, metalness: 0.05, flatShading: true }) as unknown as THREE.MeshLambertMaterial).get(hex)!;
const matCache = new Map<string, THREE.LineBasicMaterial>();
const lineMat = (hex: string) => matCache.get(hex) ?? matCache.set(hex, new THREE.LineBasicMaterial({ color: hex })).get(hex)!;
let shapes: { o: THREE.Object3D; base: number; spin: number; layer: number; r: number; axis: THREE.Vector3 }[] = [];
const pickMat = new THREE.PointsMaterial({ size: 1, transparent: true, opacity: 0, depthWrite: false });
const outColour = () => (document.body.classList.contains('embed') ? (document.body.dataset.theme === 'dark' ? '#ffffff' : '#222423') : STAGE[5]);
let field: { pts: THREE.Points; seed: Float32Array; box: THREE.Box3 } | null = null;
let portal: { pts: THREE.Points; y0: number; depth: number; t: Float32Array; ang: Float32Array } | null = null;
let signals: { pts: THREE.Points; paths: THREE.Vector3[][]; t: Float32Array; speed: Float32Array } | null = null;
let net: Net | null = null, receipt: { shares: number[]; prompt: number; output: number } | null = null, shape = 0;
// views, like Blender's: the camera glides to front, side, top or close
const homeCtr = new THREE.Vector3(); let homeRad = 50;
// views never stop the spin: they only ease the camera's height, distance and (for side) a quarter
// turn on top of the turning it is already doing
let glide: { r0: number; r1: number; p0: number; p1: number; th: number; done: number; t: number; dur?: number; hold?: number; zoom?: boolean } | null = null;
let introDone = false;
function view(kind: string) {
  fly = null; controls.target.copy(homeCtr); controls.autoRotate = true;
  const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  const far = homeRad * (shape === 8 ? 3.1 : 2.4);
  const r1 = kind === 'full' ? homeRad * (shape === 13 ? 3.85 : 2.4) : kind === 'inside' ? homeRad * (shape === 8 || shape === 9 || shape === 11 ? 0.55 : 0.2) : kind === 'close' ? homeRad * 0.9 : far;
  const p1 = kind === 'full' ? 1.19 : kind === 'top' ? 0.12 : kind === 'inside' ? Math.PI / 2 - 0.05 : Math.PI / 2 - 0.12;
  glide = { r0: sph.radius, r1, p0: sph.phi, p1, th: kind === 'side' ? Math.PI / 2 : 0, done: 0, t: 0 };
}
let style: 'clean' | 'glow' | 'rainbow' | 'first' = 'clean';
let tagStage: number | undefined;
// strata callouts: a box drawn round each stage's section on screen, a line out, the name outside,
// like a cut away diagram; redrawn every frame so it follows the spin, and can be switched off
const callSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); callSvg.classList.add('callouts'); document.body.append(callSvg);
let calloutsOn = true, pinView = false; /* pinView: jumped to one part from the site, so the floating data in and data out labels hide until the close-ups come back on */
// yours: the parts the wallet holds are pink in the brain, and the ticked ones get pink zooms
const PINK = '#ff3fa4', SOLD = '#a3135f'; // yours hot pink, bought by others deep raspberry, both next to the cobalt
const myOn = new Set<number>(); let myPicked = false;
const mineMeshes = new Map<number, { pink: THREE.Object3D; plain: THREE.Object3D }>();
function applyMine() { mineMeshes.forEach((m, part) => { const on = myOn.has(part); m.pink.userData.off = !on; m.plain.userData.off = on; m.pink.visible = on && !hidden.has(m.pink.userData.stage); m.plain.visible = !on && !hidden.has(m.plain.userData.stage); }); }
// fly the camera to one part and hold there, looking at it from just outside the cylinder
let fly: { p0: THREE.Vector3; p1: THREE.Vector3; t0: THREE.Vector3; t1: THREE.Vector3; t: number } | null = null;
function goTo(part: number) { if (!net) return; for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => { if (n.part !== part) return;
  const f = fsNow[n.stage] ?? 1, at = STR_POS(l, i).multiply(V(f, 1, f)), out = V(at.x, 0, at.z).normalize();
  controls.autoRotate = false; fly = { p0: camera.position.clone(), p1: at.clone().addScaledVector(out, 16).add(V(0, 4, 0)), t0: controls.target.clone(), t1: at.clone(), t: 0 }; }); } const myCam = new THREE.PerspectiveCamera(38, 1, 0.1, 400);
// every zoom box can be dragged on its own; once moved it stays where it was put
const zoomPos = new Map<string, { x: number; y: number }>(); const zoomHome = new Map<string, { x: number; y: number }>(); addEventListener('resize', () => zoomHome.clear()); let zoomHits: { k: string; x: number; y: number }[] = [], zoomDrag: { k: string; dx: number; dy: number } | null = null;
// each close-up is drawn into its own small picture, a third of them per frame, then pasted every frame (cheap)
const zoomRT = new Map<string, THREE.WebGLRenderTarget>(); let zoomFrame = 0, zoomSlot = 0;
const blitCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1), blitMat = new THREE.MeshBasicMaterial({ toneMapped: false, depthTest: false, depthWrite: false });
const blitScene = new THREE.Scene(); blitScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), blitMat));
function zoomDraw(key: string, cam: THREE.Camera, x: number, y: number, w: number, h: number) {
  const H = innerHeight, pr = renderer.getPixelRatio(), rw = Math.round(w * pr), rh = Math.round(h * pr); let rt = zoomRT.get(key), fresh = false;
  if (!rt || rt.width !== rw || rt.height !== rh) { rt?.dispose(); rt = new THREE.WebGLRenderTarget(rw, rh, { samples: 4 }); zoomRT.set(key, rt); fresh = true; }
  if (fresh || zoomSlot++ % 3 === zoomFrame % 3) { renderer.setScissorTest(false); renderer.setRenderTarget(rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, cam); renderer.setRenderTarget(null); renderer.setScissorTest(true); }
  blitMat.map = rt.texture; renderer.setViewport(x, H - y - h, w, h); renderer.setScissor(x, H - y - h, w, h); renderer.render(blitScene, blitCam);
}
// ===== strip mode (?strip): a row of joined close-ups of the live network, sliding right to left forever, for the home page hero
const STRIP = new URLSearchParams(location.search).has('strip');
if (STRIP) document.body.classList.add('strip');
const stripCam = new THREE.PerspectiveCamera(38, 1, 0.1, 400), STRIP_SPEED = 30; // pixels a second
// which spots the close-ups look at: two per stage, at different layers and different places round the cylinder
const STRIP_PICKS = [0, 1, 2, 3, 4, 5].flatMap((st) => { const a = STARTS[st], b = st < 5 ? STARTS[st + 1] - 1 : 27; return [{ s: st, l: a + Math.floor((b - a) / 3), i: (st * 11 + 5) % 47 }, { s: st, l: b - Math.floor((b - a) / 3), i: (st * 17 + 29) % 47 }]; });
const stripTiles: HTMLDivElement[] = [];
function stripRender(now: number) {
  if (!stripReady) { hidden.add(6); applyPeel(); stripReady = true; } /* no liquidity water in the close-ups, it washed them out grey */
  if (MOSAIC) { mosaicRender(now); return; }
  if (ROBOT) { robotRender(now); return; }
  const W = innerWidth, H = innerHeight, LH = 16, th = H - LH, TW = Math.round(th * 1.35), N = STRIP_PICKS.length;
  world.updateMatrixWorld();
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(0xffffff, 1); renderer.clear();
  zoomFrame++; zoomSlot = 0; renderer.autoClear = false; renderer.setScissorTest(true); scene.matrixWorldAutoUpdate = false;
  const off = ((now / 1000) * STRIP_SPEED) % (TW * N), first = Math.floor(off / TW), shift = off - first * TW; let j = 0;
  for (; j * TW - shift < W; j++) {
    const k = (first + j) % N, x = Math.round(j * TW - shift), pk = STRIP_PICKS[k], f = fsNow[pk.s] ?? 1;
    const at = STR_POS(pk.l, pk.i).multiply(V(f, 1, f)).applyMatrix4(world.matrixWorld), out = V(at.x, 0, at.z).normalize();
    stripCam.position.copy(at).addScaledVector(out, 5.5).add(V(0, 1.2, 0)); stripCam.lookAt(at); stripCam.aspect = TW / th; stripCam.updateProjectionMatrix();
    zoomDraw(`strip${k}`, stripCam, x, 0, TW, th);
    let d = stripTiles[j]; if (!d) { d = document.createElement('div'); d.className = 'striptile'; d.innerHTML = '<span></span>'; document.body.append(d); stripTiles[j] = d; }
    const c = STAGE[pk.s]; d.style.display = 'block'; d.style.transform = `translateX(${x}px)`; d.style.width = `${TW}px`; d.style.height = `${H}px`; d.style.borderColor = c;
    const sp = d.firstChild as HTMLSpanElement; sp.style.background = c; sp.textContent = `${STAGE_NAMES[pk.s]}, layer ${pk.l}`;
  }
  for (; j < stripTiles.length; j++) stripTiles[j].style.display = 'none';
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.autoClear = true; scene.matrixWorldAutoUpdate = true;
}
// mosaic strip (?strip=2): small close-ups in a row along the bottom, some with one or two more stacked on top,
// each showing the section of the network directly above the one below it, like pieces cut out of the same picture
const MOSAIC = new URLSearchParams(location.search).get('strip') === '2';
const stOf = (l: number) => STARTS.filter((x) => l >= x).length - 1;
const MOSAIC_PICKS = [0, 1, 2, 3, 4, 5].flatMap((st) => { const a = STARTS[st], b = st < 5 ? STARTS[st + 1] - 1 : 27; return [0, 1, 2, 3].map((n) => ({ s: st, l: Math.round(a + ((b - a) * (n + 0.5)) / 4), i: (st * 13 + n * 11 + 3) % 47 })); });
// like an unfolded cube: [pieces above, pieces below] each base piece, so the strip reads as cube nets joined end to end
const MOSAIC_NET: [number, number][] = [[0, 0], [2, 0], [1, 1], [0, 1], [0, 0], [2, 1], [1, 0], [0, 0], [1, 2], [0, 1], [0, 0], [2, 1], [1, 0], [0, 0], [0, 2], [1, 1], [2, 2], [0, 0], [0, 1], [1, 0]];
// robot mode (?strip=3): an android in side profile, built from the live close-ups and always on screen.
// Domed skull, flat featureless face, sharp chin, long neck; the machine shows in the seams: panel lines across
// the skull, a round joint at the ear and a segmented neck, all left as thin white gaps between the pieces.
const ROBOT = new URLSearchParams(location.search).get('strip') === '3';
const robotRT: THREE.WebGLRenderTarget[] = []; let robotCells: { x: number; y: number; pick: number }[] = [], robotSlot = 0, robotSize = '';
const ROBOT_PATH = 'M30 12 C46 3 68 4 78 16 C83 22 84 30 83 36 L88 42 L83 47 L84 57 L86 61 L82 64 C80 70 74 72 66 72 L60 72 L60 82 C74 84 90 89 98 100 L2 100 C10 89 24 84 38 82 L38 72 C27 68 20 58 20 44 C20 28 23 18 30 12 Z';
function robotSeam(x: number, y: number) { // x, y in the 0..100 drawing
  if (Math.abs(Math.hypot(x - 44, y - 46) - 7) < 1.6) return true; // the ear joint, a ring
  if (Math.abs(x - (60 + (y - 12) * 0.12)) < 1.2 && y > 10 && y < 40) return true; // a panel line down the skull
  if (Math.abs(y - (24 + (x - 30) * 0.05)) < 1.1 && x > 26 && x < 58) return true; // a panel line across the back of the head
  if (y > 72 && y < 82 && Math.abs(y - 77) < 0.9) return true; // a neck segment
  return false;
}
function robotRender(now: number) {
  if (!stripReady) { hidden.add(6); applyPeel(); stripReady = true; }
  const W = innerWidth, H = innerHeight, S = Math.max(12, Math.floor(H / 30)), G = 1;
  if (robotSize !== `${W}x${H}`) { robotSize = `${W}x${H}`; robotCells = []; let n = 0;
    const cv = document.createElement('canvas').getContext('2d')!, path = new Path2D(ROBOT_PATH), box = Math.min(W, H), ox = (W - box) / 2, oy = H - box;
    for (let y = 0; y + S <= H; y += S) for (let x = 0; x + S <= W; x += S) { const px = ((x + S / 2 - ox) / box) * 100, py = ((y + S / 2 - oy) / box) * 100;
      if (!cv.isPointInPath(path, px, py) || robotSeam(px, py)) continue; robotCells.push({ x, y, pick: (n * 7 + (n >> 3)) % MOSAIC_PICKS.length }); n++; } }
  world.updateMatrixWorld();
  const pr = renderer.getPixelRatio(), rs = Math.round(S * pr);
  for (let i = 0; i < 6; i++) { const k = robotSlot++ % MOSAIC_PICKS.length, pk = MOSAIC_PICKS[k], f = fsNow[pk.s] ?? 1;
    let rt = robotRT[k]; if (!rt || rt.width !== rs) { rt?.dispose(); rt = robotRT[k] = new THREE.WebGLRenderTarget(rs, rs, { samples: 4 }); }
    const at = STR_POS(pk.l, pk.i).multiply(V(f, 1, f)).applyMatrix4(world.matrixWorld), out = V(at.x, 0, at.z).normalize();
    stripCam.position.copy(at).addScaledVector(out, 6).add(V(0, 1.2, 0)); stripCam.lookAt(at); stripCam.aspect = 1; stripCam.updateProjectionMatrix();
    renderer.setScissorTest(false); renderer.setRenderTarget(rt); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.render(scene, stripCam); renderer.setRenderTarget(null); }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(0xffffff, 1); renderer.clear(); renderer.autoClear = false; renderer.setScissorTest(true);
  for (const c of robotCells) { const rt = robotRT[c.pick]; if (!rt) continue; const vx = c.x + G, vy = H - c.y - S + G, w = S - G * 2;
    renderer.setViewport(vx, vy, w, w); renderer.setScissor(vx, vy, w, w); blitMat.map = rt.texture; renderer.render(blitScene, blitCam); }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.autoClear = true;
}
let stripReady = false;
function mosaicRender(now: number) {
  if (!stripReady) { hidden.add(6); applyPeel(); stripReady = true; } // no liquidity water in the shots: looking through it washed them out
  const W = innerWidth, H = innerHeight, S = 50, TW = Math.round(S * 1.3), N = MOSAIC_PICKS.length;
  world.updateMatrixWorld();
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(0xffffff, 1); renderer.clear();
  zoomFrame++; zoomSlot = 0; renderer.autoClear = false; renderer.setScissorTest(true); scene.matrixWorldAutoUpdate = false;
  const off = ((now / 1000) * STRIP_SPEED) % (TW * N), first = Math.floor(off / TW), shift = off - first * TW; let t = 0;
  for (let j = 0; j * TW - shift < W; j++) {
    const k = (first + j) % N, x = Math.round(j * TW - shift), pk = MOSAIC_PICKS[k];
    const [na, nb] = MOSAIC_NET[k % MOSAIC_NET.length], base = H - 3 * S;
    for (let up = -nb; up <= na; up++) { // negative is below the row, positive above
      const l = Math.min(27, Math.max(0, pk.l - up * 3)), st = stOf(l), f = fsNow[st] ?? 1, y = base - up * S;
      const at = STR_POS(l, pk.i).multiply(V(f, 1, f)).applyMatrix4(world.matrixWorld), out = V(at.x, 0, at.z).normalize();
      stripCam.position.copy(at).addScaledVector(out, 7).add(V(0, 1.6, 0)); stripCam.lookAt(at); stripCam.aspect = TW / S; stripCam.updateProjectionMatrix();
      zoomDraw(`mosaic${k}_${up}`, stripCam, x, y, TW, S);
      let d = stripTiles[t]; if (!d) { d = document.createElement('div'); d.className = 'striptile'; d.innerHTML = '<span></span>'; document.body.append(d); stripTiles[t] = d; }
      d.style.display = 'block'; d.style.transform = `translate(${x}px, ${y}px)`; d.style.width = `${TW}px`; d.style.height = `${S}px`; d.style.borderColor = STAGE[st]; d.classList.add('bare'); t++;
    }
  }
  for (; t < stripTiles.length; t++) stripTiles[t].style.display = 'none';
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.autoClear = true; scene.matrixWorldAutoUpdate = true;
}
function drawCallouts() {
  if (pinView && (calloutsOn || myLabels)) { pinView = false; labels.domElement.style.visibility = ''; }
  if (shape !== 13 || underwater || document.body.classList.contains('touring') || (!calloutsOn && (!myOn.size || !myLabels))) { callSvg.innerHTML = ''; return; } // the layer zooms and your pink zooms switch on and off separately
  const lite = camera.position.distanceTo(controls.target) < homeRad * 1.6; // zoomed right in: just the lines and names, no boxes
  const W = innerWidth, H = innerHeight, pv = V(0, 0, 0), boxes: { s: number; x0: number; x1: number; y0: number; y1: number }[] = [];
  world.updateMatrixWorld();
  // a small square over one spot of each stage: the front right of its middle layer, where it reads best
  let edge = -1e9, edgeL = 1e9; const FR = [0.8, 0.28, 0.68, 0.86, 0.22, 0.74]; // two stages called out on the left, four on the right
  for (let st = 0; st < 6; st++) { if (hidden.has(st)) continue; const a = STARTS[st], b = st < 5 ? STARTS[st + 1] - 1 : 27, l = Math.round((a + b) / 2);
    const pts = Array.from({ length: 47 }, (_, i) => { pv.copy(STR_POS(l, i)).add(V(0, -0.6, 0)).multiply(V(fsNow[st], 1, fsNow[st])).applyMatrix4(world.matrixWorld).project(camera); return { x: (pv.x + 1) / 2 * W, y: (1 - pv.y) / 2 * H, z: pv.z }; });
    const xs = pts.map((p) => p.x), lo = Math.min(...xs), hi = Math.max(...xs); edge = Math.max(edge, hi); edgeL = Math.min(edgeL, lo);
    const zMid = pts.reduce((q, p) => q + p.z, 0) / 47, front = pts.filter((p) => p.z <= zMid);
    const target = lo + (hi - lo) * FR[st], pk = front.reduce((q, p) => (Math.abs(p.x - target) < Math.abs(q.x - target) ? p : q), front[0]);
    if (calloutsOn) boxes.push({ s: st, x0: pk.x - 22, x1: pk.x + 22, y0: pk.y - 17, y1: pk.y + 17 }); }
  // each spot magnified in its own box to the right, like an anatomy plate, joined by a line
  const ZW = 100, ZH = 72, bw = 22, bh = 16, colX = Math.min(edge + 70, W - 220 - ZW - 20), colL = Math.max(20, edgeL - 70 - ZW), gap = Math.max(14, Math.min(34, (H - 140 - 4 * (ZH + 18)) / 3));
  const y0 = Math.max(60, (H - 4 * (ZH + 18 + gap)) / 2);
  boxes.sort((p, q) => p.y0 - q.y0);
  zoomFrame++; zoomSlot = 0; const zc = (camera as THREE.PerspectiveCamera).clone(); renderer.autoClear = false; renderer.setScissorTest(true); scene.matrixWorldAutoUpdate = false; // nothing moves between the main picture and its close-ups
  let svg = ''; zoomHits = [];
  boxes.forEach((b, k) => {
    const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, sx = cx - bw / 2, sy = cy - bh / 2, left = FR[b.s] < 0.5, row = boxes.filter((q, j) => j < k && (FR[q.s] < 0.5) === left).length, JX = [0, 26, 9, 38], JY = [0, 7, -5, 11]; let zx = left ? colL - JX[row % 4] - 14 : colX + JX[row % 4], zy = (left ? y0 + 70 + row * (ZH + 70) : y0 + row * (ZH + 18 + gap)) + JY[(row + b.s) % 4], e = b.s < 5 ? STARTS[b.s + 1] - 1 : 27, c = STAGE[b.s];
    const kk = `s${b.s}`, ov = zoomPos.get(kk) ?? zoomHome.get(kk); if (ov) { zx = ov.x; zy = ov.y; } else zoomHome.set(kk, { x: zx, y: zy }); zoomHits.push({ k: kk, x: zx, y: zy });
    zc.setViewOffset(W, H, sx, sy, bw, bh); zc.aspect = bw / bh; zc.updateProjectionMatrix();
    if (!lite) zoomDraw(kk, zc, zx, zy, ZW, ZH);
    svg += (lite ? '' : `<rect x="${sx}" y="${sy}" width="${bw}" height="${bh}" fill="none" stroke="${c}" stroke-width="1.2"/>`)
      + `<path d="${left ? `M${sx} ${sy} L${zx + ZW} ${zy} M${sx} ${sy + bh} L${zx + ZW} ${zy + ZH}` : `M${sx + bw} ${sy} L${zx} ${zy} M${sx + bw} ${sy + bh} L${zx} ${zy + ZH}`}" stroke="${c}" stroke-width=".8" fill="none"/>`
      + (lite ? '' : `<rect x="${zx}" y="${zy}" width="${ZW}" height="${ZH}" fill="none" stroke="${c}" stroke-width="1.2"/>`)
      + `<foreignObject x="${zx}" y="${zy + ZH}" width="${ZW}" height="15"><div class="callt" style="background:${c};width:${ZW}px">${STAGE_NAMES[b.s]} ${STARTS[b.s]} to ${e}</div></foreignObject>`;
  });
  // your ticked neurons: pink zooms down the far left
  if (net && myLabels) { let k = 0, mk = 0; const mb = mineBox.getBoundingClientRect(); if (!mineMin) mineFullH = Math.max(mineFullH, mb.height); for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => { if (!n.mine) return; const slotK = mk++; if (!myOn.has(n.part) || slotK >= 3) return; k = slotK;
    const fsl = fsNow[n.stage] ?? 1; pv.copy(STR_POS(l, i)).multiply(V(fsl, 1, fsl)).applyMatrix4(world.matrixWorld).project(camera); const px = (pv.x + 1) / 2 * W, py = (1 - pv.y) / 2 * H, sx = px - bw / 2, sy = py - bh / 2;
    let zx = 34 + (k % 2) * 18, zy = MINE_TOP + mineFullH + 26 + k * (ZH + 30); const kk = `p${n.part}`, ov = zoomPos.get(kk) ?? zoomHome.get(kk); if (ov) { zx = ov.x; zy = ov.y; } else zoomHome.set(kk, { x: zx, y: zy }); zoomHits.push({ k: kk, x: zx, y: zy });
    // its own camera just outside the part, so the part itself fills the window even when it's round the back
    if (!lite) { const at = STR_POS(l, i).multiply(V(fsl, 1, fsl)).applyMatrix4(world.matrixWorld), out = V(at.x, 0, at.z).normalize(); myCam.position.copy(at).addScaledVector(out, 5.5).add(V(0, 1.2, 0)); myCam.lookAt(at); myCam.aspect = ZW / ZH; myCam.updateProjectionMatrix();
      zoomDraw(kk, myCam, zx, zy, ZW, ZH); }
    svg += (lite ? '' : `<rect x="${sx}" y="${sy}" width="${bw}" height="${bh}" fill="none" stroke="${PINK}" stroke-width="1.4"/>`)
      + `<path d="M${sx} ${sy} L${zx + ZW} ${zy} M${sx} ${sy + bh} L${zx + ZW} ${zy + ZH}" stroke="${PINK}" stroke-width=".9" fill="none"/>`
      + (lite ? '' : `<rect x="${zx}" y="${zy}" width="${ZW}" height="${ZH}" fill="none" stroke="${PINK}" stroke-width="1.4"/>`)
      + `<foreignObject x="${zx}" y="${zy + ZH}" width="${ZW}" height="15"><div class="callt" style="background:${PINK};width:${ZW}px">layer ${l} ${n.kind === 'head' ? 'head' : 'column'} ${n.within}</div></foreignObject>`; }); }
  renderer.setScissorTest(false); renderer.setViewport(0, 0, W, H); renderer.setClearColor(0x000000, 0); renderer.autoClear = true; scene.matrixWorldAutoUpdate = true;
  callSvg.innerHTML = svg;
}
const dot0 = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 32; const g = cv.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(16, 16, 14, 0, 7); g.fill(); return new THREE.CanvasTexture(cv); })();
const hidden = new Set<number>();
let baseSizes: number[] = [];
let signalStages: Uint8Array[] = [];
// a round dot for the signals
const dot = (() => { const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d')!; g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 28, 0, 7); g.fill(); return new THREE.CanvasTexture(cv); })();

function build() {
  if (!net) return;
  document.body.classList.toggle('onion', shape === 3 || shape === 4 || shape === 8 || shape === 9 || shape === 10 || shape === 11 || shape === 12 || shape === 13 || shape >= 14);
  document.body.classList.toggle('gold', shape >= 14); if (shape >= 14) document.body.style.setProperty('background', (shape === 15 ? 'radial-gradient(ellipse at 50% 45%, #1f4a2c 0%, #0c2214 70%, #06140b 100%)' : 'radial-gradient(ellipse at 50% 45%, #6b5410 0%, #2a2005 70%, #171203 100%)'), 'important'); else document.body.style.removeProperty('background');
  renderer.shadowMap.enabled = shape >= 13; renderer.shadowMap.type = shape === 13 ? THREE.VSMShadowMap : THREE.PCFSoftShadowMap; sun.castShadow = shape >= 13;
  if (shape === 13) { sun.position.set(0.5, 200, 0.5); Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 1, far: 700 }); sun.shadow.radius = 3.5; sun.shadow.blurSamples = 10; sun.shadow.intensity = 1; sun.shadow.mapSize.set(2048, 2048); sun.shadow.map?.dispose(); sun.shadow.map = null as unknown as THREE.WebGLRenderTarget; } else { sun.shadow.intensity = 1; sun.position.set(40, 60, 30); Object.assign(sun.shadow.camera, { left: -80, right: 80, top: 80, bottom: -80, near: 0.5, far: 300 }); }
  sun.shadow.camera.updateProjectionMatrix();
  if (shape === 13) document.body.style.setProperty('background', 'radial-gradient(ellipse at 50% 40%, #ffffff 0%, #f6f6f4 45%, #e4e4e1 100%)', 'important'); renderer.toneMapping = shape >= 14 ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping; scene.fog = shape >= 14 ? new THREE.Fog(shape === 15 ? '#0c2214' : '#2a2005', 260, 700) : null; scene.environment = shape >= 14 ? chipEnv() : null;
  world.clear(); mineMeshes.clear(); blob = null; strataTick = null; cove = null; bubbleAt = null; if (underwater) { underwater = false; document.body.classList.remove('underwater'); }
  const glow = style === 'glow' || style === 'first';
  bloom.strength = 0; bloom.enabled = false;
  nodeMat.blending = THREE.NormalBlending; nodeMat.needsUpdate = true;
  const S = SHAPES[shape], c = new THREE.Color();
  const pos = new Map<number, THREE.Vector3>();
  for (const L of net.layers) L.forEach((n, i) => pos.set(n.part, S.place(n, i)));
  pos.set(net.input.part, S.input); pos.set(net.output.part, S.output);

  S.extra?.(world, net);
  // the real wiring: every layer reads from and writes to one residual stream. Each part is a spoke
  // to its layer's station, and the stream runs station to station from text in to words out.
  const cl: number[] = [], cc: number[] = [];
  const seg = (p: THREE.Vector3, q: THREE.Vector3, col: string, k: number) => { c.set(col).multiplyScalar(k); cl.push(p.x, p.y, p.z, q.x, q.y, q.z); cc.push(c.r, c.g, c.b, c.r, c.g, c.b); };
  const stations = net.layers.map((L) => L.reduce((a, n) => a.add(pos.get(n.part)!), V(0, 0, 0)).multiplyScalar(1 / L.length));
  if (glow) {
    for (const [a, b] of wires(net, 3, 9)) { const p = pos.get(a.part)!, q = pos.get(b.part)!; seg(p, q, STAGE[a.stage], a.sold > 0 && b.sold > 0 ? 0.9 : 0.3); }
  } else if (shape !== 4 && shape !== 7 && shape !== 8 && shape !== 9 && shape !== 11 && shape < 12) {
    net.layers.forEach((L, l) => L.forEach((n) => seg(pos.get(n.part)!, stations[l], STAGE[n.stage], n.sold > 0 ? 0.9 : 0.28)));
    const stream = [S.input, ...stations, S.output];
    const curve = new THREE.CatmullRomCurve3(stream).getPoints(stream.length * 12);
    const sp: number[] = [], sc: number[] = [];
    for (let k = 0; k + 1 < curve.length; k++) { sp.push(curve[k].x, curve[k].y, curve[k].z, curve[k + 1].x, curve[k + 1].y, curve[k + 1].z); sc.push(0.91, 1, 0.94, 0.91, 1, 0.94); }
    world.add(fat(sp, sc, 4.5, 1));
  }
  world.add(fat(cl, cc, style === 'first' ? 1 : 2.4, style === 'first' ? 0.6 : 0.9));

  // a Rubik style wire grid boxing in each layer, so every layer reads as its own block
  if (shape === 0 && !glow) {
    const gp: number[] = [], gcol: number[] = [];
    const sg = (a: number[], b: number[], col: string) => { c.set(col).multiplyScalar(0.55); gp.push(...a, ...b); gcol.push(c.r, c.g, c.b, c.r, c.g, c.b); };
    net.layers.forEach((L) => {
      const bb = new THREE.Box3().setFromPoints(L.map((n) => pos.get(n.part)!)).expandByScalar(1.1);
      const lo = bb.min, hi = bb.max, col = STAGE[L[0].stage], N = 3;
      const at = (i: number, j: number, k: number) => [lo.x + (hi.x - lo.x) * i / N, lo.y + (hi.y - lo.y) * j / N, lo.z + (hi.z - lo.z) * k / N];
      // the box edges and a three by three grid on each face
      for (let a = 0; a <= N; a++) for (let b = 0; b <= N; b++) {
        if ((a === 0 || a === N) || (b === 0 || b === N)) {
          sg(at(0, a, b), at(N, a, b), col); sg(at(a, 0, b), at(a, N, b), col); sg(at(a, b, 0), at(a, b, N), col);
        }
      }
    });
    world.add(fat(gp, gcol, 1.8, 0.6));
  }
  for (const st of stations) { const m = new THREE.Mesh(new THREE.OctahedronGeometry(0.35), new THREE.MeshBasicMaterial({ color: '#e8fff0' })); if (shape !== 4 && shape !== 8 && shape !== 9 && shape !== 11 && shape < 12) { m.position.copy(st); m.scale.setScalar(2); world.add(m); } }

  // nodes
  cloudNodes = [...net.nodes];
  const np: number[] = [], ncol: number[] = [], ns: number[] = [], nf: number[] = [], nl: number[] = [], nr: number[] = [];
  const rs = receipt?.shares ?? [], kt: Record<string, number> = {}, kc: Record<string, number> = {};
  cloudNodes.forEach((n) => { kt[n.kind] = (kt[n.kind] ?? 0) + (rs[n.part] ?? 0); kc[n.kind] = (kc[n.kind] ?? 0) + 1; });
  for (const n of cloudNodes) {
    const p = pos.get(n.part)!; np.push(p.x, p.y, p.z); nf.push(n.fire);
    nl.push(n.layer ?? (n.kind === 'embedding' ? -1 : 28));
    const ratio = (rs[n.part] ?? 0) / ((kt[n.kind] ?? 0) / (kc[n.kind] ?? 1) || 1); nr.push(Math.max(0, Math.min(1, (Math.log2(ratio || 1e-9) + 1) / 3)));
    const big = n.kind === 'embedding' || n.kind === 'unembedding';
    // colour: the stage, or on the rainbow onion how hard it fires on the same scale as the lines. white only for yours
    if (n.mine) c.set('#ffffff');
    else if (style === 'rainbow') c.set(RAMP[Math.min(RAMP.length - 1, Math.floor(n.fire * RAMP.length))]);
    else c.set(STAGE[n.stage]);
    // size: how much of it is bought
    ns.push(n.mine ? (big ? 5 : 2.2) : n.sold >= 1 ? (big ? 5 : 1.9) : n.sold > 0 ? (big ? 4 : 1.35) : (big ? 3 : 0.7));
    ncol.push(c.r, c.g, c.b);
  }
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(np, 3)).setAttribute('color', new THREE.Float32BufferAttribute(ncol, 3))
    .setAttribute('size', new THREE.Float32BufferAttribute(ns, 1)).setAttribute('fire', new THREE.Float32BufferAttribute(nf, 1))
    .setAttribute('layer', new THREE.Float32BufferAttribute(nl, 1)).setAttribute('rshare', new THREE.Float32BufferAttribute(nr, 1));
  nodeCloud = new THREE.Points(g, pickMat); world.add(nodeCloud); baseSizes = ns.slice();
  shapes = [];
  const rr = rng(77);
  cloudNodes.forEach((n, i) => {
    const big = n.kind === 'embedding' || n.kind === 'unembedding';
    const hex = '#' + new THREE.Color(ncol[i * 3], ncol[i * 3 + 1], ncol[i * 3 + 2]).getHexString();
    const kind = big ? 'end' : n.kind === 'head' ? 'head' : 'column';
    const solid = shapeMode === 'solid' || (shapeMode === 'yours' && n.mine);
    let o: THREE.Object3D;
    if (big) {
      // the nucleus: solid black, its edge in its own colour, white if yours
      if (shape === 13) { o = new THREE.Mesh(SOLID.end, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05, flatShading: true })); o.add(new THREE.LineSegments(GEO.end, lineMat(STAGE[0]))); }
      else { o = new THREE.Mesh(SOLID.end, new THREE.MeshBasicMaterial({ color: '#010302' }));
      o.add(new THREE.LineSegments(GEO.end, lineMat(n.mine ? '#ffffff' : n.kind === 'embedding' ? STAGE[0] : '#ffffff'))); }
    } else o = solid ? new THREE.Mesh(SOLID[kind], solidMat(hex)) : new THREE.LineSegments(GEO[kind], lineMat(hex));
    o.position.set(np[i * 3], np[i * 3 + 1], np[i * 3 + 2]);
    const base = (n.mine ? 1.25 : n.sold >= 1 ? 1.1 : n.sold > 0 ? 0.8 : 0.55) * (shapeMode === 'solid' ? 1.1 : 2) * (n.kind === 'embedding' ? 1.8 : 1) * (shape === 7 ? 0.55 : shape === 8 || shape === 9 || shape === 10 || shape === 11 ? 0.8 : 1);
    o.scale.setScalar(base); o.rotation.set(rr() * 6, rr() * 6, rr() * 6);
    o.userData.stage = n.layer === null ? undefined : n.stage;
    if (((shape >= 12) && n.layer !== null) || (shape >= 14 && (n === net.input || n === net.output))) { o.visible = false; o.userData.keepHidden = true; }
    world.add(o);
    o.userData.rest = o.position.clone();
    shapes.push({ o, base, spin: 0.05 + n.fire * 0.9, layer: nl[i], r: nr[i], axis: V(rr() - 0.5, rr() - 0.5, rr() - 0.5).normalize() });
  });

  // rings around what is yours, diamonds on measured traits
  let mineCount = 0;
  for (const n of cloudNodes) {
    const p = pos.get(n.part)!;
    if (n.mine) {
      const ring = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 40 }, (_, k) => V(Math.cos(k / 40 * 6.283) * 0.9, Math.sin(k / 40 * 6.283) * 0.9, 0))), new THREE.LineBasicMaterial({ color: '#ffffff' }));
      ring.position.copy(p); ring.userData.face = true; ring.userData.stage = n.layer === null ? undefined : n.stage; world.add(ring);
    }
    if (n.trait >= 70 && !COMPARE) {
      const d = new THREE.Mesh(new THREE.OctahedronGeometry(0.55), new THREE.MeshLambertMaterial({ color: traitColour(), flatShading: true })); d.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(0.55)), new THREE.LineBasicMaterial({ color: '#222423' })));
      d.position.copy(p); d.userData.stage = n.stage; world.add(d);
    }
  }
  applyPeel();
  // on the console: every part sends a spike straight out from its skin, as long as it fires hard,
  // so the brain reads as a textured, living sphere
  if (shape === 4 && document.body.dataset.theme === 'hud') {
    const sp: number[] = [], sc: number[] = [], cc = new THREE.Color();
    cloudNodes.forEach((n) => {
      if (n.layer === null) return;
      const p = pos.get(n.part)!, len = 0.6 + n.fire * 6.5, q = p.clone().multiplyScalar(1 + len / p.length());
      cc.set(STAGE[n.stage]); sp.push(p.x, p.y, p.z, q.x, q.y, q.z); sc.push(cc.r * 0.7, cc.g * 0.7, cc.b * 0.7, cc.r, cc.g, cc.b);
    });
    const spikes = fat(sp, sc, 1.6, 0.95); world.add(spikes);
  }
  // words out: a portal opening below, rings widening as they fall, and the receipt's real output
  // words dropping out through it, one dot per word
  portal = null;
  if (shape === 3 || shape === 4 || shape === 8 || shape === 9 || shape === 10 || shape === 11) {
    const O = S.output, col = new THREE.Color(outColour()), pp: number[] = [], pc: number[] = [], rings = 8;
    const pg = new THREE.Group(); pg.position.copy(O); pg.rotation.z = shape === 11 ? Math.PI / 2 : 0; world.add(pg);
    for (let k = 0; k < rings; k++) {
      const r = 1.4 + k * k * 0.34 + k * 0.7, y = -k * 1.6, a = 1 - (k / rings) * 0.6;
      for (let j = 0; j < 64; j++) { const a1 = (j / 64) * Math.PI * 2, a2 = ((j + 1) / 64) * Math.PI * 2; pp.push(Math.cos(a1) * r, y, Math.sin(a1) * r, Math.cos(a2) * r, y, Math.sin(a2) * r); pc.push(col.r * a, col.g * a, col.b * a, col.r * a, col.g * a, col.b * a); }
    }
    const ringObj = fat(pp, pc, 2.4, 1); pg.add(ringObj);
    const words = receipt?.output ?? 11, N = Math.max(1, words);
    const t = new Float32Array(N), ang = new Float32Array(N), pos2 = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) { t[i] = i / N; ang[i] = (i / N) * Math.PI * 2 * 3; }
    const pts = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos2, 3)), new THREE.PointsMaterial({ color: outColour(), size: 0.9, map: dot, alphaTest: 0.5 }));
    pg.add(pts); portal = { pts, y0: 0, depth: rings * 1.6, t, ang };
  }
  // stage, input and output labels
  if (shape === 11) {
    STARTS.forEach((s, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; tagStage = i; label(`${STAGE_NAMES[i]} ${s} to ${e}`, STAGE[i], V(HNET_X(s), 24, 0), 3, undefined, 1.6); }); tagStage = undefined;
    label('data in', STAGE[0], S.input, 4);
    label('data out', outColour(), S.output.clone().add(V(13.5, 0, 0)), -3, undefined, 2);
  } else if (shape === 8 || shape === 9) {
    STARTS.forEach((s, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; tagStage = i; label(`${STAGE_NAMES[i]} ${s} to ${e}`, STAGE[i], shape === 9 ? V(15.5, DEEP_Y(s), 0) : V(NET_X(46) + 1, NET_Y(s), 0), 0, V(5, 0, 0), 1.6); }); tagStage = undefined;
    label('data in', STAGE[0], S.input, 3);
    label('data out', outColour(), S.output.clone().add(V(0, -12.5, 0)), -2, undefined, 2);
  } else if (shape === 7) {
    STARTS.forEach((s, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; tagStage = i; label(`${STAGE_NAMES[i]} ${s} to ${e}`, STAGE[i], V(-16, CHIP_Y(s), -14), 0, V(-10, 0, 0), 1.6); }); tagStage = undefined;
    label('data in', STAGE[0], S.input, 3);
    label('data out', STAGE[5], S.output, -3);
  } else if (shape === 4) {
    // outside the domes: out along the cut edge, each a level higher, on a heavy line
    // a tidy column on the left: each label's line runs out along the floor from its own dome, then up
    STARTS.forEach((s, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; tagStage = i; label(`${STAGE_NAMES[i]} ${s} to ${e}`, STAGE[i], V(-SHELL(i), 0, 0), document.body.classList.contains('embed') ? -(4 + i * 4.5) : 4 + i * 5, V(-(SHELL(5) + 24 - SHELL(i)), 0, 0), 2); }); tagStage = undefined;
    label('data in', STAGE[0], S.input, 6, V(DOME(5) + 28, 0, 0), 2);
    label('data out', outColour(), S.output.clone().add(V(0, -12.5, 0)), -2, undefined, 2);
  } else {
    if (shape !== 13) STARTS.forEach((s, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; label(`${STAGE_NAMES[i]} ${s} to ${e}`, STAGE[i], S.stageAt(i), 4); });
    label('data in', STAGE[0], S.input, 4);
    label('data out', STAGE[5], S.output, 4);
  }

  signals = null;

  field = null;
  if (false as boolean) {
    const bb = new THREE.Box3().setFromPoints([...pos.values()]).expandByVector(V(10, 4, 14));
    const N = 6000, P = new Float32Array(N * 3), C = new Float32Array(N * 3), seed = new Float32Array(N * 3), rr = rng(99);
    for (let i = 0; i < N; i++) {
      P[i * 3] = bb.min.x + rr() * (bb.max.x - bb.min.x); P[i * 3 + 1] = bb.min.y + rr() * (bb.max.y - bb.min.y); P[i * 3 + 2] = bb.min.z + rr() * (bb.max.z - bb.min.z);
      seed[i * 3] = rr() * 100; seed[i * 3 + 1] = 0.4 + rr() * 0.8; seed[i * 3 + 2] = rr();
    }
    const g2 = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(P, 3)).setAttribute('color', new THREE.BufferAttribute(C, 3));
    const pts = new THREE.Points(g2, new THREE.PointsMaterial({ size: 0.6, map: dot, alphaTest: 0.5, vertexColors: true, transparent: true, opacity: 0.9, depthWrite: false }));
    world.add(pts); field = { pts, seed, box: bb };
  }
  // frame the camera on the shape
  const box = new THREE.Box3().setFromPoints([...pos.values()]), ctr = box.getCenter(V(0, 0, 0)), rad = box.getBoundingSphere(new THREE.Sphere()).radius;
  controls.target.copy(ctr);
  const dir = shape === 16 ? V(0.2, 0.75, 1) : shape >= 14 ? V(0.2, 0.62, 1) : shape === 13 ? V(0.3, 0.42, 1) : shape === 12 ? V(0.4, 0.25, 1) : shape === 11 ? V(0.12, 0.18, 1) : shape === 9 ? V(0.8, 0.8, 1) : shape === 10 ? V(1, 0.38, 0.35) : shape === 9 ? V(0.55, 0.35, 1) : shape === 8 ? V(0.18, 0.12, 1) : shape === 7 ? V(1, 0.85, 0.75) : shape === 3 ? V(1, 0.12, 0.25) : shape === 1 ? V(-0.25, 0.32, 1) : shape === 2 ? V(1, 0.55, 1) : shape === 4 ? V(0.9, 0.75, 0.9) : shape === 5 ? V(1, 0.15, 0.3) : V(0.55, 0.45, 1);
  camera.position.copy(ctr).addScaledVector(dir.normalize(), rad * (shape === 16 ? 2.7 : shape >= 14 ? 1.75 : shape === 13 ? 3.85 : shape === 12 ? 4.2 : shape === 11 ? 2.7 : shape === 10 ? 3.9 : shape === 9 ? 3.8 : shape === 8 ? 3.1 : shape === 7 ? 3.6 : shape === 2 ? 2.6 : shape === 3 ? 4.2 : shape === 4 ? 3.2 : shape === 5 ? 2.2 : 1.55));
  homeCtr.copy(ctr); homeRad = rad;
  if (!introDone) {
    introDone = true;
    const far = camera.position.distanceTo(ctr), sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(ctr));
    void far; void sph; // no zoom-in intro (it jumped on load): the brain starts in full view and fades in once drawn
    document.body.style.opacity = '0'; requestAnimationFrame(() => requestAnimationFrame(() => { document.body.style.transition = 'opacity .7s ease'; document.body.style.opacity = '1'; }));
  }
  controls.minDistance = 1; controls.maxDistance = rad * 6; controls.zoomSpeed = 1.4; controls.panSpeed = 1.2;
}

// ---------------------------------------------------------------- the first 3D one: wire city
function buildCity() {
  if (!net) return;
  world.clear(); signals = null; nodeCloud = null;
  bloom.enabled = false;
  const cxOf = (l: number) => l * 1.3 + STARTS.filter((x) => x > 0 && l >= x).length * 1.6;
  const czOf = (n: Node) => (n.kind === 'head' ? n.within! : 13.5 + n.within!);
  const X1 = cxOf(27), Z1 = 47.5, MAXH = 9, c = new THREE.Color();
  const hOf = (n: Node) => 0.12 + n.fire * MAXH * (n.kind === 'head' ? 0.75 : 1);
  const fl: number[] = [], fc: number[] = [];
  const seg = (a: number[], b: number[], col: string, k = 1) => { fl.push(...a, ...b); c.set(col).multiplyScalar(k); fc.push(c.r, c.g, c.b, c.r, c.g, c.b); };
  for (const n of net.nodes) if (n.layer !== null) { const x = cxOf(n.layer), z = czOf(n); seg([x - 0.5, 0, z - 0.5], [x + 0.5, 0, z - 0.5], '#1b5a33', 0.5); seg([x - 0.5, 0, z - 0.5], [x - 0.5, 0, z + 0.5], '#1b5a33', 0.5); }
  const R = [-4.5, X1 + 1.5, -1.5, Z1 + 1.5];
  seg([R[0], 0, R[2]], [R[1], 0, R[2]], '#2b47ff'); seg([R[1], 0, R[2]], [R[1], 0, R[3]], '#2b47ff'); seg([R[1], 0, R[3]], [R[0], 0, R[3]], '#2b47ff'); seg([R[0], 0, R[3]], [R[0], 0, R[2]], '#2b47ff');
  STARTS.forEach((st, i) => { const e = i < 5 ? STARTS[i + 1] - 1 : 27; seg([cxOf(st) - 0.5, 0, R[3] + 1], [cxOf(e) + 0.5, 0, R[3] + 1], STAGE[i]); label(`${STAGE_NAMES[i]} ${st} to ${e}`, STAGE[i], V((cxOf(st) + cxOf(e)) / 2, 0, R[3] + 1), 3); });
  for (const n of net.nodes) {
    if (n.layer === null) continue;
    const x = cxOf(n.layer), z = czOf(n), h = hOf(n), col = n.mine ? '#ffffff' : STAGE[n.stage];
    if (n.sold > 0) {
      const sz = 0.32, p = [[x - sz, z - sz], [x + sz, z - sz], [x + sz, z + sz], [x - sz, z + sz]], k = n.sold >= 1 ? 1.15 : 0.7;
      for (let i = 0; i < 4; i++) { const [ax, az] = p[i], [bx, bz] = p[(i + 1) % 4]; seg([ax, 0, az], [ax, h, az], col, k); seg([ax, h, az], [bx, h, bz], col, k); }
    } else seg([x, 0, z], [x, h, z], STAGE[n.stage], 0.35);
  }
  world.add(fat(fl, fc, 1.6, 0.95));
  const py = MAXH + 3.5, ux0 = cxOf(25) - 0.5, ux1 = X1 + 0.5, rl: number[] = [], rc: number[] = [];
  c.set('#ff3b3b');
  for (let x = ux0; x <= ux1 + 0.01; x += 0.65) { rl.push(x, py, -0.5, x, py, Z1); rc.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  for (let z = -0.5; z <= Z1 + 0.01; z += 1.2) { rl.push(ux0, py, z, ux1, py, z); rc.push(c.r, c.g, c.b, c.r, c.g, c.b); }
  world.add(fat(rl, rc, 1.2, 0.7));
  label('data in', '#36f5d0', V(-3, 0, Z1 / 2), 4);
  label('data out', '#ff5a5a', V(ux1, py, Z1 / 2), 3);
  const ctr = V(X1 / 2, 2, Z1 / 2);
  controls.target.copy(ctr); camera.position.copy(ctr).add(V(62, 52, 70)); controls.maxDistance = 400;
}

// ---------------------------------------------------------------- peel the onion
function applyPeel() {
  const on = shape === 3 || shape === 4 || shape === 8 || shape === 9 || shape === 10 || shape === 11 || shape === 12 || shape === 13 || shape >= 14;
  world.traverse((o) => { if (o.userData.stage !== undefined && !o.userData.keepHidden) o.visible = !(on && hidden.has(o.userData.stage)) && !o.userData.off; });
  if (nodeCloud) {
    const a = nodeCloud.geometry.getAttribute('size') as THREE.BufferAttribute;
    cloudNodes.forEach((n, i) => a.setX(i, on && n.layer !== null && hidden.has(n.stage) ? 0 : baseSizes[i]));
    a.needsUpdate = true;
  }
  drawPeel(); drawMine(); drawKey();
}
const peel = document.createElement('div'); peel.className = 'hud peel'; document.body.append(peel);
let peelClosed = false;
// a little shape per stage, in its colour
function stageIcon(s: number, col?: string) {
  const c = col ?? (s === 6 ? '#7fb6ff' : STAGE[s]);
  if (shape === 13) { // strata: the stage's own symbol from the brain, drawn flat
    const F = (f: string) => [
      `<rect x="4" y="7.5" width="6" height="5.5"/><rect x="6" y="9.3" width="2" height="2" fill="${f}"/><path d="M7 7.5 V4 H11 V1"/>`,
      `<rect x="2" y="3" width="10" height="7.5"/><path d="M5 5 V8.5 M5 6.8 H9.5 M7 10.5 V14 M7 0 V3"/>`,
      `<path d="M7 0 V3 L8.6 4 L5.4 5 L8.6 6 L5.4 7 L7 7.8"/><rect x="5.8" y="7.8" width="2.4" height="2.8"/><circle cx="7" cy="12.4" r="1.3"/>`,
      `<circle cx="7" cy="4.6" r="1.7"/><circle cx="7" cy="4.6" r=".5" fill="${f}"/><path d="M7 2.9 V0.5 M7 6.3 V9 L4 11.5 L3 14 M4 11.5 L5.2 14 M7 9 L10 11.5 L8.8 14 M10 11.5 L11 14"/>`,
      `<circle cx="7" cy="2" r="1.3"/><path d="M7 3.3 L5 6 L8.2 8 L5.6 11 L7.6 13.6 M8.2 8 L11 9.8 M5 6 L3 7.5"/>`,
      `<circle cx="7" cy="6" r="3.2"/><circle cx="7" cy="6" r="1" fill="${f}"/>` + [2, 4.5, 7, 9.5, 12].map((x) => `<circle cx="${x}" cy="12.3" r=".6" fill="${f}"/>`).join(''),
      `<path d="M2.6 7.4 C1.6 4 4.4 1.8 7.4 2.4 C10.6 2.9 12.9 5 12.2 8.1 C11.6 11.2 8.6 12.6 5.8 11.9 C4 11.4 3 9.6 2.6 7.4 Z"/><path d="M5 6.2 C5.3 5.1 6.2 4.5 7.2 4.5"/>`,
    ][s];
    return `<svg class="ic" viewBox="0 0 14 14" width="16" height="16"><g class="ol" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round">${F('none')}</g><g fill="none" stroke="${c}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${F(c)}</g></svg>`;
  }
  // hand drawn contour loops, like the rings on each layer, a different one per stage
  const d = [
    'M3 7 C2 3 6 1 9 2 C13 3 13 8 10 10 C7 12 4 11 3 7 Z',
    'M2 8 C1 4 5 2 8 3 C11 1 14 4 12 7 C14 10 9 12 7 10 C5 12 2 11 2 8 Z',
    'M4 3 C8 0 13 3 12 6 C11 8 8 6 7 8 C6 11 2 11 2 8 C1 6 2 4 4 3 Z',
    'M2 6 C2 2 7 1 9 3 C10 4 11 2 13 4 C14 7 12 11 8 11 C4 12 2 9 2 6 Z',
    'M3 4 C5 1 10 1 12 4 C13 6 10 7 11 9 C12 12 6 12 4 10 C1 8 2 6 3 4 Z',
    'M7 1.5 C11 1.5 13 4 12.5 7 C12 10.5 9 12.5 6 12 C3 11.5 1.5 9 2 6 C2.5 3.5 4.5 1.5 7 1.5 Z M7 4.5 C9 4.5 9.8 6 9.5 7.2 C9.2 8.8 7.6 9.4 6.4 9.1 C5 8.7 4.6 7.4 5 6.2 C5.3 5.2 6 4.5 7 4.5 Z',
  ][s];
  // a thin ink outline under the colour, so pale colours like yellow still read
  return `<svg class="ic" viewBox="0 0 14 13" width="16" height="15"><path class="ol" d="${d}" fill="none" stroke-width="2.9" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
// the key's pictures: the brain's own 3D shapes, rendered still, in their real colours
const iconCache = new Map<string, string>();
let iconR: THREE.WebGLRenderer | null = null;
function shapeIcon(key: string, make: () => THREE.Object3D) {
  if (iconCache.has(key)) return iconCache.get(key)!;
  iconR ??= new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  iconR.setSize(64, 64); iconR.setClearColor(0, 0);
  const sc = new THREE.Scene(); sc.add(new THREE.AmbientLight('#ffffff', 1.4)); const l = new THREE.DirectionalLight('#ffffff', 1.6); l.position.set(40, 60, 30); sc.add(l);
  const o = make(); o.rotation.set(0.5, 0.7, 0.1); sc.add(o);
  const cam = new THREE.PerspectiveCamera(30, 1, 0.1, 100); cam.position.set(0, 0, 4.2);
  iconR.render(sc, cam);
  const url = iconR.domElement.toDataURL(); iconCache.set(key, url); return url;
}
const PART_KEY: [string, string, () => THREE.Object3D][] = [
  ['attention head', 'head', () => new THREE.Mesh(new THREE.TetrahedronGeometry(1.15), new THREE.MeshLambertMaterial({ color: STAGE[2], flatShading: true }))],
  ['neuron column', 'col', () => new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.15), new THREE.MeshLambertMaterial({ color: STAGE[3], flatShading: true }))],
  ['text in and words out', 'end', () => { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1), new THREE.MeshBasicMaterial({ color: '#010302' })); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.IcosahedronGeometry(1.1)), new THREE.LineBasicMaterial({ color: STAGE[0] }))); return m; }],
  ['measured trait', 'trait', () => { const m = new THREE.Mesh(new THREE.OctahedronGeometry(1.2), new THREE.MeshLambertMaterial({ color: traitColour(), flatShading: true })); m.add(new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.OctahedronGeometry(1.2)), new THREE.LineBasicMaterial({ color: '#222423' }))); return m; }],
  ['yours', 'mine', () => new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.15, 1.15), new THREE.MeshLambertMaterial({ color: '#ffffff', flatShading: true }))],
];
function partsKey() {
  return `<div class="ph sub"><span>parts</span></div>` + PART_KEY.map(([name, key, make]) => `<div class="prow"><img class="ic3" src="${shapeIcon(palette + key, make)}" width="22" height="22" alt="" />${name}</div>`).join('')
    + `<div class="prow note">size, how much is bought</div>`;
}
// drag the stages box by its header, anywhere on the screen
let drag: { dx: number; dy: number } | null = null;
peel.addEventListener('pointerdown', (e) => {
  const h = (e.target as HTMLElement).closest('.ph'); if (!h || (e.target as HTMLElement).closest('.x')) return;
  const r = peel.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
  peel.setPointerCapture(e.pointerId); e.preventDefault();
});
peel.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const x = Math.max(0, Math.min(innerWidth - peel.offsetWidth, e.clientX - drag.dx)), y = Math.max(0, Math.min(innerHeight - peel.offsetHeight, e.clientY - drag.dy));
  peel.style.setProperty('left', `${x}px`, 'important'); peel.style.setProperty('top', `${y}px`, 'important'); peel.style.setProperty('right', 'auto', 'important');
});
peel.addEventListener('pointerup', () => { drag = null; });
// the my neurons box, under the view box: one row per part you hold, tick to zoom on it in pink
const mineBox = document.createElement('div'); mineBox.className = 'hud peel minebox'; document.body.append(mineBox);
let mineMin = false, mineMoved = false, myLabels = true, mineFullH = 0; /* the close-ups sit under the panel's full height, so opening, closing or unticking never moves them */
// inside the site the title box sits top left, so my neurons starts lower down
const MINE_TOP = 20; /* top left corner of the page, the pink close-ups stack under it */
// sits top left, level with the view box, until it's dragged somewhere else
function placeMine() { const r = peel.getBoundingClientRect(); if (!r.width) { requestAnimationFrame(placeMine); return; } const st = mineBox.style; st.setProperty('width', '236px', 'important'); if (mineMoved) return;
  st.setProperty('left', '20px', 'important'); st.setProperty('right', 'auto', 'important'); st.setProperty('top', MINE_TOP + 'px', 'important'); } // its own corner, top left; it never follows the view box
function drawMine() {
  if (shape !== 13 || !net) { mineBox.style.display = 'none'; return; }
  mineBox.style.display = '';
  const own = net.layers.flat().filter((n) => n.mine).sort((a, b) => b.fire - a.fire);
  if (!myPicked) { own.forEach((n) => myOn.add(n.part)); /* every part you hold starts pink */ myPicked = true; applyMine(); setTimeout(drawPeel, 0); }
  const dot = `<svg class="ic" viewBox="0 0 14 14" width="16" height="16"><circle cx="7" cy="7" r="4.2" fill="${PINK}"/></svg>`;
  mineBox.innerHTML = `<div class="ph"><span>my neurons <i class="cnt">${own.length}</i></span><button class="x" data-a="min" title="${mineMin ? 'open' : 'minimise'}">${mineMin ? '+' : '−'}</button></div>`
    + (mineMin ? '' : own.length ? `<div class="sub">show</div><button data-a="mylabels" class="lblrow ${myLabels ? '' : 'off'}"><svg class="ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8.5" cy="8.5" r="5"/><line x1="12.2" y1="12.2" x2="16.5" y2="16.5"/></svg>close-ups<span class="tick"></span></button><div class="sub">neurons</div>` + own.map((n) => `<button data-p="${n.part}" class="${myOn.has(n.part) ? '' : 'off'}">${stageIcon(n.stage, PINK)}layer ${n.layer} ${n.kind === 'head' ? 'head' : 'column'} ${n.within}<span class="go" data-go="${n.part}"><svg viewBox="0 0 14 14" width="13" height="13" fill="none" stroke="currentColor" stroke-width="1.4"><path d="M4 10 L10 4 M5 4 H10 V9"/></svg></span><span class="tick"></span></button>`).join('')
      : `<div class="empty">you hold no neurons yet</div><a class="buy" href="https://neurals-production.up.railway.app/#/buy" target="_blank" rel="noopener">buy neurons</a>`);
  placeMine();
}
mineBox.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (b?.dataset.a === 'min') { mineMin = !mineMin; drawMine(); return; } if (b?.dataset.a === 'mylabels') { myLabels = !myLabels; drawMine(); return; } const go = (e.target as HTMLElement).closest('.go') as HTMLElement | null; if (go) { goTo(Number(go.dataset.go)); return; } if (!b?.dataset.p) return; const p = Number(b.dataset.p); myOn.has(p) ? myOn.delete(p) : myOn.add(p); drawMine(); applyMine(); drawPeel(); });
addEventListener('resize', () => { if (shape === 13 && net) placeMine(); }); // only moves when the window changes size
{ let md: { dx: number; dy: number } | null = null;
  mineBox.addEventListener('pointerdown', (e) => { const h = (e.target as HTMLElement).closest('.ph'); if (!h || (e.target as HTMLElement).closest('.x')) return; const r = mineBox.getBoundingClientRect(); md = { dx: e.clientX - r.left, dy: e.clientY - r.top }; mineBox.setPointerCapture(e.pointerId); e.preventDefault(); });
  mineBox.addEventListener('pointermove', (e) => { if (!md) return; mineMoved = true; const x = Math.max(0, Math.min(innerWidth - mineBox.offsetWidth, e.clientX - md.dx)), y = Math.max(0, Math.min(innerHeight - mineBox.offsetHeight, e.clientY - md.dy)); mineBox.style.setProperty('left', `${x}px`, 'important'); mineBox.style.setProperty('top', `${y}px`, 'important'); });
  mineBox.addEventListener('pointerup', () => { md = null; }); }
{ const ZW0 = 100, ZH0 = 87, cv = renderer.domElement, hit = (e: PointerEvent) => zoomHits.find((h) => e.clientX >= h.x && e.clientX <= h.x + ZW0 && e.clientY >= h.y && e.clientY <= h.y + ZH0);
  cv.addEventListener('pointerdown', (e) => { const h = hit(e); if (!h) return; e.stopImmediatePropagation(); e.preventDefault(); zoomDrag = { k: h.k, dx: e.clientX - h.x, dy: e.clientY - h.y }; cv.setPointerCapture(e.pointerId); cv.style.cursor = 'grabbing'; }, { capture: true });
  cv.addEventListener('pointermove', (e) => { if (zoomDrag) { e.stopImmediatePropagation(); zoomPos.set(zoomDrag.k, { x: Math.max(0, Math.min(innerWidth - ZW0, e.clientX - zoomDrag.dx)), y: Math.max(0, Math.min(innerHeight - ZH0, e.clientY - zoomDrag.dy)) }); return; } cv.style.cursor = hit(e) ? 'grab' : ''; }, { capture: true });
  cv.addEventListener('pointerup', (e) => { if (zoomDrag) { e.stopImmediatePropagation(); zoomDrag = null; cv.style.cursor = ''; } }, { capture: true }); }
// put every box and zoom back where it started
function resetLayout() {
  zoomPos.clear(); mineMoved = false; mineMin = false; peelClosed = false; keyMoved = false; keyMin = false;
  for (const p of ['left', 'top', 'right']) peel.style.removeProperty(p);
  drawPeel(); drawMine(); placeMine(); drawKey();
  view('full'); // and back out to the whole brain, spinning
}
// the key box, on its own under the view box: what each colour means, and the zoom windows switch
const keyBox = document.createElement('div'); keyBox.className = 'hud peel keybox'; document.body.append(keyBox);
let keyMin = false, keyMoved = false;
function drawKey() {
  if (shape !== 13) { keyBox.style.display = 'none'; return; }
  keyBox.style.display = '';
  const body = `<div class="keyrow"><i style="background:${PINK}"></i>yours</div><div class="keyrow"><i style="background:${SOLD}"></i>bought</div><div class="keyrow"><i style="background:${STAGE[2]}"></i>available</div><div class="sub">show</div><button data-a="labels" class="lblrow ${calloutsOn ? '' : 'off'}"><svg class="ic" viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.4"><circle cx="8.5" cy="8.5" r="5"/><line x1="12.2" y1="12.2" x2="16.5" y2="16.5"/></svg>close-ups<span class="tick"></span></button>`;
  keyBox.innerHTML = `<div class="ph"><span>key</span><button class="x" data-a="kmin" title="${keyMin ? 'open' : 'minimise'}">${keyMin ? '+' : '−'}</button></div>` + (keyMin ? '' : body);
  placeKey();
}
// its own corner, bottom right; it never follows the view box
function placeKey() { if (keyMoved) return; const st = keyBox.style; st.setProperty('width', '190px', 'important'); st.setProperty('left', innerWidth - 190 - 20 + 'px', 'important'); st.setProperty('right', 'auto', 'important'); st.setProperty('top', innerHeight - keyBox.offsetHeight - 20 + 'px', 'important'); }
keyBox.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; if (b.dataset.a === 'kmin') keyMin = !keyMin; if (b.dataset.a === 'labels') calloutsOn = !calloutsOn; drawKey(); });
{ let kd: { dx: number; dy: number } | null = null;
  keyBox.addEventListener('pointerdown', (e) => { const h = (e.target as HTMLElement).closest('.ph'); if (!h || (e.target as HTMLElement).closest('.x')) return; const r = keyBox.getBoundingClientRect(); kd = { dx: e.clientX - r.left, dy: e.clientY - r.top }; keyBox.setPointerCapture(e.pointerId); e.preventDefault(); });
  keyBox.addEventListener('pointermove', (e) => { if (!kd) return; keyMoved = true; keyBox.style.setProperty('left', `${Math.max(0, Math.min(innerWidth - keyBox.offsetWidth, e.clientX - kd.dx))}px`, 'important'); keyBox.style.setProperty('top', `${Math.max(0, Math.min(innerHeight - keyBox.offsetHeight, e.clientY - kd.dy))}px`, 'important'); });
  keyBox.addEventListener('pointerup', () => { kd = null; }); }
addEventListener('resize', () => { if (shape === 13) placeKey(); });
function drawPeel() {
  if (peelClosed) { peel.innerHTML = `<div class="ph"><span>${shape === 13 ? 'view' : 'stages'}</span><button class="x" data-a="open" title="open">+</button></div>`; peel.classList.add('min'); return; }
  peel.classList.remove('min');
  peel.innerHTML = `<div class="ph"><span>${shape === 13 ? 'view' : 'stages'}</span><button class="x" data-a="close" title="minimise">−</button></div>` + (shape === 13 ? `<div class="sub">you</div><button data-a="allmine" class="pinkrow ${net && net.layers.flat().some((n) => n.mine && myOn.has(n.part)) ? '' : 'off'}"><svg class="ic" viewBox="0 0 14 14" width="16" height="16"><g class="ol" fill="none" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"><circle cx="7" cy="4.3" r="2.4"/><path d="M2.3 13 C2.3 9.6 4.4 7.9 7 7.9 C9.6 7.9 11.7 9.6 11.7 13 Z"/></g><g fill="${PINK}" stroke="${PINK}" stroke-width="1.2" stroke-linejoin="round"><circle cx="7" cy="4.3" r="2.4"/><path d="M2.3 13 C2.3 9.6 4.4 7.9 7 7.9 C9.6 7.9 11.7 9.6 11.7 13 Z"/></g></svg>my neurons<span class="tick"></span></button><div class="sub">token</div><button data-s="6" class="stream ${hidden.has(6) ? 'off' : ''}" title="the token's liquidity pool">${stageIcon(6)}liquidity<span class="tick"></span></button><div class="sub">layers</div>` : '') + [5, 4, 3, 2, 1, 0].map((s) => `<button data-s="${s}" class="${hidden.has(s) ? 'off' : ''}">${stageIcon(s)}${STAGE_NAMES[s]}<span class="tick"></span></button>`).join('')
    + `<div class="row"><button data-a="peel">hide outer</button><button data-a="restore">show all</button></div>` + (COMPARE ? '' : partsKey());
}
peel.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.s) { const s2 = Number(b.dataset.s); hidden.has(s2) ? hidden.delete(s2) : hidden.add(s2); }
  if (b.dataset.a === 'peel') { const next = [5, 4, 3, 2, 1, 0].find((x) => !hidden.has(x)); if (next !== undefined) hidden.add(next); }
  if (b.dataset.a === 'restore') hidden.clear();
  if (b.dataset.a === 'labels') { calloutsOn = !calloutsOn; drawPeel(); return; }
  if (b.dataset.a === 'allmine' && net) { const own = net.layers.flat().filter((n) => n.mine), anyOn = own.some((n) => myOn.has(n.part)); own.forEach((n) => (anyOn ? myOn.delete(n.part) : myOn.add(n.part))); applyMine(); drawMine(); drawPeel(); return; }
  if (b.dataset.a === 'close') { peelClosed = true; drawPeel(); return; }
  if (b.dataset.a === 'open') { peelClosed = false; drawPeel(); return; }
  applyPeel();
});

// ---------------------------------------------------------------- tabs
type Tab = { name: string; pal?: string; hemi?: boolean; thick?: boolean; mode?: 'outline' | 'yours' | 'solid'; shape?: number; style?: 'clean' | 'glow' | 'rainbow' | 'first'; city?: boolean; flat?: (n: Net, c: flat.Ctx) => flat.Hit[]; bg?: string };
const TABS: Tab[] = [
  { name: 'onion', shape: 4, mode: 'solid' }, { name: 'network', shape: 8, mode: 'solid' }, { name: 'network3d', shape: 9, mode: 'solid' }, { name: 'helix', shape: 3, mode: 'solid' }, { name: 'squarehelix', shape: 10, mode: 'solid' }, { name: 'networkh', shape: 11, mode: 'solid' }, { name: 'strata', shape: 13, mode: 'solid' },
];
let tab = 0;
const flatBox = document.createElement('div'); flatBox.id = 'flat'; document.body.append(flatBox);
const flatCv = document.createElement('canvas'); flatBox.append(flatCv);
let flatHits: flat.Hit[] = [], fmx = 0, fmy = 0;
flatCv.addEventListener('pointermove', (e) => {
  const r = flatCv.getBoundingClientRect(); fmx = e.clientX - r.left; fmy = e.clientY - r.top;
  let best: flat.Hit | null = null, bd = 1e9;
  for (const h of flatHits) { const d = Math.hypot(h.x - fmx, h.y - fmy); if (d <= Math.max(h.r, 6) && d < bd) { bd = d; best = h; } }
  if (best) { tip.innerHTML = describe(best.n).map((l, i) => (i ? `<span>${l}</span>` : `<b>${l}</b>`)).join(''); tip.style.display = 'flex'; tip.style.left = `${e.clientX + 16}px`; tip.style.top = `${e.clientY + 16}px`; }
  else tip.style.display = 'none';
});
function showTab() {
  const T = TABS[tab], isFlat = !!T.flat;
  document.body.classList.toggle('flatmode', isFlat);
  flatBox.style.background = T.bg ?? '#000';
  if (isFlat) { world.clear(); signals = null; nodeCloud = null; return; }
  style = T.style ?? 'clean';
  if (T.mode) { shapeMode = T.mode; drawMode(); }
  if (T.pal) { setPalette(T.pal); iconCache.clear(); }
  STR_PART = !!(T as Tab & { parts?: boolean }).parts;
  lineK = T.thick ? 1.6 : 1; hemi = !!T.hemi;
  SHAPES[4].output = hemi ? V(0, -0.3, 0) : V(0, -(SHELL(5) + 0.3), 0);
  if (T.city) { buildCity(); return; }
  shape = T.shape!; build();
}
const modeBtn = document.createElement('button'); modeBtn.className = 'modebtn';
const drawMode = () => { modeBtn.innerHTML = `shapes ` + (['outline', 'yours', 'solid'] as const).map((m) => `<b data-m="${m}" class="${shapeMode === m ? 'on' : ''}">${m === 'yours' ? 'yours solid' : m === 'solid' ? 'all solid' : m}</b>`).join(' '); };
modeBtn.addEventListener('click', (e) => { const m = (e.target as HTMLElement).dataset.m as typeof shapeMode | undefined; if (!m) return; shapeMode = m; drawMode(); showTab(); });
drawMode();
const palBtn = document.createElement('div'); palBtn.className = 'modebtn';
const drawPal = () => { palBtn.innerHTML = 'colours ' + Object.keys(PALETTES).map((k) => `<b data-p="${k}" class="${palette === k ? 'on' : ''}">${k}</b>`).join(' '); };
palBtn.addEventListener('click', (e) => { const p = (e.target as HTMLElement).dataset.p; if (!p) return; setPalette(p); drawPal(); showTab(); document.getElementById('stages')!.innerHTML = STAGE_NAMES.map((n, i) => `<span><i style="background:${STAGE[i]}"></i>${n}</span>`).join(''); });
drawPal(); document.querySelector('.hud.tr')!.append(palBtn);
const bar = document.getElementById('shapes')!;
function drawButtons() { bar.style.setProperty('display', TABS.length > 1 ? 'flex' : 'none', 'important'); /* one design chosen: no tab bar */ bar.innerHTML = TABS.map((s, i) => `<button data-i="${i}" class="${i === tab ? 'on' : ''}"><b>${i + 1}</b>${s.name}</button>`).join(''); }
bar.addEventListener('click', (e) => { const b = (e.target as HTMLElement).closest('button'); if (!b) return; tab = Number(b.dataset.i); drawButtons(); controls.autoRotate = true; showTab(); });
drawButtons();

// ---------------------------------------------------------------- hover and click
const tip = document.getElementById('tip')!;
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2();
ray.params.Points = { threshold: 0.6 };
let hovered: Node | null = null;
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!nodeCloud) return;
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  ray.setFromCamera(mouse, camera);
  const hit = ray.intersectObject(nodeCloud).sort((a, b) => (a.distanceToRay ?? 0) - (b.distanceToRay ?? 0))[0];
  hovered = hit?.index !== undefined ? cloudNodes[hit.index] : null;
  if (blob) { const sp = new THREE.Sphere(V(0, 0, 0), BLOB_R + 2); const hp = ray.ray.intersectSphere(sp, V(0, 0, 0)); blob.hit = hp ? world.worldToLocal(hp.clone()).normalize() : null; }
  if (hovered && shape !== 13) { // strata spells everything out already, so no hover box there
    tip.innerHTML = describe(hovered).map((l, i) => (i ? `<span>${l}</span>` : `<b>${l}</b>`)).join('') + (hovered.trait ? `<span>trait, ${TRAIT[hovered.trait] ?? hovered.trait}</span>` : '');
    tip.style.display = 'flex'; tip.style.left = `${e.clientX + 16}px`; tip.style.top = `${e.clientY + 16}px`; 
  } else { tip.style.display = 'none'; renderer.domElement.style.cursor = ''; }
});


// ---------------------------------------------------------------- frame
const tmp = V(0, 0, 0);
let last = performance.now();
const frame = (now: number) => {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  nodeMat.uniforms.t.value = now / 1000; nodeMat.uniforms.px.value = renderer.getPixelRatio();
  { const cyc = (now / 1000) % 10; nodeMat.uniforms.wave.value = cyc < 9 ? -1 + (cyc / 9) * 30 : -10; }
  { const wv = nodeMat.uniforms.wave.value as number;
    for (const sh of shapes) { if (!sh.o.visible) continue; sh.o.rotateOnAxis(sh.axis, sh.spin * dt); const w = Math.exp(-((sh.layer - wv) ** 2) * 1.5) * sh.r; sh.o.scale.setScalar(sh.base * (1 + w * 0.35)); } }
  if (signals) {
    const a = signals.pts.geometry.getAttribute('position') as THREE.BufferAttribute, colAttr = signals.pts.geometry.getAttribute('color') as THREE.BufferAttribute;
    for (let i = 0; i < signals.t.length; i++) {
      signals.t[i] = (signals.t[i] + signals.speed[i] * dt) % 1;
      const p = signals.paths[i], f = signals.t[i] * (p.length - 1), k = Math.floor(f);
      tmp.copy(p[k]).lerp(p[Math.min(k + 1, p.length - 1)], f - k); a.setXYZ(i, tmp.x, tmp.y, tmp.z);
      const sst = signalStages[i]?.[Math.min(k + 1, p.length - 1)] ?? 0, sc = STAGE_COL[sst]; colAttr.setXYZ(i, sc.r, sc.g, sc.b);
      if (shape === 4 && hidden.has(sst)) a.setXYZ(i, 1e6, 1e6, 1e6);
    }
    a.needsUpdate = true; colAttr.needsUpdate = true;
  }
  world.children.forEach((o) => { if (o.userData.face) o.quaternion.copy(camera.quaternion); });
  if (net && TABS[tab].flat) {
    const w = innerWidth - 80, h = innerHeight - 200, d = devicePixelRatio || 1;
    if (flatCv.width !== w * d || flatCv.height !== h * d) { flatCv.width = w * d; flatCv.height = h * d; flatCv.style.width = `${w}px`; flatCv.style.height = `${h}px`; }
    const g = flatCv.getContext('2d')!; g.setTransform(d, 0, 0, d, 0, 0);
    flatHits = TABS[tab].flat!(net, { g, W: w, H: h, t: now, mx: fmx || w / 2, my: fmy || h / 2 });
    return;
  }
  if (shape === 12) blobFrame(now / 1000);
  if (shape === 13 && strataTick) strataTick(now / 1000);
  if (shape === 13 && cove) { // turntable studio: the sweep and the key light stay put relative to the camera
    const az = controls.getAzimuthalAngle(), cA = Math.cos(az), sA = Math.sin(az), lx = -85, lz = 70;
    cove.rotation.y = az;
    // inside the bubble: everything goes soft and blue, as if under water
    if (bubbleAt) { const c = camera.position, b = bubbleAt, inside = (c.x * c.x + c.z * c.z) / (b.RX * b.RX) + ((c.y - b.cy) ** 2) / (b.RY * b.RY) < 0.85;
      if (inside !== underwater) { underwater = inside; scene.fog = inside ? waterFog : null; document.body.classList.toggle('underwater', inside); } } sun.position.set(lx * cA + lz * sA, 95, -lx * sA + lz * cA); sun.target.position.set(0, 0, 0); sun.target.updateMatrixWorld();
  }
  if (shape === 8) {
    const tt = now / 1000;
    const wave = (x: number, y: number, z: number, out: number[]) => {
      out[0] = x + Math.sin(y * 0.22 + tt * 1.1) * 1.4 + Math.sin(z * 0.3 + tt * 0.7) * 0.4;
      out[1] = y + Math.sin(x * 0.12 + tt * 0.9) * 0.6;
      out[2] = z + Math.cos(y * 0.18 + x * 0.06 + tt * 0.8) * 2.2;
    };
    const o3 = [0, 0, 0];
    world.traverse((o) => {
      const base = o.userData.wave as Float32Array | undefined;
      if (base) {
        const ib = ((o as LineSegments2).geometry.getAttribute('instanceStart') as THREE.InterleavedBufferAttribute).data;
        const arr = ib.array as Float32Array;
        for (let i = 0; i < base.length; i += 3) { wave(base[i], base[i + 1], base[i + 2], o3); arr[i] = o3[0]; arr[i + 1] = o3[1]; arr[i + 2] = o3[2]; }
        ib.needsUpdate = true;
      }
      const rest = o.userData.rest as THREE.Vector3 | undefined;
      if (rest) { wave(rest.x, rest.y, rest.z, o3); o.position.set(o3[0], o3[1], o3[2]); }
    });
  }
  if (field) {
    const a = field.pts.geometry.getAttribute('position') as THREE.BufferAttribute, col = field.pts.geometry.getAttribute('color') as THREE.BufferAttribute;
    const b = field.box, tt = now / 1000, c2 = new THREE.Color();
    for (let i = 0; i < a.count; i++) {
      let x = a.getX(i), y = a.getY(i), z = a.getZ(i);
      const s0 = field.seed[i * 3], sp = field.seed[i * 3 + 1];
      // a slow wave: sideways sway from layered sines, always sinking towards words out
      x += Math.sin(y * 0.18 + tt * 0.9 + s0) * 0.05 + Math.sin(z * 0.3 + tt * 0.5) * 0.03;
      z += Math.cos(x * 0.15 + tt * 0.7 + s0) * 0.05;
      y -= sp * dt * 3.2 * (1 + 0.6 * Math.sin(x * 0.12 + tt * 1.3));
      if (y < b.min.y) { y = b.max.y; x = b.min.x + field.seed[i * 3 + 2] * (b.max.x - b.min.x); }
      if (x < b.min.x) x = b.max.x; if (x > b.max.x) x = b.min.x; if (z < b.min.z) z = b.max.z; if (z > b.max.z) z = b.min.z;
      a.setXYZ(i, x, y, z);
      // colour of the stage band at this height
      let st = 0; for (let k = 0; k < 6; k++) if (y <= NET_Y(STARTS[k]) + 1) st = k;
      c2.set(STAGE[st]); col.setXYZ(i, c2.r, c2.g, c2.b);
    }
    a.needsUpdate = true; col.needsUpdate = true;
  }
  if (portal) {
    const a = portal.pts.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < portal.t.length; i++) {
      portal.t[i] = (portal.t[i] + dt * 0.12) % 1;
      const k = portal.t[i], r = 0.6 + k * k * 9, y = portal.y0 - k * portal.depth, an = portal.ang[i] + k * 4;
      a.setXYZ(i, Math.cos(an) * r, y, Math.sin(an) * r);
    }
    a.needsUpdate = true;
  }
  if (fly) { fly.t = Math.min(1, fly.t + dt / 1.6); const e = fly.t < 0.5 ? 4 * fly.t ** 3 : 1 - Math.pow(-2 * fly.t + 2, 3) / 2; camera.position.lerpVectors(fly.p0, fly.p1, e); controls.target.lerpVectors(fly.t0, fly.t1, e); if (fly.t >= 1) fly = null; }
  controls.update();
  if (glide && glide.hold && glide.hold > 0) glide.hold -= dt;
  else if (glide) {
    glide.t = Math.min(1, glide.t + dt / (glide.dur ?? 1.2)); const e = glide.dur ? (glide.t < 0.5 ? 4 * glide.t ** 3 : 1 - Math.pow(-2 * glide.t + 2, 3) / 2) : 1 - Math.pow(1 - glide.t, 3);
    const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target));
    sph.radius = glide.r0 + (glide.r1 - glide.r0) * e; sph.phi = glide.p0 + (glide.p1 - glide.p0) * e;
    sph.theta += glide.th * e - glide.done; glide.done = glide.th * e;
    camera.position.setFromSpherical(sph).add(controls.target);
    if (glide.t >= 1) glide = null;
  } tourHook?.(now); renderer.shadowMap.needsUpdate = true; if (STRIP) stripRender(now); else { renderer.render(scene, camera); labels.render(scene, camera); drawCallouts(); } tune(now); if (!document.body.classList.contains('ready')) requestAnimationFrame(() => document.body.classList.add('ready')); // white site: nothing shows until the first real frame, so the old dark boxes never flash
};
renderer.setAnimationLoop(frame);
// sharpness steps down only if this computer can't keep up, so fast screens keep full detail
let tuneN = 0, tuneT = 0, tuneSum = 0; const DPR = [Math.min(2, devicePixelRatio), Math.min(1.5, devicePixelRatio)]; let dprStep = 0, tuneWarm = 0;
function tune(now: number) { if (tuneWarm < 240) { tuneWarm++; tuneT = 0; return; } // skip the first few seconds while it loads
  if (tuneT) { tuneSum += now - tuneT; tuneN++; } tuneT = now;
  if (tuneN < 90) return; const avg = tuneSum / tuneN; tuneN = 0; tuneSum = 0;
  /* the close-up strip always stays at full sharpness */ if (!STRIP && avg > 30 && dprStep < DPR.length - 1 && DPR[dprStep + 1] < renderer.getPixelRatio()) { dprStep++; renderer.setPixelRatio(DPR[dprStep]); resize(); } }
// stop drawing when nobody can see it: hidden tab, or the brain scrolled out of view on the site
let onScreen = true;
let hostPaused = false; // the site pauses the brain when its split pane is dragged nearly shut
addEventListener('message', (e) => { if (e.data && typeof e.data.pause === 'boolean') { hostPaused = e.data.pause; pauseCheck(); } });
function pauseCheck() { const run = onScreen && !document.hidden && !hostPaused; if (run) { tuneT = 0; last = performance.now(); } renderer.setAnimationLoop(run ? frame : null); }
document.addEventListener('visibilitychange', pauseCheck);
new IntersectionObserver((e) => { onScreen = e[0].isIntersecting; pauseCheck(); }).observe(renderer.domElement);

// ---------------------------------------------------------------- data
async function start(wallet: string | null) {
  // the brain only needs its parts and the receipt; the slower stats arrive after and don't hold it up
  const [n, rc] = await Promise.all([load(wallet), cj<any>(`${API}/receipts/${RECEIPT}`).catch(() => null)]);
  net = n; receipt = rc ? { shares: rc.shares, prompt: rc.prompt.length, output: rc.output.length } : null;
  showTab();
  // embedded (site and compare page) the stats line is hidden, so the 2 MB epochs list is never fetched there
  const [health, epochs] = await Promise.all([cj<any>(`${API}/health`).catch(() => null), Q.has('embed') ? Promise.resolve([]) : cj<any>(`${API}/epochs`).catch(() => [])]);
  (document.getElementById('wallet') as HTMLInputElement).value = n.wallet ?? '';
  const fees = (epochs as { fees: string }[]).reduce((s, e) => s + Number(e.fees) / 1e9, 0);
  document.getElementById('live')!.textContent = `live, epoch ${health?.epoch ?? '…'}, slot ${health?.synced?.toLocaleString() ?? '…'}`;
  document.getElementById('stats')!.innerHTML = [
    `${n.soldSlots} of 1,318 parts bought`,
    `${n.nodes.filter((x) => x.mine).length} parts held by ${n.wallet ? `${n.wallet.slice(0, 4)}…${n.wallet.slice(-4)}` : 'nobody'}`,
    `${n.messages} paid messages measured`,
    ...(receipt ? [`replaying receipt ${RECEIPT.slice(0, 4)}…${RECEIPT.slice(-4)}, ${receipt.prompt} tokens in, ${receipt.output} out`] : []),
    `${fees.toFixed(3)} sol paid to neurons`,
  ].map((s) => `<span>${s}</span>`).join('');
  document.getElementById('stages')!.innerHTML = STAGE_NAMES.map((s, i) => `<span><i style="background:${STAGE[i]}"></i>${s}</span>`).join('');
}
document.getElementById('who')!.addEventListener('submit', (e) => { e.preventDefault(); void start((document.getElementById('wallet') as HTMLInputElement).value.trim() || null); });
// compare page: brain only on white, the designs we have as tabs across the top
if (COMPARE) {
  TABS.splice(0, TABS.length, ...[false].flatMap((parts) => ['cobalt'].map((pal) => ({ name: (parts ? 'dots ' : '') + (pal === 'duo' ? 'teal' : pal === 'bitmap' ? 'fluoro' : pal), shape: 13, mode: 'solid' as const, pal, parts }))));
}
// embedded in the website: onion only, the new colours, no page furniture
if (Q.has('embed')) {
  document.body.classList.add('embed');
  document.documentElement.style.background = 'transparent';
  document.body.dataset.theme = Q.get('theme') ?? 'light';
  document.documentElement.style.colorScheme = document.body.dataset.theme === 'dark' ? 'dark' : 'light';
  const isWhite = Q.has('white');
  if (isWhite) { document.body.dataset.white = '1'; PAPER_BG = '#ffffff'; }
  const isBlob = Q.get('shape') === 'blob';
  setPalette(isBlob ? 'planet' : isWhite ? 'blues' : Q.get('theme') === 'paper' ? 'poster' : Q.get('theme') === 'hud' ? 'hud' : 'kimura'); drawPal();
  tab = COMPARE ? 0 : Math.max(0, TABS.findIndex((t) => t.name === (Q.get('shape') ?? 'onion'))); drawButtons();
  if (COMPARE) document.body.classList.add('compare');
  // on the website: plain scroll moves the page, ctrl or cmd and scroll zooms the brain
  controls.enableZoom = false;
  const sw = document.createElement('div'); sw.className = 'hud palnote';
  const drawSw = () => { sw.innerHTML = 'colours ' + [['bitmap', 'fluoro'], ['poster', 'poster exact']].map(([k, n]) => `<button data-p="${k}" class="${palette === k ? 'on' : ''}">${n}</button>`).join(''); };
  sw.addEventListener('click', (e) => { const p2 = (e.target as HTMLElement).dataset.p; if (!p2) return; setPalette(p2); iconCache.clear(); drawSw(); showTab(); });
  void drawSw; // colours chosen: the poster set, so no switch

// ===== virtual tour: about 29 s, the boxes dissolve, the camera dives in and travels the brain top to bottom,
// close then far at each stop, while a dotted white box types what happens there. A timer bar sits top centre with an X to stop.
// layers fade rather than pop: each part of a stage eases its opacity, then hides once it reaches nothing
const fades = new Map<THREE.Object3D, { from: number; to: number; t: number; dur: number; blink?: boolean }>(); let fadeLast = 0;
const matsOf = (o: THREE.Object3D) => { const out: THREE.Material[] = []; o.traverse((c) => { const m = (c as THREE.Mesh).material; if (m) (Array.isArray(m) ? m : [m]).forEach((x) => out.push(x)); }); return out; };
function fadeObj(o: THREE.Object3D, show: boolean, dur = 0.7, blink = false) {
  const ms = matsOf(o); if (!ms.length) return;
  if (!o.userData.op0) { o.userData.op0 = ms.map((m) => m.opacity); o.userData.tr0 = ms.map((m) => m.transparent); }
  const cur = o.visible ? (o.userData.fa ?? 1) : 0; if (show) o.visible = true;
  fades.set(o, { from: cur, to: show ? 1 : 0, t: 0, dur, blink });
}
function fadeTo(st: number, show: boolean, dur = 0.7, blink = false) {
  world.traverse((o) => { if (o.userData.stage !== st || o.userData.keepHidden || o.userData.off) return; fadeObj(o, show, dur, blink); });
}
// a layer arriving in the tour: straight on, then blinks twice (off, on, off, on)
function switchOn(st: number) {
  const objs: THREE.Object3D[] = []; world.traverse((o) => { if (o.userData.stage === st && !o.userData.keepHidden && !o.userData.off) objs.push(o); });
  const set = (v: boolean) => objs.forEach((o) => { o.visible = v; });
  objs.forEach((o) => { const f = fades.get(o); if (f) { fades.delete(o); matsOf(o).forEach((m, i) => { m.opacity = o.userData.op0?.[i] ?? 1; m.transparent = o.userData.tr0?.[i] ?? false; m.needsUpdate = true; }); } o.userData.fa = 1; });
  set(true); [450, 800, 1150, 1500].forEach((ms, i) => setTimeout(() => { if (tour && !hidden.has(st)) set(i % 2 === 1); }, ms));
}
// the data in and data out tags: the tag and its line fade together
function tagFade(text: string, show: boolean) { document.querySelectorAll('.lbl').forEach((d) => { if (d.textContent === text) d.classList.toggle('tourhide', !show); }); (tagLines.get(text) ?? []).forEach((ln) => fadeObj(ln, show, 0.5)); }
let shadowGoal = 1;
function fadeTick(now: number) {
  const dt = fadeLast ? Math.min(0.1, (now - fadeLast) / 1000) : 0; fadeLast = now;
  if (shape === 13) { const si = sun.shadow.intensity; if (Math.abs(si - shadowGoal) > 0.001) sun.shadow.intensity = si + Math.sign(shadowGoal - si) * Math.min(Math.abs(shadowGoal - si), dt / 0.6); }
  fades.forEach((f, o) => {
    f.t = Math.min(1, f.t + dt / f.dur); const a = f.from + (f.to - f.from) * (1 - Math.pow(1 - f.t, 2)), ms = matsOf(o); o.userData.fa = a;
    ms.forEach((m, i) => { m.transparent = true; m.opacity = (o.userData.op0[i] ?? 1) * a; m.needsUpdate = true; });
    if (f.t >= 1) { fades.delete(o); o.userData.fa = f.to; if (f.to === 0) o.visible = false; if (f.blink && f.to === 1) { setTimeout(() => { if (tour) o.visible = false; }, 220); setTimeout(() => { o.visible = !hidden.has(o.userData.stage); }, 400); } ms.forEach((m, i) => { m.opacity = o.userData.op0[i] ?? 1; m.transparent = o.userData.tr0[i] ?? false; m.needsUpdate = true; }); }
  });
}
const TOUR: [string, number, string][] = [
  ['data in', -3, "Your prompt is split into tokens and each one becomes a vector of 1,536 numbers. That lookup table is the Embedding, one of the brain's 1,318 ownable parts."],
  ['tokenizer, layers 0 to 3', 1.5, 'Twelve attention heads per layer decide which tokens matter to each other. Buying fills slots in order, and the reveal decides at random which real head or column each slot becomes.'],
  ['syntax, layers 4 to 7', 5.5, 'Attention starts tracking structure here. When a head fires on your prompt, the receipt records exactly how hard.'],
  ['semantic, layers 8 to 13', 10.5, "Meaning gathers in the residual stream. Some parts carry measured traits, such as an Induction Head that continues patterns, and a trait multiplies that part's share of every fee."],
  ['memory, layers 14 to 19', 16.5, "Each layer's feed forward block holds 8,960 neurons in 35 columns. 3,000 tokens buys one neuron, and pink shows the ones that are yours."],
  ['reasoning, layers 20 to 24', 22, 'Late layers combine what was retrieved with what you asked. Neurons only earn while your balance covers them, and the rarest keep earning longest.'],
  ['prediction, layers 25 to 27', 26, 'The final layers score all 151,936 possible next tokens. That output head is the Unembedding, the last ownable part.'],
  ['data out', 33, 'A receipt of how hard all 1,318 parts fired is posted, and anyone can replay it. Every hour, the fees go to the owners of the parts that fired.'],
  ['liquidity', 15.5, "The water inside is the token's liquidity pool, the tokens and SOL that every buy and sell move through. Buy and you gain neurons, sell and some of yours go dormant."],
];
const T_FADE = 0.6, T_DIVE = 0.8, T_STOP = 6.2, T_OUT = 1.1, T_ALL = T_FADE + T_DIVE + TOUR.length * T_STOP + T_OUT;
let tour: { t0: number; pos: THREE.CatmullRomCurve3; tgt: THREE.CatmullRomCurve3; from: THREE.Vector3; fromT: THREE.Vector3; stop: number; ending: boolean; at: number; before: Set<number> } | null = null;
const tourUI = document.createElement('div'); tourUI.className = 'tourui';
tourUI.innerHTML = '<div class="tourbar"><div class="tourfill"></div></div><button class="tourx" title="stop the tour"><svg viewBox="0 0 12 12" width="10" height="10"><path d="M2 2 L10 10 M10 2 L2 10"/></svg></button>';
const tourText = document.createElement('div'); tourText.className = 'tourtext';
document.body.append(tourUI, tourText);
const layerY = (l: number) => (l < 0 ? SA_Y(0) - l * 3 : l > 27 ? SA_Y(27) - (l - 27) * 3 : SA_Y(Math.floor(l)) + (SA_Y(Math.min(27, Math.ceil(l))) - SA_Y(Math.floor(l))) * (l % 1));
const layerR = (l: number) => SA_W(Math.max(0, Math.min(27, Math.round(l))));
function tourStart() {
  if (tour || shape !== 13) return;
  world.updateMatrixWorld();
  const pts: THREE.Vector3[] = [], tgs: THREE.Vector3[] = [];
  TOUR.forEach(([, l], k) => {
    const out = TOUR[k][0] === 'data out', water = TOUR[k][0] === 'liquidity', close = k % 2 === 0, a = 0.5 + k * 0.8, r = layerR(l), d = out ? 30 : water ? r * 1.7 + 24 : k === 3 ? r * 1.3 + 14 : k === 6 ? r * 1.05 + 12 : close ? r + 16 : r * 2.4 + 30, h = k === 0 ? 22 : out ? 1 : water ? 8 : close ? 3 : 12; // data out: right up close under the brain // stops 4 (semantic) and 7 (prediction) come in closer
    const c = world.localToWorld(V(0, layerY(l), 0));
    tgs.push(c.clone()); pts.push(c.clone().add(V(Math.sin(a) * d, h, Math.cos(a) * d)));
  });
  controls.autoRotate = false; controls.enabled = false; fly = null; glide = null;
  tour = { t0: performance.now(), pos: new THREE.CatmullRomCurve3(pts, false, 'centripetal'), tgt: new THREE.CatmullRomCurve3(tgs, false, 'centripetal'), from: camera.position.clone(), fromT: controls.target.clone(), stop: -1, ending: false, at: 0, before: new Set(hidden) };
  world.traverse((o) => { if (o.userData.signals) o.visible = false; }); // no travelling dots during the tour
  tagFade('data in', false); // the data in tag and its line fade out with the boxes, right at the start
  tourLetters = Array.from({ length: 22 }, () => ({ c: '', a: Math.random() * Math.PI * 2, s: 0.7 + Math.random() * 0.6, col: Math.random() < 0.7 ? '#2a5dff' : '#17306e' })); // balls, like the brain's beads
  shadowGoal = 0; for (const st of [0, 1, 2, 3, 4, 5, 6]) { if (!hidden.has(st)) fadeTo(st, false); hidden.add(st); } // the brain fades to just the sphere, then builds up stop by stop
  document.body.classList.add('touring');
}
function tourEnd() {
  if (!tour) return; const before = tour.before; const wasEnding = tour.ending; tour = null; shadowGoal = 1; if (!wasEnding) { for (const st of [0, 1, 2, 3, 4, 5, 6]) { const show = !before.has(st); if (show === hidden.has(st)) fadeTo(st, show); } hidden.clear(); before.forEach((x) => hidden.add(x)); drawPeel(); }
  document.body.classList.remove('touring'); tourText.classList.remove('on'); tourSvg.innerHTML = ''; ob = null; obLast = 0; tagFade('data in', true); tagFade('data out', true); world.traverse((o) => { if (o.userData.signals) o.visible = true; });
  controls.enabled = true; view('full'); // glide back out to the whole brain, spinning, and the boxes dissolve back in
}
tourUI.querySelector('.tourx')!.addEventListener('click', tourEnd);
const easeIO = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - Math.pow(-2 * x + 2, 3) / 2);
function tourTick(now: number) {
  if (!tour) return;
  const t = (now - tour.t0) / 1000, n = TOUR.length;
  (tourUI.querySelector('.tourfill') as HTMLElement).style.width = `${Math.min(100, (t / T_ALL) * 100)}%`;
  if (t >= T_ALL) { tourEnd(); return; }
  if (t < T_FADE) return; // the boxes dissolve first, the camera holds
  const td = t - T_FADE;
  if (td < T_DIVE) { // then a sudden dive in to the first stop
    const e = Math.pow(td / T_DIVE, 2.6);
    camera.position.lerpVectors(tour.from, tour.pos.getPoint(0), e); controls.target.lerpVectors(tour.fromT, tour.tgt.getPoint(0), e); camera.lookAt(controls.target); return;
  }
  const ts = td - T_DIVE, k = Math.min(n - 1, Math.floor(ts / T_STOP));
  if (ts < n * T_STOP) {
    // one unbroken path through every stop: it eases into each one, holds a beat, then flows on to the next
    const f = (ts - k * T_STOP) / T_STOP, move = Math.max(0, (f - 0.8) / 0.2), u = k < n - 1 ? (k + easeIO(move)) / (n - 1) : 1;
    camera.position.copy(tour.pos.getPoint(u)); controls.target.copy(tour.tgt.getPoint(u)); camera.lookAt(controls.target);
    if (k !== tour.stop) { tour.stop = k; tour.at = now; typeStop(k); buildTo(k); for (const t of ['data in', 'data out']) tagFade(t, t !== TOUR[k][0]); }
    outlineStop(k, now, move > 0);
  } else if (!tour.ending) { tour.ending = true; shadowGoal = 1; { const before = tour.before; for (const st of [0, 1, 2, 3, 4, 5, 6]) { const show = !before.has(st); if (show === hidden.has(st)) fadeTo(st, show); } hidden.clear(); before.forEach((x) => hidden.add(x)); drawPeel(); } tourText.classList.remove('on'); tourSvg.innerHTML = ''; document.body.classList.remove('touring'); controls.enabled = true; view('full'); }
}
// build up: each stop switches its stage on (data in shows only the sphere, data out has everything)
const STAGE_OF_STOP = [-1, 0, 1, 2, 3, 4, 5, -2, 6]; // 6 is the liquidity water, shown last
function buildTo(k: number) { const reached = Math.max(...STAGE_OF_STOP.slice(0, k + 1).filter((x) => x < 6)), last = k >= TOUR.length - 1; for (const st of [0, 1, 2, 3, 4, 5, 6]) { const show = last || (st === 6 ? k >= STAGE_OF_STOP.indexOf(6) : st <= reached); if (show && hidden.has(st)) { hidden.delete(st); switchOn(st); } else if (!show && !hidden.has(st)) { hidden.add(st); fadeTo(st, false); } } }
// the stage being talked about gets a navy dashed outline round its band, with its name, for the whole stop
const tourSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); tourSvg.classList.add('tourmarks'); document.body.append(tourSvg);
let tourLetters: { c: string; a: number; s: number; col: string }[] = [];
let ob: { x0: number; y0: number; x1: number; y1: number; r: number } | null = null, obLast = 0;
let obT: { x0: number; y0: number; x1: number; y1: number } | null = null;
function outlineStop(k: number, now: number, moving = false) {
  if (!tour) { tourSvg.innerHTML = ''; ob = null; obT = null; return; }
  const st = STAGE_OF_STOP[k], W = innerWidth, H = innerHeight, pv = V(0, 0, 0); let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, round = 0;
  const take = (p: THREE.Vector3) => { pv.copy(p).project(camera); if (pv.z > 1) return; const x = (pv.x + 1) / 2 * W, y = (1 - pv.y) / 2 * H; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); };
  world.updateMatrixWorld();
  if (st === -1 || st === -2) { // data in and out: a round frame on the sphere at the top, or the portal at the bottom
    const c = world.localToWorld(V(0, st === -1 ? layerY(-3) : layerY(31), 0)), rr = st === -1 ? 4 : 9;
    for (let i = 0; i < 16; i++) { const t = (i / 16) * Math.PI * 2; take(c.clone().add(V(Math.cos(t) * rr, Math.sin(t) * rr, 0))); take(c.clone().add(V(Math.cos(t) * rr, 0, Math.sin(t) * rr))); }
    round = 1;
  } else if (st === 6 && bubbleAt) { const B = bubbleAt; for (let i = 0; i < 24; i++) for (const yy of [-1, 0, 1]) { const t = (i / 24) * Math.PI * 2, rr = yy ? B.RX * 0.75 : B.RX; take(V(Math.cos(t) * rr, B.cy + yy * B.RY * 0.9, Math.sin(t) * rr).applyMatrix4(world.matrixWorld)); } round = 1; }
  else { const a = STARTS[st], b = st < 5 ? STARTS[st + 1] - 1 : 27; for (const l of [a, b]) for (let i = 0; i < 47; i += 2) take(STR_POS(l, i).multiply(V(fsNow[st], 1, fsNow[st])).applyMatrix4(world.matrixWorld)); }
  x0 = Math.max(12, x0 - 14); x1 = Math.min(W - 12, x1 + 14); y0 = Math.max(76, y0 - 14); y1 = Math.min(H - 150, y1 + 14);
  if (!(x1 - x0 > 20 && y1 - y0 > 10)) { x0 = W / 2 - 40; x1 = W / 2 + 40; y0 = H / 2 - 40; y1 = H / 2 + 40; }
  // while the camera travels, the frame holds its last good shape, then eases straight to the next stop's shape: one steady change, no shrinking in between
  if (moving && obT) ({ x0, y0, x1, y1 } = obT); else obT = { x0, y0, x1, y1 };
  // the frame glides from where it was to where it needs to be, rounding off into an oval for the water and the ends
  const dt = obLast ? Math.min(0.1, (now - obLast) / 1000) : 0; obLast = now; const g = ob ? 1 - Math.exp(-dt * 3) : 1;
  ob ??= { x0, y0, x1, y1, r: round };
  ob.x0 += (x0 - ob.x0) * g; ob.x1 += (x1 - ob.x1) * g; ob.y0 += (y0 - ob.y0) * g; ob.y1 += (y1 - ob.y1) * g; ob.r += (round - ob.r) * g;
  const w = ob.x1 - ob.x0, h = ob.y1 - ob.y0, rx = 0, ry = 0; // always a hard cornered rectangle
  const name = st === 6 ? 'liquidity' : st === -1 ? 'data in' : st === -2 ? 'data out' : `${STAGE_NAMES[st]} ${STARTS[st]} to ${st < 5 ? STARTS[st + 1] - 1 : 27}`, tw = name.length * 6 + 16, c = '#17306e';
  let words = '';
  if (st === -1) { // data in: small balls drop in from above, swirl down and vanish into the sphere; they all land well before the camera moves on
    pv.copy(world.localToWorld(V(0, layerY(-3), 0))).project(camera); const cx = (pv.x + 1) / 2 * W, cy = (1 - pv.y) / 2 * H, T = (now - tour.at) / 1000;
    for (let i = 0; i < tourLetters.length; i++) { const p = (T - 0.2 - i * 0.11) / 1.5; if (p < 0 || p > 1) continue;
      const an = tourLetters[i].a + p * 3.2, R = 110 * (1 - p), x = cx + Math.cos(an) * R, y = cy - 340 * Math.pow(1 - p, 1.6) + Math.sin(an) * R * 0.3;
      words += `<circle cx="${x}" cy="${y}" r="${(5.5 - p * 4) * tourLetters[i].s}" opacity="${1 - Math.pow(p, 5)}" fill="${tourLetters[i].col}"/>`; } }
  tourSvg.innerHTML = words + `<rect x="${ob.x0}" y="${ob.y0}" width="${w}" height="${h}" rx="${rx}" ry="${ry}" fill="none" stroke="${c}" stroke-width="1.5" stroke-dasharray="6 4"/><foreignObject x="${ob.x0 + w / 2 - tw / 2}" y="${ob.y0 - 16}" width="${tw}" height="16"><div class="callt" style="background:${c};width:${tw}px">${name}</div></foreignObject>`;
}
let typeTimer = 0;
function typeStop(k: number) {
  const [title, , copy] = TOUR[k]; clearInterval(typeTimer);
  tourText.innerHTML = `<div class="tt-head"><span>${k + 1} of ${TOUR.length}</span><b>${title}</b></div><p></p>`; tourText.classList.add('on');
  const p = tourText.querySelector('p')!; let i = 0; // about 55 characters a second, so a line takes about 3 s, then it rests before the camera moves on
  typeTimer = window.setInterval(() => { i = Math.min(copy.length, i + 1); p.textContent = copy.slice(0, i); if (i >= copy.length) clearInterval(typeTimer); }, 18);
}
tourHook = (now: number) => { fadeTick(now); tourTick(now); };
/* the site can pinpoint one part: postMessage({ goto: partNumber }) flies the camera to it once the network is built */
addEventListener('message', (e) => { if (!e.data || typeof e.data.goto !== 'number') return; const p = e.data.goto; const tryGo = (n: number) => { if (net) { calloutsOn = false; myLabels = false; pinView = true; labels.domElement.style.visibility = 'hidden'; drawMine(); drawKey(); drawPeel(); goTo(p); } else if (n > 0) setTimeout(() => tryGo(n - 1), 300); }; tryGo(40); });
addEventListener('message', (e) => { if (e.data && e.data.tour === 'start') tourStart(); if (e.data && e.data.tour === 'stop') tourEnd(); });
  const views = document.createElement('div'); views.className = 'hud viewbar';
  // each view as a small line drawing of a cube, the face you look at filled
  const cubeIcon: Record<string, string> = {
    front: '<polygon points="4,7 13,7 13,16 4,16" class="f"/><polyline points="4,7 7,4 16,4 16,13 13,16"/><line x1="13" y1="7" x2="16" y2="4"/>',
    side: '<polygon points="13,7 16,4 16,13 13,16" class="f"/><polyline points="4,7 7,4 16,4"/><polygon points="4,7 13,7 13,16 4,16"/>',
    top: '<polygon points="4,7 7,4 16,4 13,7" class="f"/><polygon points="4,7 13,7 13,16 4,16"/><polyline points="13,16 16,13 16,4"/>',
    inside: '<path d="M1.5 10 C5 4.5 15 4.5 18.5 10 C15 15.5 5 15.5 1.5 10 Z"/><circle cx="10" cy="10" r="2.6" class="f"/>',
    close: '<circle cx="8.5" cy="8.5" r="5"/><line x1="12.2" y1="12.2" x2="16.5" y2="16.5"/><line x1="8.5" y1="6" x2="8.5" y2="11"/><line x1="6" y1="8.5" x2="11" y2="8.5"/>',
  };
  // the last button switches the zoomed section labels on and off, filled while they're on
  // the view icons are the brain's own shape: the crowned cylinder, from above, close up and from inside
  // the brain's own shape in small: rings stacked down, narrower at the crown, the data-in sphere on top (same as the site's Network icon)
  const cyl = '<ellipse cx="10" cy="7.6" rx="4.4" ry="1.5"/><ellipse cx="10" cy="10.9" rx="6.4" ry="1.5"/><ellipse cx="10" cy="14.2" rx="7" ry="1.5"/><ellipse cx="10" cy="17.5" rx="7" ry="1.5"/><circle cx="10" cy="3.2" r="2" class="f"/>';
  cubeIcon.full = cyl;
  cubeIcon.top = '<circle cx="10" cy="10" r="7.5"/><circle cx="10" cy="10" r="4.6"/><circle cx="10" cy="10" r="1.8" class="f"/>';
  // up close: a panorama, the vertical lines bunch and bow towards the edges and run off the button
  cubeIcon.near = '<path d="M-0.63 -6 Q-4.34 10 -0.63 26 M1.57 -6 Q-1.38 10 1.57 26 M5.35 -6 Q3.72 10 5.35 26 M10.00 -6 Q10.00 10 10.00 26 M14.65 -6 Q16.28 10 14.65 26 M18.43 -6 Q21.38 10 18.43 26 M20.63 -6 Q24.34 10 20.63 26 M-4 4 Q10 -2 24 4 M-4 16 Q10 22 24 16"/>';
  // inside: a soft blob, the inside of the brain
  cubeIcon.inside = '<path d="M4.2 9.6 C3.4 5.6 6.6 3 10.4 3.6 C14.4 4.2 17 6.8 16.2 10.8 C15.6 14.6 12.4 17 8.8 16.2 C6 15.6 4.7 12.8 4.2 9.6 Z"/><path d="M7.6 8.4 C8 7.2 9 6.5 10.2 6.5"/>';
  const drawViews = () => { views.innerHTML = ['full', 'top', 'near', 'inside'].map((k) => `<button data-v="${k}" data-tip="${k === 'full' ? 'full view' : k === 'top' ? 'birds eye' : k === 'near' ? 'up close' : 'inside'}">${k === 'near' ? `<svg viewBox="0 0 20 20" width="18" height="18" style="visibility:hidden"></svg><span class="bleed"><svg viewBox="0 0 20 20">${cubeIcon[k]}</svg></span>` : `<svg viewBox="0 0 20 20" width="18" height="18">${cubeIcon[k]}</svg>`}</button>`).join('') + `<button data-v="in" data-tip="zoom in"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M4 10 H16 M10 4 V16"/></svg></button><button data-v="out" data-tip="zoom out"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M4 10 H16"/></svg></button>`  + (window.parent !== window ? `<button data-v="popout" data-tip="pop out"><svg viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="6" width="11" height="11"/><path d="M10 3 H17 V10 M17 3 L9.5 10.5"/></svg></button><button data-v="split" data-tip="split screen"><svg viewBox="0 0 20 20" width="18" height="18"><rect x="3" y="3.5" width="14" height="13"/><rect x="3" y="3.5" width="14" height="6.5" class="f"/></svg></button>` : '') + `<button data-v="reset" data-tip="restore"><svg viewBox="0 0 20 20" width="18" height="18"><path d="M4.5 7.5 A6.5 6.5 0 1 1 3.8 12"/><polyline points="4.2,3.6 4.5,7.5 8.4,7.2"/></svg></button>`; };
  drawViews();
  views.addEventListener('click', (e) => { const v = (e.target as HTMLElement).closest('button')?.dataset.v;     if (v === 'reset') { resetLayout(); if (window.parent !== window) window.parent.postMessage({ restore: true }, '*'); return; } // restore also leaves split screen and closes the pop out
    if (v === 'split') { window.parent.postMessage({ split: 'toggle' }, '*'); return; }
    if (v === 'popout') { window.parent.postMessage({ popout: true }, '*'); return; }
    if (v === 'in' || v === 'out') { // quick clicks stack: each one aims a step past where the last click was heading, and the glide gets shorter so rapid clicks feel fast
      const sph = new THREE.Spherical().setFromVector3(camera.position.clone().sub(controls.target)), chained = glide && glide.zoom, from = chained ? glide!.r1 : sph.radius, r1 = THREE.MathUtils.clamp(from * (v === 'in' ? 0.72 : 1 / 0.72), controls.minDistance, controls.maxDistance);
      fly = null; glide = { r0: sph.radius, r1, p0: sph.phi, p1: sph.phi, th: 0, done: 0, t: 0, dur: chained ? 0.32 : 0.45, zoom: true }; return; }
    if (v === 'labels') { calloutsOn = !calloutsOn; drawViews(); } else if (v) view(v === 'near' ? 'close' : v); });
  document.body.append(views);
  // scrolling over the brain zooms in and out, like a game camera; the page itself scrolls from anywhere else
  controls.enableZoom = true; controls.zoomSpeed = 0.9;
  // plain scroll anywhere over the brain moves the site page; cmd + scroll zooms

  // the site's font follows into the brain's labels and boxes
  addEventListener('message', (e) => { if (e.data && typeof e.data.font === 'string') document.body.dataset.font = e.data.font; });

}
void start(null);
