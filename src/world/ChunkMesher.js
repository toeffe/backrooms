import * as THREE from 'three';
import { CELL_SIZE, CHUNK_CELLS, WALL, CEILING_H } from './LevelGenerator.js';
import { SeededRandom } from '../core/Random.js';

export class ChunkMesher {
  constructor(materials, seed, generator) {
    this.materials = materials;
    this.seed = seed;
    this.generator = generator;
  }

  build(chunk) {
    const group = new THREE.Group();
    group.name = `chunk_${chunk.cx}_${chunk.cy}`;
    const size = chunk.size;
    const originX = chunk.cx * CHUNK_CELLS * CELL_SIZE;
    const originZ = chunk.cy * CHUNK_CELLS * CELL_SIZE;
    const idx = (x, y) => y * size + x;
    const rng = new SeededRandom((this.seed ^ (chunk.cx * 92821) ^ (chunk.cy * 68917) ^ 0xABCDEF) >>> 0);
    const mats = this.materials;
    const zoneId = chunk.zone?.id || 'lobby';
    const zoneMats = (mats.zones && mats.zones[zoneId]) || mats.zones?.lobby || mats;
    const cellH = (x, y) => {
      const v = chunk.ceilingHeight && chunk.ceilingHeight[idx(x, y)];
      return v > 0 ? v : CEILING_H;
    };

    const bakeLights = collectBakeLights(chunk, this.generator, originX, originZ, cellH);
    const pocketAt = new Map();
    if (chunk.pockets) {
      for (const p of chunk.pockets) pocketAt.set(`${p.x},${p.y}`, p);
    }

    const floorGeoms = [];
    const ceilGeoms = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (chunk.cells[idx(x, y)] === WALL) continue;
        const fx = originX + x * CELL_SIZE;
        const fz = originZ + y * CELL_SIZE;
        const h = cellH(x, y);
        const pocket = pocketAt.get(`${x},${y}`);
        if (pocket) {
          pushCarpetFrame(floorGeoms, fx, fz, pocket.hw, 0, false);
          pushCarpetFrame(ceilGeoms, fx, fz, pocket.hw, h, true);
          continue;
        }
        const fg = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE, 4, 4);
        fg.rotateX(-Math.PI / 2);
        fg.translate(fx + CELL_SIZE / 2, 0, fz + CELL_SIZE / 2);
        floorGeoms.push(fg);
        const cg = new THREE.PlaneGeometry(CELL_SIZE, CELL_SIZE, 4, 4);
        cg.rotateX(Math.PI / 2);
        cg.translate(fx + CELL_SIZE / 2, h, fz + CELL_SIZE / 2);
        ceilGeoms.push(cg);
      }
    }
    if (floorGeoms.length) {
      const geo = mergeGeometries(floorGeoms);
      paintBake(geo, bakeLights);
      group.add(new THREE.Mesh(geo, zoneMats.carpet));
    }
    if (ceilGeoms.length) {
      const geo = mergeGeometries(ceilGeoms);
      paintBake(geo, bakeLights);
      group.add(new THREE.Mesh(geo, zoneMats.ceiling));
    }

    const gen = this.generator;
    const isFloor = (x, y) => {
      if (x < 0 || y < 0 || x >= size || y >= size) {
        if (!gen) return false;
        const gx = chunk.cx * CHUNK_CELLS + x;
        const gy = chunk.cy * CHUNK_CELLS + y;
        // Generate the neighbor so doorway cells match; never assume "wall"
        // just because that chunk has not been meshed yet.
        return gen.isWalkable(gx, gy);
      }
      return chunk.cells[idx(x, y)] !== WALL;
    };

    const wallGeoms = [];
    const trimGeoms = [];
    const crownGeoms = [];
    const jambGeoms = [];
    const TRIM_H = 0.09;
    const TRIM_D = 0.045;
    const CROWN_H = 0.05;
    const JAMB = 0.08;

    const neighborCeil = (nx, ny) => {
      if (nx >= 0 && ny >= 0 && nx < size && ny < size) {
        if (chunk.cells[idx(nx, ny)] === WALL) return null;
        return cellH(nx, ny);
      }
      if (!gen) return null;
      const gx = chunk.cx * CHUNK_CELLS + nx;
      const gy = chunk.cy * CHUNK_CELLS + ny;
      if (!gen.isWalkable(gx, gy)) return null;
      return gen.getCeilingHeight(gx, gy);
    };

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (chunk.cells[idx(x, y)] === WALL) continue;
        const fx = originX + x * CELL_SIZE;
        const fz = originZ + y * CELL_SIZE;
        const h = cellH(x, y);
        const faces = [
          { open: !isFloor(x, y - 1), ox: 0, oy: -1, x1: fx, z1: fz, x2: fx + CELL_SIZE, z2: fz, nx: 0, nz: -1 },
          { open: !isFloor(x, y + 1), ox: 0, oy: 1, x1: fx + CELL_SIZE, z1: fz + CELL_SIZE, x2: fx, z2: fz + CELL_SIZE, nx: 0, nz: 1 },
          { open: !isFloor(x - 1, y), ox: -1, oy: 0, x1: fx, z1: fz + CELL_SIZE, x2: fx, z2: fz, nx: -1, nz: 0 },
          { open: !isFloor(x + 1, y), ox: 1, oy: 0, x1: fx + CELL_SIZE, z1: fz, x2: fx + CELL_SIZE, z2: fz + CELL_SIZE, nx: 1, nz: 0 },
        ];
        for (const f of faces) {
          const len = Math.hypot(f.x2 - f.x1, f.z2 - f.z1);
          const yaw = Math.atan2(f.x2 - f.x1, f.z2 - f.z1) - Math.PI / 2;
          if (f.open) {
            wallGeoms.push(makeWall(f.x1, f.z1, f.x2, f.z2, h));
            const ox = -f.nx * (TRIM_D * 0.5);
            const oz = -f.nz * (TRIM_D * 0.5);
            const mx = (f.x1 + f.x2) / 2 + ox;
            const mz = (f.z1 + f.z2) / 2 + oz;
            trimGeoms.push(boxAt(len, TRIM_H, TRIM_D, mx, TRIM_H / 2, mz, yaw));
            crownGeoms.push(boxAt(len, CROWN_H, TRIM_D, mx, h - CROWN_H / 2, mz, yaw));
          } else {
            const nh = neighborCeil(x + f.ox, y + f.oy);
            if (nh == null) continue;
            const drop = h - nh;
            if (drop > 0.04) {
              const inset = 0.06;
              const mx = (f.x1 + f.x2) / 2 - f.nx * inset;
              const mz = (f.z1 + f.z2) / 2 - f.nz * inset;
              wallGeoms.push(boxAt(len, drop, 0.12, mx, nh + drop / 2, mz, yaw));
            }
          }
        }
        if (!isFloor(x, y - 1)) {
          if (!(isFloor(x - 1, y) && !isFloor(x - 1, y - 1))) jambGeoms.push(boxAt(JAMB, h, JAMB, fx, h / 2, fz, 0));
          if (!(isFloor(x + 1, y) && !isFloor(x + 1, y - 1))) jambGeoms.push(boxAt(JAMB, h, JAMB, fx + CELL_SIZE, h / 2, fz, 0));
        }
        if (!isFloor(x, y + 1)) {
          if (!(isFloor(x - 1, y) && !isFloor(x - 1, y + 1))) jambGeoms.push(boxAt(JAMB, h, JAMB, fx, h / 2, fz + CELL_SIZE, 0));
          if (!(isFloor(x + 1, y) && !isFloor(x + 1, y + 1))) jambGeoms.push(boxAt(JAMB, h, JAMB, fx + CELL_SIZE, h / 2, fz + CELL_SIZE, 0));
        }
      }
    }
    if (wallGeoms.length) {
      const wallMesh = new THREE.Mesh(mergeGeometries(wallGeoms), zoneMats.wallpaper);
      paintBake(wallMesh.geometry, bakeLights);
      wallMesh.material.side = THREE.DoubleSide;
      group.add(wallMesh);
    }
    addBaked(group, trimGeoms, mats.trim, bakeLights);
    addBaked(group, crownGeoms, mats.woodDark, bakeLights);
    addBaked(group, jambGeoms, mats.trim, bakeLights);

    const trayOnGeoms = [];
    const trayOffGeoms = [];
    const tubeOnGeoms = [];
    const tubeOffGeoms = [];
    const lightPoints = [];
    for (const l of chunk.lights) {
      const wx = originX + l.x * CELL_SIZE;
      const wz = originZ + l.y * CELL_SIZE;
      const lx = Math.min(size - 1, Math.max(0, Math.floor(l.x)));
      const ly = Math.min(size - 1, Math.max(0, Math.floor(l.y)));
      const lh = cellH(lx, ly);
      pushFixture(wx, wz, lh, l.broken, trayOnGeoms, trayOffGeoms, tubeOnGeoms, tubeOffGeoms);
      if (!l.broken) {
        lightPoints.push({ x: wx, y: lh - 0.22, z: wz, flicker: !!l.flicker, broken: false });
      }
    }
    if (trayOnGeoms.length) group.add(new THREE.Mesh(mergeGeometries(trayOnGeoms), mats.lightOnTray || mats.lightOn));
    addBaked(group, trayOffGeoms, mats.tray, bakeLights);
    if (tubeOnGeoms.length) group.add(new THREE.Mesh(mergeGeometries(tubeOnGeoms), mats.lightOn));
    addBaked(group, tubeOffGeoms, mats.lightOff, bakeLights);

    const furnGroup = new THREE.Group();
    const maxProps = Math.min(chunk.furniture.length, 10);
    for (let i = 0; i < maxProps; i++) {
      const f = chunk.furniture[i];
      const wx = originX + f.x * CELL_SIZE;
      const wz = originZ + f.y * CELL_SIZE;
      const prop = makeProp(f.type, mats);
      prop.position.set(wx, 0, wz);
      prop.rotation.y = f.rot != null ? f.rot : rng.range(0, Math.PI * 2);
      furnGroup.add(prop);
    }
    group.add(furnGroup);
    furnGroup.updateMatrixWorld(true);
    paintBakeTree(furnGroup, bakeLights);

    if (chunk.columns && chunk.columns.length) {
      const colGeoms = [];
      const capGeoms = [];
      for (const col of chunk.columns) {
        const wx = originX + (col.x + 0.5) * CELL_SIZE;
        const wz = originZ + (col.y + 0.5) * CELL_SIZE;
        const h = cellH(col.x, col.y);
        const shaftH = Math.max(0.5, h - 0.16);
        const shaft = new THREE.BoxGeometry(0.85, shaftH, 0.85);
        shaft.translate(wx, shaftH / 2, wz);
        colGeoms.push(shaft);
        const cap = new THREE.BoxGeometry(1.12, 0.16, 1.12);
        cap.translate(wx, h - 0.08, wz);
        capGeoms.push(cap);
      }
      if (colGeoms.length) {
        const colMesh = new THREE.Mesh(mergeGeometries(colGeoms), mats.column || mats.woodDark);
        paintBake(colMesh.geometry, bakeLights);
        group.add(colMesh);
      }
      if (capGeoms.length) {
        addBaked(group, capGeoms, mats.tray || mats.woodDark, bakeLights);
      }
    }

    if (chunk.puddles && chunk.puddles.length && mats.puddle) {
      const puddleGeoms = [];
      for (const p of chunk.puddles) {
        const s = (p.s || 0.7) * CELL_SIZE;
        const pg = new THREE.CircleGeometry(s * 0.5, 10);
        pg.rotateX(-Math.PI / 2);
        pg.translate(
          originX + (p.x + 0.5) * CELL_SIZE,
          0.025,
          originZ + (p.y + 0.5) * CELL_SIZE
        );
        puddleGeoms.push(pg);
      }
      const puddleMesh = new THREE.Mesh(mergeGeometries(puddleGeoms), mats.puddle);
      paintBake(puddleMesh.geometry, bakeLights);
      puddleMesh.renderOrder = 2;
      group.add(puddleMesh);
    }

    if (chunk.mold && chunk.mold.length && mats.mold) {
      const moldGeoms = [];
      for (const m of chunk.mold) {
        const cx = originX + (m.x + 0.5) * CELL_SIZE;
        const cz = originZ + (m.y + 0.5) * CELL_SIZE;
        const inset = CELL_SIZE * 0.5 - 0.04;
        const px = cx + m.nx * inset;
        const pz = cz + m.nz * inset;
        const geo = new THREE.PlaneGeometry(m.w, m.h);
        geo.translate(0, m.h / 2 + m.yOff, 0);
        geo.rotateY(Math.atan2(-m.nx, -m.nz));
        geo.translate(px, 0, pz);
        moldGeoms.push(geo);
      }
      const moldMesh = new THREE.Mesh(mergeGeometries(moldGeoms), mats.mold);
      paintBake(moldMesh.geometry, bakeLights);
      moldMesh.renderOrder = 2;
      group.add(moldMesh);
    }

    if (chunk.exitPit) {
      const lx = chunk.exitPit.lx;
      const ly = chunk.exitPit.ly;
      const wx = originX + lx * CELL_SIZE + CELL_SIZE / 2;
      const wz = originZ + ly * CELL_SIZE + CELL_SIZE / 2;
      const pit = new THREE.Group();
      const hole = new THREE.Mesh(
        new THREE.BoxGeometry(1.85, 0.38, 1.85),
        mats.metalDead
      );
      hole.position.y = -0.12;
      const well = new THREE.Mesh(
        new THREE.BoxGeometry(1.35, 3.4, 1.35),
        new THREE.MeshBasicMaterial({ color: 0x000000 })
      );
      well.position.y = -1.75;
      pit.add(hole, well);
      const postMat = mats.metalDead;
      for (const [ox, oz] of [[-1.15, -1.15], [1.15, -1.15], [-1.15, 1.15], [1.15, 1.15]]) {
        const post = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.045, 1.08, 6), postMat);
        post.position.set(ox, 0.54, oz);
        pit.add(post);
      }
      const rail = new THREE.Mesh(
        new THREE.BoxGeometry(2.3, 0.03, 0.03),
        mats.metal
      );
      rail.position.set(0, 1.02, -1.15);
      pit.add(rail);
      pit.position.set(wx, 0, wz);
      group.add(pit);
      pit.updateMatrixWorld(true);
      paintBakeTree(pit, bakeLights);
    }

    if (chunk.pockets && chunk.pockets.length) {
      const voidMat = mats.voidWell || new THREE.MeshBasicMaterial({ color: 0x000000 });
      const pitGroup = new THREE.Group();
      for (const p of chunk.pockets) {
        const wx = originX + (p.x + 0.5) * CELL_SIZE;
        const wz = originZ + (p.y + 0.5) * CELL_SIZE;
        const h = cellH(p.x, p.y);
        pitGroup.add(makePocketWell(wx, wz, p.hw, p.deep, h, mats, voidMat));
      }
      group.add(pitGroup);
      pitGroup.updateMatrixWorld(true);
      paintBakeTree(pitGroup, bakeLights);
    }

    if (chunk.trenches && chunk.trenches.length && mats.trenchWater) {
      const trenchGeoms = [];
      for (const t of chunk.trenches) {
        const alongX = t.axis === 'x';
        const w = alongX ? CELL_SIZE * 0.94 : 1.75;
        const d = alongX ? 1.75 : CELL_SIZE * 0.94;
        const g = new THREE.PlaneGeometry(w, d);
        g.rotateX(-Math.PI / 2);
        g.translate(
          originX + (t.x + 0.5) * CELL_SIZE,
          0.04,
          originZ + (t.y + 0.5) * CELL_SIZE
        );
        trenchGeoms.push(g);
      }
      const trenchMesh = new THREE.Mesh(mergeGeometries(trenchGeoms), mats.trenchWater);
      paintBake(trenchMesh.geometry, bakeLights);
      trenchMesh.renderOrder = 2;
      group.add(trenchMesh);
    }

    if (chunk.pipes && chunk.pipes.length) {
      const pipeGeoms = [];
      const riserGeoms = [];
      for (const p of chunk.pipes) {
        if (p.kind === 'riser') {
          const wx = originX + (p.x + 0.55) * CELL_SIZE;
          const wz = originZ + (p.y + 0.55) * CELL_SIZE;
          const h = cellH(p.x, p.y);
          const shaft = Math.max(0.7, h - 0.22);
          const geo = new THREE.CylinderGeometry(p.r || 0.06, p.r || 0.06, shaft, 6);
          geo.translate(wx, shaft / 2 + 0.06, wz);
          riserGeoms.push(geo);
          continue;
        }
        const off = p.off || 0;
        if (p.axis === 'x') {
          const x0 = originX + p.a0 * CELL_SIZE;
          const x1 = originX + (p.a1 + 1) * CELL_SIZE;
          const z = originZ + (p.b + 0.5) * CELL_SIZE + off;
          const midX = (x0 + x1) / 2;
          const len = Math.max(0.8, x1 - x0);
          const mx = Math.min(size - 1, Math.max(0, Math.round((p.a0 + p.a1) / 2)));
          const my = Math.min(size - 1, Math.max(0, p.b));
          const py = cellH(mx, my) - (p.yOff || 0.28);
          const geo = new THREE.CylinderGeometry(p.r || 0.07, p.r || 0.07, len, 6);
          geo.rotateZ(Math.PI / 2);
          geo.translate(midX, py, z);
          pipeGeoms.push(geo);
        } else {
          const z0 = originZ + p.a0 * CELL_SIZE;
          const z1 = originZ + (p.a1 + 1) * CELL_SIZE;
          const x = originX + (p.b + 0.5) * CELL_SIZE + off;
          const midZ = (z0 + z1) / 2;
          const len = Math.max(0.8, z1 - z0);
          const mx = Math.min(size - 1, Math.max(0, p.b));
          const my = Math.min(size - 1, Math.max(0, Math.round((p.a0 + p.a1) / 2)));
          const py = cellH(mx, my) - (p.yOff || 0.28);
          const geo = new THREE.CylinderGeometry(p.r || 0.07, p.r || 0.07, len, 6);
          geo.rotateX(Math.PI / 2);
          geo.translate(x, py, midZ);
          pipeGeoms.push(geo);
        }
      }
      addBaked(group, pipeGeoms, mats.pipe || mats.metal, bakeLights);
      addBaked(group, riserGeoms, mats.pipeDark || mats.metalDead, bakeLights);
    }

    group.position.set(0, 0, 0);
    return { group, lightRig: group, furnGroup, lightPoints };
  }
}

