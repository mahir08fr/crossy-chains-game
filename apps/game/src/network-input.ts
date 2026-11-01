type Axes = { x: number; z: number };

/** Sends current input periodically and on edges; owns no keys, queues or simulation. */
export class NetworkInputSender {
  private last: Axes | undefined;
  private sentAt = -Infinity;
  constructor(private readonly send: (x: number, z: number) => void, readonly intervalMs = 1000 / 30) {}

  update(now: number, input: Axes, ready: boolean): void {
    if (!ready) { this.clear(); return; }
    if (!this.last || input.x !== this.last.x || input.z !== this.last.z || now - this.sentAt >= this.intervalMs - 2) {
      this.send(input.x, input.z);
      this.last = { ...input };
      this.sentAt = now;
    }
  }
  clear(): void { this.last = undefined; this.sentAt = -Infinity; }
}
