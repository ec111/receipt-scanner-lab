const KEY_STORAGE = 'receiptScannerGeminiApiKey';
const MODEL_STORAGE = 'receiptScannerGeminiModel';
const DEFAULT_MODEL = 'gemini-3.7-flash';
const FALLBACK_MODEL = 'gemini-2.5-flash';

const RECEIPT_PROMPT = `You are a receipt-reading system.

Analyze the attached receipt image carefully and extract the transaction.

Your main goal is to return:
1. Every purchased item.
2. The final cost charged for each individual line item.
3. The receipt subtotal, taxes, discounts, and final total.

IMPORTANT RULES
- Read the receipt visually. Do not guess text that is unclear.
- Ignore advertisements, loyalty messages, payment-card details, store policies, QR codes, headers, footers, and other non-purchase text.
- Preserve each item name as closely as possible to what appears on the receipt.
- If an item has a quantity, weight, or unit price, extract those separately.
- line_total must be the actual amount charged for that item on the receipt.
- For weighted goods, distinguish weight, weight_unit, unit_price, and line_total.
- For multiple units, distinguish quantity, unit_price, and line_total.
- Do not treat subtotal, GST, PST, HST, tips, deposits, discounts, payments, change, or TOTAL as purchased items.
- Represent discounts separately and associate them with an item if the receipt clearly indicates which item they modify.
- Use the printed amount as authoritative rather than recalculating it unless the printed amount is unreadable.
- Never invent a number. If a value cannot be determined reliably, use null.
- Monetary values must be JSON numbers, not strings.

After extraction, perform arithmetic validation:
calculated_item_total = sum(all item line_total values)
Compare calculated_item_total with the printed subtotal.
Then check subtotal + taxes + other charges - receipt-level discounts = final total.
Report whether each calculation reconciles within $0.02.

Return ONLY valid JSON in this structure:
{
  "merchant": "",
  "date": null,
  "currency": "CAD",
  "items": [
    {
      "name": "",
      "quantity": null,
      "weight": null,
      "weight_unit": null,
      "unit_price": null,
      "line_total": null,
      "confidence": 0.0,
      "raw_text": ""
    }
  ],
  "discounts": [
    {
      "description": "",
      "amount": null,
      "associated_item": null
    }
  ],
  "subtotal": null,
  "taxes": [
    {
      "name": "",
      "amount": null
    }
  ],
  "other_charges": [],
  "total": null,
  "validation": {
    "calculated_item_total": null,
    "item_total_difference_from_subtotal": null,
    "items_reconcile": false,
    "calculated_receipt_total": null,
    "receipt_total_difference": null,
    "total_reconciles": false
  },
  "uncertain_fields": []
}`;

function $(id) { return document.getElementById(id); }

