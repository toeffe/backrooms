import { SeededRandom } from '../core/Random.js';
import { zoneAt } from './Zones.js';

// The Backrooms are generated on an infinite grid of "cells". Each cell is
// CELL_SIZE units wide/deep. A cell is either a room-interior, a wall, a
// doorway, or a corridor segment. We generate chunks of cells lazily as the
// player approaches them, using a seeded hash per-cell so the layout is
// stable (revisited areas look the same).

export const CELL_SIZE = 5; // meters per grid cell — larger rooms, less cramped
export const CHUNK_CELLS = 14; // cells per chunk edge (~70m per chunk)
export const CEILING_H = 2.75; // classic Level 0 — uniform
export const WALL = 1;
export const FLOOR = 0;
export const DOOR = 2;

function hashCell(seed, cx, cy) {
  // deterministic per-cell hash independent of generation order
  let h = seed ^ (cx * 374761393) ^ (cy * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

/** Door row on the shared vertical edge between (leftCx, cy) and (leftCx+1, cy). */
function ewDoorY(seed, leftCx, cy, size) {
  return 2 + Math.floor(hashCell(seed ^ 0xa5a51e, leftCx, cy) * (size - 4));
}

/** Door column on the shared horizontal edge between (cx, topCy) and (cx, topCy+1). */
function nsDoorX(seed, cx, topCy, size) {
  return 2 + Math.floor(hashCell(seed ^ 0x5a5a0d, cx, topCy) * (size - 4));
}

function carveFloor(cells, ceilingHeight, idx, size, x, y) {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  cells[idx(x, y)] = FLOOR;
  ceilingHeight[idx(x, y)] = CEILING_H;
}

function carveL(cells, ceilingHeight, idx, size, x0, y0, x1, y1, wide) {
  let x = x0, y = y0;
  while (x !== x1) {
    carveFloor(cells, ceilingHeight, idx, size, x, y);
    if (wide) carveFloor(cells, ceilingHeight, idx, size, x, y + 1);
    x += x < x1 ? 1 : -1;
  }
  while (y !== y1) {
    carveFloor(cells, ceilingHeight, idx, size, x, y);
    if (wide) carveFloor(cells, ceilingHeight, idx, size, x + 1, y);
    y += y < y1 ? 1 : -1;
  }
  carveFloor(cells, ceilingHeight, idx, size, x1, y1);
}

function nearestFloor(cells, idx, size, sx, sy) {
  let best = null;
  let bestD = Infinity;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cells[idx(x, y)] !== FLOOR) continue;
      const d = Math.abs(x - sx) + Math.abs(y - sy);
      if (d === 0) continue;
      if (d < bestD) {
        bestD = d;
        best = { x, y };
      }
    }
  }
  return best;
}

function connectFloorComponents(cells, ceilingHeight, idx, size, wide = true) {
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const components = () => {
    const seen = new Uint8Array(size * size);
    const comps = [];
    for (let i = 0; i < cells.length; i++) {
      if (cells[i] !== FLOOR || seen[i]) continue;
      const list = [];
      const st = [i];
      seen[i] = 1;
      while (st.length) {
        const p = st.pop();
        list.push(p);
        const x = p % size;
        const y = (p / size) | 0;
        for (const [dx, dy] of dirs) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue;
          const ni = ny * size + nx;
          if (cells[ni] === FLOOR && !seen[ni]) {
            seen[ni] = 1;
            st.push(ni);
          }
        }
      }
      comps.push(list);
    }
    comps.sort((a, b) => b.length - a.length);
    return comps;
  };

  for (let guard = 0; guard < 24; guard++) {
    const comps = components();
    if (comps.length <= 1) return;
    const a = comps[0][0];
    const b = comps[1][0];
    carveL(
      cells, ceilingHeight, idx, size,
      a % size, (a / size) | 0,
      b % size, (b / size) | 0,
      wide
    );
  }
}

function vendingOnWall(room, edge) {
  let fx, fy, rot;
  if (edge === 0) { fx = room.x + 0.4; fy = room.y + room.d * 0.5; rot = Math.PI / 2; }
  else if (edge === 1) { fx = room.x + room.w - 0.4; fy = room.y + room.d * 0.5; rot = -Math.PI / 2; }
  else if (edge === 2) { fx = room.x + room.w * 0.5; fy = room.y + 0.4; rot = 0; }
  else { fx = room.x + room.w * 0.5; fy = room.y + room.d - 0.4; rot = Math.PI; }
  return { x: fx, y: fy, type: 'vending', rot };
}

