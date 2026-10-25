# Building Crossy Chains

[Back to the project](../README.md)

## Start with the relationship between players

I started with a cooperative crossing game built around one requirement: the chain had to matter physically. A teammate's movement should pull on the group, an obstacle should change the path of tension, and reversing direction should be a way to release a snag. A decorative line or a maximum-distance check would miss that interaction.

The project combines continuous movement with roads, rivers and railway crossings. It takes inspiration from cooperative chained movement and endless crossing games while using its own characters and visual presentation. Rescue quick-time events were considered during planning but are not part of the implementation presented here.

## A browser game with separate responsibilities

The browser makes desktop play and phone-controller participation possible through web pages. The implementation uses TypeScript throughout the game and server, Three.js for presentation, Rapier for physics, and Colyseus for persistent multiplayer rooms. Vite builds the browser entry points; Node.js runs the authority.

I kept the simulation independent of the DOM and Three.js. That boundary lets the same physics code run in the local playground, the shared-keyboard game and an authoritative server session. It also makes contact, water and lifecycle behavior testable without rendering a scene.

## Making the chain physical

Each adjacent player pair is connected by twelve dynamic capsule spans and spherical joints. The open topology grows from A–B to A–B–C–D. Players receive bounded drive forces; they are not teleported or assigned a new velocity to satisfy movement input. The chain transfers impulses through the shared world and contacts simple obstacle colliders.

The approximation has useful limits. It can catch and partially wrap around supported obstacles, but it is not an arbitrary knot simulator. Visual links are separate from the collision representation. Vehicles and trains use player-hit rules rather than physically sweeping the entire cable.

Contact-heavy configurations made solver accuracy a practical engineering concern. The current assembly uses four physics substeps per 60 Hz tick, twelve solver iterations and two internal PGS iterations. Fault detection monitors finite state, abnormal motion and constraint error. A fault freezes the assembly and requires an explicit rebuild; it is not hidden by snapping one endpoint back into place.

## Authority before prediction

Multiplayer introduced a second connected-system problem. Predicting each player separately would let clients disagree about the forces travelling through the chain. I chose a server-authoritative assembly with snapshot interpolation on the clients. Players, chain spans, hazards and lifecycle state are captured together. Presentation uses a common timeline rather than independently correcting endpoints.

That choice trades immediate local prediction for a clearer source of truth. High round-trip times remain visible in the feel of the game. Compact snapshots reduce repeated wire data, but reducing bytes does not prove that a hosting environment can sustain all physics work on schedule.

Input has its own lifecycle. Commands carry sequencing and ownership information; packet references and accepted-input freshness are bounded by 250 ms. Browser focus loss, controller interruptions and server-side expiry clear movement. A reclaimed seat uses fresh input and ownership; it never replays the keys held before the interruption.

## Generating a world for a group

A route that one character can cross is not automatically suitable for a chained team. The generator therefore builds constrained, versioned sections with compact hazard clusters and waiting or regrouping strips. Seeded descriptors let the server and clients agree on terrain, traffic profiles, river layout and railway timing.

The authority decides progression and difficulty. Difficulty is bounded and attached to section generation so a section does not change rules while the team is inside it. Rear progression and streaming account for player and cable bounds before removing terrain. This controls resource growth without assuming that the frontmost player represents the whole team.

Feasibility checks are conservative engineering checks, not a proof that every generated crossing is enjoyable. Human coordination and timing still need playtesting.

## Integrating characters without changing physics

The goose, axolotl, capybara and unicorn use project-created Blender geometry with separate walking and aquatic exports. Their runtime role is presentation: model scale, visual waterlines, turning and animation playback follow authoritative poses without changing collider geometry.

Animation raised a different performance problem from terrain rendering. Rigid parts can be batched while animation targets and skinned limbs retain their intended transforms. Cached templates avoid repeatedly loading the same GLB. Instanced trees and pooled visual effects address repeated scenery and transient particles separately.

## Debugging the interactions

The difficult defects crossed subsystem boundaries: input could be valid when sent but stale when consumed; a chain could look stretched because of presentation timing or because of a constraint error; an apparent rendering pause could originate in server scheduling. Reproductions needed to distinguish these cases before changing settings.

The test suite covers pure protocol validation, seeded generation, numerical physics behavior, interpolation, real local room transport and lifecycle transitions. Short performance fixtures help isolate CPU work and allocation. Such measurements depend on the machine, load and fixture; they are not production scalability claims.

The main lesson was to preserve the full system's invariants while fixing a narrow symptom. Increasing an input timeout would conceal pauses at the cost of stale movement. Removing physical spans would reduce work while changing the central mechanic. Neither is an equivalent optimization.

## Tools and authorship

I used Codex and AI assistance to develop code, tests, documentation and Blender scripts, alongside iterative review and gameplay feedback. This repository should not be read as a claim that every line was typed manually. The public snapshot includes the implemented systems and runtime assets; private prompts, planning records and raw diagnostic captures are intentionally excluded.

## What I would improve next

The remaining release work is validation as much as implementation: controlled real four-person network sessions, representative phone/browser testing and longer human endurance runs. Future performance work should compare physics CPU cost, scheduler delay, wire traffic and GPU work independently before changing architecture.

Broader device coverage, accessibility and clearer communication of chain tension are useful directions. Any future prediction strategy would need to handle the connected assembly consistently. None of those ideas changes the current release status: feature development is complete, but final public hosting and device reliability acceptance remains pending.
