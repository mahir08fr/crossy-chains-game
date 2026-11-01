import type { ControllerStatus } from '@crossy/protocol';
import { NetworkInputSender } from './network-input';
import type { JoystickAxes } from './joystick';

export type ControllerInputDiagnostic = (event: string, detail: Record<string, number | string | boolean>) => void;

/** Phone has no simulation/RAF. Safety is independent of touch-event delivery. */
export class ControllerInput {
  private status: ControllerStatus | undefined;
  private receivedAt = -Infinity;
  private lastPumpAt: number | undefined;
  private clockOffset: number | undefined;
  private bestRtt = Infinity;
  private clockMeasuredAt = -Infinity;
  private safetyReason = '';
  private readonly sender: NetworkInputSender;
  constructor(send: (x: number, z: number) => void, private readonly clearGesture: () => void,
    private readonly diagnose?: ControllerInputDiagnostic) { this.sender = new NetworkInputSender(send); }

  clock(serverTime: number, sent: number, received: number): void {
    const rtt = received - sent;
    // A queued/asymmetric probe is not evidence that current status is old.
    // Match the existing display buffer's low-RTT preference, and never let a
    // sample whose uncertainty spans the safety window calibrate freshness.
    if (!Number.isFinite(rtt) || rtt < 0 || !Number.isFinite(serverTime) || rtt >= 250
      || (rtt > this.bestRtt * 1.2 && received - this.clockMeasuredAt <= 10_000)) {
      this.diagnose?.('clock-sample-rejected', { rttMs: rtt, bestRttMs: this.bestRtt }); return;
    }
    this.bestRtt = rtt; this.clockMeasuredAt = received;
    this.clockOffset = serverTime - (sent + received) / 2;
    this.diagnose?.('clock-sample-accepted', { rttMs: rtt, offsetMs: this.clockOffset });
  }
  receive(status: ControllerStatus, now: number): void {
    if (!this.status || status.runGeneration !== this.status.runGeneration || ['waiting', 'ended', 'fault'].includes(status.phase)) this.clearGesture();
    this.status = status; this.receivedAt = now;
  }
  update(now: number, visible: boolean, connected: boolean, axes: () => JoystickAxes): boolean {
    const arrivalAge = now - this.receivedAt;
    const alignedAge = this.clockOffset === undefined || !this.status ? 0 : now + this.clockOffset - this.status.serverTimeMs;
    const age = Math.max(arrivalAge, alignedAge);
    if (this.lastPumpAt !== undefined && now - this.lastPumpAt >= 250) {
      this.diagnose?.('sender-stall', { gapMs: now - this.lastPumpAt });
      this.clearGesture(); this.sender.clear();
    }
    this.lastPumpAt = now;
    const fresh = visible && connected && !!this.status && age < 250;
    const moving = fresh && this.status!.displayActive && this.status!.phase === 'running';
    const reason = !connected ? 'disconnected' : !visible ? 'page-inactive' : !this.status ? 'no-status'
      : age >= 250 ? 'status-stale' : !this.status.displayActive ? 'display-unavailable'
      : this.status.phase !== 'running' ? `room-${this.status.phase}` : 'ready';
    if (reason !== this.safetyReason) {
      this.safetyReason = reason;
      this.diagnose?.('input-gate', { reason, arrivalAgeMs: arrivalAge, alignedAgeMs: alignedAge, visible, connected });
    }
    if (!moving) this.clearGesture();
    this.sender.update(now, moving ? axes() : { x: 0, z: 0 }, fresh);
    return moving;
  }
  reset(): void {
    this.status = undefined; this.receivedAt = -Infinity; this.lastPumpAt = undefined;
    this.clockOffset = undefined; this.bestRtt = Infinity; this.clockMeasuredAt = -Infinity; this.safetyReason = '';
    this.sender.clear(); this.clearGesture();
  }
}
