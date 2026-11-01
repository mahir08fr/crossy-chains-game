import { couchRoomName, isDisplayWelcome, isControllerStatus, isCouchHealth } from '@crossy/protocol';
import type { CouchRole, DisplayWelcome, ControllerStatus, CouchHealth, ControllerDiagnosticEvent, ControllerDiagnosticDetail } from '@crossy/protocol';
import { Client } from '@colyseus/sdk';
import type { Room } from '@colyseus/sdk';
import {
  unpackSnapshot, isPrivateCode, isLobbyMessage, isLobbyRejection, isRoomClosedMessage, privateRoomName, isInputExpiredMessage, isProbeReply, isRejectionMessage, isWelcomeMessage, isSnapshotMessage, protocolVersion, transportRoomName,
} from '@crossy/protocol';
import type { GroupSize, ChainCourse, InputExpiredMessage, InputMessage, RejectionCode, SnapshotMessage, TransportMetadata, WelcomeMessage, LobbyAction, LobbyMessage, LobbyRejectionReason } from '@crossy/protocol';

type TestRoom = Room<unknown, TransportMetadata>;
export type TransportCallbacks = {
  displayWelcome?: (message: DisplayWelcome) => void;
  health?: (message: CouchHealth) => void;
  control?: (message: ControllerStatus) => void;
  performance?: (message: Record<string, unknown>) => void;
  status: (message: string, connected: boolean) => void;
  state: (metadata: TransportMetadata) => void;
  result: (message: string) => void;
  welcome?: (message: WelcomeMessage) => void;
  clock?: (serverTimeMs: number, sentAt: number, receivedAt: number) => void;
  inputExpired?: (message: InputExpiredMessage) => void;
  rejected?: (code: RejectionCode) => boolean | void;
  snapshot?: (message: SnapshotMessage) => void;
  lobby?: (message: LobbyMessage) => void;
  lobbyRejected?: (reason: LobbyRejectionReason) => void;
};

/** Shared room transport; never imports simulation, input controls or Three.js. */
export class TransportTestClient {
  private readonly client: Client;
  private room: TestRoom | undefined;
  private welcome: WelcomeMessage | DisplayWelcome | undefined;
  private lobby: LobbyMessage | undefined;
  private handshakeComplete = false;
  private resettingRun: number | undefined;
  private sequence = 0;
  private probeSequence = 0;
  private sampleSequence = 0;
  private pendingProbe: { sequence: number; startedAt: number } | undefined;
  private connecting = false;
  private disposed = false;
  private recovering = false;
  private operation = 0;
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined;
  private recoveryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly storageKey: string;

  constructor(endpoint: string, private readonly callbacks: TransportCallbacks, private readonly chainCourse?: ChainCourse, private readonly privateRoom = false, private readonly couchRole?: CouchRole) {
    this.client = new Client(endpoint);
    this.storageKey = `crossy-rejoin:${endpoint}${couchRole ? `:couch:${couchRole}` : privateRoom ? ':private' : chainCourse ? `:chain:${chainCourse}` : ''}`;
  }

  reportControllerEvent(event: ControllerDiagnosticEvent, detail: ControllerDiagnosticDetail): void {
    if (this.connected && this.couchRole === 'controller' && this.welcome) this.room?.send('controller-diagnostic',
      { protocolVersion, connectionGeneration: this.welcome.connectionGeneration, event, detail });
  }

  get active(): boolean { return !!this.room || this.recovering || this.connecting; }
  get canRejoin(): boolean { return !!this.savedToken(); }

  private savedToken(): string | undefined {
    try { return sessionStorage.getItem(this.storageKey) || undefined; } catch { return undefined; }
  }
  private saveToken(token?: string): void {
    try {
      if (token) sessionStorage.setItem(this.storageKey, token);
      else sessionStorage.removeItem(this.storageKey);
    } catch { /* Live recovery still works when tab storage is unavailable. */ }
  }

