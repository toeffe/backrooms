import * as THREE from 'three';
import { EventBus } from './core/EventBus.js';
import { PlayerController } from './core/PlayerController.js';
import { World } from './world/World.js';
import { CELL_SIZE, CHUNK_CELLS, WALL } from './world/LevelGenerator.js';
import { Flashlight } from './systems/Flashlight.js';
import { Camcorder } from './systems/Camcorder.js';
import { Inventory } from './systems/Inventory.js';
import { Interactables } from './systems/Interactables.js';
import { SaveSystem } from './systems/SaveSystem.js';
import { Settings } from './systems/Settings.js';
import { MapSystem } from './systems/MapSystem.js';
import { AudioSystem } from './audio/AudioSystem.js';
import { VoiceSystem } from './audio/VoiceSystem.js';
import { UIController } from './ui/UIController.js';
import { PitArm } from './entities/PitArm.js';

class Game {
  constructor() {
    this.bus = new EventBus();
    this.ui = new UIController(this.bus);
    this.saveSystem = new SaveSystem();
    this.settings = new Settings();
    this.clock = new THREE.Clock();
    this.playing = false;
    this.paused = false;
    this._unsub = [];
    this._zoneId = null;

    const params = new URLSearchParams(window.location.search);
    window.__BR_DEBUG = params.get('debug') === '1'
      || localStorage.getItem('backrooms_debug') === '1';
    const seedRaw = params.get('seed');
    const seedNum = seedRaw != null && seedRaw !== '' ? Number(seedRaw) : NaN;
    this._urlSeed = Number.isFinite(seedNum) ? seedNum : null;

    this._setupRenderer();
    this._setupScene();
    this._applySettings();
    this._bindSettingsUI();

    this.ui.showLoading(false);
    this.ui.setContinueEnabled(this.saveSystem.hasSave());

    document.getElementById('btn-new').addEventListener('click', () => {
      if (this._urlSeed != null) this.startNewGame(this._urlSeed);
      else this.startNewGame();
    });
    document.getElementById('btn-continue').addEventListener('click', () => this.continueGame());
    document.getElementById('btn-resume').addEventListener('click', () => this.resumeGame());
    document.getElementById('btn-main-menu').addEventListener('click', () => this.returnToMenu());
    document.getElementById('btn-restart').addEventListener('click', () => this.restartRun());
    document.getElementById('btn-settings').addEventListener('click', () => this.openSettings());

    const clickToPlay = document.getElementById('click-to-play');
    if (clickToPlay) {
      clickToPlay.addEventListener('click', () => {
        if (!this.playing || this.paused) return;
        this._requestLockSoon();
        this.audio?.resume();
      });
    }

    window.addEventListener('resize', () => this._onResize());
    this._bindGameplayKeys();
  }

  _setupRenderer() {
    const canvas = document.getElementById('scene');
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.shadowMap.enabled = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.1;
  }

  _setupScene() {
    this.scene = new THREE.Scene();
    const yellow = 0xc4b070;
    this.scene.background = new THREE.Color(yellow);
    this.scene.fog = new THREE.FogExp2(yellow, 0.018);
    this.camera = new THREE.PerspectiveCamera(79, window.innerWidth / window.innerHeight, 0.05, 120);

    this.ambient = new THREE.AmbientLight(0xd4c078, 0.16);
    this.scene.add(this.ambient);
    this.hemi = new THREE.HemisphereLight(0xf0e0a0, 0x8a7030, 0.18);
    this.scene.add(this.hemi);
  }

