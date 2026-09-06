import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DebugPanel } from '../components/debug.js';

function getLog(): HTMLElement {
  return document.getElementById('debug-log')!;
}

function getCount(): HTMLElement {
  return document.getElementById('debug-count')!;
}

function getSearchInput(): HTMLInputElement {
  return document.getElementById('debug-search') as HTMLInputElement;
}

function getHidePerfCheckbox(): HTMLInputElement {
  return document.getElementById('debug-hide-perf') as HTMLInputElement;
}

function setSearch(value: string): void {
  const input = getSearchInput();
  input.value = value;
  input.dispatchEvent(new Event('input'));
}

function setHidePerf(checked: boolean): void {
  const checkbox = getHidePerfCheckbox();
  checkbox.checked = checked;
  checkbox.dispatchEvent(new Event('change'));
}

describe('DebugPanel', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    sessionStorage.clear();
    localStorage.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('search is case-insensitive contains across message and data', () => {
    const panel = new DebugPanel();
    panel.log('Weather API response: cache-hit (12ms)', { hash: '5F20A0BC' });
    panel.log('Service worker build 1.5', { version: '1.5' });
    panel.toggle();

    setSearch('5f20a0');
    expect(getLog().textContent).toContain('Weather API response');
    expect(getLog().textContent).not.toContain('Service worker build');

    setSearch('SERVICE worker');
    expect(getLog().textContent).toContain('Service worker build');
    expect(getLog().textContent).not.toContain('Weather API response');
  });

  it('Hide perf removes Perf: rows and updates the count to n of total', () => {
    const panel = new DebugPanel();
    panel.log('Perf: paint (5ms)');
    panel.log('Normal entry');
    panel.toggle();

    expect(getCount().textContent).toBe('2');

    setHidePerf(true);
    expect(getLog().textContent).not.toContain('Perf:');
    expect(getLog().textContent).toContain('Normal entry');
    expect(getCount().textContent).toBe('1 of 2');
  });

  it('clearing the query shows everything again', () => {
    const panel = new DebugPanel();
    panel.log('Alpha entry');
    panel.log('Beta entry');
    panel.toggle();

    setSearch('alpha');
    expect(getLog().textContent).not.toContain('Beta entry');

    setSearch('');
    expect(getLog().textContent).toContain('Alpha entry');
    expect(getLog().textContent).toContain('Beta entry');
  });

  it('Copy writes exactly the visible rows, honoring an active filter', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText },
      configurable: true,
    });

    const panel = new DebugPanel();
    panel.log('Alpha entry', { n: 1 });
    panel.log('Beta entry');
    panel.toggle();

    document.getElementById('copy-debug')!.dispatchEvent(new MouseEvent('click'));
    expect(writeText).toHaveBeenCalledTimes(1);
    const allText = writeText.mock.calls[0][0] as string;
    expect(allText).toContain('Alpha entry');
    expect(allText).toContain('Beta entry');
    expect(allText).toContain('{"n":1}');

    setSearch('alpha');
    document.getElementById('copy-debug')!.dispatchEvent(new MouseEvent('click'));
    expect(writeText).toHaveBeenCalledTimes(2);
    const filteredText = writeText.mock.calls[1][0] as string;
    expect(filteredText).toContain('Alpha entry');
    expect(filteredText).not.toContain('Beta entry');
  });

  it('rows are HTML-escaped', () => {
    const panel = new DebugPanel();
    panel.log('<b>bold claim</b>');
    panel.toggle();

    // Note: happy-dom decodes entities into a text node correctly (so no <b> element
    // is created) but does not re-escape "<"/">" when serializing innerHTML back out,
    // so we assert via querySelector + textContent rather than a raw innerHTML string
    // match, which would be a false negative in this environment's happy-dom.
    const logEl = getLog();
    expect(logEl.querySelector('b')).toBeNull();
    expect(logEl.textContent).toContain('<b>bold claim</b>');
  });

  it('persists entries across reload via sessionStorage and clear() empties it', () => {
    vi.useFakeTimers();
    const panel = new DebugPanel();
    panel.log('First entry');
    panel.log('Second entry');
    vi.runAllTimers();

    const restarted = new DebugPanel();
    restarted.toggle();
    const text = getLog().textContent ?? '';
    expect(text).toContain('First entry');
    expect(text).toContain('Second entry');
    expect(text).toContain('restored from previous page load');

    restarted.clear();
    const stored = sessionStorage.getItem('solar_sentinel_debug_log');
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored as string)).toEqual([]);

    vi.useRealTimers();
  });

  it('tracks unshipped entries via getUnshippedEntries and persists markShipped across reload', () => {
    vi.useFakeTimers();
    const panel = new DebugPanel();
    panel.log('Entry A');
    panel.log('Entry B');
    vi.runAllTimers();

    const unshipped = panel.getUnshippedEntries();
    expect(unshipped.map(e => e.message)).toEqual(['Entry A', 'Entry B']);

    panel.markShipped([unshipped[0]]);
    vi.runAllTimers();
    expect(panel.getUnshippedEntries().map(e => e.message)).toEqual(['Entry B']);

    const restarted = new DebugPanel();
    // The divider entry restored on construction is local-only (shipped),
    // so only the still-unshipped "Entry B" should remain.
    expect(restarted.getUnshippedEntries().map(e => e.message)).toEqual(['Entry B']);

    vi.useRealTimers();
  });

  it('applies a red tint to messages that look like failures', () => {
    const panel = new DebugPanel();
    panel.log('Location failed (200ms)');
    panel.toggle();

    expect(getLog().innerHTML).toContain('text-red-400');
  });
});
