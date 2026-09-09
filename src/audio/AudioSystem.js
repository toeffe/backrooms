import * as THREE from 'three';

// Fluorescent hum-buzz bed + spatial one-shots.

export class AudioSystem {
  constructor(camera) {
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = 1;
    this.sfxGain.connect(this.master);
    this.camera = camera;
    this._started = false;

    this.bedGain = this.ctx.createGain();
    this.bedGain.gain.value = 0.065;
    this.bedGain.connect(this.master);
    this._bedTarget = 0.065;
    this._bedDefault = 0.065;
    this._tickTimer = 8 + Math.random() * 14;
    this._silenceUntil = 0;
    this._bedNodes = [];

    this._echoCount = 0;
    this._echoArmed = false;
    this._echoLeft = 0;
    this._lastStepInterval = 0.42;
    this._lastStepAt = 0;
    this._wrongStepSide = 1;

    this._fwd = new THREE.Vector3();
    this._up = new THREE.Vector3();
    this._buildAmbientBed();
  }

  resume() {
    if (this.ctx.state === 'suspended') this.ctx.resume();
    if (!this._started) {
      this._started = true;
      for (const n of this._bedNodes) {
        try { n.start(); } catch (_) { /* already started */ }
      }
    }
  }

  setVolumes(master, sfx) {
    const m = Math.max(0, Math.min(1, Number(master) || 0));
    const s = Math.max(0, Math.min(1, Number(sfx) || 0));
    this.master.gain.value = m;
    if (this.sfxGain) this.sfxGain.gain.value = s;
  }

  _buildAmbientBed() {
    // Fluorescent lights at maximum hum-buzz: 60 + 120 Hz + high whine.
    this._bedNodes = [];
    const addOsc = (type, freq, dest) => {
      const osc = this.ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = freq;
      osc.connect(dest);
      this._bedNodes.push(osc);
      return osc;
    };

    const g60 = this.ctx.createGain();
    g60.gain.value = 0.5;
    g60.connect(this.bedGain);
    this.ambientOsc = addOsc('sine', 60, g60);

    const g120 = this.ctx.createGain();
    g120.gain.value = 0.32;
    g120.connect(this.bedGain);
    addOsc('sine', 120, g120);

    const buzz = this.ctx.createBiquadFilter();
    buzz.type = 'bandpass';
    buzz.frequency.value = 2800;
    buzz.Q.value = 2.4;
    const buzzG = this.ctx.createGain();
    buzzG.gain.value = 0.2;
    buzz.connect(buzzG).connect(this.bedGain);
    addOsc('sawtooth', 120, buzz);
    this.whineGain = buzzG;
    this._whineDefault = 0.2;

    this.hums = [{ osc: this.ambientOsc, gain: this.bedGain }];
  }

  update(camera, opts = {}) {
    this.camera = camera || this.camera;
    this._syncListener();

    const now = this.ctx.currentTime;
    const chasing = !!opts.chasing;
    const houndNear = !!opts.houndNear || chasing;
    const zoneId = opts.zoneId;
    let target = this._bedDefault;
    let whine = this._whineDefault;
    if (this._silenceUntil > now) {
      target = 0.002;
      whine = 0.02;
    } else if (chasing) {
      target = 0.001;
      whine = 0.015;
    } else if (houndNear) {
      target = 0.008;
      whine = 0.04;
    } else if (zoneId === 'utility') {
      target = 0.2;
      whine = 0.48;
    } else if (zoneId === 'lightsOut' || zoneId === 'tightHalls') {
      target = 0.04;
      whine = 0.045;
    }
    this._bedTarget = target;
    this.bedGain.gain.setTargetAtTime(target, now, 0.08);
    if (this.whineGain) this.whineGain.gain.setTargetAtTime(whine, now, 0.12);

    this._tickTimer -= opts.dt || 0.016;
    if (this._tickTimer <= 0 && !houndNear && this._silenceUntil <= now) {
      this._tickTimer = 9 + Math.random() * 18;
      this._playTick();
    }
  }

  _syncListener() {
    const cam = this.camera;
    if (!cam) return;
    const listener = this.ctx.listener;
    const p = cam.position;
    this._fwd.set(0, 0, -1).applyQuaternion(cam.quaternion);
    this._up.set(0, 1, 0).applyQuaternion(cam.quaternion);
    if (listener.positionX) {
      listener.positionX.value = p.x;
      listener.positionY.value = p.y;
      listener.positionZ.value = p.z;
      listener.forwardX.value = this._fwd.x;
      listener.forwardY.value = this._fwd.y;
      listener.forwardZ.value = this._fwd.z;
      listener.upX.value = this._up.x;
      listener.upY.value = this._up.y;
      listener.upZ.value = this._up.z;
    } else if (listener.setPosition) {
      listener.setPosition(p.x, p.y, p.z);
      listener.setOrientation(this._fwd.x, this._fwd.y, this._fwd.z, this._up.x, this._up.y, this._up.z);
    }
  }