  _onResize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
  }

  startNewGame(seed = Math.floor(Math.random() * 1e9)) {
    this.paused = false;
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this._teardownIfNeeded();
    this._buildWorldSystems(seed);
    this.saveSystem.clear();
    this.player.teleport(this.world.findSpawn());
    this._beginOpeningSequence();
  }

  continueGame() {
    const data = this.saveSystem.load();
    if (!data) return this.startNewGame();
    this._teardownIfNeeded();
    this._buildWorldSystems(data.seed);
    this.player.position.set(data.pos.x, data.pos.y, data.pos.z);
    this.player.yaw = data.yaw || 0;
    this.player.pitch = data.pitch || 0;
    this.player.stamina = data.stamina ?? 100;
    this.player.crouching = !!data.crouching;
    this.flashlight.battery = data.flashlightBattery ?? 100;
    this.inventory.load(data.inventory || []);
    if (data.discoveredCells) this.mapSystem.discovered = new Set(data.discoveredCells);
    if (data.camcorder) this.camcorder.load(data.camcorder);
    if (data.removedKeys) this.interactables.removedKeys = new Set(data.removedKeys);
    this.ui.showMenu(false);
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this.ui.showHUD(true);
    this.ui.fadeIn();
    this.playing = true;
    this.paused = false;
    this.bus.emit('message', 'The rooms are as you left them.');
  }

  _on(evt, fn) {
    this.bus.on(evt, fn);
    this._unsub.push(() => this.bus.off(evt, fn));
  }

  _teardownIfNeeded() {
    for (const off of this._unsub) off();
    this._unsub = [];
    this.playing = false;
    this.paused = false;
    if (this.voice) this.voice.dispose();
    if (this.camcorder) this.camcorder.dispose();
    if (this.entities) {
      this.entities.pitArm?.dispose();
    }
    if (this.flashlight) this.flashlight.dispose();
    if (this.player) this.player.dispose();
    if (this.interactables) this.interactables.dispose();
    if (this.world) this.world.dispose();
    this.world = null;
  }

  _buildWorldSystems(seed) {
    this.seed = seed;
    this._zoneId = null;
    this.world = new World(this.scene, seed);
    this.player = new PlayerController(this.camera, this.renderer.domElement, this.world, this.bus);
    this.flashlight = new Flashlight(this.camera, this.scene, this.bus);
    this.camcorder = new Camcorder(this.bus, this.scene);
    this.inventory = new Inventory(this.bus);
    this.interactables = new Interactables(this.scene, this.world, this.bus, this.inventory);
    this._unsub.push(this.world.onChunkLoaded(({ chunk, cx, cy }) => {
      this.interactables.populateChunk(chunk, cx, cy);
    }));
    this._unsub.push(this.world.onChunkUnloaded(({ cx, cy }) => {
      this.interactables.clearChunk(cx, cy);
    }));
    this.mapSystem = new MapSystem(this.world);
    this.audio = new AudioSystem(this.camera);
    this.voice = new VoiceSystem(this.bus, this.audio.ctx, this.audio.master);
    this._applySettings();

    this.entities = {
      pitArm: new PitArm(this.scene, this.world, this.bus),
    };

    this._on('footstep', (e) => {
      this.audio.footstep(e.position, e.loudness);
    });
    this._on('pit-reach', (e) => this.audio.pitReach(e.position, e.intensity));
    this._on('player-caught', (e) => this._onPlayerCaught(e));
    this._on('battery-pickup', () => {
      this.flashlight.addBattery(35);
      this.bus.emit('message', 'Battery slotted into the flashlight.');
    });
    this._on('pointerlock', (locked) => {
      if (locked) this.audio.resume();
      this._syncClickToPlay(locked);
    });

    this.fear = 0;
  }

  _beginOpeningSequence() {
    this.ui.showMenu(false);
    this.ui.showHUD(false);
    this.ui.fadeOut(() => {
      this.ui.showHUD(true);
      this.ui.fadeIn();
      this.playing = true;
      this.bus.emit('message', 'The floor is carpet. The lights hum.');
    });
  }

  _onPlayerCaught(e) {
    if (this.player?.noclip) return;
    if (e?.by !== 'pit') return;
    this.fear = 1;
    this.ui.setFear(1);
    this.ui.triggerJumpscare('pit');
    if (e.toward) {
      const dx = e.toward.x - this.player.position.x;
      const dz = e.toward.z - this.player.position.z;
      const len = Math.hypot(dx, dz) || 1;
      this.player.position.x += (dx / len) * 1.35;
      this.player.position.z += (dz / len) * 1.35;
    }
    const fixed = this.world.resolveCollision(
      { x: this.player.position.x, z: this.player.position.z },
      0.35
    );
    this.player.position.x = fixed.x;
    this.player.position.z = fixed.z;

    this.flashlight.drain(40);
    this.mapSystem.forgetRandom(16);
    this.player.stamina = 0;
    this.bus.emit('message', 'IT REACHED FROM THE HOLE.');
    this.ui.fadeOut(() => {
      this._displaceAfterPitGrab();
      this.ui.fadeIn();
      this.bus.emit('message', 'You lost time.');
    });
  }

  _displaceAfterPitGrab() {
    const here = this.player.position;
    const picks = [];
    for (const entry of this.world.loaded.values()) {
      const chunk = entry.chunk;
      if (!chunk) continue;
      const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
      const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
      const size = chunk.size;
      const blocked = new Set((chunk.pockets || []).map((p) => `${p.x},${p.y}`));
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          if (chunk.cells[y * size + x] === WALL) continue;
          if (blocked.has(`${x},${y}`)) continue;
          const wx = originX + (x + 0.5) * CELL_SIZE;
          const wz = originZ + (y + 0.5) * CELL_SIZE;
          const d = Math.hypot(wx - here.x, wz - here.z);
          if (d < 18 || d > 62) continue;
          if (!this.world.isWalkableLoaded(wx, wz)) continue;
          picks.push({ x: wx, z: wz });
        }
      }
    }
    if (!picks.length) {
      this.player.teleport(this.world.findSpawn());
      return;
    }
    const pick = picks[Math.floor(Math.random() * picks.length)];
    this.player.teleport(new THREE.Vector3(pick.x, 0, pick.z));
  }

  _bindGameplayKeys() {
    document.addEventListener('keydown', (e) => {
      if (!this.playing) return;
      if (this.paused && e.code !== 'Escape') return;
      if (e.code === 'KeyF') { this.flashlight.toggle(); this.audio.resume(); }
      if (e.code === 'KeyV') { this.camcorder.toggle(); this.audio.resume(); }
      if (e.code === 'Tab') {
        e.preventDefault();
        const active = this.ui.toggleInventory();
        this._releasePointerLockIfPanelOpen(active);
      }
      if (e.code === 'KeyM') {
        const active = this.ui.toggleMap();
        this._releasePointerLockIfPanelOpen(active);
      }
      if (e.code === 'KeyE') {
        this._tryInteract();
      }
      if (e.code === 'Escape') {
        if (this.ui.isSettingsOpen()) { this.ui.showSettings(false); return; }
        if (this.ui.el.inventory.classList.contains('active') || this.ui.el.mapview.classList.contains('active')) {
          this.ui.toggleInventory(false);
          this.ui.toggleMap(false);
          this._requestLockSoon();
        }
        else if (this.paused || this.ui.isPaused()) this.resumeGame();
        else this.openPause();
      }
    });
  }

  openPause() {
    if (!this.playing || this.paused) return;
    this.paused = true;
    this.ui.showPause(true);
    this.ui.showClickToPlay(false);
    if (this.player) this.player.canRequestLock = false;
    document.exitPointerLock && document.exitPointerLock();
    this._autosave();
  }

  _syncClickToPlay(locked) {
    const show = this.playing && !this.paused && !this.ui.isAnyPanelOpen() && !locked;
    this.ui.showClickToPlay(show);
  }

  resumeGame() {
    if (!this.playing) return;
    this.paused = false;
    this.ui.showPause(false);
    this.ui.showSettings(false);
    if (this.player) this.player.canRequestLock = true;
    this._requestLockSoon();
    this.audio?.resume();
  }

  openSettings() {
    if (!this.playing) return;
    if (!this.paused) this.openPause();
    this._syncSettingsFields();
    this.ui.showSettings(true);
  }

  _bindSettingsUI() {
    const master = document.getElementById('set-master');
    const sfx = document.getElementById('set-sfx');
    const look = document.getElementById('set-look');
    const fov = document.getElementById('set-fov');
    const invert = document.getElementById('set-inverty');
    const motion = document.getElementById('set-motion');
    if (!master || !sfx || !look || !fov || !invert || !motion) return;

    const onNum = (el, key, map) => {
      el.addEventListener('input', () => {
        this.settings.set(key, map(Number(el.value)));
        this._applySettings();
      });
    };
    onNum(master, 'master', (v) => v / 100);
    onNum(sfx, 'sfx', (v) => v / 100);
    onNum(look, 'sensitivity', (v) => v / 10000);
    onNum(fov, 'fov', (v) => v);
    invert.addEventListener('change', () => {
      this.settings.set('invertY', invert.checked);
      this._applySettings();
    });
    motion.addEventListener('change', () => {
      this.settings.set('reduceMotion', motion.checked);
      this._applySettings();
    });
    this._syncSettingsFields();
  }

  _syncSettingsFields() {
    const d = this.settings.data;
    const master = document.getElementById('set-master');
    const sfx = document.getElementById('set-sfx');
    const look = document.getElementById('set-look');
    const fov = document.getElementById('set-fov');
    const invert = document.getElementById('set-inverty');
    const motion = document.getElementById('set-motion');
    if (master) master.value = Math.round(d.master * 100);
    if (sfx) sfx.value = Math.round(d.sfx * 100);
    if (look) look.value = Math.round(d.sensitivity * 10000);
    if (fov) fov.value = Math.round(d.fov);
    if (invert) invert.checked = !!d.invertY;
    if (motion) motion.checked = !!d.reduceMotion;
  }

  _applySettings() {
    const d = this.settings.data;
    if (this.camera) {
      this.camera.fov = d.fov;
      this.camera.updateProjectionMatrix();
    }
    if (this.player) {
      this.player.sensitivity = d.sensitivity;
      this.player.invertY = d.invertY;
      this.player.reduceMotion = d.reduceMotion;
    }
    if (this.audio) this.audio.setVolumes(d.master, d.sfx);
    if (this.voice) this.voice.setVolume(d.sfx);
  }

  returnToMenu() {
    this._autosave();
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this._teardownIfNeeded();
    this.paused = false;
    this.ui.showHUD(false);
    this.ui.showMenu(true);
    this.ui.setContinueEnabled(this.saveSystem.hasSave());
    this.ui.showClickToPlay(false);
  }

  restartRun() {
    this.paused = false;
    this.ui.showPause(false);
    this.ui.showSettings(false);
    this.saveSystem.clear();
    this.startNewGame();
  }

  _releasePointerLockIfPanelOpen(open) {
    if (open) { document.exitPointerLock && document.exitPointerLock(); }
  }
  _requestLockSoon() {
    if (this.paused) return;
    if (this.player && !this.player.canRequestLock) return;
    setTimeout(() => this.renderer.domElement.requestPointerLock(), 50);
  }

  _tryInteract() {
    const obj = this.interactables.getNearestInteractable(this.player.position);
    if (obj) this.interactables.interact(obj);
  }

  _autosave() {
    if (!this.playing) return;
    if (!this.player || !this.world) return;
    this.saveSystem.save({
      version: 3,
      seed: this.seed,
      pos: { x: this.player.position.x, y: this.player.position.y, z: this.player.position.z },
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      stamina: this.player.stamina,
      crouching: !!this.player.crouching,
      flashlightBattery: this.flashlight.battery,
      inventory: this.inventory.serialize(),
      discoveredCells: Array.from(this.mapSystem.discovered),
      camcorder: this.camcorder.serialize(),
      removedKeys: Array.from(this.interactables.removedKeys),
    });
  }

  update() {
    const dt = Math.min(0.05, this.clock.getDelta());
    requestAnimationFrame(() => this.update());
    this.renderer.render(this.scene, this.camera);

    if (window.__BR_DEBUG) this._tickDebug(dt);
    else {
      const dbg = document.getElementById('debug');
      if (dbg) dbg.classList.remove('show');
    }

    if (!this.playing) return;
    if (this.paused) return;
    if (this.ui.isAnyPanelOpen()) {
      if (this.ui.el.mapview.classList.contains('active')) {
        this.mapSystem.draw(this.ui.el.mapCanvas.getContext('2d'), this.ui.el.mapCanvas, this.player.position, this.player.yaw);
      }
      return;
    }

    this.player.update(dt);
    this.world.update(this.player.position, dt);
    this._syncZoneHud();
    this.flashlight.update(dt, this.camera);
    this.camcorder.update(dt, { playerPos: this.player.position, camera: this.camera });
    this.interactables.update(dt, this.player.position);
    this.mapSystem.update(this.player.position);

    this.audio.update(this.camera, { dt, zoneId: this._zoneId });

    const nearestLight = this.world.nearestWorkingLight(this.player.position);
    const ctx = {
      dt,
      playerPos: this.player.position,
      playerGrid: {
        gx: Math.floor(this.player.position.x / CELL_SIZE),
        gy: Math.floor(this.player.position.z / CELL_SIZE),
      },
      camera: this.camera,
      flashlightOn: this.flashlight.on && this.flashlight.battery > 0 && this.flashlight.killedTimer <= 0,
      playerHidden: this.player.crouching,
      noclip: !!this.player.noclip,
      yaw: this.player.yaw,
      nearestLight,
    };
    this.entities.pitArm.update(dt, ctx);

    this.fear *= 0.985;
    if (this.entities.pitArm) this.fear = Math.max(this.fear, this.entities.pitArm.reach * 0.7);
    this.ui.setFear(this.fear);
    this.ui.updateVitals(this.flashlight.battery, this.player.stamina);

    const nearest = this.interactables.getNearestInteractable(this.player.position);
    this.ui.setInteractPrompt(nearest ? this._promptLabel(nearest) : null);
    this.ui.setCrosshairVisible(this.player.locked);

    this._autosaveTimer = (this._autosaveTimer || 0) + dt;
    if (this._autosaveTimer > 10) { this._autosaveTimer = 0; this._autosave(); }
  }

  _promptLabel(obj) {
    if (obj.type === 'battery') return 'E — Pick up battery';
    return 'E — Pick up item';
  }

  _syncZoneHud() {
    const { cx, cy } = this.world.currentChunk;
    if (!Number.isFinite(cx) || cx === Infinity) return;
    const chunk = this.world.generator.getChunk(cx, cy);
    const zone = chunk.zone;
    const id = zone?.id || 'lobby';
    if (id === this._zoneId) return;
    this._zoneId = id;
    this.bus.emit('zone-enter', zone);
  }

  _tickDebug(dt) {
    this._debugTimer = (this._debugTimer || 0) + dt;
    if (this._debugTimer < 0.5 && document.getElementById('debug')?.classList.contains('show')) return;
    this._debugTimer = 0;
    const el = document.getElementById('debug');
    if (!el) return;
    if (!this.playing || !this.player || !this.world) {
      el.classList.remove('show');
      return;
    }
    const { cx, cy } = this.world.currentChunk;
    const arm = this.entities?.pitArm;
    const armBit = arm
      ? `pitArm:${arm.state || '?'} r${(arm.reach || 0).toFixed(2)}`
      : 'pitArm:none';
    el.textContent = [
      `zone ${this._zoneId || '?'}`,
      `sta ${this.player.stamina.toFixed(0)}`,
      `chunk ${cx},${cy}`,
      armBit,
    ].join(' · ');
    el.classList.add('show');
  }
}

const game = new Game();
game.update();
