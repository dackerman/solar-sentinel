const puppeteer = require('puppeteer');

(async () => {
  let browser;
  try {
    console.log('Setting up virtual display...');
    process.env.DISPLAY = ':99';

    console.log('Launching browser...');
    browser = await puppeteer.launch({
      headless: false, // Try non-headless to see if it works better
      executablePath: '/home/david/bin/actual-google-chrome-stable',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--no-first-run',
        '--no-default-browser-check',
        '--disable-extensions',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-renderer-backgrounding',
        '--disable-features=TranslateUI',
        '--remote-debugging-port=9222',
      ],
    });

    const page = await browser.newPage();

    // Set viewport for consistent screenshots
    await page.setViewport({ width: 1920, height: 1080 });

    console.log('Navigating to Solar Sentinel...');
    await page.goto('http://localhost:9890', {
      waitUntil: 'domcontentloaded',
      timeout: 15000,
    });

    // Wait for the app to load
    console.log('Waiting for app to load...');
    await page.waitForTimeout(5000);

    // Take screenshot
    console.log('Taking screenshot...');
    await page.screenshot({
      path: 'solar-sentinel-screenshot.png',
      fullPage: false, // Just viewport
    });

    // Try to click debug button and take another screenshot
    try {
      console.log('Taking screenshot with debug panel...');
      await page.click('#debug-btn');
      await page.waitForTimeout(1000);
      await page.screenshot({
        path: 'solar-sentinel-debug-screenshot.png',
        fullPage: false,
      });
    } catch (e) {
      console.log('Could not click debug button, taking alternative screenshot...');
      await page.screenshot({
        path: 'solar-sentinel-debug-screenshot.png',
        fullPage: false,
      });
    }

    await browser.close();
    console.log('Screenshots saved:');
    console.log('- solar-sentinel-screenshot.png (normal view)');
    console.log('- solar-sentinel-debug-screenshot.png (with debug panel)');
  } catch (error) {
    console.error('Error taking screenshot:', error);
    if (browser) await browser.close();
    process.exit(1);
  }
})();
