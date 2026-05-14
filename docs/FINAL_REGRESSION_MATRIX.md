# Final Regression Matrix — Freshket Sense v155 Phase 21

Use this matrix for the final browser pass before treating Phase 21 as the stable post-refactor baseline.

## A. App shell / cache

| Area | Test | Expected |
|---|---|---|
| App shell | Open app URL after hard refresh | App loads normally |
| Service worker | Refresh once after deploy | New shell appears, no old cached UI |
| PWA/mobile viewport | Open in mobile-sized viewport | No horizontal breakage beyond existing behavior |

## B. Auth / session / splash

| Area | Test | Expected |
|---|---|---|
| Login | Login with valid user | Enters app |
| Relogin | Refresh while logged in | Session resumes |
| Splash | Login/relogin transition | Splash appears and exits normally |
| Sign out | Sign out then login again | Works without stuck state |

## C. Data loading

| Area | Test | Expected |
|---|---|---|
| Initial load | App foreground files load | Data pill appears then hides |
| Account data | Select/open an account | Account data renders |
| Background load | Wait after app opens | Heavy data does not block app |
| Data panel | Open data panel | File/status display remains readable |

## D. Restaurant mode

| Area | Test | Expected |
|---|---|---|
| Overview | Hero, trend bars, categories | Render normally |
| Trend bars | Tap different month | Selected month info updates |
| Category expand | Expand/collapse category list | Works |
| Swipe | Swipe between restaurant screens | Works |
| Portfolio/SKU | Search/filter/month pills | Works |
| SKU detail | Tap SKU/detail entry | Sheet opens/closes |
| Sense/Opportunities | Open opportunities screen | Does not blank/stick |
| Report | Select cost-saving items and open report | Summary/table render |

## E. KAM mode / Portfolio / Team

| Area | Test | Expected |
|---|---|---|
| KAM mode | Switch mode | KAM UI appears |
| KAM account | Month tabs / account overview | Render normally |
| Portfolio View | Open portfolio view | Summary/list render |
| Team View | Open team view | Summary/KAM list render |
| Drilldown | Drill into account and back | Navigation holds state |

## F. Navigation

| Area | Test | Expected |
|---|---|---|
| Bottom nav | Tap each nav item | Correct screen active |
| Home/portfolio button | Tap home/pอร์ต button | Goes to expected screen |
| KAM/Restaurant mode switch | Toggle modes | No blank screens |
| Olive panel overlay | Open/close Olive | Panel and overlay work |

## G. AI proxy / AI flows

| Area | Test | Expected |
|---|---|---|
| Proxy URL | `localStorage.getItem('freshket_ai_proxy_url')` | Returns Worker URL |
| Olive panel | Ask a simple question | AI responds |
| Account AI | Ask account-level question | Response returns without API/key errors |
| KAM insight | Trigger KAM AI insight | Runs or fails gracefully |
| Team/Portfolio AI | Trigger team/portfolio insight | Runs or fails gracefully |

## H. Known parked issue — Olive Chat quality

Do not block Phase 21 on these known issues unless they create operational risk:

- Chat too screen-scoped
- Thai language noise
- Answers too structured/long
- Weak cross-scope context routing
- Defensive drop/SKU-loss bias

These are parked for a later Olive Chat v2 redesign.
