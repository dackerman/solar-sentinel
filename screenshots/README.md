# Screenshot Generation System

## 🔧 How We Solved the Screenshot Challenge

### The Problem
Initially, we struggled with taking automated screenshots because:
- **Headless Chrome** required X11 display server (not available in SSH session)
- **Puppeteer** had browser binary mismatches and display errors
- **Virtual displays** (Xvfb) had permission and environment issues
- **Host Chrome** couldn't run headless due to missing display

### The Breakthrough Solution: Playwright + Docker

We solved this by using **Playwright in Docker containers**, which provides:
- ✅ **Pre-installed browsers** in the container (no binary issues)
- ✅ **Virtual display built-in** (no X11 setup needed)
- ✅ **Host network access** via `host.docker.internal`
- ✅ **Clean isolation** from host environment issues
- ✅ **Consistent results** across different environments

## 🏗️ Architecture

```
┌─────────────────────┐    ┌─────────────────────┐
│   Host Machine      │    │  Docker Container   │
│                     │    │                     │
│  Solar Sentinel     │    │  Playwright +       │
│  :49877             │◄───┤  Chromium           │
│                     │    │                     │
│  Screenshots/       │    │  screenshot-*.js    │
│  (volume mount)     │◄───┤  captures UI        │
└─────────────────────┘    └─────────────────────┘
```

### Key Components

1. **Base Image**: `mcr.microsoft.com/playwright:v1.55.0-jammy`
   - Includes Chromium, Firefox, and WebKit browsers
   - Has all required system dependencies
   - Runs on Ubuntu with proper font rendering

2. **Network Access**: `--add-host host.docker.internal:host-gateway`
   - Allows container to reach `http://localhost:49877` on host
   - No port forwarding needed

3. **Volume Mount**: `-v $(pwd):/screenshots`
   - Screenshots saved directly to host filesystem
   - Proper permissions maintained

4. **Viewport Configurations**:
   - **Desktop**: 1920x1080 (standard desktop)
   - **Mobile**: 390x844 (iPhone 13 Pro dimensions)

## 📱 Mobile Screenshot Innovation

The mobile screenshots use proper mobile context:
```javascript
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0...'
});
```

This triggers:
- Mobile-responsive CSS media queries
- Touch-optimized UI elements
- Proper mobile chart rendering
- Realistic mobile user experience

## 🚀 Usage

### Quick Start
```bash
cd screenshots/
./take-all-screenshots.sh
```

### Manual Commands
```bash
# Desktop screenshots
docker build -f Dockerfile.screenshot -t solar-sentinel-screenshot .
docker run --rm --add-host host.docker.internal:host-gateway \
  -v $(pwd):/screenshots solar-sentinel-screenshot

# Mobile screenshots  
docker build -f Dockerfile.mobile -t solar-sentinel-mobile .
docker run --rm --add-host host.docker.internal:host-gateway \
  -v $(pwd):/screenshots solar-sentinel-mobile
```

## 📸 What Gets Captured

### Desktop Screenshots (1920x1080)
- **solar-sentinel-main.png**: Full desktop interface
- **solar-sentinel-debug.png**: Desktop with debug panel open

### Mobile Screenshots (390x844)
- **solar-sentinel-mobile.png**: Mobile responsive interface
- **solar-sentinel-mobile-debug.png**: Mobile with debug panel

### Live Data Captured
- ✅ **Real weather data** from Open-Meteo API
- ✅ **Location caching status** (📍 pin indicates cached location)
- ✅ **Interactive charts** (UV index bars, weather lines)
- ✅ **Debug panel logs** (cache hits, API timing)
- ✅ **Current conditions** (temperature, UV, precipitation)

## 🔧 Technical Details

### Dockerfile Structure
```dockerfile
FROM mcr.microsoft.com/playwright:v1.55.0-jammy
WORKDIR /app
RUN mkdir -p /screenshots
RUN npm install playwright
COPY screenshot-*.js ./
CMD ["node", "screenshot-playwright.js"]
```

### JavaScript Automation
```javascript
const { chromium } = require('playwright');
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
await page.setViewportSize({ width: 1920, height: 1080 });
await page.goto('http://host.docker.internal:49877');
await page.screenshot({ path: '/screenshots/name.png', fullPage: true });
```

## 🛠️ Troubleshooting

### Common Issues

1. **"Cannot connect to host.docker.internal"**
   - Ensure `--add-host host.docker.internal:host-gateway` is used
   - Check Solar Sentinel is running on port 49877

2. **"Screenshots are empty/blank"**
   - Increase wait time with `await page.waitForTimeout(5000)`
   - Check console for JavaScript errors in the page

3. **"Permission denied on screenshot files"**
   - Files are created as root in container
   - Run `sudo chown $USER:$USER screenshots/*.png` after generation

4. **"Browser version mismatch"**
   - Use specific Playwright version in Dockerfile
   - Match Playwright npm package version with Docker image version

## 🎯 Why This Approach Works

1. **No X11 Dependencies**: Docker container handles display internally
2. **Consistent Environment**: Same browser/OS every time
3. **Network Isolation**: Clean separation between app and screenshot tool
4. **Volume Mounting**: Direct file access without complex copying
5. **Scalable**: Can add more viewports/devices easily

This system can capture screenshots of any web application running locally, making it perfect for documentation, testing, and design verification!
