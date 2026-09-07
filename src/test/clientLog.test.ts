import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DebugPanel } from '../components/debug.js';
import { ClientLogShipper } from '../services/clientLog.js';

function lastFetchBody(): any {
  const calls = vi.mocked(global.fetch).mock.calls;
  const [, init] = calls[calls.length - 1];
  return JSON.parse((init as RequestInit).body as string);
}

function messagesIn(body: any): string[] {
  return body.entries.map((e: any) => e.message);
}

describe('ClientLogShipper', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  it('flushes unshipped entries 5s after start with the contract shape, and never resends them', async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    panel.log('Hello world');
    panel.log('Second message', { a: 1 });

    const shipper = new ClientLogShipper({ panel, getBuild: () => '5f20a03150fa' });
    shipper.start();

    await vi.advanceTimersByTimeAsync(5000);

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = vi.mocked(global.fetch).mock.calls[0];
    expect(url).toBe('/api/client-log');
    expect((init as RequestInit).method).toBe('POST');
    // 'startup' keeps the page alive on its own; no need for keepalive (and
    // no 64KB body cap that comes with it).
    expect((init as RequestInit).keepalive).toBeFalsy();

    const body = lastFetchBody();
    expect(typeof body.deviceId).toBe('string');
    expect(body.deviceId.length).toBeGreaterThan(0);
    expect(typeof body.loadId).toBe('string');
    expect(body.build).toBe('5f20a03150fa');
    expect(typeof body.userAgent).toBe('string');
    expect(body.entries).toHaveLength(2);
    expect(body.entries[0].seq).toBe(0);
    expect(typeof body.entries[0].at).toBe('number');
    expect(body.entries[0].message).toBe('Hello world');
    expect(body.entries[1].seq).toBe(1);

    // Both original entries are now shipped and must never be resent, even
    // once later flushes happen (the shipper logs its own tiny confirmation
    // line after a successful flush, which is fine to ship in turn).
    expect(panel.getUnshippedEntries().some(e => e.message === 'Hello world')).toBe(false);
    expect(panel.getUnshippedEntries().some(e => e.message === 'Second message')).toBe(false);

    await vi.advanceTimersByTimeAsync(60000);
    for (const call of vi.mocked(global.fetch).mock.calls.slice(1)) {
      const laterBody = JSON.parse((call[1] as RequestInit).body as string);
      expect(messagesIn(laterBody)).not.toContain('Hello world');
      expect(messagesIn(laterBody)).not.toContain('Second message');
    }

    shipper.stop();
  });

  it('leaves entries unshipped on a failed fetch (ok: false) and retries on the next interval', async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: false } as unknown as Response)
      .mockResolvedValueOnce({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    panel.log('Will fail first');

    const shipper = new ClientLogShipper({ panel, getBuild: () => '', flushIntervalMs: 10_000 });
    shipper.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(panel.getUnshippedEntries().map(e => e.message)).toContain('Will fail first');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(messagesIn(lastFetchBody())).toContain('Will fail first');
    expect(panel.getUnshippedEntries().map(e => e.message)).not.toContain('Will fail first');

    shipper.stop();
  });

  it('leaves entries unshipped on a rejected fetch and retries on the next interval', async () => {
    vi.useFakeTimers();
    vi.mocked(global.fetch)
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    panel.log('Will reject first');

    const shipper = new ClientLogShipper({ panel, getBuild: () => '', flushIntervalMs: 10_000 });
    shipper.start();

    await vi.advanceTimersByTimeAsync(5000);
    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(panel.getUnshippedEntries().map(e => e.message)).toContain('Will reject first');

    await vi.advanceTimersByTimeAsync(10_000);
    expect(global.fetch).toHaveBeenCalledTimes(2);
    expect(messagesIn(lastFetchBody())).toContain('Will reject first');
    expect(panel.getUnshippedEntries().map(e => e.message)).not.toContain('Will reject first');

    shipper.stop();
  });

  it('flushes via sendBeacon with a JSON Blob when the page becomes hidden, and marks shipped', async () => {
    const sendBeacon = vi.fn((_url: string, _data?: BodyInit | null) => true);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    const panel = new DebugPanel();
    panel.log('Before hide');

    const shipper = new ClientLogShipper({ panel, getBuild: () => '' });
    shipper.start();

    Object.defineProperty(document, 'visibilityState', {
      value: 'hidden',
      configurable: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    await Promise.resolve();
    await Promise.resolve();

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0];
    expect(url).toBe('/api/client-log');
    expect(blob).toBeInstanceOf(Blob);
    expect((blob as Blob).type).toBe('application/json');

    const text = await (blob as Blob).text();
    const body = JSON.parse(text);
    expect(body.entries[0].message).toBe('Before hide');

    expect(panel.getUnshippedEntries().map(e => e.message)).not.toContain('Before hide');
    expect(global.fetch).not.toHaveBeenCalled();

    shipper.stop();
  });

  it('flushes on pagehide', () => {
    const panel = new DebugPanel();
    panel.log('Before unload');

    const shipper = new ClientLogShipper({ panel, getBuild: () => '' });
    const flushSpy = vi.spyOn(shipper, 'flush');
    shipper.start();

    window.dispatchEvent(new Event('pagehide'));

    expect(flushSpy).toHaveBeenCalledWith('pagehide');

    shipper.stop();
  });

  it('includes restored unshipped entries from a previous load, excluding legacy entries', async () => {
    sessionStorage.setItem(
      'solar_sentinel_debug_log',
      JSON.stringify([
        { timestamp: '9/5 1:00:00 PM', message: 'Legacy entry' },
        {
          timestamp: '9/5 1:00:01 PM',
          message: 'Restored unshipped',
          seq: 3,
          at: 123456,
          loadId: 'prev-load-id',
          shipped: false,
        },
        {
          timestamp: '9/5 1:00:02 PM',
          message: 'Restored already shipped',
          seq: 4,
          at: 123457,
          loadId: 'prev-load-id',
          shipped: true,
        },
      ])
    );

    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    const shipper = new ClientLogShipper({ panel, getBuild: () => '' });

    await shipper.flush('manual');

    expect(global.fetch).toHaveBeenCalledTimes(1);
    const body = lastFetchBody();
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].message).toBe('Restored unshipped');
    expect(body.loadId).toBe('prev-load-id');
  });

  it('keeps a stable deviceId across shipper instances via localStorage', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    const panel1 = new DebugPanel();
    panel1.log('one');
    const shipper1 = new ClientLogShipper({ panel: panel1, getBuild: () => '' });
    await shipper1.flush('manual');
    const firstDeviceId = lastFetchBody().deviceId;

    const panel2 = new DebugPanel();
    panel2.log('two');
    const shipper2 = new ClientLogShipper({ panel: panel2, getBuild: () => '' });
    await shipper2.flush('manual');
    const secondDeviceId = lastFetchBody().deviceId;

    expect(firstDeviceId).toBe(secondDeviceId);
    expect(firstDeviceId.length).toBeGreaterThan(0);
  });
});

