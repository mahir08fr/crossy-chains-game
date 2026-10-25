# Run Crossy Chains locally

[Back to the project](../README.md)

## Requirements

- Node.js **24.x** and its bundled npm. `.node-version` records the checked version, 24.21.0.
- A desktop browser supporting WebGL2. Phones use the controller page, not the 3D renderer.
- Git and a network connection for the initial dependency install.

Blender, private development files, paid services and a hosted backend are not required. The runtime GLBs and font are included.

## Install and launch

From the repository root:

```sh
npm ci
```

Terminal 1:

```sh
npm run dev:server
```

This builds shared packages and the server, then starts the backend at `http://127.0.0.1:2567`. Restart this command after server-code changes; it is not a server watch task.

Terminal 2:

```sh
VITE_SERVER_URL=http://127.0.0.1:2567 npm run dev -- --port 5173 --strictPort
```

In PowerShell, set `$env:VITE_SERVER_URL='http://127.0.0.1:2567'` before `npm run dev -- --port 5173 --strictPort`. The `scripts/npm-local.sh` compatibility wrapper simply calls npm on PATH; no bundled private Node installation is needed.

## Choose a mode

| URL | Use |
| --- | --- |
| `http://127.0.0.1:5173/local.html` | Two players sharing one keyboard; backend not required for this mode |
| `http://127.0.0.1:5173/` | Private online room with two to four desktop clients |
| `http://127.0.0.1:5173/display.html` | Shared 3D display with phone controllers |
| `http://127.0.0.1:5173/controller.html` | Touch controller for one room seat |
| `http://127.0.0.1:5173/playground.html` | Local chain and obstacle scenarios |

For shared keyboard, choose Ready on both cards, then Start. P1 uses WASD; P2 uses arrows. Advanced exposes course selection and a numeric seed. The regular game uses generated endless terrain; road, river and railway courses are useful focused reviews.

For desktop multiplayer, configure the team size before creating a room. Use Create / join room, create the room and share its invitation with other tabs or browsers. Each participant readies their seat; the host starts. Use separate tabs for independent session storage. Keep active clients visible: backgrounding a tab intentionally invokes safety pauses. Results require team restart votes.

## Phone controllers on a trusted LAN

Loopback addresses on a phone refer to the phone itself. Replace `192.168.1.10` below with the development computer's LAN address and stop the loopback servers before relaunching:

```sh
HOST=0.0.0.0 ALLOWED_ORIGINS=http://192.168.1.10:5173 npm run dev:server
```

```sh
VITE_SERVER_URL=http://192.168.1.10:2567 npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

Open `http://192.168.1.10:5173/display.html` on the computer, configure the team and create a room. Scan the displayed QR invitation with each phone, join and ready each seat. Allow local-network access through the computer's firewall if required. This exposes development servers to the LAN; use a trusted network. No hosting service change is needed.

The shared display and controller pages must reach the same backend. Keep the display visible and phones unlocked. Locking, losing focus or losing fresh input intentionally pauses the session. A reconnect reclaims the seat; it does not replay movement.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `VITE_SERVER_URL` | `http://127.0.0.1:2567` | Exact backend HTTP(S) origin, without path/query/trailing slash; Vite reads it at startup/build |
| `HOST` | `127.0.0.1` | Backend bind address |
| `PORT` | `2567` | Backend port |
| `ALLOWED_ORIGINS` | Localhost/loopback origins on 5173 and 4173 | Comma-separated exact permitted frontend origins |

`apps/game/.env.example` is a harmless local example; optionally copy it to `apps/game/.env.local`. Never commit actual environment files. The server reads its process environment, not that Vite file. Hosted HTTPS pages require an explicit non-loopback HTTPS backend origin. No credentials are necessary for local use.

## Verification and production builds

```sh
npm run typecheck       # Shared builds and strict frontend/server test types
npm test                # Physics, generation, rendering and local room regressions
npm run build           # Typecheck, frontend production bundle and backend build
npm run build:server    # Backend and shared packages only
```

The full suite includes numerical and real local socket fixtures and can take several minutes. Timing-sensitive fixtures depend on machine load. The two large seeded-enumeration correctness tests use 15-second runner deadlines so slower development machines can finish the same unchanged assertions; these are not gameplay timing budgets. Automated checks do not replace gameplay or device acceptance. Optional performance-output environment flags write local diagnostics; create an ignored `diagnostics/` directory before using them.

For production preview after `npm run build`, use two terminals:

```sh
npm run start:server
```

```sh
npm run preview -- --port 4173 --strictPort
```

Open `http://127.0.0.1:4173/`. Output is `dist/` for the frontend and workspace `dist/` directories for Node/shared code. These are generated locally and excluded from Git.

## Troubleshooting

- **Unsupported Node or missing npm:** install Node 24.x and check `node --version` and `npm --version`.
- **Port occupied:** stop the existing local process. Changing the frontend port also requires a matching allowed origin on the backend.
- **Connection rejected:** use one consistent hostname and check `VITE_SERVER_URL` and `ALLOWED_ORIGINS`.
- **Paused game:** keep all participants visible and controllers active; choose fresh input after resuming.
- **Missing character or WebGL error:** check WebGL2 support and that the included assets resolve. Character-load failures retain visible placeholders but should not be treated as a successful asset check.
