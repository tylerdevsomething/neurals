// The home hero's blob: the network's liquidity water as a slow jelly, with 3D neurons (the banner's shape, made solid)
// suspended inside, drifting and swirling. White studio, no glow.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, stencil: true });
renderer.setPixelRatio(new URLSearchParams(location.search).has('pfp') ? 3 : new URLSearchParams(location.search).has('bounce') ? Math.min(2, devicePixelRatio) : Math.min(1.5, devicePixelRatio)); /* the tiny chat avatar renders at 3x so it stays crisp */ renderer.setSize(innerWidth, innerHeight); // the bouncing hero draws the title, so it renders at full screen sharpness // sharp enough, fewer pixels than a 2x screen
renderer.shadowMap.enabled = !new URLSearchParams(location.search).has('bounce'); renderer.shadowMap.type = THREE.VSMShadowMap; // the bouncing version paints its own soft floor shadow, no shadow pass
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.append(renderer.domElement);
const BOUNCE = new URLSearchParams(location.search).has('bounce'), BSIZE = 1.7, PFP = new URLSearchParams(location.search).has('pfp'), PLAIN = new URLSearchParams(location.search).has('plain'), PROMO = new URLSearchParams(location.search).has('promo'), LOOP = Number(new URLSearchParams(location.search).get('loop') ?? 12); /* ?promo: a seamless loop for the X banner, LOOP seconds long. ?pfp: a tight crop for the chat avatar */
// the floating blob always fits its frame, however narrow: the camera backs off until the whole blob and its shadow are in view
function fitFloat() { const t = Math.tan((32 * Math.PI) / 360), z = PFP ? 7.6 : Math.max(7.4, 2.25 / (t * (innerWidth / innerHeight)), 2.5 / t); camera.position.set(0, 0.6 * z / 7.6, z); camera.lookAt(0, -0.3, 0); } // the bouncing blob's size
const scene = new THREE.Scene(); const bg = new THREE.Color('#ffffff'); scene.background = bg;
const xray = new THREE.MeshBasicMaterial({ color: '#17306e', toneMapped: false }); /* dark navy */ let panel: { x: number; y: number; w: number; h: number } | null = null;
let title: { x: number; y: number; w: number; h: number; lines: string[]; size: number; lh: number; ls: number } | null = null, titleKey = '';
addEventListener('message', (e) => { if (e.data && e.data.panel) panel = e.data.panel; if (e.data && e.data.title) title = e.data.title; });
document.fonts.load('36px "Departure Mono"');
const ortho = new THREE.OrthographicCamera(0, 1, 1, 0, -1, 1), quadScene = new THREE.Scene();
const inkMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false }); // exact colours: no lighting adjustment on the title or the cobalt
const whiteMat = new THREE.MeshBasicMaterial({ transparent: true, depthTest: false, depthWrite: false, toneMapped: false, stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc });
const quad = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), inkMat); quadScene.add(quad);
function textTex(col: string) { const pr = renderer.getPixelRatio(), t = title!, c = document.createElement('canvas'); c.width = Math.ceil(t.w * pr); c.height = Math.ceil(t.h * pr); const g = c.getContext('2d')!;
  g.scale(pr, pr); g.fillStyle = col; g.font = `${t.size}px "Departure Mono"`; (g as unknown as { letterSpacing: string }).letterSpacing = `${t.ls}px`; g.textAlign = 'center'; g.textBaseline = 'middle';
  t.lines.forEach((ln, i) => g.fillText(ln, t.w / 2, (i + 0.5) * t.lh)); const tx = new THREE.CanvasTexture(c); tx.colorSpace = THREE.SRGBColorSpace; tx.generateMipmaps = false; tx.minFilter = THREE.LinearFilter; tx.magFilter = THREE.LinearFilter; return tx; } // pixel for pixel: no blur from mipmaps
scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04).texture;
const camera = new THREE.PerspectiveCamera(PROMO ? 10 : 32, innerWidth / innerHeight, 0.1, 400); if (BOUNCE) camera.position.set(0, 0, PROMO ? Math.tan((16 * Math.PI) / 180) * 14 / Math.tan((5 * Math.PI) / 180) : 14); else fitFloat(); /* the promo uses a long lens, so a blob at the left or right edge keeps its true shape and touches the edge exactly */
scene.add(new THREE.HemisphereLight('#ffffff', '#dfe3ea', 1.3)); const key = new THREE.DirectionalLight('#ffffff', 1.6); key.position.set(0.6, 8, 1.2); scene.add(key);
// a soft shadow on the white floor under the floating blob
key.castShadow = true; key.shadow.bias = -0.0008; key.shadow.mapSize.set(1024, 1024); key.shadow.radius = 14; key.shadow.blurSamples = 20; Object.assign(key.shadow.camera, { left: -4, right: 4, top: 4, bottom: -4, near: 1, far: 20 }); key.shadow.camera.updateProjectionMatrix();
const floor = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), new THREE.ShadowMaterial({ opacity: 0.07 })); floor.rotation.x = -Math.PI / 2; floor.position.y = -2.05; floor.receiveShadow = true; if (!BOUNCE) scene.add(floor);

