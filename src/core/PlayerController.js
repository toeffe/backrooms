import * as THREE from 'three';

const WALK_SPEED = 2.6;
const SPRINT_SPEED = 4.6;
const CROUCH_SPEED = 1.4;
const EYE_HEIGHT = 1.68;
const CROUCH_HEIGHT = 1.0;
const RADIUS = 0.35;
const STAMINA_MAX = 100;
const STAMINA_DRAIN = 22; // per second while sprinting
const STAMINA_REGEN = 14;

export class PlayerController {
  constructor(camera, domElement, world, eventBus) {
    this.camera = camera;
    this.dom = domElement;
    this.world = world;
    this.bus = eventBus;

    this.position = new THREE.Vector3(0, EYE_HEIGHT, 0);
    this.velocity = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;

    this.keys = new Set();
    this.locked = false;
    this.crouching = false;
    this.sprinting = false;
    this.stamina = STAMINA_MAX;
    this.currentHeight = EYE_HEIGHT;
    this.headBobT = 0;
    this._swayT = 0;
    this._moving = false;
    this.footstepTimer = 0;
    this.noiseLevel = 0; // 0..1, consumed by AI hearing
    this.noclip = false;
    this.canRequestLock = true;
    this.sensitivity = 0.0022;
    this.invertY = false;
    this.reduceMotion = false;

    this._bindEvents();
  }

