// The earlier flat drawings, brought back as tabs. Same live data as the 3D brain.
import { type Net, type Node, wires, rng } from './data.ts';

export type Hit = { x: number; y: number; r: number; n: Node };
export type Ctx = { g: CanvasRenderingContext2D; W: number; H: number; t: number; mx: number; my: number };

function layout(net: Net, W: number, H: number, o: { l: number; r: number; top: number; bot: number; stageGap: number; jitter?: number; seed?: number }) {
  const pos = new Map<number, { x: number; y: number }>();
  const gaps = 5, colW = (W - o.l - o.r - gaps * o.stageGap) / 27;
  const r = rng(o.seed ?? 3);
  const starts = [0, 4, 8, 14, 20, 25];
  const xOf = (l: number) => o.l + l * colW + starts.filter((s) => s > 0 && l >= s).length * o.stageGap;
  const h = H - o.top - o.bot, gap = h * 0.06, step = (h - gap) / 46;
  for (let l = 0; l < 28; l++) net.layers[l].forEach((n, i) => {
    const yi = i < 12 ? i : i + gap / step, j = o.jitter ?? 0;
    pos.set(n.part, { x: xOf(l) + (r() - 0.5) * j * colW, y: o.top + yi * step + (r() - 0.5) * j * step * 2 });
  });
  pos.set(net.input.part, { x: o.l - 70, y: o.top + h / 2 });
  pos.set(net.output.part, { x: W - o.r + 70, y: o.top + h / 2 });
  return { pos, xOf, colW };
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ---- neon on black
const NEON = ['#29e7ff', '#7b8cff', '#c46bff', '#ff4fd8', '#ffb547', '#7dff9b'];
export function neon(net: Net, c: Ctx): Hit[] {
  const { g, W, H, t } = c;
  g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
  const r = rng(11);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(80,180,255,${r() * 0.25})`; g.fillRect(r() * W, r() * H, 1.2, 1.2); }
  const { pos } = layout(net, W, H, { l: 150, r: 150, top: 50, bot: 50, stageGap: 26, jitter: 0.9, seed: 5 });
  g.globalCompositeOperation = 'lighter';
  for (const [a, b] of wires(net, 2, 9)) {
    const p = pos.get(a.part)!, q = pos.get(b.part)!, heat = (a.fire + b.fire) / 2;
    g.strokeStyle = a.hot && b.hot ? 'rgba(255,70,60,0.30)' : `rgba(41,180,255,${0.04 + heat * 0.18})`;
    g.lineWidth = a.hot && b.hot ? 0.9 : 0.7;
    g.beginPath(); g.moveTo(p.x, p.y); const mx = (p.x + q.x) / 2;
    g.bezierCurveTo(mx, p.y + (q.y - p.y) * 0.1, mx, q.y - (q.y - p.y) * 0.1, q.x, q.y); g.stroke();
    if (a.hot) { const k = ((t / 1600 + (a.part % 17) / 17) % 1); g.fillStyle = 'rgba(255,90,80,0.9)'; g.beginPath(); g.arc(lerp(p.x, q.x, k), lerp(p.y, q.y, k * k * (3 - 2 * k)), 1.6, 0, 7); g.fill(); }
  }
  const ip = pos.get(net.input.part)!, op = pos.get(net.output.part)!;
  for (const n of net.layers[0]) { const p = pos.get(n.part)!; g.strokeStyle = 'rgba(41,231,255,0.10)'; g.beginPath(); g.moveTo(ip.x, ip.y); g.lineTo(p.x, p.y); g.stroke(); }
  for (const n of net.layers[27]) { const p = pos.get(n.part)!; g.strokeStyle = 'rgba(125,255,155,0.10)'; g.beginPath(); g.moveTo(p.x, p.y); g.lineTo(op.x, op.y); g.stroke(); }
  const hits: Hit[] = [];
  for (const n of net.nodes) {
    const p = pos.get(n.part)!, col = NEON[n.stage], big = n.kind === 'embedding' || n.kind === 'unembedding';
    const rad = big ? 9 : n.kind === 'head' ? 3.6 : 3;
    if (n.hot) { const gr = g.createRadialGradient(p.x, p.y, 0, p.x, p.y, rad * 3.2); gr.addColorStop(0, 'rgba(255,60,60,0.4)'); gr.addColorStop(1, 'rgba(255,60,60,0)'); g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, rad * 3.2, 0, 7); g.fill(); }
    g.strokeStyle = col; g.lineWidth = 1; g.globalAlpha = n.sold > 0 ? 1 : 0.45;
    g.beginPath(); g.arc(p.x, p.y, rad, 0, 7); g.stroke();
    if (n.sold > 0) { g.fillStyle = col; g.shadowColor = col; g.shadowBlur = 10; g.beginPath(); g.moveTo(p.x, p.y); g.arc(p.x, p.y, rad * 0.75, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, n.sold)); g.fill(); g.shadowBlur = 0; }
    if (n.mine) { g.strokeStyle = '#fff'; g.lineWidth = 1.2; g.beginPath(); g.arc(p.x, p.y, rad + 3.5, 0, 7); g.stroke(); }
    g.globalAlpha = 1; hits.push({ x: p.x, y: p.y, r: rad + 3, n });
  }
  g.globalCompositeOperation = 'source-over';
  g.font = '11px "JetBrains Mono", monospace'; g.textAlign = 'center';
  g.fillStyle = '#29e7ff'; g.fillText('text in', ip.x, ip.y + 24); g.fillStyle = '#7dff9b'; g.fillText('words out', op.x, op.y + 24);
  return hits;
}

// ---- anatomy plate
const DASH: number[][] = [[], [1.5, 3], [6, 4], [8, 3, 1.5, 3], [2, 2], [12, 5]];
export function anatomy(net: Net, c: Ctx): Hit[] {
  const { g, W, H } = c;
  g.fillStyle = '#eadbb8'; g.fillRect(0, 0, W, H);
  const r = rng(21);
  for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${r() < 0.5 ? '120,90,40' : '255,250,235'},${r() * 0.08})`; g.fillRect(r() * W, r() * H, r() * 2.5, r() * 2.5); }
  const grd = g.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.7); grd.addColorStop(0, 'rgba(0,0,0,0)'); grd.addColorStop(1, 'rgba(110,70,20,0.25)'); g.fillStyle = grd; g.fillRect(0, 0, W, H);
  const { pos, xOf, colW } = layout(net, W, H, { l: 140, r: 140, top: 80, bot: 70, stageGap: 30, jitter: 0.5, seed: 8 });
  const ink = '#1d150c';
  const wobble = (x1: number, y1: number, x2: number, y2: number, w: number, seed: number) => { const rr = rng(seed); g.lineWidth = w; g.beginPath(); g.moveTo(x1, y1); for (let s = 1; s <= 6; s++) { const k = s / 6; g.lineTo(lerp(x1, x2, k) + (rr() - 0.5) * 3, lerp(y1, y2, k) + (rr() - 0.5) * 3); } g.stroke(); };
  g.strokeStyle = ink;
  wires(net, 2, 4).forEach(([a, b], i) => { const p = pos.get(a.part)!, q = pos.get(b.part)!; g.globalAlpha = 0.10 + a.fire * 0.35; wobble(p.x, p.y, q.x, q.y, 0.5 + a.fire * 0.9, i); });
  g.globalAlpha = 1;
  const letters = ['A', 'B', 'C', 'D', 'E', 'F'], starts = [0, 4, 8, 14, 20, 25], ends = [3, 7, 13, 19, 24, 27];
  g.font = 'italic 600 22px Georgia, serif'; g.textAlign = 'center';
  starts.forEach((s, i) => { const x1 = xOf(s) - colW * 0.4, x2 = xOf(ends[i]) + colW * 0.4; g.setLineDash(DASH[i]); g.lineWidth = 1.3; g.strokeStyle = ink; g.beginPath(); g.moveTo(x1, 58); g.lineTo(x2, 58); g.stroke(); g.setLineDash([]); g.fillStyle = ink; g.fillText(letters[i], (x1 + x2) / 2, 46); });
  const hits: Hit[] = [];
  const ip = pos.get(net.input.part)!, op = pos.get(net.output.part)!;
  for (const n of net.nodes) {
    const p = pos.get(n.part)!, big = n.kind === 'embedding' || n.kind === 'unembedding';
    const rx = big ? 11 : n.kind === 'head' ? 3.4 : 2.8, ry = rx * 1.6;
    if (n.hot) { const rr = rng(n.part); g.strokeStyle = ink; for (let k = 0; k < 4; k++) { const a = rr() * 6.3; wobble(p.x, p.y, p.x + Math.cos(a) * 12, p.y + Math.sin(a) * 12, 0.6, n.part * 7 + k); } }
    g.save(); g.translate(p.x, p.y); g.rotate(-0.25);
    g.setLineDash(DASH[n.stage]); g.lineWidth = 1; g.strokeStyle = n.mine ? '#5b3fa0' : ink;
    g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 7);
    if (n.sold >= 1) { g.fillStyle = n.mine ? '#5b3fa0' : ink; g.fill(); }
    else if (n.sold > 0) { g.save(); g.clip(); g.lineWidth = 0.6; for (let k = -ry; k < ry; k += 2) { g.beginPath(); g.moveTo(-rx, k); g.lineTo(rx, k + rx); g.stroke(); } g.restore(); }
    g.stroke(); g.setLineDash([]);
    if (n.mine) { g.lineWidth = 1.4; g.beginPath(); g.ellipse(0, 0, rx + 3, ry + 3, 0, 0, 7); g.stroke(); }
    g.restore(); hits.push({ x: p.x, y: p.y, r: ry + 2, n });
  }
  g.font = 'italic 15px Georgia, serif'; g.fillStyle = ink; g.textAlign = 'center';
  g.fillText('text in', ip.x, ip.y + 36); g.fillText('words out', op.x, op.y + 36);
  g.font = 'italic 14px Georgia, serif';
  g.fillText('fig. 1. the brain of neurals, twenty eight layers, one thousand three hundred and eighteen parts', W / 2, H - 26);
  g.save(); g.translate(W - 120, H - 92); g.rotate(-0.3); g.strokeStyle = 'rgba(91,63,160,0.75)'; g.fillStyle = 'rgba(91,63,160,0.75)'; g.lineWidth = 2;
  g.beginPath(); g.arc(0, 0, 36, 0, 7); g.stroke(); g.lineWidth = 1; g.beginPath(); g.arc(0, 0, 30, 0, 7); g.stroke();
  g.font = '700 15px Georgia, serif'; g.textAlign = 'center'; g.fillText('2026', 0, 6); g.font = '8px Georgia, serif'; g.fillText('neurals', 0, -14); g.fillText('solana', 0, 22); g.restore();
  return hits;
}

