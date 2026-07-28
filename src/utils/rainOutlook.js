/**
 * Rain outlook heuristic for the widget: when is rain (>= threshold) first
 * expected in the remainder of the day? Shared plain-JS module (see
 * weatherArt.js for the pattern); declarations in rainOutlook.d.ts.
 */

const RAIN_PROBABILITY_THRESHOLD = 50;

/**
 * Compact 12-hour label, e.g. 14 -> "2 PM".
 * @param {number} hour
 * @returns {string}
 */
export function formatHourLabel(hour) {
  const period = hour >= 12 ? 'PM' : 'AM';
  const display = hour % 12 === 0 ? 12 : hour % 12;
  return `${display} ${period}`;
}

/**
 * @param {string[]} times hourly local ISO timestamps ("2026-07-28T14:00")
 * @param {number[]} probabilities precipitation_probability values aligned with times
 * @param {string} date YYYY-MM-DD day to scan
 * @param {number} currentHour 0-23 in the location's timezone; earlier hours are ignored
 * @returns {{ label: string, startsAt?: string, probability: number }}
 */
export function buildRainOutlook(times, probabilities, date, currentHour) {
  let maxProbability = 0;

  for (let i = 0; i < times.length; i++) {
    if (!times[i].startsWith(`${date}T`)) continue;
    const hour = parseInt(times[i].slice(11, 13), 10);
    if (!Number.isFinite(hour) || hour < currentHour) continue;

    const probability = Number.isFinite(probabilities[i]) ? probabilities[i] : 0;
    if (probability >= RAIN_PROBABILITY_THRESHOLD) {
      return {
        label: hour === currentHour ? 'Rain now' : `Rain likely ~${formatHourLabel(hour)}`,
        startsAt: `${String(hour).padStart(2, '0')}:00`,
        probability,
      };
    }
    if (probability > maxProbability) maxProbability = probability;
  }

  return { label: 'No rain expected', probability: maxProbability };
}
