import { isCouchOptions, isDisplayHeartbeat, isControllerDiagnostic } from '@crossy/protocol';
import type { DisplayWelcome, ControllerStatus, CouchHealth, CouchBlocker } from '@crossy/protocol';
import { ServerPerformance } from './server-performance.js';
import { PrivateLobby, reservePrivateCode } from './private-lobby.js';
import { windowLimit } from './http-guard.js';
import { Room, ServerError } from '@colyseus/core';
import type { Client } from '@colyseus/core';
import { isNameCommand, packSnapshot, isSnapshotHello, isPrivateRoomOptions, playerSlots, isLobbyCommand, isInputMessage, isJoinOptions, isRoomOptions, isProbeMessage, protocolVersion } from '@crossy/protocol';
import type { GroupSize, ChainCourse, InputExpiredMessage, PlayerSlot, ProbeReply, RejectionCode, LobbyRejectionReason, WelcomeMessage } from '@crossy/protocol';
import { InputScheduler } from './input-scheduler.js';
import { AuthoritativeSession } from './authoritative-session.js';
import { TransportMemberState, TransportState } from './transport-state.js';

export const reconnectGraceSeconds = 30;

export type RoomAdmission = { activeRooms: number; nextGeneration: number; maxRooms: number; privateCodes: Set<string>; sessions: Set<AuthoritativeSession> };

export class TransportTestRoom extends Room<{ state: TransportState }> {
  state = new TransportState();
  maxClients = 2;
  maxMessagesPerSecond = 60;
  private readonly members = new Map<string, TransportMemberState>();
  private admission: RoomAdmission | undefined;
  private session: AuthoritativeSession | undefined;
  private readonly scheduler = new InputScheduler((slot, sequence, silenceMs, now) => {
    const member = this.state.players.get(slot);
    const client = this.clients.find((client) => this.members.get(client.sessionId)?.slot === slot);
    if (!member || !client || !this.session) return;
    this.scheduler.issueReference(slot, now);
    const message: InputExpiredMessage = { protocolVersion, slot,
      connectionGeneration: member.connectionGeneration, runGeneration: this.session.runGeneration,
      serverTimeMs: now, sequence, silenceMs };
    this.performanceMetrics?.count('inputExpiries');
    client.send('input-expired', message);
    this.diagnose('server-input-expired', message);
    this.boundary = `input-expired:${slot}`;
    this.publishHealth(now, true);
  });
  private readonly healthClients = new Set<string>();
  private readonly diagnosticLimits = new Map<string, () => boolean>();
  private readonly controllerReports: CouchHealth['reports'] = [];
  private readonly lastRejections = new Map<PlayerSlot, RejectionCode>();
  private lastHealthKey = '';
  private lastHealthAt = -Infinity;
  private boundary = 'created';
  private couch = false;
  private displayPairingSecret: string | undefined;
  private display: { sessionId: string; generation: number; connected: boolean; active: boolean; heartbeatAt: number } | undefined;
  private get capacity(): GroupSize { return this.lobby?.capacity ?? 2; }
  private get displayActive(): boolean {
    return !this.couch || !!this.display?.connected && this.display.active && performance.now() - this.display.heartbeatAt < 3000;
  }
  private isDisplay(client: Client): boolean { return this.couch && this.display?.sessionId === client.sessionId; }
  private closeCouch(): void {
    if (this.closing) return;
    this.closing = true;
    this.broadcast('room-closed', { protocolVersion, reason: 'display-left' });
    void this.disconnect();
  }
  private lastResetAt = -Infinity;
  private lobby: PrivateLobby | undefined;
  private performanceMetrics: ServerPerformance | undefined;
  private readonly performanceClients = new Set<string>();
  private lastCallbackAt: number | undefined;
  private lastSnapshotAt: number | undefined;
  private closing = false;
  private readonly compactClients = new Set<string>();
  private readonly commandLimits = new Map<string, () => boolean>();

