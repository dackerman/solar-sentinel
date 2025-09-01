import type { DebugEntry } from '../types/weather.js';

export class DebugPanel {
  private entries: DebugEntry[] = [];
  private isVisible = false;
  private isMinimized = false;
  private readonly maxEntries = 50;

  constructor() {
    this.setupPanel();
  }

  private setupPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.className =
      'hidden fixed bottom-0 left-0 right-0 bg-gray-900 text-green-400 p-4 font-mono text-xs max-h-64 overflow-y-auto border-t-2 border-green-400 shadow-2xl z-50';

    panel.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h4 class="text-green-300 font-semibold">Request Debug Log</h4>
        <div class="flex gap-2">
          <button id="minimize-debug" class="text-yellow-400 hover:text-yellow-300 px-2">−</button>
          <button id="clear-debug" class="text-red-400 hover:text-red-300 px-2">Clear</button>
        </div>
      </div>
      <div id="debug-log"></div>
    `;

    document.body.appendChild(panel);

    // Add event listeners
    document.getElementById('clear-debug')?.addEventListener('click', () => this.clear());
    document.getElementById('minimize-debug')?.addEventListener('click', () => this.minimize());
  }

  log(message: string, data?: unknown): void {
    const timestamp = new Date().toLocaleTimeString();
    const entry: DebugEntry = { timestamp, message, data };

    this.entries.push(entry);
    if (this.entries.length > this.maxEntries) {
      this.entries.shift();
    }

    this.updateDisplay();
  }

  toggle(): void {
    this.isVisible = !this.isVisible;
    const panel = document.getElementById('debug-panel');
    panel?.classList.toggle('hidden', !this.isVisible);

    if (this.isVisible) {
      this.isMinimized = false;
      this.updateDisplay();
    }
  }

  private minimize(): void {
    this.isMinimized = !this.isMinimized;
    const panel = document.getElementById('debug-panel');
    const logElement = document.getElementById('debug-log');
    const minimizeBtn = document.getElementById('minimize-debug');

    if (this.isMinimized) {
      logElement?.classList.add('hidden');
      panel?.classList.remove('max-h-64');
      panel?.classList.add('max-h-12');
      if (minimizeBtn) minimizeBtn.textContent = '+';
    } else {
      logElement?.classList.remove('hidden');
      panel?.classList.remove('max-h-12');
      panel?.classList.add('max-h-64');
      if (minimizeBtn) minimizeBtn.textContent = '−';
      this.updateDisplay();
    }
  }

  clear(): void {
    this.entries = [];
    this.updateDisplay();
  }

  private updateDisplay(): void {
    if (!this.isVisible) return;

    const logElement = document.getElementById('debug-log');
    if (!logElement) return;

    logElement.innerHTML = this.entries
      .map(entry => {
        let dataStr = '';
        if (entry.data) {
          if (typeof entry.data === 'object') {
            dataStr = ' | ' + JSON.stringify(entry.data, null, 0);
          } else {
            dataStr = ' | ' + entry.data;
          }
        }
        return `<div class="mb-1">[${entry.timestamp}] ${entry.message}${dataStr}</div>`;
      })
      .join('');

    logElement.scrollTop = logElement.scrollHeight;
  }
}
