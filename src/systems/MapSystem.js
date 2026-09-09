import { CELL_SIZE } from '../world/LevelGenerator.js';

export class MapSystem {
  constructor(world) {
    this.world = world;
    this.discovered = new Set(); // "gx,gy"
    this.markings = []; // player-placed or corrupted markers {gx,gy,glyph}
  }

  update(playerPos) {
    const gx = Math.floor(playerPos.x / CELL_SIZE);
    const gy = Math.floor(playerPos.z / CELL_SIZE);
    const R = 3;
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        if (dx * dx + dy * dy > R * R) continue;
        const wx = gx + dx, wy = gy + dy;
        if (this.world.generator.isWalkable(wx, wy)) {
          this.discovered.add(`${wx},${wy}`);
        }
      }
    }
  }

  forgetRandom(count = 8) {
    const arr = Array.from(this.discovered);
    for (let i = 0; i < count && arr.length; i++) {
      const idx = Math.floor(Math.random() * arr.length);
      this.discovered.delete(arr[idx]);
      arr.splice(idx, 1);
    }
  }

  // Unreliable narrator: fake marks + forgotten rooms
  corrupt(count = 3) {
    const arr = Array.from(this.discovered);
    for (let i = 0; i < count && arr.length; i++) {
      const idx = Math.floor(Math.random() * arr.length);
      this.markings.push({ key: arr[idx], glyph: 'X', fake: true });
    }
    this.forgetRandom(Math.max(4, count));
  }

  draw(ctx, canvas, playerPos, playerYaw) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#0a0906';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const scale = 6;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const pgx = Math.floor(playerPos.x / CELL_SIZE);
    const pgy = Math.floor(playerPos.z / CELL_SIZE);

    ctx.fillStyle = '#8a7a3a';
    for (const key of this.discovered) {
      const [gx, gy] = key.split(',').map(Number);
      const x = cx + (gx - pgx) * scale;
      const y = cy + (gy - pgy) * scale;
      if (x < -scale || y < -scale || x > canvas.width + scale || y > canvas.height + scale) continue;
      ctx.globalAlpha = 0.55 + Math.random() * 0.15; // hand-drawn shimmer
      ctx.fillRect(x, y, scale - 1, scale - 1);
    }
    ctx.globalAlpha = 1;

    for (const m of this.markings) {
      const [gx, gy] = m.key.split(',').map(Number);
      const x = cx + (gx - pgx) * scale;
      const y = cy + (gy - pgy) * scale;
      ctx.fillStyle = '#a33';
      ctx.font = '10px monospace';
      ctx.fillText(m.glyph, x, y + 8);
    }

    // player marker + facing
    ctx.fillStyle = '#e0483c';
    ctx.beginPath();
    ctx.arc(cx, cy, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#e0483c';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx - Math.sin(playerYaw) * 14, cy - Math.cos(playerYaw) * 14);
    ctx.stroke();

    ctx.fillStyle = '#8a7a3a';
    ctx.font = '11px monospace';
    ctx.fillText('N', canvas.width / 2 - 4, 16);
  }
}