  async rejoin(): Promise<string> {
    const token = this.savedToken();
    if (!token) throw new Error('No saved session. Create or join a room.');
    return this.open(undefined, token);
  }

  async connect(roomId?: string, capacity: GroupSize = 2, course: 'road' | 'river' | 'railway' | 'generated' = 'road', seed?: number): Promise<string> { return this.open(roomId, undefined, capacity, course, seed); }

  private async open(roomId?: string, token?: string, capacity: GroupSize = 2, course: 'road' | 'river' | 'railway' | 'generated' = 'road', seed?: number): Promise<string> {
    if (this.disposed || this.active) throw new Error('Leave the existing room before connecting again');
    if (this.privateRoom && roomId !== undefined && !isPrivateCode(roomId)) throw new Error('Enter an eight-character invite code.');
    const operation = ++this.operation;
    this.connecting = true;
    this.callbacks.status('Connecting…', false);
    try {
      if (this.couchRole === 'controller' && !roomId && !token) throw new Error('Enter the room code shown on the display.');
      const displaySecret = this.couchRole === 'display' && !token
        ? Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('') : undefined;
      const options = { protocolVersion, ...(this.couchRole ? { role: this.couchRole } : {}), ...(displaySecret ? { displaySecret } : {}) };
      const room = token ? await this.client.reconnect<TransportMetadata>(token) : roomId
        ? await this.client.joinById<TransportMetadata>(roomId, options)
        : await this.client.create<TransportMetadata>(this.couchRole ? couchRoomName : this.privateRoom ? privateRoomName : transportRoomName, { ...options, ...(this.privateRoom ? { capacity, ...(course !== 'road' ? { course } : {}), ...(course === 'generated' && seed !== undefined ? {seed} : {}) } : {}), ...(!this.privateRoom && this.chainCourse ? { chainCourse: this.chainCourse } : {}) });
      if (this.disposed || operation !== this.operation) { await this.closeRoom(room); throw new Error('Connection cancelled'); }
      this.attachRoom(room);
      return room.roomId;
    } catch (error) {
      if (operation === this.operation) { this.connecting = false; this.saveToken(); this.clear('Connection failed · create or join a room'); }
      throw error;
    } finally { if (operation === this.operation) this.connecting = false; }
  }

