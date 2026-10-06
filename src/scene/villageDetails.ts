import * as THREE from 'three';

// A few handmade landmarks give the recurring village its own identity.
export function addVillageDetails(scene: THREE.Scene): () => void {
  const details = new THREE.Group();
  scene.add(details);
  const geometries: THREE.BufferGeometry[] = [];
  const materials: THREE.Material[] = [];
  const textures: THREE.Texture[] = [];
  const keep = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.push(geometry);
    return geometry;
  };
  const boxGeometry = keep(new THREE.BoxGeometry(1, 1, 1));
  const cylinderGeometry = keep(new THREE.CylinderGeometry(1, 0.8, 1, 10));
  const foliageGeometry = keep(new THREE.DodecahedronGeometry(1));
  const flowerGeometry = keep(new THREE.SphereGeometry(1, 8, 6));
  const planeGeometry = keep(new THREE.PlaneGeometry(1, 1));
  const potRimGeometry = keep(new THREE.TorusGeometry(1, 0.12, 4, 12));
  const palette = new Map<string, THREE.MeshStandardMaterial>();

  function material(color: string): THREE.MeshStandardMaterial {
    const existing = palette.get(color);
    if (existing) return existing;
    const result = new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });
    materials.push(result);
    palette.set(color, result);
    return result;
  }

  function mesh(
    geometry: THREE.BufferGeometry,
    surface: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    parent: THREE.Object3D = details
  ): THREE.Mesh {
    const result = new THREE.Mesh(geometry, surface);
    result.position.set(x, y, z);
    result.scale.set(sx, sy, sz);
    result.castShadow = true;
    result.receiveShadow = true;
    parent.add(result);
    return result;
  }

  function box(
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    parent?: THREE.Object3D
  ): THREE.Mesh {
    return mesh(boxGeometry, material(color), x, y, z, sx, sy, sz, parent);
  }

  function paintedSurface(
    width: number,
    height: number,
    paint: (context: CanvasRenderingContext2D) => void
  ): THREE.MeshStandardMaterial {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d');
    if (context) paint(context);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = 2;
    textures.push(texture);
    const result = new THREE.MeshStandardMaterial({
      map: texture,
      roughness: 1,
      side: THREE.DoubleSide,
    });
    materials.push(result);
    return result;
  }

  const cafeSign = paintedSurface(1024, 184, context => {
    context.fillStyle = '#f7e9cd';
    context.fillRect(0, 0, 1024, 184);
    context.strokeStyle = '#bba17b';
    context.lineWidth = 3;
    context.strokeRect(14, 14, 996, 156);
    context.fillStyle = '#405d50';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.font = '600 76px Georgia, serif';
    context.fillText('MAPLE & MOSS', 512, 77);
    context.font = '22px Arial, sans-serif';
    context.fillText('COFFEE   ·   TEA   ·   SOMETHING SWEET', 512, 139);
  });
  box('#86664d', -5, 3.13, 0.2, 2.92, 0.58, 0.12);
  const fascia = mesh(planeGeometry, cafeSign, -5, 3.13, 0.266, 2.78, 0.5, 1);
  fascia.castShadow = false;

  // A narrow storefront cornice and window boxes keep the facade from feeling blank.
  box('#f2dfbd', -5, 2.79, 0.28, 3.36, 0.09, 0.24);
  for (const x of [-5.95, -4.05]) {
    box('#92634b', x, 1.68, 0.35, 0.93, 0.18, 0.34);
    box('#544b3d', x, 1.79, 0.35, 0.83, 0.035, 0.27);
    for (let i = 0; i < 3; i++) {
      mesh(
        foliageGeometry,
        material(i % 2 ? '#839461' : '#657f57'),
        x - 0.28 + i * 0.28,
        1.85,
        0.39,
        0.19,
        0.13,
        0.17
      );
      mesh(
        flowerGeometry,
        material(i % 2 ? '#efbb75' : '#d89283'),
        x - 0.24 + i * 0.25,
        1.96 + (i % 2) * 0.035,
        0.44,
        0.075,
        0.065,
        0.06
      );
    }
  }

  const chalkboard = paintedSurface(384, 512, context => {
    context.fillStyle = '#354b41';
    context.fillRect(0, 0, 384, 512);
    context.strokeStyle = '#b4c1a9';
    context.lineWidth = 2;
    context.strokeRect(19, 19, 346, 474);
    context.fillStyle = '#ede9d7';
    context.textAlign = 'center';
    context.font = '28px Georgia, serif';
    context.fillText('a little pause', 192, 93);
    context.font = '38px Georgia, serif';
    context.fillText('Good coffee', 192, 169);
    context.fillText('& brighter', 192, 225);
    context.fillText('days', 192, 281);
    context.strokeStyle = '#e8c782';
    context.lineWidth = 4;
    context.beginPath();
    context.arc(192, 384, 27, 0, Math.PI * 2);
    context.stroke();
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2;
      context.beginPath();
      context.moveTo(192 + Math.cos(angle) * 40, 384 + Math.sin(angle) * 40);
      context.lineTo(192 + Math.cos(angle) * 53, 384 + Math.sin(angle) * 53);
      context.stroke();
    }
  });
  const easel = new THREE.Group();
  easel.position.set(-3.05, 0.04, 2.05);
  easel.rotation.y = 0.16;
  details.add(easel);
  for (const side of [-1, 1]) {
    const frontLeg = box('#b78b61', side * 0.39, 0.6, 0, 0.075, 1.22, 0.085, easel);
    frontLeg.rotation.x = -0.12;
    const backLeg = box('#98724f', side * 0.39, 0.59, -0.31, 0.065, 1.18, 0.07, easel);
    backLeg.rotation.x = 0.35;
  }
  const board = box('#bd9569', 0, 0.68, 0.025, 0.79, 1.04, 0.07, easel);
  board.rotation.x = -0.12;
  const chalk = mesh(planeGeometry, chalkboard, 0, 0.68, 0.065, 0.68, 0.91, 1, easel);
  chalk.rotation.x = -0.12;
  chalk.castShadow = false;

  // A terracotta pot, with loose silhouettes rather than a rigid flower grid.
  mesh(cylinderGeometry, material('#bd805d'), -3.97, 0.28, 1.54, 0.31, 0.53, 0.31);
  const rim = mesh(potRimGeometry, material('#cf9370'), -3.97, 0.56, 1.54, 0.31, 0.31, 0.31);
  rim.rotation.x = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    const angle = i * 2.4;
    mesh(
      foliageGeometry,
      material(i % 2 ? '#789364' : '#56764f'),
      -3.97 + Math.cos(angle) * 0.2,
      0.61 + (i % 2) * 0.13,
      1.54 + Math.sin(angle) * 0.16,
      0.22,
      0.16,
      0.21
    );
  }
  for (let i = 0; i < 5; i++) {
    const angle = i * 2.4;
    mesh(
      flowerGeometry,
      material(i % 2 ? '#f3c785' : '#d58b87'),
      -3.97 + Math.cos(angle) * 0.24,
      0.79 + (i % 2) * 0.1,
      1.54 + Math.sin(angle) * 0.2,
      0.095,
      0.073,
      0.09
    );
  }

  const bannerSurface = paintedSurface(256, 448, context => {
    context.fillStyle = '#b77757';
    context.fillRect(0, 0, 256, 448);
    context.strokeStyle = '#ead6ae';
    context.lineWidth = 3;
    context.strokeRect(15, 16, 226, 416);
    context.fillStyle = '#f5e4bd';
    context.textAlign = 'center';
    context.font = '25px Georgia, serif';
    context.fillText('MAPLE', 128, 82);
    context.font = '22px Georgia, serif';
    context.fillText('& MOSS', 128, 120);
    context.save();
    context.translate(128, 256);
    context.rotate(-0.35);
    context.beginPath();
    context.ellipse(0, -18, 31, 65, 0, 0, Math.PI * 2);
    context.fill();
    context.strokeStyle = '#b77757';
    context.lineWidth = 4;
    context.beginPath();
    context.moveTo(0, -67);
    context.lineTo(0, 65);
    context.stroke();
    context.restore();
  });
  box('#45554e', 2.094, 4.537, -0.4, 1.157, 0.059, 0.072);
  box('#b77757', 2.289, 3.835, -0.387, 0.689, 1.209, 0.046);
  const banner = mesh(planeGeometry, bannerSurface, 2.289, 3.835, -0.357, 0.663, 1.183, 1);
  banner.castShadow = false;

  for (const x of [-2.89, 2.09]) {
    box('#c7b69c', x, 0.1, -1.05, 0.18, 0.18, 18.9);
  }

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    scene.remove(details);
    for (const geometry of geometries) geometry.dispose();
    for (const surface of materials) surface.dispose();
    for (const texture of textures) texture.dispose();
  };
}
