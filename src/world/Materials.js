import * as THREE from 'three';

function makeCanvas(size, draw) {
  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const ctx = cv.getContext('2d');
  draw(ctx, size);
  return cv;
}

function noiseFill(ctx, size, base, variance) {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * variance;
    img.data[i] = base[0] + n;
    img.data[i + 1] = base[1] + n;
    img.data[i + 2] = base[2] + n;
    img.data[i + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
}

function darkenEdges(ctx, size, amount = 0.08) {
  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / (size - 1);
      const ny = y / (size - 1);
      const edge = Math.min(nx, ny, 1 - nx, 1 - ny);
      const ao = 1 - amount * (1 - Math.min(1, edge * 6));
      const i = (y * size + x) * 4;
      d[i] *= ao;
      d[i + 1] *= ao;
      d[i + 2] *= ao;
    }
  }
  ctx.putImageData(img, 0, 0);
}

function canvasToNormal(src, strength = 2.4) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const srcData = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  const lum = (i) => (srcData[i] * 0.3 + srcData[i + 1] * 0.59 + srcData[i + 2] * 0.11) / 255;
  const at = (x, y) => {
    const xx = Math.max(0, Math.min(w - 1, x));
    const yy = Math.max(0, Math.min(h - 1, y));
    return lum((yy * w + xx) * 4);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      let nx = -dx, ny = -dy, nz = 1;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      const i = (y * w + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = (ny * 0.5 + 0.5) * 255;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function roughnessFromAlbedo(src, base = 180, variance = 40) {
  const w = src.width, h = src.height;
  const sctx = src.getContext('2d');
  const srcData = sctx.getImageData(0, 0, w, h).data;
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const octx = out.getContext('2d');
  const img = octx.createImageData(w, h);
  for (let i = 0; i < srcData.length; i += 4) {
    const lum = srcData[i] * 0.3 + srcData[i + 1] * 0.59 + srcData[i + 2] * 0.11;
    const r = Math.max(80, Math.min(255, base + (lum - 128) * 0.3 + (Math.random() - 0.5) * variance));
    img.data[i] = img.data[i + 1] = img.data[i + 2] = r;
    img.data[i + 3] = 255;
  }
  octx.putImageData(img, 0, 0);
  return out;
}

function tex(canvas, repeatX, repeatY, colorSpace) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  if (colorSpace) t.colorSpace = colorSpace;
  t.anisotropy = 4;
  return t;
}

function std(map, normalMap, roughnessMap, extras = {}) {
  return new THREE.MeshStandardMaterial({
    map,
    normalMap,
    roughnessMap,
    roughness: extras.roughness ?? 0.92,
    metalness: extras.metalness ?? 0,
    color: extras.color ?? 0xffffff,
    normalScale: extras.normalScale ?? new THREE.Vector2(0.7, 0.7),
  });
}

/** vColor.r = baked fill from working tubes. Added as light on the surface, not a glow. */
export function withBake(mat) {
  mat.vertexColors = true;
  mat.customProgramCacheKey = () => 'brAreaBakeV3';
  mat.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <color_fragment>', '')
      .replace(
        '#include <lights_fragment_end>',
        `#include <lights_fragment_end>
         vec3 brBake = vec3(1.22, 1.08, 0.68) * vColor.r;
         reflectedLight.directDiffuse += diffuseColor.rgb * brBake;
         reflectedLight.indirectDiffuse += diffuseColor.rgb * brBake * 0.35;`
      );
  };
  return mat;
}

