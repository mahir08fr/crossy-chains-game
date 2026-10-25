import './network.css';
import { TransportTestClient } from './network-client';
import { readTransportEndpoint } from './network-endpoint';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing transport test element: ${id}`);
  return result as T;
}
const create = element<HTMLButtonElement>('create');
const join = element<HTMLButtonElement>('join');
const leave = element<HTMLButtonElement>('leave');
const probe = element<HTMLButtonElement>('probe');
const sample = element<HTMLButtonElement>('sample');
const rejoin = element<HTMLButtonElement>('rejoin');
const roomId = element<HTMLInputElement>('room-id');
const status = element('status');
const result = element('result');
const state = element('state');
const endpoint = readTransportEndpoint(import.meta.env.VITE_SERVER_URL, window.location.protocol === 'https:');
element('endpoint').textContent = endpoint;
let busy = false;
const client = new TransportTestClient(endpoint, {
  status: (message, connected) => {
    status.textContent = message;
    create.disabled = join.disabled = roomId.disabled = client.active || busy;
    leave.disabled = !client.active; probe.disabled = sample.disabled = !connected;
    rejoin.disabled = client.active || busy || !client.canRejoin;
    if (!connected) state.textContent = 'No current room state.';
  },
  state: (metadata) => {
    state.textContent = JSON.stringify({ protocolVersion: metadata.protocolVersion, revision: metadata.revision,
      runGeneration: metadata.runGeneration, phase: metadata.phase,
      players: Array.from(metadata.players.values(), (member) => ({ slot: member.slot, connectionGeneration: member.connectionGeneration, connected: member.connected,
        acceptedInputs: member.acceptedInputs, lastSequence: member.lastSequence, x: member.x, z: member.z })),
    }, null, 2);
  },
  result: (message) => { result.textContent = message; },
});
const events = new AbortController();
const options = { signal: events.signal };
const connect = async (id?: string, reclaim = false) => {
  busy = true;
  create.disabled = join.disabled = rejoin.disabled = roomId.disabled = true;
  try { roomId.value = await (reclaim ? client.rejoin() : client.connect(id)); }
  catch (error) { result.textContent = error instanceof Error ? error.message : 'Connection failed'; }
  finally { busy = false; rejoin.disabled = client.active || !client.canRejoin; if (!client.active) create.disabled = join.disabled = roomId.disabled = false; }
};
rejoin.disabled = !client.canRejoin;
rejoin.addEventListener('click', () => { void connect(undefined, true); }, options);
create.addEventListener('click', () => { void connect(); }, options);
join.addEventListener('click', () => {
  const id = roomId.value.trim();
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id)) { result.textContent = 'Enter a valid room ID from the other browser.'; return; }
  void connect(id);
}, options);
leave.addEventListener('click', () => { void client.leave().catch((error: unknown) => { result.textContent = String(error); }); }, options);
probe.addEventListener('click', () => client.probe(), options);
sample.addEventListener('click', () => client.sampleInput(), options);
const dispose = () => { events.abort(); client.dispose(); };
window.addEventListener('pagehide', () => { client.suspend(); }, options);
if (import.meta.hot) import.meta.hot.dispose(dispose);
