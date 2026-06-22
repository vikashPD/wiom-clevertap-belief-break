# Bonus Video + Quiz In-App — Notes & RCA

CleverTap custom-HTML in-app: mandatory video (45s countdown) → quiz. Tracks via
pixel beacons to a Google Apps Script backend (`tracking-backend.gs`) which writes
to a Google Sheet and (optionally) pushes events into CleverTap.

## ✅ CONFIRMED WORKING FIX (22-Jun-2026): retry pushEvent with back-off
`bonus-quiz-video.html` now contains the **confirmed-working** build. Root cause finally
identified: **`window.CleverTap` is present for real users, but it attaches a moment AFTER
page load** — so a single immediate `pushEvent` (and the old `ce_none` check) ran too early
and missed it. The fix is a small retry helper:

```js
function h(name){            // retry until the bridge is ready, max 6 tries
  if(p[name]) return;
  p[name]={sent:false,attempts:0};
  (function go(){
    var s=p[name];
    if(s.sent) return;
    try{ if(window.CleverTap && window.CleverTap.pushEvent){
      window.CleverTap.pushEvent(name); s.sent=true; w("ct-"+name); return;  // fires ct-<event> beacon on success
    }}catch(e){}
    s.attempts++; if(s.attempts<6) setTimeout(go, 250*s.attempts);  // back-off: 250,500,750…ms
  })();
}
```
- Called as `h("bonus-video-played")` (on play, +300ms) and `h("quiz-completed-bonus-seva")` (on answer).
- On success it also fires a **`ct-<event>` sheet beacon** (e.g. `ct-quiz-completed-bonus-seva`)
  so you can confirm from the sheet that the CT event actually went through.
- This means the **client-side path works** — server-side push is now only a backup, not required.

## Files
| File | What it is |
|---|---|
| `bonus-quiz-video.html` | **CONFIRMED-WORKING build (22-Jun)** — retry-with-back-off `pushEvent`, fires `ct-<event>` beacon on success. This is the canonical version. |
| `bonus-quiz-video-serverside.html` | Same UI, but events are raised **server-side** from the backend. Sends `uid` (hashed) + `id` (raw `{{Identity}}`). No client `pushEvent`. Works for real users regardless of the JS bridge. |
| `tracking-backend.gs` | Apps Script web app. Logs beacons to the `Events` sheet (cols: timestamp, flow, screen, date, hour, **uid**) and, for `flow=BONUS` with `&id=`, calls `ctPushEvent_` to raise CleverTap events. |
| `bonus-seva-quiz.html` | Old publicly-hosted page (fires its own beacons on every load — crawler/visitor traffic pollutes the sheet). Consider removing. |

## Events
- `bonus-video-played` — on video play
- `quiz-completed-bonus-seva` — on any quiz answer (right/wrong)
- Sheet beacons: `inform`, `play`, `quiz`, `right`, `wrong0`, `wrong2`

## RCA — why CT events stopped after 18-Jun
1. **The code is correct.** The 18-Jun build (`bonus-quiz-video.html`) fired `pushEvent`
   for ~56 real users → the CleverTap JS bridge **was** injected then.
2. **`window.CleverTap` is bridge-injected only when the campaign has "Include JavaScript"
   ON.** CleverTap **Test/Preview always injects it** regardless — so Preview is NOT a
   faithful test. After 18-Jun the campaign was modified/re-created and the bridge stopped
   being injected → real-device diagnostic returned `ce_none` (window.CleverTap absent) →
   `pushEvent` can't run → no events.
3. Size was **not** the cause (the 18-Jun in-app was ~8KB and worked fine).

## Two ways to get the events firing again
**A. Client-side (simplest)** — deploy `bonus-quiz-video.html` and make sure the campaign
   has **"Include JavaScript" ON** (don't recreate the campaign; reuse/match the 18-Jun one).
   Verify on a **real device**, not Preview.

**B. Server-side (bulletproof)** — deploy `bonus-quiz-video-serverside.html` + the
   `ctPushEvent_` hook in `tracking-backend.gs`. The backend raises the events from the
   beacons, so it works even if the bridge is absent. Requires:
   - `CT_ACCOUNT_ID` / `CT_PASSCODE` / `CT_REGION=eu1` set in `tracking-backend.gs`
   - `{{Identity}}` (or whatever field your app uses for CleverTap `onUserLogin`) sent as `&id=`
   - Redeploy the Apps Script: Manage deployments → Edit → New version → Deploy

## Identity macro
- Live 18-Jun campaign resolved `{{ Profile.cspId }}` → use that for the partner id.
- For the server-side push, `id` must equal the value CleverTap uses as the user
  **Identity** (so the Upload API attaches the event to the right profile).

## Counting uniques from the sheet (no CleverTap needed)
With the real/ hashed id in the `uid` column (col F):
- Shown:    `=COUNTUNIQUE(FILTER(F:F, C:C="inform", F:F<>"anon"))`
- Played:   `=COUNTUNIQUE(FILTER(F:F, C:C="play",   F:F<>"anon"))`
- Answered: `=COUNTUNIQUE(FILTER(F:F, REGEXMATCH(C:C,"right|wrong0|wrong2"), F:F<>"anon"))`
