import * as THREE from 'three';
import { LevelGenerator, CELL_SIZE, CHUNK_CELLS, WALL } from './LevelGenerator.js';
import { ChunkMesher, paintBakeTree } from './ChunkMesher.js';
import { buildMaterials } from './Materials.js';

const STREAM_RADIUS = 1; // 3x3 — keeps load light
const MAX_CHUNK_BUILDS_PER_FRAME = 1;
// One PointLight for optional flicker. Room lighting is vertex-baked
// onto walls/floor so fixtures do not "turn on" when the player walks near them.
const LIGHT_POOL_SIZE = 1;

export class World {
  constructor(scene, seed = 1337) {
    this.scene = scene;
    this.generator = new LevelGenerator(seed);
    this.materials = buildMaterials();
    this.mesher = new ChunkMesher(this.materials, seed, this.generator);
    this.loaded = new Map();
    this.root = new THREE.Group();
    this.root.name = 'world-root';
    scene.add(this.root);
    this.clock = 0;
    this.currentChunk = { cx: Infinity, cy: Infinity };
    this._pendingChunks = [];
    this._allLightPoints = [];
    this._directorFlicker = 0;
    this._chunkLoadedCbs = [];
    this._chunkUnloadedCbs = [];

    this.lightPool = [];
    for (let i = 0; i < LIGHT_POOL_SIZE; i++) {
      const pl = new THREE.PointLight(0xfff4c2, 0, 22, 1.15);
      pl.castShadow = false;
      pl.userData.baseIntensity = 4;
      pl.userData.targetIntensity = 0;
      scene.add(pl);
      this.lightPool.push(pl);
    }
  }

  update(playerPos, dt) {
    this.clock += dt;
    const { cx, cy } = this.generator.worldToChunk(playerPos.x, playerPos.z);
    if (cx !== this.currentChunk.cx || cy !== this.currentChunk.cy) {
      this.currentChunk = { cx, cy };
      this.streamAround(cx, cy);
    }
    this._buildPendingChunks();
    this._updateLightPool(playerPos, dt);
  }

  onChunkLoaded(fn) {
    this._chunkLoadedCbs.push(fn);
    return () => {
      const i = this._chunkLoadedCbs.indexOf(fn);
      if (i >= 0) this._chunkLoadedCbs.splice(i, 1);
    };
  }

  onChunkUnloaded(fn) {
    this._chunkUnloadedCbs.push(fn);
    return () => {
      const i = this._chunkUnloadedCbs.indexOf(fn);
      if (i >= 0) this._chunkUnloadedCbs.splice(i, 1);
    };
  }

  _fireChunkLoaded(chunk, cx, cy) {
    for (const fn of this._chunkLoadedCbs.slice()) fn({ chunk, cx, cy });
  }

  _fireChunkUnloaded(cx, cy, chunk) {
    for (const fn of this._chunkUnloadedCbs.slice()) fn({ chunk, cx, cy });
  }

  _unloadKey(key) {
    const entry = this.loaded.get(key);
    if (!entry) return;
    const [cx, cy] = key.split(',').map(Number);
    this.root.remove(entry.group);
    disposeGroup(entry.group);
    this.loaded.delete(key);
    this._fireChunkUnloaded(cx, cy, entry.chunk);
  }

  streamAround(cx, cy) {
    const needed = new Set();
    for (let dy = -STREAM_RADIUS; dy <= STREAM_RADIUS; dy++) {
      for (let dx = -STREAM_RADIUS; dx <= STREAM_RADIUS; dx++) {
        needed.add(`${cx + dx},${cy + dy}`);
      }
    }
    for (const key of [...this.loaded.keys()]) {
      if (!needed.has(key)) this._unloadKey(key);
    }
    this._pendingChunks = this._pendingChunks.filter((k) => needed.has(k) && !this.loaded.has(k));

    const missing = [];
    for (const key of needed) {
      if (this.loaded.has(key)) continue;
      if (this._pendingChunks.includes(key)) continue;
      const [ccx, ccy] = key.split(',').map(Number);
      missing.push({ key, dist: Math.abs(ccx - cx) + Math.abs(ccy - cy) });
    }
    missing.sort((a, b) => a.dist - b.dist);
    for (const m of missing) this._pendingChunks.push(m.key);

    // Bootstrap: mesh the player's chunk immediately (one chunk only)
    if (this.loaded.size === 0 && this._pendingChunks.length) {
      this._buildOneChunk(this._pendingChunks.shift());
      this._rebuildLightPointList();
    }
  }

  _buildPendingChunks() {
    if (!this._pendingChunks.length) return;
    const key = this._pendingChunks.shift();
    if (this.loaded.has(key)) return;
    this._buildOneChunk(key);
    this._rebuildLightPointList();
  }

  _buildOneChunk(key) {
    const [ccx, ccy] = key.split(',').map(Number);
    // Neighbor DATA first so doorway faces are not sealed with fake walls.
    this.generator.getChunk(ccx - 1, ccy);
    this.generator.getChunk(ccx + 1, ccy);
    this.generator.getChunk(ccx, ccy - 1);
    this.generator.getChunk(ccx, ccy + 1);

    if (this.loaded.has(key)) this._unloadKey(key);

    const chunkData = this.generator.getChunk(ccx, ccy);
    const built = this.mesher.build(chunkData);
    built.chunk = chunkData;
    this.root.add(built.group);
    this.loaded.set(key, built);
    this._fireChunkLoaded(chunkData, ccx, ccy);
  }

  _rebuildLightPointList() {
    this._allLightPoints = [];
    for (const entry of this.loaded.values()) {
      if (entry.lightPoints) this._allLightPoints.push(...entry.lightPoints);
    }
  }

  _updateLightPool(playerPos, dt) {
    const pl = this.lightPool[0];
    if (!pl) return;
    let target = 0;
    if (this._directorFlicker > 0) {
      const near = this.nearestWorkingLight(playerPos);
      if (near) {
        pl.position.set(near.x, near.y, near.z);
        target = pl.userData.baseIntensity * (Math.sin(this.clock * 40) > 0 ? 0.15 : 1);
      }
      this._directorFlicker -= dt;
    }
    pl.userData.targetIntensity = target;
    const k = 1 - Math.exp(-10 * (dt || 0.016));
    pl.intensity += (target - pl.intensity) * k;
  }

  flickerNearest() {
    this._directorFlicker = 0.55;
  }

  nearestWorkingLight(pos) {
    let best = null;
    let bestD = Infinity;
    for (const p of this._allLightPoints) {
      const d = (p.x - pos.x) * (p.x - pos.x) + (p.z - pos.z) * (p.z - pos.z);
      if (d < bestD) {
        bestD = d;
        best = p;
      }
    }
    if (!best) return null;
    return { x: best.x, y: best.y, z: best.z, dist: Math.sqrt(bestD), flicker: best.flicker };
  }

  paintBakeObject(obj) {
    paintBakeTree(obj, this._allLightPoints);
  }

  nearestPocket(wx, wz) {
    let best = null;
    let bestEdge = Infinity;
    for (const entry of this.loaded.values()) {
      const chunk = entry.chunk;
      if (!chunk?.pockets?.length) continue;
      const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
      const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
      for (const p of chunk.pockets) {
        const x = originX + (p.x + 0.5) * CELL_SIZE;
        const z = originZ + (p.y + 0.5) * CELL_SIZE;
        const dist = Math.hypot(wx - x, wz - z);
        const hw = p.hw ?? 1.3;
        const edgeDist = dist - hw;
        if (edgeDist < bestEdge) {
          bestEdge = edgeDist;
          best = { x, z, hw, deep: p.deep ?? 5, dist, edgeDist };
        }
      }
    }
    return best;
  }

  rebuildChunk(cx, cy) {
    const key = `${cx},${cy}`;
    if (!this.loaded.has(key)) return;
    this._unloadKey(key);
    this._buildOneChunk(key);
    this._rebuildLightPointList();
  }

  applyCellOverride(gx, gy, value) {
    this.generator.setOverride(gx, gy, value);
    const cx = Math.floor(gx / CHUNK_CELLS);
    const cy = Math.floor(gy / CHUNK_CELLS);
    const chunk = this.generator.chunks.get(`${cx},${cy}`);
    if (chunk) {
      const lx = ((gx % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
      const ly = ((gy % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
      chunk.cells[ly * CHUNK_CELLS + lx] = value;
    }
    if (this.loaded.has(`${cx},${cy}`)) this.rebuildChunk(cx, cy);
  }

  breakLightAt(wx, wz) {
    let best = null;
    let bestD = Infinity;
    for (const entry of this.loaded.values()) {
      const chunk = entry.chunk;
      if (!chunk?.lights) continue;
      const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
      const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
      for (const l of chunk.lights) {
        if (l.broken) continue;
        const x = originX + l.x * CELL_SIZE;
        const z = originZ + l.y * CELL_SIZE;
        const d = (x - wx) * (x - wx) + (z - wz) * (z - wz);
        if (d < bestD) {
          bestD = d;
          best = { l, chunk };
        }
      }
    }
    if (!best) return false;
    best.l.broken = true;
    this.rebuildChunk(best.chunk.cx, best.chunk.cy);
    return true;
  }

  breakFarLight(pgx, pgy, minCells = 6) {
    const px = pgx * CELL_SIZE + CELL_SIZE / 2;
    const pz = pgy * CELL_SIZE + CELL_SIZE / 2;
    let best = null;
    let bestScore = -1;
    for (const entry of this.loaded.values()) {
      const chunk = entry.chunk;
      if (!chunk?.lights) continue;
      const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
      const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
      for (const l of chunk.lights) {
        if (l.broken) continue;
        const x = originX + l.x * CELL_SIZE;
        const z = originZ + l.y * CELL_SIZE;
        const dist = Math.hypot(x - px, z - pz);
        if (dist < minCells * CELL_SIZE) continue;
        if (dist > bestScore) {
          bestScore = dist;
          best = { l, chunk };
        }
      }
    }
    if (!best) return false;
    best.l.broken = true;
    this.rebuildChunk(best.chunk.cx, best.chunk.cy);
    return true;
  }

  trySealCell(gx, gy) {
    const cx = Math.floor(gx / CHUNK_CELLS);
    const cy = Math.floor(gy / CHUNK_CELLS);
    if (!this.generator.chunks.has(`${cx},${cy}`)) return false;
    if (this.generator.getCell(gx, gy) === WALL) return false;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const nbs = dirs.filter(([dx, dy]) => this.generator.isWalkable(gx + dx, gy + dy));
    if (nbs.length < 1 || nbs.length > 2) return false;
    for (const [dx, dy] of nbs) {
      const nx = gx + dx, ny = gy + dy;
      let other = 0;
      for (const [ox, oy] of dirs) {
        if (nx + ox === gx && ny + oy === gy) continue;
        if (this.generator.isWalkable(nx + ox, ny + oy)) other++;
      }
      if (other < 1) return false;
    }
    this.applyCellOverride(gx, gy, WALL);
    return true;
  }

  sealFarAlcove(pgx, pgy, minDist = 6) {
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const entry of this.loaded.values()) {
      const chunk = entry.chunk;
      if (!chunk) continue;
      const size = chunk.size;
      for (let y = 1; y < size - 1; y++) {
        for (let x = 1; x < size - 1; x++) {
          if (chunk.cells[y * size + x] === WALL) continue;
          const gx = chunk.cx * CHUNK_CELLS + x;
          const gy = chunk.cy * CHUNK_CELLS + y;
          if (Math.hypot(gx - pgx, gy - pgy) < minDist) continue;
          let n = 0;
          for (const [dx, dy] of dirs) {
            if (this.generator.isWalkable(gx + dx, gy + dy)) n++;
          }
          if (n === 1 && this.trySealCell(gx, gy)) return true;
        }
      }
    }
    return false;
  }

  dispose() {
    for (const key of [...this.loaded.keys()]) this._unloadKey(key);
    for (const pl of this.lightPool) {
      this.scene.remove(pl);
    }
    this.scene.remove(this.root);
    this._chunkLoadedCbs = [];
    this._chunkUnloadedCbs = [];
  }

  isWalkableLoaded(wx, wz) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gy = Math.floor(wz / CELL_SIZE);
    const cx = Math.floor(gx / CHUNK_CELLS);
    const cy = Math.floor(gy / CHUNK_CELLS);
    const key = `${cx},${cy}`;
    if (!this.generator.chunks.has(key)) return false;
    const chunk = this.generator.chunks.get(key);
    const lx = ((gx % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    const ly = ((gy % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    return chunk.cells[ly * CHUNK_CELLS + lx] !== WALL
      && !this._hitsColumn(wx, wz, 0.32)
      && !this._hitsPocket(wx, wz, 0.32);
  }

  _hitsColumn(wx, wz, extraR = 0) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gy = Math.floor(wz / CELL_SIZE);
    const pcx = Math.floor(gx / CHUNK_CELLS);
    const pcy = Math.floor(gy / CHUNK_CELLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.generator.chunks.get(`${pcx + dx},${pcy + dy}`);
        if (!chunk || !chunk.columns || !chunk.columns.length) continue;
        const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
        const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
        for (const col of chunk.columns) {
          const cx = originX + (col.x + 0.5) * CELL_SIZE;
          const cz = originZ + (col.y + 0.5) * CELL_SIZE;
          const hw = (col.hw ?? 0.42) + extraR;
          if (Math.abs(wx - cx) <= hw && Math.abs(wz - cz) <= hw) return true;
        }
      }
    }
    return false;
  }

  _hitsPocket(wx, wz, extraR = 0) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gy = Math.floor(wz / CELL_SIZE);
    const pcx = Math.floor(gx / CHUNK_CELLS);
    const pcy = Math.floor(gy / CHUNK_CELLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.generator.chunks.get(`${pcx + dx},${pcy + dy}`);
        if (!chunk || !chunk.pockets || !chunk.pockets.length) continue;
        const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
        const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
        for (const p of chunk.pockets) {
          const cx = originX + (p.x + 0.5) * CELL_SIZE;
          const cz = originZ + (p.y + 0.5) * CELL_SIZE;
          const hw = (p.hw ?? 1.3) + extraR;
          if (Math.abs(wx - cx) <= hw && Math.abs(wz - cz) <= hw) return true;
        }
      }
    }
    return false;
  }

  _separateColumns(px, pz, r) {
    const gx = Math.floor(px / CELL_SIZE);
    const gy = Math.floor(pz / CELL_SIZE);
    const pcx = Math.floor(gx / CHUNK_CELLS);
    const pcy = Math.floor(gy / CHUNK_CELLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.generator.chunks.get(`${pcx + dx},${pcy + dy}`);
        if (!chunk || !chunk.columns || !chunk.columns.length) continue;
        const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
        const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
        for (const col of chunk.columns) {
          const cx = originX + (col.x + 0.5) * CELL_SIZE;
          const cz = originZ + (col.y + 0.5) * CELL_SIZE;
          const hw = col.hw ?? 0.42;
          const minX = cx - hw, maxX = cx + hw;
          const minZ = cz - hw, maxZ = cz + hw;
          const closestX = Math.max(minX, Math.min(px, maxX));
          const closestZ = Math.max(minZ, Math.min(pz, maxZ));
          const ddx = px - closestX;
          const ddz = pz - closestZ;
          const distSq = ddx * ddx + ddz * ddz;
          if (distSq >= r * r) continue;
          if (distSq > 1e-10) {
            const dist = Math.sqrt(distSq);
            const overlap = r - dist;
            px += (ddx / dist) * overlap;
            pz += (ddz / dist) * overlap;
          } else {
            const toLeft = px - minX, toRight = maxX - px;
            const toTop = pz - minZ, toBottom = maxZ - pz;
            const minPen = Math.min(toLeft, toRight, toTop, toBottom);
            if (minPen === toLeft) px = minX - r;
            else if (minPen === toRight) px = maxX + r;
            else if (minPen === toTop) pz = minZ - r;
            else pz = maxZ + r;
          }
        }
      }
    }
    return { x: px, z: pz };
  }

  _separatePockets(px, pz, r) {
    const gx = Math.floor(px / CELL_SIZE);
    const gy = Math.floor(pz / CELL_SIZE);
    const pcx = Math.floor(gx / CHUNK_CELLS);
    const pcy = Math.floor(gy / CHUNK_CELLS);
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const chunk = this.generator.chunks.get(`${pcx + dx},${pcy + dy}`);
        if (!chunk || !chunk.pockets || !chunk.pockets.length) continue;
        const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
        const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
        for (const p of chunk.pockets) {
          const cx = originX + (p.x + 0.5) * CELL_SIZE;
          const cz = originZ + (p.y + 0.5) * CELL_SIZE;
          const hw = p.hw ?? 1.3;
          const minX = cx - hw, maxX = cx + hw;
          const minZ = cz - hw, maxZ = cz + hw;
          const closestX = Math.max(minX, Math.min(px, maxX));
          const closestZ = Math.max(minZ, Math.min(pz, maxZ));
          const ddx = px - closestX;
          const ddz = pz - closestZ;
          const distSq = ddx * ddx + ddz * ddz;
          if (distSq >= r * r) continue;
          if (distSq > 1e-10) {
            const dist = Math.sqrt(distSq);
            const overlap = r - dist;
            px += (ddx / dist) * overlap;
            pz += (ddz / dist) * overlap;
          } else {
            const toLeft = px - minX, toRight = maxX - px;
            const toTop = pz - minZ, toBottom = maxZ - pz;
            const minPen = Math.min(toLeft, toRight, toTop, toBottom);
            if (minPen === toLeft) px = minX - r;
            else if (minPen === toRight) px = maxX + r;
            else if (minPen === toTop) pz = minZ - r;
            else pz = maxZ + r;
          }
        }
      }
    }
    return { x: px, z: pz };
  }

  resolveCollision(pos, radius) {
    const r = radius + 0.06;
    const separate = (px, pz) => {
      const gx = Math.floor(px / CELL_SIZE);
      const gy = Math.floor(pz / CELL_SIZE);
      for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          const cx = gx + ox;
          const cy = gy + oy;
          if (this.generator.isWalkable(cx, cy)) continue;
          const minX = cx * CELL_SIZE;
          const maxX = minX + CELL_SIZE;
          const minZ = cy * CELL_SIZE;
          const maxZ = minZ + CELL_SIZE;
          const closestX = Math.max(minX, Math.min(px, maxX));
          const closestZ = Math.max(minZ, Math.min(pz, maxZ));
          const dx = px - closestX;
          const dz = pz - closestZ;
          const distSq = dx * dx + dz * dz;
          if (distSq >= r * r) continue;
          if (distSq > 1e-10) {
            const dist = Math.sqrt(distSq);
            const overlap = r - dist;
            px += (dx / dist) * overlap;
            pz += (dz / dist) * overlap;
          } else {
            const toLeft = px - minX, toRight = maxX - px;
            const toTop = pz - minZ, toBottom = maxZ - pz;
            const minPen = Math.min(toLeft, toRight, toTop, toBottom);
            if (minPen === toLeft) px = minX - r;
            else if (minPen === toRight) px = maxX + r;
            else if (minPen === toTop) pz = minZ - r;
            else pz = maxZ + r;
          }
        }
      }
      return { x: px, z: pz };
    };
    let p = separate(pos.x, pos.z);
    p = separate(p.x, p.z);
    p = this._separateColumns(p.x, p.z, r);
    p = this._separateColumns(p.x, p.z, r);
    p = this._separatePockets(p.x, p.z, r);
    p = this._separatePockets(p.x, p.z, r);
    return p;
  }

  isWalkable(wx, wz) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gy = Math.floor(wz / CELL_SIZE);
    return this.generator.isWalkable(gx, gy);
  }

  // Tight spawn search — only force-generate chunk (0,0)
  findSpawn() {
    this.generator.getChunk(0, 0);
    const isGood = (gx, gy) => {
      if (!this.generator.isWalkable(gx, gy)) return false;
      let open = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (this.generator.isWalkable(gx + dx, gy + dy)) open++;
        }
      }
      return open >= 3;
    };
    for (let r = 0; r < 16; r++) {
      for (let gy = -r; gy <= r; gy++) {
        for (let gx = -r; gx <= r; gx++) {
          if (r > 0 && Math.abs(gx) !== r && Math.abs(gy) !== r) continue;
          if (isGood(gx, gy)) {
            const c = this.generator.cellCenterWorld(gx, gy);
            return new THREE.Vector3(c.x, 0, c.z);
          }
        }
      }
    }
    const c = this.generator.cellCenterWorld(6, 6);
    return new THREE.Vector3(c.x, 0, c.z);
  }
}

function disposeGroup(group) {
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
  });
}
