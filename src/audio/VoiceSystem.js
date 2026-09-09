/**
 * Voice / dialogue playback — empty until a new narrative registers lines.
 *
 * Drop files under:  assets/voice/<id>.mp3
 * Register them in VOICE_LINES below (or call register()).
 * Missing files fail silently.
 */
export const VOICE_LINES = {};

export class VoiceSystem {
  constructor(eventBus, audioCtx, outputNode = null) {
    this.bus = eventBus;
    this.ctx = audioCtx || null;
    this.outputNode = outputNode;
    this.registry = { ...VOICE_LINES };
    this.buffers = new Map();
    this.loading = new Map();
    this.currentSource = null;
    this.master = null;
    this.enabled = true;
    this.volume = 0.85;
  }

  dispose() {
    this.stop();
  }

  register(id, path) {
    this.registry[id] = path;
    this.buffers.delete(id);
  }

  setEnabled(on) {
    this.enabled = !!on;
    if (!on) this.stop();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, Number(v) || 0));
    if (this.master) this.master.gain.value = this.volume;
  }

  stop() {
    if (this.currentSource) {
      try { this.currentSource.stop(); } catch (_) { /* already stopped */ }
      this.currentSource = null;
    }
  }

  async speak(id, opts = {}) {
    if (opts.text) this.bus.emit('message', opts.text);
    if (!this.enabled) return;
    const path = this.registry[id];
    if (!path) return;

    try {
      const buffer = await this._load(id, path);
      if (!buffer) return;
      await this._playBuffer(buffer, opts.interrupt !== false);
    } catch (err) {
      console.warn('[VoiceSystem] play failed for', id, err);
    }
  }

  async _load(id, path) {
    if (this.buffers.has(id)) return this.buffers.get(id);
    if (this.loading.has(id)) return this.loading.get(id);

    const promise = (async () => {
      try {
        if (!this.ctx) {
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') await this.ctx.resume();
        const res = await fetch(path);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const arr = await res.arrayBuffer();
        const buf = await this.ctx.decodeAudioData(arr);
        this.buffers.set(id, buf);
        return buf;
      } catch (err) {
        console.warn('[VoiceSystem] missing/failed', path, err.message || err);
        this.buffers.set(id, null);
        return null;
      } finally {
        this.loading.delete(id);
      }
    })();

    this.loading.set(id, promise);
    return promise;
  }

  async _playBuffer(buffer, interrupt) {
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') await this.ctx.resume();
    if (interrupt) this.stop();

    if (!this.master) {
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      this.master.connect(this.outputNode || this.ctx.destination);
    }

    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(this.master);
    this.currentSource = src;
    return new Promise((resolve) => {
      src.onended = () => {
        if (this.currentSource === src) this.currentSource = null;
        resolve();
      };
      src.start(0);
    });
  }
}