// ---- retro computer
export const VGA = ['#0000aa', '#00aa00', '#00aaaa', '#aa0000', '#aa00aa', '#aa5500'];
export function retro(net: Net, c: Ctx): Hit[] {
  const { g, W, H, t } = c;
  g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#c0c0c0'; g.lineWidth = 1;
  for (let x = 0.5; x < W; x += 16) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  for (let y = 0.5; y < H; y += 16) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const { pos } = layout(net, W, H, { l: 110, r: 110, top: 40, bot: 40, stageGap: 20 });
  const snap = (v: number) => Math.round(v) + 0.5;
  wires(net, 1, 2).forEach(([a, b]) => {
    const p = pos.get(a.part)!, q = pos.get(b.part)!;
    g.strokeStyle = a.hot && b.hot ? '#ff0000' : '#808080'; g.globalAlpha = a.hot && b.hot ? 1 : 0.35;
    const mx = snap((p.x + q.x) / 2); g.beginPath(); g.moveTo(snap(p.x), snap(p.y)); g.lineTo(mx, snap(p.y)); g.lineTo(mx, snap(q.y)); g.lineTo(snap(q.x), snap(q.y)); g.stroke();
  });
  g.globalAlpha = 1;
  const hits: Hit[] = [], blink = Math.floor(t / 500) % 2 === 0;
  for (const n of net.nodes) {
    const p = pos.get(n.part)!, x = Math.round(p.x), y = Math.round(p.y), big = n.kind === 'embedding' || n.kind === 'unembedding', s = big ? 18 : 6, col = VGA[n.stage];
    if (n.hot && blink) { g.fillStyle = '#ffff00'; g.fillRect(x - s / 2 - 2, y - s / 2 - 2, s + 4, s + 4); }
    g.fillStyle = '#fff'; g.fillRect(x - s / 2, y - s / 2, s, s);
    g.strokeStyle = col; g.strokeRect(x - s / 2 + 0.5, y - s / 2 + 0.5, s - 1, s - 1);
    if (n.sold > 0) { g.fillStyle = col; const h = n.sold >= 1 ? s : Math.max(2, Math.round(s * n.sold)); g.fillRect(x - s / 2, y + s / 2 - h, s, h); }
    if (n.mine) { g.strokeStyle = '#000'; g.setLineDash([2, 2]); g.strokeRect(x - s / 2 - 2.5, y - s / 2 - 2.5, s + 5, s + 5); g.setLineDash([]); }
    hits.push({ x, y, r: s, n });
  }
  const ip = pos.get(net.input.part)!, op = pos.get(net.output.part)!;
  g.font = '16px "VT323", monospace'; g.fillStyle = '#000'; g.textAlign = 'center';
  g.fillText('text in', ip.x, ip.y + 26); g.fillText('words out', op.x, op.y + 26);
  return hits;
}

