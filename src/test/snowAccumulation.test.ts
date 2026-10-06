import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { addSnowAccumulation } from '../scene/snowAccumulation.js';

function maximumSnowHeight(scene: THREE.Scene): number {
  const root = scene.getObjectByName('snow-accumulation')!;
  const mesh = root.children[0] as THREE.Mesh;
  const positions = mesh.geometry.getAttribute('position');
  let height = -Infinity;
  for (let i = 0; i < positions.count; i++) height = Math.max(height, positions.getY(i));
  return height;
}

describe('snow accumulation surfaces', () => {
  it('excludes meshes inside a hidden character study, including on refresh', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const hiddenStudy = new THREE.Group();
    hiddenStudy.visible = false;
    const character = new THREE.Mesh(geometry, material);
    character.position.y = 10;
    hiddenStudy.add(character);
    scene.add(hiddenStudy);
    const snow = addSnowAccumulation(scene);
    expect(maximumSnowHeight(scene)).toBeLessThan(1);
    snow.refresh();
    expect(maximumSnowHeight(scene)).toBeLessThan(1);
    hiddenStudy.visible = true;
    snow.refresh();
    expect(maximumSnowHeight(scene)).toBeCloseTo(10.508, 3);
    snow.dispose();
    expect(scene.getObjectByName('snow-accumulation')).toBeUndefined();
    geometry.dispose();
    material.dispose();
  });

  it('covers instanced furniture at its world height and has valid edge normals', () => {
    const scene = new THREE.Scene();
    const geometry = new THREE.BoxGeometry(1, 1, 1);
    const material = new THREE.MeshStandardMaterial();
    const furniture = new THREE.InstancedMesh(geometry, material, 1);
    furniture.position.set(3, 2, -4);
    furniture.setMatrixAt(0, new THREE.Matrix4().makeTranslation(0, 3, 0));
    scene.add(furniture);
    const snow = addSnowAccumulation(scene);
    expect(maximumSnowHeight(scene)).toBeCloseTo(5.508, 3);
    const shell = scene.getObjectByName('snow-accumulation')!.children[0] as THREE.Mesh;
    const normals = shell.geometry.getAttribute('normal');
    for (let i = 0; i < normals.count; i++) {
      const length = Math.hypot(normals.getX(i), normals.getY(i), normals.getZ(i));
      expect(length).toBeCloseTo(1, 4);
    }
    snow.update(0);
    expect(shell.parent!.visible).toBe(false);
    snow.update(1);
    expect(shell.parent!.visible).toBe(true);
    snow.dispose();
    furniture.dispose();
    geometry.dispose();
    material.dispose();
  });
});
