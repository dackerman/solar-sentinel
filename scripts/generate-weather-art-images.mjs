import { existsSync, mkdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { spawn } from 'child_process';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const manifestPath = join(repoRoot, 'public', 'weather-art', 'v1', 'manifest.json');
const outputDir = join(repoRoot, 'public', 'weather-art', 'v1');
const tempDir = '/tmp/opencode/weather-art-v1';
const defaultConcurrency = 5;

const concurrency =
  Number.parseInt(process.env.WEATHER_ART_CONCURRENCY ?? '', 10) || defaultConcurrency;
const limit = Number.parseInt(process.env.WEATHER_ART_LIMIT ?? '', 10) || Infinity;
const onlyKeys = new Set(
  (process.env.WEATHER_ART_KEYS ?? '')
    .split(',')
    .map(key => key.trim())
    .filter(Boolean)
);

mkdirSync(outputDir, { recursive: true });
mkdirSync(tempDir, { recursive: true });

const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
const missingEntries = manifest.entries.filter(entry => {
  if (onlyKeys.size > 0 && !onlyKeys.has(entry.key)) return false;
  return !existsSync(join(outputDir, entry.filename));
});
const queue = missingEntries.slice(0, limit);

if (queue.length === 0) {
  console.log('No missing weather art assets to generate.');
  process.exit(0);
}

console.log(
  `Generating ${queue.length} missing weather art assets with concurrency ${concurrency}...`
);

let nextIndex = 0;
let completed = 0;
let failed = 0;

async function worker(workerId) {
  while (nextIndex < queue.length) {
    const entry = queue[nextIndex++];
    const startedAt = Date.now();
    const pngPath = join(tempDir, `${entry.key}.png`);
    const webpPath = join(outputDir, entry.filename);

    try {
      await generatePng(entry, pngPath);
      await convertToWebp(pngPath, webpPath);
      completed += 1;
      const seconds = Math.round((Date.now() - startedAt) / 1000);
      console.log(
        `[${completed + failed}/${queue.length}] worker ${workerId}: ${entry.key} (${seconds}s)`
      );
    } catch (error) {
      failed += 1;
      console.error(`[failed] worker ${workerId}: ${entry.key}: ${error.message}`);
    }
  }
}

function generatePng(entry, pngPath) {
  const command = [
    'python3',
    '~/.claude/skills/nano-banana/scripts/generate_image.py',
    JSON.stringify(entry.prompt),
    '-o',
    JSON.stringify(pngPath),
    '-a',
    '1:1',
    '-r',
    '1K',
  ].join(' ');

  return run('nix-shell', ['-p', 'python3Packages.google-genai', '--run', command]);
}

function convertToWebp(pngPath, webpPath) {
  return run('magick', [pngPath, '-resize', '512x512', webpPath]);
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(stderr.trim() || `${command} exited with ${code}`));
      }
    });
  });
}

const startedAt = Date.now();
await Promise.all(
  Array.from({ length: Math.min(concurrency, queue.length) }, (_, index) => worker(index + 1))
);

const totalSeconds = Math.round((Date.now() - startedAt) / 1000);
console.log(`Finished ${completed} assets with ${failed} failures in ${totalSeconds}s.`);

if (failed > 0) process.exit(1);
