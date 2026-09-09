import * as THREE from 'three';

const DRAIN_RATE = 100 / 240;
const FLICKER_THRESHOLD = 15;

export class Flashlight {
  constructor(camera, scene, eventBus) {
    this.bus = eventBus;
    this.camera = camera;
    this.scene = scene;
    this.on = false;
    this.battery = 100;
    this.flickerState = 1;
    this._flickerTimer = 0;
    this.killedTimer = 0;

    this.light = new THREE.SpotLight(0xfff0d0, 0, 16, Math.PI / 6, 0.55, 1.35);
    this.light.castShadow = false;
    this.light.shadow.mapSize.set(512, 512);
    this.light.shadow.bias = -0.002;

    this.target = new THREE.Object3D();
    scene.add(this.target);
    this.light.target = this.target;
    camera.add(this.light);
    this.light.position.set(0.15, -0.1, 0.05);
    scene.add(camera);
  }

  dispose() {
    this.camera.remove(this.light);
    this.scene.remove(this.target);
    this.light.dispose?.();
  }

  toggle() {
    if (this.killedTimer > 0) return;
    if (this.battery <= 0) { this.on = false; return; }
    this.on = !this.on;
    this.bus.emit('flashlight-toggle', this.on);
  }

  kill(seconds = 10) {
    this.killedTimer = seconds;
    this.on = false;
    this.light.intensity = 0;
  }

  drain(amount) {
    this.battery = Math.max(0, this.battery - amount);
    if (this.battery <= 0) this.on = false;
  }

  addBattery(amount) {
    this.battery = Math.min(100, this.battery + amount);
  }

  update(dt, camera) {
    if (this.killedTimer > 0) {
      this.killedTimer -= dt;
      this.on = false;
    }

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    this.target.position.copy(camera.position).add(dir.multiplyScalar(5));

    if (this.on && this.battery > 0) {
      this.battery = Math.max(0, this.battery - DRAIN_RATE * dt);
      if (this.battery <= 0) { this.on = false; }
    }

    let targetIntensity = 0;
    if (this.on && this.battery > 0 && this.killedTimer <= 0) {
      targetIntensity = 32;
      if (this.battery < FLICKER_THRESHOLD) {
        this._flickerTimer -= dt;
        if (this._flickerTimer <= 0) {
          this._flickerTimer = 0.05 + Math.random() * 0.25;
          this.flickerState = Math.random() < 0.3 ? 0.1 : 1;
        }
        targetIntensity *= this.flickerState;
      }
    }
    this.light.intensity += (targetIntensity - this.light.intensity) * Math.min(1, dt * 20);
  }
}