// ---- layered plates
const PLANE = ['#2bb3a4', '#3a7bd5', '#57c26b', '#f2c440', '#f08a3c', '#e2483d'];
export function plates(net: Net, c: Ctx): Hit[] {
  const { g, W, H, mx, my } = c;
  const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#f4f6f8'); bg.addColorStop(1, '#cdd5dd'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
  const yaw = -0.62 + (mx / W - 0.5) * 0.5, pitch = 0.32 + (my / H - 0.5) * 0.25;
  const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch), D = 34, S = 13, F = 900;
  const proj = (X: number, Y: number, Z: number) => { const x1 = X * cy - Z * sy, z1 = X * sy + Z * cy, y2 = Y * cp - z1 * sp, z2 = Y * sp + z1 * cp, k = F / (F + z2 + 520); return { x: x1 * k, y: y2 * k, z: z2 }; };
  const shade = (hex: string, a: number) => { const n = parseInt(hex.slice(1), 16); const f = (v: number) => Math.round(lerp(255, v, a)); return `rgb(${f(n >> 16)},${f((n >> 8) & 255)},${f(n & 255)})`; };
  type Quad = { z: number; pts: { x: number; y: number }[]; fill: string; stroke: string; lw: number; n?: Node };
  const quads: Quad[] = [];
  for (let l = 0; l < 28; l++) {
    const X = (l - 13.5) * D, st = net.layers[l][0].stage, e = 3.6 * S;
    const corner = (yy: number, zz: number) => proj(X, yy, zz);
    quads.push({ z: proj(X, 0, 0).z + 0.5, pts: [corner(-e, -e), corner(-e, e), corner(e, e), corner(e, -e)], fill: 'rgba(255,255,255,0.55)', stroke: shade(PLANE[st], 1), lw: 1.2 });
    net.layers[l].forEach((n, i) => {
      const r = Math.floor(i / 7), cc = i % 7, y0 = (r - 3.5) * S + 1, z0 = (cc - 3.5) * S + 1, s = S - 2;
      quads.push({ z: proj(X, y0 + s / 2, z0 + s / 2).z, pts: [corner(y0, z0), corner(y0, z0 + s), corner(y0 + s, z0 + s), corner(y0 + s, z0)],
        fill: n.sold <= 0 ? shade(PLANE[st], 0.18) : shade(PLANE[st], 0.45 + 0.55 * Math.min(1, n.sold)), stroke: n.mine ? '#111' : n.hot ? '#e2483d' : 'rgba(0,0,0,0.12)', lw: n.mine ? 2 : n.hot ? 1.6 : 0.6, n });
    });
  }
  let x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
  for (const q of quads) for (const p of q.pts) { x1 = Math.min(x1, p.x); y1 = Math.min(y1, p.y); x2 = Math.max(x2, p.x); y2 = Math.max(y2, p.y); }
  const fit = Math.min((W - 320) / (x2 - x1), (H - 110) / (y2 - y1)), ox = W / 2 - ((x1 + x2) / 2) * fit, oy = H / 2 - 10 - ((y1 + y2) / 2) * fit;
  const T = (p: { x: number; y: number }) => ({ x: p.x * fit + ox, y: p.y * fit + oy });
  quads.forEach((q) => (q.pts = q.pts.map(T)));
  const byPlane = new Map<number, Quad[]>();
  quads.forEach((q, i) => { const k = Math.floor(i / 48); (byPlane.get(k) ?? byPlane.set(k, []).get(k)!).push(q); });
  const hits: Hit[] = [];
  for (const pl of [...byPlane.values()].sort((a, b) => b[0].z - a[0].z)) for (const q of pl) {
    g.beginPath(); q.pts.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
    g.fillStyle = q.fill; g.fill(); g.strokeStyle = q.stroke; g.lineWidth = q.lw; g.stroke();
    if (q.n) hits.push({ x: (q.pts[0].x + q.pts[2].x) / 2, y: (q.pts[0].y + q.pts[2].y) / 2, r: 6, n: q.n });
  }
  const a = T(proj(-15.5 * D, 0, 0)), b = T(proj(15.5 * D, 0, 0));
  g.strokeStyle = '#2f8f4e'; g.lineWidth = 2; g.beginPath();
  for (let k = 0; k <= 60; k++) { const x = a.x - 90 + k * 1.3, y = a.y + Math.sin(k / 3.2) * 9 * Math.exp(-(((k - 30) / 18) ** 2)); k ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
  g.font = '500 14px Inter, sans-serif'; g.fillStyle = '#25303b'; g.textAlign = 'center';
  g.fillText('text in', a.x - 50, a.y + 34); g.fillText('words out', b.x + 50, b.y + 34);
  g.fillStyle = net.output.sold > 0 ? '#e2483d' : '#fff'; g.strokeStyle = '#25303b'; g.lineWidth = 1.5; g.beginPath(); g.arc(b.x + 50, b.y, 12, 0, 7); g.fill(); g.stroke();
  return hits;
}

