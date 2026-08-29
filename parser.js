export function parseReceiptText(text) {
  const rawLines = text
    .split(/\r?\n/)
    .map(line => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const subtotalIndex = rawLines.findIndex(line => /\bSUB[\s-]?TOTAL\b/i.test(line));
  const subtotalLine = subtotalIndex >= 0 ? rawLines[subtotalIndex] : null;
  const subtotal = subtotalLine ? lastMoneyValue(subtotalLine) : null;

  const exclusion = /\b(SUB[\s-]?TOTAL|TOTAL|GST|HST|PST|QST|TAX|TIP|TENDER|CHANGE|CASH|VISA|MASTER\s?CARD|AMEX|DEBIT|CREDIT|BALANCE|PAYMENT|SAVINGS|DISCOUNT TOTAL)\b/i;
  const itemLines = [];
  const parsed = [];

  rawLines.forEach((line, index) => {
    const amount = lastMoneyValue(line);
    const isSubtotal = index === subtotalIndex;
    const excluded = exclusion.test(line) || (subtotalIndex >= 0 && index > subtotalIndex);
    const entry = { index, line, amount, excluded, isSubtotal };
    parsed.push(entry);

    if (amount !== null && amount >= 0 && !excluded && !isSubtotal && (subtotalIndex < 0 || index < subtotalIndex)) {
      itemLines.push(entry);
    }
  });

  const itemCents = itemLines.reduce((sum, e) => sum + toCents(e.amount), 0);
  const subtotalCents = subtotal === null ? null : toCents(subtotal);
  const differenceCents = subtotalCents === null ? null : itemCents - subtotalCents;

  return {
    rawLines,
    parsed,
    itemLines,
    itemSum: itemCents / 100,
    subtotal,
    difference: differenceCents === null ? null : differenceCents / 100,
    reconciles: differenceCents !== null && Math.abs(differenceCents) <= 2
  };
}

export function scoreOcrResult(confidence, parsed) {
  let score = confidence * 0.35;
  score += Math.min(parsed.rawLines.length, 30) * 0.25;
  score += Math.min(parsed.itemLines.length, 20) * 1.5;
  if (parsed.subtotal !== null) score += 12;
  if (parsed.reconciles) score += 35;
  else if (parsed.difference !== null) score += Math.max(0, 12 - Math.abs(parsed.difference));
  return score;
}

export function buildOverlayValues(result) {
  const values = [];
  for (const word of result.words || []) {
    const text = String(word.text || "").trim();
    const parsed = parseMoneyToken(text);
    if (parsed === null) continue;
    const bbox = word.bbox || {};
    if (![bbox.x0, bbox.y0, bbox.x1, bbox.y1].every(Number.isFinite)) continue;
    values.push({
      text,
      value: parsed,
      confidence: Number(word.confidence || 0),
      bbox
    });
  }
  return { values, sourceWidth: result.sourceWidth, sourceHeight: result.sourceHeight };
}

function parseMoneyToken(text) {
  const cleaned = text.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[^0-9,.-]/g, "");
  if (!/^-?\d{1,5}[.,]\d{2}$/.test(cleaned)) return null;
  const value = Number(cleaned.replace(",", "."));
  return Number.isFinite(value) ? value : null;
}

function lastMoneyValue(line) {
  const matches = [...line.matchAll(/(?:^|\s|\$)(-?\d{1,5}[.,]\d{2})(?=\s|$|[A-Za-z*])/g)];
  if (!matches.length) return null;
  const raw = matches[matches.length - 1][1].replace(",", ".");
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}
function toCents(v) { return Math.round(Number(v) * 100); }
