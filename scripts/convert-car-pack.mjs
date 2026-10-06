import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import fs from 'node:fs';
// Export geometry/material roles; the demo loads the optimized source textures separately.
THREE.TextureLoader.prototype.load = () => new THREE.Texture();
globalThis.FileReader = class {
  readAsArrayBuffer(blob) {
    blob.arrayBuffer().then(result => {
      this.result = result;
      this.onloadend?.();
    });
  }
  readAsDataURL(blob) {
    blob.arrayBuffer().then(result => {
      this.result = 'data:' + blob.type + ';base64,' + Buffer.from(result).toString('base64');
      this.onloadend?.();
    });
  }
};
const input = process.argv[2];
if (!input) throw new Error('Usage: node scripts/convert-car-pack.mjs /path/to/source/fab.fbx');
const output = new URL('../src/scene/assets/cars/', import.meta.url);
fs.mkdirSync(output, { recursive: true });
const buf = fs.readFileSync(input);
const source = new FBXLoader().parse(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
  ''
);
source.updateMatrixWorld(true);
const bodies = source.children.filter(o => /body/i.test(o.name));
for (const [name, id, length] of [
  ['Compact_Body', 'compact', 3.8],
  ['Sedan_Body', 'sedan', 4.5],
]) {
  const body = source.getObjectByName(name);
  const wheels = source.children.filter(
    o =>
      /^Wheel_/i.test(o.name) &&
      bodies.reduce(
        (nearest, b) =>
          o.position.distanceTo(b.position) < o.position.distanceTo(nearest.position) ? b : nearest,
        bodies[0]
      ) === body
  );
  if (wheels.length !== 4) throw new Error(`${name}: ${wheels.length} wheels`);
  const car = new THREE.Group();
  car.name = id;
  // FBX bodies are Z-up. Normalize the pack's display rotation to a Z-long car.
  const yaw = Math.PI - body.rotation.z;
  const normalize = new THREE.Matrix4()
    .makeRotationY(yaw)
    .multiply(new THREE.Matrix4().makeTranslation(-body.position.x, 0, -body.position.z));
  for (const original of [body, ...wheels]) {
    const geometry = original.geometry
      .clone()
      .applyMatrix4(normalize.clone().multiply(original.matrixWorld));
    const materials = [original.material].flat().map(m => {
      const result = new THREE.MeshStandardMaterial({
        name: m.name,
        color: m.name === 'Glass' ? '#23333c' : '#ffffff',
        roughness: m.name === 'Glass' ? 0.15 : 0.7,
        metalness: m.name === 'Body' ? 0.12 : 0,
      });
      // Glazing stays opaque and dark to avoid transparent shell sorting artifacts.
      return result;
    });
    car.add(new THREE.Mesh(geometry, materials));
  }
  let bounds = new THREE.Box3().setFromObject(car);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const scale = length / size.z;
  for (const mesh of car.children)
    mesh.geometry.translate(-center.x, -bounds.min.y, -center.z).scale(scale, scale, scale);
  bounds = new THREE.Box3().setFromObject(car);
  const data = await new GLTFExporter().parseAsync(car, { binary: true });
  fs.writeFileSync(new URL(`${id}.glb`, output), Buffer.from(data));
  console.log(
    id,
    'wheels',
    wheels.length,
    'size',
    bounds.getSize(new THREE.Vector3()).toArray(),
    'bytes',
    data.byteLength
  );
}
