import * as THREE from 'three';
import type { WeatherSceneRenderer, WeatherSceneState } from '../types/weatherScene.js';
import { clamp, interpolateScene } from '../utils/weatherScene.js';
import { addVillageDetails } from './villageDetails.js';
import { addReferenceEnvironment } from './referenceEnvironment.js';
import { createReferenceCharacter } from './referenceCharacter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { BokehPass } from 'three/addons/postprocessing/BokehPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Weather changes one persistent village and traveller.
export function createWeatherScene(
  host: HTMLElement,
  initial: WeatherSceneState,
  onUnavailable: (message: string) => void,
  onCameraChange?: (settings: ReturnType<WeatherSceneRenderer['getCamera']>) => void
): WeatherSceneRenderer {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    alpha: true,
    powerPreference: 'low-power',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  const canvas = renderer.domElement;
  canvas.setAttribute('aria-hidden', 'true');
  host.append(canvas);
  const scene = new THREE.Scene();
  const disposeVillageDetails = addVillageDetails(scene);
  const referenceEnvironment = addReferenceEnvironment(scene);
  const referenceCharacter = createReferenceCharacter(scene);
  // Retain the character study for later; this demo currently shows only the environment.
  const showCharacter = false;
  referenceCharacter.setVisible(showCharacter);
  let generatedCharacter: THREE.Group | undefined;
  let characterMixer: THREE.AnimationMixer | undefined;
  if (showCharacter && new URLSearchParams(location.search).get('character') !== 'procedural') {
    new GLTFLoader().load(new URL('./assets/traveller-walking.glb', import.meta.url).href, gltf => {
      if (disposed) return;
      generatedCharacter = gltf.scene;
      const bounds = new THREE.Box3().setFromObject(generatedCharacter);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const scale = 3.9 / size.y;
      generatedCharacter.scale.setScalar(scale);
      generatedCharacter.position.set(
        0.1 - center.x * scale,
        0.13 - bounds.min.y * scale,
        2.1 - center.z * scale
      );
      generatedCharacter.rotation.y = 0.3;
      generatedCharacter.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.castShadow = true;
          object.receiveShadow = true;
        }
      });
      scene.add(generatedCharacter);
      characterMixer = new THREE.AnimationMixer(generatedCharacter);
      if (gltf.animations[0]) characterMixer.clipAction(gltf.animations[0]).play();
      characterMixer.setTime(0.35);
      referenceCharacter.setVisible(false);
      wake();
    });
  }
  scene.fog = new THREE.Fog('#c7def0', 18, 42);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 180);
  camera.position.set(-1.597796, 0.666399, 9.001909);
  camera.lookAt(0, 2.45, -3);
  const cameraControls = new OrbitControls(camera, canvas);
  cameraControls.target.set(0, 2.45, -3);
  cameraControls.minDistance = 1;
  cameraControls.maxDistance = 60;
  cameraControls.update();
  let cameraEdited = false;
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
    aperture: 0.00045,
    maxblur: 0.012,
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
  sunLight.shadow.mapSize.set(1024, 1024);
  Object.assign(sunLight.shadow.camera, {
    left: -8,
    right: 8,
    top: 8,
    bottom: -8,
    near: 0.1,
    far: 35,
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
  const skyMaterial = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      top: { value: new THREE.Color('#2478db') },
      horizon: { value: new THREE.Color('#f4d7a5') },
    },
    vertexShader:
      'varying vec3 skyPosition; void main(){skyPosition=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}',
    fragmentShader:
      'uniform vec3 top; uniform vec3 horizon; varying vec3 skyPosition; void main(){float h=clamp(normalize(skyPosition).y*4.0+0.3,0.0,1.0); gl_FragColor=vec4(mix(horizon,top,pow(h,0.65)),1.0);}',
  });
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
  const ball = (
    p: THREE.Object3D,
    color: string,
    x: number,
    y: number,
    z: number,
    sx: number,
    sy = sx,
    sz = sx
  ) => mesh(p, sphereGeometry, material(color), x, y, z, sx, sy, sz);
  function group(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
    const object = new THREE.Group();
    object.position.set(x, y, z);
    parent.add(object);
    return object;
  }
  const snowMaterial = material('#f3f9ff', true);
  const snowCaps: THREE.Mesh[] = [];
  function snowCap(x: number, y: number, z: number, sx: number, sz: number): void {
    const cap = mesh(scene, sphereGeometry, snowMaterial, x, y, z, sx, 0.14, sz);
    cap.castShadow = false;
    snowCaps.push(cap);
  }
  const grassMaterial = material('#99ad7b');
  mesh(scene, boxGeometry, grassMaterial, 0, -0.24, -2, 30, 0.4, 28);
  const pathMaterial = material('#d9c3a0');
  mesh(scene, boxGeometry, pathMaterial, -0.4, -0.015, -1, 4.8, 0.1, 19);
  for (let z = -8; z <= 6; z += 0.75) {
    for (let x = -2.6; x < 1.8; x += 1.08) {
      box(
        scene,
        (Math.round(z * 4) + Math.round(x * 3)) % 3 === 0 ? '#c9b18e' : '#dfcbaa',
        x + (Math.round(z * 4) % 2) * 0.25,
        0.045,
        z,
        1.02,
        0.055,
        0.69
      );
    }
  }
  snowCap(-0.4, 0.12, 0, 2.4, 7);
  snowCap(-4.8, 0.05, 0, 2.8, 6);
  snowCap(3, 0.05, 0, 2.4, 6);
  const water = material('#65aabd');
  water.roughness = 0.25;
  water.metalness = 0.2;
  mesh(scene, boxGeometry, water, 15, -0.02, -19, 7, 0.09, 17);

  const windowMaterial = material('#f6d9a2');
  windowMaterial.emissive.set('#ffbc62');
  function house(x: number, z: number, color: string, width: number, height: number): void {
    const houseGroup = group(scene, x, 0, z);
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
    const roofSnow = mesh(
      houseGroup,
      coneGeometry,
      snowMaterial,
      0,
      height + 0.69,
      0,
      width * 0.87,
      1.52,
      2.17
    );
    roofSnow.rotation.y = Math.PI / 4;
    roofSnow.castShadow = false;
  }
  house(-5, -1.2, '#dca184', 3.4, 4);
  house(-5.5, 3.8, '#bb916f', 3.2, 6);
  house(-5.2, -5.3, '#e5c68e', 2.8, 3.6);
  box(scene, '#a99d8b', 5.8, -0.035, -15, 3.8, 0.07, 42);
  // Cafe awning and flower boxes give the fixed background a familiar identity.
  for (let i = 0; i < 7; i++) {
    const awning = box(
      scene,
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
    box(scene, '#926950', -6 + i * 2.1, 0.42, 0.7, 0.95, 0.5, 0.7);
    for (let j = 0; j < 5; j++) {
      const bloom = mesh(
        scene,
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
  // The bench recedes at three quarters, leaving the street's vanishing point open.
  const bench = group(scene, 3.1, 0, 0.8);
  bench.rotation.y = 0.55;
  for (let i = 0; i < 4; i++) {
    box(bench, '#a77850', 0, 0.67, -0.2 + i * 0.19, 2.2, 0.1, 0.14);
    box(bench, '#b8885a', 0, 1.05 + i * 0.14, 0.3, 2.2, 0.1, 0.12);
  }
  for (const x of [-0.85, 0.85]) {
    box(bench, '#4d5b58', x, 0.35, 0.1, 0.13, 0.7, 0.72);
    box(bench, '#4d5b58', x, 0.97, -0.1, 0.12, 0.1, 0.8);
  }
  snowCap(3.1, 0.82, 0.9, 1.25, 0.5);
  for (let z = -9; z <= 4; z += 2.3) {
    box(scene, '#ac8b62', 4.95, 0.7, z, 0.19, 1.4, 0.19);
    box(scene, '#bba07b', 4.95, 0.85, z + 0.95, 0.12, 0.15, 2.2);
  }
  const lampMaterial = material('#ffde99');
  lampMaterial.emissive.set('#ffc567');
  for (const [x, z, scale] of [
    [1.6, -0.4, 1.3],
    [-2.7, -6.3, 1],
  ]) {
    const lamp = group(scene, x, 0, z);
    lamp.scale.setScalar(scale);
    mesh(lamp, cylinderGeometry, material('#445452'), 0, 1.65, 0, 0.065, 3.3, 0.065);
    mesh(lamp, cylinderGeometry, material('#445452'), 0, 0.18, 0, 0.19, 0.36, 0.19);
    mesh(lamp, boxGeometry, lampMaterial, 0, 3.28, 0, 0.35, 0.53, 0.35);
    const lid = mesh(lamp, coneGeometry, material('#445452'), 0, 3.66, 0, 0.4, 0.3, 0.4);
    lid.rotation.y = Math.PI / 4;
    ball(lamp, '#445452', 0, 3.84, 0, 0.065);
    const glow = new THREE.PointLight('#ffc472', 1.6, 6, 2);
    glow.position.set(0, 3.2, 0);
    lamp.add(glow);
    snowCap(x, 3.79 * scale, z, 0.36 * scale, 0.36 * scale);
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

  const cloudMaterials: THREE.MeshStandardMaterial[] = [];
  const clouds: THREE.Group[] = [];
  for (let i = 0; i < 7; i++) {
    const cloudMaterial = material('#fff9ef', true);
    cloudMaterials.push(cloudMaterial);
    const cloud = group(scene, -9 + i * 3, 6 + (i % 2) * 1.1, -8 - (i % 3));
    clouds.push(cloud);
    for (let j = 0; j < 4; j++) {
      const puff = mesh(
        cloud,
        facetGeometry,
        cloudMaterial,
        j * 0.54,
        Math.sin(j * 2) * 0.22,
        0,
        0.7,
        0.43 + (j % 2) * 0.2,
        0.55
      );
      puff.castShadow = false;
    }
  }
  const sunMaterial = new THREE.MeshBasicMaterial({ color: '#ffe5a0', transparent: true });
  materials.add(sunMaterial);
  const moonMaterial = new THREE.MeshBasicMaterial({ color: '#f0edcf', transparent: true });
  materials.add(moonMaterial);
  const sun = mesh(scene, sphereGeometry, sunMaterial, 8, 8.3, -10, 0.66, 0.66, 0.66);
  const moon = mesh(scene, sphereGeometry, moonMaterial, 5, 6, -10, 0.48, 0.48, 0.48);
  sun.castShadow = moon.castShadow = false;

  // Bounded particle pools: positions change, geometry never gets recreated.
  const count = 480;
  const rainPositions = new Float32Array(count * 6);
  const snowPositions = new Float32Array(count * 3);
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
    size: 0.065,
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
  const daySky = new THREE.Color('#2478db');
  const overcastSky = new THREE.Color('#9babb5');
  const nightSky = new THREE.Color('#172b4e');
  const dayHorizon = new THREE.Color('#f0dec0');
  const nightHorizon = new THREE.Color('#536579');
  const grassColor = new THREE.Color('#98ad78');
  const frozenGrass = new THREE.Color('#bac2b6');
  const summerLeaves = new THREE.Color('#a7b866');
  const autumnLeaves = new THREE.Color('#d69e56');
  const snowyLeaves = new THREE.Color('#e5eee6');

  function fade(mat: THREE.Material, opacity: number): void {
    mat.opacity = clamp(opacity);
    mat.depthWrite = mat.opacity > 0.98;
  }
  function draw(time: number): void {
    const state = current;
    const wind = state.wind / 35;
    const breeze =
      wind * (0.65 + Math.sin(time * 1.7) * 0.2 + (state.gust / 100) * Math.sin(time * 3.1));
    skyColor
      .copy(daySky)
      .lerp(overcastSky, state.cloud * 0.8)
      .lerp(nightSky, 1 - state.daylight);
    horizonColor
      .copy(dayHorizon)
      .lerp(overcastSky, state.cloud * 0.7)
      .lerp(nightHorizon, 1 - state.daylight);
    host.style.background = `linear-gradient(${skyColor.getStyle()}, ${horizonColor.getStyle()})`;
    skyMaterial.uniforms.top.value.copy(skyColor);
    skyMaterial.uniforms.horizon.value.copy(horizonColor);
    (scene.fog as THREE.Fog).color.copy(skyColor);
    (scene.fog as THREE.Fog).near = 26 - state.fog * 20;
    (scene.fog as THREE.Fog).far = 130 - state.fog * 113;
    hemisphere.intensity = 0.55 + state.daylight * 0.85;
    sunLight.intensity = 0.25 + state.daylight * (3 - state.cloud * 2.7);
    sunLight.position.x = -8 + state.hour * 0.3;
    sunLight.color.set(state.daylight > 0.2 ? '#ffe4b7' : '#b3c9ef');
    fill.intensity = 0.25 + state.daylight * 0.15;
    windowMaterial.emissiveIntensity = lampMaterial.emissiveIntensity =
      0.15 + (1 - state.daylight) * 1.8 + state.cloud * 0.15;
    for (let i = 0; i < cloudMaterials.length; i++) {
      cloudMaterials[i].color
        .set('#fff9ef')
        .lerp(overcastSky, state.cloud * 0.65 + state.rain * 0.2);
      fade(cloudMaterials[i], clamp(state.cloud * 8 - i));
    }
    fade(sunMaterial, state.daylight * (1 - clamp((state.cloud - 0.3) / 0.6)));
    fade(moonMaterial, (1 - state.daylight) * (1 - state.cloud * 0.8));
    fade(starMaterial, (1 - state.daylight) * (1 - state.cloud));
    grassMaterial.color.copy(grassColor).lerp(frozenGrass, state.snowCover);
    const warm = clamp((state.temperature - 45) / 35);
    for (const mat of foliage) {
      mat.color.copy(autumnLeaves).lerp(summerLeaves, warm).lerp(snowyLeaves, state.snowCover);
      fade(mat, 1);
    }
    for (const tree of trees) tree.rotation.z = -breeze * 0.025 * state.windX;
    for (let i = 0; i < clouds.length; i++)
      clouds[i].position.x = -9 + i * 3 + Math.sin(time * 0.025 + i) * (0.2 + wind);
    fade(snowMaterial, clamp(state.snowCover * 2));
    for (const cap of snowCaps) cap.scale.y = 0.025 + state.snowCover * 0.25;
    fade(puddleMaterial, state.rain * 0.6);
    referenceEnvironment.update(state.temperature, state.snowCover, state.daylight);
    referenceCharacter.update(state, time);
    characterMixer?.setTime(0.35 + time * 0.7);
    const rainCount = Math.round(count * state.rain);
    const snowCount = Math.round(count * state.snow);
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
        const y = (((seed(i, 1) * 8 - time * (0.6 + seed(i, 3) * 0.4)) % 8) + 8) % 8;
        snowPositions.set(
          [
            x + Math.sin(time + i) * 0.15 + state.windX * wind * (8 - y) * 0.6,
            y,
            z + state.windZ * wind * (8 - y) * 0.2,
          ],
          i * 3
        );
      }
    }
    rainGeometry.attributes.position.needsUpdate =
      snowGeometry.attributes.position.needsUpdate = true;
    const leafCount = Math.round(clamp((state.wind - 3) / 30) * 30 * (1 - state.snowCover));
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
      camera.fov = aspect < 1.3 ? 48 : 38;
      camera.position.set(-1.597796, 0.666399, 9.001909);
      cameraControls.target.set(0, 2.45, -3);
      cameraControls.update();
    }
    camera.updateProjectionMatrix();
    onCameraChange?.(getCamera());
    renderer.setSize(width, height, false);
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
    getCamera,
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
        cancelAnimationFrame(frame);
        frame = 0;
      } else {
        lastFrame = performance.now();
        wake();
      }
    },
    setMotionPaused(value) {
      motionPaused = value;
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
      disposeVillageDetails();
      referenceEnvironment.dispose();
      referenceCharacter.dispose();
      generatedCharacter?.traverse(object => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const mats = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of mats) {
            for (const value of Object.values(material))
              if (value instanceof THREE.Texture) value.dispose();
            material.dispose();
          }
        }
      });
      depthOfField.dispose();
      outputPass.dispose();
      composer.dispose();
      renderer.dispose();
      canvas.remove();
    },
  };
}