function applyZoneCeiling(cells, ceilingHeight, idx, size, zone, rng) {
  const min = zone.ceiling.min;
  const max = zone.ceiling.max;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cells[idx(x, y)] !== FLOOR) continue;
      ceilingHeight[idx(x, y)] = min === max ? min : min + (max - min) * rng.next();
    }
  }
}

function stampPuddles(cells, idx, size, rng, n) {
  const puddles = [];
  const used = new Set();
  let tries = 0;
  while (puddles.length < n && tries < n * 16) {
    tries++;
    const x = rng.int(1, size - 2);
    const y = rng.int(1, size - 2);
    const key = `${x},${y}`;
    if (used.has(key) || cells[idx(x, y)] !== FLOOR) continue;
    used.add(key);
    puddles.push({ x, y, s: rng.range(0.5, 0.92) });
  }
  return puddles;
}

function stampMold(cells, idx, size, rng) {
  const mold = [];
  const dirs = [
    { dx: 0, dy: -1, nx: 0, nz: -1 },
    { dx: 0, dy: 1, nx: 0, nz: 1 },
    { dx: -1, dy: 0, nx: -1, nz: 0 },
    { dx: 1, dy: 0, nx: 1, nz: 0 },
  ];
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      if (cells[idx(x, y)] !== FLOOR) continue;
      if (!rng.chance(0.22)) continue;
      const walls = dirs.filter((d) => {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) return true;
        return cells[idx(nx, ny)] === WALL;
      });
      if (!walls.length) continue;
      const w = rng.pick(walls);
      mold.push({
        x, y,
        nx: w.nx, nz: w.nz,
        w: rng.range(0.45, 1.2),
        h: rng.range(0.32, 0.9),
        yOff: rng.range(0.06, 0.38),
      });
    }
  }
  return mold;
}

function stampDeadPlants(cells, furniture, idx, size, rng, n) {
  let placed = 0;
  let tries = 0;
  while (placed < n && tries < 50) {
    tries++;
    const x = rng.int(2, size - 3);
    const y = rng.int(2, size - 3);
    if (cells[idx(x, y)] !== FLOOR) continue;
    furniture.push({
      x: x + 0.45 + rng.range(0, 0.1),
      y: y + 0.45 + rng.range(0, 0.1),
      type: 'plantDead',
      rot: rng.range(0, Math.PI * 2),
    });
    placed++;
  }
}

function stampColumns(cells, idx, size) {
  const columns = [];
  for (let y = 3; y <= size - 4; y += 3) {
    for (let x = 3; x <= size - 4; x += 3) {
      if (cells[idx(x, y)] !== FLOOR) continue;
      columns.push({ x, y, hw: 0.42 });
    }
  }
  return columns;
}

function stampPitPockets(cells, idx, size, rng, n) {
  const pockets = [];
  const used = new Set();
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  let tries = 0;
  while (pockets.length < n && tries < n * 40) {
    tries++;
    const x = rng.int(3, size - 4);
    const y = rng.int(3, size - 4);
    const key = `${x},${y}`;
    if (used.has(key) || cells[idx(x, y)] !== FLOOR) continue;
    let nFloor = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (cells[idx(x + dx, y + dy)] === FLOOR) nFloor++;
      }
    }
    if (nFloor < 8) continue;
    let near = false;
    for (const p of pockets) {
      if (Math.abs(p.x - x) + Math.abs(p.y - y) < 3) {
        near = true;
        break;
      }
    }
    if (near) continue;
    used.add(key);
    const gash = rng.chance(0.32);
    const hw = gash ? rng.range(1.55, 1.75) : rng.range(1.15, 1.42);
    const deep = rng.range(4.4, 6.8);
    pockets.push({ x, y, hw, deep, gash });
    if (!gash) continue;
    const [dx, dy] = rng.pick(dirs);
    const x2 = x + dx;
    const y2 = y + dy;
    if (x2 < 3 || y2 < 3 || x2 > size - 4 || y2 > size - 4) continue;
    if (cells[idx(x2, y2)] !== FLOOR) continue;
    const k2 = `${x2},${y2}`;
    if (used.has(k2)) continue;
    used.add(k2);
    pockets.push({ x: x2, y: y2, hw, deep, gash: true });
  }
  return pockets;
}

