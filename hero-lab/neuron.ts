// One small 3D neuron spinning slowly, on a transparent background, for the gaps in the home page text.
// Same shape as the banner neurons: a round body, arms with a ball at each end. ?c=pink for the pink one.
import * as THREE from 'three';
import { PARTS } from './parts.ts';
const q = new URLSearchParams(location.search), col = q.get('c') === 'pink' ? '#ff3fa4' : q.get('c') === 'cobalt' ? '#2a5dff' : '#17306e', seedIn = Number(q.get('s') ?? 3), ARMS = Number(q.get('a') ?? 5);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); renderer.setPixelRatio(Math.min(2, devicePixelRatio)); renderer.setSize(innerWidth, innerHeight); renderer.setClearColor(0x000000, 0);
renderer.outputColorSpace = THREE.SRGBColorSpace; document.body.append(renderer.domElement);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 0.1, 50); camera.position.set(0, 0.25, 3.2); camera.lookAt(0, 0, 0);
scene.add(new THREE.HemisphereLight('#ffffff', '#c9cfdb', 1.6)); const key = new THREE.DirectionalLight('#ffffff', 1.4); key.position.set(2, 3, 3); scene.add(key);
let seed = seedIn; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const m = new THREE.MeshStandardMaterial({ color: col, roughness: 0.42, metalness: 0.05 }), g = new THREE.Group();
g.add(new THREE.Mesh(new THREE.SphereGeometry(0.22, 32, 24), m));
const QM = q.has('q');
for (let k = 0; k < ARMS; k++) { const a = (k / ARMS) * Math.PI * 2 + rnd() * 0.5, d0 = new THREE.Vector3(Math.cos(a), (rnd() - 0.5) * 0.9, Math.sin(a)); if (QM) d0.z *= 0.2; /* the question marks' faces, front and back, stay clear: arms go out to the sides */ const dir = d0.normalize(), len = 0.42 + rnd() * 0.18;
  const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.075, len, 14), m); arm.position.copy(dir.clone().multiplyScalar(len / 2)); arm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); g.add(arm);
  const end = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), m); end.position.copy(dir.clone().multiplyScalar(len)); g.add(end); }
// ?bundle: the memory stage's dendrite bundle made chunky like the banner neurons: a round head, a thick stem, two branches that split again, a ball at every joint and end
if (q.has('bundle')) { g.clear(); const R = 0.085, J = 0.11, V = (x: number, y: number) => new THREE.Vector3(x, y, 0);
  const rod = (a: THREE.Vector3, b: THREE.Vector3) => { const len = a.distanceTo(b), o = new THREE.Mesh(new THREE.CylinderGeometry(R, R, len, 16), m); o.position.copy(a).add(b).multiplyScalar(0.5); o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(o); };
  const ball = (p: THREE.Vector3, r = J) => { const o = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 18), m); o.position.copy(p); g.add(o); };
  const head = V(0, 0.62), fork = V(0, 0.05), L = new THREE.Vector3(-0.3, -0.28, 0.14), Rt = new THREE.Vector3(0.3, -0.28, -0.14); /* branches spread in depth too, so it reads as solid from every angle */
  ball(head, 0.22); rod(head, fork); ball(fork); rod(fork, L); rod(fork, Rt); ball(L); ball(Rt);
  for (const [p, sx] of [[L, -1], [Rt, 1]] as [THREE.Vector3, number][]) for (const t of [-1, 1]) { const e = new THREE.Vector3(p.x + sx * 0.08 + t * 0.12, -0.66, p.z + t * 0.16); rod(p, e); ball(e); }
  g.position.y = 0; camera.position.set(0, 0, 4.2); camera.lookAt(0, 0, 0); }
