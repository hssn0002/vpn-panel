#!/bin/bash
# VPN User Management Panel - Startup Script
# Run this on Ubuntu 22 to start the panel

echo "╔══════════════════════════════════════════╗"
echo "║   VPN User Management Panel v1.0        ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "⚠️ Node.js نصب نیست. در حال نصب..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs
fi

# Check for unzip (needed for restore)
if ! command -v unzip &> /dev/null; then
    sudo apt-get install -y unzip
fi

# Install dependencies
echo "📦 Installing dependencies..."
npm install --production

# Start the server
echo "🚀 Starting server..."
echo ""
echo "  Default admin panel: http://YOUR_IP:3000/panel_h"
echo "  Default password: 427726"
echo ""
node server.js
