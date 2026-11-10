// the white icosahedron from the top of the hero brain, with an N engraved into its faces, spinning slowly
import * as THREE from 'three';
const COBALT = '#2a5dff';
// a block N, centred on 0,0, about 1 unit tall
const nShape = () => {
  const s = new THREE.Shape(), P = [[-.42, -.5], [-.42, .5], [-.2, .5], [.2, -.08], [.2, .5], [.42, .5], [.42, -.5], [.2, -.5], [-.2, .08], [-.2, -.5]];
  s.moveTo(P[0][0], P[0][1]); P.slice(1).forEach(([x, y]) => s.lineTo(x, y)); s.closePath(); return s;
};
function build(all: boolean) {
  const g = new THREE.Group();
  const ico = new THREE.IcosahedronGeometry(1.5);
  g.add(new THREE.Mesh(ico, new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.35, metalness: 0.05, flatShading: true })));
  g.add(new THREE.LineSegments(new THREE.EdgesGeometry(ico), new THREE.LineBasicMaterial({ color: COBALT })));
  const pos = ico.attributes.position, nGeo = new THREE.ShapeGeometry(nShape());
  const nMat = new THREE.MeshBasicMaterial({ color: COBALT, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, side: THREE.DoubleSide });
  for (let f = 0; f < pos.count / 3; f++) {
    const a = new THREE.Vector3().fromBufferAttribute(pos, f * 3), b = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 1), c = new THREE.Vector3().fromBufferAttribute(pos, f * 3 + 2);
    const ctr = a.clone().add(b).add(c).divideScalar(3), nrm = new THREE.Triangle(a, b, c).getNormal(new THREE.Vector3());
    if (!all && f !== bestFace(pos)) continue;
    // the N stands upright: its top points at the face's highest corner
    const top = [a, b, c].reduce((m, v) => (v.y > m.y ? v : m)), up = top.clone().sub(ctr).normalize();
    const m = new THREE.Mesh(nGeo, nMat), right = new THREE.Vector3().crossVectors(up, nrm).normalize();
    m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, nrm));
    m.position.copy(ctr).addScaledVector(nrm, 0.01).addScaledVector(up, -0.05); m.scale.setScalar(0.42);
    g.add(m);
  }
  return g;
}
let best = -1;
function bestFace(pos: THREE.BufferAttribute) { // the face pointing most straight at the camera at rest
  if (best >= 0) return best; let z = -9;
  for (let f = 0; f < pos.count / 3; f++) { const t = new THREE.Triangle(...[0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(pos, f * 3 + k)) as [THREE.Vector3, THREE.Vector3, THREE.Vector3]); const n = t.getNormal(new THREE.Vector3()); if (n.z > z) { z = n.z; best = f; } }
  return best;
}
const scenes: { r: THREE.WebGLRenderer; s: THREE.Scene; c: THREE.Camera; g: THREE.Group; all: boolean }[] = [];
document.querySelectorAll<HTMLCanvasElement>('canvas.ico').forEach((cv) => {
  const r = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: true }); r.setPixelRatio(1);
  const s = new THREE.Scene(), c = new THREE.PerspectiveCamera(30, 1, 0.1, 50); c.position.set(0, 0, cv.dataset.pfp ? 9.4 : 7.2); r.setPixelRatio(1);
  s.add(new THREE.AmbientLight('#ffffff', 1.6)); const d = new THREE.DirectionalLight('#ffffff', 2); d.position.set(2, 3, 4); s.add(d);
  const all = cv.dataset.all === '1', g = build(all); s.add(g); scenes.push({ r, s, c, g, all });
});
const STILL_Y = 0.6; // option 4 stands still at this angle (also the X profile picture)
const t0 = performance.now();
(function tick() {
  const t = (performance.now() - t0) / 1000;
  for (const v of scenes) { v.g.rotation.y = v.all ? STILL_Y : Math.sin(t * 0.8) * 0.5; v.g.rotation.x = v.all ? 0.25 : 0; v.r.render(v.s, v.c); }
  requestAnimationFrame(tick);
})();
