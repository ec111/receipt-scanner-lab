export class OcrEngine {
  constructor(debug) {
    this.debug = debug;
    this.worker = null;
  }

  async ensureLoaded() {
    if (!window.Tesseract) {
      await loadTesseractWithFallbacks(this.debug);
    }
    if (!this.worker) {
      this.debug.log("Creating OCR worker");
      this.worker = await Tesseract.createWorker("eng", 1, {
        logger: message => {
          if (message.status) this.debug.log(`OCR status: ${message.status}`, message.progress ?? "");
        }
      });
      await this.worker.setParameters({
        preserve_interword_spaces: "1",
        tessedit_pageseg_mode: Tesseract.PSM ? Tesseract.PSM.SINGLE_BLOCK : "6"
      });
      this.debug.log("OCR worker ready");
    }
  }

  async recognize(canvas) {
    await this.ensureLoaded();
    const result = await this.worker.recognize(canvas);
    return result.data;
  }
}

async function loadTesseractWithFallbacks(debug) {
  const sources = [
    "https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js",
    "https://unpkg.com/tesseract.js@5/dist/tesseract.min.js",
    "https://cdnjs.cloudflare.com/ajax/libs/tesseract.js/5.1.1/tesseract.min.js"
  ];
  const failures = [];
  debug.log("Trying OCR CDNs");
  for (const src of sources) {
    try {
      debug.log("Loading OCR library", src);
      await loadScript(src, 15000, debug);
      if (window.Tesseract?.createWorker) {
        debug.log("Tesseract loaded", src);
        return;
      }
      failures.push(`${src}: loaded, but window.Tesseract missing`);
    } catch (error) {
      failures.push(`${src}: ${error.message}`);
      debug.log("CDN failed", `${src} :: ${error.message}`);
    }
  }
  throw new Error("Tesseract.js could not be loaded.\n" + failures.join("\n"));
}

function loadScript(src, timeoutMs, debug) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      script.remove();
      reject(new Error("timed out"));
    }, timeoutMs);

    script.src = src;
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    };
    script.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      script.remove();
      reject(new Error("network or Content Security Policy error"));
    };
    document.head.appendChild(script);
  });
}