function applyUtilityHeights(cells, ceilingHeight, idx, size, rooms) {
  const tall = (x, y) => {
    for (const r of rooms) {
      if (r.w * r.d < 18) continue;
      if (x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.d) return true;
    }
    return false;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (cells[idx(x, y)] !== FLOOR) continue;
      ceilingHeight[idx(x, y)] = tall(x, y) ? 3.2 : 2.2;
    }
  }
}

function stampTrench(cells, idx, size, rng) {
  const out = [];
  const axis = rng.chance(0.5) ? 'x' : 'z';
  for (let attempt = 0; attempt < 8 && out.length < 4; attempt++) {
    out.length = 0;
    const fixed = rng.int(3, size - 4);
    for (let i = 2; i < size - 2; i++) {
      const x = axis === 'x' ? i : fixed;
      const y = axis === 'x' ? fixed : i;
      if (cells[idx(x, y)] === FLOOR) out.push({ x, y, axis });
    }
  }
  return out.length >= 4 ? out : [];
}

function stampPipes(cells, idx, size, rng) {
  const pipes = [];
  const flushRun = (axis, b, run) => {
    if (run.length < 3) return;
    pipes.push({
      kind: 'run',
      axis,
      b,
      a0: run[0],
      a1: run[run.length - 1],
      yOff: rng.range(0.16, 0.42),
      r: rng.range(0.055, 0.1),
      off: rng.range(-0.35, 0.35),
    });
  };
  for (let k = 0; k < rng.int(3, 5); k++) {
    const y = rng.int(2, size - 3);
    let run = [];
    for (let x = 1; x < size - 1; x++) {
      if (cells[idx(x, y)] === FLOOR) run.push(x);
      else {
        flushRun('x', y, run);
        run = [];
      }
    }
    flushRun('x', y, run);
  }
  for (let k = 0; k < rng.int(2, 4); k++) {
    const x = rng.int(2, size - 3);
    let run = [];
    for (let y = 1; y < size - 1; y++) {
      if (cells[idx(x, y)] === FLOOR) run.push(y);
      else {
        flushRun('z', x, run);
        run = [];
      }
    }
    flushRun('z', x, run);
  }
  let risers = 0;
  let tries = 0;
  while (risers < rng.int(2, 4) && tries < 40) {
    tries++;
    const x = rng.int(2, size - 3);
    const y = rng.int(2, size - 3);
    if (cells[idx(x, y)] !== FLOOR) continue;
    pipes.push({ kind: 'riser', x, y, r: rng.range(0.05, 0.08) });
    risers++;
  }
  return pipes;
}

function opensTwoByTwo(cells, idx, size, x, y) {
  const FLOOR_ID = FLOOR;
  for (const [ox, oy] of [[-1, -1], [-1, 0], [0, -1], [0, 0]]) {
    const x0 = x + ox;
    const y0 = y + oy;
    if (x0 < 0 || y0 < 0 || x0 >= size - 1 || y0 >= size - 1) continue;
    let n = 1;
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        if (x0 + dx === x && y0 + dy === y) continue;
        if (cells[idx(x0 + dx, y0 + dy)] === FLOOR_ID) n++;
      }
    }
    if (n === 4) return true;
  }
  return false;
}

function carveOneWideMaze(cells, ceilingHeight, idx, size, rng) {
  let x = rng.int(2, size - 3);
  let y = rng.int(2, size - 3);
  carveFloor(cells, ceilingHeight, idx, size, x, y);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  for (let i = 0; i < 140; i++) {
    const [dx, dy] = rng.pick(dirs);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 1 || ny < 1 || nx > size - 2 || ny > size - 2) continue;
    if (opensTwoByTwo(cells, idx, size, nx, ny)) continue;
    carveFloor(cells, ceilingHeight, idx, size, nx, ny);
    x = nx;
    y = ny;
  }
  for (let j = 0; j < 10; j++) {
    const sx = rng.int(1, size - 2);
    const sy = rng.int(1, size - 2);
    if (cells[idx(sx, sy)] !== FLOOR) continue;
    const [dx, dy] = rng.pick(dirs);
    const nx = sx + dx;
    const ny = sy + dy;
    if (nx < 1 || ny < 1 || nx > size - 2 || ny > size - 2) continue;
    if (opensTwoByTwo(cells, idx, size, nx, ny)) continue;
    carveFloor(cells, ceilingHeight, idx, size, nx, ny);
  }
}

