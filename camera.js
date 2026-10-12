import { classifyView, profileFromSamples } from './focus.js';

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    const timeout = setTimeout(() => reject(new Error('Model library download timed out. Check your internet connection.')), 60000);
    script.src = src; script.crossOrigin = 'anonymous';
    script.onload = () => { clearTimeout(timeout); resolve(); };
    script.onerror = () => { clearTimeout(timeout); reject(new Error('Model library could not download. Check your internet connection.')); };
    document.head.append(script);
  });
}
export class AttentionCamera {
  constructor(video, canvas, onChange, onPhoneStatus) {
    this.video = video; this.canvas = canvas; this.onChange = onChange; this.onPhoneStatus = onPhoneStatus;
    this.active = false; this.generation = 0; this.worker = null; this.workerBusy = false;
    this.feature = null; this.lastFeatureAt = 0; this.faceCount = 0;
    this.profiles = this.readProfiles(); this.sensitivity = 1; this.phoneTracking = true;
    this.phoneModel = null; this.phonePromise = null; this.phoneBusy = false; this.phoneHits = 0;
    this.phoneUntil = 0; this.phoneAvailable = false; this.lastPhoneAt = 0;
    this.breakMode = false; this.lastFrameAt = 0; this.timer = null;
    this.candidate = null; this.candidateSince = 0; this.stable = { state: 'unknown', reason: 'Camera off' };
    this.samples = null;
  }
  readProfiles() {
    try {
      const p = JSON.parse(localStorage.getItem('focus-studio-calibration-v1') || 'null');
      if (!p || !p.screen) return {};
      for (const profile of Object.values(p)) {
        if (!Array.isArray(profile.mean) || profile.mean.length !== 4 || profile.mean.some(x => !Number.isFinite(x))) return {};
      }
      return p;
    } catch { return {}; }
  }
  async start() {
    if (this.active) return;
    const generation = ++this.generation;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('Open on localhost in a browser with camera support.');
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15, max: 20 } }, audio: false });
      if (generation !== this.generation) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream; this.video.srcObject = stream; await this.video.play();
      stream.getVideoTracks()[0].addEventListener('ended', () => {
        if (this.active) { this.stop(); this.onChange({ state: 'unknown', reason: 'Camera disconnected. Enable it again when ready.' }); }
      });
      this.worker = new Worker('/static/face-worker.js');
      await new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Camera model took too long to load. Check your internet connection.')), 90000);
        this.worker.onerror = () => { clearTimeout(timeout); reject(new Error('Camera model could not start. Try Chrome or Edge.')); };
        this.worker.onmessage = ({ data }) => {
          if (data.type === 'ready') { clearTimeout(timeout); resolve(); }
          if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); }
        };
        this.worker.postMessage({ type: 'init' });
      });
      if (generation !== this.generation) return;
      this.active = true;
      this.worker.onmessage = ({ data }) => {
        this.workerBusy = false;
        if (data.type === 'error') {
          this.stop(); this.onChange({ state: 'unknown', reason: 'Tracking stopped. Re-enable camera or use manual tracking.' }); return;
        }
        if (data.type === 'result') {
          this.feature = data.feature; this.faceCount = data.faceCount; this.lastFeatureAt = performance.now();
          if (this.samples && data.feature?.eyesOpen) this.samples.push(data.feature.vector);
          this.updateAttention();
        }
      };
      this.worker.onerror = () => { this.stop(); this.onChange({ state: 'unknown', reason: 'Camera tracking stopped unexpectedly.' }); };
      this.timer = setInterval(() => this.loop(), 125);
      if (this.phoneTracking) this.loadPhoneModel();
    } catch (error) {
      this.stop();
      if (error.name === 'NotAllowedError') throw new Error('Camera permission was declined. Allow it in browser settings, or use manual studying.');
      if (error.name === 'NotFoundError') throw new Error('No camera found. You can still use the timer and manual studying.');
      if (error.name === 'NotReadableError') throw new Error('Another app may be using your camera. Close it and try again.');
      throw error;
    }
  }
  stop() {
    this.generation++; this.active = false;
    clearInterval(this.timer); this.worker?.terminate(); this.worker = null; this.workerBusy = false;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null; this.video.srcObject = null;
    this.feature = null; this.phoneHits = 0; this.phoneUntil = 0;
    this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.stable = { state: 'unknown', reason: 'Camera off' };
    this.onChange(this.stable);
  }
  setBreak(value) { this.breakMode = value; if (value) this.onChange({ state: 'unknown', reason: 'Tracking rests during your break' }); }
  setOptions(settings) {
    this.sensitivity = settings.sensitivity; this.phoneTracking = settings.phoneTracking;
    if (!this.phoneTracking) {
      this.phoneUntil = 0; this.phoneHits = 0; this.onPhoneStatus('Phone detection is off in settings.');
      this.canvas.getContext('2d').clearRect(0, 0, this.canvas.width, this.canvas.height);
    } else if (this.active) this.loadPhoneModel();
  }
  async loop() {
    if (!this.active || this.breakMode || document.hidden || this.video.readyState < 2) return;
    const now = performance.now();
    if (!this.workerBusy) {
      this.workerBusy = true;
      try {
        const frame = await createImageBitmap(this.video);
        if (!this.worker || !this.active) { frame.close(); this.workerBusy = false; return; }
        this.worker.postMessage({ type: 'frame', frame, timestamp: now }, [frame]);
      } catch { this.workerBusy = false; }
    }
    if (this.phoneTracking && this.phoneAvailable && !this.phoneBusy && now - this.lastPhoneAt > 1500) this.detectPhone();
  }
  getAttention() {
    if (!this.active) return { state: 'unknown', reason: 'Camera off' };
    if (this.breakMode) return { state: 'unknown', reason: 'Tracking rests during your break' };
    if (document.hidden || performance.now() - this.lastFeatureAt > 2500) return { state: 'unknown', reason: 'Unobserved view' };
    return this.stable;
  }
  updateAttention() {
    const now = performance.now();
    let next;
    if (this.phoneTracking && now < this.phoneUntil) next = { state: 'distracted', reason: 'Visible phone (estimate)' };
    else if (this.faceCount > 1) next = { state: 'unknown', reason: 'More than one face in view' };
    else if (!this.profiles.screen) next = { state: 'unknown', reason: 'Calibrate your viewing positions' };
    else next = classifyView(this.feature, this.profiles, this.sensitivity);
    // Blinks do not erase a recent stable estimate, but a missing face is immediately unobserved.
    if (this.feature && !this.feature.eyesOpen && this.stable.state !== 'unknown') {
      if (!this.blinkSince) this.blinkSince = now;
      if (now - this.blinkSince < 1200) return;
    } else this.blinkSince = null;
    if ((!this.feature && now >= this.phoneUntil) || this.faceCount > 1 || !this.profiles.screen) {
      this.stable = next; this.candidate = null; this.onChange(next); return;
    }
    const key = next.state + next.reason;
    if (key !== this.candidate) { this.candidate = key; this.candidateSince = now; }
    if (now - this.candidateSince >= (next.state === 'unknown' ? 500 : 1600)) {
      this.stable = next; this.onChange(next);
    }
  }
  async capture(name) {
    if (!this.active || this.breakMode) throw new Error('Enable the camera in Focus mode before calibrating.');
    // Give the person time to move their eyes away from the capture button.
    await new Promise(resolve => setTimeout(resolve, 900));
    this.samples = [];
    await new Promise(resolve => setTimeout(resolve, 3200));
    const samples = this.samples; this.samples = null;
    if (!this.active) throw new Error('Camera stopped. Enable it and try again.');
    const profile = profileFromSamples(samples);
    this.profiles[name] = profile;
    localStorage.setItem('focus-studio-calibration-v1', JSON.stringify(this.profiles));
    return profile;
  }
  async loadPhoneModel() {
    if (this.phoneAvailable) { this.onPhoneStatus('Phone detection ready · estimates visible phones only.'); return; }
    if (this.phonePromise) return this.phonePromise;
    this.onPhoneStatus('Downloading phone model… screen / notes tracking can still run.');
    this.phonePromise = (async () => {
      try {
        if (!window.tf) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
        if (!window.cocoSsd) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js');
        await window.tf.ready();
        this.phoneModel = await window.cocoSsd.load({ base: 'lite_mobilenet_v2' });
        this.phoneAvailable = true;
        this.onPhoneStatus(this.phoneTracking ? 'Phone detection ready · estimates visible phones only.' : 'Phone detection is off in settings.');
      } catch {
        this.phoneAvailable = false;
        this.onPhoneStatus('Phone detection unavailable. Screen / notes tracking still works. Use manual distracted for phone time.');
      } finally { this.phonePromise = null; }
    })();
    return this.phonePromise;
  }
  async detectPhone() {
    this.phoneBusy = true; this.lastPhoneAt = performance.now();
    const generation = this.generation;
    try {
      const objects = await this.phoneModel.detect(this.video, 12, .5);
      if (!this.active || generation !== this.generation || !this.phoneTracking || this.breakMode) return;
      const phones = objects.filter(item => item.class === 'cell phone' && item.score >= .55);
      this.phoneHits = phones.length ? this.phoneHits + 1 : 0;
      if (this.phoneHits >= 2) this.phoneUntil = performance.now() + 3300;
      const ctx = this.canvas.getContext('2d');
      this.canvas.width = this.video.videoWidth; this.canvas.height = this.video.videoHeight;
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.strokeStyle = '#e2ae63'; ctx.lineWidth = 3;
      if (this.phoneHits >= 2) for (const p of phones) ctx.strokeRect(...p.bbox);
    } catch {
      this.phoneAvailable = false;
      this.onPhoneStatus('Phone detection stopped. Use manual distracted or turn the camera off and on to retry.');
    } finally { this.phoneBusy = false; }
  }
}
