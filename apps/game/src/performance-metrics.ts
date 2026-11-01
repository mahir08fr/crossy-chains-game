/** Bounded, opt-in timing samples. CPU render submission time is not GPU time. */
export class PerformanceMetrics {
  private readonly samples = new Map<string, number[]>();
  private readonly counts = new Map<string, number>();
  record(name: string, value: number): void {
    if (!Number.isFinite(value) || value < 0) return;
    const values = this.samples.get(name) ?? [];
    if (values.length >= 600) values.shift();
    values.push(value); this.samples.set(name, values);
  }
  count(name: string): void { this.counts.set(name, (this.counts.get(name) ?? 0) + 1); }
  summary(): string {
    return [...this.samples].map(([name, values]) => {
      const ordered = [...values].sort((a, b) => a - b);
      const fps = name === 'frame interval ms' ? ` · rolling FPS ${(1000 * values.length / values.reduce((a,b) => a+b, 0)).toFixed(1)}` : '';
      return `${name}: p50 ${ordered[Math.floor((ordered.length - 1) * .5)]!.toFixed(2)} / p95 ${ordered[Math.floor((ordered.length - 1) * .95)]!.toFixed(2)} / p99 ${ordered[Math.floor((ordered.length - 1) * .99)]!.toFixed(2)} / max ${ordered.at(-1)!.toFixed(2)} (${values.length} samples)${fps}`;
    }).concat([...this.counts].map(([name, count]) => `${name}: ${count}`)).join('\n');
  }
}

export function formatServerPerformance(message: Record<string, unknown>): string {
  const record = (v: unknown): Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v) ? v as Record<string, unknown> : {};
  const number = (v: unknown) => typeof v === 'number' && Number.isFinite(v) ? v.toFixed(2) : '—';
  const timings = record(message.timings), counts = record(message.counts), resources = record(message.resources);
  const ticksPerSecond = typeof counts.simulationTicks === 'number' && typeof message.durationMs === 'number' && message.durationMs > 0
    ? counts.simulationTicks * 1000 / message.durationMs : undefined;
  const metric = (key: string, statistic = 'p95') => number(record(timings[key])[statistic]);
  return `UTC ${String(message.at ?? '—')} · window ${number(message.durationMs)} ms · rooms ${number(message.activeRooms)} (${number(message.runningRooms)} running)\n`
    + `Process CPU ${number(message.processCpuPercent)}% of core · RSS ${number(message.processRssMiB)} MiB\n`
    + `Sim tick p95/max ${metric('simulationTickMs')}/${metric('simulationTickMs', 'max')} ms · completed ${number(ticksPerSecond)} ticks/s · loop p95/max ${number(message.eventLoopP95Ms)}/${number(message.eventLoopMaxMs)} ms\n`
    + `Tick thread CPU p95/max ${metric('simulationTickCpuMs')}/${metric('simulationTickCpuMs', 'max')} ms · wall−CPU gap p95/max ${metric('simulationTickWallCpuGapMs')}/${metric('simulationTickWallCpuGapMs', 'max')} ms\n`
    + `Snapshot capture/encode p95 ${metric('snapshotCaptureMs')}/${metric('snapshotEncodeBroadcastMs')} ms · publish gap p95/max ${metric('snapshotGapMs')}/${metric('snapshotGapMs', 'max')} ms\n`
    + `Sections ${number(resources.activeSections)} · created/removed ${number(resources.createdSections)}/${number(resources.removedSections)} · bodies/colliders/joints ${number(resources.bodies)}/${number(resources.colliders)}/${number(resources.joints)} · removed terrain ${number(resources.removedTerrainColliders)}\n`
    + `Run ${number(resources.runGeneration)} · ${number(resources.distance)} m / ${number(resources.runSeconds)} s · heap ${number(message.processHeapMiB)} MiB · safety pauses ${number(counts.safetyPauses ?? 0)} · full JSON max ${metric('fullSnapshotBytes','max')} bytes\n`
    + `Callback gap max ${metric('callbackGapMs', 'max')} ms · WS queued max ${metric('wsBufferedBytes', 'max')} bytes · input expiries ${number(counts.inputExpiries ?? 0)}`;
}
