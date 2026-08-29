export async function buildOcrReadyVariantsFromSelection(selection, debug) {
  if (!selection.length) throw new Error("No selected image candidates.");

  // The selection is already sorted by OCR-usefulness score.
  // We process only the best single image. Other candidates remain debug/evidence only.
  const bestItem = selection[0];
  const bitmap = await createImageBitmap(bestItem.blob);
  const bestCrop = cropAndNormalize(bitmap, bestItem.quality.cropRectNorm, {
    targetWidth: 2000,
    marginRatio: 0.025
  });

  debug?.log("Best single image normalized", {
    attempt: bestItem.attempt,
    width: bestCrop.width,
    height: bestCrop.height,
    qualityScore: round3(bestItem.quality.qualityScore),
    textSharpness: round3(bestItem.quality.textSharpness),
    worstTileSharpness: round3(bestItem.quality.worstTileSharpness)
  });

  const variants = [];

  variants.push({
    id: "best-color",
    name: "Best image · cropped color",
    canvas: cloneCanvas(bestCrop),
    group: "best",
    primary: true
  });

  const gray = cloneCanvas(bestCrop);
  applyGrayscaleContrast(gray, 1.35);
  variants.push({
    id: "best-gray",
    name: "Best image · grayscale contrast",
    canvas: gray,
    group: "best",
    ocrPreferred: true
  });

  const strongerGray = cloneCanvas(bestCrop);
  applyGrayscaleContrast(strongerGray, 1.65);
  variants.push({
    id: "best-strong-gray",
    name: "Best image · stronger contrast",
    canvas: strongerGray,
    group: "best",
    ocrPreferred: true
  });

  const sharp = cloneCanvas(gray);
  applyUnsharpMask(sharp, 0.75);
  variants.push({
    id: "best-sharp",
    name: "Best image · sharpened",
    canvas: sharp,
    group: "best",
    displayPreferred: true,
    ocrPreferred: true
  });

  const threshold = cloneCanvas(bestCrop);
  applyAdaptiveLikeThreshold(threshold);
  variants.push({
    id: "best-threshold",
    name: "Best image · local threshold",
    canvas: threshold,
    group: "best",
    ocrPreferred: true
  });

  // Keep thumbnails of the runners-up for comparison/debug only.
  const normalizedFrames = [{ id: "best", name: "Best selected image", canvas: bestCrop, quality: bestItem.quality, attempt: bestItem.attempt }];

  for (let i = 1; i < selection.length; i++) {
    const item = selection[i];
    const otherBitmap = await createImageBitmap(item.blob);
    const crop = cropAndNormalize(otherBitmap, item.quality.cropRectNorm, {
      targetWidth: 1200,
      marginRatio: 0.025
    });
    normalizedFrames.push({
      id: `runner-${i}`,
      name: `Runner-up ${i}`,
      canvas: crop,
      quality: item.quality,
      attempt: item.attempt
    });

    variants.push({
      id: `runner-${i}-color`,
      name: `Runner-up ${i} · cropped color`,
      canvas: cloneCanvas(crop),
      group: "debug"
    });
  }

  return {
    normalizedFrames,
    variants,
    displayCanvas: sharp,
    ocrVariants: variants.filter(v => v.group === "best"),
    strategy: "single-best-frame-tile-quality"
  };
}

// Kept for compatibility with older calls.
export function makeProcessingVariants(bitmap) {
  const base = cropAndNormalize(bitmap, null, { targetWidth: 1800, marginRatio: 0 });
  const original = cloneCanvas(base);

  const grayscale = cloneCanvas(base);
  applyGrayscaleContrast(grayscale, 1.35);

  const threshold = cloneCanvas(base);
  applyAdaptiveLikeThreshold(threshold);

  return [
    { id: "original", name: "Original", canvas: original },
    { id: "grayscale", name: "Grayscale + contrast", canvas: grayscale },
    { id: "threshold", name: "Local threshold", canvas: threshold }
  ];
}

function cropAndNormalize(bitmap, cropRectNorm, options) {
  const marginRatio = options.marginRatio ?? 0.03;
  let sx = 0, sy = 0, sw = bitmap.width, sh = bitmap.height;

  if (cropRectNorm) {
    const x0 = clamp(cropRectNorm.x0 - marginRatio, 0, 1);
    const y0 = clamp(cropRectNorm.y0 - marginRatio, 0, 1);
    const x1 = clamp(cropRectNorm.x1 + marginRatio, 0, 1);
    const y1 = clamp(cropRectNorm.y1 + marginRatio, 0, 1);
    sx = Math.round(x0 * bitmap.width);
    sy = Math.round(y0 * bitmap.height);
    sw = Math.max(1, Math.round((x1 - x0) * bitmap.width));
    sh = Math.max(1, Math.round((y1 - y0) * bitmap.height));
  }

  const targetWidth = Math.min(options.targetWidth ?? 2000, sw);
  const scale = targetWidth / sw;
  const width = Math.max(1, Math.round(sw * scale));
  const height = Math.max(1, Math.round(sh * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, sx, sy, sw, sh, 0, 0, width, height);
  return canvas;
}

function cloneCanvas(source) {
  const c = document.createElement("canvas");
  c.width = source.width;
  c.height = source.height;
  c.getContext("2d").drawImage(source, 0, 0);
  return c;
}

function applyGrayscaleContrast(canvas, contrast) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    let g = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    g = clamp((g - 128) * contrast + 128, 0, 255);
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
}

function applyUnsharpMask(canvas, amount) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const original = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const blurredCanvas = cloneCanvas(canvas);
  const bctx = blurredCanvas.getContext("2d", { willReadFrequently: true });
  bctx.filter = "blur(1.0px)";
  bctx.drawImage(canvas, 0, 0);
  bctx.filter = "none";
  const blurred = bctx.getImageData(0, 0, canvas.width, canvas.height);
  const od = original.data;
  const bd = blurred.data;

  for (let i = 0; i < od.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      od[i + c] = clamp(od[i + c] + amount * (od[i + c] - bd[i + c]), 0, 255);
    }
  }
  ctx.putImageData(original, 0, 0);
}

function applyAdaptiveLikeThreshold(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  const w = canvas.width, h = canvas.height;
  const gray = new Uint8Array(w * h);

  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    gray[p] = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
  }

  const radius = Math.max(8, Math.round(Math.min(w, h) / 90));
  const integral = new Float64Array((w + 1) * (h + 1));

  for (let y = 1; y <= h; y++) {
    let row = 0;
    for (let x = 1; x <= w; x++) {
      row += gray[(y - 1) * w + (x - 1)];
      integral[y * (w + 1) + x] = integral[(y - 1) * (w + 1) + x] + row;
    }
  }

  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - radius), y1 = Math.min(h - 1, y + radius);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - radius), x1 = Math.min(w - 1, x + radius);
      const A = integral[y0 * (w + 1) + x0];
      const B = integral[y0 * (w + 1) + (x1 + 1)];
      const C = integral[(y1 + 1) * (w + 1) + x0];
      const D = integral[(y1 + 1) * (w + 1) + (x1 + 1)];
      const mean = (D - B - C + A) / ((x1 - x0 + 1) * (y1 - y0 + 1));
      const value = gray[y * w + x] < mean - 11 ? 0 : 255;
      const i = (y * w + x) * 4;
      d[i] = d[i + 1] = d[i + 2] = value;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function round3(value) { return Math.round(Number(value) * 1000) / 1000; }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
