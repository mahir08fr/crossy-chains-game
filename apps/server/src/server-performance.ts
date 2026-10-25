import { monitorEventLoopDelay } from 'node:perf_hooks';

/** Opt-in, bounded five-second diagnostics; process CPU/RSS are not per-room usage. */
export class ServerPerformance {
  private readonly loop = monitorEventLoopDelay({ resolution: 10 });
  private readonly samples = new Map<string, number[]>();
  private readonly counts = new Map<string, number>();
  private startedAt = performance.now();
  private cpu = process.cpuUsage();
  constructor() { this.loop.enable(); }
  record(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const values = this.samples.get(name) ?? [];
    if (values.length < 2048) values.push(value);
    this.samples.set(name, values);
  }
  count(name: string): void { this.counts.set(name, (this.counts.get(name) ?? 0) + 1); }
  report() {
    const now = performance.now(), durationMs = now - this.startedAt, cpu = process.cpuUsage(this.cpu);
    const timings = Object.fromEntries([...this.samples].map(([name, values]) => {
      values.sort((a,b) => a-b);
      return [name, { samples: values.length, total: values.reduce((sum, value) => sum + value, 0), p95: values[Math.floor((values.length - 1) * .95)] ?? 0,
        max: values.at(-1) ?? 0 }];
    }));
    const report = { at: new Date().toISOString(), durationMs,
      processCpuPercent: durationMs > 0 ? (cpu.user + cpu.system) / (durationMs * 10) : 0,
      processRssMiB: process.memoryUsage().rss / 1048576,
      processHeapMiB: process.memoryUsage().heapUsed / 1048576,
      eventLoopP95Ms: this.loop.percentile(95) / 1e6, eventLoopMaxMs: this.loop.max / 1e6,
      timings, counts: Object.fromEntries(this.counts) };
    this.startedAt = now; this.cpu = process.cpuUsage();this.samples.clear();this.counts.clear();this.loop.reset();
    return report;
  }
  dispose(): void { this.loop.disable(); this.samples.clear(); this.counts.clear(); }
}
