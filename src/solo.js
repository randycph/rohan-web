import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import './style.css';

const viewport = document.querySelector('#viewport');
const status = document.querySelector('#status');
const form = document.querySelector('#assets');
const place = document.querySelector('#place');

function run() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  viewport.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9cc2bb');
  const camera = new THREE.PerspectiveCamera(48, 1, 0.05, 200);
  const sun = new THREE.DirectionalLight(0xffedd5, 2);
  sun.position.set(5, 20, 8);
  scene.add(sun, new THREE.HemisphereLight(0xe9f7ff, 0x535942, 2));

  const manager = new THREE.LoadingManager();
  manager.setURLModifier(url => {
    if (/^(blob:|data:)/i.test(url)) return url;
    throw new Error('Export a self-contained GLB with embedded textures.');
  });
  const loader = new GLTFLoader(manager);
  const keys = new Set();
  const movementKeys = /^(Key[WASD]|Arrow(Up|Down|Left|Right))$/;
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const focus = new THREE.Vector3();
  let map;
  let avatar;
  let mixer;
  let idle;
  let walk;
  let choosingSpawn = true;

  function dispose(root) {
    if (!root) return;
    root.removeFromParent();
    const resources = new Set();
    root.traverse(object => {
      if (object.geometry) resources.add(object.geometry);
      if (object.skeleton) resources.add(object.skeleton);
      for (const material of [object.material].flat().filter(Boolean)) {
        resources.add(material);
        for (const value of Object.values(material)) {
          if (value?.isTexture) resources.add(value);
        }
      }
    });
    const bitmaps = new Set();
    for (const resource of resources) {
      if (resource.isTexture && resource.image?.close) bitmaps.add(resource.image);
      resource.dispose();
    }
    for (const bitmap of bitmaps) bitmap.close();
  }

  async function load(file) {
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength < 12 || new DataView(bytes).getUint32(0, true) !== 0x46546c67) {
      throw new Error('Select two binary glTF (.glb) files.');
    }
    return loader.parseAsync(bytes, '');
  }

  function normalize(root, size, useHeight) {
    const bounds = new THREE.Box3().setFromObject(root);
    const dimensions = bounds.getSize(new THREE.Vector3());
    const extent = useHeight ? dimensions.y : Math.max(dimensions.x, dimensions.y, dimensions.z);
    if (!Number.isFinite(extent) || extent <= 0) throw new Error('The file has no usable 3D geometry.');
    const scale = size / extent;
    const anchor = bounds.getCenter(new THREE.Vector3());
    anchor.y = bounds.min.y;
    const group = new THREE.Group();
    group.add(root);
    group.scale.setScalar(scale);
    root.position.sub(anchor);
    return group;
  }

  function chooseSpawn() {
    choosingSpawn = true;
    keys.clear();
    avatar.visible = false;
    focus.set(0, 0, 0);
    status.textContent = 'Click a walkable surface to place the character.';
  }

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button');
    button.disabled = true;
    status.textContent = 'Loading map and character…';
    let mapAsset;
    let characterAsset;
    try {
      mapAsset = await load(form.elements.map.files[0]);
      characterAsset = await load(form.elements.character.files[0]);
      const nextMap = normalize(mapAsset.scene, 44, false);
      const nextAvatar = new THREE.Group();
      nextAvatar.add(normalize(characterAsset.scene, 1.7, true));
      mixer?.stopAllAction();
      dispose(map);
      dispose(avatar);
      map = nextMap;
      avatar = nextAvatar;
      scene.add(map, avatar);
      map.updateMatrixWorld(true);
      mixer = new THREE.AnimationMixer(characterAsset.scene);
      const clips = characterAsset.animations;
      idle = clips.find(clip => /idle|stand/i.test(clip.name));
      walk = clips.find(clip => /walk|run/i.test(clip.name));
      idle = idle ? mixer.clipAction(idle) : null;
      walk = walk ? mixer.clipAction(walk) : null;
      place.hidden = false;
      chooseSpawn();
    } catch (error) {
      dispose(mapAsset?.scene);
      dispose(characterAsset?.scene);
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  place.addEventListener('click', chooseSpawn);
  renderer.domElement.addEventListener('pointerdown', event => {
    if (!map || !choosingSpawn) return;
    const rect = renderer.domElement.getBoundingClientRect();
    const pointer = new THREE.Vector2(2 * (event.clientX - rect.left) / rect.width - 1,
      1 - 2 * (event.clientY - rect.top) / rect.height);
    ray.setFromCamera(pointer, camera);
    const hit = ray.intersectObject(map, true)[0];
    if (!hit) return;
    avatar.position.copy(hit.point);
    avatar.visible = true;
    choosingSpawn = false;
    idle?.play();
    status.textContent = 'Use WASD or arrow keys to walk.';
  });

  window.addEventListener('keydown', event => {
    if (choosingSpawn || !movementKeys.test(event.code) || event.target.closest?.('button, input')) return;
    event.preventDefault();
    keys.add(event.code);
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => keys.clear());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) keys.clear();
  });

  new ResizeObserver(() => {
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }).observe(viewport);

  const origin = new THREE.Vector3();
  let last = performance.now();
  renderer.setAnimationLoop(now => {
    const dt = Math.max(0, Math.min((now - last) / 1000, 0.05));
    last = now;
    let moving = false;
    if (avatar && !choosingSpawn) {
      const dx = Number(keys.has('KeyD') || keys.has('ArrowRight')) - Number(keys.has('KeyA') || keys.has('ArrowLeft'));
      const dz = Number(keys.has('KeyS') || keys.has('ArrowDown')) - Number(keys.has('KeyW') || keys.has('ArrowUp'));
      if (dx || dz) {
        const step = 4 * dt / Math.hypot(dx, dz);
        origin.copy(avatar.position).add(new THREE.Vector3(dx * step, 0.55, dz * step));
        ray.set(origin, down);
        const floor = ray.intersectObject(map, true).find(hit => hit.distance <= 1.35);
        if (floor) {
          avatar.position.copy(floor.point);
          avatar.rotation.y = Math.atan2(dx, dz);
          moving = true;
        }
      }
      if (walk) {
        if (moving && !walk.isRunning()) { idle?.stop(); walk.play(); }
        if (!moving && walk.isRunning()) { walk.stop(); idle?.play(); }
      }
      mixer.update(dt);
      focus.lerp(avatar.position, 1 - Math.exp(-7 * dt));
    }
    camera.position.copy(focus).add(choosingSpawn ? overviewOffset : followOffset);
    camera.lookAt(focus);
    renderer.render(scene, camera);
  });
}

const overviewOffset = new THREE.Vector3(0, 47, 24);
const followOffset = new THREE.Vector3(0, 7, 8);
try {
  run();
} catch (error) {
  form.querySelector('button').disabled = true;
  status.textContent = 'Could not start WebGL 2. ' + error.message;
}
