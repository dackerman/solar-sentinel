import * as THREE from 'three';

/** A layered town and continuous wooded ridges, at the same scale as the street. */
export function addDistantVillage(scene: THREE.Scene): () => void {
  const root = new THREE.Group();
  root.name = 'distant-village-and-hills';
  scene.add(root);
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const box = new THREE.BoxGeometry(1, 1, 1);
  const crown = new THREE.IcosahedronGeometry(1, 0);
  geometries.add(box);
  geometries.add(crown);
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  const batches = new Map<string, { geometry: THREE.BufferGeometry; matrices: THREE.Matrix4[] }>();
  const dummy = new THREE.Object3D();
  let seed = 53919;
  const random = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  let placement = new THREE.Matrix4();
  function part(
    color: string,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rz = 0,
    foliage = false
  ): void {
    const key = `${color}:${foliage}`;
    if (!palette.has(key)) {
      const material = new THREE.MeshStandardMaterial({ color, roughness: 0.95 });
      palette.set(key, material);
      materials.add(material);
      batches.set(key, { geometry: foliage ? crown : box, matrices: [] });
    }
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, 0, rz);
    dummy.updateMatrix();
    batches.get(key)!.matrices.push(placement.clone().multiply(dummy.matrix));
  }

  // Each ridge is continuous terrain, with broad overlapping summits rather than cones.
  for (let layer = 0; layer < 3; layer++) {
    const positions: number[] = [],
      colors: number[] = [],
      indices: number[] = [];
    const columns = 64,
      rows = 16;
    const near = -51 - layer * 20;
    const depth = 32;
    const base = new THREE.Color(['#777f58', '#7f9087', '#97a8af'][layer]);
    const heightAt = (x: number, v: number) => {
      const ridge =
        8 + layer * 3.3 + 3.1 * Math.sin(x * 0.075 + layer * 1.8) + 2 * Math.sin(x * 0.14 - layer);
      return (
        -0.4 +
        ridge * Math.pow(Math.sin(v * Math.PI), 0.85) +
        Math.sin(x * 0.23 + v * 5) * Math.sin(v * Math.PI) * 0.5
      );
    };
    for (let row = 0; row <= rows; row++) {
      const v = row / rows;
      for (let column = 0; column <= columns; column++) {
        const x = -72 + (column / columns) * 144;
        positions.push(x, heightAt(x, v), near - v * depth);
        const color = base.clone().multiplyScalar(0.93 + random() * 0.14);
        colors.push(color.r, color.g, color.b);
      }
    }
    for (let row = 0; row < rows; row++)
      for (let column = 0; column < columns; column++) {
        const a = row * (columns + 1) + column,
          b = a + columns + 1;
        indices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    const terrain = new THREE.BufferGeometry();
    terrain.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    terrain.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    terrain.setIndex(indices);
    terrain.computeVertexNormals();
    geometries.add(terrain);
    const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    materials.add(material);
    root.add(new THREE.Mesh(terrain, material));
    // Low-cost tree crowns follow the terrain and break up the nearest ridge silhouette.
    if (layer < 2)
      for (let i = 0; i < 520; i++) {
        const x = -60 + random() * 120,
          v = 0.2 + random() * 0.55;
        const size = 0.95 + random() * 1.15;
        const color = (
          layer ? ['#86917c', '#91957e', '#8a9685'] : ['#987044', '#a98248', '#8c693e', '#767b49']
        )[i % (layer ? 3 : 4)];
        part(
          color,
          x,
          heightAt(x, v) + size * 0.2,
          near - v * depth,
          size,
          size * 0.65,
          size,
          0,
          true
        );
      }
  }

  // Uneven blocks on three depths leave a street opening rather than a facade wall.
  const wallColors = ['#bcaa93', '#b7a391', '#c9b9a1', '#aa9686', '#c2ae91'];
  const roofColors = ['#6c6b69', '#766a62', '#687174'];
  for (let row = 0; row < 3; row++)
    for (let i = 0; i < 13; i++) {
      const x = -24 + i * 4.7 + (row % 2) * 1.8 + (random() - 0.5) * 0.7;
      if (x > 2.1 && x < 10.1) continue;
      const z = -39 - row * 8 - random() * 1.6;
      const width = 2.4 + random() * 1.2,
        depth = 2.6 + random() * 1.1;
      const floors = 2 + (i % 3 === 0 ? 1 : 0),
        height = floors * 1.25 + 0.4;
      const yaw = (random() - 0.5) * 0.24;
      placement = new THREE.Matrix4()
        .makeTranslation(x, 0, z)
        .multiply(new THREE.Matrix4().makeRotationY(yaw));
      part(wallColors[(i + row) % wallColors.length], 0, height / 2, 0, width, height, depth);
      part('#d1c3ac', 0, 0.13, 0, width + 0.09, 0.26, depth + 0.09);
      part('#d8cab4', 0, height - 0.08, depth / 2 + 0.05, width + 0.16, 0.12, 0.15);
      const roof = roofColors[(i + row) % 3];
      if (i % 4 === 0) {
        part(roof, 0, height + 0.05, 0, width + 0.12, 0.12, depth + 0.12);
        for (const side of [-1, 1])
          part('#c9bba4', (side * width) / 2, height + 0.2, 0, 0.12, 0.4, depth + 0.15);
      } else {
        const rise = width * (0.28 + (i % 2) * 0.06),
          half = width / 2 + 0.16;
        const angle = Math.atan2(rise, half);
        for (const side of [-1, 1])
          part(
            roof,
            (side * half) / 2,
            height + rise / 2,
            0,
            Math.hypot(half, rise),
            0.14,
            depth + 0.3,
            -side * angle
          );
        // Fill the gable with stepped masonry behind the roof slopes.
        for (let step = 0; step < 6; step++)
          part(
            wallColors[(i + row) % wallColors.length],
            0,
            height + ((step + 0.5) * rise) / 6,
            0,
            width * (1 - (step + 0.5) / 6),
            rise / 6,
            depth
          );
      }
      part('#918375', width * 0.24, height + 0.65, -depth * 0.15, 0.3, 1.1, 0.35);
      part('#b3a38e', width * 0.24, height + 1.21, -depth * 0.15, 0.4, 0.1, 0.43);
      for (let floor = 0; floor < floors; floor++)
        for (const side of [-1, 1]) {
          const wx = side * width * 0.24,
            y = 0.88 + floor * 1.25;
          part('#daceb8', wx, y, depth / 2 + 0.06, 0.65, 0.9, 0.11);
          part('#56666a', wx, y, depth / 2 + 0.125, 0.49, 0.73, 0.025);
          part('#c4bba7', wx, y, depth / 2 + 0.147, 0.04, 0.75, 0.018);
          part('#ddd0b9', wx, y - 0.47, depth / 2 + 0.15, 0.75, 0.07, 0.25);
          part('#d4c7b1', width / 2 + 0.05, y, side * depth * 0.23, 0.11, 0.85, 0.61);
          part('#5c696b', width / 2 + 0.115, y, side * depth * 0.23, 0.025, 0.68, 0.46);
        }
      part('#596660', 0, 0.65, depth / 2 + 0.1, 0.55, 1.3, 0.08);
      if (row === 0 && i % 3 === 0)
        part('#6b7b70', 0, 1.6, depth / 2 + 0.4, width * 0.85, 0.12, 0.7, -0.05);
    }
  placement.identity();
  for (const [key, batch] of batches) {
    const mesh = new THREE.InstancedMesh(batch.geometry, palette.get(key)!, batch.matrices.length);
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    // Distant detail does not consume the limited near-street shadow map.
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return () => {
    scene.remove(root);
    root.traverse(object => {
      if (object instanceof THREE.InstancedMesh) object.dispose();
    });
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
  };
}
