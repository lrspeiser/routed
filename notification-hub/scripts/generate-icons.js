#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

// Create a simple SVG icon
const svgIcon = `<?xml version="1.0" encoding="UTF-8"?>
<svg width="1024" height="1024" viewBox="0 0 1024 1024" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="200" fill="url(#grad)"/>
  <g transform="translate(512, 512)">
    <!-- Bell icon -->
    <path d="M -150 -100 C -150 -200, -100 -250, 0 -250 C 100 -250, 150 -200, 150 -100 L 150 50 L 200 100 L 200 150 L -200 150 L -200 100 L -150 50 Z" 
          fill="white" opacity="0.95"/>
    <!-- Bell clapper -->
    <circle cx="0" cy="200" r="50" fill="white" opacity="0.95"/>
    <!-- Notification dot -->
    <circle cx="120" cy="-120" r="40" fill="#ff6b6b"/>
  </g>
</svg>`;

// Create PNG placeholder (you'd normally use a tool like sharp or canvas to convert SVG to PNG)
const pngPlaceholder = Buffer.from([
  0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
  // ... minimal PNG data for a 1x1 pixel
]);

// Ensure assets directory exists
const assetsDir = path.join(__dirname, '..', 'assets');
if (!fs.existsSync(assetsDir)) {
  fs.mkdirSync(assetsDir, { recursive: true });
}

// Save SVG icon
fs.writeFileSync(path.join(assetsDir, 'icon.svg'), svgIcon);
console.log('✓ Created icon.svg');

// Create placeholder PNG files (these would normally be properly generated)
const sizes = [16, 32, 64, 128, 256, 512, 1024];
sizes.forEach(size => {
  // For now, just copy the SVG content as placeholder
  fs.writeFileSync(path.join(assetsDir, `icon-${size}.png`), svgIcon);
});

// Create main icon.png
fs.writeFileSync(path.join(assetsDir, 'icon.png'), svgIcon);
console.log('✓ Created icon.png');

// Create tray icon (smaller version)
fs.writeFileSync(path.join(assetsDir, 'tray-icon.png'), svgIcon);
console.log('✓ Created tray-icon.png');

// Note about ICNS file
console.log('\n📝 Note: To create icon.icns for macOS DMG, you need to:');
console.log('1. Install imagemagick: brew install imagemagick');
console.log('2. Convert SVG to PNG in multiple sizes');
console.log('3. Use iconutil to create ICNS file');
console.log('\nFor now, the build will work without it but won\'t have a custom icon.');
