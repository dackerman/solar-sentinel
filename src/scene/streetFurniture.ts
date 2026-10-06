import * as THREE from 'three';
import type { WeatherSceneState } from '../types/weatherScene.js';

export function addStreetFurniture(
  scene: THREE.Scene,
  curb: number,
  oppositeCurb: number
): {
  update(state: WeatherSceneState): void;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'street-furniture';
  scene.add(root);
  const geometries = [
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.CylinderGeometry(1, 1, 1, 12),
    new THREE.ConeGeometry(1, 1, 4),
    new THREE.SphereGeometry(1, 8, 6),
    new THREE.TorusGeometry(1, 0.12, 6, 16),
  ];
  const surfaces = {
    metal: new THREE.MeshStandardMaterial({ color: '#34413e', roughness: 0.55, metalness: 0.5 }),
    ceramic: new THREE.MeshStandardMaterial({ color: '#e5dccb', roughness: 0.8 }),
    brass: new THREE.MeshStandardMaterial({ color: '#8c7954', roughness: 0.55, metalness: 0.6 }),
    wood: new THREE.MeshStandardMaterial({ color: '#aa7950', roughness: 0.87 }),
    black: new THREE.MeshStandardMaterial({ color: '#252c29', roughness: 0.92 }),
    glass: new THREE.MeshStandardMaterial({
      color: '#c5d2cb',
      transparent: true,
      opacity: 0.16,
      roughness: 0.15,
      depthWrite: false,
    }),
    light: new THREE.MeshStandardMaterial({
      color: '#eadac0',
      emissive: '#ffbe68',
      emissiveIntensity: 0.2,
      roughness: 0.7,
    }),
  };
  type Surface = keyof typeof surfaces;
  const batches = new Map<string, { kind: number; surface: Surface; matrices: THREE.Matrix4[] }>();
  const dummy = new THREE.Object3D();
  let transform = new THREE.Matrix4();
  function part(
    kind: number,
    surface: Surface,
    x: number,
    y: number,
    z: number,
    w: number,
    h: number,
    d: number,
    rx = 0,
    ry = 0,
    rz = 0
  ): void {
    const key = `${kind}:${surface}`;
    if (!batches.has(key)) batches.set(key, { kind, surface, matrices: [] });
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(rx, ry, rz);
    dummy.updateMatrix();
    batches.get(key)!.matrices.push(transform.clone().multiply(dummy.matrix));
  }
  function place(x: number, z: number, yaw = 0): void {
    transform.makeTranslation(x, 0, z).multiply(new THREE.Matrix4().makeRotationY(yaw));
  }
  const lights: THREE.PointLight[] = [];
  function lamp(x: number, z: number, localLight = false): void {
    place(x, z);
    // Cast iron plinth, stepped collars, a slender shaft and a framed glass lantern.
    part(0, 'metal', 0, 0.07, 0, 0.31, 0.14, 0.31);
    part(1, 'metal', 0, 0.23, 0, 0.13, 0.3, 0.13);
    part(1, 'metal', 0, 1.66, 0, 0.055, 2.65, 0.055);
    for (const y of [0.42, 0.51, 2.88, 2.96]) part(1, 'metal', 0, y, 0, 0.085, 0.06, 0.085);
    part(1, 'brass', 0, 2.91, 0, 0.07, 0.025, 0.07);
    part(0, 'metal', 0, 3.02, 0, 0.35, 0.09, 0.35);
    part(0, 'glass', 0, 3.3, 0, 0.32, 0.48, 0.32);
    for (const x of [-0.16, 0.16])
      for (const z of [-0.16, 0.16]) part(0, 'metal', x, 3.3, z, 0.027, 0.5, 0.027);
    part(0, 'metal', 0, 3.56, 0, 0.4, 0.055, 0.4);
    part(2, 'metal', 0, 3.68, 0, 0.29, 0.2, 0.29, 0, Math.PI / 4);
    part(3, 'brass', 0, 3.82, 0, 0.035, 0.05, 0.035);
    part(1, 'brass', 0, 3.5, 0, 0.025, 0.11, 0.025);
    part(3, 'light', 0, 3.37, 0, 0.065, 0.09, 0.065);
    part(2, 'brass', 0, 3.44, 0, 0.11, 0.07, 0.11);
    if (localLight) {
      const light = new THREE.PointLight('#ffc177', 0, 5, 2);
      light.position.set(x, 3.3, z);
      root.add(light);
      lights.push(light);
    }
  }
  lamp(curb - 0.95, -0.4, true);
  for (const z of [-9, -20, -30, -40, -49]) lamp(curb - 0.4, z);
  for (const z of [-7, -17, -28, -39, -48]) lamp(oppositeCurb + 0.43, z, z === -7);
  function bin(x: number, z: number): void {
    place(x, z);
    part(1, 'black', 0, 0.46, 0, 0.29, 0.88, 0.29);
    for (let i = 0; i < 16; i++) {
      const angle = (i / 16) * Math.PI * 2;
      part(
        0,
        'metal',
        Math.cos(angle) * 0.3,
        0.46,
        Math.sin(angle) * 0.3,
        0.045,
        0.8,
        0.06,
        0,
        -angle
      );
    }
    for (const y of [0.08, 0.86]) part(4, 'metal', 0, y, 0, 0.31, 0.31, 0.31, Math.PI / 2);
    part(1, 'metal', 0, 0.89, 0, 0.33, 0.065, 0.33);
    part(1, 'black', 0, 0.929, 0, 0.2, 0.016, 0.2);
  }
  for (const z of [-4.2, -15, -26, -37]) bin(curb - 0.45, z);
  for (const z of [-12, -33]) bin(oppositeCurb + 0.4, z);
  function chair(x: number, z: number, yaw: number): void {
    place(x, z, yaw);
    for (const x of [-0.22, 0.22])
      for (const z of [-0.2, 0.2]) part(1, 'metal', x, 0.24, z, 0.019, 0.48, 0.019);
    for (let i = 0; i < 4; i++) part(0, 'wood', 0, 0.49, -0.18 + i * 0.12, 0.5, 0.045, 0.1);
    for (const x of [-0.22, 0.22]) part(1, 'metal', x, 0.76, -0.24, 0.018, 0.55, 0.018);
    for (const y of [0.74, 0.89]) part(0, 'wood', 0, y, -0.24, 0.48, 0.11, 0.04);
  }
  for (const [z, degrees] of [
    [-1.5, 35],
    [-10.5, -42],
    [-22.5, 30],
  ]) {
    const x = -2;
    place(x, z);
    part(1, 'metal', 0, 0.04, 0, 0.27, 0.07, 0.27);
    part(1, 'metal', 0, 0.39, 0, 0.035, 0.7, 0.035);
    part(1, 'wood', 0, 0.76, 0, 0.55, 0.065, 0.55);
    part(4, 'brass', 0, 0.793, 0, 0.52, 0.52, 0.52, Math.PI / 2);
    // A small cup catches scale without cluttering the tabletop.
    part(1, 'ceramic', 0.12, 0.85, 0.1, 0.035, 0.08, 0.035);
    // Rotate both seat positions around the table, with their fronts pointing inward.
    const angle = (degrees * Math.PI) / 180;
    const offsetX = Math.sin(angle) * 0.85;
    const offsetZ = Math.cos(angle) * 0.85;
    chair(x - offsetX, z - offsetZ, angle);
    chair(x + offsetX, z + offsetZ, angle + Math.PI);
  }
  for (const batch of batches.values()) {
    const mesh = new THREE.InstancedMesh(
      geometries[batch.kind],
      surfaces[batch.surface],
      batch.matrices.length
    );
    batch.matrices.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = batch.surface !== 'glass' && batch.surface !== 'light';
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  return {
    update(state) {
      const night = 1 - state.daylight;
      surfaces.light.emissiveIntensity = 0.15 + night * 2.4;
      for (const light of lights) light.intensity = night * 1.8;
    },
    dispose() {
      scene.remove(root);
      root.traverse(o => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      for (const g of geometries) g.dispose();
      for (const m of Object.values(surfaces)) m.dispose();
    },
  };
}