function pushCarpetFrame(geoms, fx, fz, hw, y, ceiling) {
  const half = CELL_SIZE / 2;
  const strip = half - hw;
  if (strip < 0.04) return;
  const cx = fx + half;
  const cz = fz + half;
  const rotX = ceiling ? Math.PI / 2 : -Math.PI / 2;
  const ns = new THREE.PlaneGeometry(CELL_SIZE, strip, 2, 1);
  ns.rotateX(rotX);
  const n1 = ns.clone();
  n1.translate(cx, y, cz + hw + strip / 2);
  geoms.push(n1);
  ns.translate(cx, y, cz - hw - strip / 2);
  geoms.push(ns);
  const ew = new THREE.PlaneGeometry(strip, CELL_SIZE, 1, 2);
  ew.rotateX(rotX);
  const e1 = ew.clone();
  e1.translate(cx + hw + strip / 2, y, cz);
  geoms.push(e1);
  ew.translate(cx - hw - strip / 2, y, cz);
  geoms.push(ew);
}

function makePocketWell(wx, wz, hw, deep, ceilH, mats, voidMat) {
  const g = new THREE.Group();
  const wellW = hw * 2;
  const down = new THREE.Mesh(new THREE.BoxGeometry(wellW, deep, wellW), voidMat);
  down.position.set(wx, -deep / 2 - 0.02, wz);
  const up = new THREE.Mesh(new THREE.BoxGeometry(wellW, 1.15, wellW), voidMat);
  up.position.set(wx, ceilH + 0.55, wz);
  g.add(down, up);
  const lipH = 0.05;
  const lipT = 0.1;
  const lipMat = mats.woodDark;
  const north = new THREE.Mesh(new THREE.BoxGeometry(wellW + lipT * 2, lipH, lipT), lipMat);
  north.position.set(wx, lipH / 2, wz + hw + lipT / 2);
  const south = north.clone();
  south.position.set(wx, lipH / 2, wz - hw - lipT / 2);
  const east = new THREE.Mesh(new THREE.BoxGeometry(lipT, lipH, wellW), lipMat);
  east.position.set(wx + hw + lipT / 2, lipH / 2, wz);
  const west = east.clone();
  west.position.set(wx - hw - lipT / 2, lipH / 2, wz);
  g.add(north, south, east, west);
  const bar = new THREE.Mesh(new THREE.BoxGeometry(wellW * 0.55, 0.04, 0.04), mats.tray || mats.metal);
  bar.position.set(wx, ceilH - 0.08, wz);
  bar.rotation.y = 0.4;
  g.add(bar);
  return g;
}