export class LevelGenerator {
  constructor(seed = 1337) {
    this.seed = seed;
    this.chunks = new Map(); // "cx,cy" -> chunk data
    this.overrides = new Map(); // "gx,gy" -> cell value
    this.layout = null;
  }

  chunkKey(cx, cy) { return `${cx},${cy}`; }

  worldToChunk(wx, wz) {
    const gx = Math.floor(wx / CELL_SIZE);
    const gy = Math.floor(wz / CELL_SIZE);
    return {
      cx: Math.floor(gx / CHUNK_CELLS),
      cy: Math.floor(gy / CHUNK_CELLS),
      gx, gy
    };
  }

  // Generates (or returns cached) chunk: a grid of cell types plus room
  // metadata (ceiling height variation, furniture spawn points, etc).
  getChunk(cx, cy) {
    const key = this.chunkKey(cx, cy);
    if (this.chunks.has(key)) return this.chunks.get(key);

    const rng = new SeededRandom((this.seed ^ (cx * 92821) ^ (cy * 68917)) >>> 0);
    const zone = zoneAt(this.seed, cx, cy, this.layout);
    const tight = zone.layout === 'tight';
    const manila = zone.layout === 'manila';
    const pillars = zone.layout === 'pillars';
    const onewide = zone.layout === 'onewide';
    const pits = zone.layout === 'pits';
    const utility = zone.layout === 'utility';
    const hall = manila || pillars;
    const size = CHUNK_CELLS;
    const cells = new Uint8Array(size * size).fill(WALL);
    const ceilingHeight = new Float32Array(size * size).fill(CEILING_H);
    const furniture = [];
    const lights = [];
    let placedHero = false;

    const idx = (x, y) => y * size + x;

    // ---- Rooms: lobby expansive; tight = corridors; halls = one warehouse ----
    const rooms = [];
    if (hall) {
      rooms.push({ x: 1, y: 1, w: size - 2, d: size - 2, h: zone.ceiling.max });
    }
    const roomCount = tight ? rng.int(3, 5) : rng.int(5, 9);
    const attempts = roomCount * 10;
    for (let a = 0; a < attempts && rooms.length < roomCount && !hall && !onewide; a++) {
      const kind = rng.next();
      let w, d;
      if (tight) {
        if (kind < 0.22) {
          w = rng.int(3, 5);
          d = rng.int(3, 5);
        } else if (rng.chance(0.5)) {
          w = rng.int(2, 3);
          d = rng.int(6, 11);
        } else {
          w = rng.int(6, 11);
          d = rng.int(2, 3);
        }
      } else if (pits) {
        w = rng.int(5, 10);
        d = rng.int(5, 10);
      } else if (utility) {
        if (kind < 0.62) {
          if (rng.chance(0.5)) {
            w = rng.int(2, 4);
            d = rng.int(7, 12);
          } else {
            w = rng.int(7, 12);
            d = rng.int(2, 4);
          }
        } else {
          w = rng.int(4, 7);
          d = rng.int(4, 7);
        }
      } else if (kind < 0.5) {
        w = rng.int(4, 8);
        d = rng.int(4, 8);
      } else if (kind < 0.78) {
        if (rng.chance(0.5)) {
          w = rng.int(2, 4);
          d = rng.int(6, 11);
        } else {
          w = rng.int(6, 11);
          d = rng.int(2, 4);
        }
      } else {
        w = rng.int(2, 3);
        d = rng.int(2, 3);
      }
      if (w >= size - 2 || d >= size - 2) continue;
      const x = rng.int(1, size - w - 1);
      const y = rng.int(1, size - d - 1);

      let overlaps = false;
      for (const r of rooms) {
        if (x < r.x + r.w + 1 && x + w + 1 > r.x &&
            y < r.y + r.d + 1 && y + d + 1 > r.y) {
          overlaps = true;
          break;
        }
      }
      if (overlaps) continue;
      rooms.push({ x, y, w, d, h: CEILING_H });
    }

    while (!hall && !onewide && rooms.length < (tight ? 2 : 3)) {
      const w = tight ? rng.int(2, 4) : rng.int(4, 6);
      const d = tight ? rng.int(2, 4) : rng.int(4, 6);
      const x = rng.int(1, size - w - 1);
      const y = rng.int(1, size - d - 1);
      rooms.push({ x, y, w, d, h: CEILING_H });
    }

    // Chunk (0,0) — reliable open starting room
    if (cx === 0 && cy === 0) {
      const sx = Math.floor(size / 2) - 3;
      const sy = Math.floor(size / 2) - 3;
      rooms.unshift({ x: sx, y: sy, w: 6, d: 6, h: CEILING_H });
    }

    for (const room of rooms) {
      for (let y = room.y; y < room.y + room.d; y++) {
        for (let x = room.x; x < room.x + room.w; x++) {
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          cells[idx(x, y)] = FLOOR;
          ceilingHeight[idx(x, y)] = CEILING_H;
        }
      }

      // Occasional internal wall pillar / partial divider for visual interest
      // and to break long sightlines (classic liminal anxiety).
      // Skip for the forced spawn room in chunk 0,0 so the start is open.
      const isSpawnRoom = (cx === 0 && cy === 0 && room.w === 6 && room.d === 6 &&
        room.x === Math.floor(size / 2) - 3 && room.y === Math.floor(size / 2) - 3);
      if (!hall && !onewide && !pits && !utility && !isSpawnRoom && room.w >= 5 && room.d >= 5 && rng.chance(0.3)) {
        const px = room.x + 1 + rng.int(0, Math.max(0, room.w - 3));
        const py = room.y + 1 + rng.int(0, Math.max(0, room.d - 3));
        const pw = rng.int(1, 2);
        const pd = rng.int(1, 2);
        for (let yy = py; yy < py + pd && yy < room.y + room.d - 1; yy++) {
          for (let xx = px; xx < px + pw && xx < room.x + room.w - 1; xx++) {
            cells[idx(xx, yy)] = WALL;
          }
        }
      }

      const area = room.w * room.d;
      if (isSpawnRoom) {
        furniture.push({
          x: room.x + room.w * 0.5,
          y: room.y + 0.32,
          type: 'chair',
          rot: 0,
          facingWall: true,
        });
        continue;
      }

      // Almost empty — original Level 0 has no furniture. Rare dead vending as a landmark.
      if (hall || onewide || pits || utility) continue;
      if (!placedHero && (area >= 24 && rng.chance(0.045))) {
        placedHero = true;
        furniture.push(vendingOnWall(room, rng.int(0, 3)));
      }
    }

    // Connect rooms with corridors
    for (let i = 1; i < rooms.length; i++) {
      const a = rooms[i - 1];
      const b = rooms[i];
      carveL(
        cells, ceilingHeight, idx, size,
        Math.floor(a.x + a.w / 2), Math.floor(a.y + a.d / 2),
        Math.floor(b.x + b.w / 2), Math.floor(b.y + b.d / 2),
        rng.chance(onewide ? 0 : tight ? 0.08 : 0.3)
      );
    }

    if (onewide) carveOneWideMaze(cells, ceilingHeight, idx, size, rng);

    const interiors = [];
    for (let y = 1; y < size - 1; y++) {
      for (let x = 1; x < size - 1; x++) {
        if (cells[idx(x, y)] === FLOOR) interiors.push({ x, y });
      }
    }

    // Shared-edge doors: both chunks hash the SAME boundary so they meet.
    const doors = [
      { dir: 'E', x: size - 1, y: ewDoorY(this.seed, cx, cy, size) },
      { dir: 'W', x: 0, y: ewDoorY(this.seed, cx - 1, cy, size) },
      { dir: 'S', x: nsDoorX(this.seed, cx, cy, size), y: size - 1 },
      { dir: 'N', x: nsDoorX(this.seed, cx, cy - 1, size), y: 0 },
    ];
    for (const d of doors) {
      if (onewide) {
        carveFloor(cells, ceilingHeight, idx, size, d.x, d.y);
        if (d.dir === 'E') carveFloor(cells, ceilingHeight, idx, size, size - 2, d.y);
        else if (d.dir === 'W') carveFloor(cells, ceilingHeight, idx, size, 1, d.y);
        else if (d.dir === 'S') carveFloor(cells, ceilingHeight, idx, size, d.x, size - 2);
        else carveFloor(cells, ceilingHeight, idx, size, d.x, 1);
      } else if (d.dir === 'E' || d.dir === 'W') {
        const x0 = d.dir === 'E' ? size - 3 : 0;
        const x1 = d.dir === 'E' ? size : 3;
        for (let x = x0; x < x1; x++) {
          carveFloor(cells, ceilingHeight, idx, size, x, d.y);
          carveFloor(cells, ceilingHeight, idx, size, x, d.y + 1);
        }
      } else {
        const y0 = d.dir === 'S' ? size - 3 : 0;
        const y1 = d.dir === 'S' ? size : 3;
        for (let y = y0; y < y1; y++) {
          carveFloor(cells, ceilingHeight, idx, size, d.x, y);
          carveFloor(cells, ceilingHeight, idx, size, d.x + 1, y);
        }
      }
      const innerX = d.dir === 'E' ? size - 3 : d.dir === 'W' ? 2 : d.x;
      const innerY = d.dir === 'S' ? size - 3 : d.dir === 'N' ? 2 : d.y;
      let target = null;
      let bestD = Infinity;
      for (const p of interiors) {
        const dist = Math.abs(p.x - innerX) + Math.abs(p.y - innerY);
        if (dist < bestD) { bestD = dist; target = p; }
      }
      if (target) {
        carveL(cells, ceilingHeight, idx, size, innerX, innerY, target.x, target.y, !onewide);
      }
    }

    connectFloorComponents(cells, ceilingHeight, idx, size, !onewide);

    // Extra irregular alcoves and dead-end pockets for unsettling asymmetry
    const alcoveN = hall ? 0 : onewide ? rng.int(5, 9) : tight ? rng.int(1, 3) : rng.int(2, 5);
    for (let i = 0; i < alcoveN; i++) {
      const x = rng.int(1, size - 2);
      const y = rng.int(1, size - 2);
      if (cells[idx(x, y)] === FLOOR) {
        const dx = rng.pick([-1, 1, 0, 0]);
        const dy = dx === 0 ? rng.pick([-1, 1]) : 0;
        const nx = x + dx, ny = y + dy;
        if (nx > 0 && ny > 0 && nx < size - 1 && ny < size - 1) {
          if (onewide && opensTwoByTwo(cells, idx, size, nx, ny)) continue;
          cells[idx(nx, ny)] = FLOOR;
          ceilingHeight[idx(nx, ny)] = CEILING_H;
          if (!onewide && rng.chance(0.4)) {
            const nx2 = nx + dx, ny2 = ny + dy;
            if (nx2 > 0 && ny2 > 0 && nx2 < size - 1 && ny2 < size - 1) {
              cells[idx(nx2, ny2)] = FLOOR;
              ceilingHeight[idx(nx2, ny2)] = CEILING_H;
            }
          }
        }
      }
    }

    applyZoneCeiling(cells, ceilingHeight, idx, size, zone, rng);
    if (utility) applyUtilityHeights(cells, ceilingHeight, idx, size, rooms);

    const columns = pillars ? stampColumns(cells, idx, size) : [];
    const pockets = pits ? stampPitPockets(cells, idx, size, rng, rng.int(4, 7)) : [];
    const trenches = utility ? stampTrench(cells, idx, size, rng) : [];
    const pipes = utility ? stampPipes(cells, idx, size, rng) : [];
    if (utility && trenches.length) {
      const t0 = trenches[Math.floor(trenches.length / 2)];
      furniture.push({
        x: t0.x + 0.35,
        y: t0.y + 0.2,
        type: 'valve',
        rot: t0.axis === 'x' ? 0 : Math.PI / 2,
      });
      if (trenches.length > 5) {
        const t1 = trenches[trenches.length - 2];
        furniture.push({
          x: t1.x + 0.2,
          y: t1.y + 0.35,
          type: 'valve',
          rot: rng.range(0, Math.PI),
        });
      }
    }
    if (pits && pockets.length && rng.chance(0.55)) {
      const p = pockets[0];
      furniture.push({
        x: p.x + 0.1,
        y: p.y + 0.8,
        type: 'chair',
        rot: rng.range(0, Math.PI * 2),
      });
    }

    let zoneAlmond = null;
    if (manila) {
      const arx = Math.floor(cx / 2) * 2;
      const ary = Math.floor(cy / 2) * 2;
      if (cx === arx && cy === ary) {
        furniture.push({ x: size / 2, y: size / 2, type: 'table', rot: 0 });
        furniture.push({ x: size / 2, y: size / 2 - 0.42, type: 'chair', rot: 0 });
      }
    }

    const puddles = zone.water
      ? stampPuddles(cells, idx, size, rng, rng.int(onewide ? 8 : 4, onewide ? 14 : 10))
      : [];
    const mold = zone.decay ? stampMold(cells, idx, size, rng) : [];
    if (zone.decay) stampDeadPlants(cells, furniture, idx, size, rng, rng.int(1, 2));

    // Drop-ceiling fluorescent grid — receding trays like the original photo.
    // Meshes only; realtime lights stay in the shared pool of 8.
    const MAX_LIGHTS = 28;
    const skip = zone.lights.skip ?? 0.12;
    const brokenChance = zone.lights.broken ?? 0.08;
    const flickerChance = zone.lights.flicker ?? 0.14;
    const maxWorking = zone.lights.maxWorking ?? Infinity;
    let spawnDeadKey = null;
    if (cx === 0 && cy === 0 && rooms[0]) {
      const sr = rooms[0];
      spawnDeadKey = `${Math.floor(sr.x + sr.w / 2)},${Math.floor(sr.y + sr.d / 2)}`;
    }
    for (let y = 1; y < size - 1 && lights.length < MAX_LIGHTS; y += 2) {
      for (let x = 1; x < size - 1 && lights.length < MAX_LIGHTS; x += 2) {
        if (cells[idx(x, y)] !== FLOOR) continue;
        if (columns.some((c) => c.x === x && c.y === y)) continue;
        if (pockets.some((p) => p.x === x && p.y === y)) continue;
        if (rng.chance(skip)) continue;
        const key = `${x},${y}`;
        const isSpawnDead = key === spawnDeadKey;
        lights.push({
          x: x + 0.5,
          y: y + 0.5,
          flicker: !isSpawnDead && rng.chance(flickerChance),
          broken: isSpawnDead || rng.chance(brokenChance),
        });
      }
    }
    if (spawnDeadKey && !lights.some((l) => l.broken)) {
      const sr = rooms[0];
      lights.push({
        x: sr.x + sr.w / 2,
        y: sr.y + sr.d / 2,
        flicker: false,
        broken: true,
      });
    }
    if (Number.isFinite(maxWorking)) {
      const working = lights.filter((l) => !l.broken);
      while (working.length > maxWorking) {
        const pick = working.splice(rng.int(0, working.length - 1), 1)[0];
        pick.broken = true;
        pick.flicker = false;
      }
    }

    const chunk = {
      cx, cy, size, cells, ceilingHeight, furniture, lights, rooms,
      zone, puddles, mold, zoneAlmond, columns, pockets, trenches, pipes,
    };
    this.chunks.set(key, chunk);
    return chunk;
  }