  private attachRoom(room: TestRoom): void {
    this.room = room;
    // Recovery uses fresh SDK room instances; retries can be cancelled and no input is buffered.
    room.reconnection.enabled = false;
    room.reconnection.maxEnqueuedMessages = 0;
    this.sequence = 0;
    this.welcome = undefined; this.lobby = undefined; this.handshakeComplete = false;
    this.handshakeTimer = setTimeout(() => {
      if (this.room !== room || this.handshakeComplete) return;
      void this.leave().catch(() => undefined);
      this.callbacks.result('Server handshake timed out · create or join a room again.');
    }, 5000);
    room.onMessage('performance', (message: unknown) => {
      if (this.room === room && typeof message === 'object' && message !== null && !Array.isArray(message)) this.callbacks.performance?.(message as Record<string, unknown>);
    });
    room.onMessage('display-welcome', (message: unknown) => {
      if (this.room !== room || this.couchRole !== 'display' || !isDisplayWelcome(message)) return;
      this.welcome = message; this.saveToken(room.reconnectionToken);
      this.callbacks.displayWelcome?.(message); this.finishHandshake();
    });
    room.onMessage('couch-health', (message: unknown) => {
      if (this.room === room && isCouchHealth(message)) this.callbacks.health?.(message);
    });
    room.onMessage('controller-status', (message: unknown) => {
      if (this.room !== room || this.couchRole !== 'controller' || !this.welcome || !isControllerStatus(message)
        || message.runGeneration < this.welcome.runGeneration) return;
      this.welcome.runGeneration = message.runGeneration; this.welcome.serverTimeMs = message.serverTimeMs;
      this.callbacks.control?.(message);
    });
    room.onMessage('welcome', (message: unknown) => {
      if (this.room !== room || this.couchRole === 'display' || !isWelcomeMessage(message)) return;
      this.welcome = message;
      this.saveToken(room.reconnectionToken);
      this.callbacks.welcome?.(message);
      if (this.lobby) this.callbacks.lobby?.(this.lobby);
      this.finishHandshake();
    });
    room.onMessage('lobby', (message: unknown) => {
      if (this.room !== room || !this.privateRoom || !isLobbyMessage(message) || message.code !== room.roomId
        || (this.welcome && message.runGeneration < this.welcome.runGeneration)
        || (this.lobby && (message.capacity !== this.lobby.capacity || message.epoch < this.lobby.epoch || message.revision < this.lobby.revision))) return;
      this.lobby = message; this.callbacks.lobby?.(message); this.finishHandshake();
    });
    room.onMessage('lobby-rejected', (message: unknown) => {
      if (this.room !== room || !isLobbyRejection(message)) return;
      this.callbacks.lobbyRejected?.(message.reason);
    });
    room.onMessage('room-closed', (message: unknown) => {
      if (this.room !== room || !this.privateRoom || !isRoomClosedMessage(message)) return;
      this.saveToken(); this.clear(message.reason === 'display-left' ? 'Display left · session ended. Create a new room.' : 'Room expired after ten inactive lobby minutes · create a new room.');
      void this.closeRoom(room).catch(() => undefined);
    });
    room.onMessage('probe-reply', (message: unknown) => {
      if (this.room !== room || !isProbeReply(message) || message.sequence !== this.pendingProbe?.sequence) return;
      const receivedAt = performance.now();
      const rtt = receivedAt - this.pendingProbe.startedAt;
      this.callbacks.clock?.(message.serverTimeMs, this.pendingProbe.startedAt, receivedAt);
      this.pendingProbe = undefined;
      if (this.welcome) this.welcome.serverTimeMs = Math.max(this.welcome.serverTimeMs, message.serverTimeMs);
      this.callbacks.result(`Ping returned to ${message.slot} · RTT ${rtt.toFixed(1)} ms`);
    });
    const receiveSnapshot = (message: unknown) => {
      if (this.room === room && isSnapshotMessage(message)
        && (!this.welcome || message.runGeneration >= this.welcome.runGeneration)
        && (!this.lobby || message.players.length === this.lobby.capacity)) {
        if (this.resettingRun !== undefined && message.runGeneration > this.resettingRun) this.resettingRun = undefined;
        if (this.welcome) { this.welcome.runGeneration = message.runGeneration; this.welcome.serverTimeMs = message.serverTimeMs; }
        this.callbacks.snapshot?.(message);
      }
    };
    room.onMessage('snapshot', receiveSnapshot);
    room.onMessage('snapshot-compact', (message: unknown) => {
      const snapshot = unpackSnapshot(message);
      if (snapshot) receiveSnapshot(snapshot);
    });
    room.onMessage('input-expired', (message: unknown) => {
      if (this.room !== room || !this.welcome || !('slot' in this.welcome) || !isInputExpiredMessage(message)
        || message.slot !== this.welcome.slot || message.connectionGeneration !== this.welcome.connectionGeneration
        || message.runGeneration !== this.welcome.runGeneration) return;
      this.welcome.serverTimeMs = Math.max(this.welcome.serverTimeMs, message.serverTimeMs);
      this.callbacks.inputExpired?.(message);
    });
    room.onMessage('rejected', (message: unknown) => {
      if (this.room === room && isRejectionMessage(message)) {
        if (message.code === 'rate-limit') this.resettingRun = undefined;
        if (this.callbacks.rejected?.(message.code) !== true) this.callbacks.result(`Server rejected message: ${message.code}`);
      }
    });
    room.onStateChange((state) => { if (this.room === room) this.callbacks.state(state); });
    room.onError((code, message) => { if (this.room === room) this.callbacks.result(`Transport error${Number.isFinite(code) ? ` ${code}` : ''}: ${message ?? 'Connection interrupted'}`); });
    room.onLeave((code) => {
      if (this.room !== room) return;
      if (code === 4000) { this.saveToken(); this.clear('Left room'); }
      else this.recover(room.reconnectionToken);
    });
    this.callbacks.status(`Joined room ${room.roomId} · awaiting server slot…`, false);
    room.send('hello', { protocolVersion, ...(this.privateRoom ? { snapshotFormat: 'flat-chain-v1' } : {}) });
    if (this.callbacks.health && this.couchRole) room.send('couch-health', { protocolVersion });
    if (this.callbacks.performance) room.send('performance', { protocolVersion });
  }