function pushFixture(wx, wz, ceilH, broken, trayOnGeoms, trayOffGeoms, tubeOnGeoms, tubeOffGeoms) {
  const trayY = ceilH - 0.06;
  const housing = new THREE.BoxGeometry(1.45, 0.09, 0.48);
  housing.translate(wx, trayY, wz);
  (broken ? trayOffGeoms : trayOnGeoms).push(housing);

  const tubeGeoA = new THREE.CylinderGeometry(0.045, 0.045, 1.12, 8);
  tubeGeoA.rotateZ(Math.PI / 2);
  tubeGeoA.translate(wx, trayY - 0.08, wz - 0.08);
  const tubeGeoB = new THREE.CylinderGeometry(0.045, 0.045, 1.12, 8);
  tubeGeoB.rotateZ(Math.PI / 2);
  tubeGeoB.translate(wx, trayY - 0.08, wz + 0.08);
  const dest = broken ? tubeOffGeoms : tubeOnGeoms;
  dest.push(tubeGeoA, tubeGeoB);

  if (!broken) {
    const diffuser = new THREE.BoxGeometry(1.32, 0.05, 0.38);
    diffuser.translate(wx, trayY - 0.06, wz);
    dest.push(diffuser);
  }
}

function makeProp(type, mats) {
  const g = new THREE.Group();
  switch (type) {
    case 'chair': {
      const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.06, 0.46), mats.wood);
      seat.position.y = 0.42;
      const back = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.52, 0.06), mats.wood);
      back.position.set(0, 0.68, -0.2);
      g.add(seat, back);
      const legGeo = new THREE.BoxGeometry(0.05, 0.4, 0.05);
      for (const [lx, lz] of [[-0.18, -0.18], [0.18, -0.18], [-0.18, 0.18], [0.18, 0.18]]) {
        const leg = new THREE.Mesh(legGeo, mats.woodDark);
        leg.position.set(lx, 0.2, lz);
        g.add(leg);
      }
      break;
    }
    case 'shelf': {
      const frame = new THREE.Mesh(new THREE.BoxGeometry(1.35, 1.7, 0.08), mats.woodDark);
      frame.position.set(0, 0.85, -0.14);
      g.add(frame);
      for (let i = 0; i < 4; i++) {
        const board = new THREE.Mesh(new THREE.BoxGeometry(1.32, 0.04, 0.36), mats.wood);
        board.position.set(0, 0.22 + i * 0.42, 0);
        g.add(board);
      }
      break;
    }
    case 'cooler': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.12, 0.38), mats.cooler);
      body.position.y = 0.56;
      const bottle = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.28, 8), mats.plastic);
      bottle.position.set(0, 1.22, 0);
      g.add(body, bottle);
      break;
    }
    case 'table': {
      const top = new THREE.Mesh(new THREE.BoxGeometry(1.28, 0.06, 0.78), mats.wood);
      top.position.y = 0.72;
      g.add(top);
      const legGeo = new THREE.BoxGeometry(0.06, 0.7, 0.06);
      for (const [lx, lz] of [[-0.55, -0.32], [0.55, -0.32], [-0.55, 0.32], [0.55, 0.32]]) {
        const leg = new THREE.Mesh(legGeo, mats.woodDark);
        leg.position.set(lx, 0.35, lz);
        g.add(leg);
      }
      break;
    }
    case 'vending': {
      const body = new THREE.Mesh(new THREE.BoxGeometry(0.95, 1.85, 0.72), mats.metalDead);
      body.position.y = 0.925;
      const glass = new THREE.Mesh(new THREE.BoxGeometry(0.72, 1.1, 0.04), mats.glassDead);
      glass.position.set(0, 1.15, 0.37);
      const kick = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.22, 0.74), mats.metal);
      kick.position.y = 0.11;
      const btn = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.4, 0.05), mats.metal);
      btn.position.set(0.32, 0.55, 0.38);
      g.add(body, glass, kick, btn);
      break;
    }
    case 'mattress': {
      const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.18, 0.9), mats.mattress);
      m.position.y = 0.09;
      g.add(m);
      break;
    }
    case 'cabinet': {
      const c = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.35, 0.48), mats.wood);
      c.position.y = 0.67;
      const door = new THREE.Mesh(new THREE.BoxGeometry(0.36, 1.1, 0.04), mats.woodDark);
      door.position.set(-0.18, 0.7, 0.26);
      g.add(c, door);
      break;
    }
    case 'plant': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.18, 8), mats.woodDark);
      pot.position.y = 0.09;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.22, 6, 6), mats.foliage);
      leaf.position.y = 0.38;
      g.add(pot, leaf);
      break;
    }
    case 'plantDead': {
      const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.13, 0.16, 8), mats.woodDark);
      pot.position.y = 0.08;
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 5), mats.foliageDead || mats.woodDark);
      leaf.position.set(0.06, 0.22, 0.02);
      leaf.scale.set(1.1, 0.45, 0.85);
      leaf.rotation.z = 0.55;
      g.add(pot, leaf);
      break;
    }
    case 'valve': {
      const pipeMat = mats.pipeDark || mats.metal;
      const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 0.55, 6), pipeMat);
      stand.position.y = 0.28;
      const wheel = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.025, 6, 10), mats.metal || pipeMat);
      wheel.position.y = 0.62;
      wheel.rotation.x = Math.PI / 2;
      const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.08, 6), pipeMat);
      hub.position.y = 0.62;
      g.add(stand, wheel, hub);
      break;
    }
    default: {
      const box = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.42, 0.45), mats.wood);
      box.position.y = 0.21;
      g.add(box);
    }
  }
  return g;
}

