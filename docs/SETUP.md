# Run Crossy Chains locally

[Back to the project](../README.md) · [Architecture](ARCHITECTURE.md) · [Verification record](VERIFICATION.md)

## Requirements

- [Node.js **24.x**](https://nodejs.org/en/download) and its bundled npm. [`.node-version`](../.node-version) records the tested patch version, 24.21.0.
- A desktop browser supporting WebGL2. Phones use the controller page, not the 3D renderer.
- Git and a network connection for the initial dependency install.

Blender, private development files, paid services and a hosted backend are not required. The runtime GLBs and font are included.

## Install and launch

```sh
git clone https://github.com/mahir08fr/crossy-chains-game.git
cd crossy-chains-game
npm ci
```

Run the following commands from the repository root. Press **Ctrl+C** in each server terminal when finished; wait for the process to stop before relaunching.

### Shared-keyboard preview — one terminal

No backend is required for this mode.

```sh
npm run dev
```

Open **http://127.0.0.1:5173/local.html**, choose **Ready** on both cards, then **Start**. Player 1 uses **WASD**; Player 2 uses the **arrow keys**. A solo reviewer can control the two seats in turn to explore the chain behavior.

### Multiplayer — two terminals

**Terminal 1 — backend:**

```sh
npm run dev:server
```

This builds shared packages and the server, then starts the backend at `http://127.0.0.1:2567`. Restart this command after server-code changes; it is not a server watch task.

**Terminal 2 — frontend:**

```sh
npm run dev
```

The frontend defaults to port 5173 and connects to the loopback backend. No environment override is needed for this setup. Open **http://127.0.0.1:5173/** for room setup.

For an explicit frontend backend-origin override in macOS/Linux:

```sh
VITE_SERVER_URL=http://127.0.0.1:2567 npm run dev
```

In PowerShell:

```powershell
$env:VITE_SERVER_URL = 'http://127.0.0.1:2567'
npm run dev
```

## Choose a mode

| URL | Use |
| --- | --- |
| `http://127.0.0.1:5173/local.html` | Two players sharing one keyboard; backend not required for this mode |
| `http://127.0.0.1:5173/` | Private online room with two to four desktop clients |
| `http://127.0.0.1:5173/display.html` | Shared 3D display with phone controllers |
| `http://127.0.0.1:5173/controller.html` | Touch controller for one room seat |
| `http://127.0.0.1:5173/playground.html` | Local chain and obstacle scenarios |

For shared keyboard, choose Ready on both cards, then Start. P1 uses WASD; P2 uses arrows. Advanced exposes course selection and a numeric seed. The regular game uses generated endless terrain; road, river and railway courses are useful focused reviews.

For desktop multiplayer, open two side-by-side browser windows or two visible browsers. Configure the team size before creating a room, choose **Create / join room**, and share the room invitation with the other client. Guests choose **Ready**; once guests are ready, the host chooses **Start**, which also confirms the host's readiness. Separate windows/tabs have independent session storage. Keep all active clients visible: a hidden tab intentionally invokes safety pauses and is useful for reviewing pause/reconnect behavior, rather than simultaneous play. Restarting an online endless run requires every player's vote. Two clients on one computer do not establish reliability across devices.

## Phone controllers on a trusted LAN

Connect the computer and phones to the same trusted network. Find the active Wi-Fi/Ethernet IPv4 address in system network settings: on macOS, **System Settings → Network → active connection → Details → TCP/IP**; on Windows, open the active connection's properties and find its IPv4 address.

Loopback addresses on a phone refer to the phone itself. Replace `192.168.1.10` in both commands below with the computer's LAN address, then stop the loopback servers before relaunching.

### macOS or Linux

**Terminal 1 — backend:**

```sh
HOST=0.0.0.0 ALLOWED_ORIGINS=http://192.168.1.10:5173 npm run dev:server
```

**Terminal 2 — frontend:**

```sh
VITE_SERVER_URL=http://192.168.1.10:2567 npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

### Windows PowerShell

**Terminal 1 — backend:**

```powershell
$env:HOST = '0.0.0.0'
$env:ALLOWED_ORIGINS = 'http://192.168.1.10:5173'
npm run dev:server
```

**Terminal 2 — frontend:**

```powershell
$env:VITE_SERVER_URL = 'http://192.168.1.10:2567'
npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
```

These forms express the same configuration; the [verification record](VERIFICATION.md) does not include a Windows/device acceptance run. Environment values remain set in those terminal sessions; use fresh terminals when returning to default loopback settings.

### Join from phones

Open `http://192.168.1.10:5173/display.html` on the computer, configure the team and create a room. Scan the displayed QR invitation with each phone, join and ready each seat. Allow local-network access through the computer's firewall if required. This exposes development servers to the LAN; use a trusted network. Guest-network isolation or VPN routing can prevent devices from reaching one another. No hosting-service change is needed.

The shared display and controller pages must reach the same backend. Keep the display visible and phones unlocked. Locking, losing focus or losing fresh input intentionally pauses the session. Reconnecting reclaims the seat without replaying held movement.

## Configuration

- **`VITE_SERVER_URL`** — frontend backend origin; default `http://127.0.0.1:2567`. Use an exact HTTP(S) origin without a path, query, or trailing slash. Vite reads it at startup/build.
- **`HOST`** — backend bind address; default `127.0.0.1`.
- **`PORT`** — backend port; default `2567`.
- **`ALLOWED_ORIGINS`** — comma-separated exact frontend origins; defaults include localhost/loopback on ports 5173 and 4173.

[`apps/game/.env.example`](../apps/game/.env.example) contains the local frontend configuration; optionally copy it to `apps/game/.env.local`. Never commit actual environment files. The server reads its process environment, not that Vite file. Hosted HTTPS pages require an explicit non-loopback HTTPS backend origin. No credentials are necessary for local use.

### Deployment configuration

No public deployment is advertised. Hosted HTTPS pages require a non-loopback HTTPS backend origin in the frontend build and the matching frontend origin in the backend's `ALLOWED_ORIGINS`.

The existing Render-specific checks activate when Render supplies `RENDER=true`. The backend then requires `HOST=0.0.0.0`, `PORT`, and explicit HTTPS `ALLOWED_ORIGINS`. The frontend build rejects a missing or loopback backend origin. Do not put `RENDER=true` into local frontend environment files. See the [server configuration](../apps/server/src/config.ts) and [Vite configuration](../vite.config.ts).

These are configuration requirements, not evidence of a validated hosted release.

## Development workflow

- Vite serves frontend changes during `npm run dev`.
- `npm run dev:server` builds and starts the backend once. Stop and restart it after server-source changes.
- Shared packages expose TypeScript source to Vite and compiled `dist/` modules to Node. After editing `packages/*`, run `npm run build:shared` for Node-based consumers and restart the backend when those changes affect it. Restarting `npm run dev:server` also rebuilds the shared packages.
- [`scripts/npm-local.sh`](../scripts/npm-local.sh) changes to the repository root and invokes npm from `PATH`; no private Node installation is needed.

### Development helpers

- [`phase2-traversal.mjs`](../scripts/phase2-traversal.mjs) supplies ordinary-input commands that wait for traffic/trains and recover on dry strips.
- [`phase35-traversal.mjs`](../scripts/phase35-traversal.mjs) builds on that driver with lateral regrouping and river-current opposition. The [sequence regression fixture](../apps/server/src/phase2-sequence.test.ts) imports it.
- Adjacent `.d.mts` files declare the helpers' types. [`fixtures/phase2-crossing.mjs`](../scripts/fixtures/phase2-crossing.mjs) supplies crossing checks used by the driver.

The phase-numbered names are retained fixture identifiers. These helpers are imported by development/test code; they are not player-facing modes.

### Browser entry points

- **`/` and `/play.html`** — main online game and private-room setup.
- **`/local.html`** — two-player shared keyboard.
- **`/display.html`** — shared 3D display for phone controllers.
- **`/controller.html`** — one room seat's touch controller.
- **`/playground.html`** — local chain and obstacle scenarios.
- **`/multiplayer.html`** — multiplayer development entry point.
- **`/network.html`** — transport diagnostics.

Those pages are included in the frontend production input list. `/gui-review.html` is a synthetic interface-review harness and `/performance.html` is a render benchmark; both are development-only pages outside that list. See [`vite.config.ts`](../vite.config.ts).

## Verification and production builds

```sh
npm run typecheck       # Shared builds and strict frontend/server test types
npm test                # Physics, generation, rendering and local room regressions
npm run build           # Typecheck, frontend production bundle and backend build
npm run build:server    # Backend and shared packages only
```

`npm run check` chains type checking, tests, and the production build, stopping if a stage fails. The full suite includes numerical and real local socket fixtures and can take several minutes. Some seeded-generation tests are computationally intensive; runner deadlines are separate from gameplay timing. Timing-sensitive fixture outcomes can vary with machine load. Automated checks do not replace gameplay or device acceptance. See the [verification record](VERIFICATION.md) for the last documented runtime, results, and unresolved full-suite/isolated-run inconsistency.

### Production preview

Vite embeds the backend origin into the frontend bundle at build time. Changing the preview process's environment does not rewrite a built bundle; rebuild when the intended endpoint changes.

For a loopback preview, build with `VITE_SERVER_URL=http://127.0.0.1:2567` using the environment syntax above, replacing `npm run dev` with `npm run build`. Then use two terminals.

**Terminal 1 — backend:**

```sh
npm run start:server
```

**Terminal 2 — frontend:**

```sh
npm run preview -- --port 4173 --strictPort
```

Open **http://127.0.0.1:4173/** for room setup or **http://127.0.0.1:4173/local.html** for shared-keyboard play. Output is `dist/` for the frontend and workspace `dist/` directories for Node/shared code. These are generated locally and excluded from Git.

## Troubleshooting

- **Unsupported Node or missing npm:** install Node 24.x, reopen the terminal, and check `node --version` and `npm --version`.
- **Port occupied:** press Ctrl+C in the terminal running that server. Changing the frontend port also requires a matching allowed origin on the backend.
- **Connection rejected:** use one consistent hostname and check `VITE_SERVER_URL` and `ALLOWED_ORIGINS`. Rebuild a production frontend after changing its backend origin.
- **Paused game:** keep all participants visible and controllers active; choose fresh input after resuming.
- **Phone cannot connect:** check the computer's LAN address, shared network, frontend/backend addresses, and local firewall permissions. The phone cannot reach the computer through `127.0.0.1`.
- **Missing character or WebGL error:** check WebGL2 support and that the included assets resolve. Character-load failures retain visible placeholders but should not be treated as a successful asset check.
