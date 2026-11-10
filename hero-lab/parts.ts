// The six stage components of the network as small solids, shared by the blob and the home page's spinning icons.
import * as THREE from 'three';
// one component from each stage of the network, built as a small solid in that stage's colour; memory's bundle is pink
const V3 = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
const mat = (c: string) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.42, metalness: 0.05 });
// a tube through the points, with a ball the same thickness at every joint and end so the shape reads as one fused piece
const tube = (pts: THREE.Vector3[], r: number, m: THREE.Material) => { const g = new THREE.Group(); g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0), 64, r, 10, false), m));
  for (const p of pts) { const j = new THREE.Mesh(new THREE.SphereGeometry(r * 1.02, 12, 10), m); j.position.copy(p); g.add(j); } return g; };
const ball = (p: THREE.Vector3, r: number, m: THREE.Material) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m); o.position.copy(p); return o; };
const box = (p: THREE.Vector3, w: number, h: number, d: number, m: THREE.Material) => { const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); o.position.copy(p); return o; };
const frame = (cx: number, cy: number, w: number, h: number, t: number, m: THREE.Material) => [box(V3(cx, cy + h / 2), w + t, t, t, m), box(V3(cx, cy - h / 2), w + t, t, t, m), box(V3(cx - w / 2, cy), t, h + t, t, m), box(V3(cx + w / 2, cy), t, h + t, t, m)];
const DEEP = '#0b1f6b', COBALT = '#2a5dff', PINK = '#ff3fa4';
export const PARTS: (() => THREE.Group)[] = [
  () => { const g = new THREE.Group(), m = mat(DEEP); g.add(...frame(0, -0.05, 0.26, 0.22, 0.035, m), box(V3(0, -0.05), 0.08, 0.08, 0.05, m), tube([V3(0, 0.05), V3(0, 0.2), V3(0.16, 0.2), V3(0.16, 0.35)], 0.016, m), box(V3(0.16, 0.36), 0.06, 0.06, 0.03, m)); return g; }, // tokenizer: a pad and its trace
  () => { const g = new THREE.Group(), m = mat(COBALT); g.add(...frame(0, 0, 0.4, 0.28, 0.035, m), tube([V3(-0.08, 0.08), V3(-0.08, -0.08)], 0.016, m), tube([V3(-0.08, 0), V3(0.2, 0)], 0.016, m), tube([V3(0, 0.13), V3(0, 0.3)], 0.016, m), tube([V3(0, -0.13), V3(0, -0.3)], 0.016, m)); return g; }, // syntax: a logic gate
  () => { const g = new THREE.Group(), m = mat(DEEP); g.add(tube([V3(0, 0.42), V3(0, 0.3), V3(0.06, 0.25), V3(-0.06, 0.19), V3(0.06, 0.13), V3(-0.06, 0.07), V3(0, 0.02)], 0.016, m));
    const cap = new THREE.Mesh(new THREE.CapsuleGeometry(0.045, 0.1, 6, 12), m); cap.position.set(0, -0.06, 0); g.add(cap, tube([V3(0, -0.16), V3(0, -0.21)], 0.016, m)); const ring = new THREE.Mesh(new THREE.TorusGeometry(0.06, 0.018, 10, 24), m); ring.position.set(0, -0.27, 0); g.add(ring); return g; }, // semantic: the hanging chain
  () => { const g = new THREE.Group(), m = mat(PINK); g.add(ball(V3(0, 0.26), 0.08, m), tube([V3(0, 0.4), V3(0, 0.3)], 0.018, m), tube([V3(0, 0.22), V3(0, 0.02)], 0.022, m));
    for (const sx of [-1, 1]) { g.add(tube([V3(0, 0.02), V3(sx * 0.14, -0.12)], 0.018, m)); for (const tx of [-1, 1]) g.add(tube([V3(sx * 0.14, -0.12), V3(sx * 0.14 + tx * 0.07, -0.3)], 0.014, m)); } return g; }, // memory: the dendrite bundle, pink
  () => { const g = new THREE.Group(), m = mat(DEEP); g.add(ball(V3(0, 0.36), 0.05, m), tube([V3(0, 0.34), V3(-0.08, 0.16), V3(0.08, 0.04), V3(-0.06, -0.12), V3(0.04, -0.3)], 0.017, m), tube([V3(0.08, 0.04), V3(0.2, -0.04)], 0.013, m), tube([V3(-0.08, 0.16), V3(-0.18, 0.08)], 0.013, m)); return g; }, // reasoning: a lightning filament
  () => { const g = new THREE.Group(), m = mat(COBALT); const cell = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.022, 10, 32), m); g.add(cell, ball(V3(0, 0), 0.045, m)); g.add(tube([V3(-0.2, -0.27), V3(0.2, -0.27)], 0.01, m), tube([V3(0, -0.15), V3(0, -0.27)], 0.012, m)); for (let k = 0; k < 5; k++) g.add(ball(V3(-0.2 + k * 0.1, -0.27), 0.025, m)); return g; }, // prediction: the cell over its row of candidates
];