function boxAt(w, h, d, x, y, z, yaw) {
  const geo = new THREE.BoxGeometry(w, h, d);
  geo.rotateY(yaw);
  geo.translate(x, y, z);
  return geo;
}

function makeWall(x1, z1, x2, z2, height, y0 = 0) {
  const length = Math.hypot(x2 - x1, z2 - z1);
  const segs = Math.max(2, Math.ceil(length / 1.25));
  const geo = new THREE.PlaneGeometry(length, height, segs, 3);
  geo.translate(length / 2, height / 2, 0);
  const angle = Math.atan2(x2 - x1, z2 - z1);
  geo.rotateY(angle - Math.PI / 2);
  geo.translate(x1, y0, z1);
  return geo;
}

function collectBakeLights(chunk, gen, originX, originZ, cellH) {
  const out = [];
  const add = (ch, ox, oz) => {
    if (!ch || !ch.lights) return;
    const size = ch.size;
    const hfn = (x, y) => {
      const v = ch.ceilingHeight && ch.ceilingHeight[y * size + x];
      return v > 0 ? v : CEILING_H;
    };
    for (const l of ch.lights) {
      if (l.broken) continue;
      const lx = Math.min(size - 1, Math.max(0, Math.floor(l.x)));
      const ly = Math.min(size - 1, Math.max(0, Math.floor(l.y)));
      out.push({
        x: ox + l.x * CELL_SIZE,
        y: (ch === chunk ? cellH(lx, ly) : hfn(lx, ly)) - 0.22,
        z: oz + l.y * CELL_SIZE,
      });
    }
  };
  add(chunk, originX, originZ);
  if (gen) {
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        const nb = gen.getChunk(chunk.cx + dx, chunk.cy + dy);
        add(nb, (chunk.cx + dx) * CHUNK_CELLS * CELL_SIZE, (chunk.cy + dy) * CHUNK_CELLS * CELL_SIZE);
      }
    }
  }
  return out;
}