  _playAt(position, build) {
    const panner = this.ctx.createPanner();
    panner.panningModel = 'HRTF';
    panner.distanceModel = 'inverse';
    panner.refDistance = 2;
    panner.maxDistance = 40;
    panner.rolloffFactor = 1.4;
    const x = position.x, y = position.y || 1, z = position.z;
    if (panner.positionX) {
      panner.positionX.value = x;
      panner.positionY.value = y;
      panner.positionZ.value = z;
    } else if (panner.setPosition) {
      panner.setPosition(x, y, z);
    }
    panner.connect(this.sfxGain || this.master);
    build(panner);
    // Disconnect later to avoid leaking panners
    setTimeout(() => {
      try { panner.disconnect(); } catch (_) { /* already gone */ }
    }, 4000);
  }

  footstep(position, loudness = 0.5, surface = 'carpet') {
    this._stepAt(position, loudness, surface);
    const now = performance.now() / 1000;
    const interval = now - (this._lastStepAt || now);
    this._lastStepAt = now;
    if (interval > 0.2 && interval < 0.8) this._lastStepInterval = interval;

    if (this._echoLeft > 0) {
      this._echoLeft--;
      const desync = 1 + (6 - this._echoLeft) * 0.08;
      const delay = this._lastStepInterval * desync * 1000;
      const side = this._wrongStepSide;
      const fwd = this.camera
        ? new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion)
        : new THREE.Vector3(0, 0, -1);
      fwd.y = 0;
      if (fwd.lengthSq() < 0.01) fwd.set(0, 0, -1);
      else fwd.normalize();
      const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
      const ghost = {
        x: position.x - fwd.x * (1.4 + Math.random()) + right.x * side * 1.2,
        y: 0.05,
        z: position.z - fwd.z * (1.4 + Math.random()) + right.z * side * 1.2,
      };
      setTimeout(() => this._stepAt(ghost, loudness * 0.55, surface), delay);
      return;
    }

