import type { DebugPanel } from '../components/debug.js';
import type { DebugEntry } from '../types/weather.js';

const DEVICE_ID_KEY = 'solar_sentinel_device_id';
const DEFAULT_ENDPOINT = '/api/client-log';
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BATCH = 300;
const STARTUP_FLUSH_DELAY_MS = 5000;
const MAX_MESSAGE_LENGTH = 500;
// Chrome enforces a 64KB body cap on keepalive fetch/sendBeacon requests.
// Stay well under it so a large backlog never fails a batch outright.
const MAX_BATCH_BYTES = 40_000;
// Safety valve so one flush() call can't loop forever draining a backlog.
const MAX_BATCHES_PER_FLUSH = 20;
const TOO_LARGE_PLACEHOLDER = '[too large]';

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export interface ClientLogShipperOptions {
  panel: DebugPanel;
  endpoint?: string;
  getBuild: () => string;
  flushIntervalMs?: number;
  maxBatch?: number;
}

interface ClientLogPayload {
  deviceId: string;
  loadId: string;
  build: string;
  userAgent: string;
  entries: Array<{
    seq: number;
    at: number;
    timestamp: string;
    message: string;
    data?: unknown;
  }>;
}

/**
 * Ships the in-app debug log to the server so nobody has to copy it by hand.
 * Every send is fire-and-forget and every failure is swallowed: this must
 * never slow the app or surface errors of its own.
 */
export class ClientLogShipper {
  private readonly panel: DebugPanel;
  private readonly endpoint: string;
  private readonly getBuild: () => string;
  private readonly flushIntervalMs: number;
  private readonly maxBatch: number;
  private readonly deviceId: string;

  private intervalTimer: ReturnType<typeof setInterval> | null = null;
  private startupTimer: ReturnType<typeof setTimeout> | null = null;
  private flushInFlight = false;

  constructor(options: ClientLogShipperOptions) {
    this.panel = options.panel;
    this.endpoint = options.endpoint ?? DEFAULT_ENDPOINT;
    this.getBuild = options.getBuild;
    this.flushIntervalMs = options.flushIntervalMs ?? DEFAULT_FLUSH_INTERVAL_MS;
    this.maxBatch = options.maxBatch ?? DEFAULT_MAX_BATCH;
    this.deviceId = this.loadOrCreateDeviceId();
  }

  start(): void {
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('pagehide', this.handlePageHide);
    this.intervalTimer = setInterval(() => {
      void this.flush('interval');
    }, this.flushIntervalMs);
    // Delayed so the very first render/network cycle is never touched by this;
    // it exists to ship whatever a previous, unshipped load left behind.
    this.startupTimer = setTimeout(() => {
      void this.flush('startup');
    }, STARTUP_FLUSH_DELAY_MS);
  }

  stop(): void {
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('pagehide', this.handlePageHide);
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
    if (this.startupTimer !== null) {
      clearTimeout(this.startupTimer);
      this.startupTimer = null;
    }
  }

