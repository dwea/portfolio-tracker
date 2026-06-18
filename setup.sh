#!/bin/bash

# Portfolio Tracker Setup Script
# This script helps you set up the portfolio tracker system

echo "======================================"
echo "Portfolio Tracker Setup"
echo "======================================"
echo ""

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    echo "❌ npm is not installed. Please install Node.js first:"
    echo "   https://nodejs.org/"
    exit 1
fi

echo "✓ npm is installed"

# Install dependencies
echo ""
echo "Installing dependencies..."
npm install

if [ $? -eq 0 ]; then
    echo "✓ Dependencies installed successfully"
else
    echo "❌ Failed to install dependencies"
    exit 1
fi

# Test the installation
echo ""
echo "Testing installation..."
npx tsx src/runner.ts 2>&1 | grep -q "Usage"

if [ $? -eq 0 ]; then
    echo "✓ Installation test passed"
else
    echo "❌ Installation test failed"
    exit 1
fi

# Get the current directory
CURRENT_DIR=$(pwd)

echo ""
echo "======================================"
echo "Setup Complete!"
echo "======================================"
echo ""
echo "Next steps:"
echo ""
echo "1. Edit your report configuration:"
echo "   nano reports/example-report.json"
echo ""
echo "2. Update the phone number (alertRecipients)"
echo "   Use format: [number]@msg.telus.com"
echo ""
echo "3. Test manually:"
echo "   npx tsx src/runner.ts \"Dave's Portfolio\""
echo ""
echo "4. Set up cron for automated scheduling:"
echo "   crontab -e"
echo ""
echo "   Add this line:"
echo "   */5 * * * * cd $CURRENT_DIR && /usr/local/bin/npx tsx src/runner.ts scheduled >> logs/cron.log 2>&1"
echo ""
echo "5. Grant Messages app permissions:"
echo "   System Settings → Privacy & Security → Automation"
echo "   Enable 'Terminal' or 'tsx' for Messages"
echo ""
echo "For more info, see README.md"
echo ""