const partIx = q.get('part'); if (partIx !== null) { g.clear(); const pc = PARTS[Number(partIx)](); pc.scale.setScalar(2.6); const box = new THREE.Box3().setFromObject(pc), ctr = box.getCenter(new THREE.Vector3()); pc.position.sub(ctr); g.add(pc); } // ?part=0..5: one of the network's stage components instead of a neuron
// ?logo: our network N as a small solid (seven balls joined by eight rods), for the sidebar's live marker
const isLogo = q.has('logo'); if (isLogo) { g.clear(); const nn = [[24, 20], [24, 50], [24, 80], [50, 50], [76, 20], [76, 50], [76, 80]].map(([x, y]) => new THREE.Vector3((x - 50) / 30, -(y - 50) / 30, 0)), ne = [[0, 1], [1, 2], [0, 3], [3, 6], [4, 5], [5, 6], [1, 3], [3, 5]];
  for (const [i, j] of ne) { const a = nn[i], b = nn[j], len = a.distanceTo(b), rod = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, len, 16), m); rod.position.copy(a).add(b).multiplyScalar(0.5); rod.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()); g.add(rod); }
  nn.forEach((p, k) => { const ball = new THREE.Mesh(new THREE.SphereGeometry(k === 3 ? 0.4 : 0.32, 24, 18), m); ball.position.copy(p); g.add(ball); }); camera.position.set(0, 0, 6.6); camera.lookAt(0, 0, 0); }
/* ?star: a chunky 3D star for the Rarities title, turning like the sidebar logo */
const isStar = q.has('star'); if (isStar) { g.clear(); const sh = new THREE.Shape(); for (let k = 0; k < 10; k++) { const a = Math.PI / 2 + (k / 10) * Math.PI * 2, r = k % 2 ? 0.42 : 1; const x = Math.cos(a) * r, y = Math.sin(a) * r; if (k) sh.lineTo(x, y); else sh.moveTo(x, y); } sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 4 }); geo.center(); g.add(new THREE.Mesh(geo, m)); camera.position.set(0, 0, 6.2); camera.lookAt(0, 0, 0); }
g.rotation.x = isLogo || isStar || q.has('q') ? 0 : partIx !== null ? 0.15 : 0.35; scene.add(g);
// ?q: a question mark engraved into the neuron's body, centred on its face, turning with it
if (q.has('q')) { const body = g.children[0] as THREE.Mesh, c = document.createElement('canvas'); c.width = 512; c.height = 256; const x = c.getContext('2d')!;
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const draw = () => { x.fillStyle = col; x.fillRect(0, 0, 512, 256); x.fillStyle = '#ffffff'; x.font = '150px "Departure Mono", monospace'; x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('?', 384, 136); x.fillText('?', 128, 136); tex.needsUpdate = true; }; // one on the front, one on the back
  draw(); document.fonts.load('150px "Departure Mono"').then(draw);
  body.geometry = new THREE.SphereGeometry(0.3, 48, 32); body.material = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.42, metalness: 0.05 }); }
let visible = true; new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(renderer.domElement);
const axis = partIx !== null || isLogo || isStar || q.has('q') ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 1, 0.3).normalize(), base = g.quaternion.clone(), qq = new THREE.Quaternion();
/* the spin speed eases toward a target the page can set with postMessage({ speed }) */
let speed = q.has("fast") ? 1.2 : 0.7, target = speed, ang = 0, last = 0;
addEventListener('message', (e) => { if (typeof e.data?.speed === 'number') target = e.data.speed; if (typeof e.data?.color === 'string') m.color.set(e.data.color); }); /* the page can recolour it, e.g. pink once it is yours */
renderer.setAnimationLoop((t) => { const dt = last ? Math.min((t - last) / 1000, 0.1) : 0; last = t; if (!visible || document.hidden) return; speed += (target - speed) * Math.min(1, dt * 3); ang += dt * speed; qq.setFromAxisAngle(axis, ang); g.quaternion.copy(qq).multiply(base); renderer.render(scene, camera); }); // the neurons turn on a diagonal axis
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });
