import type { DebugEntry } from '../types/weather.js';

const STORAGE_KEY = 'solar_sentinel_debug_log';
const PERSIST_DEBOUNCE_MS = 500;
const COPIED_LABEL_MS = 1500;
const NEAR_BOTTOM_THRESHOLD_PX = 8;

function generateId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

export class DebugPanel {
  private entries: DebugEntry[];
  private isVisible = false;
  private isMinimized = false;
  private isExpanded = false;
  private searchQuery = '';
  private hidePerf = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxEntries = 300;
  private readonly consoleLoggingEnabled = this.getConsoleLoggingEnabled();
  private readonly loadId = generateId();
  private nextSeq = 0;

  constructor() {
    this.entries = this.loadPersistedEntries();
    this.setupPanel();
  }

  private loadPersistedEntries(): DebugEntry[] {
    try {
      const raw = sessionStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as Array<Partial<DebugEntry>>;
      if (!Array.isArray(parsed) || parsed.length === 0) return [];
      const normalized: DebugEntry[] = parsed.map((entry, index) => {
        if (typeof entry.seq === 'number' && typeof entry.loadId === 'string') {
          return {
            timestamp: entry.timestamp ?? '',
            message: entry.message ?? '',
            data: entry.data,
            seq: entry.seq,
            at: typeof entry.at === 'number' ? entry.at : 0,
            loadId: entry.loadId,
            shipped: entry.shipped,
          };
        }
        // Legacy entry predating shipping metadata: keep it local-only.
        return {
          timestamp: entry.timestamp ?? '',
          message: entry.message ?? '',
          data: entry.data,
          seq: index,
          at: 0,
          loadId: 'legacy',
          shipped: true,
        };
      });
      normalized.push({
        timestamp: this.formatTimestamp(new Date()),
        message: '— restored from previous page load —',
        seq: 0,
        at: 0,
        loadId: this.loadId,
        shipped: true,
      });
      return normalized;
    } catch {
      return [];
    }
  }

  private setupPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.className =
      'hidden fixed bottom-0 left-0 right-0 bg-gray-900 text-green-400 font-mono text-xs shadow-2xl z-50 flex flex-col border-t-2 border-green-400';

    panel.innerHTML = `
      <div class="flex flex-wrap items-center justify-between gap-2 p-2 border-b border-gray-700">
        <div class="flex items-center gap-2">
          <h4 class="text-green-300 font-semibold text-sm">Debug Log</h4>
          <span id="debug-count" class="text-gray-400"></span>
        </div>
        <div class="flex gap-1">
          <button id="copy-debug" type="button" class="min-h-9 px-3 text-blue-400 hover:text-blue-300">Copy</button>
          <button id="expand-debug" type="button" aria-label="Expand log" class="min-h-9 min-w-9 text-yellow-300 hover:text-yellow-200">⤢</button>
          <button id="minimize-debug" type="button" class="min-h-9 min-w-9 text-yellow-400 hover:text-yellow-300">−</button>
          <button id="clear-debug" type="button" class="min-h-9 px-3 text-red-400 hover:text-red-300">Clear</button>
        </div>
      </div>
      <div id="debug-controls" class="flex items-center gap-3 px-2 pb-2">
        <input id="debug-search" type="search" placeholder="Search log…" autocapitalize="off" autocorrect="off" spellcheck="false" class="flex-1 min-w-0 text-base bg-gray-800 text-green-200 placeholder-gray-500 rounded px-2 py-1 border border-gray-700 focus:outline-none focus:border-green-400" />
        <label class="flex items-center gap-1 text-gray-300 whitespace-nowrap">
          <input id="debug-hide-perf" type="checkbox" class="h-4 w-4" />
          Hide perf
        </label>
      </div>
      <div id="debug-log" class="overflow-y-auto px-2 pb-2 h-48"></div>
    `;

    document.body.appendChild(panel);