function init() {
  const ocrPanel = $('ocrPanel');
  if (!ocrPanel || $('geminiOcrSection')) return;

  injectStyles();

  const section = document.createElement('section');
  section.id = 'geminiOcrSection';
  section.className = 'gemini-ocr-section';
  section.innerHTML = `
    <div class="gemini-title-row">
      <div>
        <h3>Gemini receipt OCR</h3>
        <div class="gemini-note">The API key is never stored in GitHub. You can use it once, or save it only in this browser's localStorage.</div>
      </div>
      <strong id="geminiStatus">Key not set</strong>
    </div>

    <div class="gemini-key-row">
      <input id="geminiApiKey" type="password" inputmode="text" autocomplete="off" spellcheck="false" placeholder="Paste Gemini API key" aria-label="Gemini API key" />
      <button id="saveGeminiKey" type="button">Save on this device</button>
      <button id="forgetGeminiKey" type="button">Forget key</button>
    </div>

    <div class="gemini-actions">
      <label><input id="runGeminiAfterCapture" type="checkbox" /> Run Gemini after capture</label>
      <label>Model
        <select id="geminiModel">
          <option value="gemini-3.7-flash">Gemini 3.7 Flash</option>
          <option value="gemini-2.5-flash">Gemini 2.5 Flash</option>
        </select>
      </label>
      <button id="runGeminiBtn" class="primary" type="button">Run Gemini OCR</button>
    </div>

    <div id="geminiReconcile" class="reconcile-banner">Capture a receipt, enter a key, then run Gemini OCR.</div>

    <div class="gemini-summary-grid">
      <div><span>Merchant</span><strong id="geminiMerchant">—</strong></div>
      <div><span>Item sum</span><strong id="geminiItemSum">—</strong></div>
      <div><span>Subtotal</span><strong id="geminiSubtotal">—</strong></div>
      <div><span>Total</span><strong id="geminiTotal">—</strong></div>
    </div>

    <div id="geminiItems" class="gemini-items"></div>

    <details>
      <summary>Gemini raw JSON</summary>
      <pre id="geminiRawJson">No Gemini result yet.</pre>
    </details>
  `;

  const summary = ocrPanel.querySelector('.summary-banner');
  if (summary) summary.after(section); else ocrPanel.prepend(section);

  const keyInput = $('geminiApiKey');
  const savedKey = localStorage.getItem(KEY_STORAGE) || '';
  keyInput.value = savedKey;
  $('geminiStatus').textContent = savedKey ? 'Key saved locally' : 'Key not set';

  const savedModel = localStorage.getItem(MODEL_STORAGE);
  if (savedModel && [...$('geminiModel').options].some(o => o.value === savedModel)) {
    $('geminiModel').value = savedModel;
  }

  $('saveGeminiKey').addEventListener('click', () => {
    const key = keyInput.value.trim();
    if (!key) {
      setStatus('Enter a key first', 'warn');
      return;
    }
    localStorage.setItem(KEY_STORAGE, key);
    localStorage.setItem(MODEL_STORAGE, $('geminiModel').value);
    setStatus('Key saved locally', 'pass');
  });

  $('forgetGeminiKey').addEventListener('click', () => {
    localStorage.removeItem(KEY_STORAGE);
    localStorage.removeItem(MODEL_STORAGE);
    keyInput.value = '';
    setStatus('Key forgotten', 'warn');
  });

  $('geminiModel').addEventListener('change', () => {
    if (localStorage.getItem(KEY_STORAGE)) localStorage.setItem(MODEL_STORAGE, $('geminiModel').value);
  });

  $('runGeminiBtn').addEventListener('click', runGeminiOcr);

  const capturedImage = $('capturedImage');
  capturedImage?.addEventListener('load', () => {
    if ($('runGeminiAfterCapture')?.checked && getKey()) {
      setTimeout(() => runGeminiOcr(), 150);
    }
  });
}

async function runGeminiOcr() {
  const key = getKey();
  const image = $('capturedImage');
  const button = $('runGeminiBtn');

  if (!key) {
    setStatus('Enter a Gemini API key', 'warn');
    $('geminiReconcile').textContent = 'No API key is set.';
    $('geminiReconcile').className = 'reconcile-banner warn';
    return;
  }

  if (!image?.src || !image.naturalWidth) {
    setStatus('Capture a receipt first', 'warn');
    $('geminiReconcile').textContent = 'There is no processed receipt image to send.';
    $('geminiReconcile').className = 'reconcile-banner warn';
    return;
  }

  button.disabled = true;
  setStatus('Sending image…');
  $('geminiReconcile').className = 'reconcile-banner';
  $('geminiReconcile').textContent = 'Gemini is reading the best preprocessed receipt image.';

  try {
    const blob = await fetch(image.src).then(r => {
      if (!r.ok) throw new Error(`Could not read captured image (${r.status})`);
      return r.blob();
    });

    if (blob.size > 19_000_000) {
      throw new Error('Processed image is too large for inline Gemini image input (>19 MB).');
    }

    const base64 = await blobToBase64(blob);
    const requestedModel = $('geminiModel').value || DEFAULT_MODEL;
    setStatus(`Reading with ${requestedModel}…`);

    const { data, model } = await callGemini({ key, blob, base64, requestedModel });
    renderReceipt(data, model);
    setStatus(`Complete · ${model}`, 'pass');
  } catch (error) {
    console.error('Gemini OCR failed', error);
    setStatus('Gemini OCR failed', 'fail');
    $('geminiReconcile').className = 'reconcile-banner fail';
    $('geminiReconcile').textContent = error?.message || String(error);
  } finally {
    button.disabled = false;
  }
}

