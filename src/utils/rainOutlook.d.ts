export declare function formatHourLabel(hour: number): string;
export declare function buildRainOutlook(
  times: string[],
  probabilities: number[],
  date: string,
  currentHour: number
): { label: string; startsAt?: string; probability: number };
