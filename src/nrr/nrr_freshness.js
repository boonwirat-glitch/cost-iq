// ── nrr_freshness.js — long-lived-tab freshness signals (v_freshtab) ────
// Bush's habit: leaves /nrr open in a browser tab for hours/days. Two
// things can change underneath an open tab with zero visible signal today:
// (1) a new build gets deployed (push to main -> Cloudflare Pages
// auto-deploy), (2) the underlying R2 CSV data refreshes (~daily, external
// pipeline). This module is the whole fix:
//   (a) a toast primitive (nrrToast — previously dead code; nrr_waivers.js
//       already has a `typeof nrrToast === 'function'` guard written for
//       exactly this, so that call site now works with zero changes there)
//   (b) a Sense-style "new version, click to reload" pill — per Bush's
//       explicit steer, modeled on Sense's own #sense-update-pill UX
//       (persistent, dismissible, click-to-act), NOT a silent swap
//   (c)+(d) a generalized version of nrr_pulse.js's own proven 10-min
//       force-refetch pattern, applied to the main dashboard, with a cheap
//       change-fingerprint so the toast only fires on a real change.
// /nrr has no service worker by deliberate design (see build_nrr.py's own
// header comment) — everything here is plain polling + plain
// location.reload(), no SW coordination involved.

// ── (a) Toast primitive ──────────────────────────────────────────────────
// Structurally mirrors Sense's showToast() (01_core.js: lazy-create-once
// element, .show class toggle, 2200ms auto-dismiss) but its own element/id,
// styled with /nrr's OWN Fresh Canvas tokens (nrr_tokens.css) — never
// Sense's dark/navy palette, per the existing nrr/Sense design-system split.
var _nrrToastTimer = null;
function nrrToast(msg, icon) {
  icon = icon || '✓';
  var t = document.getElementById('nrr-toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'nrr-toast';
    document.body.appendChild(t);
  }
  t.textContent = icon + ' ' + msg;
  t.classList.add('show');
  clearTimeout(_nrrToastTimer);
  _nrrToastTimer = setTimeout(function () { t.classList.remove('show'); }, 2200);
}
window.nrrToast = nrrToast;

// ── (b) New-version pill ─────────────────────────────────────────────────
// window.NRR_BUILD is injected at build time (build_nrr.py -> shell_nrr.html).
var NRR_BUILD_CHECK_MS = 20 * 60 * 1000; // matches Sense's own SW-update-check cadence (shell.html)
var _nrrBuildCheckInFlight = false;

function _nrrShowBuildPill() {
  try {
    if (document.getElementById('nrr-update-pill')) return;
    if (sessionStorage.getItem('nrr_build_pill_dismissed') === '1') return;
    var p = document.createElement('div');
    p.id = 'nrr-update-pill';
    p.innerHTML = '<span id="nrr-update-pill-txt">มีเวอร์ชันใหม่ · กดเพื่อรีเฟรช</span>' +
      '<button type="button" id="nrr-update-pill-x" aria-label="ปิด">✕</button>';
    p.addEventListener('click', function (ev) {
      if (ev.target && ev.target.id === 'nrr-update-pill-x') {
        ev.stopPropagation();
        try { sessionStorage.setItem('nrr_build_pill_dismissed', '1'); } catch (e) {}
        p.remove();
        return;
      }
      var txt = document.getElementById('nrr-update-pill-txt');
      if (txt) txt.textContent = 'กำลังโหลด...';
      location.reload();
    });
    document.body.appendChild(p);
  } catch (e) {}
}

// Fetches the live /nrr page (cache-busted), regexes out its embedded build
// id, compares to this tab's own window.NRR_BUILD. A full-page fetch is
// cheap here — no CSV/R2 data involved, same "fetch whole HTML, regex a
// version token" pattern Sense's own checkRemoteBuild already uses.
function _nrrCheckRemoteBuild() {
  if (_nrrBuildCheckInFlight) return;
  _nrrBuildCheckInFlight = true;
  fetch('/nrr?cb=' + Date.now(), { cache: 'no-store' })
    .then(function (res) { return res.ok ? res.text() : null; })
    .then(function (html) {
      if (!html || !window.NRR_BUILD) return;
      var m = /window\.NRR_BUILD\s*=\s*'([^']+)'/.exec(html);
      if (m && m[1] && m[1] !== window.NRR_BUILD) _nrrShowBuildPill();
    })
    .catch(function () {})
    .finally(function () { _nrrBuildCheckInFlight = false; });
}
setInterval(_nrrCheckRemoteBuild, NRR_BUILD_CHECK_MS);
document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'visible') _nrrCheckRemoteBuild();
});