async function callGemini({ key, blob, base64, requestedModel }) {
  const models = [requestedModel];
  if (requestedModel !== FALLBACK_MODEL) models.push(FALLBACK_MODEL);

  let lastError = null;

  for (const model of models) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key
      },
      body: JSON.stringify({
        contents: [{
          parts: [
            {
              inline_data: {
                mime_type: blob.type || 'image/jpeg',
                data: base64
              }
            },
            { text: RECEIPT_PROMPT }
          ]
        }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: 'application/json'
        }
      })
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message = payload?.error?.message || `${response.status} ${response.statusText}`;
      lastError = new Error(`Gemini API: ${message}`);
      const modelProblem = response.status === 404 || /model.*(not found|not supported|unavailable)/i.test(message);
      if (modelProblem && model !== models[models.length - 1]) continue;
      throw lastError;
    }

    const text = (payload?.candidates?.[0]?.content?.parts || [])
      .map(part => part?.text || '')
      .join('')
      .trim();

    if (!text) {
      const reason = payload?.promptFeedback?.blockReason || payload?.candidates?.[0]?.finishReason || 'empty response';
      throw new Error(`Gemini returned no receipt JSON (${reason}).`);
    }

    let data;
    try {
      data = JSON.parse(cleanJson(text));
    } catch {
      throw new Error('Gemini returned text that could not be parsed as JSON. See the raw result in the console.');
    }

    return { data, model };
  }

  throw lastError || new Error('No Gemini model was available.');
}

function renderReceipt(data, model) {
  const items = Array.isArray(data?.items) ? data.items : [];
  const itemSum = roundMoney(items.reduce((sum, item) => sum + finite(item?.line_total), 0));
  const subtotal = nullableNumber(data?.subtotal);
  const total = nullableNumber(data?.total);
  const difference = subtotal == null ? null : roundMoney(itemSum - subtotal);
  const locallyReconciles = difference != null && Math.abs(difference) <= 0.02;

  $('geminiMerchant').textContent = data?.merchant || '—';
  $('geminiItemSum').textContent = money(itemSum);
  $('geminiSubtotal').textContent = moneyOrDash(subtotal);
  $('geminiTotal').textContent = moneyOrDash(total);
  $('geminiRawJson').textContent = JSON.stringify(data, null, 2);

  const banner = $('geminiReconcile');
  if (subtotal == null) {
    banner.className = 'reconcile-banner warn';
    banner.textContent = `${model}: subtotal was not read reliably; arithmetic verification is unresolved.`;
  } else if (locallyReconciles) {
    banner.className = 'reconcile-banner pass';
    banner.textContent = `VERIFIED BY ARITHMETIC: extracted item totals equal the printed subtotal within 2¢ (${money(itemSum)} vs ${money(subtotal)}).`;
  } else {
    banner.className = 'reconcile-banner fail';
    banner.textContent = `NEEDS SECOND PASS: extracted items differ from subtotal by ${moneySigned(difference)} (${money(itemSum)} vs ${money(subtotal)}).`;
  }

  const container = $('geminiItems');
  container.textContent = '';

  if (!items.length) {
    const empty = document.createElement('div');
    empty.className = 'gemini-empty';
    empty.textContent = 'No purchased items were returned.';
    container.appendChild(empty);
  } else {
    const header = document.createElement('div');
    header.className = 'gemini-item gemini-item-header';
    ['Item', 'Qty / weight', 'Unit price', 'Line total'].forEach(text => {
      const cell = document.createElement('strong');
      cell.textContent = text;
      header.appendChild(cell);
    });
    container.appendChild(header);

    items.forEach(item => {
      const row = document.createElement('div');
      row.className = 'gemini-item';
      const detail = item?.weight != null
        ? `${item.weight}${item.weight_unit ? ` ${item.weight_unit}` : ''}`
        : item?.quantity != null ? String(item.quantity) : '—';
      const values = [
        item?.name || '(unclear item)',
        detail,
        moneyOrDash(nullableNumber(item?.unit_price)),
        moneyOrDash(nullableNumber(item?.line_total))
      ];
      values.forEach(text => {
        const cell = document.createElement('span');
        cell.textContent = text;
        row.appendChild(cell);
      });
      container.appendChild(row);
    });
  }

  const uncertain = Array.isArray(data?.uncertain_fields) ? data.uncertain_fields.filter(Boolean) : [];
  if (uncertain.length) {
    const box = document.createElement('div');
    box.className = 'gemini-uncertain';
    box.textContent = `Uncertain: ${uncertain.join(' · ')}`;
    container.appendChild(box);
  }
}

