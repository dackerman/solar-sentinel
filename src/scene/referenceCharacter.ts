import * as THREE from 'three';
import type { WeatherSceneState } from '../types/weatherScene.js';

/** The same traveller in every forecast, with individually articulated clothing and hair. */
export function createReferenceCharacter(scene: THREE.Scene) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const own = <T extends THREE.BufferGeometry>(g: T): T => {
    geometries.add(g);
    return g;
  };
  const sphere = own(new THREE.SphereGeometry(1, 24, 18));
  const box = own(new THREE.BoxGeometry(1, 1, 1));
  const cylinder = own(new THREE.CylinderGeometry(1, 1, 1, 14));
  const color = (value: string, fade = false) => {
    const mat = new THREE.MeshStandardMaterial({
      color: value,
      roughness: 0.78,
      transparent: fade,
    });
    materials.add(mat);
    return mat;
  };
  const skin = color('#efb68c');
  const hairMat = color('#623622');
  const hairHighlight = color('#865039');
  const coat = color('#657250', true);
  const coatDark = color('#4b583b', true);
  const cream = color('#edddba');
  const trouser = color('#45536b', true);
  const brown = color('#76502f');
  const sole = color('#3d3028');
  const orange = color('#b54b2c', true);
  const scarfStripe = color('#e38c4b', true);
  const white = color('#fff1d7');
  const dark = color('#32251e');
  function group(parent: THREE.Object3D, x = 0, y = 0, z = 0) {
    const g = new THREE.Group();
    g.position.set(x, y, z);
    parent.add(g);
    return g;
  }
  function mesh(
    parent: THREE.Object3D,
    g: THREE.BufferGeometry,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
  ) {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    o.castShadow = true;
    o.receiveShadow = true;
    parent.add(o);
    return o;
  }
  function ell(
    parent: THREE.Object3D,
    m: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
  ) {
    return mesh(parent, sphere, m, x, y, z, sx, sy, sz);
  }
  function segment(
    parent: THREE.Object3D,
    m: THREE.Material,
    a: THREE.Vector3,
    b: THREE.Vector3,
    r: number,
    rZ = r
  ) {
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const o = mesh(parent, cylinder, m, mid.x, mid.y, mid.z, r, a.distanceTo(b), rZ);
    o.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    return o;
  }
  const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
  const root = group(scene, -0.55, 0.13, 1.3);
  root.rotation.y = 0.3;
  // Longer legs and a tailored body keep the silhouette closer to an illustrated traveller.
  mesh(root, cylinder, cream, 0, 2.02, 0, 0.31, 0.91, 0.22);
  mesh(root, cylinder, coat, 0, 1.98, -0.035, 0.39, 1.03, 0.27);
  mesh(root, cylinder, coat, 0, 1.56, -0.025, 0.405, 0.22, 0.275);
  mesh(root, box, cream, 0, 2.04, 0.273, 0.3, 0.91, 0.025);
  for (let i = 0; i < 9; i++)
    mesh(root, box, cream, -0.135 + i * 0.034, 2.03, 0.293, 0.008, 0.8, 0.014);
  const leftLap = mesh(root, box, coat, -0.23, 2.19, 0.275, 0.2, 0.83, 0.07);
  leftLap.rotation.z = -0.12;
  const rightLap = mesh(root, box, coat, 0.23, 2.19, 0.275, 0.2, 0.83, 0.07);
  rightLap.rotation.z = 0.12;
  for (let i = 0; i < 5; i++) ell(root, brown, -0.18, 2.42 - i * 0.185, 0.325, 0.023, 0.023, 0.012);
  for (const side of [-1, 1]) {
    const pocket = mesh(root, box, coatDark, side * 0.285, 1.78, 0.264, 0.16, 0.065, 0.04);
    pocket.rotation.z = side * 0.16;
    segment(root, brown, v(side * 0.24, 2.47, 0.285), v(side * 0.29, 1.9, 0.28), 0.034, 0.02);
  }
  ell(root, brown, 0, 2.07, -0.36, 0.39, 0.55, 0.19);
  mesh(root, box, brown, 0, 2.19, -0.5, 0.4, 0.44, 0.1);
  // Offset knees/boots express a gentle walking step even when animation is paused.
  const legs: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const leg = group(root, side * 0.16, 1.49, side === -1 ? 0.15 : -0.12);
    legs.push(leg);
    const knee = v(side * 0.028, -0.61, side === -1 ? 0.07 : -0.14);
    const ankle = v(side * 0.03, -1.17, side === -1 ? 0.23 : -0.06);
    segment(leg, skin, v(0, 0, 0), knee, 0.1);
    segment(leg, skin, knee, ankle, 0.085);
    segment(leg, trouser, v(0, 0, 0), knee, 0.14, 0.13);
    ell(leg, trouser, knee.x, knee.y, knee.z, 0.13, 0.13, 0.13);
    segment(leg, trouser, knee, ankle, 0.105, 0.1);
    const boot = group(leg, ankle.x, -1.25, ankle.z);
    mesh(boot, cylinder, brown, 0, 0.09, 0, 0.12, 0.29, 0.12);
    ell(boot, brown, 0, -0.08, 0.11, 0.145, 0.11, 0.26);
    mesh(boot, box, sole, 0, -0.155, 0.1, 0.29, 0.075, 0.46);
    mesh(boot, cylinder, cream, 0, 0.235, 0, 0.128, 0.085, 0.128);
    for (let i = 0; i < 5; i++)
      mesh(boot, box, cream, 0, 0.09 - i * 0.036, 0.123 + i * 0.023, 0.12, 0.016, 0.023);
  }
  const arms: THREE.Group[] = [];
  for (const side of [-1, 1]) {
    const arm = group(root, side * 0.34, 2.38, 0);
    arms.push(arm);
    const elbow = v(side * 0.13, -0.35, 0.075);
    const hand = v(side * -0.08, -0.15, 0.4);
    segment(arm, skin, v(0, 0, 0), elbow, 0.095);
    segment(arm, skin, elbow, hand, 0.085);
    segment(arm, coat, v(0, 0, 0), elbow, 0.15);
    ell(arm, coat, elbow.x, elbow.y, elbow.z, 0.145, 0.145, 0.14);
    segment(arm, coat, elbow, hand, 0.128);
    ell(arm, cream, hand.x, hand.y - 0.015, hand.z - 0.035, 0.1, 0.08, 0.1);
    ell(arm, skin, hand.x, hand.y + 0.03, hand.z + 0.035, 0.09, 0.115, 0.075);
    for (let i = 0; i < 3; i++)
      ell(
        arm,
        skin,
        hand.x + side * 0.016 * i,
        hand.y + 0.012 + i * 0.018,
        hand.z + 0.096,
        0.015,
        0.015,
        0.022
      );
  }
  segment(root, skin, v(0, 2.47, 0), v(0, 2.76, 0), 0.11);
  const head = group(root, 0, 2.98, 0.01);
  head.rotation.z = -0.04;
  ell(head, skin, 0, 0, 0.018, 0.335, 0.385, 0.3);
  ell(head, skin, 0, -0.2, 0.056, 0.24, 0.19, 0.23);
  ell(head, hairMat, 0, 0.16, -0.075, 0.353, 0.28, 0.3);
  for (const side of [-1, 1]) {
    ell(head, skin, side * 0.325, -0.07, 0.005, 0.059, 0.088, 0.06);
    ell(head, white, side * 0.125, 0.025, 0.29, 0.065, 0.086, 0.027);
    ell(head, dark, side * 0.125 + 0.013, 0.022, 0.316, 0.034, 0.055, 0.013);
    ell(head, white, side * 0.125 + 0.023, 0.047, 0.328, 0.01, 0.014, 0.007);
    const brow = mesh(head, box, hairMat, side * 0.13, 0.146, 0.268, 0.102, 0.024, 0.025);
    brow.rotation.z = side * -0.12;
    ell(head, color('#d98976'), side * 0.215, -0.116, 0.246, 0.052, 0.027, 0.014);
  }
  ell(head, skin, 0.022, -0.066, 0.331, 0.039, 0.045, 0.033);
  const smile = own(new THREE.TorusGeometry(0.066, 0.009, 6, 16, Math.PI));
  const mouth = mesh(head, smile, color('#a15e4b'), 0.02, -0.158, 0.292, 1, 0.48, 1);
  mouth.rotation.z = Math.PI;
  // Curved, layered ribbons extend into the wind rather than a solid hair helmet.
  const flowing = group(head, 0, 0.02, -0.11);
  for (let i = 0; i < 13; i++) {
    const points = [
      v(-0.18 + i * 0.039, 0.1 - (i % 3) * 0.09, -0.05),
      v(-0.43 - i * 0.011, -0.02 - (i % 4) * 0.095, -0.025),
      v(-0.73 - i * 0.008, -0.17 - (i % 4) * 0.075, 0.02),
      v(-0.96 + (i % 3) * 0.06, -0.13 - (i % 4) * 0.095, 0.035),
    ];
    const curve = new THREE.CatmullRomCurve3(points);
    const g = own(new THREE.TubeGeometry(curve, 14, 0.045 + (i % 3) * 0.012, 6, false));
    const strand = new THREE.Mesh(g, i % 3 === 0 ? hairHighlight : hairMat);
    flowing.add(strand);
    strand.castShadow = true;
  }
  // Side swept fringe, placed above the eyes.
  for (let i = 0; i < 5; i++) {
    const curve = new THREE.CatmullRomCurve3([
      v(0.25 - i * 0.04, 0.28, 0.1),
      v(0.07 - i * 0.045, 0.24, 0.28),
      v(-0.15 - i * 0.028, 0.12, 0.28),
    ]);
    const strand = new THREE.Mesh(
      own(new THREE.TubeGeometry(curve, 10, 0.043, 6, false)),
      i % 2 ? hairMat : hairHighlight
    );
    head.add(strand);
    strand.castShadow = true;
  }
  ell(head, orange, 0, 0.32, -0.025, 0.36, 0.22, 0.315);
  mesh(head, cylinder, orange, 0, 0.258, -0.025, 0.361, 0.11, 0.318);
  for (let i = 0; i < 28; i++) {
    const angle = (i * Math.PI * 2) / 28;
    const rib = mesh(
      head,
      cylinder,
      scarfStripe,
      Math.cos(angle) * 0.359,
      0.264,
      -0.025 + Math.sin(angle) * 0.316,
      0.006,
      0.11,
      0.006
    );
    rib.rotation.z = 0.08;
  }
  ell(head, orange, -0.1, 0.545, -0.02, 0.095, 0.095, 0.09);
  for (let i = 0; i < 12; i++)
    ell(
      head,
      scarfStripe,
      -0.1 + Math.sin(i * 2.4) * 0.077,
      0.545 + Math.cos(i * 1.8) * 0.07,
      -0.02 + Math.cos(i * 2.4) * 0.075,
      0.027,
      0.028,
      0.025
    );
  mesh(root, cylinder, orange, 0, 2.66, 0.005, 0.24, 0.2, 0.25);
  const scarf = group(root, -0.15, 2.63, -0.12);
  for (let i = 0; i < 9; i++) {
    const s = mesh(
      scarf,
      box,
      i % 2 ? orange : scarfStripe,
      -0.1 - i * 0.085,
      -0.03 + Math.sin(i * 0.38) * 0.07,
      0.015,
      0.105,
      0.24,
      0.06
    );
    s.rotation.z = -0.12 + i * 0.025;
  }
  for (let i = 0; i < 6; i++)
    mesh(scarf, box, orange, -0.86, -0.13 + i * 0.039, 0.015, 0.13, 0.015, 0.04);
  const hotHat = color('#d8ac58', true);
  mesh(head, cylinder, hotHat, 0, 0.29, -0.02, 0.34, 0.21, 0.29);
  mesh(head, cylinder, hotHat, 0, 0.19, -0.02, 0.48, 0.032, 0.41);
  const towel = color('#f6f1e7', true);
  mesh(arms[1], box, towel, -0.08, -0.18, 0.5, 0.16, 0.21, 0.025);
  const sweat = color('#a5dded', true);
  for (let i = 0; i < 3; i++) ell(head, sweat, 0.25, 0.03 - i * 0.085, 0.235, 0.018, 0.028, 0.016);
  function fade(mat: THREE.Material, value: number) {
    mat.opacity = Math.max(0, Math.min(1, value));
    mat.depthWrite = mat.opacity > 0.98;
  }
  return {
    setVisible(visible: boolean) {
      root.visible = visible;
    },
    update(state: WeatherSceneState, time: number) {
      const cold = Math.max(0, Math.min(1, (72 - state.feelsLike) / 15));
      const winter = Math.max(0, Math.min(1, (65 - state.feelsLike) / 15));
      fade(coat, cold);
      fade(coatDark, cold);
      fade(trouser, (79 - state.temperature) / 10);
      fade(orange, winter);
      fade(scarfStripe, winter);
      fade(hotHat, ((state.temperature - 76) / 10) * (1 - state.rain));
      fade(towel, state.heat);
      fade(sweat, state.heat);
      const wind = state.wind / 35;
      root.rotation.z = state.windX * wind * 0.025;
      flowing.rotation.z = Math.sin(time * 1.9) * wind * 0.04;
      flowing.rotation.y = Math.sin(time * 1.3) * wind * 0.06;
      scarf.rotation.z = Math.sin(time * 2) * wind * 0.075;
      root.position.y = 0.13 + Math.sin(time * 2.2) * 0.008;
      legs[0].rotation.x = Math.sin(time * 2) * 0.012;
      legs[1].rotation.x = -Math.sin(time * 2) * 0.012;
    },
    dispose() {
      scene.remove(root);
      for (const g of geometries) g.dispose();
      for (const m of materials) m.dispose();
    },
  };
}