// ── (c)+(d) Generic dashboard background refresh ─────────────────────────
// Generalizes nrr_pulse.js's own proven pattern (_nrrPulseArmTimers,
// NRR_PULSE_REFRESH_MS = 10 min force-refetch) to the main dashboard.
// Pulse keeps its own independent timer (kiosk view, different cadence
// need) — this one is suppressed while on #/pulse so the two never
// double-fetch the same R2 objects.
var NRR_REFRESH_POLL_MS = 15 * 60 * 1000; // same reasoning/number as Sense's own interval poll (02_data_pipeline.js)
var NRR_HIDDEN_MIN_MS = 2 * 60 * 1000;    // mirrors Sense's ≥2-min resume-gap convention
var _nrrHiddenSince = null;

function _nrrIsSlideoverOpen() {
  try {
    var so = document.getElementById('nrr-slideover');
    var ot = document.getElementById('nrr-otip');
    return !!((so && so.classList.contains('on')) || (ot && ot.classList.contains('on')));
  } catch (e) { return false; }
}

function _nrrShouldSkipGenericRefresh() {
  if (!nrrCurrentRoute || nrrCurrentRoute.view === 'pulse') return true; // Pulse owns its own 10-min timer
  if (document.visibilityState !== 'visible') return true;
  // Bush's explicit answer: don't disturb an open detail view — skip this
  // cycle and just retry next time, rather than yanking data underneath it.
  if (_nrrIsSlideoverOpen()) return true;
  return false;
}

// Cheap heuristic (row count + summed curr_gmv across bulkQnrrData.allRows),
// not a true content hash — a new day's CSV will near-certainly change one
// or the other. Good enough for "don't toast when nothing changed"; a
// same-day re-publish whose row edits happen to cancel out in the sum would
// be the one missed case, judged not worth threading the raw CSV text out
// of nrrFetchQnrrCsv for a stronger hash.
function _nrrDataFingerprint() {
  try {
    var rows = window.bulkQnrrData && window.bulkQnrrData.allRows;
    if (!rows || !rows.length) return null;
    var sum = 0;
    for (var i = 0; i < rows.length; i++) sum += rows[i].curr_gmv || 0;
    return rows.length + ':' + Math.round(sum);
  } catch (e) { return null; }
}

function _nrrBackgroundRefresh(reason) {
  if (typeof nrrRefresh !== 'function') return;
  var before = _nrrDataFingerprint();
  nrrRefresh(true).then(function () {
    var after = _nrrDataFingerprint();
    if (before !== null && after !== null && after !== before) nrrToast('ข้อมูลอัปเดตแล้ว', '✓');
  });
}

function _nrrArmGenericRefreshTimer() {
  setInterval(function () {
    if (_nrrShouldSkipGenericRefresh()) return;
    _nrrBackgroundRefresh('interval-poll');
  }, NRR_REFRESH_POLL_MS);

  // Covers "alt-tabbed away and back" — an immediate refresh on regaining
  // visibility after being hidden a meaningful while, rather than waiting
  // for the next scheduled tick.
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') {
      _nrrHiddenSince = Date.now();
    } else if (document.visibilityState === 'visible') {
      var hiddenFor = _nrrHiddenSince ? (Date.now() - _nrrHiddenSince) : 0;
      _nrrHiddenSince = null;
      if (hiddenFor >= NRR_HIDDEN_MIN_MS && !_nrrShouldSkipGenericRefresh()) {
        _nrrBackgroundRefresh('resume-visible');
      }
    }
  });
}
window._nrrArmGenericRefreshTimer = _nrrArmGenericRefreshTimer;
