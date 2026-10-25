import { controllerDiagnosticEvents } from '@crossy/protocol';
import type { CouchHealth, ControllerDiagnosticDetail, ControllerDiagnosticEvent } from '@crossy/protocol';

export function pauseCause(health?: CouchHealth): string {
  return health?.blockers.map(b => `${b.device.toUpperCase()}: ${b.reason}`).join(' · ') ?? '';
}

/** Opt-in bounded diagnostics: no axes, credentials, URLs or transport tokens. */
export class CouchDiagnostics {
  readonly enabled = new URLSearchParams(location.search).get('inputDiagnostics') === '1';
  health: CouchHealth | undefined;
  private lastBlocker = '';
  private readonly events: string[] = [];
  private readonly panel: HTMLPreElement | undefined;
  private lastReportAt = -Infinity;
  constructor(private readonly report?: (event: ControllerDiagnosticEvent, detail: ControllerDiagnosticDetail) => void) {
    if (this.enabled) {
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = 'Controller safety diagnostics'; details.open = true;
      this.panel = document.createElement('pre'); this.panel.style.whiteSpace = 'pre-wrap';
      details.append(summary, this.panel); document.body.append(details);
    }
  }
  receive(health: CouchHealth): void {
    this.health = health;
    if (health.blockers.length) this.lastBlocker = `${Math.round(health.serverTimeMs)} ms: ${pauseCause(health)}`;
    this.draw();
  }
  event(event: string, detail: ControllerDiagnosticDetail = {}): void {
    if (!this.enabled) return;
    const safe = Object.fromEntries(Object.entries(detail).filter(([, value]) => typeof value !== 'number' || Number.isFinite(value)));
    this.events.push(`${Math.round(performance.now())} ms ${event} ${JSON.stringify(safe)}`);
    if (this.events.length > 12) this.events.shift();
    // Reporting cannot compete with the input stream, even during an event burst.
    if (performance.now() - this.lastReportAt >= 250 && (controllerDiagnosticEvents as readonly string[]).includes(event)) {
      this.lastReportAt = performance.now(); this.report?.(event as ControllerDiagnosticEvent, safe);
    }
    this.draw();
  }
  private draw(): void {
    if (this.panel) this.panel.textContent = `Last blocker: ${this.lastBlocker || 'none'}\n${JSON.stringify(this.health, null, 2)}\nLocal events:\n${this.events.join('\n')}`;
  }
}
