const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    console.log('Launching Playwright browser...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    const page = await browser.newPage();

    // Set viewport for consistent screenshots
    await page.setViewportSize({ width: 1920, height: 1080 });

    console.log('Navigating to Solar Sentinel...');
    // Use host.docker.internal to access the host's localhost from container
    await page.goto('http://host.docker.internal:9890', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for the app to fully load
    console.log('Waiting for app to load...');
    await page.waitForTimeout(5000);

    // Take main screenshot
    console.log('Taking main screenshot...');
    await page.screenshot({
      path: '/screenshots/solar-sentinel-main.png',
      fullPage: true,
    });

    // Try to open debug panel and take another screenshot
    try {
      console.log('Opening debug panel...');
      await page.click('#debug-btn');
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: '/screenshots/solar-sentinel-debug.png',
        fullPage: true,
      });
      console.log('Debug panel screenshot taken');
    } catch (e) {
      console.log('Could not interact with debug panel:', e.message);
      await page.screenshot({
        path: '/screenshots/solar-sentinel-debug.png',
        fullPage: true,
      });
    }

    await browser.close();
    console.log('Screenshots saved to /screenshots/');
  } catch (error) {
    console.error('Error taking screenshot:', error);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