function getKey() {
  return ($('geminiApiKey')?.value || '').trim();
}

function setStatus(text, kind = '') {
  const el = $('geminiStatus');
  if (!el) return;
  el.textContent = text;
  el.dataset.kind = kind;
}

function cleanJson(text) {
  return text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error || new Error('Could not encode receipt image.'));
    reader.readAsDataURL(blob);
  });
}

function nullableNumber(value) {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function finite(value) {
  const n = nullableNumber(value);
  return n == null ? 0 : n;
}

function roundMoney(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function money(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

function moneyOrDash(value) {
  return value == null ? '—' : money(value);
}

function moneySigned(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : '-'}$${Math.abs(n).toFixed(2)}`;
}

function injectStyles() {
  if ($('geminiOcrStyles')) return;
  const style = document.createElement('style');
  style.id = 'geminiOcrStyles';
  style.textContent = `
    .gemini-ocr-section { margin-top: 14px; padding: 14px; border: 1px solid rgba(96,165,250,.32); border-radius: 14px; background: rgba(15,23,42,.72); }
    .gemini-title-row, .gemini-key-row, .gemini-actions { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }
    .gemini-title-row { justify-content:space-between; margin-bottom:10px; }
    .gemini-title-row h3 { margin:0; }
    .gemini-note { margin-top:4px; color:#94a3b8; font-size:.84rem; max-width:720px; }
    .gemini-key-row input { flex:1 1 300px; min-width:0; padding:10px 12px; border:1px solid #334155; border-radius:10px; background:#020617; color:#f8fafc; }
    .gemini-actions { margin-top:10px; }
    .gemini-actions label { display:flex; align-items:center; gap:6px; }
    .gemini-actions select { padding:8px 10px; border-radius:9px; background:#020617; color:#f8fafc; border:1px solid #334155; }
    .gemini-summary-grid { display:grid; grid-template-columns:repeat(4,1fr); gap:1px; margin-top:12px; border-radius:12px; overflow:hidden; background:rgba(148,163,184,.12); }
    .gemini-summary-grid > div { padding:10px; text-align:center; background:#111827; }
    .gemini-summary-grid span { display:block; color:#94a3b8; font-size:.78rem; margin-bottom:4px; }
    .gemini-items { display:grid; gap:5px; margin:12px 0; }
    .gemini-item { display:grid; grid-template-columns:minmax(150px,2fr) minmax(90px,.8fr) minmax(90px,.8fr) minmax(90px,.8fr); gap:8px; padding:8px 10px; background:#0f172a; border-radius:8px; align-items:center; }
    .gemini-item-header { color:#93c5fd; background:#111827; }
    .gemini-uncertain { padding:10px; border-radius:9px; background:rgba(146,64,14,.38); color:#fde68a; }
    #geminiStatus[data-kind="pass"] { color:#86efac; }
    #geminiStatus[data-kind="warn"] { color:#fde68a; }
    #geminiStatus[data-kind="fail"] { color:#fca5a5; }
    @media(max-width:700px){
      .gemini-summary-grid { grid-template-columns:repeat(2,1fr); }
      .gemini-item { grid-template-columns:1fr auto; }
      .gemini-item-header { display:none; }
    }
  `;
  document.head.appendChild(style);
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
