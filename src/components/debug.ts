import type { DebugEntry } from '../types/weather.js';

export class DebugPanel {
  private entries: DebugEntry[] = [];
  private isVisible = false;
  private readonly maxEntries = 50;

  constructor(private readonly container: HTMLElement) {
    this.setupPanel();
  }

  private setupPanel(): void {
    const panel = document.createElement('div');
    panel.id = 'debug-panel';
    panel.className =
      'hidden bg-gray-900 text-green-400 p-4 mb-4 rounded-lg font-mono text-xs max-h-64 overflow-y-auto';

    panel.innerHTML = `
      <div class="flex justify-between items-center mb-2">
        <h4 class="text-green-300 font-semibold">Request Debug Log</h4>
        <button id="clear-debug" class="text-red-400 hover:text-red-300">Clear</button>
      </div>
      <div id="debug-log"></div>
    `;

    this.container.appendChild(panel);

    // Add event listeners
    document.getElementById('clear-debug')?.addEventListener('click', () => this.clear());
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
    this.updateDisplay();
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
