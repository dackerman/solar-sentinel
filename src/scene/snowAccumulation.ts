import * as THREE from 'three';
import { streetLayout } from './streetLayout.js';

export interface SnowAccumulation {
  refresh(): void;
  update(cover: number): void;
  dispose(): void;
}

// Build a single snow shell from upward-facing triangles, including instanced props.
// The bottom stays on its source surface while the top grows to 30.48 cm (one foot).
// Windows, walls, and undersides remain uncovered; patchy dusting shares world-space noise.
export function addSnowAccumulation(scene: THREE.Scene): SnowAccumulation {
  const uniforms = { snowDepth: { value: 0 }, snowCover: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({
    color: '#f0f7ff',
    roughness: 0.96,
    side: THREE.DoubleSide,
  });
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float snowLift;
        uniform float snowDepth;
        varying vec3 snowPosition;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        snowPosition = position;
        float drift = 0.90 + 0.10 * sin(position.x * 2.1 + position.z * 0.7);
        transformed.y += snowLift * snowDepth * drift;`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float snowCover;
        varying vec3 snowPosition;
        float snowNoise(vec2 p) {
          vec2 i = floor(p), f = fract(p);
          f = f * f * (3.0 - 2.0 * f);
          vec2 k = vec2(127.1, 311.7);
          return mix(mix(fract(sin(dot(i, k)) * 43758.5453),
                         fract(sin(dot(i + vec2(1, 0), k)) * 43758.5453), f.x),
                     mix(fract(sin(dot(i + vec2(0, 1), k)) * 43758.5453),
                         fract(sin(dot(i + vec2(1, 1), k)) * 43758.5453), f.x), f.y);
        }`
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float snowPatch = snowNoise(snowPosition.xz * 2.3 + snowPosition.y * 0.7);
        float fine = snowNoise(snowPosition.xz * 38.0);
        // Light accumulation settles in small patches, then fills into a continuous blanket.
        if (snowPatch > smoothstep(0.0, 0.65, snowCover)) discard;
        diffuseColor.rgb *= 0.94 + fine * 0.06;`
      );
  };
  material.customProgramCacheKey = () => 'surface-snow-v1';
  const root = new THREE.Group();
  root.name = 'snow-accumulation';
  scene.add(root);
  let geometry: THREE.BufferGeometry | undefined;
  let snow: THREE.Mesh | undefined;
  // Deep snow casts shadows with the same displacement as the visible shell.
  const depthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMaterial.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
        attribute float snowLift;
        uniform float snowDepth;
        varying vec3 snowPosition;`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        snowPosition = position;
        transformed.y += snowLift * snowDepth *
          (0.90 + 0.10 * sin(position.x * 2.1 + position.z * 0.7));`
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
        uniform float snowCover;
        varying vec3 snowPosition;`
      )
      // Only cast shadows once the shell is continuous; scattered dust has negligible depth.
      .replace('void main() {', 'void main() { if (snowCover < 0.65) discard;');
  };

  function refresh(): void {
    scene.updateMatrixWorld(true);
    const positions: number[] = [],
      lifts: number[] = [],
      normals: number[] = [];
    const a = new THREE.Vector3(),
      b = new THREE.Vector3(),
      c = new THREE.Vector3();
    const ab = new THREE.Vector3(),
      ac = new THREE.Vector3();
    const transform = new THREE.Matrix4(),
      instance = new THREE.Matrix4();
    const surfaceNormal = new THREE.Vector3();
    const size = new THREE.Vector3();
    const bounds = new THREE.Box3();
    let retention = 1;
    function vertex(v: THREE.Vector3, lift: number): void {
      positions.push(v.x, v.y + 0.008, v.z);
      lifts.push(lift * retention);
      normals.push(surfaceNormal.x, surfaceNormal.y, surfaceNormal.z);
    }
    function cap(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): void {
      surfaceNormal.subVectors(b, a).cross(ac.subVectors(c, a)).normalize();
      vertex(a, 1);
      vertex(b, 1);
      vertex(c, 1);
      for (const [start, end] of [
        [a, b],
        [b, c],
        [c, a],
      ]) {
        surfaceNormal.set(end.z - start.z, 0, start.x - end.x).normalize();
        vertex(start, 0);
        vertex(end, 0);
        vertex(end, 1);
        vertex(start, 0);
        vertex(end, 1);
        vertex(start, 1);
      }
    }
    scene.traverse(object => {
      if (!(object instanceof THREE.Mesh) || object.parent === root || !object.visible) return;
      // Hidden studies (including the traveller) must not produce visible snow shells.
      let ancestor = object.parent;
      while (ancestor) {
        if (!ancestor.visible) return;
        ancestor = ancestor.parent;
      }
      // Explicit continuous ground blankets cover pavement seams and road markings.
      if (object.parent?.name === 'coordinated-street') return;
      const surfaces = Array.isArray(object.material) ? object.material : [object.material];
      if (!surfaces.some(m => m instanceof THREE.MeshStandardMaterial && !m.transparent)) return;
      const source = object.geometry;
      if (source instanceof THREE.ShapeGeometry) return;
      source.computeBoundingBox();
      const attribute = source.getAttribute('position');
      if (!attribute) return;
      const index = source.index;
      const count = index ? index.count : attribute.count;
      const instances = object instanceof THREE.InstancedMesh ? object.count : 1;
      for (let i = 0; i < instances; i++) {
        transform.copy(object.matrixWorld);
        if (object instanceof THREE.InstancedMesh) {
          object.getMatrixAt(i, instance);
          transform.multiply(instance);
        }
        bounds.copy(source.boundingBox!).applyMatrix4(transform).getSize(size);
        // Tiny flower heads and narrow rails shed deep piles; broad seats and roofs retain them.
        retention = THREE.MathUtils.clamp(Math.max(size.x, size.z) * 1.5, 0.12, 1);
        for (let j = 0; j < count; j += 3) {
          a.fromBufferAttribute(attribute, index ? index.getX(j) : j).applyMatrix4(transform);
          b.fromBufferAttribute(attribute, index ? index.getX(j + 1) : j + 1).applyMatrix4(
            transform
          );
          c.fromBufferAttribute(attribute, index ? index.getX(j + 2) : j + 2).applyMatrix4(
            transform
          );
          const up = ab.subVectors(b, a).cross(ac.subVectors(c, a)).normalize().y;
          if (up < 0.38 || Math.max(a.y, b.y, c.y) < -0.05) continue;
          cap(a, b, c);
        }
      }
    });
    const { cafeEdge, curb, oppositeCurb, oppositeEdge, near, far } = streetLayout;
    retention = 1;
    function blanket(left: number, right: number, y: number): void {
      // Subdivision provides softly uneven depth instead of one perfectly flat white plane.
      for (let x = left; x < right; x += 0.8)
        for (let z = far; z < near; z += 0.8) {
          const x2 = Math.min(x + 0.8, right),
            z2 = Math.min(z + 0.8, near);
          a.set(x, y, z);
          b.set(x, y, z2);
          c.set(x2, y, z);
          cap(a, b, c);
          a.set(x2, y, z);
          b.set(x, y, z2);
          c.set(x2, y, z2);
          cap(a, b, c);
        }
    }
    blanket(cafeEdge, curb, 0.003);
    blanket(curb, oppositeCurb, -0.137);
    blanket(oppositeCurb, oppositeEdge, 0.003);
    if (snow) root.remove(snow);
    geometry?.dispose();
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('snowLift', new THREE.Float32BufferAttribute(lifts, 1));
    geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
    snow = new THREE.Mesh(geometry, material);
    snow.customDepthMaterial = depthMaterial;
    snow.castShadow = true;
    snow.receiveShadow = true;
    // Bounds must include the shader-displaced blanket.
    geometry.computeBoundingSphere();
    if (geometry.boundingSphere) geometry.boundingSphere.radius += 0.4;
    root.add(snow);
  }
  refresh();
  return {
    refresh,
    update(cover) {
      const amount = THREE.MathUtils.clamp(cover, 0, 1);
      root.visible = amount > 0.001;
      uniforms.snowCover.value = amount;
      uniforms.snowDepth.value = 0.3048 * amount;
    },
    dispose() {
      scene.remove(root);
      geometry?.dispose();
      material.dispose();
      depthMaterial.dispose();
    },
  };
}
