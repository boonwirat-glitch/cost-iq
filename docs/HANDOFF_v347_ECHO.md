# SESSION HANDOFF 2026-06-06 v347

## File SHAs
- src/09_conv_intel.js: 6156d5732562ed36
- src/06_portview_teamview.js: 324ab2340c1eeac0
- src/styles_main.css: 80604ee081afa850
- src/shell.html: 3c59253d23fd2d1e
- SW: freshket-sense-v347

## Done this session (v337-v347)

### Echo core
- portview dot 5 states: echo-recent (<=7d green glow) / echo-old (8-30d dim) / full / account / unseen
- ciq_echo_visits localStorage TTL 30d
- ci_sessions Supabase table for history
- Inline picker (no separate sheet), _showPicker flag
- Picker routing checks restaurant-sheet class
- Outlet-aware search: _buildOutletIndex() maps outlet_name -> account_id
- Picker hint Option C: truncate 220px, 11px, #6C6C70
- Portview outlet filter: no hint on card
- History tab in Echo sheet
- Profile label fixed 3 places (close L430, relabel() L2926, aria-label L2927)
- _topbarLeft() fixes _phase is not defined bug
- topbar z-index:200 fixes scroll bleed over rest-sheet-body (163)
- --tx3 raised #AEAEB2 to #6C6C70 (iOS secondaryLabel, contrast 5.91:1)
- Echo icon Pattern B: 5-11-6-14-17px, 4px wide, bottom-aligned, steps(2,end)

### AI pipeline (v344)
- _ctx() enriched: GMV, baseline, pace%, churn_count, missing_cats, account_class, is_new
- 80-word gate (_lastTranscriptWordCount)
- 2-pass Haiku parallel: 10 observable + 4 inference
- Account context in skill + intel prompts
- Short transcript warning banner

### DB verified
ci_sessions 12cols / kam_skill_log 11cols / kam_visits 11cols / all RLS on

## KEY: Skills rubric
14 skills = Sales original rubric. KAM borrows. No split needed.
APIPC A5 A9 A10 B2 B3 B4 C0 C1 C3 C4 C5 D1 D2

---

## NEXT SESSION: Sales Echo

### Decisions confirmed
1. Same rubric for all, no cold-visit framing
2. Orphan sessions must link account_name to account_id when lead converts
3. Sales TL (phii Tao) needs to see team visit history
4. Sales portfolio: upload sales list to BQ, Sales sees own accounts + leads via history
5. Skill trend: separate feature

### Patches to build
1. Remove if(_accountGuid) guard for kam_skill_log insert
2. _renderInlineHistory Sales mode: group by account_name not month
3. _buildSalesPickerInline: show recent accounts from ci_sessions
4. Account linking: orphan session to account_id when lead converts (SQL + migration)
5. Sales portfolio: new SQL from BQ (table TBD)
6. Sales TL view: ci_sessions filtered by team

### Open questions
- profiles.role of Sales TL (phii Tao)?
- BQ Sales list: table name + fields?
- Account linking: manual or auto-match?

---

## Build
Repo: github.com/boonwirat-glitch/cost-iq branch main
Deploy: Git Tree API ONLY (index.html >1MB)
Token: stored in password manager

## Architecture
- ciq_echo_visits: email::account_id -> {ts, count} TTL 30d
- bulkOutletsData: account_id -> month -> [{outlet_id, outlet_name, gmv}]
- getVisitDot(visitMap, accountId, echoMap)
- REPLACE overrides: renderTeamviewKamList, _commBuildPayoutSummary, exportCommissionSnapshotCsv, lockCommissionSnapshot
- CSS order: styles_main.css then styles_commission.css
