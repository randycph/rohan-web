# Beacon Vale

Beacon Vale is an original WebGL multiplayer prototype. The browser renders the world with Three.js, while a Node.js WebSocket server tracks players, movement, chat, and progress.

## Run locally

Install Node.js 22.12 or newer and open a terminal in the project folder.

```sh
npm ci
npm run build
npm start
```

Open http://127.0.0.1:8080 in a WebGL 2 browser. To use Safari on your Mac, run these commands on macOS and open the same address there. To develop with live reload, keep the Node server running and run `npm run dev` in a second terminal, then open the Vite URL.

Open two tabs and use a different explorer name in each. Move with WASD, arrow keys, or the on-screen arrows. Use **E** near the blue keeper or **Space** near the amber sentinel. Three strikes defeat the sentinel and earn a mark. Chat appears in both tabs.

Explorer progress is saved in `.local/profiles.json`. Rejoin with the same name from the same browser and address to resume. The demo uses a random resume token stored in the browser.

## Existing Rohan installation

This project has its own test world and game server. The Windows installation includes PHP login and server-list endpoints, but the supplied files did not provide a documented gameplay protocol or game client source. World entry and synchronization with that server would require an authorized, documented server interface.

The default listener is local to the machine running Node. For deployment, serve through HTTPS with WebSocket forwarding on `/world`, set `WORLD_ORIGIN` to the exact public HTTPS origin, and keep the Node listener behind the proxy. The demo uses guest profiles and local disk saves.

## Single-player map viewer

Open http://127.0.0.1:8080/solo.html. Choose one map and one character as self-contained glTF binary (.glb) exports with embedded textures. Export with Y up and without optional Draco, Meshopt, or KTX2 compression. Click **Load scene**, click the floor to spawn, and use WASD or the arrow keys to move. If the character has named idle and walk or run animations, the viewer plays them automatically. Movement follows the visible geometry with a simple ground check.

The viewer reads the two files in the browser. It uses no game server connection and does not upload the files. The Rohan package contains compound formats such as .raw, .map, .eti, .gtx, and .gbf. This viewer accepts exported GLB files and does not decode those formats.