  private recover(token: string): void {
    const operation = ++this.operation;
    clearTimeout(this.handshakeTimer);
    this.room = undefined; this.welcome = undefined; this.lobby = undefined; this.handshakeComplete = false; this.pendingProbe = undefined; this.resettingRun = undefined;
    this.recovering = true;
    this.saveToken(token);
    const deadline = performance.now() + 30_000;
    let attempt = 0;
    this.recoveryTimer = setTimeout(() => {
      if (operation !== this.operation) return;
      ++this.operation; clearTimeout(this.retryTimer); clearTimeout(this.recoveryTimer); this.recovering = false;
      this.saveToken(); this.clear('Reconnection expired · create or join a room');
    }, 30_000);
    this.callbacks.status('Connection interrupted · reconnecting for up to 30 seconds…', false);
    const retry = async () => {
      if (operation !== this.operation || this.disposed) return;
      if (performance.now() >= deadline) {
        this.recovering = false; this.saveToken(); this.clear('Reconnection expired · create or join a room'); return;
      }
      try {
        const room = await this.client.reconnect<TransportMetadata>(token);
        if (operation !== this.operation || this.disposed || performance.now() >= deadline) { await this.closeRoom(room); return; }
        clearTimeout(this.recoveryTimer); this.recovering = false;
        this.attachRoom(room);
      } catch {
        if (operation !== this.operation || this.disposed) return;
        this.retryTimer = setTimeout(() => { void retry(); }, Math.min(2000, 250 * 2 ** Math.min(attempt++, 3)));
      }
    };
    this.retryTimer = setTimeout(() => { void retry(); }, 250);
  }

  get connected(): boolean { return !!this.room && !!this.welcome && (!this.privateRoom || !!this.lobby && (this.couchRole === 'display' || 'slot' in this.welcome! && this.lobby.players.some(member => member.slot === (this.welcome as WelcomeMessage).slot && member.connected))); }

  private finishHandshake(): void {
    if (!this.connected || !this.room || !this.welcome || this.handshakeComplete) return;
    this.handshakeComplete = true; clearTimeout(this.handshakeTimer);
    this.callbacks.result('Session ready · input history reset.');
    this.callbacks.status(`Connected · ${'slot' in this.welcome ? this.welcome.slot : 'shared display'} · room ${this.room.roomId}`, true);
  }

  displayHeartbeat(active: boolean): void {
    if (this.couchRole === 'display' && this.room && this.welcome) this.room.send('display-heartbeat', { protocolVersion, active });
  }

  setDisplayName(name: string): void {
    if (!this.connected || !this.welcome || !('slot' in this.welcome) || !this.lobby) return;
    this.room?.send('player-name', { protocolVersion, connectionGeneration: this.welcome.connectionGeneration,
      runGeneration: this.welcome.runGeneration, lobbyEpoch: this.lobby.epoch, revision: this.lobby.revision, name });
  }

