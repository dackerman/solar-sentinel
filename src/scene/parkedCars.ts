import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const assets = {
  compact: {
    model: new URL('./assets/cars/compact.glb', import.meta.url).href,
    body: new URL('./assets/cars/compact.jpg', import.meta.url).href,
    wheel: new URL('./assets/cars/compact-wheel.jpg', import.meta.url).href,
  },
  sedan: {
    model: new URL('./assets/cars/sedan.glb', import.meta.url).href,
    body: new URL('./assets/cars/sedan.jpg', import.meta.url).href,
    wheel: new URL('./assets/cars/sedan-wheel.jpg', import.meta.url).href,
  },
};

/** Two cars extracted from the user supplied passenger-car pack, in street units. */
export function addParkedCars(parent: THREE.Group, curb: number, onReady: () => void): () => void {
  const root = new THREE.Group();
  root.name = 'parked-cars';
  parent.add(root);
  let disposed = false;
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const loader = new GLTFLoader();
  const textureLoader = new THREE.TextureLoader();
  async function texture(url: string): Promise<THREE.Texture> {
    const result = await textureLoader.loadAsync(url);
    result.colorSpace = THREE.SRGBColorSpace;
    // Geometry retains FBX UVs; these source textures use the FBX vertical convention.
    result.flipY = true;
    if (disposed) result.dispose();
    else textures.add(result);
    return result;
  }
  function release(object: THREE.Object3D): void {
    object.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      child.geometry.dispose();
      for (const surface of [child.material].flat()) surface.dispose();
    });
  }
  const lights = texture(new URL('./assets/cars/lights.jpg', import.meta.url).href);
  async function load(kind: keyof typeof assets, z: number): Promise<void> {
    const asset = assets[kind];
    const results = await Promise.allSettled([
      loader.loadAsync(asset.model),
      texture(asset.body),
      texture(asset.wheel),
      lights,
    ]);
    const model = results[0];
    if (model.status === 'fulfilled' && (disposed || results.some(r => r.status === 'rejected'))) {
      release(model.value.scene);
    }
    if (disposed) return;
    const failed = results.find(r => r.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    const gltf = (model as PromiseFulfilledResult<Awaited<ReturnType<GLTFLoader['loadAsync']>>>)
      .value;
    const body = (results[1] as PromiseFulfilledResult<THREE.Texture>).value;
    const wheel = (results[2] as PromiseFulfilledResult<THREE.Texture>).value;
    const optics = (results[3] as PromiseFulfilledResult<THREE.Texture>).value;
    const car = gltf.scene;
    car.name = `parked-${kind}`;
    car.traverse(child => {
      if (!(child instanceof THREE.Mesh)) return;
      geometries.add(child.geometry);
      child.castShadow = true;
      child.receiveShadow = true;
      for (const surface of [child.material].flat() as THREE.MeshStandardMaterial[]) {
        materials.add(surface);
        if (surface.name === 'Body') surface.map = body;
        else if (/wheel/i.test(surface.name)) surface.map = wheel;
        else if (surface.name === 'Optics') surface.map = optics;
        surface.needsUpdate = true;
      }
    });
    // GLBs have centered footprints and tire bottoms at y=0. Asphalt is y=-0.14.
    car.position.set(curb - 1.2, -0.14, z);
    root.add(car);
    onReady();
  }
  for (const [kind, z] of [
    ['compact', -4],
    ['sedan', -20],
  ] as const) {
    void load(kind, z).catch(error => {
      if (!disposed) console.error(`Unable to load parked ${kind}: ${(error as Error).message}`);
    });
  }
  return () => {
    disposed = true;
    parent.remove(root);
    for (const geometry of geometries) geometry.dispose();
    for (const material of materials) material.dispose();
    for (const texture of textures) texture.dispose();
  };
}