// ---- what each stage sees
const tileCache = new Map<string, HTMLCanvasElement>();
function hsl(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360 / 360; s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s, p = 2 * l - q;
  const f = (t: number) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 0.5 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255];
}
function texture(stage: number, size: number): HTMLCanvasElement {
  const key = `${stage}:${size}`; if (tileCache.has(key)) return tileCache.get(key)!;
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!, img = g.createImageData(size, size), d = img.data, r = rng(100 + stage), ph = Array.from({ length: 8 }, () => r() * 6.28);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 6.28, v = y / size * 6.28; let f = 0;
    if (stage === 0) f = Math.sin(u * 7 + ph[0]) * Math.sin(v * 7 + ph[1]) + 0.4 * Math.sin((u + v) * 11);
    if (stage === 1) f = Math.sin(u * 9 + Math.sin(v * 5 + ph[2]) * 2.2);
    if (stage === 2) { const a = Math.sin(u * 8 + ph[3]) * Math.cos(v * 8 + ph[4]); f = Math.sign(a) * Math.abs(a) ** 0.4; }
    if (stage === 3) f = Math.sin(u * 4 + Math.sin(v * 6 + Math.sin(u * 3)) * 3 + ph[5]);
    if (stage === 4) f = Math.sin(Math.hypot(u - 3.1, v - 3.1) * 7 + Math.atan2(v - 3.1, u - 3.1) * 3);
    if (stage === 5) f = Math.sin(u * 5 + ph[6]) + Math.sin(v * 13 + Math.sin(u * 2) * 4);
    const [R, G, B] = hsl((f * 140 + x * 0.6 + y * 0.4 + stage * 55) % 360, 0.55 + 0.25 * Math.sin(f * 3), 0.5 + 0.18 * f);
    const i = (y * size + x) * 4; d[i] = R; d[i + 1] = G; d[i + 2] = B; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0); tileCache.set(key, cv); return cv;
}
const RANGES = [[0, 3], [4, 7], [8, 13], [14, 19], [20, 24], [25, 27]];
export function features(net: Net, c: Ctx): Hit[] {
  const { g, W, H } = c;
  g.fillStyle = '#fbfbf9'; g.fillRect(0, 0, W, H);
  const side = Math.min((W - 300) / 3 - 60, (H - 110) / 2 - 44), gapX = (W - 300 - 3 * side) / 2, rowY = [54, 54 + side + 74];
  const spot = (s: number) => ({ x: 150 + (s % 3) * (side + gapX), y: rowY[Math.floor(s / 3)] + 34 });
  const hits: Hit[] = [];
  for (let s = 0; s < 5; s++) {
    const A = spot(s), B = spot(s + 1), rr = rng(s);
    for (let k = 0; k < 28; k++) {
      g.strokeStyle = `hsla(${(s * 55 + k * 9) % 360},70%,45%,0.32)`; g.lineWidth = 0.8; g.beginPath();
      if (s === 2) { const x1 = A.x + rr() * side, x2 = B.x + rr() * side; g.moveTo(x1, A.y + side); g.bezierCurveTo(x1, A.y + side + 60, x2, B.y - 60, x2, B.y); }
      else { const y1 = A.y + rr() * side, y2 = B.y + rr() * side; g.moveTo(A.x + side, y1); g.bezierCurveTo((A.x + side + B.x) / 2, y1, (A.x + side + B.x) / 2, y2, B.x, y2); }
      g.stroke();
    }
  }
  RANGES.forEach(([from, to], s) => {
    const { x, y } = spot(s);
    g.save(); g.shadowColor = 'rgba(0,0,0,0.18)'; g.shadowBlur = 14; g.shadowOffsetY = 4; g.drawImage(texture(s, Math.round(side * 1.5)), x, y, side, side); g.restore();
    const nodes = net.nodes.filter((n) => n.layer !== null && n.layer >= from && n.layer <= to), cols = Math.ceil(Math.sqrt(nodes.length)), cell = side / cols;
    nodes.forEach((n, i) => {
      const px = x + (i % cols + 0.5) * cell, py = y + (Math.floor(i / cols) + 0.5) * cell, rad = Math.max(1.8, cell * 0.3);
      if (n.hot) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.arc(px, py, rad * 2, 0, 7); g.fill(); }
      g.lineWidth = 1; g.strokeStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.arc(px, py, rad, 0, 7);
      if (n.sold > 0) { g.fillStyle = n.mine ? '#111' : '#fff'; g.fill(); }
      g.stroke(); hits.push({ x: px, y: py, r: rad + 2, n });
    });
    g.font = '15px Inter, sans-serif'; g.fillStyle = '#222'; g.textAlign = 'left';
    g.fillText(['tokenizer', 'syntax', 'semantic', 'memory', 'reasoning', 'prediction'][s], x, y - 22);
    g.font = '12px Inter, sans-serif'; g.fillStyle = '#777'; g.fillText(`layers ${from} to ${to}`, x, y - 7);
  });
  const a = spot(0), z = spot(5);
  g.font = '15px Inter, sans-serif'; g.fillStyle = '#222'; g.textAlign = 'center';
  g.fillText('text in', 70, a.y + side / 2 + 5); g.fillText('words out', W - 70, z.y + side / 2 + 5);
  g.strokeStyle = '#222'; g.lineWidth = 1.2;
  g.beginPath(); g.moveTo(104, a.y + side / 2); g.lineTo(a.x - 8, a.y + side / 2); g.stroke();
  g.beginPath(); g.moveTo(z.x + side + 8, z.y + side / 2); g.lineTo(W - 112, z.y + side / 2); g.stroke();
  return hits;
}