export function buildMaterials() {
  // Moist yellow-tan carpet (original photo: beige, damp, not olive)
  const carpetCv = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#c8ae62';
    ctx.fillRect(0, 0, s, s);
    noiseFill(ctx, s, [200, 174, 98], 14);
    ctx.strokeStyle = 'rgba(140, 110, 50, 0.22)';
    ctx.lineWidth = 1;
    for (let i = -s; i < s * 2; i += 28) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i + s, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(i, s); ctx.lineTo(i + s, 0); ctx.stroke();
    }
    for (let i = 0; i < 8; i++) {
      const x = Math.random() * s, y = Math.random() * s, r = 12 + Math.random() * 36;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, r);
      grad.addColorStop(0, 'rgba(90, 70, 28, 0.32)');
      grad.addColorStop(0.55, 'rgba(140, 110, 50, 0.12)');
      grad.addColorStop(1, 'rgba(140, 110, 50, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    }
    darkenEdges(ctx, s, 0.1);
  });

  // Repeating vertical chevrons — the original wallpaper motif
  const wallCv = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#e0ce78';
    ctx.fillRect(0, 0, s, s);
    noiseFill(ctx, s, [224, 206, 120], 9);
    const colW = 22;
    const period = 16;
    ctx.strokeStyle = 'rgba(176, 148, 62, 0.42)';
    ctx.lineWidth = 1.6;
    for (let x = 0; x < s + colW; x += colW) {
      ctx.beginPath();
      for (let y = -period; y <= s + period; y += period) {
        ctx.moveTo(x + 3, y);
        ctx.lineTo(x + colW * 0.5, y + period * 0.5);
        ctx.lineTo(x + 3, y + period);
      }
      ctx.stroke();
      ctx.beginPath();
      for (let y = -period; y <= s + period; y += period) {
        ctx.moveTo(x + colW - 3, y);
        ctx.lineTo(x + colW * 0.5, y + period * 0.5);
        ctx.lineTo(x + colW - 3, y + period);
      }
      ctx.stroke();
    }
    for (let i = 0; i < 2; i++) {
      const x = Math.random() * s;
      const grad = ctx.createLinearGradient(x, 0, x, s);
      grad.addColorStop(0, 'rgba(160, 130, 50, 0.16)');
      grad.addColorStop(0.6, 'rgba(160, 130, 50, 0.05)');
      grad.addColorStop(1, 'rgba(160, 130, 50, 0)');
      ctx.fillStyle = grad;
      ctx.fillRect(x - 10, 0, 20, s);
    }
    darkenEdges(ctx, s, 0.07);
  });

  // Yellowed acoustic tiles + T-bar grid
  const ceilCv = makeCanvas(256, (ctx, s) => {
    ctx.fillStyle = '#e4dcb8';
    ctx.fillRect(0, 0, s, s);
    noiseFill(ctx, s, [228, 220, 184], 10);
    for (let i = 0; i < 80; i++) {
      ctx.fillStyle = `rgba(160,150,120,${0.04 + Math.random() * 0.06})`;
      ctx.fillRect(Math.random() * s, Math.random() * s, 2, 2);
    }
    ctx.strokeStyle = '#b8ae88';
    ctx.lineWidth = 5;
    const step = 64;
    for (let i = 0; i <= s; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(90, 85, 60, 0.25)';
    ctx.lineWidth = 1;
    for (let i = 0; i <= s; i += step) {
      ctx.beginPath(); ctx.moveTo(i, 0); ctx.lineTo(i, s); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, i); ctx.lineTo(s, i); ctx.stroke();
    }
    darkenEdges(ctx, s, 0.08);
  });

  const carpetMap = tex(carpetCv, 2, 2, THREE.SRGBColorSpace);
  const wallMap = tex(wallCv, 3, 1, THREE.SRGBColorSpace);
  const ceilMap = tex(ceilCv, 2, 2, THREE.SRGBColorSpace);

  const carpet = withBake(std(carpetMap, tex(canvasToNormal(carpetCv, 2.4), 2, 2), tex(roughnessFromAlbedo(carpetCv, 165, 28), 2, 2), {
    roughness: 0.78,
    normalScale: new THREE.Vector2(0.55, 0.55),
  }));
  const wallpaper = withBake(std(wallMap, tex(canvasToNormal(wallCv, 1.2), 3, 1), tex(roughnessFromAlbedo(wallCv, 175, 20), 3, 1), {
    roughness: 0.86,
    normalScale: new THREE.Vector2(0.28, 0.28),
  }));
  const ceiling = withBake(std(ceilMap, tex(canvasToNormal(ceilCv, 1.4), 2, 2), tex(roughnessFromAlbedo(ceilCv, 190, 18), 2, 2), {
    roughness: 0.95,
    normalScale: new THREE.Vector2(0.35, 0.35),
  }));

  return {
    carpet,
    wallpaper,
    ceiling,
    lightOn: new THREE.MeshBasicMaterial({ color: 0xfff6c4, toneMapped: false }),
    lightOnTray: new THREE.MeshBasicMaterial({ color: 0xd8c888, toneMapped: false }),
    lightOff: withBake(new THREE.MeshStandardMaterial({ color: 0x4a4a40, emissive: 0x000000 })),
    tray: withBake(new THREE.MeshStandardMaterial({ color: 0x9a9a88, roughness: 0.5, metalness: 0.28 })),
    wood: withBake(new THREE.MeshStandardMaterial({ color: 0x6a5430, roughness: 0.85, metalness: 0.0 })),
    woodDark: withBake(new THREE.MeshStandardMaterial({ color: 0xb8a45c, roughness: 0.82 })),
    trim: withBake(new THREE.MeshStandardMaterial({ color: 0xc9b56a, roughness: 0.72 })),
    mattress: withBake(new THREE.MeshStandardMaterial({ color: 0x77705a, roughness: 1.0 })),
    metal: withBake(new THREE.MeshStandardMaterial({ color: 0x3c4044, roughness: 0.45, metalness: 0.55 })),
    metalDead: withBake(new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.6, metalness: 0.4 })),
    glassDead: withBake(new THREE.MeshStandardMaterial({
      color: 0x1a1c18, roughness: 0.2, metalness: 0.3, emissive: 0x050805, emissiveIntensity: 0.15,
    })),
    cooler: withBake(new THREE.MeshStandardMaterial({ color: 0xa8b0b8, roughness: 0.55, metalness: 0.2 })),
    plastic: withBake(new THREE.MeshStandardMaterial({ color: 0x2a4a88, roughness: 0.4 })),
    foliage: withBake(new THREE.MeshStandardMaterial({ color: 0x2a4a28, roughness: 1 })),
    foliageDead: withBake(new THREE.MeshStandardMaterial({ color: 0x4a3a1c, roughness: 1 })),
    puddle: withBake(new THREE.MeshStandardMaterial({
      color: 0x3a3420,
      roughness: 0.12,
      metalness: 0.55,
      transparent: true,
      opacity: 0.52,
      depthWrite: false,
    })),
    mold: withBake(new THREE.MeshStandardMaterial({
      color: 0x2a3820,
      roughness: 1,
      transparent: true,
      opacity: 0.7,
      side: THREE.DoubleSide,
      depthWrite: false,
    })),
    zones: {
      lobby: { carpet, wallpaper, ceiling },
      lightsOut: {
        carpet: tintStd(carpet, 0x8a7540),
        wallpaper: tintStd(wallpaper, 0xb09048),
        ceiling: tintStd(ceiling, 0x7a7460),
      },
      manila: {
        carpet: tintStd(carpet, 0xf2e8c4),
        wallpaper: tintStd(wallpaper, 0xf6eec8),
        ceiling: tintStd(ceiling, 0xf4eee0),
      },
      pillarHall: {
        carpet: tintStd(carpet, 0xc4b070),
        wallpaper: tintStd(wallpaper, 0xd8c888),
        ceiling: tintStd(ceiling, 0xc8c0a0),
      },
      tightHalls: {
        carpet: tintStd(carpet, 0x9a8450),
        wallpaper: tintStd(wallpaper, 0xc8b060),
        ceiling: tintStd(ceiling, 0x8a8468),
      },
      pitPockets: {
        carpet: tintStd(carpet, 0xb89a52),
        wallpaper: tintStd(wallpaper, 0xd4c070),
        ceiling: tintStd(ceiling, 0xb8b090),
      },
      utility: {
        carpet: tintStd(carpet, 0x5a6a52),
        wallpaper: tintStd(wallpaper, 0x7a8468),
        ceiling: tintStd(ceiling, 0x6a7060),
      },
    },
    column: withBake(new THREE.MeshStandardMaterial({ color: 0xb8a870, roughness: 0.88, metalness: 0.04 })),
    pipe: withBake(new THREE.MeshStandardMaterial({ color: 0x4a5248, roughness: 0.48, metalness: 0.42 })),
    pipeDark: withBake(new THREE.MeshStandardMaterial({ color: 0x3a3228, roughness: 0.62, metalness: 0.28 })),
    trenchWater: withBake(new THREE.MeshStandardMaterial({
      color: 0x1a2818,
      roughness: 0.08,
      metalness: 0.45,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    })),
    voidWell: new THREE.MeshBasicMaterial({ color: 0x000000 }),
  };
}

function tintStd(mat, hex) {
  const m = mat.clone();
  m.color = new THREE.Color(hex);
  return m;
}