  lobbyAction(action: LobbyAction): void {
    if (!this.privateRoom || !this.connected || !this.room || !this.welcome || !this.lobby) return;
    this.room.send('lobby', { protocolVersion, action, connectionGeneration: this.welcome.connectionGeneration,
      runGeneration: this.welcome.runGeneration, lobbyEpoch: this.lobby.epoch });
  }

  probe(): void {
    if (this.couchRole === 'display' || !this.connected || !this.room || !this.welcome || this.pendingProbe) return;
    const startedAt = performance.now();
    this.pendingProbe = { sequence: ++this.probeSequence, startedAt };
    this.room.send('probe', { protocolVersion, sequence: this.probeSequence, clientTimeMs: startedAt });
    this.callbacks.result('Ping sent…');
  }

  sampleInput(): void {
    if (this.couchRole === 'display' || !this.connected || !this.room || !this.welcome || !('slot' in this.welcome)) return;
    // Diagnostic samples start with neutral so they still work after an idle expiry.
    this.sendInput(0, 0);
    const message: InputMessage = {
      protocolVersion, sequence: ++this.sequence, connectionGeneration: this.welcome.connectionGeneration,
      runGeneration: this.welcome.runGeneration, referenceTimeMs: this.welcome.serverTimeMs,
      x: ++this.sampleSequence % 2 ? 1 : -1, z: 0,
    };
    this.room.send('input', message);
    this.callbacks.result(`Sample ${message.sequence} sent for ${this.welcome.slot} · X = ${message.x}`);
  }

  sendInput(x: number, z: number): void {
    if (this.couchRole === 'display' || !this.connected || !this.room || !this.welcome || this.resettingRun !== undefined) return;
    this.room.send('input', { protocolVersion, sequence: ++this.sequence,
      connectionGeneration: this.welcome.connectionGeneration, runGeneration: this.welcome.runGeneration,
      referenceTimeMs: this.welcome.serverTimeMs, x, z } satisfies InputMessage);
  }

  reset(): void {
    if (this.privateRoom) { this.lobbyAction('restart'); return; }
    if (!this.connected || !this.room || !this.welcome || this.resettingRun !== undefined) return;
    this.resettingRun = this.welcome.runGeneration;
    this.room.send('reset', { protocolVersion });
  }

  async leave(): Promise<void> {
    ++this.operation; clearTimeout(this.retryTimer); clearTimeout(this.recoveryTimer); this.recovering = this.connecting = false;
    const room = this.room;
    this.saveToken();
    this.clear('Disconnected');
    if (room) await this.closeRoom(room);
  }

  private async closeRoom(room: TestRoom): Promise<void> {
    // A cancelled late reservation may never have reached attachRoom's guards.
    room.reconnection.enabled = false;
    room.reconnection.maxEnqueuedMessages = 0;
    // A proxy/socket may never acknowledge the SDK's consented leave. Local
    // ownership is already cleared; do not hold the menu or cancelled operation
    // indefinitely. This deadline is unrelated to the 250-ms input safeguards.
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([room.leave(), new Promise<void>(resolve => { timer = setTimeout(resolve, 3000); })]);
    } finally {
      clearTimeout(timer);
      room.connection.close();
    }
  }

  suspend(): void {
    // Reload/close preserves a tab-private reclaim credential, never a held input.
    ++this.operation; clearTimeout(this.retryTimer); clearTimeout(this.recoveryTimer); this.recovering = this.connecting = false;
    const room = this.room;
    if (room) this.saveToken(room.reconnectionToken);
    this.clear('Page suspended · rejoin your previous session within 30 seconds');
    if (room) { room.reconnection.enabled = false; room.connection.close(); }
  }

  dispose(): void { this.disposed = true; void this.leave(); }

  private clear(status: string): void {
    clearTimeout(this.handshakeTimer);
    this.room = undefined;
    this.welcome = undefined; this.lobby = undefined; this.handshakeComplete = false;
    this.resettingRun = undefined;
    this.pendingProbe = undefined;
    this.callbacks.status(status, false);
  }
}
