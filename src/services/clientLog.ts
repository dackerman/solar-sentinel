import type { DebugPanel } from '../components/debug.js';
import type { DebugEntry } from '../types/weather.js';

const DEVICE_ID_KEY = 'solar_sentinel_device_id';
const DEFAULT_ENDPOINT = '/api/client-log';
const DEFAULT_FLUSH_INTERVAL_MS = 60_000;
const DEFAULT_MAX_BATCH = 300;
const STARTUP_FLUSH_DELAY_MS = 5000;
const MAX_MESSAGE_LENGTH = 500;

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
      const loadIds = [...new Set(unshipped.map(entry => entry.loadId))];
      for (const loadId of loadIds) {
        const entries = unshipped.filter(entry => entry.loadId === loadId).slice(0, this.maxBatch);
        await this.send(entries, reason);
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  private async send(entries: DebugEntry[], reason: string): Promise<void> {
    const payload = this.buildPayload(entries);
    const json = JSON.stringify(payload);
    const useBeacon =
      (reason === 'hidden' || reason === 'pagehide') && typeof navigator.sendBeacon === 'function';

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
        this.markShippedAndLog(entries, reason);
      }
      return;
    }

    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: json,
        keepalive: true,
      });
      if (response.ok) {
        this.markShippedAndLog(entries, reason);
      }
    } catch {
      // Network failure: entries stay unshipped and go out on the next flush.
    }
  }

  private markShippedAndLog(entries: DebugEntry[], reason: string): void {
    this.panel.markShipped(entries);
    this.panel.log('Client log shipped', { count: entries.length, reason });
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
