const KEY_STORAGE = 'receiptScannerGeminiApiKey';

const keyInput = document.getElementById('geminiKeySetupInput');
const saveBtn = document.getElementById('geminiKeySetupSave');
const forgetBtn = document.getElementById('geminiKeySetupForget');
const status = document.getElementById('geminiKeySetupStatus');

function syncHiddenGeminiInput(value) {
  const hiddenInput = document.getElementById('geminiApiKey');
  if (hiddenInput) hiddenInput.value = value;
}

function showStatus(text, kind = '') {
  if (!status) return;
  status.textContent = text;
  status.dataset.kind = kind;
}

const saved = localStorage.getItem(KEY_STORAGE) || '';
if (keyInput) keyInput.value = saved;
if (saved) showStatus('Key saved on this device', 'pass');
else showStatus('No key saved', 'warn');

saveBtn?.addEventListener('click', () => {
  const key = (keyInput?.value || '').trim();
  if (!key) {
    showStatus('Paste a Gemini API key first', 'warn');
    return;
  }
  localStorage.setItem(KEY_STORAGE, key);
  syncHiddenGeminiInput(key);
  showStatus('Key saved on this device', 'pass');
});

forgetBtn?.addEventListener('click', () => {
  localStorage.removeItem(KEY_STORAGE);
  if (keyInput) keyInput.value = '';
  syncHiddenGeminiInput('');
  showStatus('Key removed from this device', 'warn');
});

keyInput?.addEventListener('input', () => {
  syncHiddenGeminiInput((keyInput.value || '').trim());
});

// gemini_ui.js creates its detailed OCR controls dynamically.
// Sync this visible setup field into that control after DOM initialization.
queueMicrotask(() => syncHiddenGeminiInput((keyInput?.value || '').trim()));
setTimeout(() => syncHiddenGeminiInput((keyInput?.value || '').trim()), 250);
