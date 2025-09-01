const { chromium } = require('playwright');

(async () => {
  let browser;
  try {
    console.log('Launching Playwright browser for mobile screenshot...');
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage'],
    });

    // Create page with mobile context
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
    });

    const page = await context.newPage();

    console.log('Navigating to Solar Sentinel (mobile view)...');
    await page.goto('http://host.docker.internal:9890', {
      waitUntil: 'domcontentloaded',
      timeout: 30000,
    });

    // Wait for the app to fully load
    console.log('Waiting for mobile app to load...');
    await page.waitForTimeout(5000);

    // Take mobile screenshot
    console.log('Taking mobile screenshot...');
    await page.screenshot({
      path: '/screenshots/solar-sentinel-mobile.png',
      fullPage: true,
    });

    // Try to open debug panel and take another mobile screenshot
    try {
      console.log('Opening debug panel on mobile...');
      await page.click('#debug-btn');
      await page.waitForTimeout(2000);

      await page.screenshot({
        path: '/screenshots/solar-sentinel-mobile-debug.png',
        fullPage: true,
      });
      console.log('Mobile debug panel screenshot taken');
    } catch (e) {
      console.log('Could not interact with debug panel on mobile:', e.message);
    }

    await browser.close();
    console.log('Mobile screenshots saved to /screenshots/');
  } catch (error) {
    console.error('Error taking mobile screenshot:', error);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