// the jelly: the same water as the network's liquidity bubble
const geo = mergeVertices(new THREE.IcosahedronGeometry(1.5, 16)), base = Float32Array.from(geo.attributes.position.array as Float32Array), pos = geo.attributes.position as THREE.BufferAttribute;
const skin = new THREE.MeshPhysicalMaterial({ color: '#f4f8ff', transmission: 1, ior: 1.33, thickness: 2.2, roughness: 0.04, metalness: 0, attenuationColor: '#dbe7ff', attenuationDistance: 6, clearcoat: 1, clearcoatRoughness: 0.03, iridescence: 0.4, iridescenceIOR: 1.3, envMapIntensity: 0.9 });
// the network's inner fog, never one colour: soft lilac, ice blue and pink drifting over it (same recipe as the liquidity bubble)
{ const cols: number[] = [], c = new THREE.Color(), ps = geo.attributes.position; for (let i = 0; i < ps.count; i++) { const y = ps.getY(i) / 1.5, x = ps.getX(i) / 1.5, z = ps.getZ(i) / 1.5; c.setHSL(0.6 + 0.12 * Math.sin(3 * x + 2 * y) + 0.08 * Math.sin(4 * z - y), 0.75, 0.78); cols.push(c.r, c.g, c.b); } geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3)); }
const fog = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, transparent: true, opacity: 0.08, roughness: 1, depthWrite: false })); fog.scale.setScalar(0.86);
if (PFP) { fog.visible = false; skin.color.set('#eef4ff'); skin.attenuationColor.set('#bcd2ff'); skin.attenuationDistance = 7; skin.thickness = 1.2; skin.roughness = 0; skin.envMapIntensity = 0.6; floor.material.opacity = 0.04; } /* the avatar: clearer water, no milky fog, a lighter shadow */
const blob = new THREE.Mesh(geo, skin); blob.castShadow = true; blob.add(fog); scene.add(blob);

import { PARTS } from './parts.ts';
let seed = 9; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const swimmers = PARTS.map((make, i) => {
  const obj = make(); obj.scale.setScalar(1.25); if (!PLAIN) scene.add(obj); /* ?plain: just the network's liquidity water, no stage shapes inside */
  return { obj, r: 0.35 + (i % 3) * 0.25, y: (i / 5 - 0.5) * 1.1, a: (i / 6) * Math.PI * 2, sp: (0.14 + rnd() * 0.12) * (i % 2 ? -1 : 1), bob: rnd() * 6.3, spin: new THREE.Vector3(rnd() - 0.5, rnd() - 0.5, rnd() - 0.5).multiplyScalar(0.5) };
});