    document.getElementById('clear-debug')?.addEventListener('click', () => this.clear());
    document.getElementById('minimize-debug')?.addEventListener('click', () => this.minimize());
    document.getElementById('expand-debug')?.addEventListener('click', () => this.toggleExpand());
    document.getElementById('copy-debug')?.addEventListener('click', () => this.handleCopy());

    const searchInput = document.getElementById('debug-search') as HTMLInputElement | null;
    searchInput?.addEventListener('input', () => {
      this.searchQuery = searchInput.value;
      this.updateDisplay(true);
    });

    const hidePerfCheckbox = document.getElementById('debug-hide-perf') as HTMLInputElement | null;
    hidePerfCheckbox?.addEventListener('change', () => {
      this.hidePerf = hidePerfCheckbox.checked;
      this.updateDisplay(true);
    });
  }

  log(message: string, data?: unknown): void {
    const now = new Date();
    const timestamp = this.formatTimestamp(now);
    const entry: DebugEntry = {
      timestamp,
      message,
      data,
      seq: this.nextSeq++,
      at: now.getTime(),
      loadId: this.loadId,
    };

    if (this.consoleLoggingEnabled) {
      console.debug(`[Solar Sentinel] ${message}`, data ?? '');
    }

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.schedulePersist();
    this.updateDisplay();
  }

  /** Entries not yet shipped to the server, in log order. */
  getUnshippedEntries(): DebugEntry[] {
    return this.entries.filter(entry => !entry.shipped);
  }

  /** Marks the given entry objects (by reference) as shipped and persists the flag. */
  markShipped(entries: DebugEntry[]): void {
    if (entries.length === 0) return;
    const shippedSet = new Set(entries);
    for (const entry of this.entries) {
      if (shippedSet.has(entry)) {
        entry.shipped = true;
      }
    }
    this.schedulePersist();
  }

  toggle(): void {
    this.isVisible = !this.isVisible;
    const panel = document.getElementById('debug-panel');
    panel?.classList.toggle('hidden', !this.isVisible);

    if (this.isVisible) {
      if (this.isMinimized) {
        this.minimize();
      }
      this.updateDisplay(true);
    }
  }

  clear(): void {
    this.entries = [];
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persist();
    this.updateDisplay(true);
  }

  private minimize(): void {
    this.isMinimized = !this.isMinimized;
    const controls = document.getElementById('debug-controls');
    const logElement = document.getElementById('debug-log');
    const minimizeBtn = document.getElementById('minimize-debug');

    controls?.classList.toggle('hidden', this.isMinimized);
    logElement?.classList.toggle('hidden', this.isMinimized);
    if (minimizeBtn) minimizeBtn.textContent = this.isMinimized ? '+' : '−';

    if (!this.isMinimized) {
      this.updateDisplay();
    }
  }

  private toggleExpand(): void {
    this.isExpanded = !this.isExpanded;
    const logElement = document.getElementById('debug-log');
    const expandBtn = document.getElementById('expand-debug');

    logElement?.classList.toggle('h-48', !this.isExpanded);
    logElement?.classList.toggle('h-[70vh]', this.isExpanded);

    if (expandBtn) {
      expandBtn.textContent = this.isExpanded ? '⤡' : '⤢';
      expandBtn.setAttribute('aria-label', this.isExpanded ? 'Collapse log' : 'Expand log');
    }
  }

  private handleCopy(): void {
    const text = this.getFilteredEntries()
      .map(entry => this.formatEntryPlain(entry))
      .join('\n');

    try {
      if (navigator.clipboard?.writeText) {
        navigator.clipboard.writeText(text).catch(() => this.fallbackCopy(text));
      } else {
        this.fallbackCopy(text);
      }
    } catch {
      this.fallbackCopy(text);
    }

    this.showCopiedFeedback();
  }

  private fallbackCopy(text: string): void {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    } catch {
      // Clipboard unavailable in this environment; nothing more we can do.
    }
  }

  private showCopiedFeedback(): void {
    const copyBtn = document.getElementById('copy-debug');
    if (!copyBtn) return;
    copyBtn.textContent = 'Copied';
    window.setTimeout(() => {
      copyBtn.textContent = 'Copy';
    }, COPIED_LABEL_MS);
  }

  private formatEntryPlain(entry: DebugEntry): string {
    const dataStr = entry.data !== undefined ? ` | ${this.safeStringify(entry.data)}` : '';
    return `[${entry.timestamp}] ${entry.message}${dataStr}`;
  }

  private isFilterActive(): boolean {
    return this.searchQuery.trim() !== '' || this.hidePerf;
  }

  private getFilteredEntries(): DebugEntry[] {
    const query = this.searchQuery.trim().toLowerCase();
    return this.entries.filter(entry => {
      if (this.hidePerf && entry.message.startsWith('Perf:')) return false;
      if (!query) return true;
      const haystack = `${entry.message} ${this.safeStringify(entry.data)}`.toLowerCase();
      return haystack.includes(query);
    });
  }

  private updateDisplay(forceScrollBottom = false): void {
    if (!this.isVisible) return;

    const logElement = document.getElementById('debug-log');
    const countElement = document.getElementById('debug-count');
    if (!logElement) return;

    const filtered = this.getFilteredEntries();

    if (countElement) {
      countElement.textContent = this.isFilterActive()
        ? `${filtered.length} of ${this.entries.length}`
        : `${this.entries.length}`;
    }

    const distanceFromBottom =
      logElement.scrollHeight - logElement.scrollTop - logElement.clientHeight;
    const wasNearBottom = distanceFromBottom <= NEAR_BOTTOM_THRESHOLD_PX;

    logElement.innerHTML = filtered.map(entry => this.renderRow(entry)).join('');

    if (forceScrollBottom || wasNearBottom) {
      logElement.scrollTop = logElement.scrollHeight;
    }
  }

  private renderRow(entry: DebugEntry): string {
    const messageClass = this.messageColorClass(entry.message);
    const escapedTimestamp = this.escapeHtml(entry.timestamp);
    const escapedMessage = this.escapeHtml(entry.message);

    let dataHtml = '';
    if (entry.data !== undefined) {
      const dataStr = this.safeStringify(entry.data);
      dataHtml = ` <span class="text-gray-300">| ${this.escapeHtml(dataStr)}</span>`;
    }

    return `<div class="mb-1 whitespace-pre-wrap break-words"><span class="text-gray-500">[${escapedTimestamp}]</span> <span class="${messageClass}">${escapedMessage}</span>${dataHtml}</div>`;
  }

  private messageColorClass(message: string): string {
    if (/error|failed|expired|unavailable/i.test(message)) return 'text-red-400';
    if (message.startsWith('Perf:')) return 'text-gray-400';
    return 'text-green-400';
  }

  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  private safeStringify(data: unknown): string {
    if (data === undefined) return '';
    if (typeof data !== 'object') return String(data);
    try {
      return JSON.stringify(data);
    } catch {
      return '[unserializable]';
    }
  }

  private schedulePersist(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.persist();
    }, PERSIST_DEBOUNCE_MS);
  }

  private persist(): void {
    try {
      const safeEntries = this.entries.map(entry => {
        let data = entry.data;
        if (data !== undefined) {
          try {
            JSON.stringify(data);
          } catch {
            data = undefined;
          }
        }
        return {
          timestamp: entry.timestamp,
          message: entry.message,
          data,
          seq: entry.seq,
          at: entry.at,
          loadId: entry.loadId,
          shipped: entry.shipped,
        };
      });
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safeEntries));
    } catch {
      // sessionStorage unavailable or full; the in-memory log still works.
    }
  }

  // Persisted logs now span days (sessionStorage survives reloads across a
  // backgrounded/resumed app), so the timestamp includes the date, e.g.
  // "9/5 7:54:20 AM", not just the time.
  private formatTimestamp(d: Date): string {
    return `${d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })} ${d.toLocaleTimeString()}`;
  }

  private getConsoleLoggingEnabled(): boolean {
    try {
      return localStorage.getItem('solar_sentinel_debug_console') === '1';
    } catch {
      return false;
    }
  }
}
