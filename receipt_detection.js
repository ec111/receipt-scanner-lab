export function rgbaToGray(data, w, h) {
  const gray = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    gray[p] = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
  }
  return gray;
}

export function sobelEdges(gray, w, h) {
  const edges = new Uint16Array(w * h);
  let max = 1;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const mag = Math.abs(gx) + Math.abs(gy);
      edges[i] = mag;
      if (mag > max) max = mag;
    }
  }
  return { values: edges, max };
}

export function detectDocumentBounds(gray, edgesObj, w, h) {
  const { values, max } = edgesObj;
  const edgeThreshold = Math.max(80, max * 0.28);
  const colEnergy = new Float32Array(w);
  const rowEnergy = new Float32Array(h);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const e = values[y * w + x];
      if (e > edgeThreshold) {
        colEnergy[x] += e;
        rowEnergy[y] += e;
      }
    }
  }

  smooth(colEnergy, 9);
  smooth(rowEnergy, 9);

  const xBand = dominantBand(colEnergy, 0.12);
  const yBand = dominantBand(rowEnergy, 0.08);

  let left = xBand.start;
  let right = xBand.end;
  let top = yBand.start;
  let bottom = yBand.end;

  if (right - left < w * 0.28 || bottom - top < h * 0.35) {
    left = Math.round(w * 0.16);
    right = Math.round(w * 0.84);
    top = Math.round(h * 0.10);
    bottom = Math.round(h * 0.90);
  }

  const areaRatio = ((right - left) * (bottom - top)) / (w * h);
  const receiptAspect = (bottom - top) / Math.max(1, right - left);
  const aspectScore = clamp(1 - Math.abs(receiptAspect - 1.7) / 1.7, 0, 1);
  const areaScore = clamp((areaRatio - 0.18) / 0.48, 0, 1);
  const interior = meanGray(gray, w, h, left, top, right, bottom);
  const outside = borderMeanGray(gray, w, h, left, top, right, bottom);
  const contrastScore = clamp((interior - outside + 25) / 80, 0, 1);

  const score = 0.45 * areaScore + 0.25 * aspectScore + 0.30 * contrastScore;

  return {
    left, right, top, bottom, score,
    corners: [
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom }
    ]
  };
}

export function computeSharpness(gray, w, h, bounds) {
  let sum = 0, sumSq = 0, count = 0;
  const x0 = clamp(Math.round(bounds.left), 1, w - 2);
  const x1 = clamp(Math.round(bounds.right), 1, w - 2);
  const y0 = clamp(Math.round(bounds.top), 1, h - 2);
  const y1 = clamp(Math.round(bounds.bottom), 1, h - 2);

  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const i = y * w + x;
      const lap = gray[i - w] + gray[i + w] + gray[i - 1] + gray[i + 1] - 4 * gray[i];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (!count) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return clamp(Math.log1p(variance) / 8.2, 0, 1);
}

export function computeGlare(rgba, gray, w, h, bounds) {
  const x0 = clamp(Math.round(bounds.left), 0, w - 1);
  const x1 = clamp(Math.round(bounds.right), 0, w - 1);
  const y0 = clamp(Math.round(bounds.top), 0, h - 1);
  const y1 = clamp(Math.round(bounds.bottom), 0, h - 1);

  let glare = 0, count = 0;
  for (let y = y0; y < y1; y += 2) {
    for (let x = x0; x < x1; x += 2) {
      const p = y * w + x;
      const i = p * 4;
      const r = rgba[i], g = rgba[i + 1], b = rgba[i + 2];
      const maxC = Math.max(r, g, b);
      const minC = Math.min(r, g, b);
      const sat = maxC === 0 ? 0 : (maxC - minC) / maxC;
      const local = localRange(gray, w, h, x, y, 2);
      if (maxC >= 248 && sat < 0.08 && local < 18) glare++;
      count++;
    }
  }
  return count ? glare / count : 1;
}

function localRange(gray, w, h, cx, cy, r) {
  let mn = 255, mx = 0;
  for (let y = Math.max(0, cy - r); y <= Math.min(h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(w - 1, cx + r); x++) {
      const v = gray[y * w + x];
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  }
  return mx - mn;
}

function dominantBand(values, relativeThreshold) {
  let max = 0;
  for (const v of values) max = Math.max(max, v);
  const threshold = max * relativeThreshold;
  let start = 0, end = values.length - 1;
  for (let i = 0; i < values.length; i++) if (values[i] >= threshold) { start = i; break; }
  for (let i = values.length - 1; i >= 0; i--) if (values[i] >= threshold) { end = i; break; }
  return { start, end };
}

function meanGray(gray, w, h, left, top, right, bottom) {
  let sum = 0, count = 0;
  for (let y = top; y < bottom; y += 4) {
    for (let x = left; x < right; x += 4) {
      sum += gray[y * w + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}
function borderMeanGray(gray, w, h, left, top, right, bottom) {
  let sum = 0, count = 0;
  const m = 10;
  for (let x = left; x <= right; x += 4) {
    for (const y of [Math.max(0, top - m), Math.min(h - 1, bottom + m)]) {
      sum += gray[y * w + x];
      count++;
    }
  }
  for (let y = top; y <= bottom; y += 4) {
    for (const x of [Math.max(0, left - m), Math.min(w - 1, right + m)]) {
      sum += gray[y * w + x];
      count++;
    }
  }
  return count ? sum / count : 0;
}
function smooth(arr, radius) {
  const copy = Float32Array.from(arr);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - radius); j <= Math.min(arr.length - 1, i + radius); j++) {
      sum += copy[j];
      count++;
    }
    arr[i] = sum / count;
  }
}
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
