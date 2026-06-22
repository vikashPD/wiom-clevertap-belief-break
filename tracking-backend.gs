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

/* ---- CleverTap server-side event push (region eu1) ----
 * Fill these from CleverTap → Settings → Project. The PASSCODE is the server
 * "Passcode" (NOT the SDK Account Token). Needed only for the server-side push
 * of bonus-video-played / quiz-completed-bonus-seva (bridge-independent).
 */
var CT_ACCOUNT_ID = 'YOUR_CT_ACCOUNT_ID';   // CleverTap → Settings → Project
var CT_PASSCODE   = 'YOUR_CT_PASSCODE';      // server Passcode (keep secret; do NOT commit real value to a public repo)
var CT_REGION     = 'eu1';

// Campaigns whose inApp_Shown counts roll up into the dashboard "Shown" number.
// Add/remove campaign ids here — each is queried separately and summed.
var CT_SHOWN_CAMPAIGNS = ['1781662006', '1781951938'];

// Unique users who did `eventName` (optionally filtered by an event property).
// CleverTap counts API is async: POST returns req_id, then poll until success.
function ctUnique_(eventName, propName, propVal) {
  try {
    var u = 'https://' + CT_REGION + '.api.clevertap.com/1/counts/profiles.json';
    var h = { 'X-CleverTap-Account-Id': CT_ACCOUNT_ID, 'X-CleverTap-Passcode': CT_PASSCODE };
    var to   = parseInt(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd'), 10);
    var from = parseInt(Utilities.formatDate(new Date(Date.now() - 60*864e5), 'Asia/Kolkata', 'yyyyMMdd'), 10);
    var body = { event_name: eventName, from: from, to: to };
    if (propName && propVal) body.event_properties = [{ name: propName, operator: 'contains', value: propVal }];
    var a = UrlFetchApp.fetch(u, { method:'post', contentType:'application/json', headers:h,
      payload: JSON.stringify(body), muteHttpExceptions:true });
    var j = JSON.parse(a.getContentText());
    if (j.status === 'success' && j.count != null) return j.count;
    var rid = j.req_id;
    if (!rid) return 0;
    for (var i = 0; i < 12; i++) {
      Utilities.sleep(2000);
      var b = UrlFetchApp.fetch(u + '?req_id=' + rid, { method:'post', contentType:'application/json', headers:h,
        payload: JSON.stringify({}), muteHttpExceptions:true });
      var pj = JSON.parse(b.getContentText());
      if (pj.status === 'success' && pj.count != null) return pj.count;
    }
    return 0;
  } catch (e) { return 0; }
}

// Sum unique inApp_Shown across all tracked campaigns. NOTE: this is a SUM of per-campaign
// uniques — a user who saw BOTH campaigns is counted once per campaign (slight over-count of
// true cross-campaign uniques). Acceptable for the dashboard "Shown" headline.
function ctShownAllCampaigns_() {
  var total = 0;
  for (var i = 0; i < CT_SHOWN_CAMPAIGNS.length; i++) {
    total += ctUnique_('inApp_Shown', 'campaign_id', CT_SHOWN_CAMPAIGNS[i]);
  }
  return total;
}

function getCtCounts_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get('ctCounts_v4');   // bumped key: now includes 2nd campaign
  if (hit) return JSON.parse(hit);
  var data = {
    shown:      ctShownAllCampaigns_(),
    completers: ctUnique_('quiz-completed-bonus-seva'),
    viewers:    ctUnique_('bonus-video-played'),
    campaigns:  CT_SHOWN_CAMPAIGNS,
    updated:    new Date().toISOString()
  };
  cache.put('ctCounts_v4', JSON.stringify(data), 3600);
  return data;
}

function ctPushEvent_(identity, evtName) {
  if (!identity) return;
  try {
    UrlFetchApp.fetch('https://' + CT_REGION + '.api.clevertap.com/1/upload', {
      method: 'post',
      contentType: 'application/json',
      headers: { 'X-CleverTap-Account-Id': CT_ACCOUNT_ID, 'X-CleverTap-Passcode': CT_PASSCODE },
      payload: JSON.stringify({ d: [ { identity: String(identity), type: 'event', evtName: evtName } ] }),
      muteHttpExceptions: true
    });
  } catch (err) {}
}

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
  var uid    = String(p.uid    || '').substring(0, 80);   // hashed token (sheet dedup)
  var id     = String(p.id     || '').substring(0, 120);  // raw CleverTap identity (server-side push)

  if (flow && screen) {
    var sh  = getSheet_();
    var now = new Date();
    sh.appendRow([
      now.toISOString(),
      flow,
      screen,
      Utilities.formatDate(now, 'Asia/Kolkata', 'yyyy-MM-dd'),
      parseInt(Utilities.formatDate(now, 'Asia/Kolkata', 'HH'), 10),
      uid
    ]);

    // Server-side CleverTap events for the BONUS video+quiz (no JS bridge needed).
    // Requires the in-app to send &id=<raw identity> (see bonus-quiz-video-serverside.html).
    if (flow === 'BONUS' && id) {
      if (screen === 'play') ctPushEvent_(id, 'bonus-video-played');
      else if (screen === 'right' || screen === 'wrong0' || screen === 'wrong2') ctPushEvent_(id, 'quiz-completed-bonus-seva');
    }
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
    sh.appendRow(['timestamp', 'flow', 'screen', 'date', 'hour', 'uid']);
    sh.setFrozenRows(1);
  }
  return sh;
}

function buildSummary_(fromDate, toDate) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(SHEET_NAME);
  var out = { summary: {}, total: 0, updated: new Date().toISOString() };
  out.ct = getCtCounts_();   // CleverTap unique-user counts (cached 1hr)
  var flows = ['A1','A2','A3','A4','A5','BONUS'];

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
