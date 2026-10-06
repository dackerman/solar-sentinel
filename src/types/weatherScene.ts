export interface WeatherSceneState {
  temperature: number;
  feelsLike: number;
  humidity: number;
  cloud: number;
  chance: number;
  rain: number;
  snow: number;
  snowCover: number;
  wind: number;
  gust: number;
  windX: number;
  windZ: number;
  daylight: number;
  hour: number;
  heat: number;
  fog: number;
}

export interface WeatherSceneRenderer {
  resetCamera(): void;
  getCamera(): {
    position: number[];
    target: number[];
    rotation: number[];
    fov: number;
    aspect: number;
  };
  setWeather(state: WeatherSceneState): void;
  setPaused(paused: boolean): void;
  setMotionPaused(paused: boolean): void;
  dispose(): void;
}