    if (loudness < 0.2) return;
    this._echoCount++;
    if (!this._echoArmed && this._echoCount >= 4 + Math.floor(Math.random() * 3)) {
      this._echoArmed = true;
      this._echoLeft = 5;
      this._wrongStepSide = Math.random() < 0.5 ? -1 : 1;
      this._echoCount = 0;
    }
    if (this._echoArmed && this._echoLeft <= 0) {
      this._echoArmed = false;
      this._echoCount = 0;
    }
  }

  _stepAt(position, loudness, surface) {
    this._playAt(position, (out) => {
      const noiseBuf = this._noiseBurst(0.06);
      const src = this.ctx.createBufferSource();
      src.buffer = noiseBuf;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = surface === 'carpet' ? 900 : 2200;
      const gain = this.ctx.createGain();
      gain.gain.value = 0.15 * loudness;
      src.connect(filter).connect(gain).connect(out);
      src.start();
    });
  }

  houndSound(position, type = 'growl', intensity = 0.5) {
    if (type === 'wrong-step') {
      this._stepAt(position, 0.4 * intensity, 'tile');
      return;
    }
    this._playAt(position, (out) => {
      const t0 = this.ctx.currentTime;
      if (type === 'breath' || type === 'scrape') {
        const buf = this._noiseBurst(type === 'breath' ? 0.45 : 0.22);
        const src = this.ctx.createBufferSource();
        src.buffer = buf;
        const filt = this.ctx.createBiquadFilter();
        filt.type = type === 'breath' ? 'lowpass' : 'bandpass';
        filt.frequency.value = type === 'breath' ? 500 : 1400;
        filt.Q.value = type === 'scrape' ? 4 : 0.8;
        const g = this.ctx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18 * intensity, t0 + 0.04);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (type === 'breath' ? 0.5 : 0.25));
        src.connect(filt).connect(g).connect(out);
        src.start();
        return;
      }
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = type === 'snarl' ? 90 : 60;
      const g = this.ctx.createGain();
      const dur = type === 'snarl' ? 0.35 : 0.6;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.22 * intensity, t0 + 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      osc.connect(g).connect(out);
      osc.start();
      osc.stop(t0 + dur + 0.05);
    });
  }

  bacteriaSound(position, type = 'scrape', intensity = 0.5) {
    this._playAt(position, (out) => {
      const t0 = this.ctx.currentTime;
      const dur = type === 'breath' ? 0.72 : (type === 'snarl' ? 0.48 : 0.4);
      const buf = this._noiseBurst(dur);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = type === 'snarl' ? 0.52 : 0.32;
      const low = this.ctx.createBiquadFilter();
      low.type = 'lowpass';
      low.frequency.value = type === 'breath' ? 260 : (type === 'snarl' ? 400 : 320);
      low.Q.value = 0.8;
      const wet = this.ctx.createBiquadFilter();
      wet.type = 'bandpass';
      wet.frequency.value = 170;
      wet.Q.value = 2.4;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.2 * intensity, t0 + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(low).connect(wet).connect(g).connect(out);
      src.start();
      if (type === 'snarl' || type === 'scrape') {
        const osc = this.ctx.createOscillator();
        osc.type = 'sawtooth';
        osc.frequency.value = type === 'snarl' ? 36 : 29;
        const og = this.ctx.createGain();
        og.gain.setValueAtTime(0.0001, t0);
        og.gain.exponentialRampToValueAtTime(0.1 * intensity, t0 + 0.05);
        og.gain.exponentialRampToValueAtTime(0.0001, t0 + dur * 0.85);
        osc.connect(og).connect(out);
        osc.start();
        osc.stop(t0 + dur + 0.05);
      }
    });
  }

  pitReach(position, intensity = 0.5) {
    const k = Math.max(0.12, Math.min(1, intensity));
    this._playAt(position, (out) => {
      const t0 = this.ctx.currentTime;
      const buf = this._noiseBurst(0.38);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'lowpass';
      filt.frequency.value = 220 + k * 180;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(0.14 * k, t0 + 0.06);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.4);
      src.connect(filt).connect(g).connect(out);
      src.start();
      const osc = this.ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 48 + k * 22;
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.0001, t0);
      og.gain.exponentialRampToValueAtTime(0.08 * k, t0 + 0.05);
      og.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.36);
      osc.connect(og).connect(out);
      osc.start();
      osc.stop(t0 + 0.4);
    });
  }

  playDirectorCue(kind, playerPos, extra = {}) {
    const yaw = extra.yaw ?? 0;
    const world = extra.world;

    switch (kind) {
      case 'distant-knock':
        this._knockBeyondWall(playerPos, yaw, world);
        break;
      case 'behind-sound':
        this._behindPlayer(playerPos, yaw);
        break;
      case 'far-footsteps': {
        const pos = this._offset(playerPos, yaw, 10 + Math.random() * 8, Math.PI * (0.6 + Math.random() * 0.8));
        for (let i = 0; i < 4; i++) {
          setTimeout(() => this._stepAt(pos, 0.28, 'tile'), i * 400);
        }
        break;
      }
      case 'silence-drop':
        this._silenceUntil = this.ctx.currentTime + 2.4 + Math.random() * 1.6;
        this.bedGain.gain.setTargetAtTime(0.0008, this.ctx.currentTime, 0.04);
        break;
      case 'light-flicker':
      default:
        break;
    }
  }

  _knockBeyondWall(playerPos, yaw, world) {
    const pos = this._wallFarSide(playerPos, yaw, world);
    this._playAt(pos, (out) => {
      const t0 = this.ctx.currentTime;
      for (let i = 0; i < 2; i++) {
        const osc = this.ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = 70 + i * 18;
        const g = this.ctx.createGain();
        const t = t0 + i * 0.16;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.32, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.14);
        osc.connect(g).connect(out);
        osc.start(t);
        osc.stop(t + 0.18);
      }
    });
  }

  _behindPlayer(playerPos, yaw) {
    const pos = this._offset(playerPos, yaw, 2.2, Math.PI);
    this._playAt(pos, (out) => {
      const buf = this._noiseBurst(0.14);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      const filt = this.ctx.createBiquadFilter();
      filt.type = 'bandpass';
      filt.frequency.value = 700;
      const g = this.ctx.createGain();
      g.gain.value = 0.22;
      src.connect(filt).connect(g).connect(out);
      src.start();
    });
  }

  _wallFarSide(playerPos, yaw, world) {
    const dirs = [
      yaw,
      yaw + Math.PI / 2,
      yaw - Math.PI / 2,
      yaw + Math.PI,
    ];
    for (const a of dirs) {
      const fx = -Math.sin(a);
      const fz = -Math.cos(a);
      for (let step = 1; step <= 6; step++) {
        const x = playerPos.x + fx * step * 0.9;
        const z = playerPos.z + fz * step * 0.9;
        const walkable = world ? world.isWalkableLoaded(x, z) : true;
        if (world && !walkable) {
          return {
            x: playerPos.x + fx * (step * 0.9 + 1.1),
            y: 1.4,
            z: playerPos.z + fz * (step * 0.9 + 1.1),
          };
        }
        if (!world && step === 3) break;
      }
    }
    return this._offset(playerPos, yaw, 5, Math.PI / 2);
  }

  _offset(playerPos, yaw, dist, extraYaw) {
    const a = yaw + extraYaw;
    return {
      x: playerPos.x - Math.sin(a) * dist,
      y: 1.5,
      z: playerPos.z - Math.cos(a) * dist,
    };
  }

  _playTick() {
    const cam = this.camera;
    if (!cam) return;
    const pos = {
      x: cam.position.x + (Math.random() - 0.5) * 10,
      y: 2.4,
      z: cam.position.z + (Math.random() - 0.5) * 10,
    };
    this._playAt(pos, (out) => {
      const osc = this.ctx.createOscillator();
      osc.type = 'square';
      osc.frequency.value = 1800 + Math.random() * 400;
      const g = this.ctx.createGain();
      const t0 = this.ctx.currentTime;
      g.gain.setValueAtTime(0.03, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.04);
      osc.connect(g).connect(out);
      osc.start();
      osc.stop(t0 + 0.05);
    });
  }

  _noiseBurst(duration) {
    const len = Math.floor(this.ctx.sampleRate * duration);
    const buf = this.ctx.createBuffer(1, Math.max(1, len), this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / d.length);
    return buf;
  }
}
