# Verification record

[Back to the project](../README.md) · [Setup and commands](SETUP.md#verification-and-production-builds)

This record describes checks performed on November 1, 2026 against source snapshot [`2b3a3d8`](https://github.com/mahir08fr/crossy-chains-game/tree/2b3a3d81f94308f88dd263500659435fd477a44a). It is a dated local result, not a claim that every later revision or device has passed. Subsequent documentation-only edits do not change the tested game implementation.

## Environment

- macOS on Apple silicon (arm64).
- Node.js 24.21.0, matching the recorded patch version.
- npm 11.19.0, bundled with that Node.js distribution.
- Fresh checkout and `npm ci` installation.

## Automated checks

- **Dependency installation:** passed; 141 packages installed from the lockfile.
- **Type checking:** passed with `npm run typecheck`.
- **Full check command:** `npm run check` stopped at the test stage. Of 94 test files, 92 passed and 2 failed; of 659 tests, 657 passed and 2 failed. The run took 607.13 seconds. Its chained production build was not reached.
- **Targeted rerun:** the two exact failing cases both passed when run separately from the full suite. Sixteen unselected cases were skipped across their two files. This rerun took 17.79 seconds and does not replace the full-suite result.
- **Separate production build:** passed with `npm run build`, including type checking, frontend bundling, and server/shared compilation.

### Full-suite failures and isolated reruns

**Host-stall recovery:** [network-performance.test.ts](../apps/server/src/network-performance.test.ts), case `Chain 50 ms TCP +350 ms host stall preserves synchronization, input safety and server stability`. The assertion expected recovered movement under 400 ms and received `Infinity`. The same case passed in the targeted rerun.

**Three-client restart:** [generated-room.test.ts](../apps/server/src/generated-room.test.ts), case `generated 3 desktop TCP: seed reconstruction, safe reclaim, shared water failure and same-seed restart`. After restart commands, the assertion expected run generation 3 and observed generation 2. The same case passed in the targeted rerun.

The inconsistent full-suite and isolated outcomes remain unresolved. Ordinary browser inspection overlapped the full run; the audit frontend server had been stopped before the targeted rerun. That is context, not proof of the cause. No tests, assertions, timeouts, or game source were changed during those checks.

### Build-size observation

The successful production build emitted a chunk-size warning. Its largest minified JavaScript chunk was 4,353.96 kB (1,676.61 kB gzip); another was 640.59 kB (162.14 kB gzip). Cold-cache hosted loading has not been measured, so these sizes do not establish a particular load time or frame rate.

## What the suite exercises

- Physics, chain constraints, traffic, rivers, and railway hazards.
- Seeded generation, transitions, and streamed-world boundaries.
- Protocol shapes, compact snapshots, ownership generations, and stale-input handling.
- Full-assembly interpolation and rendering-related regressions.
- Real local socket fixtures for room setup, session recovery, and restart behavior.

Representative entry points are [chain tests](../packages/simulation/src/chain.test.ts), [group timeline tests](../apps/game/src/group-timeline.test.ts), and [transport tests](../apps/server/src/transport.test.ts). A passing fixture establishes its assertions under its test conditions, not public-hosting capacity.

## Browser review and limits

Local shared-keyboard play was reviewed in Safari: both Ready actions, Start, WASD/arrow-key movement, score feedback, characters, chain and traffic rendering, help, pause/settings, and fullscreen transition. One reviewer controlled two local seats. A 1280 × 720 desktop browser view also showed the menu fitting with loaded character previews.

There is no advertised public demo. This record does not establish four-person play across devices, phone-controller acceptance, Windows acceptance, public-network reliability, hosting capacity, or long-session endurance. Screenshot capture contexts are documented separately in the [media notes](media/README.md).
