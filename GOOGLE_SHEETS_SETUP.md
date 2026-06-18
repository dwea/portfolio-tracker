# Google Sheets Data Source Setup

This document describes the Google Sheets alternative data source for stock prices (temporary workaround while Yahoo Finance API is experiencing issues).

## Overview

- **Primary data source**: Yahoo Finance API (preferred, currently having issues)
- **Backup data source**: Google Sheets with GOOGLEFINANCE() formulas
- **Implementation status**: Planned - will allow switching between data sources via command-line flag

## Google Sheet Structure

**Sheet URL**: https://docs.google.com/spreadsheets/d/1gMBYW-78Nkr7QdO9qUPGvPfrvsNfXTfhW66KU0x9DAA/edit?usp=sharing

**Permissions**: Anyone with the link can view

### Columns

| Column | Header | Description | Example Value |
|--------|--------|-------------|---------------|
| A | Yahoo Ticker | Primary identifier (lookup key) | `SHOP.TO` |
| B | Google Ticker | For GOOGLEFINANCE formula | `TSE:SHOP` |
| C | Currency | Native currency (CAD or USD) | `CAD` |
| D | Price | Current price in native currency | `=IFERROR(GOOGLEFINANCE(B2,"price"),"N/A")` |
| E | Price CAD | Converted to CAD | `=IFERROR(IF(C2="CAD",D2,D2*$F$2),"N/A")` |
| F | Name | Company name (optional) | `=IFERROR(GOOGLEFINANCE(B2,"name"),"")` |

### Exchange Rate Helper
- **Cell F1**: Label "USD/CAD Rate"
- **Cell F2**: `=GOOGLEFINANCE("CURRENCY:USDCAD")`

### Sample Data

```
Yahoo Ticker | Google Ticker | Currency | Price Formula                              | Price CAD Formula
-------------|---------------|----------|-------------------------------------------|----------------------------------
XDIV.TO      | TSE:XDIV      | CAD      | =IFERROR(GOOGLEFINANCE(B2,"price"),"N/A") | =IFERROR(IF(C2="CAD",D2,D2*$F$2),"N/A")
CASH.TO      | TSE:CASH      | CAD      | =IFERROR(GOOGLEFINANCE(B3,"price"),"N/A") | =IFERROR(IF(C3="CAD",D3,D3*$F$2),"N/A")
GOOG         | GOOG          | USD      | =IFERROR(GOOGLEFINANCE(B4,"price"),"N/A") | =IFERROR(IF(C4="CAD",D4,D4*$F$2),"N/A")
AAPL         | AAPL          | USD      | =IFERROR(GOOGLEFINANCE(B5,"price"),"N/A") | =IFERROR(IF(C5="CAD",D5,D5*$F$2),"N/A")
```

## Complete Ticker List

All tickers from the portfolio configuration:

```
XDIV.TO	TSE:XDIV	CAD
CASH.TO	TSE:CASH	CAD
XEU.TO	TSE:XEU	CAD
CIF.TO	TSE:CIF	CAD
GOOG	GOOG	USD
VE.TO	TSE:VE	CAD
XSP.TO	TSE:XSP	CAD
AAPL	AAPL	USD
NVDA	NVDA	USD
XEI.TO	TSE:XEI	CAD
PICK	PICK	USD
IAU	IAU	USD
EQL-F.TO	TSE:EQL-F	CAD
```

## Google Finance Ticker Formats

### Toronto Stock Exchange (TSE)
- Format: `TSE:TICKER` or `TSX:TICKER`
- Example: `TSE:SHOP`, `TSE:RY`, `TSE:TD`
- Prices automatically in CAD

### US Stocks
- Format: `TICKER` (no prefix needed)
- Example: `AAPL`, `GOOG`, `NVDA`
- Prices in USD, converted to CAD using exchange rate

### Currency Conversion
- USD to CAD: `=GOOGLEFINANCE("CURRENCY:USDCAD")`
- All portfolio values stored in CAD

## Auto-Refresh Setup

### Google Apps Script Time-Based Trigger

**Script** (Extensions > Apps Script):
```javascript
function refreshPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1");

  // Force recalculation by updating a timestamp cell
  sheet.getRange("Z1").setValue(new Date());
}
```

**Trigger Configuration**:
1. Go to: Extensions > Apps Script > Triggers
2. Add trigger:
   - Function: `refreshPrices`
   - Event source: Time-driven
   - Type: Hour timer
   - Hour interval: Every hour
3. Save

**Important Notes**:
- ✅ Script runs **server-side** - no need to keep browser open
- ✅ Works even when computer is off
- ✅ Runs automatically on Google's servers
- ✅ GOOGLEFINANCE formulas auto-refresh during market hours anyway
- ✅ Time-based trigger ensures refresh even when sheet not viewed

### Verification
- Check execution history: Apps Script > Executions
- Enable failure notifications: Triggers > 3-dot menu > Notifications

## Implementation Plan (Future)

### Command-Line Flag
```bash
# Use Yahoo Finance (default)
npx tsx src/runner.ts "Dave's Portfolio"

# Use Google Sheets
npx tsx src/runner.ts "Dave's Portfolio" --source=google

# Or environment variable
PRICE_SOURCE=google npx tsx src/runner.ts "Dave's Portfolio"
```

### Code Changes Required

1. **Add data source abstraction layer** in `calculator.ts`:
   - Create interface `PriceDataSource`
   - Implement `YahooFinanceSource` (existing code)
   - Implement `GoogleSheetsSource` (new - reads from Google Sheets API)

2. **Google Sheets API integration**:
   - Install: `npm install googleapis`
   - Read data from Sheet URL
   - Use Yahoo ticker (Column A) as lookup key
   - Return Price CAD (Column E) as the quote value

3. **Minimal code changes**:
   - Keep existing Yahoo Finance code
   - Add command-line argument parser
   - Switch data source based on flag
   - Easy to switch back to Yahoo when API stabilizes

### Benefits of This Approach

- **Yahoo ticker as primary key**: Consistent with existing code
- **Google ticker translation**: Handled in the sheet
- **CAD conversion**: Done in the sheet
- **Easy migration**: Just flip a flag to switch back to Yahoo
- **No portfolio config changes**: Yahoo tickers stay the same
- **Transparent to reports**: Calculator returns prices the same way

## API Access Setup (When Implementing)

### Google Sheets API
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create new project
3. Enable Google Sheets API
4. Create credentials:
   - **Option A**: API Key (simpler, for read-only public sheets)
   - **Option B**: Service Account (more secure)
5. Store credentials securely (not in git)

### Environment Variables
```bash
# .env file (add to .gitignore)
GOOGLE_SHEETS_API_KEY=your-api-key
GOOGLE_SHEETS_SHEET_ID=1gMBYW-78Nkr7QdO9qUPGvPfrvsNfXTfhW66KU0x9DAA
```

## Notes

- **EQL-F.TO**: Ticker with hyphen - may need testing in GOOGLEFINANCE
- **All values in CAD**: Sheet handles USD→CAD conversion automatically
- **Real-time updates**: GOOGLEFINANCE refreshes during market hours
- **Fallback ready**: Can switch back to Yahoo Finance anytime
