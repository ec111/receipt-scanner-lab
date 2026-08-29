# Receipt Scanner Laboratory

A browser-based receipt-scanning research tool built for rapid experimentation.

## Features

- Live rear-camera preview
- Heuristic receipt detection
- Sharpness, glare, and stability scoring
- Auto-capture once conditions are good enough
- Locks after one scan cycle so OCR can finish without repeated captures
- Collects captured candidates one by one, scores them, and keeps the 3 best qualifying images using a combined quality score weighted toward sharpness
- Crops the receipt region from the selected frames
- Normalizes and upscales the crops for OCR
- Fuses the selected crops into a clearer average image
- Generates OCR-ready variants: color crop, grayscale contrast, sharpened, and local threshold
- OCR is optional by default because local Tesseract is slow; press Run OCR now or enable Run OCR after preprocessing
- Press Reset to scan another receipt
- 3 processing variants per frame:
  - original
  - grayscale + contrast
  - local threshold
- Up to 9 OCR interpretations using Tesseract.js
- OCR ranking and selection
- Monetary-value overlay on the captured image
- Candidate item sum vs subtotal reconciliation
- Stored-reading consensus by approximate receipt position
- Visible copyable debug console

## Structure

- `index.html` — UI shell
- `styles.css` — page styling
- `app.js` — main orchestration
- `camera.js` — browser camera control
- `receipt_detection.js` — heuristic document/quality scoring
- `image_processing.js` — image variants
- `ocr.js` — Tesseract loading + OCR wrapper
- `parser.js` — receipt text parsing and scoring
- `consensus.js` — repeated-reading comparison
- `overlay.js` — preview and OCR overlay rendering
- `debug.js` — debug console logger

## Run locally

Camera access generally requires HTTPS or localhost.

### Local development
```bash
python -m http.server 8000
```

Then open:
```text
http://localhost:8000
```

### Deploy
Drag the full folder onto Netlify, or push it to GitHub Pages / Cloudflare Pages / Vercel.

## Notes

- Tesseract.js is loaded dynamically from several CDNs.
- If OCR fails, the debug console should say whether a CDN, CSP, or worker stage failed.
- The subtotal parser is intentionally conservative and does not yet handle all receipt patterns.

## v8-single-best-grader

The active pipeline focuses on selecting the single best OCR-useful image rather than fusing frames.

New grading model:
- text-region sharpness rather than global sharpness
- 20th-percentile tile sharpness to punish partially blurry receipts
- local text contrast
- receipt coverage
- exposure quality
- glare penalty
- motion/gradient-balance score
- crop confidence

Capture behavior:
1. Capture up to 10 full-resolution candidates.
2. Score each candidate using the OCR-usefulness model.
3. Stop early after enough good candidates and one excellent candidate.
4. Select the best single frame.
5. Generate OCR variants only from that best frame.
6. Keep runners-up only for debug/evidence.
