export function drawPreviewOverlay(canvas, bounds, analysisW, analysisH, ready) {
  const ctx = canvas.getContext("2d");
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rect.width * devicePixelRatio));
  canvas.height = Math.max(1, Math.round(rect.height * devicePixelRatio));

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!bounds) return;

  const sx = canvas.width / analysisW;
  const sy = canvas.height / analysisH;

  ctx.save();
  ctx.lineWidth = Math.max(3, 4 * devicePixelRatio);
  ctx.strokeStyle = ready ? "#22c55e" : "#f59e0b";
  ctx.fillStyle = ready ? "rgba(34,197,94,0.08)" : "rgba(245,158,11,0.07)";
  ctx.beginPath();
  bounds.corners.forEach((p, i) => {
    const x = p.x * sx, y = p.y * sy;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawResultOverlay(canvas, imgEl, overlayData, enabled, moneyFormatter) {
  const rect = imgEl.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  canvas.width = Math.round(rect.width * devicePixelRatio);
  canvas.height = Math.round(rect.height * devicePixelRatio);
  canvas.style.width = `${rect.width}px`;
  canvas.style.height = `${rect.height}px`;

  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (!enabled || !overlayData?.values?.length) return;

  const sx = canvas.width / overlayData.sourceWidth;
  const sy = canvas.height / overlayData.sourceHeight;

  ctx.save();
  ctx.font = `${Math.max(12, 13 * devicePixelRatio)}px ui-monospace, monospace`;
  ctx.textBaseline = "bottom";
  ctx.lineWidth = Math.max(2, 2 * devicePixelRatio);

  for (const item of overlayData.values) {
    const x = item.bbox.x0 * sx;
    const y = item.bbox.y0 * sy;
    const w = Math.max(18 * devicePixelRatio, (item.bbox.x1 - item.bbox.x0) * sx);
    const h = Math.max(14 * devicePixelRatio, (item.bbox.y1 - item.bbox.y0) * sy);
    const label = `${moneyFormatter(item.value)}${item.confidence ? ` ${Math.round(item.confidence)}%` : ""}`;
    const pad = 4 * devicePixelRatio;
    const labelH = 18 * devicePixelRatio;
    const textWidth = ctx.measureText(label).width;

    ctx.strokeStyle = "rgba(34,197,94,0.95)";
    ctx.fillStyle = "rgba(34,197,94,0.14)";
    ctx.strokeRect(x, y, w, h);
    ctx.fillRect(x, y, w, h);

    const labelY = Math.max(labelH, y);
    ctx.fillStyle = "rgba(2,6,23,0.9)";
    ctx.fillRect(x, labelY - labelH, textWidth + pad * 2, labelH);

    ctx.fillStyle = "#f8fafc";
    ctx.fillText(label, x + pad, labelY - 2 * devicePixelRatio);
  }
  ctx.restore();
}
