/**
 * Trading Hours Manager for Google Sheets
 * Manages time-based triggers for Pacific timezone market hours (6:30 AM - 1:00 PM PT)
 *
 * Setup Instructions:
 * 1. Copy this entire script into your Google Sheet (Extensions > Apps Script)
 * 2. Run 'setupInitialTriggers()' once from the Apps Script editor
 * 3. Authorize the script when prompted
 *
 * The system will:
 * - Run hourly checks to detect market open
 * - Enable minute-level triggers during trading hours
 * - Automatically disable minute triggers after market close
 */

// ==================== CONFIGURATION ====================

const TIMEZONE = 'America/Los_Angeles';
const MARKET_OPEN_HOUR = 6;
const MARKET_OPEN_MINUTE = 30;
const MARKET_CLOSE_HOUR = 13; // 1:00 PM in 24-hour format
const MARKET_CLOSE_MINUTE = 0;

// ==================== MAIN FUNCTIONS ====================

/**
 * This function runs every hour to check if we should enable minute-level monitoring
 * It activates the minute trigger when market hours begin
 */
function hourlyMarketCheck() {
  const now = new Date();
  const pacificTime = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  console.log(`[Hourly Check] Running at ${pacificTime}`);

  if (isMarketDay(now)) {
    const currentHour = parseInt(Utilities.formatDate(now, TIMEZONE, 'HH'));
    const currentMinute = parseInt(Utilities.formatDate(now, TIMEZONE, 'mm'));

    // Check if we're within or approaching market hours
    // Enable minute trigger if we're at or after market open hour
    if (currentHour >= MARKET_OPEN_HOUR && currentHour < MARKET_CLOSE_HOUR) {
      console.log('[Hourly Check] Within market hours - ensuring minute trigger is active');
      ensureMinuteTriggerExists();
    } else if (currentHour === MARKET_CLOSE_HOUR && currentMinute === 0) {
      console.log('[Hourly Check] Market just closed - minute trigger will handle cleanup');
    } else {
      console.log('[Hourly Check] Outside market hours - ensuring minute trigger is disabled');
      removeMinuteTrigger();
    }
  } else {
    console.log('[Hourly Check] Not a market day - ensuring minute trigger is disabled');
    removeMinuteTrigger();
  }
}

/**
 * This function runs every minute during trading hours
 * It performs your trading-hour logic and checks if market has closed
 */
function minuteMarketUpdate() {
  const now = new Date();
  const pacificTime = Utilities.formatDate(now, TIMEZONE, 'yyyy-MM-dd HH:mm:ss');

  console.log(`[Minute Update] Running at ${pacificTime}`);

  // Check if we should still be running
  if (!isMarketDay(now) || isAfterMarketClose(now)) {
    console.log('[Minute Update] Market closed - disabling minute trigger');
    removeMinuteTrigger();
    return;
  }

  // Check if market hasn't opened yet
  if (isBeforeMarketOpen(now)) {
    console.log('[Minute Update] Before market open - skipping update');
    return;
  }

  // ========================================
  // YOUR TRADING HOURS LOGIC GOES HERE
  // ========================================

  // Example: Update a cell with current time
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
  sheet.getRange('A1').setValue('Last Update: ' + pacificTime);

  console.log('[Minute Update] Market data updated');
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Check if current time is a market day (Monday-Friday)
 */
function isMarketDay(date) {
  const dayOfWeek = parseInt(Utilities.formatDate(date, TIMEZONE, 'u')); // 1=Mon, 7=Sun
  return dayOfWeek >= 1 && dayOfWeek <= 5;
}

/**
 * Check if current time is before market open
 */
function isBeforeMarketOpen(date) {
  const currentHour = parseInt(Utilities.formatDate(date, TIMEZONE, 'HH'));
  const currentMinute = parseInt(Utilities.formatDate(date, TIMEZONE, 'mm'));

  if (currentHour < MARKET_OPEN_HOUR) return true;
  if (currentHour === MARKET_OPEN_HOUR && currentMinute < MARKET_OPEN_MINUTE) return true;
  return false;
}

/**
 * Check if current time is after market close
 */
function isAfterMarketClose(date) {
  const currentHour = parseInt(Utilities.formatDate(date, TIMEZONE, 'HH'));
  const currentMinute = parseInt(Utilities.formatDate(date, TIMEZONE, 'mm'));

  if (currentHour > MARKET_CLOSE_HOUR) return true;
  if (currentHour === MARKET_CLOSE_HOUR && currentMinute >= MARKET_CLOSE_MINUTE) return true;
  return false;
}

// ==================== TRIGGER MANAGEMENT ====================

/**
 * Creates the minute-level trigger if it doesn't already exist
 */
function ensureMinuteTriggerExists() {
  const triggers = ScriptApp.getProjectTriggers();

  // Check if minute trigger already exists
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'minuteMarketUpdate') {
      console.log('[Trigger] Minute trigger already exists');
      return;
    }
  }

  // Create new minute trigger
  ScriptApp.newTrigger('minuteMarketUpdate')
    .timeBased()
    .everyMinutes(1)
    .create();

  console.log('[Trigger] Minute trigger created');
}

/**
 * Removes the minute-level trigger
 */
function removeMinuteTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  let removed = false;

  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'minuteMarketUpdate') {
      ScriptApp.deleteTrigger(trigger);
      removed = true;
      console.log('[Trigger] Minute trigger removed');
    }
  }

  if (!removed) {
    console.log('[Trigger] No minute trigger to remove');
  }
}

/**
 * ONE-TIME SETUP: Run this function once to initialize the system
 * This creates the hourly trigger that monitors for market open/close
 */
function setupInitialTriggers() {
  // Remove any existing triggers to start fresh
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }

  // Create hourly trigger
  ScriptApp.newTrigger('hourlyMarketCheck')
    .timeBased()
    .everyHours(1)
    .create();

  console.log('[Setup] Hourly trigger created');

  // Run initial check to see if we should enable minute trigger now
  hourlyMarketCheck();

  SpreadsheetApp.getUi().alert(
    'Setup Complete!',
    'Trading hours monitoring is now active.\n\n' +
    '• Hourly checks will run automatically\n' +
    '• Minute updates will activate during market hours (6:30 AM - 1:00 PM PT)\n' +
    '• System will automatically manage triggers based on trading schedule',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}

/**
 * UTILITY: Manually remove all triggers (use for cleanup/debugging)
 */
function removeAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    ScriptApp.deleteTrigger(trigger);
  }
  console.log('[Cleanup] All triggers removed');
  SpreadsheetApp.getUi().alert('All triggers have been removed.');
}

/**
 * UTILITY: View current trigger status
 */
function checkTriggerStatus() {
  const triggers = ScriptApp.getProjectTriggers();
  let status = 'Current Triggers:\n\n';

  if (triggers.length === 0) {
    status += 'No triggers found.\n\nRun setupInitialTriggers() to initialize the system.';
  } else {
    for (const trigger of triggers) {
      status += `• ${trigger.getHandlerFunction()}\n`;
      status += `  Type: ${trigger.getEventType()}\n\n`;
    }
  }

  SpreadsheetApp.getUi().alert('Trigger Status', status, SpreadsheetApp.getUi().ButtonSet.OK);
}