const d = new THREE.Vector3(), t0 = performance.now();
// bounce: the whole jelly (with its neurons) is one group that drifts at a steady speed and reflects off the edges of the view
const holder = new THREE.Group(); scene.add(holder); if (BOUNCE) { scene.remove(blob); holder.add(blob); swimmers.forEach((sw) => { scene.remove(sw.obj); holder.add(sw.obj); }); holder.scale.setScalar(BSIZE); }
const shTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d')!, gr = g.createRadialGradient(64, 64, 0, 64, 64, 64); gr.addColorStop(0, 'rgba(23,30,50,1)'); gr.addColorStop(1, 'rgba(23,30,50,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
const shadow = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: shTex, transparent: true, depthWrite: false, opacity: 0.1 })); if (BOUNCE) scene.add(shadow);
const drops = Array.from({ length: 36 }, () => { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), skin); m.visible = false; scene.add(m); return { m, v: new THREE.Vector3(), age: 9, size: 0.1 }; }); let dropAt = 0;
let pseed = 7; const prnd = () => ((pseed = (pseed * 16807) % 2147483647) / 2147483647); const R = () => (PROMO ? prnd() : Math.random());
function burst(n: THREE.Vector3, r: number) { // n points at the wall that was hit
  const at = holder.position.clone().addScaledVector(n, r * 0.92), side = new THREE.Vector3(-n.y, n.x, 0);
  for (let k = 0; k < 5; k++) { const d = drops[dropAt++ % drops.length]; d.m.position.copy(at).addScaledVector(side, (R() - 0.5) * r * 0.9); d.v.copy(n).multiplyScalar(-(0.8 + R() * 0.9)).addScaledVector(side, (R() - 0.5) * 1.4).add(new THREE.Vector3(0, 0, (R() - 0.5) * 0.8)); d.age = 0; d.size = 0.03 + R() * 0.05; d.m.visible = true; }
}
const vel = new THREE.Vector2(0.8, 0.57); let last = performance.now(); // a slow, cosmic drift
// squash and stretch: a spring for each axis; a wall hit flattens the jelly against it, then it springs back and wobbles
const sq = { x: 0, vx: 0, y: 0, vy: 0 }; const SPRING = 16, DAMP = 3.2; // soft like a lava lamp, but quick enough to feel natural
let lastT = 0;
let visible = true; new IntersectionObserver((e) => { visible = e[0].isIntersecting; }).observe(renderer.domElement);
renderer.setAnimationLoop(() => {
  if (!visible || document.hidden) return; // nothing is drawn while the hero is off screen
  const tReal = (performance.now() - t0) / 1000, t = PROMO ? ((window as unknown as { __promoT?: number }).__promoT ?? tReal % LOOP) : tReal, w = (2 * Math.PI) / LOOP;
  if (PROMO && t < lastT) pseed = 7; if (PROMO) lastT = t;
  // the jelly breathes: a slow, heavy wobble of its surface
  for (let i = 0; i < pos.count; i++) { d.set(base[i * 3], base[i * 3 + 1], base[i * 3 + 2]).normalize();
    const A = PFP ? 2.6 : 1, W = PFP ? 2.2 : 1; /* the tiny chat avatar wobbles harder and faster so the movement reads */ const r = 1.5 * (1 + A * 0.05 * Math.sin(2.6 * d.x + (PROMO ? w : 0.7 * W) * t) + A * 0.045 * Math.sin(3.1 * d.y - (PROMO ? w : 0.6 * W) * t + 2 * d.z) + A * 0.035 * Math.sin(4 * d.z + (PROMO ? 2 * w : 0.5 * W) * t + 3 * d.x));
    pos.setXYZ(i, d.x * r, d.y * r * 0.94, d.z * r); }
  pos.needsUpdate = true; geo.computeVertexNormals(); blob.rotation.y = PROMO ? 0.3 * Math.sin(w * t) : t * 0.05; const lift = Math.sin(PROMO ? w * t : t * 0.6) * 0.09; blob.position.y = lift;
  // the neurons swirl round inside, each on its own slow orbit, bobbing and tumbling as they go
  if (PROMO) { swimmers.forEach((s, i) => { const a = (i / 6) * Math.PI * 2 + Math.sign(s.sp) * w * t; const y = s.y + Math.sin(w * t + s.bob) * 0.12;
    s.obj.position.set(Math.cos(a) * s.r, y + lift, Math.sin(a) * s.r * 0.8); s.obj.rotation.set(1.2 * Math.sin(w * t + i), 1.2 * Math.sin(w * t + i * 2), 0.8 * Math.sin(w * t + i * 3)); }); }
  else for (const s of swimmers) { s.a += s.sp * 0.016; const y = s.y + Math.sin(t * 0.5 + s.bob) * 0.12;
    s.obj.position.set(Math.cos(s.a) * s.r, y + lift, Math.sin(s.a) * s.r * 0.8); s.obj.rotation.x += s.spin.x * 0.016; s.obj.rotation.y += s.spin.y * 0.016; s.obj.rotation.z += s.spin.z * 0.016; }
  if (BOUNCE) { const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    const halfH = Math.tan((camera.fov * Math.PI) / 360) * camera.position.z, halfW = halfH * camera.aspect, r = 1.5 * BSIZE * 1.06;
    const tri = (u: number) => { const f = ((u % 1) + 1) % 1; return f < 0.5 ? 4 * f - 1 : 3 - 4 * f; }; /* -1..1..-1 over one cycle */
    const px = holder.position.x, py = holder.position.y;
    if (PROMO) { holder.position.x = (halfW - r) * tri(t / LOOP + 0.25); holder.position.y = (halfH - r) * tri((2 * t) / LOOP + 0.25); }
    else { holder.position.x += vel.x * dt; holder.position.y += vel.y * dt; }
    // a wall hit: bounce back, and kick the spring so it squashes along the hit axis (and bulges along the other)
    const hitX = (side: number) => { vel.x *= -1; sq.vx -= 2.2; burst(new THREE.Vector3(side, 0, 0), r); }, hitY = (side: number) => { vel.y *= -1; sq.vy -= 2.2; burst(new THREE.Vector3(0, side, 0), r); };
    if (PROMO) { const ex = halfW - r - 1e-3, ey = halfH - r - 1e-3; /* a hit is the moment the path turns at an edge */
      if (holder.position.x >= ex && px < ex) { sq.vx -= 2.2; burst(new THREE.Vector3(1, 0, 0), r); } if (holder.position.x <= -ex && px > -ex) { sq.vx -= 2.2; burst(new THREE.Vector3(-1, 0, 0), r); }
      if (holder.position.y >= ey && py < ey) { sq.vy -= 2.2; burst(new THREE.Vector3(0, 1, 0), r); } if (holder.position.y <= -ey && py > -ey) { sq.vy -= 2.2; burst(new THREE.Vector3(0, -1, 0), r); } }
    else {
    if (holder.position.x > halfW - r) { holder.position.x = halfW - r; hitX(1); } if (holder.position.x < -halfW + r) { holder.position.x = -halfW + r; hitX(-1); }
    if (holder.position.y > halfH - r) { holder.position.y = halfH - r; hitY(1); } if (holder.position.y < -halfH + r) { holder.position.y = -halfH + r; hitY(-1); } }
    sq.vx += (-SPRING * sq.x - DAMP * sq.vx) * dt; sq.x += sq.vx * dt; sq.vy += (-SPRING * sq.y - DAMP * sq.vy) * dt; sq.y += sq.vy * dt;
    const k = BSIZE, ax = Math.max(-0.5, Math.min(0.5, sq.x)), ay = Math.max(-0.5, Math.min(0.5, sq.y));
    holder.scale.set(k * (1 + ax - ay * 0.5), k * (1 + ay - ax * 0.5), k * (1 - (ax + ay) * 0.25));
    for (const d of drops) { if (!d.m.visible) continue; d.age += dt; if (d.age > 0.9) { d.m.visible = false; continue; } d.v.y -= 1.4 * dt; d.v.multiplyScalar(1 - 0.8 * dt); d.m.position.addScaledVector(d.v, dt); d.m.scale.setScalar(d.size * (1 - d.age / 0.9)); }
    // the floor shadow: under the blob, on the bottom edge; smaller and fainter the higher it floats
    const h01 = (holder.position.y - (-halfH + r)) / Math.max(0.01, 2 * (halfH - r)), sw = r * 2.2 * (1 - 0.45 * h01) * (1 + ax * 0.6);
    shadow.position.set(holder.position.x, -halfH + 0.18, -0.5); shadow.scale.set(sw, sw * 0.16, 1); (shadow.material as THREE.MeshBasicMaterial).opacity = 0.3 * (1 - 0.6 * h01); }
  renderer.render(scene, camera);
  // x-ray: where the blob passes behind the page's white panel, paint the panel white here and the blob's shape on it in solid grey
  if (BOUNCE && panel) { const H = innerHeight; renderer.autoClear = false; renderer.setScissorTest(true); renderer.setScissor(panel.x, H - panel.y - panel.h, panel.w, panel.h);
    renderer.setClearColor(0xffffff, 1); renderer.clear(true, true, true); shadow.visible = false; scene.background = null;
    const ok = title && document.fonts.check('36px "Departure Mono"'); if (ok) { const key = JSON.stringify(title); if (key !== titleKey) { titleKey = key; inkMat.map?.dispose(); whiteMat.map?.dispose(); inkMat.map = textTex('#222423'); whiteMat.map = textTex('#ffffff'); inkMat.needsUpdate = whiteMat.needsUpdate = true; }
      const W = innerWidth; ortho.left = 0; ortho.right = W; ortho.top = H; ortho.bottom = 0; ortho.updateProjectionMatrix(); quad.position.set(title!.x + title!.w / 2, H - title!.y - title!.h / 2, 0); quad.scale.set(title!.w, title!.h, 1); quad.material = inkMat; renderer.render(quadScene, ortho); }
    xray.stencilWrite = true; xray.stencilRef = 1; xray.stencilFunc = THREE.AlwaysStencilFunc; xray.stencilZPass = THREE.ReplaceStencilOp; scene.overrideMaterial = xray; renderer.render(scene, camera); scene.overrideMaterial = null;
    if (ok) { quad.material = whiteMat; renderer.render(quadScene, ortho); }
    scene.background = bg; shadow.visible = true; renderer.setScissorTest(false); renderer.autoClear = true; }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); if (!BOUNCE) fitFloat(); });
