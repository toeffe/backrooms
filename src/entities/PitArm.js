import * as THREE from 'three';
import { Entity } from './Entity.js';

const WARN_EDGE = 6.2;
const CREEP_IN = 0.2;
const CREEP_CLOSE = 0.34;
const CREEP_OUT = 0.7;
const SEG_COUNT = 6;

export class PitArm extends Entity {
  constructor(scene, world, bus) {
    super('pitArm', scene, world, bus);

    this.reach = 0;
    this.cooldown = 0;
    this._audioCd = 0;
    this._t = 0;
    this._grabLock = 0;

    const mat = new THREE.MeshBasicMaterial({
      color: 0x3a0a0c,
      toneMapped: false,
      fog: false,
    });
    this._mat = mat;

    this.root = new THREE.Group();
    this.root.visible = false;
    this.root.renderOrder = 4;
    scene.add(this.root);

    this.stump = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), mat);
    this.root.add(this.stump);

    this.segs = [];
    for (let i = 0; i < SEG_COUNT; i++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), mat);
      s.scale.set(1.15, 0.42, 1.35);
      this.root.add(s);
      this.segs.push(s);
    }

    this.hand = new THREE.Group();
    const palm = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.11, 0.3), mat);
    palm.position.set(0, 0.06, 0);
    this.hand.add(palm);

    this.fingers = [];
    const spans = [-0.14, -0.048, 0.048, 0.14];
    for (let i = 0; i < 4; i++) {
      const prox = new THREE.Group();
      prox.position.set(spans[i], 0.06, -0.16);
      const a = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.075, 0.15), mat);
      a.position.z = -0.07;
      const dist = new THREE.Group();
      dist.position.z = -0.14;
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.14), mat);
      b.position.z = -0.07;
      dist.add(b);
      prox.add(a, dist);
      prox.userData.tip = dist;
      this.hand.add(prox);
      this.fingers.push(prox);
    }
    const thumb = new THREE.Group();
    thumb.position.set(-0.2, 0.055, -0.02);
    thumb.rotation.y = 0.75;
    const tm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.065, 0.13), mat);
    tm.position.z = -0.06;
    thumb.add(tm);
    this.hand.add(thumb);
    this.thumb = thumb;
    this.root.add(this.hand);
  }

  dispose() {
    this.scene.remove(this.root);
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    this._mat.dispose();
  }

  onUpdate(dt, ctx) {
    this._t += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this._grabLock = Math.max(0, this._grabLock - dt);
    this._audioCd = Math.max(0, this._audioCd - dt);

    if (ctx.noclip) {
      this.reach = Math.max(0, this.reach - dt * 2);
      this.root.visible = this.reach > 0.02;
      return;
    }

    const pos = ctx.playerPos;
    const pocket = this.world.nearestPocket(pos.x, pos.z);
    const close = pocket && pocket.edgeDist < WARN_EDGE && this.cooldown <= 0;

    if (close) {
      const haste = pocket.edgeDist < 2.2 ? CREEP_CLOSE : CREEP_IN;
      this.reach = Math.min(1, this.reach + dt * haste);
    } else {
      this.reach = Math.max(0, this.reach - dt * CREEP_OUT);
    }

    if (!pocket || this.reach <= 0.02) {
      this.root.visible = false;
      return;
    }

    const t = this.reach;
    const dx = pos.x - pocket.x;
    const dz = pos.z - pocket.z;
    const plen = Math.hypot(dx, dz) || 1;
    const nx = dx / plen;
    const nz = dz / plen;
    const lipX = pocket.x + nx * pocket.hw;
    const lipZ = pocket.z + nz * pocket.hw;
    const toPlayer = Math.max(0.3, plen - pocket.hw);
    const crawl = t * Math.min(4.4, Math.max(0.5, toPlayer - 0.45));

    this.root.visible = true;
    this.root.position.set(lipX, 0, lipZ);
    this.root.rotation.set(0, Math.atan2(nx, nz), 0);

    const gait = Math.sin(this._t * 6.5);

    this.stump.position.set(0, THREE.MathUtils.lerp(-0.35, 0.07, Math.min(1, t * 2.2)), -0.1);
    this.stump.scale.set(1.4, THREE.MathUtils.lerp(0.4, 0.55, t), 1.25);

    for (let i = 0; i < this.segs.length; i++) {
      const u = (i + 1) / (this.segs.length + 1);
      const z = u * crawl;
      const wave = Math.sin(this._t * 7.2 - i * 0.95) * 0.055 * t;
      const s = this.segs[i];
      s.visible = crawl * u > 0.04;
      s.position.set(Math.sin(this._t * 2.4 + i) * 0.04 * t, 0.08 + wave, z);
      const fat = 1.05 + 0.12 * Math.sin(this._t * 5 + i);
      s.scale.set(1.2 * fat, 0.45, 1.45);
    }

    this.hand.position.set(gait * 0.05 * t, 0.09 + Math.abs(gait) * 0.03 * t, crawl);
    this.hand.rotation.z = gait * 0.22 * t;
    this.hand.rotation.y = Math.PI;

    for (let i = 0; i < this.fingers.length; i++) {
      const f = this.fingers[i];
      const lift = Math.max(0, Math.sin(this._t * 8.2 + i * 1.5));
      f.rotation.x = -0.05 - lift * 0.85;
      f.userData.tip.rotation.x = 0.1 + lift * 0.7;
    }
    this.thumb.rotation.y = 0.75 + gait * 0.15;
    this.thumb.rotation.x = -0.2 - Math.max(0, gait) * 0.35;

    if (t > 0.45 && toPlayer - crawl < 1.25) {
      const pull = (t - 0.4) * dt * 1.15;
      pos.x -= nx * pull;
      pos.z -= nz * pull;
    }

    if (this._audioCd <= 0 && t > 0.08 && close) {
      this._audioCd = 0.42;
      this.bus.emit('pit-reach', {
        position: { x: lipX + nx * crawl, y: 0.2, z: lipZ + nz * crawl },
        intensity: t,
      });
    }

    const handDist = Math.max(0, toPlayer - crawl);
    if (this._grabLock <= 0 && t >= 0.4 && handDist < 0.7) {
      this._grabLock = 1.2;
      this.cooldown = 9;
      this.bus.emit('player-caught', { by: 'pit', toward: { x: pocket.x, z: pocket.z } });
      this.reach = 0.28;
    }
  }
}
