import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname } from 'node:path';
import { WebSocket, WebSocketServer } from 'ws';
import { BOUNDS, GUIDE, SENTINEL, SPAWN, distance } from '../shared/world.js';

const savesDir = new URL('../.local/', import.meta.url);
const saveFile = new URL('profiles.json', savesDir);
await mkdir(savesDir, { recursive: true });
const profiles = new Map(
  Object.entries(JSON.parse(await readFile(saveFile, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '{}';
    throw error;
  }))),
);

let writes = Promise.resolve();
function saveProfiles() {
  const data = JSON.stringify(Object.fromEntries(profiles));
  const temporary = new URL('profiles.tmp', savesDir);
  writes = writes.then(async () => {
    await writeFile(temporary, data);
    await rename(temporary, saveFile);
  }).catch(error => console.error('Could not save profiles:', error.message));
}

const indexFile = new URL('../dist/index.html', import.meta.url);
const dist = new URL('../dist/', import.meta.url);
const mime = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
const server = createServer(async (request, response) => {
  const path = request.url.split('?')[0];
  const file = path === '/' ? indexFile : /^\/assets\/[\w.-]+$/.test(path) ? new URL(path.slice(1), dist) : null;
  if (!file || request.method !== 'GET') {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'Content-Type': mime[extname(file.pathname)] ?? 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
    }).end(body);
  } catch (error) {
    response.writeHead(error.code === 'ENOENT' ? 404 : 500).end('Run npm run build to serve the client here, or use Vite for development.');
  }
});

const world = new WebSocketServer({ noServer: true, maxPayload: 2048 });
const clients = new Map();
const sentinel = { hp: SENTINEL.maxHp, respawnAt: 0 };
const send = (socket, message) => {
  if (socket.readyState === WebSocket.OPEN && socket.bufferedAmount < 65536) {
    socket.send(JSON.stringify(message));
  }
};
const broadcast = message => {
  for (const socket of clients.keys()) send(socket, message);
};
const note = (socket, text) => send(socket, { type: 'note', text });

server.on('upgrade', (request, socket, head) => {
  const origin = request.headers.origin;
  const allowed = process.env.WORLD_ORIGIN
    ? origin === process.env.WORLD_ORIGIN
    : /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin ?? '');
  if (request.url !== '/world' || !allowed || world.clients.size >= 24) {
    socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
    return;
  }
  world.handleUpgrade(request, socket, head, client => world.emit('connection', client));
});

world.on('connection', socket => {
  const joinTimer = setTimeout(() => socket.close(1008, 'Join timed out'), 10000);
  let frameCount = 0;
  let frameWindow = Date.now();
  socket.on('error', () => socket.terminate());
  socket.on('message', raw => {
    const now = Date.now();
    if (now - frameWindow >= 1000) {
      frameCount = 0;
      frameWindow = now;
    }
    if (++frameCount > 60) {
      socket.close(1008, 'Too many messages');
      return;
    }
    let message;
    try { message = JSON.parse(raw.toString()); } catch { return; }
    if (!message || typeof message !== 'object') return;

    const player = clients.get(socket);
    if (!player) {
      if (message.type !== 'join') return;
      clearTimeout(joinTimer);
      const requested = typeof message.token === 'string' ? message.token : '';
      const token = profiles.has(requested) ? requested : randomUUID();
      if ([...clients.values()].some(entry => entry.token === token)) {
        socket.close(1008, 'This explorer is already in the world');
        return;
      }
      const name = typeof message.name === 'string'
        ? message.name.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 24)
        : '';
      const profile = profiles.get(token) ?? { name: name || 'Explorer', ...SPAWN, marks: 0 };
      profiles.set(token, profile);
      const id = randomUUID();
      clients.set(socket, { id, token, profile, dx: 0, dz: 0, inputAt: now, actionAt: 0, chatAt: 0 });
      send(socket, { type: 'joined', id, token });
      note(socket, 'Find the keeper by the blue beacon.');
      saveProfiles();
      return;
    }

    if (message.type === 'move' && Number.isFinite(message.dx) && Number.isFinite(message.dz)) {
      const magnitude = Math.max(1, Math.hypot(message.dx, message.dz));
      player.dx = message.dx / magnitude;
      player.dz = message.dz / magnitude;
      player.inputAt = now;
    }

    if (message.type === 'chat' && typeof message.text === 'string' && now - player.chatAt >= 700) {
      const text = message.text.trim().slice(0, 160);
      if (!text) return;
      player.chatAt = now;
      broadcast({ type: 'chat', author: player.profile.name, text });
    }

    if (message.type === 'interact' && now - player.actionAt >= 400) {
      player.actionAt = now;
      const near = distance(player.profile, GUIDE) <= 3;
      note(socket, near ? 'Keeper: The amber sentinel stands east of the beacon. Approach it and strike three times to earn a mark.' : 'Move closer to the keeper.');
    }

    if (message.type === 'attack' && now - player.actionAt >= 500) {
      player.actionAt = now;
      if (distance(player.profile, SENTINEL) > 3 || sentinel.hp === 0) {
        note(socket, 'Move within reach of an active sentinel.');
        return;
      }
      sentinel.hp -= 2;
      if (sentinel.hp === 0) {
        sentinel.respawnAt = now + 8000;
        player.profile.marks++;
        note(socket, 'Sentinel defeated. You earned a mark.');
        saveProfiles();
      }
    }
  });
  socket.on('close', () => {
    clearTimeout(joinTimer);
    if (clients.delete(socket)) saveProfiles();
  });
});

let previous = performance.now();
setInterval(() => {
  const current = performance.now();
  const dt = Math.min((current - previous) / 1000, 0.1);
  previous = current;
  const now = Date.now();
  if (!sentinel.hp && now >= sentinel.respawnAt) sentinel.hp = SENTINEL.maxHp;
  const players = [];
  for (const { id, profile, inputAt, dx, dz } of clients.values()) {
    if (now - inputAt < 400) {
      profile.x = Math.max(-BOUNDS, Math.min(BOUNDS, profile.x + dx * dt * 5));
      profile.z = Math.max(-BOUNDS, Math.min(BOUNDS, profile.z + dz * dt * 5));
    }
    players.push({ id, ...profile });
  }
  if (players.length) broadcast({ type: 'world', players, sentinelHp: sentinel.hp });
}, 50).unref();

setInterval(() => {
  if (clients.size) saveProfiles();
}, 5000).unref();

server.listen(Number(process.env.PORT ?? 8080), process.env.WORLD_HOST ?? '127.0.0.1', () => {
  console.log('World listening at', server.address());
});