function bakeAt(x, y, z, lights) {
  let e = 0;
  for (const L of lights) {
    const dx = x - L.x;
    const dy = y - L.y;
    const dz = z - L.z;
    const w = 1 / (1 + (dx * dx + dy * dy + dz * dz) * 0.018);
    if (w > e) e = w;
  }
  return e;
}

function addBaked(group, geoms, mat, lights) {
  if (!geoms.length) return;
  const geo = mergeGeometries(geoms);
  paintBake(geo, lights);
  group.add(new THREE.Mesh(geo, mat));
}

export function paintBakeTree(root, lights) {
  if (!root) return;
  root.updateMatrixWorld(true);
  const v = new THREE.Vector3();
  root.traverse((obj) => {
    if (!obj.isMesh) return;
    const mat = obj.material;
    if (!mat || mat.isMeshBasicMaterial) return;
    const src = obj.geometry;
    if (!src?.attributes?.position) return;
    const geo = src.clone();
    obj.geometry = geo;
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(obj.matrixWorld);
      const b = bakeAt(v.x, v.y, v.z, lights);
      const o = i * 3;
      col[o] = b;
      col[o + 1] = b;
      col[o + 2] = b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  });
}

function paintBake(geo, lights) {
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const b = bakeAt(pos.getX(i), pos.getY(i), pos.getZ(i), lights);
    const o = i * 3;
    col[o] = b;
    col[o + 1] = b;
    col[o + 2] = b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
}

function mergeGeometries(geoms) {
  let totalVerts = 0;
  for (const g of geoms) totalVerts += g.attributes.position.count;
  const positions = new Float32Array(totalVerts * 3);
  const normals = new Float32Array(totalVerts * 3);
  const uvs = new Float32Array(totalVerts * 2);
  let vOffset = 0;
  const indices = [];
  let indexOffset = 0;
  for (const g of geoms) {
    positions.set(g.attributes.position.array, vOffset * 3);
    if (g.attributes.normal) normals.set(g.attributes.normal.array, vOffset * 3);
    if (g.attributes.uv) uvs.set(g.attributes.uv.array, vOffset * 2);
    const idx = g.index ? g.index.array : null;
    const vertCount = g.attributes.position.count;
    if (idx) {
      for (let i = 0; i < idx.length; i++) indices.push(idx[i] + indexOffset);
    } else {
      for (let i = 0; i < vertCount; i++) indices.push(i + indexOffset);
    }
    indexOffset += vertCount;
    vOffset += vertCount;
    g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  merged.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  merged.setIndex(indices);
  merged.computeVertexNormals();
  return merged;
}
