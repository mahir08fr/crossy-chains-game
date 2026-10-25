import { normalizeDisplayName, defaultDisplayName } from '@crossy/protocol';
import './style.css';
import { scenarios, settings } from '@crossy/config';
import { FixedStepClock, FoundationSimulation, initializePhysics } from '@crossy/simulation';
import { GameRenderer } from './renderer';
import { KeyboardInput } from './input';
import type { BrowserSoak } from './browser-soak';
import { Diagnostics } from './diagnostics';

function element<T extends HTMLElement>(selector: string): T {
  const result = document.querySelector<T>(selector);
  if (!result) throw new Error(`Missing interface element: ${selector}`);
  return result;
}

async function start(): Promise<void> {
  await initializePhysics();
  let scenario = scenarios[0]!;
  let simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, scenario.obstacles);
  const view = new GameRenderer(element('#viewport'));
  const nameSetup = document.createElement('details');
  const summary = document.createElement('summary'); summary.textContent = 'Player names'; nameSetup.append(summary);
  for (const slot of ['p1','p2'] as const) {
    const form = document.createElement('form'), label = document.createElement('label'), field = document.createElement('input'), save = document.createElement('button');
    label.textContent = `${defaultDisplayName(slot)} `; field.placeholder = defaultDisplayName(slot); field.setAttribute('aria-label', `${defaultDisplayName(slot)} name`);
    field.addEventListener('input', () => field.setCustomValidity(''));
    save.type = 'submit'; save.textContent = 'Save name'; label.append(field); form.append(label,save);
    form.addEventListener('submit', event => { event.preventDefault(); const name = normalizeDisplayName(field.value); field.setCustomValidity(name === undefined ? 'Use up to 16 characters without markup or controls.' : ''); if (name === undefined) field.reportValidity(); else view.labels.setName(slot,name || defaultDisplayName(slot)); });
    nameSetup.append(form);
  }
  element('#restart').parentElement!.append(nameSetup);
  const assetStatus = element('#asset-status');
  // Loading never blocks physics/input; failure retains P1's original capsule.
  void view.loadGoose().then(() => { assetStatus.textContent = 'Four custom characters loaded'; }).catch((error: unknown) => {
    console.error('Character asset load failed:', error);
    assetStatus.textContent = `${String(error)} · Unavailable characters retain visible placeholders. Reload to retry.`;
  });
  const clock = new FixedStepClock(settings.physics.tickSeconds, settings.physics.maxCatchUpTicks);
  const status = element('#status');
  const scenarioSelect = element<HTMLSelectElement>('#scenario');
  for (const entry of scenarios) scenarioSelect.add(new Option(entry.label, entry.id));
  const restartButton = element<HTMLButtonElement>('#restart');
  const faultButton = element<HTMLButtonElement>('#inject-fault');
  faultButton.hidden = !import.meta.env.DEV;
  const injectFault = () => {
    if (!import.meta.env.DEV) return;
    simulation.world.bodies.getAll()[0]?.setLinvel({ x: 100, y: 0, z: 0 }, true);
    faultButton.blur();
  };
  faultButton.addEventListener('click', injectFault);
  const debugButton = element<HTMLButtonElement>('#debug-toggle');
  const diagnostics = import.meta.env.DEV ? new Diagnostics(view.scene, element('#diagnostics'), debugButton) : undefined;
  let previous = simulation.states();
  let current = previous;
  let previousChain = simulation.chainStates();
  let currentChain = previousChain;
  view.chain.setCount(currentChain.length);
  let lastTime = performance.now();
  let frameId = 0;
  const resetPresentation = () => {
    input.clear();
    clock.reset();
    previous = current = simulation.states();
    previousChain = currentChain = simulation.chainStates();
    view.chain.setCount(currentChain.length);
    for (const player of view.players.values()) player.reset();
    view.camera.update(current.map((state) => state.position), 0, true);
    lastTime = performance.now();
  };
  let soak: BrowserSoak | undefined;
  const restart = () => {
    soak?.cancel();
    simulation.reset();
    resetPresentation();
    restartButton.blur();
  };
  const input = new KeyboardInput(restart, () => diagnostics?.toggle());
  const loadScenario = (id: string) => {
    const selected = scenarios.find((entry) => entry.id === id);
    if (!selected) return;
    scenario = selected;
    scenarioSelect.value = id;
    simulation.dispose();
    simulation = new FoundationSimulation(scenario.players, scenario.boxes, scenario.chain, scenario.obstacles);
    view.setScenario(scenario);
    resetPresentation();
    scenarioSelect.blur();
  };
  const changeScenario = () => { soak?.cancel(); loadScenario(scenarioSelect.value); };
  if (import.meta.env.DEV) {
    const { BrowserSoak } = await import('./browser-soak');
    soak = new BrowserSoak(element<HTMLButtonElement>('#browser-soak'), element('#soak-report'), loadScenario);
  }
  scenarioSelect.addEventListener('change', changeScenario);
  const onDebug = () => diagnostics?.toggle();
  restartButton.addEventListener('click', restart);
  debugButton.addEventListener('click', onDebug);
  view.camera.update(current.map((state) => state.position), 0, true);

  const frame = (time: number) => {
    const elapsed = Math.max(0, (time - lastTime) / 1000);
    lastTime = time;
    const started = performance.now();
    const paused = document.hidden || (input.paused && !soak?.running);
    if (paused || simulation.fault) {
      clock.reset();
      previous = current;
      previousChain = currentChain;
    } else {
      clock.advance(elapsed, () => {
        const testInput = soak?.input();
        previous = current;
        previousChain = currentChain;
        const tickStarted = performance.now();
        simulation.step(testInput ?? input.sample());
        soak?.record(simulation, performance.now() - tickStarted);
        if (simulation.fault) {
          // Keep the last finite render snapshot; only an explicit group restart recovers.
          input.clear();
        } else {
          current = simulation.states();
          currentChain = simulation.chainStates();
        }
      });
    }
    const stepMs = performance.now() - started;
    const alpha = paused || simulation.fault ? 1 : clock.alpha;
    const positions = [];
    for (const state of current) {
      const before = previous.find(({ id }) => id === state.id)!;
      const position = {
        x: before.position.x + (state.position.x - before.position.x) * alpha,
        y: before.position.y + (state.position.y - before.position.y) * alpha,
        z: before.position.z + (state.position.z - before.position.z) * alpha,
      };
      view.players.get(state.id)!.update(position, state.velocity, Math.min(elapsed, 0.1), state.grounded, paused || !!simulation.fault);
      positions.push(position);
    }
    view.chain.update(previousChain, currentChain, alpha);
    view.camera.update(positions, Math.min(elapsed, 0.1));
    diagnostics?.update(simulation, current, elapsed, time, stepMs, clock.droppedSeconds);
    status.hidden = !paused && !simulation.fault;
    status.textContent = simulation.fault ? `Physics paused: ${simulation.fault.detail}. Press R or Restart to reset the whole group.` : 'Paused · click the playground to continue';
    view.draw();
    soak?.resources(view.renderer.info.memory.geometries, view.renderer.info.memory.textures);
    frameId = requestAnimationFrame(frame);
  };
  frameId = requestAnimationFrame(frame);

  if (import.meta.hot) import.meta.hot.dispose(() => {
    cancelAnimationFrame(frameId);
    scenarioSelect.removeEventListener('change', changeScenario);
    restartButton.removeEventListener('click', restart);
    debugButton.removeEventListener('click', onDebug);
    faultButton.removeEventListener('click', injectFault);
    input.dispose();
    soak?.dispose();
    diagnostics?.dispose();
    view.dispose();
    simulation.dispose();
  });
}

start().catch((error: unknown) => {
  console.error(error);
  const status = element('#status');
  status.hidden = false;
  status.textContent = 'Unable to load the playground. Use a browser with WebGL2 and reload.';
});