  async flush(reason: string): Promise<void> {
    if (this.flushInFlight) return;

    const unshipped = this.panel.getUnshippedEntries();
    if (unshipped.length === 0) return;

    this.flushInFlight = true;
    try {
      // The server dedupes on (deviceId, loadId, seq) and seq restarts at 0
      // on every page load, so entries restored from a previous load must go
      // out under their own loadId — one batch per load, in log order.
      // Within a load, a batch is further capped to stay under the 64KB
      // keepalive body limit, so a large backlog drains over several POSTs.
      const loadIds = [...new Set(unshipped.map(entry => entry.loadId))];
      let shippedCount = 0;
      let batchesSent = 0;

      outer: for (const loadId of loadIds) {
        const entries = unshipped.filter(entry => entry.loadId === loadId);
        const batches = this.buildBatches(entries);
        for (const batch of batches) {
          if (batchesSent >= MAX_BATCHES_PER_FLUSH) break outer;
          batchesSent++;
          const ok = await this.send(batch, reason);
          if (!ok) break outer;
          shippedCount += batch.length;
        }
      }

      // One confirmation per flush (not per batch) so a big drain doesn't
      // spam the log with a line per POST.
      if (shippedCount > 0) {
        this.panel.log('Client log shipped', { count: shippedCount, reason });
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  /** Splits one load's entries, in order, into batches under MAX_BATCH_BYTES. */
  private buildBatches(entries: DebugEntry[]): DebugEntry[][] {
    // Size incrementally: the envelope once, then each entry's own JSON plus
    // a separator, so a 300-entry backlog isn't re-serialized per candidate.
    if (entries.length === 0) return [];
    const envelopeBytes = JSON.stringify({
      ...this.buildPayload([entries[0]]),
      entries: [],
    }).length;
    const entryBytes = (entry: DebugEntry): number =>
      JSON.stringify(this.buildPayload([entry]).entries[0]).length + 1;

    const batches: DebugEntry[][] = [];
    let i = 0;
    while (i < entries.length) {
      // Always take at least one entry per batch, even if it alone is huge;
      // send() truncates an oversized singleton at transmit time.
      const batch: DebugEntry[] = [entries[i]];
      let size = envelopeBytes + entryBytes(entries[i]);
      i++;
      while (i < entries.length && batch.length < this.maxBatch) {
        const next = entryBytes(entries[i]);
        if (size + next > MAX_BATCH_BYTES) break;
        batch.push(entries[i]);
        size += next;
        i++;
      }
      batches.push(batch);
    }
    return batches;
  }

  /** Sends one batch. Returns whether it was accepted (and marks it shipped). */
  private async send(entries: DebugEntry[], reason: string): Promise<boolean> {
    let payload = this.buildPayload(entries);
    let json = JSON.stringify(payload);
    if (entries.length === 1 && json.length > MAX_BATCH_BYTES) {
      payload = this.buildPayload([{ ...entries[0], data: TOO_LARGE_PLACEHOLDER }]);
      json = JSON.stringify(payload);
    }

    const isPageGoingAway = reason === 'hidden' || reason === 'pagehide';
    const useBeacon = isPageGoingAway && typeof navigator.sendBeacon === 'function';

    if (useBeacon) {
      let delivered = false;
      try {
        delivered = navigator.sendBeacon(
          this.endpoint,
          new Blob([json], { type: 'application/json' })
        );
      } catch {
        delivered = false;
      }
      if (delivered) {
        this.panel.markShipped(entries);
        return true;
      }
      // sendBeacon unavailable or refused the payload (still capped by the
      // same 64KB limit, but our batches are already well under it): fall
      // back to a keepalive fetch since the page may still be going away.
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        ...(isPageGoingAway ? { keepalive: true } : {}),
      });
      if (response.ok) {
        this.panel.markShipped(entries);
        return true;
      }
      return false;
    } catch {
      // Network failure: entries stay unshipped and go out on the next flush.
      return false;
    }
  }

  private buildPayload(entries: DebugEntry[]): ClientLogPayload {
    return {
      deviceId: this.deviceId,
      loadId: entries[0].loadId,
      build: this.getBuild().slice(0, 32),
      userAgent: navigator.userAgent.slice(0, 300),
      entries: entries.map(entry => ({
        seq: entry.seq,
        at: entry.at,
        timestamp: entry.timestamp,
        message: entry.message.slice(0, MAX_MESSAGE_LENGTH),
        data: entry.data,
      })),
    };
  }

  private loadOrCreateDeviceId(): string {
    try {
      const existing = localStorage.getItem(DEVICE_ID_KEY);
      if (existing) return existing;
      const id = generateId();
      localStorage.setItem(DEVICE_ID_KEY, id);
      return id;
    } catch {
      return generateId();
    }
  }

  private readonly handleVisibilityChange = (): void => {
    if (document.visibilityState === 'hidden') {
      void this.flush('hidden');
    } else {
      void this.flush('visible');
    }
  };

  private readonly handlePageHide = (): void => {
    void this.flush('pagehide');
  };
}
