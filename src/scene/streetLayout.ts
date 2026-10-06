import * as THREE from 'three';
import { addParkedCars } from './parkedCars.js';
import type { WeatherSceneState } from '../types/weatherScene.js';

// One coordinate system for the street. Flat ground keeps props at y=0;
// sidewalks end at that height and the road sits 14cm below the curb.
export const streetLayout = {
  near: 20,
  far: -48,
  cafeEdge: -3.2,
  curb: 2.7,
  oppositeCurb: 8.9,
  oppositeEdge: 10.2,
};

export function addStreetLayout(
  scene: THREE.Scene,
  onReady: () => void
): {
  update(state: WeatherSceneState): void;
  dispose(): void;
} {
  const root = new THREE.Group();
  root.name = 'coordinated-street';
  scene.add(root);
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const materials = new Map<string, THREE.MeshStandardMaterial>();
  const batches = new Map<string, THREE.Matrix4[]>();
  const dummy = new THREE.Object3D();
  function box(color: string, x: number, y: number, z: number, w: number, h: number, d: number) {
    if (!materials.has(color)) {
      materials.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.94 }));
      batches.set(color, []);
    }
    dummy.position.set(x, y, z);
    dummy.scale.set(w, h, d);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    batches.get(color)!.push(dummy.matrix.clone());
  }
  const { near, far, cafeEdge, curb, oppositeCurb, oppositeEdge } = streetLayout;
  const length = near - far;
  const centerZ = (near + far) / 2;
  const roadCenter = (curb + oppositeCurb) / 2;
  box('#55585a', roadCenter, -0.22, centerZ, oppositeCurb - curb, 0.16, length);
  // Slab tops stay at y=0; the seam bed ends at -0.04, below slab bottoms (-0.03).
  box('#b7ada0', (cafeEdge + curb) / 2, -0.12, centerZ, curb - cafeEdge, 0.16, length);
  box(
    '#c0b7a9',
    (oppositeCurb + oppositeEdge) / 2,
    -0.12,
    centerZ,
    oppositeEdge - oppositeCurb,
    0.16,
    length
  );
  // Leave 10cm at each street edge for the 17cm curb, including a small seam.
  const curbInset = 0.1;
  // Large slabs, with dark seams supplied by the recessed continuous bed beneath.
  for (let z = far; z < near; z += 1.6) {
    for (let column = 0; column < 5; column++) {
      const width = (curb - cafeEdge) / 5;
      box(
        ['#cec5b7', '#d3cabc', '#c8beae'][(column + Math.round((z - far) / 1.6)) % 3],
        cafeEdge + (column + 0.5) * width - (column === 4 ? curbInset / 2 : 0),
        -0.015,
        z + 0.8,
        width - 0.025 - (column === 4 ? curbInset : 0),
        0.03,
        1.575
      );
    }
    box(
      '#d0c7b8',
      (oppositeCurb + oppositeEdge + curbInset) / 2,
      -0.015,
      z + 0.8,
      oppositeEdge - oppositeCurb - curbInset - 0.025,
      0.03,
      1.575
    );
    for (const edge of [curb, oppositeCurb])
      box('#ddd3c3', edge, -0.075, z + 0.8, 0.17, 0.15, 1.58);
  }
  // Markings are just above asphalt; a mid-street crossing establishes scale.
  for (const offset of [-0.09, 0.09])
    box('#d7b35b', roadCenter + offset, -0.135, centerZ, 0.065, 0.008, length);
  for (let x = curb + 0.4; x < oppositeCurb - 0.25; x += 0.65)
    box('#e2dac8', x, -0.128, -14, 0.38, 0.012, 1.8);
  const disposeCars = addParkedCars(root, oppositeCurb, onReady);
  for (const [color, transforms] of batches) {
    const mesh = new THREE.InstancedMesh(geometry, materials.get(color)!, transforms.length);
    transforms.forEach((matrix, index) => mesh.setMatrixAt(index, matrix));
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
  }
  const snowColor = new THREE.Color('#edf2f3');
  return {
    update(state) {
      for (const [color, surface] of materials) {
        // Snow/wet pavement is a placeholder until the full surface layer in R8.
        surface.color.set(color);
        if (
          [
            '#55585a',
            '#b7ada0',
            '#cec5b7',
            '#d3cabc',
            '#c8beae',
            '#d0c7b8',
            '#ddd3c3',
            '#c0b7a9',
          ].includes(color)
        ) {
          surface.color.lerp(snowColor, state.snowCover * 0.88);
          surface.color.multiplyScalar(1 - state.rain * 0.18);
          surface.roughness = 0.94 - state.rain * 0.32;
        }
      }
    },
    dispose() {
      disposeCars();
      scene.remove(root);
      root.traverse(object => {
        if (object instanceof THREE.InstancedMesh) object.dispose();
      });
      geometry.dispose();
      for (const material of materials.values()) material.dispose();
    },
  };
}
