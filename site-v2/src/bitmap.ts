// Bitmap textures in the poster's colours, made in the browser: smooth noise, quantised to the
// palette, drawn at low resolution and scaled up so the pixels show.
const PAL = ['#212321', '#2666d6', '#e2471f', '#ffe20a', '#e5e1d8'];
function noise(seed: number) {
  const r = (x: number, y: number) => { const s = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453; return s - Math.floor(s); };
  const sm = (t: number) => t * t * (3 - 2 * t);
  return (x: number, y: number) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const a = r(xi, yi), b = r(xi + 1, yi), c = r(xi, yi + 1), d = r(xi + 1, yi + 1);
    return a + (b - a) * sm(xf) + (c - a) * sm(yf) + (a - b - c + d) * sm(xf) * sm(yf);
  };
}
function tile(seed: number, order: number[], size = 72) {
  const cv = document.createElement('canvas'); cv.width = cv.height = size;
  const g = cv.getContext('2d')!, n = noise(seed);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / size * 6, v = y / size * 6;
    let f = n(u, v) * 0.6 + n(u * 2.3, v * 2.3) * 0.3 + n(u * 5, v * 5) * 0.1;
    f = Math.abs(Math.sin(f * 9)); // contour like bands, as in the pack
    g.fillStyle = PAL[order[Math.min(order.length - 1, Math.floor(f * order.length))]];
    g.fillRect(x, y, 1, 1);
  }
  return cv.toDataURL();
}
export function makeBitmaps() {
  const s = document.documentElement.style;
  s.setProperty('--bm1', `url(${tile(1, [0, 2, 0, 3, 4])})`);
  s.setProperty('--bm2', `url(${tile(2, [0, 1, 4, 1, 3])})`);
  s.setProperty('--bm3', `url(${tile(3, [4, 2, 0, 3, 2])})`);
  s.setProperty('--bm4', `url(${tile(4, [1, 0, 3, 0, 4])})`);
}
