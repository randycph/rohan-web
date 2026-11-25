import * as THREE from 'three';
import { BOUNDS, GUIDE, SENTINEL, SPAWN } from '../shared/world.js';
import './style.css';

const element = selector => document.querySelector(selector);
const viewport = element('#viewport');
const status = element('#status');
const join = element('#join');
const hints = element('#hint');

function start() {
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  viewport.append(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#9cc2bb');
  scene.fog = new THREE.Fog('#9cc2bb', 22, 67);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
  scene.add(new THREE.HemisphereLight(0xfff3ce, 0x365557, 2.1));
  const sunlight = new THREE.DirectionalLight(0xffe4ae, 2);
  sunlight.position.set(-10, 20, 8);
  scene.add(sunlight);

  function mesh(geometry, color, x, y, z) {
    const object = new THREE.Mesh(geometry, new THREE.MeshStandardMaterial({ color, roughness: 0.9 }));
    object.position.set(x, y, z);
    scene.add(object);
    return object;
  }
  mesh(new THREE.BoxGeometry(2 * BOUNDS + 1, 0.5, 2 * BOUNDS + 1), '#587b55', 0, -0.25, 0);
  mesh(new THREE.BoxGeometry(3, 0.03, 29), '#b6a789', 0, 0.01, -2);
  mesh(new THREE.BoxGeometry(15, 0.04, 2.5), '#b6a789', 0, 0.02, -4);
  for (let i = 0; i < 38; i++) {
    const angle = i * 2.39996;
    const radius = 12 + (i % 8) * 1.35;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius;
    const height = 1.7 + (i % 4) * 0.4;
    mesh(new THREE.CylinderGeometry(0.16, 0.29, height, 6), '#70513a', x, height / 2, z);
    mesh(new THREE.ConeGeometry(0.9, 2.4, 6), i % 2 ? '#294f43' : '#356350', x, height + 0.45, z);
  }
  for (const [location, color] of [[GUIDE, '#80e9ff'], [SENTINEL, '#f2ab55']]) {
    mesh(new THREE.CylinderGeometry(1.1, 1.35, 0.26, 8), '#4d605e', location.x, 0.13, location.z);
    mesh(new THREE.TorusGeometry(0.95, 0.06, 8, 24), color, location.x, 0.29, location.z).rotation.x = -Math.PI / 2;
  }
  mesh(new THREE.CapsuleGeometry(0.35, 0.9, 4, 8), '#80e9ff', GUIDE.x, 1, GUIDE.z);
  const sentinel = mesh(new THREE.OctahedronGeometry(0.9), '#f2ab55', SENTINEL.x, 1.25, SENTINEL.z);
  const avatarGeometry = new THREE.CapsuleGeometry(0.36, 0.75, 4, 8);
  const localMaterial = new THREE.MeshStandardMaterial({ color: '#edf7de' });
  const remoteMaterial = new THREE.MeshStandardMaterial({ color: '#b49af3' });
  const avatars = new Map();
  const focus = new THREE.Vector3(SPAWN.x, 0, SPAWN.z);
  let socket;
  let myId;
  const keys = new Set();
  const pointers = new Map();

  function send(message) {
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }

  function log(line) {
    const messages = element('#messages');
    const entry = document.createElement('p');
    entry.textContent = line;
    messages.append(entry);
    while (messages.childElementCount > 50) messages.firstChild.remove();
    messages.scrollTop = messages.scrollHeight;
  }

  function showWorld(packet) {
    const active = new Set();
    for (const player of packet.players) {
      active.add(player.id);
      let avatar = avatars.get(player.id);
      if (!avatar) {
        const object = new THREE.Mesh(avatarGeometry, player.id === myId ? localMaterial : remoteMaterial);
        object.position.set(player.x, 0.76, player.z);
        scene.add(object);
        avatar = { object, target: object.position.clone() };
        avatars.set(player.id, avatar);
      }
      avatar.target.set(player.x, 0.76, player.z);
      if (player.id === myId) {
        element('#stats').textContent = player.name + ' · Marks ' + player.marks +
          ' · Explorers ' + packet.players.length + ' · Sentinel ' + packet.sentinelHp + '/' + SENTINEL.maxHp;
      }
    }
    for (const [id, avatar] of avatars) {
      if (!active.has(id)) {
        avatar.object.removeFromParent();
        avatars.delete(id);
      }
    }
    sentinel.visible = packet.sentinelHp > 0;
  }

  join.addEventListener('submit', event => {
    event.preventDefault();
    const name = element('#name').value.trim();
    if (!name) return;
    const profileKey = 'beacon-vale:' + name.toLowerCase();
    const button = join.querySelector('button');
    button.disabled = true;
    status.textContent = 'Connecting…';
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    socket = new WebSocket(protocol + '//' + location.host + '/world');
    socket.addEventListener('open', () => send({ type: 'join', name, token: localStorage.getItem(profileKey) }));
    socket.addEventListener('message', event => {
      const packet = JSON.parse(event.data);
      if (packet.type === 'joined') {
        myId = packet.id;
        localStorage.setItem(profileKey, packet.token);
        join.hidden = true;
        status.textContent = 'In the vale';
        for (const selector of ['#hud', '#controls', '#chat']) element(selector).hidden = false;
      }
      if (packet.type === 'world') showWorld(packet);
      if (packet.type === 'note') {
        hints.textContent = packet.text;
        log(packet.text);
      }
      if (packet.type === 'chat') log(packet.author + ': ' + packet.text);
    });
    socket.addEventListener('close', event => {
      myId = undefined;
      keys.clear();
      pointers.clear();
      for (const avatar of avatars.values()) avatar.object.removeFromParent();
      avatars.clear();
      status.textContent = event.reason || 'Disconnected. Rejoin to continue.';
      join.hidden = false;
      button.disabled = false;
      for (const selector of ['#hud', '#controls', '#chat']) element(selector).hidden = true;
    });
  });

  const movement = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight']);
  window.addEventListener('keydown', event => {
    if (!myId || event.target.closest?.('input, textarea, button, [contenteditable]')) return;
    if (movement.has(event.code)) {
      event.preventDefault();
      keys.add(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
    if (!event.repeat && event.code === 'Space') send({ type: 'attack' });
    if (!event.repeat && event.code === 'KeyE') send({ type: 'interact' });
  });
  window.addEventListener('keyup', event => keys.delete(event.code));
  window.addEventListener('blur', () => { keys.clear(); pointers.clear(); });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { keys.clear(); pointers.clear(); }
  });
  for (const button of document.querySelectorAll('[data-key]')) {
    button.addEventListener('pointerdown', event => {
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      pointers.set(event.pointerId, button.dataset.key);
    });
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) {
      button.addEventListener(type, event => pointers.delete(event.pointerId));
    }
  }

  function pressed(...codes) {
    return codes.some(code => keys.has(code) || [...pointers.values()].includes(code));
  }

  setInterval(() => {
    if (!myId) return;
    send({
      type: 'move',
      dx: Number(pressed('KeyD', 'ArrowRight')) - Number(pressed('KeyA', 'ArrowLeft')),
      dz: Number(pressed('KeyS', 'ArrowDown')) - Number(pressed('KeyW', 'ArrowUp')),
    });
  }, 50);
  element('#interact').addEventListener('click', () => send({ type: 'interact' }));
  element('#attack').addEventListener('click', () => send({ type: 'attack' }));
  element('#chat-form').addEventListener('submit', event => {
    event.preventDefault();
    const input = element('#chat-text');
    send({ type: 'chat', text: input.value });
    input.value = '';
    input.blur();
  });

  new ResizeObserver(() => {
    const { clientWidth: width, clientHeight: height } = viewport;
    if (!width || !height) return;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }).observe(viewport);
  renderer.setAnimationLoop(() => {
    for (const avatar of avatars.values()) avatar.object.position.lerp(avatar.target, 0.25);
    const local = avatars.get(myId);
    if (local) {
      focus.x += (local.object.position.x - focus.x) * 0.12;
      focus.z += (local.object.position.z - focus.z) * 0.12;
    }
    camera.position.set(focus.x, 13, focus.z + 12);
    camera.lookAt(focus.x, 0, focus.z - 2);
    sentinel.rotation.y += 0.017;
    renderer.render(scene, camera);
  });
}

try {
  start();
} catch (error) {
  join.hidden = true;
  status.textContent = 'Could not start the 3D world. Check that WebGL 2 is enabled.';
  console.error(error);
}
