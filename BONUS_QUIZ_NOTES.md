# Bonus Video + Quiz In-App — Notes & RCA

CleverTap custom-HTML in-app: mandatory video (45s countdown) → quiz. Tracks via
pixel beacons to a Google Apps Script backend (`tracking-backend.gs`) which writes
to a Google Sheet and (optionally) pushes events into CleverTap.

## Files
| File | What it is |
|---|---|
| `bonus-quiz-video.html` | The **18-Jun-2026 build that produced 56 real completers**. Uses `{{ Profile.cspId }}`, hashed `uid`, and client-side `window.CleverTap.pushEvent`. |
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
