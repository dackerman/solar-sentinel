import './styles.css';
import { SolarSentinelApp } from './app.js';

performance.mark('solar-sentinel:main-module-loaded');
console.debug('Solar Sentinel perf', {
  event: 'main-module-loaded',
  totalMs: Math.round(performance.now()),
});

document.addEventListener('DOMContentLoaded', () => {
  performance.mark('solar-sentinel:dom-content-loaded');
  console.debug('Solar Sentinel perf', {
    event: 'dom-content-loaded',
    totalMs: Math.round(performance.now()),
  });

  const app = new SolarSentinelApp();
  app.initialize().catch(console.error);
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    performance.mark('solar-sentinel:window-load');
    console.debug('Solar Sentinel perf', {
      event: 'window-load',
      totalMs: Math.round(performance.now()),
    });

    const registrationStart = performance.now();
    navigator.serviceWorker
      .register('/sw.js')
      .then(registration => {
        const registrationDuration = Math.round(performance.now() - registrationStart);
        console.log('SW registered: ', registration);
        console.debug('Solar Sentinel perf', {
          event: 'service-worker-registered',
          durationMs: registrationDuration,
        });
      })
      .catch(registrationError => {
        const registrationDuration = Math.round(performance.now() - registrationStart);
        console.log('SW registration failed: ', registrationError);
        console.debug('Solar Sentinel perf', {
          event: 'service-worker-registration-failed',
          durationMs: registrationDuration,
        });
      });
  });
}
