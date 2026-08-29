export class CameraController {
  constructor({ videoEl, analysisCanvas, captureCanvas, debug }) {
    this.videoEl = videoEl;
    this.analysisCanvas = analysisCanvas;
    this.captureCanvas = captureCanvas;
    this.analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
    this.captureCtx = captureCanvas.getContext("2d");
    this.stream = null;
    this.imageCapture = null;
    this.photoSettings = null;
    this.debug = debug;
  }

  async start() {
    this.stop();

    // Prefer a high-resolution 4:3 rear-camera mode. 4:3 generally exposes
    // more of a phone camera sensor than 16:9 and is better suited to documents.
    // These are "ideal", not mandatory, so unsupported devices can fall back.
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 4096 },
        height: { ideal: 3072 },
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    });

    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();

    const track = this.stream.getVideoTracks()[0];
    const trackSettings = typeof track.getSettings === "function" ? track.getSettings() : {};

    this.imageCapture = "ImageCapture" in window ? new ImageCapture(track) : null;
    this.photoSettings = null;

    // ImageCapture can often take a still at a higher resolution than the live
    // video stream. Ask for the camera's maximum supported photo dimensions.
    if (this.imageCapture && typeof this.imageCapture.getPhotoCapabilities === "function") {
      try {
        const caps = await this.imageCapture.getPhotoCapabilities();
        const imageWidth = numericMaximum(caps?.imageWidth);
        const imageHeight = numericMaximum(caps?.imageHeight);

        if (imageWidth && imageHeight) {
          this.photoSettings = { imageWidth, imageHeight };
        }

        this.debug.log("Photo capabilities", {
          maxWidth: imageWidth || null,
          maxHeight: imageHeight || null,
          usingMaxStillResolution: !!this.photoSettings
        });
      } catch (error) {
        this.debug.log("Photo capability query failed; using default still capture", {
          name: error?.name,
          message: error?.message
        });
      }
    }

    this.debug.log("Camera started", {
      imageCapture: !!this.imageCapture,
      requestedVideo: "4096x3072",
      actualVideoWidth: trackSettings.width || this.videoEl.videoWidth || null,
      actualVideoHeight: trackSettings.height || this.videoEl.videoHeight || null,
      frameRate: trackSettings.frameRate || null,
      maxStillWidth: this.photoSettings?.imageWidth || null,
      maxStillHeight: this.photoSettings?.imageHeight || null
    });

    return !!this.imageCapture;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.imageCapture = null;
    this.photoSettings = null;
  }

  getAnalysisFrame(targetWidth = 480) {
    if (!this.videoEl.videoWidth || !this.videoEl.videoHeight) return null;
    const scale = targetWidth / this.videoEl.videoWidth;
    const w = targetWidth;
    const h = Math.round(this.videoEl.videoHeight * scale);
    this.analysisCanvas.width = w;
    this.analysisCanvas.height = h;
    this.analysisCtx.drawImage(this.videoEl, 0, 0, w, h);
    return this.analysisCtx.getImageData(0, 0, w, h);
  }

  async captureFrameBlob() {
    if (this.imageCapture) {
      try {
        const blob = this.photoSettings
          ? await this.imageCapture.takePhoto(this.photoSettings)
          : await this.imageCapture.takePhoto();

        this.debug.log("High-resolution still captured", {
          bytes: blob.size,
          type: blob.type,
          requestedWidth: this.photoSettings?.imageWidth || null,
          requestedHeight: this.photoSettings?.imageHeight || null
        });
        return blob;
      } catch (error) {
        // Some browsers expose photo capabilities but reject dimensions passed
        // to takePhoto(). Retry once without explicit photo settings.
        if (this.photoSettings) {
          this.debug.log("Maximum-resolution takePhoto failed; retrying default", {
            name: error?.name,
            message: error?.message
          });
          this.photoSettings = null;
          return await this.imageCapture.takePhoto();
        }
        throw error;
      }
    }

    // Fallback: capture the highest-resolution frame the video track supplied.
    this.captureCanvas.width = this.videoEl.videoWidth;
    this.captureCanvas.height = this.videoEl.videoHeight;
    this.captureCtx.drawImage(this.videoEl, 0, 0);
    return await new Promise(resolve => this.captureCanvas.toBlob(resolve, "image/jpeg", 0.98));
  }

  async captureBurst(count = 3, spacingMs = 130) {
    const result = [];
    for (let i = 0; i < count; i++) {
      const blob = await this.captureFrameBlob();
      result.push(blob);
      this.debug.log(`Captured frame ${i + 1}`, { bytes: blob.size, type: blob.type });
      if (i < count - 1) await new Promise(resolve => setTimeout(resolve, spacingMs));
    }
    return result;
  }
}

function numericMaximum(range) {
  if (!range) return null;
  if (Number.isFinite(range.max)) return range.max;
  if (Array.isArray(range)) {
    const values = range.filter(Number.isFinite);
    return values.length ? Math.max(...values) : null;
  }
  if (Number.isFinite(range)) return range;
  return null;
}
