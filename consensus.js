const STORAGE_KEY = "receiptScannerReadings";

export function loadStoredReadings() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveStoredReadings(readings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(readings));
}

export function makeStoredReading(currentBestOcrResult, currentOverlayData) {
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()),
    timestamp: new Date().toISOString(),
    variant: currentBestOcrResult.name,
    values: currentOverlayData.values.map(v => ({
      value: v.value,
      confidence: v.confidence,
      bbox: v.bbox,
      cx: (v.bbox.x0 + v.bbox.x1) / 2 / currentOverlayData.sourceWidth,
      cy: (v.bbox.y0 + v.bbox.y1) / 2 / currentOverlayData.sourceHeight
    })),
    itemSum: currentBestOcrResult.parsed.itemSum,
    subtotal: currentBestOcrResult.parsed.subtotal,
    reconciles: currentBestOcrResult.parsed.reconciles
  };
}

export function clusterStoredValues(readings) {
  const clusters = [];
  const maxDistance = 0.035;
  for (const reading of readings) {
    for (const obs of reading.values || []) {
      let best = null, bestD = Infinity;
      for (const cluster of clusters) {
        const d = Math.hypot(obs.cx - cluster.cx, obs.cy - cluster.cy);
        if (d < bestD && d <= maxDistance) { best = cluster; bestD = d; }
      }
      if (!best) {
        best = { cx: obs.cx, cy: obs.cy, observations: [] };
        clusters.push(best);
      }
      best.observations.push({ value: obs.value, confidence: obs.confidence || 0, readingId: reading.id });
      const n = best.observations.length;
      best.cx = ((best.cx * (n - 1)) + obs.cx) / n;
      best.cy = ((best.cy * (n - 1)) + obs.cy) / n;
    }
  }
  for (const cluster of clusters) {
    cluster.distinctValues = [...new Set(cluster.observations.map(o => Number(o.value).toFixed(2)))].map(Number).sort((a, b) => a - b);
  }
  clusters.sort((a, b) => a.cy - b.cy || a.cx - b.cx);
  return clusters;
}

export function chooseConsensus(observations) {
  const totals = new Map();
  for (const obs of observations) {
    const key = Number(obs.value).toFixed(2);
    const weight = Math.max(1, obs.confidence || 0);
    const current = totals.get(key) || { value: Number(obs.value), weight: 0, count: 0 };
    current.weight += weight;
    current.count += 1;
    totals.set(key, current);
  }
  return [...totals.values()].sort((a, b) => b.count - a.count || b.weight - a.weight)[0];
}
