# Adding Daily Change Data to Google Sheets

Currently, the Google Sheets integration shows all changes as +0.0% because Google Sheets doesn't automatically track previous close prices. Here are solutions to add daily change tracking.

## Solution 1: Add Previous Close Column (Recommended)

Add a new column to store yesterday's closing prices, which gets auto-updated once per day.

### New Sheet Structure

| Column | Header | Description | Formula/Value |
|--------|--------|-------------|---------------|
| A | Yahoo Ticker | Primary identifier | `SHOP.TO` |
| B | Google Ticker | For GOOGLEFINANCE | `TSE:SHOP` |
| C | Currency | Native currency | `CAD` |
| D | Price | Current price | `=IFERROR(GOOGLEFINANCE(B2,"price"),"N/A")` |
| E | Price CAD | Current price in CAD | `=IFERROR(IF(C2="CAD",D2,D2*$F$2),"N/A")` |
| **G** | **Previous Close CAD** | **Yesterday's close in CAD** | `=IFERROR(GOOGLEFINANCE(B2,"closeyest")*IF(C2="USD",$F$2,1),"N/A")` |
| F | Name | Company name | `=IFERROR(GOOGLEFINANCE(B2,"name"),"")` |

### Google Finance Formula for Previous Close

For Canadian stocks (TSE):
```
=IFERROR(GOOGLEFINANCE(B2,"closeyest"),"N/A")
```

For US stocks (need currency conversion):
```
=IFERROR(GOOGLEFINANCE(B2,"closeyest")*$F$2,"N/A")
```

**Combined formula for column G (Previous Close CAD):**
```
=IFERROR(GOOGLEFINANCE(B2,"closeyest")*IF(C2="USD",$F$2,1),"N/A")
```

This formula:
- Gets yesterday's closing price from GOOGLEFINANCE
- Multiplies by USD/CAD rate (F2) if currency is USD
- Returns the value in CAD

### Example Row

```
A           B         C    D                                      E                                     G                                              F
XDIV.TO     TSE:XDIV  CAD  =IFERROR(GOOGLEFINANCE(B2,"price"))  =IFERROR(IF(C2="CAD",D2,D2*$F$2))    =IFERROR(GOOGLEFINANCE(B2,"closeyest"))       =IFERROR(GOOGLEFINANCE(B2,"name"))
GOOG        GOOG      USD  =IFERROR(GOOGLEFINANCE(B3,"price"))  =IFERROR(IF(C3="CAD",D3,D3*$F$2))    =IFERROR(GOOGLEFINANCE(B3,"closeyest")*$F$2)  =IFERROR(GOOGLEFINANCE(B3,"name"))
```

## Solution 2: Use GOOGLEFINANCE "change" and "changepct"

Alternatively, fetch the change directly from GOOGLEFINANCE:

### Additional Columns

| Column | Header | Formula |
|--------|--------|---------|
| H | Change $ | `=IFERROR(GOOGLEFINANCE(B2,"change")*IF(C2="USD",$F$2,1),"N/A")` |
| I | Change % | `=IFERROR(GOOGLEFINANCE(B2,"changepct"),"N/A")` |

## Updating the Code

Once you add column G (Previous Close CAD), update the code to read it:

### Modify `src/googleSheetsSource.ts`

Change the range from `Sheet1!A2:F` to `Sheet1!A2:G`:

```typescript
const response = await sheets.spreadsheets.values.get({
  spreadsheetId: SHEET_ID,
  range: 'Sheet1!A2:G', // Added column G
});
```

Update the row parsing:

```typescript
for (const row of rows) {
  const [yahooTicker, googleTicker, currency, price, priceCAD, name, previousCloseCAD] = row;

  // ... existing validation ...

  const priceValue = parseFloat(cleanedPrice);
  const previousClose = previousCloseCAD
    ? parseFloat(String(previousCloseCAD).replace(/[^0-9.-]/g, ''))
    : priceValue; // Fallback to current price if no previous close

  const quote: QuoteData = {
    price: priceValue,
    previousClose: previousClose,
    currency: 'CAD',
  };

  // ... rest of code ...
}
```

## Quick Setup Steps

1. **Add column G** to your Google Sheet with header "Previous Close CAD"

2. **Add the formula** to G2:
   ```
   =IFERROR(GOOGLEFINANCE(B2,"closeyest")*IF(C2="USD",$F$2,1),"N/A")
   ```

3. **Copy down** the formula to all rows

4. **Verify** the values look correct (should be similar to column E but from yesterday)

5. Let me know when ready and I'll update the code to use column G!

## Notes

- `closeyest` returns yesterday's closing price
- This updates automatically during market hours
- After-hours changes won't show until next market day
- Weekend data will show Friday's close vs current price

## Alternative: Manual Previous Close Update

If GOOGLEFINANCE("closeyest") doesn't work reliably, you can use a Google Apps Script to save today's closing prices at market close:

```javascript
function saveClosingPrices() {
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName("Sheet1");
  var lastRow = sheet.getLastRow();

  // Copy current prices (column E) to previous close (column G)
  var currentPrices = sheet.getRange("E2:E" + lastRow).getValues();
  sheet.getRange("G2:G" + lastRow).setValues(currentPrices);
}
```

**Trigger:** Set this to run daily at 4:30 PM ET (after market close).

This approach is more reliable but requires manual setup of the time-based trigger.