  getCell(gx, gy) {
    const ov = this.overrides.get(`${gx},${gy}`);
    if (ov !== undefined) return ov;
    const cx = Math.floor(gx / CHUNK_CELLS);
    const cy = Math.floor(gy / CHUNK_CELLS);
    const chunk = this.getChunk(cx, cy);
    const lx = ((gx % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    const ly = ((gy % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    return chunk.cells[ly * CHUNK_CELLS + lx];
  }

  getCeilingHeight(gx, gy) {
    const cx = Math.floor(gx / CHUNK_CELLS);
    const cy = Math.floor(gy / CHUNK_CELLS);
    const chunk = this.getChunk(cx, cy);
    const lx = ((gx % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    const ly = ((gy % CHUNK_CELLS) + CHUNK_CELLS) % CHUNK_CELLS;
    const h = chunk.ceilingHeight[ly * CHUNK_CELLS + lx];
    return h > 0.1 ? h : CEILING_H;
  }

  setOverride(gx, gy, value) {
    this.overrides.set(`${gx},${gy}`, value);
  }

  clearOverride(gx, gy) {
    this.overrides.delete(`${gx},${gy}`);
  }

  isWalkable(gx, gy) {
    return this.getCell(gx, gy) !== WALL;
  }

  cellCenterWorld(gx, gy) {
    return { x: gx * CELL_SIZE + CELL_SIZE / 2, z: gy * CELL_SIZE + CELL_SIZE / 2 };
  }
}
