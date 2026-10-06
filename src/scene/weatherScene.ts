import * as THREE from 'three';
import { createAtmosphereMaterial } from './atmosphere.js';
import { addSnowAccumulation } from './snowAccumulation.js';
import type { SnowAccumulation } from './snowAccumulation.js';
import { cameraPresets } from './cameraPresets.js';
import { addStreetLayout, streetLayout as streetDimensions } from './streetLayout.js';
import { addStreetFurniture } from './streetFurniture.js';
import type { WeatherSceneView } from '../types/weatherScene.js';
import type { WeatherSceneRenderer, WeatherSceneState } from '../types/weatherScene.js';
import { clamp, interpolateScene } from '../utils/weatherScene.js';
import { addVillageDetails } from './villageDetails.js';
import { addReferenceEnvironment } from './referenceEnvironment.js';
import { createReferenceCharacter } from './referenceCharacter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Weather changes one persistent village and traveller.
export function createWeatherScene(
  host: HTMLElement,
  initial: WeatherSceneState,
  onUnavailable: (message: string) => void,
  onCameraChange?: (settings: ReturnType<WeatherSceneRenderer['getCamera']>) => void,
  interactive = true
): WeatherSceneRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const scene = new THREE.Scene();
  let snowSurfaces: SnowAccumulation | undefined;
  let snowSurfacesDirty = false;
  const disposeVillageDetails = addVillageDetails(scene);
  const referenceEnvironment = addReferenceEnvironment(scene);
  const streetLayout = addStreetLayout(scene, () => {
    snowSurfacesDirty = true;
    wake();
  });
  const streetFurniture = addStreetFurniture(
    scene,
    streetDimensions.curb,
    streetDimensions.oppositeCurb
  );
  const referenceCharacter = createReferenceCharacter(scene);
  // Retain the character study for later; this demo currently shows only the environment.
  const showCharacter = false;
  referenceCharacter.setVisible(showCharacter);
  // The retained traveller GLBs are study assets, not production downloads.
  // Keep the environment-only renderer free of their asset URL imports.
  scene.fog = new THREE.Fog('#c7def0', 18, 42);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
  let cameraView: WeatherSceneView = 'original';
  camera.position.fromArray(cameraPresets[cameraView].position);
  camera.lookAt(...cameraPresets[cameraView].target);
  const cameraControls = new OrbitControls(camera, canvas);
  // The main forecast is a backdrop; leave touch scrolling and day swipes to the page.
  cameraControls.enabled = interactive;
  if (!interactive) canvas.style.touchAction = 'pan-y';
  cameraControls.target.fromArray(cameraPresets[cameraView].target);
  cameraControls.minDistance = 1;
  cameraControls.maxDistance = 60;
  cameraControls.update();
  let cameraEdited = false;
  const basePosition = camera.position.clone();
  const baseTarget = cameraControls.target.clone();
  const cameraRight = new THREE.Vector3();
  const cameraUp = new THREE.Vector3();
  const parallax = new THREE.Vector2();
  const parallaxTarget = new THREE.Vector2();
  const getCamera = () => ({
    position: camera.position.toArray(),
    target: cameraControls.target.toArray(),
    rotation: [camera.rotation.x, camera.rotation.y, camera.rotation.z],
    fov: camera.fov,
    aspect: camera.aspect,
  });
  cameraControls.addEventListener('start', () => {
    cameraEdited = true;
  });
  cameraControls.addEventListener('change', () => {
    onCameraChange?.(getCamera());
    wake();
  });
  const composer = new EffectComposer(renderer);
  const renderPass = new RenderPass(scene, camera);
  const depthOfField = new BokehPass(scene, camera, {
    focus: 7.9,
    aperture: 0.00022,
    maxblur: 0.006,
  });
  const bokehUniforms = depthOfField.uniforms as Record<string, THREE.IUniform>;
  const outputPass = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(depthOfField);
  composer.addPass(outputPass);
  const hemisphere = new THREE.HemisphereLight('#fff1d6', '#75726b', 2.5);
  scene.add(hemisphere);
  const sunLight = new THREE.DirectionalLight('#ffe8b6', 3);
  sunLight.position.set(-5, 10, 5);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  Object.assign(sunLight.shadow.camera, {
    left: -24,
    right: 24,
    top: 24,
    bottom: -24,
    near: 0.1,
    far: 90,
  });
  sunLight.shadow.bias = -0.001;
  sunLight.shadow.normalBias = 0.035;
  scene.add(sunLight);
  const fill = new THREE.DirectionalLight('#b9dfff', 0.7);
  fill.position.set(5, 4, -7);
  scene.add(fill);

  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const keep = <T extends THREE.BufferGeometry>(geometry: T): T => {
    geometries.add(geometry);
    return geometry;
  };
  const boxGeometry = keep(new THREE.BoxGeometry(1, 1, 1));
  const sphereGeometry = keep(new THREE.SphereGeometry(1, 16, 12));
  const facetGeometry = keep(new THREE.DodecahedronGeometry(1, 0));
  const cylinderGeometry = keep(new THREE.CylinderGeometry(1, 1, 1, 10));
  const coneGeometry = keep(new THREE.ConeGeometry(1, 1, 4));
  const skyMaterial = createAtmosphereMaterial();
  materials.add(skyMaterial);
  scene.add(new THREE.Mesh(keep(new THREE.SphereGeometry(140, 24, 16)), skyMaterial));
  const palette = new Map<string, THREE.MeshStandardMaterial>();
  function material(color: string, transparent = false): THREE.MeshStandardMaterial {
    if (!transparent && palette.has(color)) return palette.get(color)!;
    const mat = new THREE.MeshStandardMaterial({
      color,
      roughness: 0.83,
      flatShading: true,
      transparent,
    });
    materials.add(mat);
    if (!transparent) palette.set(color, mat);
    return mat;
  }
  function mesh(
    parent: THREE.Object3D,
    geometry: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
  ): THREE.Mesh {
    const object = new THREE.Mesh(geometry, mat);
    object.position.set(x, y, z);
    object.scale.set(sx, sy, sz);
    object.castShadow = true;
    object.receiveShadow = true;
    parent.add(object);
    return object;
  }
  const box = (
    p: THREE.Object3D,
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy: number,
    sz: number
  ) => mesh(p, boxGeometry, material(color), x, y, z, sx, sy, sz);
  function group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const object = new THREE.Group();
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  const grassMaterial = material('#99ad7b');
  mesh(scene, boxGeometry, grassMaterial, 0, -0.5, -14, 64, 0.4, 88);
  const windowMaterial = material('#f6d9a2');
  windowMaterial.emissive.set('#ffbc62');
  function house(x: number, z: number, color: string, width: number, height: number): void {
    const houseGroup = group(scene, x, 0, z);
    houseGroup.rotation.y = Math.PI / 2;
    box(houseGroup, color, 0, height / 2, 0, width, height, 2.6);
    const roof = mesh(
      houseGroup,
      coneGeometry,
      material('#715958'),
      0,
      height + 0.65,
      0,
      width * 0.86,
      1.5,
      2.15
    );
    roof.rotation.y = Math.PI / 4;
    box(houseGroup, '#eee0c4', 0, height - 0.1, 1.35, width + 0.08, 0.14, 0.08);
    for (let floor = 0; floor < 2; floor++) {
      for (let side = -1; side <= 1; side += 2) {
        box(houseGroup, '#695d54', side * width * 0.28, 0.85 + floor * 1.38, 1.33, 0.72, 0.95, 0.1);
        mesh(
          houseGroup,
          boxGeometry,
          windowMaterial,
          side * width * 0.28,
          0.85 + floor * 1.38,
          1.4,
          0.58,
          0.79,
          0.03
        );
        box(
          houseGroup,
          '#eee0c4',
          side * width * 0.28,
          0.85 + floor * 1.38,
          1.43,
          0.05,
          0.83,
          0.05
        );
      }
    }
    box(houseGroup, '#6b7972', 0, 0.65, 1.35, 0.68, 1.3, 0.14);
  }
  house(-5, -1.2, '#dca184', 3.4, 4);
  house(-5.5, 3.8, '#bb916f', 3.2, 6);
  house(-5.2, -5.3, '#e5c68e', 2.8, 3.6);
  const cafeFrontage = group(scene, -5, 0, -1.2);
  // Cafe awning and flower boxes give the fixed background a familiar identity.
  for (let i = 0; i < 7; i++) {
    const awning = box(
      cafeFrontage,
      i % 2 ? '#f4e6c7' : '#7f9f8d',
      -6.45 + i * 0.49,
      2.1,
      0.5,
      0.49,
      0.12,
      1.2
    );
    awning.rotation.x = 0.2;
  }
  for (let i = 0; i < 2; i++) {
    box(cafeFrontage, '#926950', -6 + i * 2.1, 0.42, 0.7, 0.95, 0.5, 0.7);
    for (let j = 0; j < 5; j++) {
      const bloom = mesh(
        cafeFrontage,
        facetGeometry,
        material(j % 2 ? '#d88c82' : '#f5ca7b'),
        -6.36 + i * 2.1 + j * 0.18,
        0.85 + (j % 2) * 0.1,
        0.7,
        0.14,
        0.14,
        0.14
      );
      bloom.castShadow = false;
    }
  }
  // Attached cafe details rotate around the same center as their building.
  for (const child of cafeFrontage.children) child.position.sub(cafeFrontage.position);
  cafeFrontage.rotation.y = Math.PI / 2;
  // The bench follows the curb, facing inward toward the cafe sidewalk.
  const bench = group(scene, 1.5, 0, 0.8);
  bench.rotation.y = Math.PI / 2;
  for (let i = 0; i < 4; i++) {
    box(bench, '#a77850', 0, 0.67, -0.2 + i * 0.19, 2.2, 0.1, 0.14);
    box(bench, '#b8885a', 0, 1.05 + i * 0.14, 0.3, 2.2, 0.1, 0.12);
  }
  for (const x of [-0.85, 0.85]) {
    box(bench, '#4d5b58', x, 0.35, 0.1, 0.13, 0.7, 0.72);
    box(bench, '#4d5b58', x, 0.97, -0.1, 0.12, 0.1, 0.8);
  }
  const trees: THREE.Group[] = [];
  const foliage: THREE.MeshStandardMaterial[] = [];
  for (const [x, z, scale] of [[-3.4, -7, 0.75]]) {
    const tree = group(scene, x, 0, z);
    tree.scale.setScalar(scale);
    trees.push(tree);
    mesh(tree, cylinderGeometry, material('#846954'), 0, 1.65, 0, 0.16, 3.3, 0.16);
    const leafMaterial = material('#cf9c56', true);
    foliage.push(leafMaterial);
    for (let i = 0; i < 7; i++) {
      const crown = mesh(
        tree,
        facetGeometry,
        leafMaterial,
        Math.sin(i * 2.4) * 0.8,
        3.5 + (i % 3) * 0.5,
        Math.cos(i * 2.4) * 0.7,
        0.9,
        1,
        0.9
      );
      crown.castShadow = false;
    }
  }

  const moonMaterial = new THREE.MeshBasicMaterial({ color: '#f0edcf', transparent: true });
  materials.add(moonMaterial);
  const moon = mesh(scene, sphereGeometry, moonMaterial, 5, 6, -10, 0.48, 0.48, 0.48);
  moon.castShadow = false;

  // Bounded particle pools: positions change, geometry never gets recreated.
  const count = 480;
  const snowCapacity = 10000;
  const rainPositions = new Float32Array(count * 6);
  const snowPositions = new Float32Array(snowCapacity * 3);
  const rainGeometry = keep(new THREE.BufferGeometry());
  rainGeometry.setAttribute('position', new THREE.BufferAttribute(rainPositions, 3));
  const rainMaterial = new THREE.LineBasicMaterial({
    color: '#b9d8e5',
    transparent: true,
    opacity: 0.6,
  });
  materials.add(rainMaterial);
  const rain = new THREE.LineSegments(rainGeometry, rainMaterial);
  rain.frustumCulled = false;
  scene.add(rain);
  const snowGeometry = keep(new THREE.BufferGeometry());
  snowGeometry.setAttribute('position', new THREE.BufferAttribute(snowPositions, 3));
  const flakeCanvas = document.createElement('canvas');
  flakeCanvas.width = flakeCanvas.height = 32;
  const context = flakeCanvas.getContext('2d');
  context?.beginPath();
  context?.arc(16, 16, 13, 0, Math.PI * 2);
  if (context) {
    context.fillStyle = 'white';
    context.fill();
  }
  const flakeTexture = new THREE.CanvasTexture(flakeCanvas);
  textures.add(flakeTexture);
  const snowParticleMaterial = new THREE.PointsMaterial({
    color: '#ffffff',
    size: 0.055,
    map: flakeTexture,
    transparent: true,
    depthWrite: false,
  });
  materials.add(snowParticleMaterial);
  const snowParticles = new THREE.Points(snowGeometry, snowParticleMaterial);
  snowParticles.frustumCulled = false;
  scene.add(snowParticles);
  const leafMaterial = material('#d49d53', true);
  const leaves = new THREE.InstancedMesh(facetGeometry, leafMaterial, 30);
  leaves.frustumCulled = false;
  scene.add(leaves);
  const dummy = new THREE.Object3D();
  const puddleMaterial = material('#8caeb5', true);
  puddleMaterial.roughness = 0.12;
  puddleMaterial.metalness = 0.45;
  for (let i = 0; i < 5; i++) {
    const puddle = mesh(
      scene,
      sphereGeometry,
      puddleMaterial,
      -1.5 + (i % 3) * 1.1,
      0.087,
      -3 + i * 1.7,
      0.4 + (i % 2) * 0.2,
      0.006,
      0.28
    );
    puddle.castShadow = false;
  }
  // Stable seeds let a still frame remain readable in reduced-motion mode.
  const seed = (i: number, offset = 0) =>
    (((Math.sin(i * 127.1 + offset * 311.7) * 43758.5453) % 1) + 1) % 1;
  const starsGeometry = keep(new THREE.BufferGeometry());
  const starsPositions = new Float32Array(60 * 3);
  for (let i = 0; i < 60; i++)
    starsPositions.set([(seed(i) - 0.5) * 28, 4 + seed(i, 1) * 9, -16], i * 3);
  starsGeometry.setAttribute('position', new THREE.BufferAttribute(starsPositions, 3));
  const starMaterial = new THREE.PointsMaterial({
    color: '#f9f1da',
    size: 0.035,
    transparent: true,
  });
  materials.add(starMaterial);
  scene.add(new THREE.Points(starsGeometry, starMaterial));

  snowSurfaces = addSnowAccumulation(scene);

  let current = initial;
  let from = initial;
  let target = initial;
  let transitionStart = performance.now();
  let transitioning = false;
  let paused = false;
  let motionPaused = false;
  let disposed = false;
  let contextLost = false;
  let frame = 0;
  let lastFrame = 0;
  let animationTime = 0;
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const skyColor = new THREE.Color();
  const horizonColor = new THREE.Color();
  const daySky = new THREE.Color('#1875d5');
  const overcastSky = new THREE.Color('#748494');
  const nightSky = new THREE.Color('#172b4e');
  const dayHorizon = new THREE.Color('#b9d9f2');
  const nightHorizon = new THREE.Color('#536579');
  const grassColor = new THREE.Color('#98ad78');
  const frozenGrass = new THREE.Color('#bac2b6');
  const summerLeaves = new THREE.Color('#a7b866');
  const autumnLeaves = new THREE.Color('#d69e56');
  const snowyLeaves = new THREE.Color('#e5eee6');
  const sunsetColor = new THREE.Color('#e5ae83');
  const overcastLight = new THREE.Color('#c4ced9');
  const overcastGround = new THREE.Color('#59616b');
  const sunsetLight = new THREE.Color('#ffb66e');
  const overcastFill = new THREE.Color('#cad4e0');
  const snowHaze = new THREE.Color('#d5e0eb');

  function fade(mat: THREE.Material, opacity: number): void {
    mat.opacity = clamp(opacity);
    mat.depthWrite = mat.opacity > 0.98;
  }
  function draw(time: number): void {
    const state = current;
    const wind = state.wind / 35;
    const breeze =
      wind * (0.65 + Math.sin(time * 1.7) * 0.2 + (state.gust / 100) * Math.sin(time * 3.1));
    const overcast = THREE.MathUtils.smoothstep(state.cloud, 0.45, 1);
    const storm = Math.max(state.rain, state.snow * 0.55);
    const dusk = state.daylight * (1 - Math.sin(clamp((state.hour - 6) / 13) * Math.PI));
    const directSun = Math.pow(1 - state.cloud, 2.4);
    skyColor
      .copy(daySky)
      .lerp(overcastSky, overcast)
      .lerp(nightSky, 1 - state.daylight);
    horizonColor
      .copy(dayHorizon)
      .lerp(overcastSky, overcast)
      .lerp(nightHorizon, 1 - state.daylight);
    horizonColor.lerp(sunsetColor, dusk * (1 - overcast) * 0.6);
    host.style.background = `linear-gradient(${skyColor.getStyle()}, ${horizonColor.getStyle()})`;
    skyMaterial.uniforms.top.value.copy(skyColor);
    skyMaterial.uniforms.horizon.value.copy(horizonColor);
    skyMaterial.uniforms.cloudCover.value = state.cloud;
    skyMaterial.uniforms.daylight.value = state.daylight;
    skyMaterial.uniforms.storm.value = storm;
    skyMaterial.uniforms.dusk.value = dusk;
    skyMaterial.uniforms.time.value = time;
    skyMaterial.uniforms.drift.value.set(state.windX * (0.2 + wind), state.windZ * (0.2 + wind));
    (scene.fog as THREE.Fog).color
      .copy(horizonColor)
      .lerp(snowHaze, state.snow * state.daylight * 0.65);
    (scene.fog as THREE.Fog).near = 35 - overcast * 9 - state.fog * 20;
    (scene.fog as THREE.Fog).far = 150 - overcast * 45 - state.fog * 88;
    // Warm direct sunlight / cool skylight give way to a soft, darker overcast fill.
    hemisphere.color.set('#bedbff').lerp(overcastLight, overcast);
    hemisphere.groundColor.set('#77735f').lerp(overcastGround, overcast);
    hemisphere.intensity = 0.2 + state.daylight * (1.55 - overcast * 0.45 - storm * 0.2);
    sunLight.intensity = 0.08 * (1 - state.daylight) + state.daylight * 3.6 * directSun;
    const solarAngle = clamp((state.hour - 6) / 13) * Math.PI;
    sunLight.position.set(-Math.cos(solarAngle) * 24, 8 + Math.sin(solarAngle) * 28, -18);
    sunLight.color.set('#fff0d5').lerp(sunsetLight, dusk);
    skyMaterial.uniforms.sunDirection.value.copy(sunLight.position).normalize();
    fill.color.set('#a9cbff').lerp(overcastFill, overcast);
    fill.intensity = 0.12 + state.daylight * (0.32 + overcast * 0.2);
    renderer.toneMappingExposure = 1.12 + state.daylight * 0.08 - overcast * 0.08;
    windowMaterial.emissiveIntensity = 0.15 + (1 - state.daylight) * 1.8 + overcast * 0.3;
    fade(moonMaterial, (1 - state.daylight) * (1 - state.cloud));
    fade(starMaterial, (1 - state.daylight) * (1 - state.cloud));
    grassMaterial.color.copy(grassColor).lerp(frozenGrass, state.snowCover);
    const warm = clamp((state.temperature - 45) / 35);
    for (const mat of foliage) {
      mat.color.copy(autumnLeaves).lerp(summerLeaves, warm).lerp(snowyLeaves, state.snowCover);
      fade(mat, 1);
    }
    for (const tree of trees) tree.rotation.z = -breeze * 0.025 * state.windX;
    if (snowSurfacesDirty) {
      snowSurfaces?.refresh();
      snowSurfacesDirty = false;
    }
    snowSurfaces?.update(state.snowCover);
    fade(puddleMaterial, state.rain * 0.6);
    referenceEnvironment.update(state.temperature, state.snowCover, state.daylight);
    streetLayout.update(state);
    streetFurniture.update(state);
    referenceCharacter.update(state, time);
    const rainCount = Math.round(count * state.rain);
    const snowCount = Math.round(snowCapacity * Math.pow(state.snow, 1.65));
    rainGeometry.setDrawRange(0, rainCount * 2);
    snowGeometry.setDrawRange(0, snowCount);
    for (let i = 0; i < Math.max(rainCount, snowCount); i++) {
      const x = (seed(i) - 0.5) * 18;
      const z = (seed(i, 2) - 0.5) * 13;
      if (i < rainCount) {
        const y = (((seed(i, 1) * 9 - time * (6 + state.rain * 4)) % 9) + 9) % 9;
        const drift = state.windX * wind;
        rainPositions.set(
          [
            x + drift * (9 - y) * 0.3,
            y,
            z,
            x + drift * (9 - y + 0.4) * 0.3,
            y - 0.4,
            z + state.windZ * wind * 0.1,
          ],
          i * 6
        );
      }
      if (i < snowCount) {
        // Deep field of flakes with wind-driven sheets and a few larger foreground flakes.
        const speed = 0.7 + seed(i, 3) * 1.1 + state.snow * 1.6;
        const y = (((seed(i, 1) * 14 - time * speed) % 14) + 14) % 14;
        const fall = 14 - y;
        const squall = Math.sin(time * 0.8 + seed(i, 4) * 6.28) * state.snow * wind;
        const travelX = state.windX * (wind * 1.7 + squall * 0.6) * fall;
        const travelZ = state.windZ * wind * fall;
        const sx = (seed(i) - 0.5) * 30 + travelX + Math.sin(time * 0.8 + i) * 0.35;
        const sz = 11 - seed(i, 2) * (i % 3 ? 25 : 62) + travelZ;
        snowPositions.set([((((sx + 15) % 30) + 30) % 30) - 15, y, sz], i * 3);
      }
    }
    rainGeometry.attributes.position.needsUpdate =
      snowGeometry.attributes.position.needsUpdate = true;
    snowParticleMaterial.size = 0.045 + state.snow * 0.04;
    const leafCount = Math.round(
      clamp((state.wind - 3) / 30) * 30 * (1 - state.snowCover) * (1 - state.snow)
    );
    leaves.count = leafCount;
    for (let i = 0; i < leafCount; i++) {
      const travel = ((seed(i) * 16 + time * (0.3 + wind * 2)) % 16) - 8;
      dummy.position.set(
        travel * (state.windX || 0.1),
        0.4 + seed(i, 1) * 2.5 + Math.sin(time + i) * 0.3,
        (seed(i, 2) - 0.5) * 6 + travel * state.windZ * 0.4
      );
      dummy.rotation.set(time + i, time * 1.5, i);
      dummy.scale.set(0.09, 0.02, 0.055);
      dummy.updateMatrix();
      leaves.setMatrixAt(i, dummy.matrix);
    }
    leaves.instanceMatrix.needsUpdate = true;
    scene.traverse(object => {
      if (
        object instanceof THREE.Mesh &&
        !Array.isArray(object.material) &&
        object.material.transparent
      ) {
        object.visible = object.material.opacity > 0.01;
      }
    });
    // Follow the edited composition, keeping the sidewalk/midground in focus.
    bokehUniforms.focus.value = Math.max(
      3,
      camera.position.distanceTo(cameraControls.target) * 0.82
    );
    composer.render();
  }
  function tick(now: number): void {
    frame = 0;
    if (disposed || paused || contextLost) return;
    // 30 fps is sufficient for the quiet scene and halves idle rendering work.
    if (now - lastFrame >= 32 || motion.matches || motionPaused) {
      const delta = Math.min((now - lastFrame) / 1000, 0.05);
      lastFrame = now;
      if (transitioning) {
        const t = clamp((now - transitionStart) / 1100);
        current = interpolateScene(from, target, t * t * (3 - 2 * t));
        transitioning = t < 1;
      }
      if (!motion.matches && !motionPaused) animationTime += delta;
      if (!interactive) {
        if (motion.matches || motionPaused) parallax.set(0, 0);
        else parallax.lerp(parallaxTarget, 1 - Math.exp(-delta * 8));
        camera.position.copy(basePosition);
        camera.lookAt(baseTarget);
        cameraRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
        cameraUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
        const portrait = camera.aspect < 0.8;
        camera.position
          .addScaledVector(cameraRight, parallax.x * (portrait ? 0.55 : 0.38))
          .addScaledVector(cameraUp, -parallax.y * (portrait ? 0.3 : 0.18));
        // Keep the street's focal point anchored as the foreground shifts.
        camera.lookAt(baseTarget);
      }
      draw(animationTime);
    }
    if ((!motion.matches && !motionPaused) || transitioning) frame = requestAnimationFrame(tick);
  }
  function wake(): void {
    if (!disposed && !paused && !contextLost && !frame) frame = requestAnimationFrame(tick);
  }
  function resize(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (!width || !height) return;
    const aspect = width / height;
    camera.aspect = aspect;
    if (!cameraEdited) {
      const preset = cameraPresets[cameraView];
      camera.fov = aspect < 1.3 ? 48 : preset.fov;
      camera.position.fromArray(preset.position);
      cameraControls.target.fromArray(preset.target);
      if (!interactive && aspect < 0.8) {
        // A portrait forecast needs the whole street, not a narrow sky crop.
        camera.fov = 62;
        camera.position.set(-2, 3, 14);
        cameraControls.target.set(1.5, 1.8, -7);
      }
      cameraControls.update();
    }
    camera.updateProjectionMatrix();
    if (!interactive) {
      basePosition.copy(camera.position);
      baseTarget.copy(cameraControls.target);
      parallax.set(0, 0);
    }
    onCameraChange?.(getCamera());
    renderer.setSize(width, height, false);
    // Gentle desktop depth of field; preserve the cheaper, sharp mobile view.
    depthOfField.enabled = width >= 600;
    bokehUniforms.aspect.value = aspect;
    composer.setSize(width, height);
    wake();
  }
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  const handleMotion = (): void => {
    if (motion.matches) {
      current = target;
      transitioning = false;
      parallaxTarget.set(0, 0);
    }
    wake();
  };
  const handleLost = (event: Event): void => {
    event.preventDefault();
    contextLost = true;
    cancelAnimationFrame(frame);
    frame = 0;
    onUnavailable('Scene paused while graphics recover.');
  };
  const handleRestored = (): void => {
    contextLost = false;
    onUnavailable('');
    wake();
  };
  canvas.addEventListener('webglcontextlost', handleLost);
  canvas.addEventListener('webglcontextrestored', handleRestored);
  motion.addEventListener('change', handleMotion);
  resize();
  return {
    setParallax(x, y) {
      if (interactive || motion.matches || motionPaused || paused) return;
      parallaxTarget.set(
        Number.isFinite(x) ? clamp(x, -1, 1) : 0,
        Number.isFinite(y) ? clamp(y, -1, 1) : 0
      );
      wake();
    },
    getCamera,
    setCameraView(view) {
      cameraView = view;
      cameraEdited = false;
      resize();
    },
    resetCamera() {
      cameraEdited = false;
      resize();
    },
    setWeather(state) {
      from = current;
      target = state;
      transitionStart = performance.now();
      transitioning = !motion.matches;
      if (motion.matches) current = target;
      wake();
    },
    setPaused(value) {
      paused = value;
      if (paused) {
        parallax.set(0, 0);
        parallaxTarget.set(0, 0);
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        lastFrame = performance.now();
        wake();
      }
    },
    setMotionPaused(value) {
      motionPaused = value;
      if (value) parallaxTarget.set(0, 0);
      wake();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      cameraControls.dispose();
      motion.removeEventListener('change', handleMotion);
      canvas.removeEventListener('webglcontextlost', handleLost);
      canvas.removeEventListener('webglcontextrestored', handleRestored);
      for (const geometry of geometries) geometry.dispose();
      for (const mat of materials) mat.dispose();
      for (const texture of textures) texture.dispose();
      sunLight.shadow.dispose();
      snowSurfaces?.dispose();
      disposeVillageDetails();
      referenceEnvironment.dispose();
      streetLayout.dispose();
      streetFurniture.dispose();
      referenceCharacter.dispose();
      depthOfField.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