  async onCreate(options: { admission: RoomAdmission; protocolVersion?: number; chainCourse?: ChainCourse; privateRoom?: boolean; capacity?: GroupSize; seed?: number; course?: 'road' | 'river' | 'railway' | 'generated'; couchRoom?: boolean; role?: string; displaySecret?: string }): Promise<void> {
    this.couch = !!options.couchRoom;
    if (this.couch && (!isCouchOptions({ protocolVersion: options.protocolVersion, role: options.role, displaySecret: options.displaySecret, ...(options.capacity !== undefined ? { capacity: options.capacity } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}), ...(options.course !== undefined ? { course: options.course } : {}) }) || options.role !== 'display')) throw new ServerError(400, 'Create a couch room from its display');
    this.displayPairingSecret = this.couch ? options.displaySecret : undefined;
    if (options.protocolVersion !== protocolVersion) throw new ServerError(400, 'Protocol version mismatch');
    if (options.admission.activeRooms >= options.admission.maxRooms) throw new ServerError(429, 'Local room limit reached');
    this.admission = options.admission;
    this.admission.activeRooms++;
    if (options.privateRoom && !isPrivateRoomOptions({ protocolVersion: options.protocolVersion, ...(options.capacity !== undefined ? { capacity: options.capacity } : {}), ...(options.seed !== undefined ? { seed: options.seed } : {}), ...(options.course !== undefined ? { course: options.course } : {}) })) throw new ServerError(400, 'Invalid capacity');
    if (options.privateRoom) {
      this.roomId = reservePrivateCode(options.admission.privateCodes);
      this.lobby = new PrivateLobby(this.roomId, performance.now(), options.capacity ?? 2, options.course === 'generated');
      await this.setPrivate(true);
    }
    this.maxClients = this.capacity + (this.couch ? 1 : 0);
    this.scheduler.setCapacity(this.capacity);
    this.session = new AuthoritativeSession(this.lobby ? options.course ?? 'road' : options.chainCourse, this.capacity, options.seed);
    this.admission.sessions.add(this.session);
    this.setSimulationInterval((deltaMs) => {
      const now = performance.now();
      if (this.lastCallbackAt !== undefined) this.performanceMetrics?.record('callbackGapMs', now - this.lastCallbackAt);
      this.lastCallbackAt = now;
      this.scheduler.expire(now);
      this.session!.setPhase((this.lobby?.stage === 'lobby' || this.members.size < this.capacity) ? 'waiting' : this.scheduler.ready && this.displayActive ? 'running' : 'paused');
      for (const member of this.members.values()) {
        const latest = this.scheduler.latest(member.slot as PlayerSlot);
        member.x = latest.x; member.z = latest.z;
        this.session!.input(member.slot as PlayerSlot, latest.x, latest.z, latest.sequence);
      }
      this.session!.advance(deltaMs / 1000);
      const phaseChanged = this.state.phase !== this.session!.phase;
      if (phaseChanged && this.session!.phase === 'paused') this.performanceMetrics?.count('safetyPauses');
      if (phaseChanged) this.diagnose('server-phase', { from: this.state.phase, to: this.session!.phase });
      this.state.phase = this.session!.phase;
      if (phaseChanged) this.publishHealth(now);
    }, 1000 / 60);
    // Register simulation first: disabling patches beforehand creates a second
    // framework clock ticker and leaves near-zero deltas for physics.
    if (this.couch) this.setPatchRate(null);
    this.clock.setInterval(() => this.publishSnapshot(), 50);
    this.onMessage('performance', (client, payload: unknown) => {
      if ((!this.members.has(client.sessionId) && !this.isDisplay(client)) || !isJoinOptions(payload)) { this.reject(client, 'invalid-message'); return; }
      this.performanceClients.add(client.sessionId);
      if (!this.performanceMetrics) {
        this.performanceMetrics = new ServerPerformance();
        this.session!.onTickMeasured = (wallMs, cpuMs) => {
          this.performanceMetrics?.count('simulationTicks');
          this.performanceMetrics?.record('simulationTickMs', wallMs);
          this.performanceMetrics?.record('simulationTickCpuMs', cpuMs);
          // A scheduling clue, not a cgroup-throttle counter: GC, clock resolution
          // and native waits also affect the difference between wall and thread CPU.
          this.performanceMetrics?.record('simulationTickWallCpuGapMs', Math.max(0, wallMs - cpuMs));
        };
        this.clock.setInterval(() => {
          const message = { ...this.performanceMetrics!.report(), capacity: this.capacity, activeRooms: this.admission?.activeRooms,
            runningRooms: [...this.admission!.sessions].filter(session => session.phase === 'running').length,
            roomPhases: [...this.admission!.sessions].map(session => ({ capacity: session.capacity, phase: session.phase })),
            resources: this.session!.diagnostics(),
            phase: this.session!.phase, tick: this.session!.snapshot(performance.now()).tick };
          for (const peer of this.clients) if (this.performanceClients.has(peer.sessionId)) peer.send('performance', message);
        }, 5000);
      }
    });
    this.onMessage('player-name', (client, payload: unknown) => {
      const member = this.members.get(client.sessionId);
      if (!this.lobby || !member || this.isDisplay(client)) { this.rejectLobby(client, 'invalid-command'); return; }
      if (!this.commandLimits.get(client.sessionId)?.()) { this.rejectLobby(client, 'command-rate'); return; }
      if (!isNameCommand(payload)) { this.rejectLobby(client, 'invalid-command'); return; }
      if (payload.connectionGeneration !== member.connectionGeneration || payload.runGeneration !== this.session!.runGeneration) { this.rejectLobby(client, 'stale-command'); return; }
      const error = this.lobby.rename(member.slot as PlayerSlot, payload.lobbyEpoch, payload.revision, payload.name, performance.now());
      if (error) this.rejectLobby(client, error); else this.publishLobby();
    });
    this.onMessage('lobby', (client, payload: unknown) => this.handleLobbyCommand(client, payload));
    if (this.lobby) this.clock.setInterval(() => {
      if (this.lobby?.expired(performance.now()) && !this.closing) {
        this.closing = true; this.broadcast('room-closed', { protocolVersion, reason: 'idle-timeout' });
        void this.disconnect();
      } else this.publishLobby();
    }, 1000);
    this.onMessage('reset', (client, payload: unknown) => {
      if (this.lobby) { this.rejectLobby(client, 'invalid-command'); return; }
      if (!this.members.has(client.sessionId) || !isJoinOptions(payload)) { this.reject(client, 'invalid-message'); return; }
      const now = performance.now();
      if (now - this.lastResetAt < 500) { this.reject(client, 'rate-limit'); return; }
      this.lastResetAt = now;
      this.session!.reset();
      this.state.runGeneration = this.session!.runGeneration;
      this.clearMovement('development-reset');
      this.publishSnapshot();
    });
    this.onMessage('couch-health', (client, payload: unknown) => {
      if (!this.couch || (!this.isDisplay(client) && !this.members.has(client.sessionId)) || !isJoinOptions(payload)) { this.reject(client, 'invalid-message'); return; }
      if (!this.diagnosticLimits.has(client.sessionId)) this.diagnosticLimits.set(client.sessionId, windowLimit(8));
      if (!this.diagnosticLimits.get(client.sessionId)!()) return;
      this.healthClients.add(client.sessionId); this.publishHealth(performance.now(), true);
    });
    this.onMessage('controller-diagnostic', (client, payload: unknown) => {
      const member = this.members.get(client.sessionId);
      if (!this.couch || !member || !isControllerDiagnostic(payload) || payload.connectionGeneration !== member.connectionGeneration) return;
      if (!this.diagnosticLimits.has(client.sessionId)) this.diagnosticLimits.set(client.sessionId, windowLimit(8));
      if (!this.diagnosticLimits.get(client.sessionId)!()) return;
      const report = { slot: member.slot as PlayerSlot, serverTimeMs: performance.now(), event: payload.event, detail: payload.detail };
      this.controllerReports.push(report); if (this.controllerReports.length > 8) this.controllerReports.shift();
      this.diagnose('controller-reported', report); this.publishHealth(performance.now(), true);
    });
    this.onMessage('display-heartbeat', (client, payload: unknown) => {
      if (!this.isDisplay(client) || !isDisplayHeartbeat(payload)) { this.reject(client, 'invalid-message'); return; }
      const wasActive = this.displayActive;
      this.display!.heartbeatAt = performance.now(); this.display!.active = payload.active;
      if (wasActive !== this.displayActive) this.clearMovement(payload.active ? 'display-resumed' : 'display-inactive');
    });
    this.onMessage('hello', (client, payload: unknown) => {
      if (this.isDisplay(client)) {
        if (!isSnapshotHello(payload)) { this.reject(client, 'invalid-message'); return; }
        if (payload.snapshotFormat) this.compactClients.add(client.sessionId);
        const welcome: DisplayWelcome = { protocolVersion, role: 'display', connectionGeneration: this.display!.generation,
          runGeneration: this.session!.runGeneration, serverTimeMs: performance.now() };
        client.send('display-welcome', welcome); this.publishLobby(); return;
      }
      const member = this.members.get(client.sessionId);
      if (!member || !isSnapshotHello(payload)) { this.reject(client, 'invalid-message'); return; }
      if (payload.snapshotFormat === 'flat-chain-v1') this.compactClients.add(client.sessionId);
      else this.compactClients.delete(client.sessionId);
      const welcome: WelcomeMessage = { protocolVersion, slot: member.slot as PlayerSlot,
        connectionGeneration: member.connectionGeneration, runGeneration: this.session!.runGeneration, serverTimeMs: performance.now() };
      this.scheduler.issueReference(member.slot as PlayerSlot, welcome.serverTimeMs);
      client.send('welcome', welcome);
      this.publishLobby();
    });
    this.onMessage('probe', (client, payload: unknown) => {
      const member = this.members.get(client.sessionId);
      if (!member || !isProbeMessage(payload)) { this.reject(client, 'invalid-message'); return; }
      const reply: ProbeReply = { ...payload, serverTimeMs: performance.now(), slot: member.slot as PlayerSlot };
      this.scheduler.issueReference(member.slot as PlayerSlot, reply.serverTimeMs);
      client.send('probe-reply', reply);
    });
    this.onMessage('input', (client, payload: unknown) => {
      const member = this.members.get(client.sessionId);
      if (!member || !isInputMessage(payload)) { this.reject(client, 'invalid-message'); return; }
      if (this.lobby?.stage === 'lobby' && (payload.x !== 0 || payload.z !== 0)) { this.reject(client, 'requires-neutral'); return; }
      const rejection = this.scheduler.accept(member.slot as PlayerSlot, payload, this.session!.runGeneration, performance.now());
      if (rejection) { this.reject(client, rejection); return; }
      member.lastSequence = payload.sequence;
      member.acceptedInputs++;
      member.x = payload.x;
      member.z = payload.z;
      this.state.revision++;
    });
    this.onMessage('*', (client) => this.reject(client, 'invalid-message'));
  }

  onAuth(_client: Client, options: unknown): boolean {
    if (this.couch) {
      if (!isCouchOptions(options) || (options.role === 'display' ? !!this.display || options.displaySecret !== this.displayPairingSecret : !this.display || !this.lobby?.acceptsJoin)) throw new ServerError(409, 'Invalid couch role or unavailable seat');
      return true;
    }
    if (this.lobby && (!this.lobby.acceptsJoin || !(this.members.size === 0 ? isPrivateRoomOptions(options) : isJoinOptions(options)))) throw new ServerError(409, 'Private room is full or already started');
    if (!(this.lobby && this.members.size === 0 ? isPrivateRoomOptions(options) : isRoomOptions(options))) throw new ServerError(400, 'Invalid join options or protocol version');
    return true;
  }

  onJoin(client: Client, options?: unknown): void {
    if (this.couch && isCouchOptions(options) && options.role === 'display') {
      if (this.display || !this.admission) throw new ServerError(409, 'Display already owned');
      this.displayPairingSecret = undefined;
      this.display = { sessionId: client.sessionId, generation: ++this.admission.nextGeneration, connected: true, active: false, heartbeatAt: 0 };
      this.commandLimits.set(client.sessionId, windowLimit(8)); this.publishLobby(); return;
    }
    if (this.lobby && !this.lobby.acceptsJoin) throw new ServerError(409, 'Private room is full or already started');
    const slot = playerSlots.slice(0, this.capacity).find(slot => !this.state.players.has(slot));
    if (!slot || !this.admission) throw new ServerError(409, 'No available slot');
    const member = new TransportMemberState();
    member.slot = slot;
    member.connectionGeneration = ++this.admission.nextGeneration;
    this.scheduler.connect(slot, member.connectionGeneration, performance.now());
    this.members.set(client.sessionId, member);
    this.commandLimits.set(client.sessionId, windowLimit(8));
    this.lobby?.join(slot, performance.now());
    this.state.players.set(slot, member);
    this.state.revision++;
    this.clearMovement(`player-joined:${slot}`);
    this.publishLobby();
  }

  onDrop(client: Client): void {
    if (this.isDisplay(client)) {
      this.display!.connected = false; this.display!.active = false; this.clearMovement('display-disconnected');
      void this.allowReconnection(client, reconnectGraceSeconds).catch(() => undefined);
      this.publishSnapshot(); return;
    }
    const member = this.members.get(client.sessionId);
    if (!member) return;
    member.connected = false;
    this.lobby?.connection(member.slot as PlayerSlot, false, performance.now());
    this.scheduler.disconnect(member.slot as PlayerSlot);
    this.pauseMovement(`controller-disconnected:${member.slot}`);
    this.state.revision++;
    // Colyseus reserves this session's seat/token; timeout invokes onLeave.
    void this.allowReconnection(client, reconnectGraceSeconds).catch(() => undefined);
    this.publishSnapshot();
    this.publishLobby();
  }

  onReconnect(client: Client): void {
    if (this.isDisplay(client) && this.admission) {
      this.display!.connected = true; this.display!.active = false; this.display!.generation = ++this.admission.nextGeneration;
      this.commandLimits.set(client.sessionId, windowLimit(8)); this.clearMovement('display-reconnected'); this.publishLobby(); return;
    }
    const member = this.members.get(client.sessionId);
    if (!member || !this.admission) throw new ServerError(409, 'Reconnection expired');
    member.connected = true;
    this.commandLimits.set(client.sessionId, windowLimit(8));
    this.lobby?.connection(member.slot as PlayerSlot, true, performance.now());
    member.connectionGeneration = ++this.admission.nextGeneration;
    member.lastSequence = 0;
    this.scheduler.connect(member.slot as PlayerSlot, member.connectionGeneration, performance.now());
    this.pauseMovement(`controller-reconnected:${member.slot}`);
    this.state.revision++;
    this.publishLobby();
    // The browser's fresh hello obtains the new generation/reference.
  }

  onLeave(client: Client): void {
    if (this.isDisplay(client)) { this.closeCouch(); return; }
    const member = this.members.get(client.sessionId);
    if (!member) return;
    this.scheduler.disconnect(member.slot as PlayerSlot);
    this.state.players.delete(member.slot);
    this.members.delete(client.sessionId);
    this.compactClients.delete(client.sessionId);
    this.performanceClients.delete(client.sessionId);
    this.commandLimits.delete(client.sessionId);
    this.healthClients.delete(client.sessionId); this.diagnosticLimits.delete(client.sessionId); this.lastRejections.delete(member.slot as PlayerSlot);
    if (this.lobby) {
      this.lobby.leave(member.slot as PlayerSlot, performance.now());
      if (!this.closing) {
        this.session!.reset(); this.state.runGeneration = this.session!.runGeneration;
        void this.unlock().catch(() => this.disconnect());
      }
    }
    this.state.revision++;
    this.clearMovement(`player-left:${member.slot}`);
    if (this.lobby) { this.publishSnapshot(); this.publishLobby(); }
  }

  onDispose(): void {
    if (this.session) this.admission?.sessions.delete(this.session);
    this.session?.dispose();
    this.session = undefined;
    this.members.clear();
    this.commandLimits.clear(); this.healthClients.clear(); this.diagnosticLimits.clear(); this.lastRejections.clear(); this.controllerReports.length = 0;
    this.compactClients.clear();
    this.performanceClients.clear();
    this.performanceMetrics?.dispose();
    if (this.lobby) this.admission?.privateCodes.delete(this.lobby.code);
    if (this.admission) { this.admission.activeRooms--; this.admission = undefined; }
  }

  private publishLobby(): void {
    if (this.lobby && this.session) this.broadcast('lobby', this.lobby.state(this.session.runGeneration));
  }

  private handleLobbyCommand(client: Client, payload: unknown): void {
    const member = this.members.get(client.sessionId);
    if (this.isDisplay(client)) { this.handleDisplayCommand(client, payload); return; }
    if (!this.lobby || !member) { this.rejectLobby(client, 'invalid-command'); return; }
    if (!this.commandLimits.get(client.sessionId)?.()) { this.rejectLobby(client, 'command-rate'); return; }
    if (!isLobbyCommand(payload)) { this.rejectLobby(client, 'invalid-command'); return; }
    if (payload.connectionGeneration !== member.connectionGeneration || payload.runGeneration !== this.session!.runGeneration) {
      this.rejectLobby(client, 'stale-command'); return;
    }
    const now = performance.now();
    if (payload.action === 'restart' && now - this.lastResetAt < 500) { this.rejectLobby(client, 'command-rate'); return; }
    const result = this.lobby.command(member.slot as PlayerSlot, payload.lobbyEpoch, payload.action,
      this.session!.phase === 'ended' || this.session!.phase === 'fault', now);
    if (result.error) { this.rejectLobby(client, result.error); return; }
    if (result.effect) {
      // Explicitly lock new seats; SDK reclaim remains available for reserved ones.
      void this.lock().catch(() => this.disconnect());
      this.lastResetAt = now;
      this.session!.reset(); this.state.runGeneration = this.session!.runGeneration;
      this.clearMovement(payload.action); this.publishSnapshot();
    }
    this.publishLobby();
  }

  private handleDisplayCommand(client: Client, payload: unknown): void {
    if (!this.commandLimits.get(client.sessionId)?.()) { this.rejectLobby(client, 'command-rate'); return; }
    if (!isLobbyCommand(payload) || !this.lobby || !['start', 'restart'].includes(payload.action)) { this.rejectLobby(client, 'invalid-command'); return; }
    if (payload.connectionGeneration !== this.display!.generation || payload.runGeneration !== this.session!.runGeneration || payload.lobbyEpoch !== this.lobby.state(this.session!.runGeneration).epoch) { this.rejectLobby(client, 'stale-command'); return; }
    const terminal = this.session!.phase === 'ended' || this.session!.phase === 'fault';
    if (payload.action === 'restart' && this.session!.chainCourse === 'generated') { this.rejectLobby(client, 'invalid-command'); return; }
    if (!this.displayActive || payload.action === 'restart' && !terminal) { this.rejectLobby(client, 'invalid-command'); return; }
    const host = this.lobby.state(this.session!.runGeneration).host;
    if (!host) { this.rejectLobby(client, 'need-two-players'); return; }
    if (performance.now() - this.lastResetAt < 500) { this.rejectLobby(client, 'command-rate'); return; }
    const result = this.lobby.command(host, payload.lobbyEpoch, payload.action, terminal, performance.now());
    if (result.error) { this.rejectLobby(client, result.error); return; }
    if (result.effect) {
      void this.lock().catch(() => this.disconnect()); this.lastResetAt = performance.now();
      this.session!.reset(); this.state.runGeneration = this.session!.runGeneration; this.clearMovement(payload.action); this.publishSnapshot();
    }
    this.publishLobby();
  }

  private rejectLobby(client: Client, reason: LobbyRejectionReason): void {
    client.send('lobby-rejected', { protocolVersion, reason });
    if (reason !== 'command-rate') this.publishLobby();
  }

  private publishSnapshot(): void {
    const now = performance.now();
    for (const member of this.members.values()) this.scheduler.issueReference(member.slot as PlayerSlot, now);
    if (this.lastSnapshotAt !== undefined) this.performanceMetrics?.record('snapshotGapMs', now - this.lastSnapshotAt);
    this.lastSnapshotAt = now;
    const startedAt = this.performanceMetrics ? performance.now() : 0;
    const snapshot = this.session!.snapshot(now);
    this.performanceMetrics?.record('snapshotCaptureMs', performance.now() - startedAt);
    const broadcastAt = this.performanceMetrics ? performance.now() : 0;
    for (const client of this.clients) this.performanceMetrics?.record('wsBufferedBytes', (client.ref as unknown as { bufferedAmount?: number }).bufferedAmount ?? 0);
    const viewers = this.couch ? this.clients.filter(client => this.isDisplay(client)) : [...this.clients];
    this.performanceMetrics?.record('fullSnapshotBytes', Buffer.byteLength(JSON.stringify(snapshot)));
    const compact = this.session!.capacity > 2 || snapshot.world ? viewers.filter(client => this.compactClients.has(client.sessionId)) : [];
    const legacy = viewers.filter(client => !compact.includes(client));
    // Exactly one world snapshot per display; phone updates contain no poses/cables/cars.
    if (legacy.length) this.broadcast('snapshot', snapshot, { except: this.clients.filter(client => !legacy.includes(client)) });
    if (compact.length) this.broadcast('snapshot-compact', packSnapshot(snapshot), { except: this.clients.filter(client => !compact.includes(client)) });
    if (this.couch) {
      const status: ControllerStatus = { protocolVersion, runGeneration: snapshot.runGeneration, serverTimeMs: now,
        phase: snapshot.phase, outcome: snapshot.world?.outcome ?? snapshot.railway?.outcome ?? snapshot.river?.outcome ?? snapshot.road?.outcome ?? 'active', displayActive: this.displayActive, ...(snapshot.world ? { endless: true as const } : {}), ...(snapshot.river ? { river: snapshot.river } : {}), ...(snapshot.railway ? { railway: snapshot.railway } : {}) };
      this.broadcast('controller-status', status, { except: viewers });
    }
    this.performanceMetrics?.record('snapshotEncodeBroadcastMs', performance.now() - broadcastAt);
    this.publishHealth(now);
  }

  private publishHealth(now: number, force = false): void {
    if (!this.couch || !this.session || (!this.healthClients.size && process.env.CROSSY_INPUT_DIAGNOSTICS !== '1')) return;
    const streams = this.scheduler.diagnostics(now).map(s => ({ ...s, lastRejection: this.lastRejections.get(s.slot) ?? null }));
    const blockers: CouchBlocker[] = [];
    if (this.lobby?.stage === 'lobby') blockers.push({ device: 'room', reason: 'lobby' });
    for (const slot of playerSlots.slice(0, this.capacity)) {
      const member = this.state.players.get(slot), stream = streams.find(s => s.slot === slot);
      if (!member) blockers.push({ device: slot, reason: 'missing-player' });
      else if (!member.connected) blockers.push({ device: slot, reason: 'controller-disconnected' });
      else if (stream?.requiresNeutral) blockers.push({ device: slot, reason: stream.neutralReason === 'expired' ? 'input-expired' : 'requires-neutral' });
    }
    if (!this.display?.connected) blockers.push({ device: 'display', reason: 'display-disconnected' });
    else if (!this.display.active) blockers.push({ device: 'display', reason: 'display-inactive' });
    else if (!this.displayActive) blockers.push({ device: 'display', reason: 'display-heartbeat-stale' });
    const key = JSON.stringify([this.session.phase, this.session.runGeneration, this.boundary, blockers, streams.map(s => [s.slot,s.generation,s.requiresNeutral,s.lastRejection])]);
    if (!force && key === this.lastHealthKey && (this.session.phase !== 'paused' || now - this.lastHealthAt < 1000)) return;
    const changed = key !== this.lastHealthKey; this.lastHealthKey = key; this.lastHealthAt = now;
    const health: CouchHealth = { protocolVersion, serverTimeMs: now, runGeneration: this.session.runGeneration, phase: this.session.phase,
      boundary: this.boundary, blockers, streams, reports: [...this.controllerReports],
      display: { connected: this.display?.connected ?? false, active: this.display?.active ?? false,
        heartbeatAgeMs: this.display ? Math.max(0, now - this.display.heartbeatAt) : null } };
    for (const client of this.clients) if (this.healthClients.has(client.sessionId)) client.send('couch-health', health);
    if (changed) this.diagnose('couch-health', health);
  }

  private clearMovement(reason = 'membership-or-reset'): void {
    this.scheduler.clear();
    this.pauseMovement(reason);
  }

  private pauseMovement(reason = 'membership-or-reset'): void {
    this.boundary = reason;
    const previousPhase = this.state.phase;
    this.session!.clearInputs();
    this.session!.setPhase(this.lobby?.stage === 'lobby' || this.members.size !== this.capacity ? 'waiting' : 'paused');
    this.state.phase = this.session!.phase;
    if (previousPhase !== this.state.phase && this.state.phase === 'paused') this.performanceMetrics?.count('safetyPauses');
    if (previousPhase !== this.state.phase) this.diagnose('server-phase', { from: previousPhase, to: this.state.phase, reason });
    for (const member of this.members.values()) { member.x = 0; member.z = 0; }
  }

  private diagnose(event: string, detail: object): void {
    if (process.env.CROSSY_INPUT_DIAGNOSTICS === '1') console.info('[Crossy input]', { event, room: this.roomId, ...detail });
  }

  private reject(client: Client, code: RejectionCode): void {
    // Rejections can be frequent under abuse: log only safety events, not packet contents.
    if (['stale-input', 'requires-neutral', 'invalid-generation'].includes(code)) {
      const member = this.members.get(client.sessionId);
      this.diagnose('server-input-rejected', { slot: member?.slot, code, phase: this.session?.phase });
    }
    const owner = this.members.get(client.sessionId); if (owner) this.lastRejections.set(owner.slot as PlayerSlot, code);
    client.send('rejected', { code });
  }
}
