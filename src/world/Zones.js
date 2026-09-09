function hash2(seed, ax, ay) {
  let h = seed ^ (ax * 374761393) ^ (ay * 668265263);
  h = (h ^ (h >>> 13)) * 1274126177;
  h = h ^ (h >>> 16);
  return (h >>> 0) / 4294967296;
}

function isLobbyLocked(_layout, cx, cy) {
  return cx === 0 && cy === 0;
}

export const ZONES = {
  lobby: {
    id: 'lobby',
    label: 'Level 0 — The Lobby',
    ceiling: { min: 2.75, max: 2.75 },
    layout: 'open',
    water: false,
    decay: false,
    lights: { skip: 0.12, broken: 0.08, flicker: 0.14, wash: true },
  },
  lightsOut: {
    id: 'lightsOut',
    label: 'Level 0 — Lights Out',
    ceiling: { min: 2.15, max: 2.45 },
    layout: 'tight',
    water: true,
    decay: true,
    lights: { skip: 0.22, broken: 0.9, flicker: 0.05, wash: false, maxWorking: 1 },
  },
  manila: {
    id: 'manila',
    label: 'Level 0 — Manila Room',
    ceiling: { min: 5.5, max: 5.5 },
    layout: 'manila',
    water: false,
    decay: false,
    lights: { skip: 0.05, broken: 0.02, flicker: 0.03, wash: true },
  },
  pillarHall: {
    id: 'pillarHall',
    label: 'Level 0 — Pillar Hall',
    ceiling: { min: 7.5, max: 7.5 },
    layout: 'pillars',
    water: false,
    decay: false,
    lights: { skip: 0.06, broken: 0.05, flicker: 0.1, wash: true },
  },
  tightHalls: {
    id: 'tightHalls',
    label: 'Level 0 — Tight Halls',
    ceiling: { min: 2.08, max: 2.18 },
    layout: 'onewide',
    water: true,
    decay: false,
    lights: { skip: 0.18, broken: 0.22, flicker: 0.22, wash: true },
  },
  pitPockets: {
    id: 'pitPockets',
    label: 'Level 0 — Pit Pockets',
    ceiling: { min: 2.75, max: 2.75 },
    layout: 'pits',
    water: false,
    decay: false,
    lights: { skip: 0.18, broken: 0.24, flicker: 0.06, wash: true },
  },
  utility: {
    id: 'utility',
    label: 'Level 0 — Utility',
    ceiling: { min: 2.2, max: 3.2 },
    layout: 'utility',
    water: false,
    decay: false,
    lights: { skip: 0.1, broken: 0.14, flicker: 0.28, wash: true },
  },
};

export function getZone(id) {
  return ZONES[id] || ZONES.lobby;
}

/** ~2x2 chunk blobs. Spawn chunk stays lobby. */
export function zoneAt(seed, cx, cy, layout = null) {
  if (isLobbyLocked(layout, cx, cy)) return ZONES.lobby;
  const rx = Math.floor(cx / 2);
  const ry = Math.floor(cy / 2);
  // South: Lights-Out. West: Manila. East: Pillar Hall. North: Tight Halls.
  // Southwest: Pit Pockets. Southeast: Utility.
  if (rx === 0 && ry === -1) return ZONES.lightsOut;
  if (rx === -1 && ry === 0) return ZONES.manila;
  if (rx === 1 && ry === 0) return ZONES.pillarHall;
  if (rx === 0 && ry === 1) return ZONES.tightHalls;
  if (rx === -1 && ry === -1) return ZONES.pitPockets;
  if (rx === 1 && ry === -1) return ZONES.utility;
  const h = hash2(seed, rx, ry);
  if (h < 0.18) return ZONES.lightsOut;
  if (h < 0.30) return ZONES.manila;
  if (h < 0.42) return ZONES.pillarHall;
  if (h < 0.54) return ZONES.tightHalls;
  if (h < 0.66) return ZONES.pitPockets;
  if (h < 0.78) return ZONES.utility;
  return ZONES.lobby;
}
