const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const iconPath = path.join(__dirname, '..', 'icon.png');
const data = fs.readFileSync(iconPath);
const png = PNG.sync.read(data);
const W = png.width;
const H = png.height;

// First, get the transparent background using the flood fill we already proved works outside
function isCheckerPixel(x, y) {
  const idx = (W * y + x) << 2;
  const r = png.data[idx];
  const g = png.data[idx + 1];
  const b = png.data[idx + 2];

  if (Math.abs(r - g) > 6 || Math.abs(g - b) > 6 || Math.abs(r - b) > 6) {
    return false;
  }

  const parity = (Math.floor(x / 32) + Math.floor(y / 32)) % 2;
  if (parity === 1) {
    return r >= 238;
  } else {
    return r >= 212 && r <= 236;
  }
}

const isBg = new Uint8Array(W * H);
const queue = [];

for (let x = 0; x < W; x++) {
  if (isCheckerPixel(x, 0)) { queue.push(x, 0); isBg[0 * W + x] = 1; }
  if (isCheckerPixel(x, H - 1)) { queue.push(x, H - 1); isBg[(H - 1) * W + x] = 1; }
}
for (let y = 0; y < H; y++) {
  if (isCheckerPixel(0, y) && !isBg[y * W + 0]) { queue.push(0, y); isBg[y * W + 0] = 1; }
  if (isCheckerPixel(W - 1, y) && !isBg[y * W + (W - 1)]) { queue.push(W - 1, y); isBg[y * W + (W - 1)] = 1; }
}

let head = 0;
while (head < queue.length) {
  const cx = queue[head++];
  const cy = queue[head++];

  const neighbors = [
    [cx + 1, cy], [cx - 1, cy],
    [cx, cy + 1], [cx, cy - 1]
  ];

  for (const [nx, ny] of neighbors) {
    if (nx >= 0 && nx < W && ny >= 0 && ny < H) {
      const nIdx = ny * W + nx;
      if (!isBg[nIdx] && isCheckerPixel(nx, ny)) {
        isBg[nIdx] = 1;
        queue.push(nx, ny);
      }
    }
  }
}

// Now: For any pixel that is inside the train cabin:
// Where is the cabin?
// y between 250 and 600, x between 120 and 962.
// In the original, the gray squares were: R ~ 222-226.
// The cabin color should be uniform clean light gray/white (#EBEBEB: 235, 235, 235).
// Let's create the output image!
const outPng = new PNG({ width: W, height: H });

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const idx = y * W + x;
    const pIdx = idx << 2;

    if (isBg[idx]) {
      // Outside background -> completely transparent!
      outPng.data[pIdx] = 0;
      outPng.data[pIdx + 1] = 0;
      outPng.data[pIdx + 2] = 0;
      outPng.data[pIdx + 3] = 0;
    } else {
      const r = png.data[pIdx];
      const g = png.data[pIdx + 1];
      const b = png.data[pIdx + 2];
      const isGray = Math.abs(r - g) <= 8 && Math.abs(g - b) <= 8 && Math.abs(r - b) <= 8;

      // If it's a cabin body pixel (grayscale and y < 600 and r >= 210)
      if (isGray && y >= 250 && y <= 600 && x >= 120 && x <= 962 && r >= 200) {
        // Solid clean train body color!
        outPng.data[pIdx] = 236;
        outPng.data[pIdx + 1] = 238;
        outPng.data[pIdx + 2] = 240;
        outPng.data[pIdx + 3] = 255;
      } else {
        // Keep original color (blue windows, orange light, blue stripes, bridge, etc.)
        outPng.data[pIdx] = r;
        outPng.data[pIdx + 1] = g;
        outPng.data[pIdx + 2] = b;
        outPng.data[pIdx + 3] = 255;
      }
    }
  }
}

const outBuffer = PNG.sync.write(outPng);
fs.writeFileSync(path.join(__dirname, '..', 'icon_transparent.png'), outBuffer);
console.log('Regenerated icon_transparent.png successfully!');
