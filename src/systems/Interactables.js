import * as THREE from 'three';
import { CELL_SIZE, CHUNK_CELLS, FLOOR, WALL } from '../world/LevelGenerator.js';
import { withBake } from '../world/Materials.js';

const INTERACT_RANGE = 2.4;

export class Interactables {
  constructor(scene, world, bus, inventory) {
    this.scene = scene;
    this.world = world;
    this.bus = bus;
    this.inventory = inventory;
    this.objects = [];
    this.spawnedChunks = new Set();
    this.removedKeys = new Set();

    this.batteryMat = withBake(new THREE.MeshStandardMaterial({
      color: 0x3a8a3a,
      emissive: 0x1a3a1a,
      emissiveIntensity: 0.35,
    }));
  }

  dispose() {
    for (const o of this.objects) {
      this.scene.remove(o.mesh);
      o.mesh.traverse?.((c) => {
        if (c.geometry) c.geometry.dispose();
      });
      o.mesh.geometry?.dispose();
    }
    this.objects = [];
    this.spawnedChunks.clear();
  }

  _add(mesh) {
    this.scene.add(mesh);
    mesh.updateMatrixWorld(true);
    this.world.paintBakeObject(mesh);
  }

  _track(obj) {
    obj.cx = this._placingCx;
    obj.cy = this._placingCy;
    this.objects.push(obj);
  }

  clearChunk(cx, cy) {
    const keep = [];
    for (const o of this.objects) {
      if (o.cx === cx && o.cy === cy) {
        this.scene.remove(o.mesh);
        o.mesh.traverse?.((c) => {
          if (c.geometry) c.geometry.dispose();
        });
        o.mesh.geometry?.dispose();
      } else {
        keep.push(o);
      }
    }
    this.objects = keep;
    this.spawnedChunks.delete(`${cx},${cy}`);
  }

  populateChunk(chunk, chunkCx, chunkCy) {
    const key = `${chunkCx},${chunkCy}`;
    if (this.spawnedChunks.has(key)) return;
    this.spawnedChunks.add(key);
    this._placingCx = chunkCx;
    this._placingCy = chunkCy;

    if (chunk.zone?.id === 'manila' || chunk.zone?.id === 'pillarHall'
      || chunk.zone?.id === 'tightHalls' || chunk.zone?.id === 'pitPockets'
      || chunk.zone?.id === 'utility') return;

    const originX = chunkCx * CHUNK_CELLS * CELL_SIZE;
    const originZ = chunkCy * CHUNK_CELLS * CELL_SIZE;
    const wallCells = this._wallCells(chunk);
    if (wallCells.length === 0) return;
    if (Math.random() > 0.28) return;

    const cell = wallCells[Math.floor(Math.random() * wallCells.length)];
    const worldX = originX + cell.x * CELL_SIZE + CELL_SIZE / 2;
    const worldZ = originZ + cell.y * CELL_SIZE + CELL_SIZE / 2;
    const gx = Math.floor(worldX / CELL_SIZE);
    const gy = Math.floor(worldZ / CELL_SIZE);
    if (this.removedKeys.has(`${gx},${gy}`)) return;

    const mesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.22, 8),
      this.batteryMat
    );
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(worldX, 0.28, worldZ);
    mesh.userData.interactable = true;
    this._add(mesh);
    this._track({
      mesh, type: 'battery', defKey: 'battery', gx, gy,
      bob: true, taken: false,
    });
  }

  _wallCells(chunk) {
    const size = chunk.size;
    const idx = (x, y) => y * size + x;
    const wallCells = [];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        if (chunk.cells[idx(x, y)] !== FLOOR) continue;
        const wallAdj =
          chunk.cells[idx(x - 1, y)] === WALL ||
          chunk.cells[idx(x + 1, y)] === WALL ||
          chunk.cells[idx(x, y - 1)] === WALL ||
          chunk.cells[idx(x, y + 1)] === WALL;
        if (wallAdj) wallCells.push({ x, y });
      }
    }
    return wallCells;
  }

  update(dt, playerPos) {
    const t = performance.now() * 0.002;
    for (const o of this.objects) {
      if (!o.mesh.visible) continue;
      o.mesh.rotation.y += dt * 1.1;
      if (o.bob) {
        o.mesh.position.y = 0.28 + Math.sin(t + o.mesh.id) * 0.05;
      }
    }
  }

  getNearestInteractable(playerPos) {
    let best = null, bestDist = INTERACT_RANGE;
    for (const o of this.objects) {
      if (!o.mesh.visible) continue;
      const d = o.mesh.position.distanceTo(playerPos);
      if (d < bestDist) { bestDist = d; best = o; }
    }
    return best;
  }

  interact(obj) {
    if (obj.type === 'battery') {
      this.bus.emit('battery-pickup', {});
      this.inventory.add('battery');
      obj.mesh.visible = false;
      obj.taken = true;
      this.removedKeys.add(`${obj.gx},${obj.gy}`);
      this.bus.emit('pickup-taken', { gx: obj.gx, gy: obj.gy, type: 'battery' });
      return;
    }
    this.inventory.add(obj.defKey);
    obj.mesh.visible = false;
    obj.taken = true;
    this.removedKeys.add(`${obj.gx},${obj.gy}`);
    this.bus.emit('pickup-taken', { gx: obj.gx, gy: obj.gy, type: obj.defKey });
  }
}
