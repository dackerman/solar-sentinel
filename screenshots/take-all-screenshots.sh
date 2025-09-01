#!/usr/bin/env bash

# Solar Sentinel Screenshot Generation Script
# This script automates the process of taking screenshots of the Solar Sentinel UI
# using Playwright in Docker containers to avoid X11 display issues.

set -e  # Exit on any error

echo "🌞 Solar Sentinel Screenshot Generator"
echo "====================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Check if Solar Sentinel is running
print_status "Checking if Solar Sentinel is running..."
if ! curl -s http://localhost:9890 > /dev/null; then
    print_error "Solar Sentinel is not running at http://localhost:9890"
    echo "Please start it with: docker compose up -d"
    exit 1
fi
print_success "Solar Sentinel is running ✓"

# Check if Docker is available
print_status "Checking Docker availability..."
if ! command -v docker &> /dev/null; then
    print_error "Docker is not installed or not in PATH"
    exit 1
fi
print_success "Docker is available ✓"

# Change to screenshots directory
cd "$(dirname "$0")"
print_status "Working in: $(pwd)"

# Clean up old screenshots
print_status "Cleaning up old screenshots..."
rm -f solar-sentinel-*.png
print_success "Old screenshots removed"

echo ""
print_status "📸 Taking Desktop Screenshots (1920x1080)..."
echo "Building desktop screenshot container..."
docker build -f Dockerfile.screenshot -t solar-sentinel-screenshot . --quiet

echo "Capturing desktop screenshots..."
docker run --rm --add-host host.docker.internal:host-gateway \
  -v "$(pwd):/screenshots" solar-sentinel-screenshot

if [[ -f "solar-sentinel-main.png" && -f "solar-sentinel-debug.png" ]]; then
    print_success "Desktop screenshots captured ✓"
    echo "  - solar-sentinel-main.png ($(du -h solar-sentinel-main.png | cut -f1))"
    echo "  - solar-sentinel-debug.png ($(du -h solar-sentinel-debug.png | cut -f1))"
else
    print_error "Desktop screenshot generation failed"
fi

echo ""
print_status "📱 Taking Mobile Screenshots (390x844 - iPhone 13 Pro)..."
echo "Building mobile screenshot container..."
docker build -f Dockerfile.mobile -t solar-sentinel-mobile . --quiet

echo "Capturing mobile screenshots..."
docker run --rm --add-host host.docker.internal:host-gateway \
  -v "$(pwd):/screenshots" solar-sentinel-mobile

if [[ -f "solar-sentinel-mobile.png" && -f "solar-sentinel-mobile-debug.png" ]]; then
    print_success "Mobile screenshots captured ✓"
    echo "  - solar-sentinel-mobile.png ($(du -h solar-sentinel-mobile.png | cut -f1))"
    echo "  - solar-sentinel-mobile-debug.png ($(du -h solar-sentinel-mobile-debug.png | cut -f1))"
else
    print_error "Mobile screenshot generation failed"
fi

echo ""
print_status "🧹 Cleaning up Docker images..."
docker rmi solar-sentinel-screenshot solar-sentinel-mobile --force > /dev/null 2>&1 || true

echo ""
print_success "🎉 Screenshot generation complete!"
echo ""
echo "Generated Screenshots:"
echo "====================="
ls -lh solar-sentinel-*.png 2>/dev/null | while read -r line; do
    echo "  $line"
done

echo ""
print_status "💡 How this works:"
echo "  1. Playwright runs in Docker containers (avoids X11 display issues)"
echo "  2. Uses host.docker.internal:9890 to access Solar Sentinel"
echo "  3. Desktop container: 1920x1080 viewport with standard user agent"
echo "  4. Mobile container: 390x844 viewport with iPhone user agent"
echo "  5. Each container captures main view + debug panel view"
echo "  6. Screenshots saved with proper ownership and permissions"

echo ""
print_status "📂 Next steps:"
echo "  - Review screenshots in this directory"
echo "  - Commit to git if satisfied: git add . && git commit -m 'Update screenshots'"
echo "  - Push to GitHub: git push"