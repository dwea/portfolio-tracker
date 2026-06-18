# Google Sheets API Setup Guide

This guide walks you through setting up Google Sheets API access for the portfolio tracker.

## Prerequisites

- Google account
- Google Sheet with stock prices (see GOOGLE_SHEETS_SETUP.md)

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Name your project (e.g., "Portfolio Tracker")
4. Click "Create"

## Step 2: Enable Google Sheets API

1. In the Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Sheets API"
3. Click on "Google Sheets API"
4. Click "Enable"

## Step 3: Create API Credentials

### Option A: API Key (Recommended for Public Sheets)

This is simpler and works well for read-only access to public sheets.

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "API key"
3. Copy the API key (looks like: `AIzaSyA...`)
4. (Optional) Click "Restrict Key" to add restrictions:
   - Application restrictions: None
   - API restrictions: Restrict key → Google Sheets API

### Option B: Service Account (For Private Sheets)

More secure for private sheets, but requires sharing the sheet with the service account.

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "Service Account"
3. Fill in details and click "Create and Continue"
4. Skip the optional steps and click "Done"
5. Click on the service account email
6. Go to "Keys" tab → "Add Key" → "Create new key" → JSON
7. Download the JSON file (keep it secure!)
8. Share your Google Sheet with the service account email (found in the JSON file)

## Step 4: Configure Your Local Environment

1. Copy the example environment file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and add your credentials:

   **If using API Key:**
   ```bash
   GOOGLE_SHEETS_API_KEY=AIzaSyA...your-api-key-here
   GOOGLE_SHEETS_SHEET_ID=1gMBYW-78Nkr7QdO9qUPGvPfrvsNfXTfhW66KU0x9DAA
   PRICE_SOURCE=google
   ```

   **If using Service Account:**
   - Save the JSON file as `google-credentials.json` in your project root
   - Update the code to use service account (see below)

3. Make sure `.env` is in `.gitignore` (already configured)

## Step 5: Test the Connection

Run a test to make sure everything works:

```bash
npx tsx src/runner.ts "Daves_report" test --source=google
```

You should see:
```
Data source set to: google
[GOOGLE SHEETS] Fetching quotes...
✓ XDIV.TO: $37.72 CAD
✓ CASH.TO: $50.15 CAD
...
```

## Troubleshooting

### Error: "Google Sheets API has not been used"
- Go back to Cloud Console → APIs & Services → Library
- Make sure Google Sheets API is enabled

### Error: "The caller does not have permission"
- Make sure your API key has the correct restrictions
- If using service account, make sure the sheet is shared with the service account email

### Error: "GOOGLE_SHEETS_API_KEY not set"
- Check that your `.env` file exists
- Check that the API key is set correctly (no quotes needed)
- Make sure you're running from the project root directory

### No data returned
- Check that your Google Sheet is publicly viewable (if using API key)
- Verify the SHEET_ID in your `.env` file matches your Google Sheet URL
- Make sure the sheet has data in columns A-F starting from row 2

## Security Best Practices

1. **Never commit `.env` to git** (already in `.gitignore`)
2. **Restrict your API key** to only Google Sheets API
3. **Use API key for public sheets**, service account for private sheets
4. **Rotate keys regularly** if you suspect they've been exposed
5. **Use environment variables** for production deployments

## Switching Between Data Sources

You can easily switch between Yahoo Finance and Google Sheets:

```bash
# Use Yahoo Finance (default)
npx tsx src/runner.ts "Daves_report"

# Use Google Sheets
npx tsx src/runner.ts "Daves_report" --source=google

# Use environment variable
PRICE_SOURCE=google npx tsx src/runner.ts "Daves_report"

# Edit .env to make Google Sheets default
echo "PRICE_SOURCE=google" >> .env
```

## Cost

- Google Sheets API: **Free tier** provides 100 requests per 100 seconds per user
- For this portfolio tracker: ~1 request per report (all prices fetched at once)
- More than enough for personal use

## Support

If you encounter issues:
1. Check the [Google Sheets API documentation](https://developers.google.com/sheets/api)
2. Verify your quotas in Cloud Console → APIs & Services → Dashboard
3. Check the logs in `logs/reports.log`
