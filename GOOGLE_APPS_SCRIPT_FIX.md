# Google Apps Script Auto-Refresh Fix

## The Error

```
TypeError: Cannot read properties of null (reading 'getRange')
```

This means `getSheetByName("Sheet1")` is returning `null` because the sheet name doesn't match.

## Solution 1: Use Active Sheet (Recommended)

Replace the entire script with this version that doesn't rely on sheet names:

```javascript
function refreshPrices() {
  // Get the first sheet (or active sheet)
  var sheet = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];

  // Force recalculation by updating a timestamp cell
  // Using cell Z1 as a timestamp tracker
  sheet.getRange("Z1").setValue(new Date());

  // Log success
  Logger.log("Prices refreshed at: " + new Date());
}
```

## Solution 2: Check Sheet Name

If you want to use a specific sheet name, first verify what your sheet is actually called:

```javascript
function listSheetNames() {
  var sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  sheets.forEach(function(sheet) {
    Logger.log("Sheet name: " + sheet.getName());
  });
}
```

**To run this:**
1. Go to Extensions > Apps Script
2. Replace the code with the `listSheetNames` function above
3. Click "Run" (▶️)
4. Check the "Execution log" to see your sheet names
5. Update the original script with the correct name

## Solution 3: Auto-Detect Sheet Name

Use this robust version that works regardless of sheet name:

```javascript
function refreshPrices() {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  // Try to get "Sheet1" first, fallback to first sheet
  var sheet = spreadsheet.getSheetByName("Sheet1");

  if (!sheet) {
    // If Sheet1 doesn't exist, use the first sheet
    sheet = spreadsheet.getSheets()[0];
    Logger.log("Using sheet: " + sheet.getName());
  }

  // Force recalculation by updating a timestamp cell
  sheet.getRange("Z1").setValue(new Date());

  Logger.log("Prices refreshed at: " + new Date());
}
```

## Recommended Setup

I recommend **Solution 1** (Active Sheet) because:
- ✅ No dependency on sheet names
- ✅ Works even if you rename the sheet
- ✅ Simpler code
- ✅ Always works on the first/active sheet

## How to Update Your Script

1. **Go to your Google Sheet**
2. **Extensions > Apps Script**
3. **Delete the old code**
4. **Paste in Solution 1** (the Active Sheet version)
5. **Save** (Ctrl/Cmd + S)
6. **Test it:**
   - Click "Run" (▶️)
   - Check that cell Z1 updates with a timestamp
   - Check that your prices refresh

## Verify the Trigger is Still Set

After updating the script:

1. Click the **Clock icon** ⏰ (Triggers) on the left sidebar
2. Verify your trigger is still there:
   - Function: `refreshPrices`
   - Event source: Time-driven
   - Type: Hour timer
   - Hour interval: Every hour

If it's missing, recreate it:

1. Click **"+ Add Trigger"**
2. Choose function: `refreshPrices`
3. Event source: **Time-driven**
4. Type: **Hour timer**
5. Hour interval: **Every hour**
6. Click **Save**

## Understanding What This Does

The script updates cell Z1 with a timestamp. This forces Google Sheets to:
1. Recalculate all formulas (including GOOGLEFINANCE)
2. Fetch fresh stock prices
3. Update your sheet even when it's not open

**Note:** GOOGLEFINANCE formulas already auto-refresh during market hours, but this trigger ensures they refresh even when the sheet isn't viewed.

## Troubleshooting

**If you still get errors:**

1. Check the execution log:
   - Apps Script > Executions (left sidebar)
   - Look for error details

2. Test manually:
   - Click "Run" in Apps Script editor
   - See if it works or gives an error

3. Verify permissions:
   - First run may ask for permissions
   - Authorize the script to access your spreadsheet

4. Check your sheet:
   - Make sure you have at least one sheet
   - Check that the sheet has data in columns A-G

**Still having issues?** Run the `listSheetNames()` function (Solution 2) to see what your sheets are actually called.