describe('ClientLogShipper batching across page loads', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('sends one batch per loadId so a restored load never collides with the current one', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    // Previous page load: two entries persisted but never shipped.
    const previous = new DebugPanel();
    previous.log('old one');
    previous.log('old two');
    await vi.advanceTimersByTimeAsync(600);

    // Current page load restores them and adds its own (seq restarts at 0).
    document.body.innerHTML = '';
    const current = new DebugPanel();
    current.log('new one');

    const shipper = new ClientLogShipper({ panel: current, getBuild: () => 'abc' });
    await shipper.flush('startup');

    const bodies = vi
      .mocked(global.fetch)
      .mock.calls.map(([, init]) => JSON.parse((init as RequestInit).body as string));
    expect(bodies).toHaveLength(2);
    const byMessages = Object.fromEntries(bodies.map(b => [messagesIn(b).join(','), b.loadId]));
    expect(Object.keys(byMessages).sort()).toEqual(['new one', 'old one,old two']);
    expect(byMessages['new one']).not.toBe(byMessages['old one,old two']);
    // The confirmation is logged once per flush (total count across every
    // batch it sent), not once per batch/loadId.
    expect(current.getUnshippedEntries().map(e => e.message)).toEqual(['Client log shipped']);
    const [shippedLog] = current.getUnshippedEntries();
    expect(shippedLog.data).toEqual({ count: 3, reason: 'startup' });
  });
});