  _bindEvents() {
    this._onClick = () => {
      if (!this.locked && this.canRequestLock) this.dom.requestPointerLock();
    };
    this._onLock = () => {
      this.locked = document.pointerLockElement === this.dom;
      this.bus.emit('pointerlock', this.locked);
    };
    this._onMove = (e) => {
      if (!this.locked) return;
      const sensitivity = this.sensitivity || 0.0022;
      const invert = this.invertY ? -1 : 1;
      this.yaw -= e.movementX * sensitivity;
      this.pitch -= e.movementY * sensitivity * invert;
      this.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, this.pitch));
    };
    this._onKeyDown = (e) => {
      this.keys.add(e.code);
      if (e.code === 'Space') e.preventDefault();
      if (e.code === 'KeyN' && !e.repeat && window.__BR_DEBUG) this.setNoclip(!this.noclip);
    };
    this._onKeyUp = (e) => this.keys.delete(e.code);
    this.dom.addEventListener('click', this._onClick);
    document.addEventListener('pointerlockchange', this._onLock);
    document.addEventListener('mousemove', this._onMove);
    document.addEventListener('keydown', this._onKeyDown);
    document.addEventListener('keyup', this._onKeyUp);
  }

  dispose() {
    this.dom.removeEventListener('click', this._onClick);
    document.removeEventListener('pointerlockchange', this._onLock);
    document.removeEventListener('mousemove', this._onMove);
    document.removeEventListener('keydown', this._onKeyDown);
    document.removeEventListener('keyup', this._onKeyUp);
    this.keys.clear();
  }

  teleport(vec3) {
    this.position.set(vec3.x, this.noclip ? (vec3.y || this.currentHeight) : this.currentHeight, vec3.z);
    this.velocity.set(0, 0, 0);
  }

  setNoclip(on) {
    if (on === this.noclip) return;
    this.noclip = on;
    if (!on) this._exitNoclip();
    this.bus.emit('noclip', this.noclip);
    this.bus.emit('message', this.noclip
      ? 'Noclip. WASD fly · Space up · Ctrl down · Shift fast · N walk'
      : 'Noclip off.');
  }

  _exitNoclip() {
    this.currentHeight = EYE_HEIGHT;
    this.position.y = EYE_HEIGHT;
    let x = this.position.x;
    let z = this.position.z;
    if (!this.world.isWalkable(x, z)) {
      const step = 5;
      let found = false;
      for (let r = 1; r <= 16 && !found; r++) {
        for (let dy = -r; dy <= r && !found; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (r > 0 && Math.abs(dx) !== r && Math.abs(dy) !== r) continue;
            const tx = x + dx * step;
            const tz = z + dy * step;
            if (this.world.isWalkable(tx, tz)) {
              x = tx;
              z = tz;
              found = true;
              break;
            }
          }
        }
      }
    }
    const resolved = this.world.resolveCollision({ x, z }, RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;
    this.velocity.set(0, 0, 0);
  }

  update(dt) {
    if (!this.locked) { this._applyCamera(); return; }

    if (this.noclip) {
      this._updateNoclip(dt);
      this._applyCamera();
      return;
    }

    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    this.crouching = this.keys.has('KeyC');
    const wantsSprint = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    this.sprinting = wantsSprint && !this.crouching && (forward !== 0 || strafe !== 0) && this.stamina > 0.5;

    if (this.sprinting) {
      this.stamina = Math.max(0, this.stamina - STAMINA_DRAIN * dt);
    } else {
      this.stamina = Math.min(STAMINA_MAX, this.stamina + STAMINA_REGEN * dt);
    }

    let speed = this.crouching ? CROUCH_SPEED : (this.sprinting ? SPRINT_SPEED : WALK_SPEED);

    const moveDir = new THREE.Vector3(strafe, 0, -forward);
    const moving = moveDir.lengthSq() > 0;
    this._moving = moving;
    this._swayT += dt * (moving ? 1 : 0.35);
    if (moving) {
      moveDir.normalize();
      moveDir.applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw);
      this.velocity.x = moveDir.x * speed;
      this.velocity.z = moveDir.z * speed;
    } else {
      this.velocity.x = 0;
      this.velocity.z = 0;
    }

    // Axis-separated movement: resolve X, then Z. Prevents corner tunneling
    // and stops the classic "slide through diagonal walls" failure mode.
    const tryX = this.position.x + this.velocity.x * dt;
    const tryZ = this.position.z + this.velocity.z * dt;

    let resolved = this.world.resolveCollision({ x: tryX, z: this.position.z }, RADIUS);
    this.position.x = resolved.x;
    resolved = this.world.resolveCollision({ x: this.position.x, z: tryZ }, RADIUS);
    this.position.x = resolved.x;
    this.position.z = resolved.z;

    // crouch height lerp
    const targetHeight = this.crouching ? CROUCH_HEIGHT : EYE_HEIGHT;
    this.currentHeight += (targetHeight - this.currentHeight) * Math.min(1, dt * 8);
    this.position.y = this.currentHeight;

    // head bob + footsteps + noise emission
    if (moving) {
      const bobSpeed = this.sprinting ? 11 : (this.crouching ? 6 : 8.5);
      this.headBobT += dt * bobSpeed;
      this.footstepTimer -= dt;
      if (this.footstepTimer <= 0) {
        const interval = this.sprinting ? 0.32 : (this.crouching ? 0.55 : 0.42);
        this.footstepTimer = interval;
        this.noiseLevel = this.crouching ? 0.15 : (this.sprinting ? 1.0 : 0.5);
        this.bus.emit('footstep', { position: this.position.clone(), loudness: this.noiseLevel });
      }
    } else {
      this.headBobT *= 0.9;
      this.noiseLevel *= 0.9;
    }

    this._applyCamera();
  }

  _updateNoclip(dt) {
    this.crouching = false;
    this.sprinting = false;
    this.noiseLevel = 0;
    this.headBobT = 0;
    const forward = (this.keys.has('KeyW') ? 1 : 0) - (this.keys.has('KeyS') ? 1 : 0);
    const strafe = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const vert = (this.keys.has('Space') ? 1 : 0)
      - (this.keys.has('ControlLeft') || this.keys.has('ControlRight') ? 1 : 0);
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const speed = fast ? 22 : 9;

    const look = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    const right = new THREE.Vector3(1, 0, 0).applyEuler(new THREE.Euler(0, this.yaw, 0, 'YXZ'));
    const moving = forward !== 0 || strafe !== 0 || vert !== 0;
    this._moving = moving;
    this._swayT += dt * 0.2;

    if (forward) this.position.addScaledVector(look, forward * speed * dt);
    if (strafe) this.position.addScaledVector(right, strafe * speed * dt);
    if (vert) this.position.y += vert * speed * dt;

    this.currentHeight = this.position.y;
    this.velocity.set(0, 0, 0);
  }

  _applyCamera() {
    const reduce = this.reduceMotion || this.noclip;
    const bobY = reduce ? 0 : Math.sin(this.headBobT) * (this.crouching ? 0.01 : 0.022);
    const bobX = reduce ? 0 : Math.cos(this.headBobT * 0.5) * 0.012;
    const sway = reduce ? 0 : (this._moving ? 1 : 0.22);
    const hx = Math.sin(this._swayT * 1.15) * 0.014 * sway;
    const hz = Math.cos(this._swayT * 0.85) * 0.01 * sway;
    const roll = Math.sin(this._swayT * 0.65) * 0.008 * sway;
    this.camera.position.set(
      this.position.x + bobX + hx,
      this.position.y + bobY,
      this.position.z + hz
    );
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.y = this.yaw;
    this.camera.rotation.x = this.pitch;
    this.camera.rotation.z = roll;
  }

  getForwardVector() {
    return new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
  }
}
