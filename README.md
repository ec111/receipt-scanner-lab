# Receipt Scanner Laboratory

A browser-based proof of concept for high-quality receipt capture and OCR preparation.

## Current pipeline

1. Open the rear camera in the browser.
2. Measure receipt visibility, sharpness, glare, and stability live.
3. Auto-capture once the view is stable enough.
4. Capture up to 10 full-resolution candidates.
5. Grade candidates for OCR usefulness using:
   - text-region sharpness
   - low-percentile tile sharpness
   - local text contrast
   - receipt coverage
   - exposure quality
   - glare penalty
   - gradient balance
   - crop confidence
6. Keep the top candidates but process only the single highest-scoring image.
7. Crop and normalize the best image.
8. Generate OCR-ready variants:
   - cropped color
   - grayscale contrast
   - stronger contrast
   - sharpened grayscale
   - local threshold
9. Optionally run local Tesseract.js OCR.
10. Compare candidate item prices with the detected subtotal and display OCR values over the receipt.

No frame fusion or registration is used in the active pipeline.

## Files

- `index.html` — UI
- `styles.css` — styling
- `app.js` — scanner orchestration and image grading
- `camera.js` — browser camera control
- `receipt_detection.js` — live document/quality helpers
- `image_processing.js` — preprocessing variants
- `ocr.js` — Tesseract.js wrapper
- `parser.js` — receipt parsing and subtotal reconciliation
- `consensus.js` — stored reading comparison
- `overlay.js` — live and OCR overlays
- `debug.js` — visible debug logger

## GitHub Pages

Deployment is configured in `.github/workflows/pages.yml`. The repository owner must enable GitHub Pages for the repository and select **GitHub Actions** as the Pages source once. Then manually run the **Deploy GitHub Pages** workflow from the Actions tab (or push a normal commit) to publish the current `main` branch.

The expected site address is:

`https://ec111.github.io/receipt-scanner-lab/`

## Notes

- Camera access requires HTTPS or localhost; GitHub Pages supplies HTTPS.
- Local Tesseract.js is intentionally optional because it is slow on phones.
- The scanner is currently an experimental capture/quality laboratory, not production bookkeeping software.
