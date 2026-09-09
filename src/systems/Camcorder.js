import * as THREE from 'three';

export class Camcorder {
  constructor(eventBus, scene) {
    this.bus = eventBus;
    this.scene = scene || null;
    this.active = false;
    this.battery = 100;
    this.recordSeconds = 0;
    this.el = document.getElementById('camcorder');
    this.timestampEl = document.getElementById('cc-timestamp');
    this.batteryEl = document.getElementById('cc-battery');
    this.playbackEl = document.getElementById('cc-playback');
    this.noiseCanvas = document.getElementById('noise-cv');
    this.noiseCtx = this.noiseCanvas.getContext('2d', { alpha: true });
    this.sceneCanvas = document.getElementById('scene');
    this._resize();
    window.addEventListener('resize', () => this._resize());

    this.tapeEvents = [];
    this.pendingPlayback = false;
    this._ghost = null;
    this._ghostTimer = 0;
    this._emptyNotified = false;

    this._glitchTimer = 0;
    this._trackingOffset = 0;
    this._noiseAccum = 0;

    this._onTape = () => { this.pendingPlayback = true; };
    this.bus.on('tape-log', this._onTape);
  }

  dispose() {
    this._clearGhost();
    this._setOverlay(false);
    this.active = false;
    this.bus.off('tape-log', this._onTape);
  }

  setScene(scene) {
    this.scene = scene;
  }

  _resize() {
    const scale = 0.22;
    this.noiseCanvas.width = Math.max(64, Math.floor(window.innerWidth * scale));
    this.noiseCanvas.height = Math.max(48, Math.floor(window.innerHeight * scale));
  }

  _setOverlay(on) {
    this.el.classList.toggle('active', on);
    if (this.sceneCanvas) this.sceneCanvas.classList.toggle('vhs-filter', on);
  }

  toggle() {
    if (!this.active && this.battery <= 0) {
      this.bus.emit('message', 'The tape deck is dead.');
      return;
    }
    this.active = !this.active;
    this._setOverlay(this.active);
    if (!this.active) {
      this._clearGhost();
      if (this.playbackEl) this.playbackEl.classList.remove('show');
    } else if (this.pendingPlayback) {
      this._ghostTimer = -1; // spawn on next update with pose
    }
    this.bus.emit('camcorder-toggle', this.active);
  }

  serialize() {
    return {
      battery: this.battery,
      pendingPlayback: this.pendingPlayback,
      recordSeconds: this.recordSeconds,
    };
  }

  load(data) {
    if (!data) return;
    if (data.battery != null) this.battery = data.battery;
    this.pendingPlayback = !!data.pendingPlayback;
    this.recordSeconds = data.recordSeconds || 0;
  }

  logTapeEvent(description, worldPos) {
    this.tapeEvents.push({ t: this.recordSeconds, description, worldPos });
    if (this.tapeEvents.length > 40) this.tapeEvents.shift();
    this.pendingPlayback = true;
  }

  forcePlayback() {
    this.battery = Math.max(this.battery, 30);
    this.pendingPlayback = true;
    this.active = true;
    this._setOverlay(true);
    this._ghostTimer = -1;
    this._emptyNotified = false;
  }

  update(dt, ctx = {}) {
    if (this.active && this._ghostTimer < 0 && ctx.playerPos && ctx.camera) {
      this._spawnGhost(ctx.playerPos, ctx.camera);
      this._ghostTimer = 2.5;
      this.pendingPlayback = false;
      if (this.playbackEl) this.playbackEl.classList.add('show');
    }

    if (this._ghost) {
      this._ghostTimer -= dt;
      if (!this.active || this._ghostTimer <= 0) this._clearGhost();
    }

    if (!this.active) return;
    this.recordSeconds += dt;
    if (this.battery > 0) this.battery = Math.max(0, this.battery - (100 / 600) * dt);
    if (this.battery <= 0) {
      this.active = false;
      this._setOverlay(false);
      this._clearGhost();
      if (!this._emptyNotified) {
        this._emptyNotified = true;
        this.bus.emit('message', 'The tape deck is dead.');
      }
      return;
    }

    const h = Math.floor(this.recordSeconds / 3600).toString().padStart(2, '0');
    const m = Math.floor((this.recordSeconds % 3600) / 60).toString().padStart(2, '0');
    const s = Math.floor(this.recordSeconds % 60).toString().padStart(2, '0');
    this.timestampEl.textContent = `1996-04-12  ${h}:${m}:${s}`;
    const filled = Math.round((this.battery / 100) * 8);
    this.batteryEl.textContent = `BAT ${'█'.repeat(filled)}${'░'.repeat(8 - filled)}`;

    this._noiseAccum += dt;
    if (this._noiseAccum < 0.1) return;
    this._noiseAccum = 0;
    const nctx = this.noiseCtx;
    const w = this.noiseCanvas.width;
    const hgt = this.noiseCanvas.height;
    const img = nctx.createImageData(w, hgt);
    const data = img.data;

    this._glitchTimer -= 0.1;
    let doTracking = false;
    if (this._glitchTimer <= 0) {
      this._glitchTimer = 0.8 + Math.random() * 2.5;
      doTracking = Math.random() < 0.35;
      this._trackingOffset = (Math.random() - 0.5) * 12;
    }

    for (let y = 0; y < hgt; y++) {
      const tear = doTracking && Math.abs(y - (hgt * 0.5 + this._trackingOffset)) < 3;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        const n = Math.random();
        const base = n * 180 + 20;
        data[i] = base * 0.85 + Math.random() * 30;
        data[i + 1] = base * 0.95 + Math.random() * 25;
        data[i + 2] = base * 0.55 + Math.random() * 20;
        data[i + 3] = tear ? 40 + n * 50 : 18 + n * 45;
      }
    }
    nctx.putImageData(img, 0, 0);
    this.noiseCanvas.style.width = '100%';
    this.noiseCanvas.style.height = '100%';
    this.noiseCanvas.style.imageRendering = 'pixelated';
  }

  _spawnGhost(playerPos, camera) {
    this._clearGhost();
    if (!this.scene) return;
    const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    forward.y = 0;
    if (forward.lengthSq() < 0.01) forward.set(0, 0, -1);
    else forward.normalize();
    const x = playerPos.x + forward.x * 7;
    const z = playerPos.z + forward.z * 7;

    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const torso = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 1.5, 8), mat);
    torso.position.y = 1.1;
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), mat);
    head.position.y = 2.0;
    g.add(torso, head);
    g.position.set(x, 0, z);
    g.lookAt(playerPos.x, 0, playerPos.z);
    this.scene.add(g);
    this._ghost = g;
  }

  _clearGhost() {
    if (this._ghost && this.scene) this.scene.remove(this._ghost);
    this._ghost = null;
    if (this.playbackEl) this.playbackEl.classList.remove('show');
  }
}
