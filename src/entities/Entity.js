import * as THREE from 'three';

// Shared behavior scaffolding for all Backrooms entities. Subclasses
// implement the actual state machine in onUpdate(). Kept deliberately
// generic so future entities (survivors, new monsters) can reuse it.
export class Entity {
  constructor(name, scene, world, eventBus) {
    this.name = name;
    this.scene = scene;
    this.world = world;
    this.bus = eventBus;
    this.position = new THREE.Vector3();
    this.state = 'dormant';
    this.visible = false;
    this.alive = true;
    this.object3d = null; // subclasses attach their mesh/group here
  }

  distanceTo(pointVec3) {
    return this.position.distanceTo(pointVec3);
  }

  setState(next) {
    if (this.state === next) return;
    const prev = this.state;
    this.state = next;
    this.bus.emit('entity-state', { entity: this.name, from: prev, to: next });
  }

  update(dt, ctx) {
    if (!this.alive) return;
    this.onUpdate(dt, ctx);
  }

  onUpdate(dt, ctx) { /* override */ }
}
