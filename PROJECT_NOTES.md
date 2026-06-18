# Portfolio Tracker - Project Notes

## Overview
A web-based portfolio tracking system that monitors stock positions and provides real-time updates on portfolio performance.

## Server Configuration

### Hosting Details
- **Server Location**: Mac mini on local network
- **IP Address**: 192.168.1.218
- **Port**: 3000
- **Access URL**: http://192.168.1.218:3000
- **Project Directory**: /Users/davestudio/portfolio-tracker

### Process Management
- **Process Manager**: PM2
- **Service Name**: portfolio-tracker
- **Auto-start**: Enabled (configured to start on Mac mini reboot)
- **Main Server File**: server.js

### PM2 Commands
```bash
pm2 status                          # Check server status
pm2 logs portfolio-tracker          # View server logs
pm2 restart portfolio-tracker       # Restart the server
pm2 stop portfolio-tracker          # Stop the server
pm2 start portfolio-tracker         # Start the server
pm2 save                            # Save current PM2 process list
```

## Project Structure

### Key Files
- `server.js` - Main Express server
- `public/index.html` - Main dashboard page
- `public/portfolio.html` - Portfolio details page
- `public/styles.css` - Shared styles
- `package.json` - Node.js dependencies

### Data Files
- `data/portfolio.csv` - Portfolio positions data
  - Format: Symbol, Quantity, Avg Cost, Current Price
  - Example: AAPL,100,150.00,175.50

## Features

### Dashboard (index.html)
- Total portfolio value display
- Total gain/loss calculation
- Percentage gain/loss
- Real-time stock price updates
- Top gainers and losers
- Sector allocation chart

### Portfolio Page (portfolio.html)
- Detailed position-by-position breakdown
- Individual stock gains/losses
- Current market values
- Price change indicators
- Sortable columns

## API Endpoints

### GET /api/portfolio
Returns complete portfolio data including:
- All positions with current prices
- Total portfolio value
- Total gain/loss
- Individual position metrics

Response format:
```json
{
  "positions": [...],
  "totalValue": 12345.67,
  "totalGain": 1234.56,
  "totalGainPercent": 10.5
}
```

## Setup Instructions (for reference)

### Initial Setup
1. Install dependencies: `npm install`
2. Ensure `data/portfolio.csv` exists with position data
3. Start server: `node server.js`

### Production Setup (Already Completed)
1. Install PM2: `sudo npm install -g pm2`
2. Start with PM2: `pm2 start server.js --name portfolio-tracker`
3. Configure auto-start: `pm2 startup` (follow provided command)
4. Save configuration: `pm2 save`

## Notes
- Server accessible from any device on the local network
- Mac mini must remain powered on for server availability
- PM2 ensures server restarts automatically after Mac mini reboots
- Stock price updates happen in real-time via API calls from the browser
