import { mkdirSync, rmSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const outputDir = join(repoRoot, 'public', 'weather-art', 'v1');
const batchDir = join(outputDir, 'grok-batches');
const batchSize = 25;

const tempBands = [
  {
    key: 'freezing',
    range: '<=32°F',
    prompt: 'freezing air, blue-white frost, icy sparkle, bundled-up cold feeling',
  },
  {
    key: 'cold',
    range: '33-44°F',
    prompt: 'cold air, slate-blue shadows, bare branches, brisk jacket weather',
  },
  {
    key: 'cool',
    range: '45-59°F',
    prompt: 'cool air, fresh spring or fall feeling, light jacket weather',
  },
  {
    key: 'mild',
    range: '60-72°F',
    prompt: 'mild pleasant air, comfortable outdoor weather, soft green landscape',
  },
  {
    key: 'warm',
    range: '73-84°F',
    prompt: 'warm air, golden afternoon heat, summery saturated colors',
  },
  {
    key: 'hot',
    range: '>=85°F',
    prompt: 'hot air, shimmering heat haze, baked pavement glow, intense summer warmth',
  },
];

const dayDrySkyUv = [
  {
    key: 'clear-low-uv',
    prompt: 'clear sky with a gentle low sun, soft sunlight, relaxed low-UV mood',
  },
  {
    key: 'clear-moderate-uv',
    prompt: 'clear bright sky, confident sunbeams, moderate UV energy',
  },
  {
    key: 'clear-high-uv',
    prompt: 'clear blazing sky, sharp sun rays, high UV intensity without danger symbols',
  },
  {
    key: 'partly-low-uv',
    prompt: 'partly cloudy sky, soft filtered sunlight, calm low-UV atmosphere',
  },
  {
    key: 'partly-moderate-uv',
    prompt: 'partly cloudy sky, sun breaking through puffy clouds, moderate UV brightness',
  },
  {
    key: 'partly-high-uv',
    prompt: 'partly cloudy sky, dramatic bright sun gaps, high UV intensity',
  },
  {
    key: 'mostly-cloudy-low-uv',
    prompt: 'mostly cloudy sky, muted daylight, low UV softness',
  },
  {
    key: 'mostly-cloudy-bright',
    prompt: 'mostly cloudy but still bright, luminous cloud deck, glowing sky',
  },
  {
    key: 'overcast-low-uv',
    prompt: 'overcast gray sky, flat diffused daylight, low UV calm',
  },
  {
    key: 'overcast-bright',
    prompt: 'bright overcast sky, glowing white cloud ceiling, surprisingly luminous daylight',
  },
];

const dayChanceStyles = [
  {
    key: 'chance-sunshowers',
    prompt: 'sunshowers nearby, small raindrops with sunbeams breaking through clouds',
  },
  {
    key: 'chance-gloomy',
    prompt: 'threatening gray clouds with a chance of rain, damp air, no active downpour',
  },
];

const dayFog = {
  key: 'fog-haze',
  prompt: 'fog or haze softening the whole scene, low contrast air, dreamy visibility',
};

const nightSky = [
  {
    key: 'clear',
    prompt: 'clear night sky, crescent moon and a few stars, crisp readable silhouette',
  },
  {
    key: 'partly-cloudy',
    prompt: 'partly cloudy night, moon peeking between clouds, soft blue shadows',
  },
  {
    key: 'cloudy',
    prompt: 'cloudy night, moonlight hidden behind a thick cloud blanket, quiet darkness',
  },
];

const activeConditions = {
  rain: 'active rain, visible raindrops and puddle ripples, cozy wet-weather mood',
  storm: 'thunderstorm, dramatic clouds, lightning in the distance, wind-swept rain',
  snow: 'active snowfall, big readable snowflakes, snowy ground and frosty air',
  'wintry-mix': 'wintry mix, sleet and snow together, icy raindrops, slippery cold mood',
};

const humidityPrompts = {
  dry: 'dry air, crisp edges, no haze, slightly parched ground texture',
  comfortable: 'comfortable humidity, clean air, balanced colors, no heavy haze',
  humid: 'humid muggy air, visible haze, condensation droplets, heavy summer atmosphere',
};

const sampleKeys = [
  'day-freezing-clear-low-uv',
  'day-cold-wintry-mix',
  'day-cool-rain',
  'day-mild-comfortable-partly-moderate-uv',
  'day-warm-dry-clear-high-uv',
  'day-hot-humid-clear-high-uv',
  'day-hot-storm',
  'day-mild-humid-chance-sunshowers',
  'day-cool-overcast-bright',
  'day-warm-humid-overcast-bright',
  'night-hot-clear',
  'night-freezing-snow',
];

function createEntries() {
  const entries = [];

  for (const tempBand of tempBands) {
    const humidityFeels = ['mild', 'warm', 'hot'].includes(tempBand.key)
      ? ['dry', 'comfortable', 'humid']
      : [undefined];

    for (const condition of dayDrySkyUv) {
      for (const humidityFeel of humidityFeels) {
        entries.push(createEntry('day', tempBand, condition, humidityFeel));
      }
    }
  }

  for (const tempBand of tempBands) {
    const humidityFeels = ['mild', 'warm', 'hot'].includes(tempBand.key)
      ? ['comfortable', 'humid']
      : [undefined];

    for (const condition of dayChanceStyles) {
      for (const humidityFeel of humidityFeels) {
        entries.push(createEntry('day', tempBand, condition, humidityFeel));
      }
    }
  }

  for (const tempBand of tempBands) {
    const conditionKeys = getDayActiveConditionKeys(tempBand.key);
    for (const conditionKey of conditionKeys) {
      entries.push(createEntry('day', tempBand, getActiveCondition(conditionKey)));
    }
  }

  for (const tempBand of tempBands) {
    entries.push(createEntry('day', tempBand, dayFog));
  }

  for (const tempBand of tempBands) {
    for (const condition of nightSky) {
      entries.push(createEntry('night', tempBand, condition));
    }
  }

  for (const tempBand of tempBands.filter(tempBand => tempBand.key !== 'freezing')) {
    entries.push(createEntry('night', tempBand, getActiveCondition('rain')));
  }

  for (const tempBand of tempBands.filter(tempBand =>
    ['cool', 'mild', 'warm', 'hot'].includes(tempBand.key)
  )) {
    entries.push(createEntry('night', tempBand, getActiveCondition('storm')));
  }

  entries.push(createEntry('night', getTempBand('freezing'), getActiveCondition('snow')));
  entries.push(createEntry('night', getTempBand('cold'), getActiveCondition('wintry-mix')));

  for (const tempBand of tempBands) {
    entries.push(createEntry('night', tempBand, dayFog));
  }

  return entries.map((entry, index) => ({ id: index + 1, ...entry }));
}

function createEntry(daypart, tempBand, condition, humidityFeel) {
  const keyParts = [daypart, tempBand.key];
  if (humidityFeel) keyParts.push(humidityFeel);
  keyParts.push(condition.key);

  const key = keyParts.join('-');
  const filename = `${key}.webp`;
  const prompt = buildPrompt({ daypart, tempBand, condition, humidityFeel });

  return {
    key,
    daypart,
    tempBand: tempBand.key,
    tempRange: tempBand.range,
    humidityFeel,
    condition: condition.key,
    filename,
    path: `/weather-art/v1/${filename}`,
    alt: buildAlt({ daypart, tempBand, condition, humidityFeel }),
    prompt,
    negativePrompt:
      'text, letters, numbers, watermark, logo, UI frame, photorealistic human faces, cluttered composition, tiny unreadable details',
  };
}

function buildPrompt({ daypart, tempBand, condition, humidityFeel }) {
  const daypartPrompt =
    daypart === 'day'
      ? 'daytime weather, readable natural daylight'
      : 'nighttime weather, moonlit blue palette, readable at small icon size';
  const humidityPrompt = humidityFeel ? `, ${humidityPrompts[humidityFeel]}` : '';

  return [
    'Square 1:1 weather app icon, memorable whimsical miniature diorama, tactile clay and paper-cut texture, no text, no numerals, no UI symbols, centered composition, rounded friendly shapes, high contrast, readable at 96px.',
    `Scene: ${daypartPrompt}; ${tempBand.prompt}; ${condition.prompt}${humidityPrompt}.`,
    'Use a distinct color palette and a simple visual metaphor so this exact weather combo feels recognizable at a glance. Polished modern app icon, soft shadows, crisp silhouette, finished image only.',
  ].join(' ');
}

function buildAlt({ daypart, tempBand, condition, humidityFeel }) {
  const humidity = humidityFeel ? `${humidityFeel} ` : '';
  return `${daypart} ${tempBand.key} ${humidity}${condition.key}`;
}

function getDayActiveConditionKeys(tempBand) {
  if (tempBand === 'freezing') return ['snow', 'wintry-mix'];
  if (tempBand === 'cold') return ['rain', 'wintry-mix'];
  return ['rain', 'storm'];
}

function getActiveCondition(key) {
  return { key, prompt: activeConditions[key] };
}

function getTempBand(key) {
  const tempBand = tempBands.find(tempBand => tempBand.key === key);
  if (!tempBand) throw new Error(`Unknown temp band: ${key}`);
  return tempBand;
}

function writeJson(filePath, data) {
  writeFileSync(`${filePath}.json`, `${JSON.stringify(data, null, 2)}\n`);
}

function writeJsonl(filePath, entries) {
  const lines = entries.map(entry => JSON.stringify(entry)).join('\n');
  writeFileSync(`${filePath}.jsonl`, `${lines}\n`);
}

const entries = createEntries();
if (entries.length !== 191) {
  throw new Error(`Expected 191 weather art prompts, got ${entries.length}`);
}

const duplicateKeys = entries
  .map(entry => entry.key)
  .filter((key, index, keys) => keys.indexOf(key) !== index);

if (duplicateKeys.length > 0) {
  throw new Error(`Duplicate weather art keys: ${duplicateKeys.join(', ')}`);
}

const sampleEntries = sampleKeys.map(key => {
  const entry = entries.find(entry => entry.key === key);
  if (!entry) throw new Error(`Sample key not found: ${key}`);
  return entry;
});

mkdirSync(outputDir, { recursive: true });
rmSync(batchDir, { recursive: true, force: true });
mkdirSync(batchDir, { recursive: true });

writeJson(join(outputDir, 'manifest'), {
  version: 'v1',
  total: entries.length,
  imageFormat: 'webp',
  imageSize: '1:1 square, recommended 1024x1024 source and 256x256 served asset',
  style:
    'Memorable whimsical miniature weather diorama, tactile clay and paper-cut texture, no text.',
  entries,
});

writeJson(join(outputDir, 'sample-prompts'), {
  version: 'v1',
  total: sampleEntries.length,
  entries: sampleEntries,
});

for (let index = 0; index < entries.length; index += batchSize) {
  const batchNumber = String(index / batchSize + 1).padStart(3, '0');
  const batchEntries = entries.slice(index, index + batchSize);
  writeJsonl(join(batchDir, `batch-${batchNumber}`), batchEntries);
}

console.log(`Wrote ${entries.length} weather art prompts to ${outputDir}`);
console.log(`Wrote ${sampleEntries.length} representative prompts to sample-prompts.json`);