describe('ClientLogShipper large-backlog batching and transport rules', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    Reflect.deleteProperty(navigator, 'sendBeacon');
  });

  function seedBacklog(count: number, dataSize: number, loadId = 'backlog-load'): void {
    const bigData = 'x'.repeat(dataSize);
    const persisted = Array.from({ length: count }, (_, i) => ({
      timestamp: '9/5 1:00:00 PM',
      message: `entry ${i}`,
      data: bigData,
      seq: i,
      at: 1000 + i,
      loadId,
      shipped: false,
    }));
    sessionStorage.setItem('solar_sentinel_debug_log', JSON.stringify(persisted));
  }

  it('drains a 400-entry backlog across multiple sub-40KB POSTs and logs one shipped confirmation', async () => {
    seedBacklog(400, 300);
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    const shipper = new ClientLogShipper({ panel, getBuild: () => '' });

    await shipper.flush('startup');

    const calls = vi.mocked(global.fetch).mock.calls;
    expect(calls.length).toBeGreaterThan(1);

    let totalEntries = 0;
    for (const [, init] of calls) {
      const body = (init as RequestInit).body as string;
      expect(body.length).toBeLessThanOrEqual(40_000);
      totalEntries += JSON.parse(body).entries.length;
    }
    expect(totalEntries).toBe(400);

    expect(panel.getUnshippedEntries().filter(e => e.message.startsWith('entry ')).length).toBe(0);

    const shippedLogs = panel.getUnshippedEntries().filter(e => e.message === 'Client log shipped');
    expect(shippedLogs).toHaveLength(1);
    expect(shippedLogs[0].data).toEqual({ count: 400, reason: 'startup' });
  });

  it('keeps an earlier batch shipped when a later batch in the same flush fails, and drains the rest next flush', async () => {
    seedBacklog(400, 300);
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ ok: true } as unknown as Response)
      .mockResolvedValueOnce({ ok: false } as unknown as Response)
      .mockResolvedValue({ ok: true } as unknown as Response);

    const panel = new DebugPanel();
    const shipper = new ClientLogShipper({ panel, getBuild: () => '' });

    await shipper.flush('startup');

    expect(global.fetch).toHaveBeenCalledTimes(2);
    const firstBatchCount = JSON.parse(
      (vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).body as string
    ).entries.length;
    const remaining = panel.getUnshippedEntries().filter(e => e.message.startsWith('entry '));
    expect(remaining.length).toBe(400 - firstBatchCount);

    await shipper.flush('startup');

    expect(panel.getUnshippedEntries().filter(e => e.message.startsWith('entry ')).length).toBe(0);
  });

  it('omits keepalive for interval/startup posts, and falls back to a keepalive fetch when sendBeacon fails on hide', async () => {
    vi.mocked(global.fetch).mockResolvedValue({ ok: true } as unknown as Response);

    const panel1 = new DebugPanel();
    panel1.log('interval entry');
    const shipper1 = new ClientLogShipper({ panel: panel1, getBuild: () => '' });
    await shipper1.flush('interval');
    expect((vi.mocked(global.fetch).mock.calls[0][1] as RequestInit).keepalive).toBeFalsy();

    const panel2 = new DebugPanel();
    panel2.log('startup entry');
    const shipper2 = new ClientLogShipper({ panel: panel2, getBuild: () => '' });
    await shipper2.flush('startup');
    expect((vi.mocked(global.fetch).mock.calls[1][1] as RequestInit).keepalive).toBeFalsy();

    const sendBeacon = vi.fn(() => false);
    Object.defineProperty(navigator, 'sendBeacon', { value: sendBeacon, configurable: true });

    const panel3 = new DebugPanel();
    panel3.log('hidden entry');
    const shipper3 = new ClientLogShipper({ panel: panel3, getBuild: () => '' });
    await shipper3.flush('hidden');

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const hiddenCall = vi.mocked(global.fetch).mock.calls[2];
    expect((hiddenCall[1] as RequestInit).keepalive).toBe(true);
    expect(panel3.getUnshippedEntries().some(e => e.message === 'hidden entry')).toBe(false);
  });
});
