export class CameraController {
  constructor({ videoEl, analysisCanvas, captureCanvas, debug }) {
    this.videoEl = videoEl;
    this.analysisCanvas = analysisCanvas;
    this.captureCanvas = captureCanvas;
    this.analysisCtx = analysisCanvas.getContext("2d", { willReadFrequently: true });
    this.captureCtx = captureCanvas.getContext("2d");
    this.stream = null;
    this.imageCapture = null;
    this.debug = debug;
  }

  async start() {
    this.stop();
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 3840 },
        height: { ideal: 2160 },
        aspectRatio: { ideal: 0.75 }
      },
      audio: false
    });
    this.videoEl.srcObject = this.stream;
    await this.videoEl.play();
    const track = this.stream.getVideoTracks()[0];
    this.imageCapture = "ImageCapture" in window ? new ImageCapture(track) : null;
    this.debug.log("Camera started", { imageCapture: !!this.imageCapture });
    return !!this.imageCapture;
  }

  stop() {
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.imageCapture = null;
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
      const blob = await this.imageCapture.takePhoto();
      return blob;
    }
    this.captureCanvas.width = this.videoEl.videoWidth;
    this.captureCanvas.height = this.videoEl.videoHeight;
    this.captureCtx.drawImage(this.videoEl, 0, 0);
    return await new Promise(resolve => this.captureCanvas.toBlob(resolve, "image/jpeg", 0.95));
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
