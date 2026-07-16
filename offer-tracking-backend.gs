/**
 * Wiom — "हर कस्टमर को मिलता है अलग अलग ऑफर" in-app
 * CleverTap reporting proxy for offer-dashboard.html
 * =====================================================
 * Google Apps Script — deploy as Web App.
 *
 * WHY A PROXY: the browser cannot call CleverTap directly (CORS, and it would
 * expose the passcode to anyone who views source). The dashboard calls THIS
 * script; the credentials never leave the server.
 *
 * SETUP:
 * 1. sheets.new → Extensions > Apps Script → paste this file
 * 2. Fill CT_ACCOUNT_ID / CT_PASSCODE below (Settings → Project; use the server
 *    "Passcode", NOT the SDK Account Token)
 * 3. Fill CT_SHOWN_CAMPAIGNS with the campaign id(s) once the in-app is live
 * 4. Deploy > New deployment > Web app
 *      Execute as: Me
 *      Who has access: Anyone
 * 5. Copy the /exec URL → paste into offer-dashboard.html's endpoint box
 *
 * !! DO NOT COMMIT REAL CREDENTIALS — this repo is PUBLIC. Fill them in the
 *    deployed Apps Script only; leave the placeholders in git.
 */

var CT_ACCOUNT_ID = 'YOUR_CT_ACCOUNT_ID';   // CleverTap → Settings → Project
var CT_PASSCODE   = 'YOUR_CT_PASSCODE';     // server Passcode (keep secret)
var CT_REGION     = 'eu1';                  // WIOM account region

// Campaign id(s) of the offer-education in-app. Each is queried separately and
// SUMMED (the counts API can't OR two campaign_ids into one unique set), so a
// user who saw two campaigns is counted once per campaign. Add ids as you ramp.
var CT_SHOWN_CAMPAIGNS = ['PASTE_CAMPAIGN_ID_HERE'];

// Events fired by CT_offer_education_quiz.html
var EV_EDU_OK   = 'CSP_Offer_Education_OK_Clicked';
var EV_QUIZ_ANS = 'CSP_Offer_Quiz_Answered';
var EV_QUIZ_END = 'CSP_Offer_Quiz_Closed';

var LOOKBACK_DAYS = 60;
var CACHE_KEY     = 'offerCounts_v1';   // bump this whenever you change the shape below
var CACHE_SECS    = 3600;

/**
 * Unique users who fired `eventName`, optionally filtered by one event property.
 * CleverTap counts API is ASYNC: the POST returns a req_id, then you poll until
 * status:'success'. The req_id MUST go in the URL query — putting it in the body
 * silently starts a brand new query and you poll forever.
 * Returns `count` (unique users), not `tcount` (total occurrences).
 */
function ctUnique_(eventName, propName, propVal, op) {
  try {
    var u = 'https://' + CT_REGION + '.api.clevertap.com/1/counts/profiles.json';
    var h = { 'X-CleverTap-Account-Id': CT_ACCOUNT_ID, 'X-CleverTap-Passcode': CT_PASSCODE };
    var to   = parseInt(Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd'), 10);
    var from = parseInt(Utilities.formatDate(new Date(Date.now() - LOOKBACK_DAYS * 864e5), 'Asia/Kolkata', 'yyyyMMdd'), 10);
    var body = { event_name: eventName, from: from, to: to };
    if (propName && propVal != null) {
      body.event_properties = [{ name: propName, operator: op || 'equals', value: propVal }];
    }
    var a = UrlFetchApp.fetch(u, { method: 'post', contentType: 'application/json', headers: h,
      payload: JSON.stringify(body), muteHttpExceptions: true });
    var j = JSON.parse(a.getContentText());
    if (j.status === 'success' && j.count != null) return j.count;
    var rid = j.req_id;
    if (!rid) return 0;
    for (var i = 0; i < 12; i++) {
      Utilities.sleep(2000);
      var b = UrlFetchApp.fetch(u + '?req_id=' + rid, { method: 'post', contentType: 'application/json',
        headers: h, payload: JSON.stringify({}), muteHttpExceptions: true });
      var pj = JSON.parse(b.getContentText());
      if (pj.status === 'success' && pj.count != null) return pj.count;
    }
    return 0;
  } catch (e) { return 0; }
}

/** Sum unique inApp_Shown across every tracked campaign id. */
function ctShownAllCampaigns_() {
  var total = 0;
  for (var i = 0; i < CT_SHOWN_CAMPAIGNS.length; i++) {
    var id = CT_SHOWN_CAMPAIGNS[i];
    if (!id || id === 'PASTE_CAMPAIGN_ID_HERE') continue;
    total += ctUnique_('inApp_Shown', 'campaign_id', id, 'contains');
  }
  return total;
}

/**
 * Whole funnel in one object. ~7 counts queries on a cold call (each polls a few
 * seconds), so this is cached for an hour — only the first hit is slow.
 */
function getOfferCounts_() {
  var cache = CacheService.getScriptCache();
  var hit = cache.get(CACHE_KEY);
  if (hit) return JSON.parse(hit);

  var data = {
    shown:        ctShownAllCampaigns_(),
    eduOk:        ctUnique_(EV_EDU_OK),
    quizAnswered: ctUnique_(EV_QUIZ_ANS),
    quizClosed:   ctUnique_(EV_QUIZ_END),
    // which of the 3 wordings they tapped. All 3 are correct answers, so this is
    // a preference split, not a right/wrong score.
    opt1: ctUnique_(EV_QUIZ_ANS, 'option', 1),
    opt2: ctUnique_(EV_QUIZ_ANS, 'option', 2),
    opt3: ctUnique_(EV_QUIZ_ANS, 'option', 3),
    campaigns: CT_SHOWN_CAMPAIGNS,
    lookbackDays: LOOKBACK_DAYS,
    updated: new Date().toISOString()
  };
  cache.put(CACHE_KEY, JSON.stringify(data), CACHE_SECS);
  return data;
}

/** Force a fresh pull on the next dashboard load (run manually after a ramp). */
function clearOfferCache() {
  CacheService.getScriptCache().remove(CACHE_KEY);
  Logger.log('Cleared ' + CACHE_KEY);
}

/** Sanity-check creds + event names from the Apps Script editor. */
function testOfferCounts() {
  clearOfferCache();
  Logger.log(JSON.stringify(getOfferCounts_(), null, 2));
}

function doGet(e) {
  var p = e.parameter || {};
  if (p.nocache === '1') CacheService.getScriptCache().remove(CACHE_KEY);
  var json = JSON.stringify({ ct: getOfferCounts_() });
  if (p.callback) {
    return ContentService.createTextOutput(p.callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
