# Assets and third-party notices

[Back to the project](../README.md)

## Project-created runtime artwork

The public snapshot includes only the 17 GLBs directly imported by the game. Available project Blender generators and animation/validation records identify these as project-created procedural geometry and authored clips, developed with AI assistance. No third-party model pack, texture library or downloaded animation was identified in this runtime selection. Each GLB is self-contained, uses material colours and contains no images or external texture references.

| Asset family | Included runtime exports | Provenance basis |
| --- | --- | --- |
| Goose | `goose_animated/canada_goose_animated.glb`, `goose_006/goose_swimming.glb` | Project goose generator, walk rig and separate aquatic animation workflow |
| Axolotl | `axolotl_animated/axolotl_animated.glb`, `axolotl_004/axolotl_swimming.glb` | Self-contained project generator and walk/aquatic scripts |
| Capybara | `capybara_003/capybara_animated.glb`, `capybara_006/capybara_swimming.glb` | Project generator/refinement and animation workflow |
| Unicorn | `unicorn_006/unicorn_animated.glb`, `unicorn_009/unicorn_swimming.glb` | Original procedural geometry and separate walk/aquatic rigs |
| Car | `car_001/car.glb` | Project procedural car generator |
| Freight train | `train_004/locomotive.glb`, `boxcar.glb`, `open_wagon.glb` | Project procedural train generator |
| Trees | `trees_005/tree_small.glb`, `tree_medium.glb`, `tree_tall.glb` | Project seeded tree generator |
| River rocks | `rocks_001/rock_small.glb`, `rock_medium.glb` | Original deterministic project geometry; visual reference informed broad shape |

Paths above are relative to `assets/<family>/output/`. Editable Blender scenes, reference images, art drafts, scripts with workstation paths and internal validation records are not part of this curated game-source snapshot. Blender is not needed to build or run it. No original-artwork reuse licence is granted by publication.

## Font

`apps/game/public/fonts/PixelifySans.ttf` is **Pixelify Sans**, copyright 2021 The Pixelify Sans Project Authors. It is distributed under the **SIL Open Font License 1.1**. The full original notice is retained beside the font in [OFL.txt](../apps/game/public/fonts/OFL.txt). [Upstream font project](https://github.com/eifetx/Pixelify-Sans).

This font is third-party work; the project's source-availability notice does not replace its licence.

## Software dependencies

Dependencies are installed through the pinned manifests and lockfile rather than vendored. Their respective copyright and licence files remain in the installed packages. Principal components include:

| Component | Role | Licence |
| --- | --- | --- |
| Three.js | Browser rendering and glTF loading | MIT |
| Rapier JavaScript (`@dimforge/rapier3d-compat`) | Rigid-body physics | Apache-2.0 |
| Colyseus core/schema/SDK/WebSocket transport | Rooms, networking and state transport | MIT |
| qrcode-generator | Controller invitations | MIT |
| TypeScript | Static checking and compilation | Apache-2.0 |
| Vite / Vitest | Browser build and automated tests | MIT |

These dependency licences apply to those components, not to the original game code or artwork. Package installations include additional transitive dependencies with their own notices; inspect their installed metadata for the full terms.

## Gameplay media

The images and GIF in `docs/media/` are captures of this running implementation, not stock art, generated concept images or another game's screenshots. They show project runtime artwork and the credited font. See [capture notes](media/README.md).
