import * as THREE from 'three';
import { addDistantVillage } from './distantVillage.js';

/** Foreground framing and a continuous village street, built from reusable low-poly forms. */
export function addReferenceEnvironment(scene: THREE.Scene): {
  dispose(): void;
  update(temperature: number, snowCover: number, daylight: number): void;
} {
  const root = new THREE.Group();
  root.name = 'reference-village';
  scene.add(root);
  const disposeDistantVillage = addDistantVillage(scene);
  const geometries: THREE.BufferGeometry[] = [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.DodecahedronGeometry(1, 0),
    new THREE.CylinderGeometry(1, 1, 1, 7),
    new THREE.ConeGeometry(1, 1, 8),
  ];
  const materials: THREE.MeshStandardMaterial[] = [];
  const batches = new Map<
    string,
    {
      geometry: THREE.BufferGeometry;
      material: THREE.MeshStandardMaterial;
      transforms: THREE.Matrix4[];
    }
  >();
  const dummy = new THREE.Object3D();
  let seed = 73829;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  function part(
    kind: number,
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    const key = `${kind}:${color}`;
    let batch = batches.get(key);
    if (!batch) {
      const material = new THREE.MeshStandardMaterial({
        color,
        roughness: 0.88,
        flatShading: true,
        side: kind === 4 ? THREE.DoubleSide : THREE.FrontSide,
      });
      materials.push(material);
      batch = { geometry: geometries[kind], material, transforms: [] };
      batches.set(key, batch);
    }
    dummy.position.set(x, y, z);
    dummy.scale.set(sx, sy, sz);
    dummy.rotation.set(rx, ry, rz);
    dummy.updateMatrix();
    batch.transforms.push(dummy.matrix.clone());
  }
  const box = (
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
  ) => part(0, color, x, y, z, sx, sy, sz);
  function branch(a: THREE.Vector3, b: THREE.Vector3, radius: number): void {
    const direction = b.clone().sub(a);
    dummy.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.clone().normalize());
    const rotation = new THREE.Euler().setFromQuaternion(dummy.quaternion);
    const middle = a.clone().add(b).multiplyScalar(0.5);
    part(
      2,
      '#745033',
      middle.x,
      middle.y,
      middle.z,
      radius,
      direction.length(),
      radius,
      rotation.x,
      rotation.y,
      rotation.z
    );
  }

  const wallColors = ['#b87958', '#d6b28b', '#b88c72', '#c6916a', '#d9c8a7'];
  function building(
    x: number,
    z: number,
    width: number,
    height: number,
    color: string,
    depth = 3.5,
    pyramidRoof = true,
    yaw = 0
  ): void {
    const batchStarts = new Map([...batches].map(([key, batch]) => [key, batch.transforms.length]));
    box(color, x, height / 2, z, width, height, depth);
    box('#efe0c1', x, 0.19, z, width + 0.15, 0.38, depth + 0.1);
    box('#e8d6b5', x, height - 0.12, z + depth / 2 + 0.08, width + 0.18, 0.19, 0.25);
    if (pyramidRoof)
      part(3, '#6c5148', x, height + 0.95, z, width * 0.77, 2.1, depth * 0.75, 0, Math.PI / 4);
    box('#97745b', x + width * 0.27, height + 0.82, z - 0.35, 0.38, 1.2, 0.45);
    for (let floor = 0; floor < Math.floor(height / 1.45); floor++) {
      for (let side = -1; side <= 1; side += 2) {
        const wx = x + side * width * 0.25,
          wy = 0.95 + floor * 1.48,
          wz = z + depth / 2;
        box('#f4dfb6', wx, wy, wz + 0.07, 0.7, 1.04, 0.18);
        box('#5b6967', wx, wy, wz + 0.17, 0.54, 0.86, 0.04);
        box('#eed8a9', wx, wy, wz + 0.2, 0.045, 0.9, 0.035);
        box('#eed8a9', wx, wy, wz + 0.2, 0.57, 0.045, 0.035);
        for (const shutter of [-1, 1])
          box('#536455', wx + shutter * 0.46, wy, wz + 0.14, 0.16, 0.92, 0.06);
        box('#ae7651', wx, wy - 0.54, wz + 0.3, 0.92, 0.2, 0.4);
        for (let i = 0; i < 5; i++)
          part(
            1,
            i % 2 ? '#f6bc4b' : '#718449',
            wx - 0.35 + i * 0.17,
            wy - 0.38,
            wz + 0.3,
            0.13,
            0.13,
            0.16
          );
      }
    }
    box('#52665a', x, 0.8, z + depth / 2 + 0.12, 0.8, 1.6, 0.08);
    box('#dab17c', x, 0.78, z + depth / 2 + 0.18, 0.08, 1.4, 0.06);
    box('#e6bf79', x, 1.87, z + depth / 2 + 0.35, width * 0.78, 0.15, 0.8);
    if (yaw) {
      const rotation = new THREE.Matrix4()
        .makeTranslation(x, 0, z)
        .multiply(new THREE.Matrix4().makeRotationY(yaw))
        .multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
      for (const [key, batch] of batches) {
        for (let i = batchStarts.get(key) ?? 0; i < batch.transforms.length; i++)
          batch.transforms[i].premultiply(rotation);
      }
    }
  }
  for (let i = 0; i < 5; i++) {
    building(
      -5.5 - i * 0.12,
      -6.5 - i * 4.7,
      3.3,
      5.8 - i * 0.25 + (i % 2) * 0.7,
      wallColors[i],
      3.5,
      true,
      Math.PI / 2
    );
  }
  // The opposite street has exposed side elevations: from the low camera these
  // windows, shop awnings and rooflines create a continuous receding street wall.
  const roofColors = ['#865449', '#6c5148', '#626473'];
  for (let i = 0; i < 7; i++) {
    const x = 11.9 + i * 0.1;
    const z = -4.8 - i * 4.3;
    const width = 3.4;
    const depth = 4.05;
    const height = 5.3 + (i % 3) * 0.65;
    const streetX = x - width / 2;
    building(x, z, width, height, wallColors[(i + 1) % wallColors.length], depth, false);
    // Long gabled roof, with overhanging eaves and a distinct ridge silhouette.
    for (const side of [-1, 1])
      part(
        0,
        roofColors[i % 3],
        x + side * 0.91,
        height + 0.53,
        z,
        2.17,
        0.13,
        depth + 0.45,
        0,
        0,
        -side * 0.55
      );
    box('#e8d6b5', streetX - 0.05, height - 0.05, z, 0.18, 0.18, depth + 0.23);
    box('#97745b', x + 0.7, height + 1.37, z - 0.6, 0.43, 1.3, 0.5);
    box('#6c5148', x + 0.7, height + 2.05, z - 0.6, 0.61, 0.16, 0.65);
    for (let floor = 0; floor < 3; floor++) {
      const y = 0.97 + floor * 1.57;
      for (const offset of [-1.12, 1.12]) {
        const wz = z + offset;
        box('#f4dfb6', streetX - 0.06, y, wz, 0.15, 1.13, 0.91);
        box('#5b6967', streetX - 0.15, y, wz, 0.055, 0.94, 0.7);
        box('#eed8a9', streetX - 0.2, y, wz, 0.045, 0.96, 0.055);
        box('#eed8a9', streetX - 0.2, y, wz, 0.045, 0.05, 0.73);
        for (const shutter of [-1, 1])
          box('#536455', streetX - 0.15, y, wz + shutter * 0.52, 0.07, 1.0, 0.23);
        box('#ae7651', streetX - 0.29, y - 0.61, wz, 0.53, 0.22, 1.05);
        for (let f = 0; f < 7; f++) {
          part(1, '#718449', streetX - 0.32, y - 0.46, wz - 0.43 + f * 0.14, 0.15, 0.13, 0.15);
          part(
            1,
            f % 2 ? '#f6bc4b' : '#b85128',
            streetX - 0.39,
            y - 0.34,
            wz - 0.43 + f * 0.14,
            0.075,
            0.07,
            0.08
          );
        }
      }
    }
    // Stone corner quoins and broad shop canopies make the closest facade legible.
    for (let q = 0; q < Math.floor(height / 0.48); q++) {
      box('#e8d6b5', streetX - 0.06, 0.24 + q * 0.48, z + depth / 2 - 0.12, 0.19, 0.25, 0.36);
    }
    part(0, i % 2 ? '#536455' : '#e6bf79', streetX - 0.52, 2.0, z, 1.14, 0.12, 2.5, 0, 0, -0.12);
    box('#efe0c1', streetX - 1.07, 1.88, z, 0.08, 0.23, 2.5);
    box('#52665a', streetX - 0.12, 0.84, z, 0.08, 1.64, 0.82);
    box('#dab17c', streetX - 0.18, 0.84, z, 0.07, 1.47, 0.075);
    // Roof dormer facing the street, behind the canopy line.
    box('#d6b28b', streetX + 0.52, height + 0.55, z + 0.55, 0.8, 0.88, 1.05);
    box('#5b6967', streetX + 0.09, height + 0.58, z + 0.55, 0.04, 0.56, 0.54);
    part(
      3,
      roofColors[i % 3],
      streetX + 0.52,
      height + 1.14,
      z + 0.55,
      0.8,
      0.55,
      0.85,
      0,
      Math.PI / 4
    );
  }

  // Slender church spire and clock read as a recognizable landmark behind the shops.
  box('#d8c4a3', 12.6, 4.1, -35, 2.2, 8.2, 2.2);
  box('#e9dbc0', 12.6, 7.9, -35, 2.5, 0.3, 2.5);
  part(3, '#626473', 12.6, 10.25, -35, 1.7, 4.8, 1.7);
  box('#a08152', 12.6, 12.95, -35, 0.1, 0.7, 0.1);
  box('#a08152', 12.6, 13.05, -35, 0.5, 0.1, 0.1);
  for (const side of [-1, 1]) box('#697578', 12.6 + side * 0.48, 6.95, -33.86, 0.35, 1.1, 0.08);
  part(2, '#f2e2b9', 12.6, 5.25, -33.84, 0.69, 0.075, 0.69, Math.PI / 2);
  box('#75674e', 12.6, 5.43, -33.77, 0.05, 0.4, 0.04);
  box('#75674e', 12.78, 5.25, -33.77, 0.39, 0.05, 0.04);

  // Stone planters and floral borders overlap the lower edges, like the reference.
  for (const [x, z, length] of [
    [-3.8, 4.5, 2.1],
    [1.7, 4, 2.3],
    [-3.6, -2, 2],
    [2.0, -2.5, 1.7],
    [1.7, -8, 2.6],
  ]) {
    box('#b3a28b', x, 0.26, z, 1.35, 0.5, length);
    box('#d2c1a6', x, 0.54, z, 1.48, 0.13, length + 0.13);
    for (let i = 0; i < 26; i++) {
      const px = x + (random() - 0.5) * 1.22,
        pz = z + (random() - 0.5) * length,
        y = 0.69 + random() * 0.33;
      part(1, i % 2 ? '#677d42' : '#84944c', px, y, pz, 0.22, 0.22, 0.22);
      for (let f = 0; f < 3; f++)
        part(
          1,
          ['#ef9c2f', '#f8bd45', '#b85128'][i % 3],
          px + (random() - 0.5) * 0.18,
          y + 0.2,
          pz + (random() - 0.5) * 0.18,
          0.07,
          0.06,
          0.07
        );
    }
  }
  // A crooked diagonal trunk, with forks at different points along the bough.
  const trunkPoints = [
    new THREE.Vector3(-4.9, 0, 2.8),
    new THREE.Vector3(-4.65, 2.1, 2.7),
    new THREE.Vector3(-3.65, 3.9, 2.3),
    new THREE.Vector3(-2.5, 4.8, 1.9),
    new THREE.Vector3(-0.9, 5.45, 1.5),
  ];
  for (let i = 0; i < trunkPoints.length - 1; i++)
    branch(trunkPoints[i], trunkPoints[i + 1], 0.25 - i * 0.045);
  const autumnPalette = ['#e78c22', '#edaa31', '#cc6220', '#f4bd49', '#b34722'];
  function canopy(x: number, y: number, z: number, spread: number, count: number): void {
    for (let k = 0; k < count; k++) {
      const angle = random() * Math.PI * 2;
      const radius = Math.sqrt(random()) * spread;
      const size = 0.13 + random() * 0.13;
      part(
        1,
        autumnPalette[k % autumnPalette.length],
        x + Math.cos(angle) * radius,
        y + (random() - 0.5) * spread * 0.8,
        z + Math.sin(angle) * radius * 0.8,
        size,
        size * 0.72,
        size * 0.8,
        random(),
        random(),
        random()
      );
    }
  }
  for (let i = 0; i < 12; i++) {
    const stem = trunkPoints[1 + (i % 3)];
    const side = i % 2 ? 1 : -1;
    const elbow = stem
      .clone()
      .add(
        new THREE.Vector3(
          side * (0.45 + random() * 0.7),
          0.45 + random() * 0.6,
          (random() - 0.5) * 0.7
        )
      );
    const tip = elbow
      .clone()
      .add(new THREE.Vector3(side * 0.55, 0.3 + random() * 0.4, (random() - 0.5) * 0.7));
    branch(stem, elbow, 0.065);
    branch(elbow, tip, 0.038);
    canopy(tip.x, tip.y, tip.z, 0.7, 48);
  }
  canopy(-4.8, 5.1, 2.5, 1.1, 90);
  canopy(-2.2, 5.6, 2, 1.3, 110);

  // Smaller individual leaf clusters keep the distant trees airy, rather than spherical.
  for (let t = 0; t < 12; t++) {
    const x = 2.0 + Math.sin(t) * 0.06,
      z = -5 - t * 3.7,
      height = 3.0 + (t % 2) * 0.35;
    const a = new THREE.Vector3(x, 0, z),
      b = new THREE.Vector3(x + 0.15, height * 0.72, z);
    branch(a, b, 0.12);
    for (let j = 0; j < 5; j++) {
      const angle = j * 2.4;
      const end = new THREE.Vector3(
        x + Math.cos(angle) * 0.65,
        height + Math.sin(j) * 0.32,
        z + Math.sin(angle) * 0.5
      );
      branch(b, end, 0.045);
      canopy(end.x, end.y, end.z, 0.58, 30);
    }
  }
  // Low continuous flower borders tie the foreground planters to the village square.
  for (let i = 0; i < 110; i++) {
    const z = 1 - random() * 24,
      x = (i % 2 ? -3.2 : 2.25) + (random() - 0.5) * 0.45;
    const y = 0.2 + random() * 0.24;
    part(1, i % 2 ? '#677d42' : '#84944c', x, y, z, 0.26, 0.23, 0.32);
    for (let j = 0; j < 3; j++)
      part(
        1,
        autumnPalette[(i + j) % 4],
        x + (random() - 0.5) * 0.25,
        y + 0.21,
        z + (random() - 0.5) * 0.4,
        0.06,
        0.06,
        0.06
      );
  }
  // A serrated maple silhouette stays recognizable even at tiny ground-leaf scale.
  const leafShape = new THREE.Shape();
  leafShape.moveTo(0, 1);
  for (const [x, y] of [
    [0.15, 0.48],
    [0.65, 0.72],
    [0.5, 0.25],
    [0.95, 0.12],
    [0.53, -0.16],
    [0.68, -0.48],
    [0.16, -0.36],
    [0, -0.72],
    [-0.16, -0.36],
    [-0.68, -0.48],
    [-0.53, -0.16],
    [-0.95, 0.12],
    [-0.5, 0.25],
    [-0.65, 0.72],
    [-0.15, 0.48],
  ])
    leafShape.lineTo(x, y);
  leafShape.closePath();
  geometries.push(new THREE.ShapeGeometry(leafShape));
  for (let i = 0; i < 180; i++) {
    const x = -3.6 + random() * 8,
      z = 6 - random() * 19,
      size = 0.07 + random() * 0.14;
    part(
      4,
      ['#de8d24', '#cb6522', '#e6a82c'][i % 3],
      x,
      0.096 + random() * 0.02,
      z,
      size,
      size,
      size,
      -Math.PI / 2,
      0,
      random() * Math.PI * 2
    );
  }
  for (const batch of batches.values()) {
    const instanced = new THREE.InstancedMesh(
      batch.geometry,
      batch.material,
      batch.transforms.length
    );
    batch.transforms.forEach((matrix, i) => instanced.setMatrixAt(i, matrix));
    instanced.castShadow = true;
    instanced.receiveShadow = true;
    instanced.computeBoundingSphere();
    root.add(instanced);
  }
  let disposed = false;
  return {
    update(_temperature: number, snowCover: number, daylight: number) {
      root.visible = true;
      void snowCover;
      for (const material of materials) {
        material.emissiveIntensity = (1 - daylight) * 0.08;
        material.emissive.set(material.color);
      }
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      scene.remove(root);
      disposeDistantVillage();
      geometries.forEach(geometry => geometry.dispose());
      materials.forEach(material => material.dispose());
    },
  };
}
