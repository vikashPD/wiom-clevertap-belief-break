/**
 * Wiom Belief Break – Pixel Tracking Backend
 * ============================================
 * Google Apps Script — deploy as Web App
 *
 * SETUP:
 * 1. Create a new Google Sheet (go to sheets.new)
 * 2. Go to Extensions > Apps Script
 * 3. Delete default code, paste this entire file
 * 4. Click Deploy > New deployment
 *    - Type: Web app
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Authorize when prompted
 * 6. Copy the deployment URL
 * 7. Replace PASTE_TRACKING_URL_HERE in all 5 HTML templates with that URL
 * 8. Paste the same URL into the Dashboard page
 */

var SHEET_NAME = 'Events';

function doGet(e) {
  var p = e.parameter || {};

  // Dashboard data request
  if (p.action === 'data') {
    var json = buildSummary_(p.from || '', p.to || '');
    // JSONP support for cross-origin dashboard
    if (p.callback) {
      return ContentService.createTextOutput(p.callback + '(' + json + ')')
        .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }
    return ContentService.createTextOutput(json)
      .setMimeType(ContentService.MimeType.JSON);
  }

  // Pixel tracking hit
  var flow   = String(p.flow   || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 10);
  var screen = String(p.screen || '').replace(/[^A-Za-z0-9_-]/g, '').substring(0, 20);

  if (flow && screen) {
    var sh  = getSheet_();
    var now = new Date();
    sh.appendRow([
      now.toISOString(),
      flow,
      screen,
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'),
      parseInt(Utilities.formatDate(now, 'Asia/Kolkata', 'HH'), 10)
    ]);
  }

  // Return minimal response (background-image request doesn't need valid image)
  return ContentService.createTextOutput('ok');
}

/* ---- maintenance helpers (run manually from Apps Script editor) ---- */

/**
 * Wipe all event rows, keep the header. Run before going live to clear test hits.
 * In the Apps Script editor: select `resetSheet` from the function dropdown, click Run.
 */
function resetSheet() {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh) return;
  var last = sh.getLastRow();
  if (last < 2) return;
  sh.deleteRows(2, last - 1);
  Logger.log('Cleared ' + (last - 1) + ' rows from ' + SHEET_NAME);
}

/**
 * Delete only rows matching a flow + screen pair. Useful for surgical cleanup
 * of a single bad test hit without wiping everything.
 *   deleteHits('A1', 'inform')  → removes every A1.inform row
 */
function deleteHits(flow, screen) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return;
  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  var removed = 0;
  for (var r = rows.length - 1; r >= 0; r--) {
    if (rows[r][1] === flow && rows[r][2] === screen) {
      sh.deleteRow(r + 2);
      removed++;
    }
  }
  Logger.log('Removed ' + removed + ' rows for ' + flow + '.' + screen);
}

/* ---- internal helpers ---- */

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(['timestamp', 'flow', 'screen', 'date', 'hour']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function buildSummary_(fromDate, toDate) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var out = { summary: {}, total: 0, updated: new Date().toISOString() };
  var flows = ['A1','A2','A3','A4','A5'];

  for (var i = 0; i < flows.length; i++) {
    out.summary[flows[i]] = { inform: 0, quiz: 0, correct: 0, wrong: 0 };
  }

  if (!sh || sh.getLastRow() < 2) return JSON.stringify(out);

  var rows = sh.getRange(2, 1, sh.getLastRow() - 1, 5).getValues();
  out.total = rows.length;

  for (var r = 0; r < rows.length; r++) {
    var flow   = rows[r][1];
    var screen = rows[r][2];
    var date   = rows[r][3];
    if (fromDate && date < fromDate) continue;
    if (toDate   && date > toDate)   continue;
    if (!out.summary[flow]) continue;

    if      (screen === 'inform')                       out.summary[flow].inform++;
    else if (screen === 'quiz')                         out.summary[flow].quiz++;
    else if (screen === 'right')                        out.summary[flow].correct++;
    else if (screen === 'wrong0' || screen === 'wrong2') out.summary[flow].wrong++;
  }

  return JSON.stringify(out);
}
