// =============================================================================
// 09_conv_intel.js — Conversation Intelligence Module
// CSS + HTML ตรงจาก ci_mockup_v2 — ห้ามแก้ design โดยไม่ update mockup ด้วย
// =============================================================================

const CI = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const WORKER_URL = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
  const MAX_SECS   = 4800; // v587: 80min — bitrate จริงคือ 24kbps (audioBitsPerSecond:24000) = 3000B/s
                           // 80min = 14.4MB raw → ~19.2MB base64 ใต้ Gemini 20MB inline limit
                           // (เดิม 5400/90min คำนวณจาก 16kbps ที่ไม่ใช่ค่าจริง → 21.6MB เกิน limit → analyze fail ทั้ง session)

  // ── State ──────────────────────────────────────────────────────────────────
  let _recorder    = null;
  let _chunks      = [];
  let _startTime   = 0;
  let _timerRef    = null;
  let _waveRef     = null;
  let _phase       = 'idle'; // idle | recording | processing | result
  let _accountGuid = null;
  let _accountName = '';
  let _accountSeg  = '';
  let _durText     = '0:00';
  let _lastResult  = null;
  let _secs        = 0;
  let _lastTranscriptWordCount = 0;
  let _ownerType   = 'kam';
  let _showPicker  = false; // show account picker section in record screen // 'kam' | 'sales'
  let _floatTimer  = null; // minimize timer ref
  let _audioCtx    = null; // AudioContext keep-alive — prevents iOS from suspending audio session
  let _sessionId   = null; // ci_sessions UUID after save
  let _isOwnRecording = false; // true when TL/Admin records own session — hides Debrief
  let _histFilterMode = 'week'; // 'week' | 'month' | 'all'  — inline history filter
  let _mainTab     = 'record'; // 'record' | 'history' — main tab (state machine input)
  let _checkinCache = null; // { rep_lat, rep_lng, checked_in_at, account_guid } — GPS from check-in orb

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _fmt(s) {
    return Math.floor(s/60)+':'+(s%60<10?'0':'')+(s%60);
  }
  function _bestMime() {
    const types = ['audio/webm;codecs=opus','audio/webm','audio/mp4','audio/ogg'];
    for (const t of types) if (MediaRecorder.isTypeSupported(t)) return t;
    return '';
  }
  function _toast(msg) {
    if (typeof showToast === 'function') showToast(msg, '⚠');
  }
  // ── v587: Screen Wake Lock — กันจอดับระหว่างอัดเสียงหน้างาน 40-60 นาที ──────
  // iOS Safari 16.4+ / Chrome รองรับ · เครื่องไม่รองรับ = ข้ามเงียบๆ (พฤติกรรมเดิม)
  // wake lock ถูก OS ปล่อยอัตโนมัติตอน background → re-acquire ตอนกลับ foreground
  let _wakeLock = null;
  async function _acquireWakeLock() {
    try {
      if (!('wakeLock' in navigator)) return;
      _wakeLock = await navigator.wakeLock.request('screen');
    } catch(_) { _wakeLock = null; }
  }
  function _releaseWakeLock() {
    try { if (_wakeLock) _wakeLock.release(); } catch(_) {}
    _wakeLock = null;
  }
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && _phase === 'recording') _acquireWakeLock();
    });
  } catch(_) {}

  // v583: key moment text — รองรับทั้ง string (sessions เก่า) และ {ts,quote,note} (v583+)
  function _kmText(m) {
    if (typeof m === 'string') return m;
    if (!m) return '';
    if (m.quote) {
      const ts = m.ts ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:10px;color:var(--tx3,#AEAEB2)">${m.ts}</span> ` : '';
      const note = m.note ? ` <span style="color:var(--tx3,#AEAEB2)">— ${m.note}</span>` : '';
      return `${ts}&ldquo;${m.quote}&rdquo;${note}`;
    }
    return m.text || '';
  }
  function _ctx() {
    if (typeof portviewBulkData !== 'undefined' && _accountGuid) {
      // v552: real bulk fields are id/name/accountType (not account_guid/res_name) — support both
      const row = portviewBulkData.find(r => (r.id || r.account_guid) === _accountGuid);
      if (row) return {
        name: row.name||row.res_name||'-',
        seg: row.accountType||row.account_type||'-',
        days: row.daysWithCurrentKam||row.days_with_current_kam||0,
        // enriched fields for AI context
        gmv_mtd: row.gmvToDate||row.gmv_to_date||0,
        gmv_baseline: (row.paceSignal&&row.paceSignal.baselineGmv)||row.lastGmv||0,
        pace_pct: (row.paceSignal&&row.paceSignal.pct)||null,
        churn_count: row.churnedSkuCount||row.churned_sku_count||0,
        missing_cats: row.missingCatCount||row.missing_cat_count||0,
        account_class: row.accountType||'-',
        is_new: (row.daysWithCurrentKam||0) > 0 && (row.daysWithCurrentKam||0) <= 30
      };
    }
    return { name: _accountName||'-', seg: _accountSeg||'-', days: 0,
             gmv_mtd:0, gmv_baseline:0, pace_pct:null, churn_count:0,
             missing_cats:0, account_class:'-', is_new:false };
  }

  // ── CSS from mockup (verbatim) ─────────────────────────────────────────────
  const _CSS = `
/* ── SPEC TOKENS ── */
:root{
  --n-0:#FFFFFF;--n-50:#FFFFFF;--n-100:#E5E5EA;--n-200:#6C6C70;--n-400:#636366;--n-900:#1C1C1E;
  --echo-ac:#FF385C;--echo-ac-h:#e02d50;
  --echo-ac-5:rgba(255,56,92,.05);--echo-ac-8:rgba(255,56,92,.08);--echo-ac-12:rgba(255,56,92,.12);--echo-ac-20:rgba(255,56,92,.20);
  --danger:#FF3B30;--danger-bg:rgba(255,59,48,.08);
  --warning:#FF9500;--warning-bg:rgba(255,149,0,.08);
  --success:#34C759;
  --glass-0:rgba(255,255,255,.72);--glass-1:rgba(255,255,255,.88);
  --glass-border:rgba(255,255,255,.55);--glass-spec:rgba(255,255,255,.90);
  --bg:#FFFFFF;--tx:var(--n-900);--tx2:var(--n-400);--tx3:var(--n-200);
  --br:var(--n-100);--ac:var(--echo-ac);--ac-h:var(--echo-ac-h);
  --font:'Noto Sans Thai',sans-serif;--mono:'Noto Sans Thai',sans-serif;
  --ease:cubic-bezier(0.16,1,0.3,1);
}



/* ── PHONE SHELL ── */
.phone{
  width:390px;background:var(--bg);border-radius:50px;
  overflow:hidden;position:relative;
  box-shadow:0 48px 120px rgba(0,0,0,.22),0 0 0 1px rgba(255,255,255,.5) inset,0 1px 0 rgba(255,255,255,.8) inset;
}
.notch{width:126px;height:37px;background:var(--bg);border-radius:0 0 22px 22px;margin:0 auto;position:relative;z-index:10;}
.sbar{display:flex;justify-content:space-between;align-items:center;padding:12px 28px 0;position:relative;z-index:2;}
.sbar-t{font-size:15px;font-weight:500;color:var(--tx);letter-spacing:-.02em;}
.sbar-r{font-size:13px;color:var(--tx2);}

/* ── SCREENS ── */
.scr{display:none;flex-direction:column;min-height:780px;}
.scr.on{display:flex;}

/* ── TOPBAR ── */
.topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 24px 10px;background:transparent;}
.tb-act{font-size:15px;font-weight:400;color:var(--tx2);cursor:pointer;padding:6px 0;}
.tb-act:hover{color:var(--tx);}
.tb-lbl{font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;}
.tb-rec{font-size:12px;font-weight:500;color:var(--ac);display:flex;align-items:center;gap:5px;font-family:'Noto Sans Thai',sans-serif;}
.rec-dot{width:5px;height:5px;border-radius:50%;background:var(--danger);opacity:0;transition:opacity .3s;}
.rec-dot.on{opacity:1;animation:blink 1.3s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}

/* ── CHIP ── */
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:100px;background:rgba(0,0,0,.04);}
.chip-dot{width:5px;height:5px;border-radius:50%;background:var(--ac);flex-shrink:0;}
.chip-txt{font-size:13px;color:var(--tx2);letter-spacing:-.01em;}
.chip-seg{font-size:10px;font-weight:500;color:var(--ac);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;}

/* ── RECORD CENTER ── */
.rec-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:0 24px;}

/* ── ORB ── */
.orb-wrap{position:relative;width:200px;height:200px;display:flex;align-items:center;justify-content:center;}
.orb-ring{position:absolute;border-radius:50%;border:1px solid var(--echo-ac-12);opacity:0;pointer-events:none;}
.orb-ring-1{width:100%;height:100%;}
.orb-ring-2{width:136%;height:136%;border-color:var(--echo-ac-8);}
.is-rec .orb-ring-1{animation:opulse 2.4s var(--ease) infinite;}
.is-rec .orb-ring-2{animation:opulse 2.4s var(--ease) .8s infinite;}
@keyframes opulse{0%{opacity:.55;transform:scale(.88)}100%{opacity:0;transform:scale(1.1)}}
.orb-outer{
  width:172px;height:172px;border-radius:50%;cursor:pointer;
  background:rgba(255,255,255,.62);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:0.5px solid rgba(255,255,255,.72);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.92),0 6px 28px rgba(0,0,0,.08);
  display:flex;align-items:center;justify-content:center;
  transition:box-shadow 220ms var(--ease),transform 60ms linear;
}
.orb-outer:active{transform:scale(.96);}
.is-rec .orb-outer{box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 8px 36px rgba(255,56,92,.13);}
.orb-core{
  width:114px;height:114px;border-radius:50%;
  background:var(--n-0);
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 14px rgba(0,0,0,.09);
  display:flex;align-items:center;justify-content:center;
  transition:box-shadow 220ms var(--ease);
}
.is-rec .orb-core{box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 18px rgba(255,56,92,.16);}
.orb-core svg{width:38px;height:38px;color:var(--ac);transition:transform 120ms var(--ease);}
.is-rec .orb-core svg{transform:scale(1.08);}

/* ambient — very subtle, only when recording */
.orb-ambient{
  position:absolute;width:280px;height:280px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,56,92,.06) 0%,transparent 65%);
  pointer-events:none;opacity:0;transition:opacity 600ms var(--ease);
}
.is-rec .orb-ambient{opacity:1;}

/* ── TIMER ── */
.timer-block{text-align:center;}
.timer-val{font-size:52px;font-weight:200;letter-spacing:-.04em;line-height:1;color:var(--tx);font-variant-numeric:tabular-nums;}
.timer-hint{font-size:11px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:#8e8e93;margin-top:5px;font-family:'Noto Sans Thai',sans-serif;transition:color 220ms;}
.is-rec .timer-hint{color:rgba(255,255,255,.18);}

/* ── WAVEFORM ── */
.waveform{display:flex;align-items:center;gap:2.5px;height:44px;padding:0 28px;width:100%;}
.wb{flex:1;border-radius:3px;background:var(--echo-ac-20);height:3px;min-height:3px;transition:height .11s ease,opacity .11s ease;opacity:.25;}
.is-rec .wb{opacity:.55;}
/* ── AMBIENT WAVE (recording active) ── */
.ci-wave-wrap{display:flex;align-items:flex-end;justify-content:center;gap:4px;height:40px;}
.ci-wb{display:inline-block;width:3px;min-height:3px;border-radius:3px;}
/* ── RECORDING ACTIVE CENTER ── */
#ci-rec-active{display:none;flex-direction:column;align-items:center;padding:20px 24px 8px;gap:8px;}
/* ── ORB — remove pulse rings in active state ── */
.orb-ambient,.orb-ring{display:none;}

/* ── ORB CHECK-IN FEEDBACK (v552) ── */
@keyframes orb-snap-pulse{0%,100%{box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 14px rgba(0,0,0,.09)}50%{box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 4px 24px rgba(255,56,92,.30)}}
.orb-snapping{animation:orb-snap-pulse 1s ease-in-out infinite;}
.orb-snapping svg{opacity:.45;transition:opacity .2s;}
@keyframes orb-ok-flash{0%{box-shadow:0 0 0 0 rgba(52,199,89,.5)}100%{box-shadow:0 0 0 30px rgba(52,199,89,0)}}
.orb-checkin-ok{animation:orb-ok-flash .9s ease-out 1;}

/* ── CHECK-IN BAR ── */
.ci-checkin-bar{display:none;margin:0 24px 4px;background:rgba(52,199,89,.06);border:0.5px solid rgba(52,199,89,.2);border-radius:12px;padding:8px 12px;align-items:center;gap:8px;}
.ci-checkin-bar.show{display:flex;}
.ci-checkin-icon{width:18px;height:18px;border-radius:50%;background:rgba(52,199,89,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ci-checkin-txt{font-size:12px;font-weight:500;color:#1C1C1E;}
.ci-checkin-sub{font-size:10px;color:#8e8e93;}

/* ── COVISIT LIST (TL screen) ── */
.cv-list-wrap{flex:1;overflow-y:auto;padding:0 0 max(32px,calc(env(safe-area-inset-bottom,0px)+80px));-webkit-overflow-scrolling:touch;}
.cv-section-hd{font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:12px 24px 6px;}
.cv-row{display:flex;align-items:center;gap:10px;padding:10px 24px;border-bottom:0.5px solid #E5E5EA;}
.cv-row:last-child{border-bottom:none;}
.cv-avatar{width:30px;height:30px;border-radius:50%;background:rgba(255,56,92,.1);display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:600;color:#FF385C;flex-shrink:0;}
.cv-name{font-size:13px;font-weight:500;color:#1C1C1E;}
.cv-sub{font-size:10px;color:#AEAEB2;margin-top:1px;font-family:'Noto Sans Thai',sans-serif;}
.cv-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:100px;font-size:9px;font-weight:500;white-space:nowrap;}
.cv-badge-ready{background:rgba(52,199,89,.1);color:#1A7A3A;}
.cv-badge-wait{background:rgba(255,149,0,.1);color:#995500;}
.cv-badge-done{background:rgba(52,199,89,.1);color:#1A7A3A;}
.cv-badge-expired{background:rgba(255,59,48,.08);color:#CC2200;}
.cv-verify-btn{display:block;margin:12px 24px 4px;width:calc(100% - 48px);padding:14px;border-radius:14px;border:none;background:#FF385C;color:#fff;font-family:'Noto Sans Thai',sans-serif;font-size:15px;font-weight:500;letter-spacing:-.02em;cursor:pointer;transition:opacity 80ms;}
.cv-verify-btn:disabled{background:#E5E5EA;color:#AEAEB2;cursor:not-allowed;}
.cv-verify-btn:active{opacity:.85;}
.cv-note{text-align:center;font-size:10px;color:#AEAEB2;padding:4px 24px 16px;line-height:1.5;font-family:'Noto Sans Thai',sans-serif;}

/* ── RECORD BOTTOM ── */
.rec-bottom{padding:8px 24px 40px;display:flex;flex-direction:column;gap:10px;}
.btn-stop{
  width:100%;padding:15px;border-radius:14px;border:none;
  background:rgba(0,0,0,.055);color:var(--tx2);
  font-family:'Noto Sans Thai',sans-serif;font-size:15px;font-weight:500;letter-spacing:-.02em;
  cursor:pointer;transition:background 120ms,color 120ms,transform 60ms linear;
}
.btn-stop:hover{background:rgba(0,0,0,.08);color:var(--tx);}
.btn-stop:active{transform:scale(.98);}
.stop-hint{text-align:center;font-size:11px;color:#8e8e93;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;}

/* ── PROCESSING SCREEN ── */
.proc-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 24px;}
.proc-dots{display:flex;gap:7px;align-items:center;margin-bottom:16px;}
.proc-dot{width:7px;height:7px;border-radius:50%;background:var(--ac);opacity:.2;animation:dbreathe 1.2s ease-in-out infinite;}
.proc-dot:nth-child(2){animation-delay:.2s;}
.proc-dot:nth-child(3){animation-delay:.4s;}
@keyframes dbreathe{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
.proc-step{font-size:15px;font-weight:400;color:var(--tx);letter-spacing:-.02em;text-align:center;}
.proc-sub{font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-top:3px;text-align:center;}
.proc-line{width:148px;height:1px;background:var(--n-100);border-radius:1px;margin-top:24px;overflow:hidden;}
.proc-fill{height:100%;background:var(--ac);width:0%;transition:width .65s var(--ease);}

/* ── RESULT SCREEN ── */
.result-hdr{padding:20px 24px 0;}
.result-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.result-acct{font-size:16px;font-weight:500;letter-spacing:-.02em;color:var(--tx);}
.dur-chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:100px;background:rgba(0,0,0,.04);font-family:'Noto Sans Thai',sans-serif;font-size:12px;color:var(--tx3);letter-spacing:.02em;}

/* ── TAB BAR — sliding pill ── */
.tab-bar{position:relative;display:flex;background:rgba(0,0,0,.042);border-radius:10px;padding:3px;gap:0;margin-bottom:18px;}
.tab-pill{position:absolute;top:3px;bottom:3px;background:var(--n-0);border-radius:7px;box-shadow:0 1px 4px rgba(0,0,0,.10);pointer-events:none;transition:left 120ms var(--ease),width 120ms var(--ease);}
.tab-btn{flex:1;padding:8px 6px;font-size:12px;font-weight:500;color:var(--tx3);background:transparent;border:none;border-radius:7px;cursor:pointer;font-family:'Noto Sans Thai',sans-serif;letter-spacing:-.01em;transition:color 120ms;position:relative;z-index:1;white-space:nowrap;}
.tab-btn.on{color:var(--tx);}

/* ── RESULT BODY ── */
.result-body{flex:1;overflow-y:auto;padding:0 24px;-webkit-overflow-scrolling:touch;}
.result-body::-webkit-scrollbar{display:none;}
.panel{display:none;}
.panel.on{display:block;}

/* PIPC */
.pipc-track{display:flex;gap:4px;margin-bottom:6px;}
.pipc-seg{flex:1;height:2px;border-radius:2px;background:var(--n-100);transition:background 220ms;}
.pipc-seg.done{background:var(--ac);}
.pipc-labels{display:flex;justify-content:space-between;margin-bottom:24px;}
.pipc-lbl{font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;transition:color 220ms;}
.pipc-lbl.done{color:var(--ac);}

/* SKILL ROWS */
.skill-row{display:flex;gap:11px;padding:13px 0;border-bottom:0.5px solid var(--br);opacity:0;transform:translateY(5px);animation:rowshow 280ms var(--ease) forwards;}
.skill-row:last-child{border-bottom:none;}
.skill-row:nth-child(1){animation-delay:0ms}
.skill-row:nth-child(2){animation-delay:70ms}
.skill-row:nth-child(3){animation-delay:140ms}
.skill-row:nth-child(4){animation-delay:210ms}
@keyframes rowshow{to{opacity:1;transform:translateY(0)}}
.sk-dot{width:6px;height:6px;border-radius:50%;margin-top:5px;flex-shrink:0;}
.sk-dot.pass{background:var(--success);}
.sk-dot.dev{background:var(--warning);}
.sk-dot.no{background:var(--n-100);}
.sk-body{flex:1;min-width:0;}
.sk-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:3px;}
.sk-name{font-size:13px;font-weight:500;color:var(--tx);letter-spacing:-.02em;}
.sk-badge{font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-family:'Noto Sans Thai',sans-serif;}
.sk-badge.pass{color:var(--success);}
.sk-badge.dev{color:var(--warning);}
.sk-badge.no{color:var(--tx3);}
.sk-note{font-size:12px;color:var(--tx2);line-height:1.5;letter-spacing:-.005em;}

/* eyebrow */
.eyebrow{font-size:9px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:12px;}

/* BUYER CARD */
.buyer-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:16px;border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 4px 20px rgba(0,0,0,.05);
  padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:24px;
}
.buyer-icon-wrap{width:46px;height:46px;border-radius:12px;background:var(--n-50);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.buyer-lbl{font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:4px;}
.buyer-type{font-size:20px;font-weight:300;letter-spacing:-.03em;color:var(--tx);line-height:1.1;}
.buyer-ev{font-size:11px;color:var(--tx3);margin-top:2px;letter-spacing:-.005em;}

/* PAIN ROWS */
.pain-row{display:flex;gap:12px;padding:12px 0;border-bottom:0.5px solid var(--br);}
.pain-row:last-child{border-bottom:none;}
.pain-dot{width:5px;height:5px;border-radius:50%;margin-top:4px;flex-shrink:0;}
.pain-dot.hi{background:var(--danger);}
.pain-dot.md{background:var(--warning);}
.pain-dot.op{background:var(--ac);}
.pain-body{flex:1;}
.pain-dim{font-size:9px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;}
.pain-txt{font-size:12px;color:var(--tx2);line-height:1.5;}

/* ACTION CARDS */
.action-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:14px;border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 3px 16px rgba(0,0,0,.045);
  padding:14px 16px;margin-bottom:8px;
}
.action-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}
.action-n{font-size:10px;font-weight:500;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.08em;}
.urg{font-size:9px;font-weight:500;padding:3px 8px;border-radius:100px;letter-spacing:.06em;text-transform:uppercase;font-family:'Noto Sans Thai',sans-serif;}
.urg.hi{background:var(--danger-bg);color:var(--danger);}
.urg.md{background:var(--warning-bg);color:var(--warning);}
.action-txt{font-size:12px;color:var(--tx);line-height:1.5;margin-bottom:5px;letter-spacing:-.01em;}
.action-who{font-size:10px;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;}

/* RESULT CTA */
.result-cta{display:flex;gap:8px;padding:14px 24px max(40px,calc(env(safe-area-inset-bottom,0px) + 20px));}
.btn{flex:1;padding:14px;border-radius:14px;border:none;font-family:'Noto Sans Thai',sans-serif;font-size:15px;font-weight:500;letter-spacing:-.02em;cursor:pointer;transition:opacity 60ms linear,transform 60ms linear;}
.btn:active{transform:scale(.97);opacity:.85;}
.btn-primary{background:var(--ac);color:#fff;}
.btn-primary:hover{background:var(--ac-h);}
.btn-ghost{background:rgba(0,0,0,.045);color:var(--tx2);}
.btn-ghost:hover{background:rgba(0,0,0,.07);}

/* spacing utility */
.mb-7{margin-bottom:28px;}
/* CI sheet overrides — scope inside #ci-fullsheet */
#ci-fullsheet {
  position:fixed;
  top:0;bottom:0;
  /* v576: no translateX — iOS WKWebView fixed+transform = white flash on cold open
     centering via left:0/right:0/margin:auto (same fix as .bnav) */
  left:0;right:0;
  width:100%;max-width:440px;
  margin:0 auto;
  transform:translateY(100%);
  z-index:9999;
  padding-top:env(safe-area-inset-top,44px);
  padding-bottom:env(safe-area-inset-bottom,0px);
  background:#FFFFFF;
  font-family:'Noto Sans Thai',sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
  color:#1C1C1E!important;
}
/* v588: backstop — กันแถบขาว home indicator zone ตอน is-rec (dark mode)
   sheet เปลี่ยน bg ผ่าน JS แต่ถ้า OS ยัง render ใต้ sheet ให้ body รับ */
body.echo-active { background:#111111; }
body:not(.echo-active) { background:unset; }
#ci-fullsheet .topbar{
  background:transparent;
  border-bottom:0.5px solid rgba(0,0,0,.07);
  transition:background .7s ease,border-color .7s ease;
}
#ci-fullsheet.ci-open { transform:translateY(0); }
#ci-fullsheet .scr { display:none; flex-direction:column; flex:1; min-height:0; }
#ci-fullsheet .scr.on { display:flex; }
/* ── Picker sheet items ── */
.ci-pk-item{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border-radius:10px;border:none;background:rgba(0,0,0,.03);cursor:pointer;width:100%;text-align:left;transition:background .15s;margin-bottom:2px;}
.ci-pk-item:active{background:rgba(255,56,92,.08);}
.ci-pk-name{font-size:13px;color:#1C1C1E;font-weight:500;flex:1;text-align:left;}
.ci-pk-seg{font-size:10px;font-weight:600;color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;margin-left:8px;}
/* ── Readability overrides ── */
.sk-name{font-size:13px;font-weight:500;color:#1C1C1E;letter-spacing:-.02em}
.sk-note{font-size:12px;color:#636366;line-height:1.55;letter-spacing:-.005em}
.sk-badge{font-size:10px;letter-spacing:.08em}
.buyer-type{font-size:20px;font-weight:300;letter-spacing:-.03em;color:#1C1C1E}
.buyer-ev{font-size:12px;color:#636366;line-height:1.5}
.buyer-lbl{font-size:9px;letter-spacing:.14em;color:#6C6C70;margin-bottom:4px}
.pain-txt{font-size:12px;color:#636366;line-height:1.55}
.pain-dim{font-size:10px;color:#6C6C70;letter-spacing:.13em}
.action-txt{font-size:13px;color:#1C1C1E;line-height:1.5}
.action-who{font-size:11px;color:#6C6C70}
.action-n{font-size:10px;color:#6C6C70;letter-spacing:.08em}
.eyebrow{font-size:10px;color:#6C6C70;letter-spacing:.16em}
.tab-btn{font-size:13px;font-weight:400;color:#6C6C70}
.tab-btn.on{color:#1C1C1E;font-weight:500}
.proc-step{font-size:15px;color:#1C1C1E}
.proc-sub{font-size:11px;color:#6C6C70}
.timer-val{color:#1C1C1E}
.timer-hint{font-size:11px;color:#6C6C70}
.stop-hint{font-size:11px;color:#6C6C70}
.btn-stop{font-size:15px;color:#1C1C1E;background:rgba(0,0,0,.055)}
.chip-txt{font-size:13px;color:#636366}
.chip-seg{font-size:10px;color:#FF385C}
`;

  // ── Mount / unmount sheet ──────────────────────────────────────────────────
  function _mount() {
    if (document.getElementById('ci-fullsheet')) return;
    // inject font
    if (!document.getElementById('ci-font')) {
      const l = document.createElement('link');
      l.id = 'ci-font'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Thai:wght@400;500;600;700&display=swap';
      document.head.appendChild(l);
    }
    // inject CSS
    if (!document.getElementById('ci-style')) {
      const s = document.createElement('style');
      s.id = 'ci-style'; s.textContent = _CSS;
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.id = 'ci-fullsheet';
    el.innerHTML = _buildHTML();
    document.body.appendChild(el);
    // v601: กัน iOS scroll chaining โดยใช้ overflow:hidden แทน position:fixed
    // position:fixed ทำให้ topbar sticky re-anchor ผิดตำแหน่งใน KAM PWA mode
    // overflow:hidden กัน scroll ได้เหมือนกัน โดยไม่ทำลาย sticky/layout context
    try {
      window._ciScrollLockY = window.scrollY || 0;
      document.body.style.overflow = 'hidden';
    } catch(_) {}
    // v478-H4: double-rAF races with left:50% layout resolution on some iOS devices.
    // left:50% is computed relative to viewport width, but translateX(-50%) is computed
    // against the element's own width. If the browser hasn't reflowed yet, the combined
    // transform resolves incorrectly (x offset only, no Y slide-in) → sheet lands off-screen.
    // Fix: use setTimeout(50ms) instead of double-rAF to guarantee a full layout pass before
    // adding ci-open. The 380ms CSS transition still provides a smooth slide-in animation.
    setTimeout(() => { el.classList.add('ci-open'); }, 50);
    _initWaveform();
    _showScreen('ci-s-record');
    _renderEchoState();   // v552: state machine — single visibility pass
    setTimeout(_checkRecoverBuffer, 400); // v555: เช็คบันทึกค้างจาก session ก่อน
    // Load visit counts after mount (async, non-blocking)
    setTimeout(_loadVisitBadge, 200);
    if (_canDebrief()) {
      setTimeout(_loadCovisitHero, 250);
      setTimeout(_loadCovisitList, 300);
    } else {
      setTimeout(_loadVisitHero, 250);
    }
  }

  // v601: centralised body-scroll restore — ใช้ overflow:hidden แทน position:fixed
  function _restoreBodyScroll() {
    try {
      document.body.style.overflow = '';
      // clear สิ่งที่เคย set ไว้ก่อน v601 (ป้องกัน stale state ถ้า cache SW เก่า)
      document.body.style.position = '';
      document.body.style.top = '';
      document.body.style.left = '';
      document.body.style.right = '';
      document.body.style.width = '';
      document.body.style.maxWidth = '';
      document.body.style.marginLeft = '';
      document.body.style.marginRight = '';
      window._ciScrollLockY = 0;
    } catch(_) {}
  }

  function _unmount() {
    const el = document.getElementById('ci-fullsheet');
    if (!el) return;
    el.classList.remove('ci-open');
    setTimeout(() => el.remove(), 400);
    clearInterval(_timerRef);
    clearInterval(_waveRef);
    _restoreBodyScroll(); // v598: use centralised restore
    // v600: flush any refreshAll that was queued while Echo sheet was blocking body
    setTimeout(() => {
      try {
        if (window._pendingRefreshAll && typeof refreshAll === 'function') {
          window._pendingRefreshAll = false;
          refreshAll();
        }
      } catch(_) {}
    }, 450); // หลัง sheet remove (400ms) + buffer เล็กน้อย
  }

  function _minimize() {
    if (_phase !== 'recording') return;
    const sheet = document.getElementById('ci-fullsheet');
    if (sheet) sheet.style.display = 'none';
    const pill = document.getElementById('echo-float-pill');
    if (pill) { pill.classList.add('visible'); _startFloatTimer(); }
    document.body.classList.add('echo-active');
    // v598: restore body scroll when minimized — sheet is hidden so app nav must work
    // body scroll re-locked when user expands back (echoExpand → _reapplyBodyLock)
    _restoreBodyScroll();
    // Update topbar: left button shows minimize hint
    const _tbLeft = document.getElementById('ci-topbar-left-label');
    const _tbIcon = document.getElementById('ci-topbar-left-icon');
    if (_tbLeft) _tbLeft.textContent = 'ย่อ';
    if (_tbIcon) _tbIcon.style.display = 'none';
  }

  // v601: re-apply body scroll lock (overflow:hidden) when expanding sheet back from minimized
  function _reapplyBodyLock() {
    try {
      document.body.style.overflow = 'hidden';
    } catch(_) {}
  }

  function _startFloatTimer() {
    clearInterval(_floatTimer);
    _floatTimer = setInterval(() => {
      const el = document.getElementById('echo-float-time');
      if (el) el.textContent = _fmt(_secs);
    }, 1000);
  }

  // ── HTML (structure from mockup) ───────────────────────────────────────────
  function _buildHTML() {
    const ctx = _ctx();
    return `
<div id="ci-s-record" class="scr on">
  <div class="topbar">
    <span class="tb-act" id="ci-topbar-left" onclick="CI._topbarLeft()" style="display:flex;align-items:center;gap:4px;">
      <span id="ci-topbar-left-icon" style="font-size:16px;line-height:1">←</span>
      <span id="ci-topbar-left-label">ยกเลิก</span>
    </span>
    <span class="tb-lbl">Echo</span>
    <span class="tb-rec"><span class="rec-dot" id="ci-rdot"></span><span id="ci-rlbl"></span></span>
  </div>
  <div style="padding:8px 24px 0">
    <div class="tab-bar" id="ci-main-tabs">
      <div class="tab-pill" id="ci-tab-pill" style="left:3px;width:calc(50% - 3px)"></div>
      <button class="tab-btn on" id="ci-tab-rec" onclick="CI._switchMainTab('record')">บันทึก</button>
      <button class="tab-btn" id="ci-tab-hist" onclick="CI._switchMainTab('history')">ประวัติ</button>
    </div>
  </div>
  <!-- chip — shown after account selected -->
  <div id="ci-chip-wrap" style="padding:4px 24px 10px;display:${_showPicker?'none':''}">
    <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
      <div class="chip" style="display:inline-flex">
        <div class="chip-dot" style="${_accountSeg==='LEAD'?'background:#FF9500':''}"></div>
        <span class="chip-txt">${ctx.name||'ร้านค้า'}</span>
        <span class="chip-seg" style="${_accountSeg==='LEAD'?'color:#FF9500':''}">${_accountSeg==='LEAD'?'LEAD':ctx.seg}</span>
      </div>
      <div id="ci-checkin-pill" style="display:none;align-items:center;gap:4px;padding:4px 10px;border-radius:100px;background:rgba(52,199,89,.1);border:0.5px solid rgba(52,199,89,.25)">
        <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
        <span style="font-size:10px;font-weight:500;color:#1A7A3A;font-family:'Noto Sans Thai',sans-serif">เช็คอิน <span id="ci-checkin-time">—</span></span>
      </div>
    </div>
  </div>
  <!-- visit hero — hide during picker state, show after account selected -->
  <div id="ci-visit-hero" style="padding:0 24px 10px;${_showPicker?'display:none':''}">
    <div id="ci-vh-card" style="background:rgba(255,56,92,.04);border:0.5px solid rgba(255,56,92,.13);border-radius:14px;padding:12px 14px;transition:background .7s ease,border-color .7s ease">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div id="ci-vh-wlabel" style="font-size:9px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;transition:color .7s ease">สัปดาห์นี้</div>
          <div id="ci-vh-wnum" style="font-size:22px;font-weight:300;color:#1C1C1E;letter-spacing:-.03em;line-height:1.1;transition:color .7s ease">—</div>
          <div id="ci-vh-wsub" style="font-size:10px;color:#AEAEB2;margin-top:1px;transition:color .7s ease">visits</div>
        </div>
        <div id="ci-vh-div" style="width:0.5px;background:rgba(255,56,92,.12);align-self:stretch;transition:background .7s ease"></div>
        <div style="text-align:right">
          <div id="ci-vh-qlabel" style="font-size:9px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;transition:color .7s ease">ไตรมาสนี้</div>
          <div id="ci-vh-qnum" style="font-size:22px;font-weight:300;color:#1C1C1E;letter-spacing:-.03em;line-height:1.1;transition:color .7s ease">—</div>
          <div id="ci-vh-qsub" style="font-size:10px;color:#AEAEB2;margin-top:1px;transition:color .7s ease">visits</div>
        </div>
      </div>
      <div id="ci-vh-dots" style="display:flex;gap:5px;align-items:center"></div>
    </div>
  </div>
  <!-- Inline picker section — shown when no account selected, after visit hero -->
  <div id="ci-picker-sec" style="display:${_showPicker?'flex':'none'};flex-direction:column;flex:1;padding:0 24px 24px;gap:12px;overflow-y:auto">
    ${_ownerType==='sales' ? _buildSalesPickerInline() : _buildKamPickerInline()}
  </div>
  <!-- idle center — orb, shown before startRecording() -->
  <div class="rec-center" id="ci-rec-center" style="${_showPicker?'display:none':''}">
    <div class="orb-wrap">
      <div class="orb-outer" onclick="CI._orbTap()">
        <div class="orb-core" id="ci-orb-core">
          <svg id="ci-orb-icon-mic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
          <svg id="ci-orb-icon-pin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="display:none">
            <path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/>
            <circle cx="12" cy="9" r="2.5"/>
          </svg>
        </div>
      </div>
    </div>
    <div class="timer-block">
      <div class="timer-hint" id="ci-thint">กดเพื่อเริ่มบันทึก</div>
    </div>
  </div>
  <!-- TL covisit panel — shown for TL/Admin instead of orb -->
  <div id="ci-covisit-panel" style="display:none;flex:1;flex-direction:column;overflow:hidden">
    <div class="cv-list-wrap" id="ci-cv-list-body">
      <div style="text-align:center;padding:40px 0;font-size:13px;color:#AEAEB2">กำลังโหลด...</div>
    </div>
    <div id="ci-cv-verify-wrap" style="display:none">
      <button class="cv-verify-btn" id="ci-cv-verify-btn" onclick="CI._covisitVerify()"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>ยืนยัน Co-visit</button>
      <div class="cv-note">GPS จะเปรียบเทียบตำแหน่งกับน้อง · ต้องอยู่ในรัศมี 150 เมตร และภายใน 90 นาที</div>
    </div>
  </div>
  <!-- active recording center — wave + timer -->
  <div id="ci-rec-active" style="display:none;flex-direction:column;align-items:center;padding:20px 24px 8px;gap:12px">
    <div class="ci-wave-wrap" id="ci-wf"></div>
    <div class="timer-val" id="ci-tval">0:00</div>
    <div class="timer-hint" id="ci-rec-hint">echo กำลังรับฟัง · ทำงานอยู่เบื้องหลัง</div>
  </div>
  <!-- stop + cancel buttons — only during recording -->
  <div id="ci-rec-bottom" style="display:none;padding:0 24px 40px">
    <div style="display:flex;align-items:center;justify-content:center;gap:10px">
      <button id="ci-stop-btn" onclick="CI.stopRecording()"
        style="padding:11px 32px;border:0.5px solid rgba(255,255,255,.38);border-radius:100px;
               background:transparent;color:rgba(255,255,255,.72);
               font-size:12px;font-weight:500;letter-spacing:.05em;text-transform:uppercase;
               font-family:'Noto Sans Thai',sans-serif;cursor:pointer;
               transition:background .7s ease,color .7s ease,border-color .7s ease">
        จบ &amp; วิเคราะห์
      </button>
      <button onclick="CI.cancel()"
        style="width:40px;height:40px;flex-shrink:0;border:none;border-radius:12px;cursor:pointer;
               background:rgba(255,255,255,.08);color:rgba(255,255,255,.55);
               display:flex;align-items:center;justify-content:center;
               transition:background .7s ease,color .7s ease" title="ยกเลิก session">
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  </div>
  <!-- inline history panel — shown when tab=history -->
  <div id="ci-inline-hist" style="display:none;flex:1;overflow-y:auto;padding:0 24px max(32px,calc(env(safe-area-inset-bottom,0px) + 80px));-webkit-overflow-scrolling:touch">
    <div id="ci-inline-hist-body" style="padding-top:8px">
      <div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">กำลังโหลด...</div>
    </div>
  </div>
</div>

<div id="ci-s-proc" class="scr">
  <div class="proc-wrap">
    <div class="proc-dots">
      <div class="proc-dot"></div><div class="proc-dot"></div><div class="proc-dot"></div>
    </div>
    <p class="proc-step" id="ci-pstep">Transcribing...</p>
    <p class="proc-sub" id="ci-psub">Whisper · ภาษาไทย</p>
    <div class="proc-line"><div class="proc-fill" id="ci-pfill"></div></div>
    <p style="font-size:11px;color:var(--tx3,#AEAEB2);margin-top:10px;font-family:'Noto Sans Thai',sans-serif" id="ci-pelapsed"></p>
  </div>
</div>

<div id="ci-s-result" class="scr">
  <div class="result-hdr">
    <div class="result-meta">
      <span class="result-acct">${ctx.name}</span>
      <span class="dur-chip" id="ci-dur-chip">0:00</span>
    </div>
    <div class="tab-bar" id="ci-tabbar">
      <div class="tab-pill" id="ci-tpill"></div>
      <button class="tab-btn on" onclick="CI._tab(0,this)">ภาพรวม</button>
      <button class="tab-btn" onclick="CI._tab(1,this)">ทักษะ</button>
      <button class="tab-btn" onclick="CI._tab(2,this)">ลูกค้า</button>
      <button class="tab-btn" onclick="CI._tab(3,this)">Transcript</button>
    </div>
  </div>
  <div class="result-body" id="ci-result-body">
    <div class="panel on" id="ci-p0"></div>
    <div class="panel" id="ci-p1"></div>
    <div class="panel" id="ci-p2"></div>
    <div class="panel" id="ci-p3"></div>
  </div>
  <div class="result-cta">
    <button class="btn btn-ghost" onclick="CI.cancel()">ทิ้ง</button>
    <button class="btn btn-primary" onclick="CI._save()">บันทึก</button>
  </div>
  <div id="ci-tl-actions" style="display:none;padding:0 24px 12px;gap:8px;flex-shrink:0">
    <button onclick="CI._openDebrief()" style="flex:1;padding:10px;border-radius:12px;border:0.5px solid rgba(83,74,183,.3);background:rgba(83,74,183,.07);color:#534AB7;font-size:13px;font-weight:500;cursor:pointer;font-family:'Noto Sans Thai',-apple-system,sans-serif">Debrief</button>
    <button onclick="CI._openHistory()" style="flex:1;padding:10px;border-radius:12px;border:0.5px solid rgba(0,0,0,.12);background:rgba(0,0,0,.04);color:var(--tx2,#636366);font-size:13px;font-weight:500;cursor:pointer;font-family:'Noto Sans Thai',-apple-system,sans-serif">ประวัติ</button>
  </div>
</div>`;
  }

  // ── Screen switch ──────────────────────────────────────────────────────────
  function _showScreen(id) {
    ['ci-s-record','ci-s-proc','ci-s-result'].forEach(s => {
      const el = document.getElementById(s);
      if (el) el.classList.toggle('on', s === id);
    });
  }

  // ── Waveform ───────────────────────────────────────────────────────────────
  function _initWaveform() {
    const wf = document.getElementById('ci-wf');
    if (!wf) return;
    const N = 13;
    // Independent random phase offset per bar — true ripple, not synchronized movement
    // Evenly distributed phases — smooth traveling wave, no blocky pattern
    const phases = [0.0000, 0.4833, 0.9666, 1.4500, 1.9333, 2.4166, 2.8999, 3.3833, 3.8666, 4.3499, 4.8332, 5.3165, 5.7999];
    for (let i = 0; i < N; i++) {
      const b = document.createElement('div');
      b.className = 'ci-wb';
      b.style.cssText = 'width:3px;border-radius:3px;transform-origin:bottom;background:rgba(255,56,92,.4);display:inline-block;margin:0 2.5px;transition:background .7s ease';
      wf.appendChild(b);
    }
    let t = 0;
    _waveRef = setInterval(() => {
      t += 0.14;
      const bars = wf.querySelectorAll('.ci-wb');
      bars.forEach((b, i) => {
        // All bars same max height (32px), independent phase → every bar ripples visibly
        const s = (1 + Math.sin(t + phases[i])) / 2; // 0..1, smooth single freq
        const h = 6 + s * 26; // min 6px, max 32px — every bar moves meaningfully
        const op = 0.28 + s * 0.52; // min 0.28, max 0.80
        b.style.height = h.toFixed(1) + 'px';
        b.style.opacity = op.toFixed(2);
      });
    }, 80);
  }

  // ── Tab pill ───────────────────────────────────────────────────────────────
  function _initPill() {
    const bar = document.getElementById('ci-tabbar');
    if (!bar) return;
    const active = bar.querySelector('.tab-btn.on');
    const pill   = document.getElementById('ci-tpill');
    if (!active || !pill) return;
    pill.style.left  = active.offsetLeft + 'px';
    pill.style.width = active.offsetWidth + 'px';
  }

  function _tab(idx, btn) {
    document.querySelectorAll('#ci-fullsheet .panel').forEach((p,i) => p.classList.toggle('on', i === idx));
    document.querySelectorAll('#ci-fullsheet .tab-btn').forEach(b => b.classList.remove('on'));
    btn.classList.add('on');
    const pill = document.getElementById('ci-tpill');
    if (pill) { pill.style.left = btn.offsetLeft + 'px'; pill.style.width = btn.offsetWidth + 'px'; }
    const rb = document.getElementById('ci-result-body');
    if (rb) rb.scrollTop = 0;
  }

  // ── IndexedDB recording buffer (v555) — กู้ session ถ้าแอพถูก kill กลางทาง ──
  const IDB_NAME = 'echo_buffer';
  function _idbOpen() {
    return new Promise((res, rej) => {
      const r = indexedDB.open(IDB_NAME, 1);
      r.onupgradeneeded = () => {
        const db = r.result;
        if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks', { autoIncrement: true });
        if (!db.objectStoreNames.contains('meta'))   db.createObjectStore('meta');
      };
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }
  function _idbPutChunk(blob) {
    _idbOpen().then(db => { db.transaction('chunks','readwrite').objectStore('chunks').add(blob); }).catch(()=>{});
  }
  function _idbSetMeta(meta) {
    _idbOpen().then(db => { db.transaction('meta','readwrite').objectStore('meta').put(meta,'current'); }).catch(()=>{});
  }
  function _idbGetMeta() {
    return _idbOpen().then(db => new Promise(res => {
      const r = db.transaction('meta').objectStore('meta').get('current');
      r.onsuccess = () => res(r.result || null);
      r.onerror   = () => res(null);
    })).catch(() => null);
  }
  function _idbGetChunks() {
    return _idbOpen().then(db => new Promise(res => {
      const r = db.transaction('chunks').objectStore('chunks').getAll();
      r.onsuccess = () => res(r.result || []);
      r.onerror   = () => res([]);
    })).catch(() => []);
  }
  function _idbClear() {
    return _idbOpen().then(db => {
      const tx = db.transaction(['chunks','meta'],'readwrite');
      tx.objectStore('chunks').clear();
      tx.objectStore('meta').clear();
    }).catch(()=>{});
  }

  // ── Recovery — เช็ค buffer ค้างตอนเปิด Echo (rep เท่านั้น, idle เท่านั้น) ──
  async function _checkRecoverBuffer() {
    if (_phase !== 'idle' || _canDebrief()) return;
    const meta = await _idbGetMeta();
    if (!meta) return;
    const chunks = await _idbGetChunks();
    const approxSecs = chunks.length; // timeslice 1s ต่อ chunk
    if (approxSecs < 5) { _idbClear(); return; }
    if (Date.now() - (meta.started_at || 0) > 24*3600*1000) { _idbClear(); return; } // เก่าเกิน 24 ชม. ทิ้ง
    _showRecoverBanner(meta, approxSecs);
  }

  function _showRecoverBanner(meta, secs) {
    const scr = document.getElementById('ci-s-record');
    if (!scr || document.getElementById('ci-recover-banner')) return;
    const div = document.createElement('div');
    div.id = 'ci-recover-banner';
    div.style.cssText = 'margin:4px 24px 8px;padding:12px 14px;border-radius:14px;background:rgba(255,149,0,.08);border:0.5px solid rgba(255,149,0,.25)';
    div.innerHTML = `
      <div style="font-size:12px;font-weight:600;color:#995500;margin-bottom:2px;font-family:'Noto Sans Thai',sans-serif">พบการบันทึกค้าง ${_fmt(secs)} นาที</div>
      <div style="font-size:11px;color:#8e8e93;margin-bottom:8px;font-family:'Noto Sans Thai',sans-serif">${meta.account_name || 'ไม่ระบุร้าน'} · แอพถูกปิดก่อนวิเคราะห์เสร็จ</div>
      <div style="display:flex;gap:8px">
        <button onclick="CI._recoverBuffer()" style="flex:1;padding:9px;border:none;border-radius:10px;background:#FF9500;color:#fff;font-size:12px;font-weight:600;font-family:'Noto Sans Thai',sans-serif;cursor:pointer">วิเคราะห์ต่อ</button>
        <button onclick="CI._discardBuffer()" style="padding:9px 14px;border:0.5px solid rgba(0,0,0,.12);border-radius:10px;background:transparent;color:#8e8e93;font-size:12px;font-family:'Noto Sans Thai',sans-serif;cursor:pointer">ทิ้ง</button>
      </div>`;
    const anchor = document.getElementById('ci-chip-wrap');
    if (anchor && anchor.parentElement === scr) scr.insertBefore(div, anchor);
    else scr.appendChild(div);
  }

  async function _recoverBuffer() {
    const meta   = await _idbGetMeta();
    const chunks = await _idbGetChunks();
    document.getElementById('ci-recover-banner')?.remove();
    if (!chunks.length) { _toast('ไม่พบข้อมูลเสียง'); _idbClear(); return; }
    _accountGuid = meta?.account_guid || null;
    _accountName = meta?.account_name || '';
    _accountSeg  = meta?.account_seg  || '';
    _ownerType   = meta?.owner_type   || _ownerType;
    _secs = chunks.length; _durText = _fmt(_secs);
    _isOwnRecording = true;
    const blob = new Blob(chunks, { type: meta?.mime || 'audio/webm' });
    _phase = 'processing';
    _renderEchoState();
    _showScreen('ci-s-proc');
    _setStep('กำลังวิเคราะห์...', 'กู้คืนจากบันทึกค้าง', 14);
    _processBlob(blob);
  }

  async function _discardBuffer() {
    document.getElementById('ci-recover-banner')?.remove();
    await _idbClear();
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  async function startRecording() {
    document.body.classList.add('echo-active');
    if (_phase !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = _bestMime();
      // audioBitsPerSecond:24000 — opus speech quality balanced with Gemini recognition accuracy
      _recorder    = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 24000 });
      _chunks      = [];
      _secs        = 0;
      _recorder.ondataavailable = e => { if (e.data?.size > 0) { _chunks.push(e.data); _idbPutChunk(e.data); } };
      _recorder.onstop = _onStop;
      // v555: เคลียร์ buffer เก่า + เขียน meta ก่อนเริ่ม — กู้คืนได้ถ้าแอพถูก kill
      try { await _idbClear(); } catch(_) {}
      _idbSetMeta({ account_guid: _accountGuid, account_name: _accountName, account_seg: _accountSeg,
                    owner_type: _ownerType, started_at: Date.now(), mime: mime || 'audio/webm' });
      _recorder.start(1000);
      _startTime = Date.now();
      _phase     = 'recording';
      _isOwnRecording = true; // recording own session
      _acquireWakeLock(); // v587: กันจอดับระหว่างอัด
      // AudioContext keep-alive — iOS audio session keep-alive
      // NOTE: do NOT connect stream to AudioContext (createMediaStreamSource corrupts MediaRecorder signal)
      // Just having AudioContext in 'running' state is sufficient for iOS keep-alive
      try {
        _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        // Resume in case browser suspended it (iOS requires user gesture)
        if (_audioCtx.state === 'suspended') _audioCtx.resume().catch(() => {});
      } catch(_) {}

      // UI — dark mode transition (silent recording feel)
      _applyRecordingTheme(true);

      _timerRef = setInterval(() => {
        // Use Date.now() diff — avoids drift when JS is throttled on screen lock
        _secs = Math.floor((Date.now() - _startTime) / 1000);
        const el = document.getElementById('ci-tval');
        if (el) el.textContent = _fmt(_secs);
        if (_secs >= MAX_SECS) stopRecording();
      }, 1000);

    } catch (err) {
      _phase = 'idle';
      _toast(err.name === 'NotAllowedError' ? 'กรุณาอนุญาตไมโครโฟน' : 'เปิดไมค์ไม่ได้: ' + err.message);
    }
  }

  function stopRecording() {
    if (_phase !== 'recording' || !_recorder) return;
    clearInterval(_timerRef);
    _durText = _fmt(_secs);
    _recorder.stop();
    _recorder.stream.getTracks().forEach(t => t.stop());
    // Close AudioContext keep-alive
    try { if (_audioCtx) { _audioCtx.close(); _audioCtx = null; } } catch(_) {}
    _releaseWakeLock(); // v587
    // Restore white theme before proc/result screens
    _phase = 'processing';
    _applyRecordingTheme(false);
    _showScreen('ci-s-proc');
    _setStep('กำลังวิเคราะห์...', 'Gemini · audio + skills', 14);
  }

  function cancel() {
    clearInterval(_floatTimer);
    document.body.classList.remove('echo-active');
    const pill = document.getElementById('echo-float-pill');
    if (pill) pill.classList.remove('visible');
    // Reset CI fullsheet display if minimized
    const sheet = document.getElementById('ci-fullsheet');
    if (sheet) sheet.style.display = '';
    clearInterval(_timerRef);
    if (_recorder && _phase === 'recording') {
      _recorder.stop();
      _recorder.stream?.getTracks().forEach(t => t.stop());
    }
    // Close AudioContext keep-alive
    try { if (_audioCtx) { _audioCtx.close(); _audioCtx = null; } } catch(_) {}
    _releaseWakeLock(); // v587
    _phase = 'idle';
    _applyRecordingTheme(false);
    _recorder = null; _chunks = [];
    _idbClear(); // ยกเลิกโดยตั้งใจ — ไม่ต้องกู้
    _unmount();
  }

  // ── Processing steps ───────────────────────────────────────────────────────
  let _procStartTime = 0;
  let _procElapsedRef = null;

  function _setStep(step, sub, pct) {
    const ps = document.getElementById('ci-pstep');
    const pb = document.getElementById('ci-psub');
    const pf = document.getElementById('ci-pfill');
    if (ps) ps.textContent = step;
    if (pb) pb.textContent = sub;
    if (pf) pf.style.width = pct + '%';
  }

  function _startProcTimer() {
    _procStartTime = Date.now();
    clearInterval(_procElapsedRef);
    _procElapsedRef = setInterval(() => {
      const el = document.getElementById('ci-pelapsed');
      if (!el) return;
      const secs = Math.floor((Date.now() - _procStartTime) / 1000);
      const m = Math.floor(secs / 60), s = secs % 60;
      el.textContent = `กำลังประมวลผล ${m > 0 ? m + ' นาที ' : ''}${s} วินาที...`;
    }, 1000);
  }

  function _stopProcTimer() {
    clearInterval(_procElapsedRef);
    _procElapsedRef = null;
    const el = document.getElementById('ci-pelapsed');
    if (el) el.textContent = '';
  }

  // ── Audio → Gemini analyze (single call) ──────────────────────────────────
  async function _onStop() {
    const blob = new Blob(_chunks, { type: _recorder?.mimeType || 'audio/webm' });
    _chunks = [];

    // Guard: ถ้า audio เล็กเกินไปหรือ record น้อยกว่า 5 วินาที ยังไม่มีเสียงพอให้วิเคราะห์
    if (blob.size < 8000 || _secs < 5) {
      _phase = 'idle';
      _idbClear();
      _unmount();
      _toast('กรุณาบันทึกอย่างน้อย 5 วินาทีก่อนกด stop');
      return;
    }
    _processBlob(blob);
  }

  // v555: shared pipeline — เรียกจาก _onStop ปกติ และจาก recovery flow
  async function _processBlob(blob) {
    _startProcTimer(); // v598: start elapsed timer
    try {
      // v574: audio integrity check — เทียบขนาด blob กับเวลาที่อัด
      // 24kbps opus ≈ 3,000 bytes/วินาที — ถ้า blob เล็กกว่าที่ควร 30%+
      // = MediaRecorder ถูก interrupt กลางทาง (lock จอ / สลับแอป / โทรเข้า)
      // เสียงช่วงนั้นหายจริง — Gemini จะวิเคราะห์ได้เฉพาะส่วนที่มี
      const _expectedBytes = _secs * 3000;
      const _ratio = _expectedBytes > 0 ? blob.size / _expectedBytes : 1;
      console.log('[CI audio integrity] blob=' + blob.size + 'B expected≈' + _expectedBytes +
        'B (' + _secs + 's) ratio=' + _ratio.toFixed(2));
      if (_secs >= 60 && _ratio < 0.7) {
        const _estMins = Math.round(blob.size / 3000 / 60);
        try { window.SenseSentinel?.report('ci_audio_gap',
          'timer=' + _secs + 's blob=' + blob.size + 'B ratio=' + _ratio.toFixed(2) +
          ' est_audio=' + _estMins + 'min'); } catch(_) {}
        _toast('เสียงที่อัดได้จริง ~' + _estMins + ' นาที (สั้นกว่าเวลาที่จับ) — บางช่วงอาจหายจากการสลับแอพหรือล็อคจอ');
      }

      _setStep('กำลังวิเคราะห์...', 'Gemini · audio + skills', 20);

      // Load rubric from DB if not cached yet
      if (!_rubricCache) await _loadRubricFromDB();

      const result = await _analyzeWithGemini(blob);

      _setStep('กำลังบันทึก...', '', 92);
      await _saveToSupabase(result.skillData, result.intelData, result.transcriptSummary, result.toneSignals);

      _idbClear(); // วิเคราะห์ + บันทึกสำเร็จ — buffer ไม่จำเป็นแล้ว

      _setStep('เสร็จแล้ว', '', 100);
      _stopProcTimer(); // v598
      setTimeout(() => {
        _lastResult = { skillData: result.skillData, intelData: result.intelData,
                        transcriptSummary: result.transcriptSummary, toneSignals: result.toneSignals };
        _renderResult();
        document.getElementById('ci-dur-chip').textContent = _durText;
        _showScreen('ci-s-result');
        setTimeout(_initPill, 80);
      }, 400);

    } catch (err) {
      _stopProcTimer(); // v598
      _phase = 'idle';
      _unmount();
      // v571b: telemetry — ทุก analyze fail เข้า app_errors ให้ตรวจย้อนหลังได้
      try { window.SenseSentinel?.report('ci_analyze_fail',
        err.message.slice(0, 200) + ' | secs=' + _secs + ' | acct=' + (_accountName || '-')); } catch(_) {}
      // buffer คงไว้ — เปิด Echo ใหม่จะเจอ banner กู้คืน วิเคราะห์ซ้ำได้
      // v589: ภาษาคน — ห้ามโชว์ raw JSON ใส่หน้า user · telemetry ข้างบนเก็บ raw ไว้แล้ว
      const _m = String(err.message || '');
      let _human;
      if (/location is not supported/i.test(_m)) {
        _human = 'ระบบ AI ใช้ไม่ได้ชั่วคราว (เส้นทางเครือข่าย)';
      } else if (/503|429|overload|UNAVAILABLE/i.test(_m)) {
        _human = 'ระบบ AI คิวเต็มชั่วคราว';
      } else if (/timeout|aborted|AbortError/i.test(_m)) {
        _human = 'การวิเคราะห์ใช้เวลานานเกินไป';
      } else if (/network|fetch|Failed to fetch/i.test(_m)) {
        _human = 'การเชื่อมต่อขัดข้อง';
      } else {
        _human = 'วิเคราะห์ไม่สำเร็จ';
      }
      _toast(_human + ' — บันทึกเสียงถูกเก็บไว้แล้ว เปิด Echo อีกครั้งแล้วกด "วิเคราะห์ต่อ" ได้เลย');
    }
  }

  // ── AI Analysis ────────────────────────────────────────────────────────────
  //
  // ── AI Analysis — Gemini audio-native ────────────────────────────────────
  //
  // แทน Whisper+Haiku+Sonnet ด้วย Gemini call เดียว
  // รับ audio blob โดยตรง — ไม่ต้อง transcribe ก่อน
  // Rubric โหลดจาก skill_definitions (echo_enabled=true) ไม่ hardcode

  // ── Echo code → skill_code bridge (ยังคงไว้เพราะ kam_skill_log ใช้) ──────
  const ECHO_TO_SKILL_CODE = {
    'A01_PIPC':     'A01_PIPC',
    'A05_VALUE':    'A05_VALUE',
    'B02_DM':       'B02_DM',
    'B03_APPT':     'B03_APPT',
    'C00_RAPPORT':  'C00_RAPPORT',
    'C01_DISCOVERY':'C01_DISCOVERY',
    'C03_ANALYZE':  'C03_ANALYZE',
    'C04_OBJECTION':'C04_OBJECTION',
    'C05_CLOSE':    'C05_CLOSE',
    'D01_WALLET':   'D01_WALLET',
    'D02_FOLLOWUP': 'D02_FOLLOWUP',
    // legacy short codes — backward compat
    'APIPC':'A01_PIPC','A5':'A05_VALUE','B2':'B02_DM','B3':'B03_APPT',
    'C0':'C00_RAPPORT','C1':'C01_DISCOVERY','C3':'C03_ANALYZE',
    'C4':'C04_OBJECTION','C5':'C05_CLOSE','D1':'D01_WALLET','D2':'D02_FOLLOWUP',
  };

  // ── Rubric cache — โหลดจาก DB ครั้งเดียว ──────────────────────────────────
  let _rubricCache = null; // null = ยังไม่โหลด

  async function _loadRubricFromDB() {
    try {
      const { data, error } = await supa
        .from('skill_definitions')
        .select('skill_code,skill_name_en,principle_th,pass_test_th,echo_observable,echo_enabled')
        .eq('echo_enabled', true)
        .order('skill_code');
      if (error) throw error;
      _rubricCache = data || [];
      console.log('[CI] rubric loaded from DB:', _rubricCache.length, 'skills');
    } catch(e) {
      console.warn('[CI] rubric DB load failed, using empty fallback:', e.message);
      _rubricCache = [];
    }
  }

  // ── Build Gemini prompt จาก rubric + account context ──────────────────────
  function _buildGeminiPrompt() {
    // v590: ลด prompt — ตัด account context, กฎเหล็กซ้ำซาก, ตัวอย่าง JSON เต็ม,
    // key_moments instruction ที่บีบให้โมเดลแต่งเรื่องเพื่อให้ครบ
    // เหลือเฉพาะ rubric จาก DB + schema โครงเปล่า + no_speech guard สั้น

    // Skill rubric จาก DB — เฉพาะ code + name + เกณฑ์ผ่าน
    const rubricText = (_rubricCache || []).map(s =>
      `[${s.skill_code}] ${s.skill_name_en}: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}`
    ).join('\n');

    return `ฟัง audio การสนทนาระหว่าง Sales rep กับเจ้าของร้านอาหาร แล้วตอบ JSON ตาม schema ด้านล่าง

ถ้าไม่มีเสียงคนพูดใน audio เลย ตอบ {"no_speech": true} เท่านั้น

ทุกอย่างในคำตอบต้องมาจากเสียงที่ได้ยินจริงเท่านั้น — ถ้าไม่มีหลักฐานในเสียง ให้ปล่อยว่างหรือ not_observed ห้ามเดาหรือเติมเอง ตอบเป็นภาษาไทย ยกเว้น quote คงคำพูดตรงตามที่ได้ยิน

SKILL RUBRIC:
${rubricText}

OCPB (customer intel จากเสียงเท่านั้น):
- O: Operation — การสั่งของ วัน/เวลา ปริมาณ ปัญหา ops
- C: ซัพเดิม ราคา สินค้าที่ใช้
- P: Payment — วิธีจ่าย credit term
- B: Business Plan — แผนขยาย เปิดสาขา เปลี่ยน concept

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "transcript_summary": "",
  "tone_signals": {
    "rep_confidence": "high|medium|low",
    "rep_confidence_note": "",
    "customer_engagement": "increasing|stable|decreasing",
    "customer_engagement_note": "",
    "key_moments": [{"ts": "mm:ss", "quote": "", "note": ""}]
  },
  "skills": [{"code": "", "score": "pass|developing|not_observed|not_applicable", "evidence": "", "gap": "", "coaching_note": ""}],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "",
  "overall": "strong|developing|needs_work",
  "session_summary": "",
  "ocpb_status": {"O": "answered|asked_no_answer|not_asked", "C": "answered|asked_no_answer|not_asked", "P": "answered|asked_no_answer|not_asked", "B": "answered|asked_no_answer|not_asked"},
  "ocpb_facts": [{"dim": "O|C|P|B", "summary": "", "quote": "", "ts": "mm:ss", "tag": "pain_high|pain_medium|opportunity|null"}],
  "next_actions": [{"action": "", "owner": "Sales|TL", "urgency": "3_days|this_week|next_visit", "reason": ""}]
}`;
  }

  // ── v571b: JSON repair — กู้ JSON ที่ถูก truncate กลางทาง ──────────────────
  // Gemini ตอบยาวเกิน max tokens → JSON ขาดท้าย → ตัด incomplete trailing แล้วปิด braces
  function _ciRepairJson(str) {
    // Strategy: เดินจากท้าย ตัดทีละส่วนจน parse ได้ — เก็บ fields ที่สมบูรณ์ไว้มากที่สุด
    // 1) ลองตัดท้าย string ที่ขาด แล้วปิด quote + braces/brackets ที่ค้าง
    for (let cut = str.length; cut > str.length * 0.5; cut = str.lastIndexOf(',', cut - 1)) {
      if (cut <= 0) break;
      let candidate = str.slice(0, cut);
      // นับ braces/brackets ที่ยังเปิดอยู่ (ข้ามที่อยู่ใน string)
      let depth = [], inStr = false, escaped = false;
      for (let i = 0; i < candidate.length; i++) {
        const c = candidate[i];
        if (escaped) { escaped = false; continue; }
        if (c === '\\') { escaped = true; continue; }
        if (c === '"') { inStr = !inStr; continue; }
        if (inStr) continue;
        if (c === '{') depth.push('}');
        else if (c === '[') depth.push(']');
        else if (c === '}' || c === ']') depth.pop();
      }
      if (inStr) candidate += '"';
      while (depth.length) candidate += depth.pop();
      try { return JSON.parse(candidate); } catch(_) { /* ตัดต่อ */ }
    }
    return null;
  }

  // ── Gemini audio analyze — single call ────────────────────────────────────
  async function _analyzeWithGemini(audioBlob) {
    // Convert blob to base64
    const arrayBuf = await audioBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const b64audio = btoa(binary);
    const mimeType = audioBlob.type || 'audio/webm';

    _setStep('กำลังวิเคราะห์...', 'Gemini · ฟัง audio + skill rubric', 35);

    // Retry up to 3 times on 503/429 (Gemini overload) with exponential backoff
    // v571: per-attempt timeout — ไม่ปล่อยให้ "กำลังวิเคราะห์..." ค้างไม่มีวันจบ
    // ถ้าหมดเวลา → throw ชัดเจน → buffer ยังอยู่ → recovery banner ให้ลองใหม่ได้
    const FETCH_TIMEOUT_MS = 240000; // 4 นาที ต่อ attempt (audio ยาว + Gemini ใช้เวลาคิด)
    let res, lastErr;
    const _payload = JSON.stringify({ audio_b64: b64audio, mime_type: mimeType, prompt: _buildGeminiPrompt() });
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        const delay = attempt === 2 ? 3000 : 7000; // 3s then 7s
        // v598: ชัดเจนว่า retry ครั้งไหน + progress bar เดินต่อ
        _setStep(`ลองใหม่ครั้งที่ ${attempt - 1}/2...`, 'Gemini · ระบบ AI คิวเต็ม — กำลังรอสักครู่', 35 + (attempt - 1) * 10);
        await new Promise(r => setTimeout(r, delay));
        _setStep(`กำลังวิเคราะห์... (attempt ${attempt}/3)`, 'Gemini · ฟัง audio + skill rubric', 35 + (attempt - 1) * 10);
      }
      const _ctrl = new AbortController();
      const _tmo  = setTimeout(() => _ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(`${WORKER_URL}/analyze-audio`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: _payload,
          signal: _ctrl.signal,
        });
        if (res.ok) {
          // v598: reset step text on success — ไม่ให้ "attempt 3/3" ค้างขณะ parse
          _setStep('กำลังประมวลผลผล...', 'Gemini · แปลงผล', 75);
          break;
        }
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Gemini ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) throw lastErr; // don't retry on other errors
        res = null; // mark as failed, will retry
      } catch(e) {
        if (e.name === 'AbortError') throw new Error('หมดเวลารอผลวิเคราะห์ (4 นาที)');
        if (e.message && !e.message.startsWith('Gemini 503') && !e.message.startsWith('Gemini 429')) throw e;
        lastErr = e;
      } finally {
        clearTimeout(_tmo);
      }
    }
    if (!res || !res.ok) throw lastErr || new Error('Gemini unavailable after 3 attempts');
    const data = await res.json();
    const raw = data?.text || data?.content?.[0]?.text || '';
    // v571b: log ทั้งหัวและท้าย — เห็นว่า response จบสมบูรณ์หรือถูก truncate
    console.log('[CI Gemini raw head]', raw.substring(0, 300));
    console.log('[CI Gemini raw tail]', raw.length > 300 ? raw.substring(raw.length - 300) : '(same as head)', '| total len:', raw.length);

    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) {
      try { window.SenseSentinel?.report('ci_gemini_nojson', 'len=' + raw.length + ' head=' + raw.substring(0, 200)); } catch(_) {}
      throw new Error('Gemini no JSON: ' + raw.substring(0, 120));
    }
    // v571b: robust parse — Gemini ตอบ JSON ยาว (audio นาน → 12 skills + intel ครบ)
    // อาจถูก truncate ที่ max output tokens → JSON ขาดท้าย → ซ่อมก่อน parse
    let parsed;
    const _jsonStr = raw.slice(s, e + 1);
    try {
      parsed = JSON.parse(_jsonStr);
    } catch (parseErr) {
      console.warn('[CI] JSON.parse failed, attempting repair:', parseErr.message);
      try { window.SenseSentinel?.report('ci_gemini_badjson',
        'len=' + raw.length + ' err=' + parseErr.message.slice(0, 100) +
        ' tail=' + raw.substring(Math.max(0, raw.length - 200))); } catch(_) {}
      parsed = _ciRepairJson(_jsonStr);
      if (!parsed) throw new Error('Gemini ตอบไม่สมบูรณ์ (JSON ขาด ' + raw.length + ' ตัวอักษร) — อาจเพราะบทสนทนายาวมาก');
      console.log('[CI] JSON repaired successfully');
    }

    // Split combined response into skillData + intelData + new fields
    const skillData = {
      no_speech:       parsed.no_speech || false,   // ← Gemini บอกว่าไม่มีเสียง
      skills:          parsed.skills || [],
      pipc_stage:      parsed.pipc_stage || null,
      pipc_reached:    parsed.pipc_reached || null,
      overall:         parsed.overall || null,
      session_summary: parsed.session_summary || null,
    };
    const intelData = {
      // v582: OCPB fact capture — แทน buyer_type/wallet/ocpb_covered/pain_points/upsell_signals
      // (ตัด Wallet/BANK ออกเพราะไม่มี rubric ที่เชื่อถือได้ — user decision 12 มิ.ย. 69)
      ocpb_status:  parsed.ocpb_status || null,
      ocpb_facts:   Array.isArray(parsed.ocpb_facts) ? parsed.ocpb_facts : [],
      next_actions: parsed.next_actions || [],
    };

    return {
      skillData,
      intelData,
      transcriptSummary: parsed.transcript_summary || null,
      toneSignals:       parsed.tone_signals || null,
    };
  }


  // ── Supabase save ──────────────────────────────────────────────────────────
  async function _saveToSupabase(skillData, intelData, transcriptSummary, toneSignals) {
    if (!skillData && !intelData) return;
    const email = currentUserProfile?.email;
    if (!email) return;
    const today = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    // 1. Save ci_sessions row
    try {
      const { data: sessionRow, error: sessionErr } = await supa.from('ci_sessions').insert({
        owner_email:        email,
        owner_type:         _ownerType,
        account_id:         _accountGuid || null,
        account_name:       _accountName || null,
        visited_at:         nowIso,
        duration_secs:      _secs,
        skill_scores:       skillData || null,
        customer_intel:     intelData || null,
        next_actions:       intelData?.next_actions || [],
        transcript_summary: transcriptSummary || null,
        tone_signals:       toneSignals || null,
        // Check-in GPS — merged from _checkinCache (rep tapped check-in orb before recording)
        rep_lat:            _checkinCache?.rep_lat || null,
        rep_lng:            _checkinCache?.rep_lng || null,
        checked_in_at:      _checkinCache?.checked_in_at || null,
        status:             'saved'
      }).select('id').single();
      if (sessionErr) console.warn('[CI] ci_sessions insert (table may not exist yet):', sessionErr.message);
      else if (sessionRow) {
        _sessionId = sessionRow.id;
        // Clear checkin cache after successful save
        _checkinCache = null;
        try { localStorage.removeItem('ci_checkin_cache'); } catch(_) {}
      }
    } catch(e) { console.warn('[CI] ci_sessions unavailable:', e.message); }

    // 2. Save skill log rows (all roles — Sales uses account_name fallback when no guid)
    if (skillData?.skills?.length) {
      // v579: account_name removed — column ไม่มีใน kam_skill_log schema (เคยทำให้ 400 ทุกครั้ง)
      // ชื่อร้านดูได้จาก ci_sessions ผ่าน ci_session_id อยู่แล้ว
      const rows = skillData.skills.map(s => ({
        kam_email: email,
        account_id: _accountGuid || null,
        session_date: today, skill_code: s.code,
        score: s.score,
        evidence_summary: s.evidence || s.evidence_summary || '',
        ci_session_id: _sessionId || null
      }));
      const { error } = await supa.from('kam_skill_log').insert(rows);
      if (error) console.warn('[CI] kam_skill_log insert error:', error.message);
    }

    // 3. Write echo_skill_observations — bridge to Skills feature
    //    Auto-send all skills (pass/developing/not_observed/not_applicable)
    //    TL sees these as evidence in pending list — graceful fail if table not yet created
    if (skillData?.skills?.length && !skillData?.no_speech) {
      try {
        // Get current user_id from Supabase session
        let _userId = null;
        try {
          const _sk = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
          if (_sk) { const _ss = JSON.parse(localStorage.getItem(_sk)); _userId = _ss?.user?.id || null; }
        } catch(_) {}

        if (_userId) {
          const obsRows = skillData.skills.map(s => ({
            session_id:    _sessionId || null,
            user_id:       _userId,
            skill_code:    ECHO_TO_SKILL_CODE[s.code] || s.code,
            echo_code:     s.code,
            ai_score:      s.score,
            evidence:      s.evidence || s.evidence_summary || null,
            coaching_note: s.coaching_note || null,
            gap:           s.gap || null,
            observed_at:   nowIso,
          }));
          const { error: obsErr } = await supa.from('echo_skill_observations').insert(obsRows);
          if (obsErr) console.warn('[CI] echo_skill_observations insert (table may not exist yet):', obsErr.message);
          else console.log('[CI] echo_skill_observations: saved', obsRows.length, 'rows');
        }
      } catch(e) { console.warn('[CI] echo_skill_observations unavailable:', e.message); }
    }

    // 4. Update kam_visits latest snapshot (KAM only)
    if (_accountGuid) {
      const { error: visitError } = await supa.from('kam_visits').upsert({
        kam_email: email, account_id: _accountGuid,
        ci_skill_scores: skillData, ci_customer_signals: intelData,
        ci_next_actions: intelData?.next_actions || [], ci_mode: 'echo',
        ci_created_at: nowIso, last_seen: nowIso, modes: ['echo']
      }, { onConflict: 'kam_email,account_id' });
      if (visitError) console.warn('[CI] kam_visits upsert error:', visitError.message);
    }

    // 5. Write echo visit to localStorage (fast, for portview dot)
    if (_accountGuid) {
      try {
        const _echoKey = 'ciq_echo_visits';
        const _store = JSON.parse(localStorage.getItem(_echoKey) || '{}');
        const _eKey = email + '::' + _accountGuid;
        _store[_eKey] = { ts: Date.now(), count: (_store[_eKey]?.count || 0) + 1 };
        // Prune entries older than 30 days
        const _cutoff = Date.now() - 30*24*60*60*1000;
        Object.keys(_store).forEach(k => { if (_store[k].ts < _cutoff) delete _store[k]; });
        localStorage.setItem(_echoKey, JSON.stringify(_store));
      } catch(e) { /* non-fatal */ }
    }
  }

  // ── Render result panels ───────────────────────────────────────────────────
  function _renderResult() {
    const { skillData, intelData, transcriptSummary, toneSignals } = _lastResult;

    // Guard: ถ้า Gemini บอกว่าไม่มีเสียง ให้แสดง error แทน
    if (skillData?.no_speech) {
      const noSpeechHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;gap:16px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <div style="font-size:15px;font-weight:600;color:var(--tx,#1C1C1E)">ไม่พบเสียงการสนทนา</div>
          <div style="font-size:13px;color:var(--tx2,#636366);line-height:1.6;max-width:260px">
            Audio ที่ส่งไปไม่มีเสียงพูด หรือเสียงเบาเกินไป<br>กรุณาลองบันทึกใหม่ และตรวจสอบว่าไมโครโฟนทำงานได้
          </div>
        </div>`;
      document.getElementById('ci-p0').innerHTML = noSpeechHTML;
      document.getElementById('ci-p1').innerHTML = noSpeechHTML;
      document.getElementById('ci-p2').innerHTML = noSpeechHTML;
      document.getElementById('ci-p3').innerHTML = noSpeechHTML;
      const tlDiv = document.getElementById('ci-tl-actions');
      if (tlDiv) tlDiv.style.display = 'none';
      return;
    }

    // v586: sd2 redesign — โครงเดียวกับ session detail (v568): ภาพรวม/ทักษะ/ลูกค้า/Transcript
    // narrative-first: เปิดมาเจอ tone + สรุป + key moments เด่น ก่อน drill ลงฟอร์ม
    document.getElementById('ci-p0').innerHTML = _overviewPanel(transcriptSummary, toneSignals);
    document.getElementById('ci-p1').innerHTML = _skillsPanel(skillData);
    document.getElementById('ci-p2').innerHTML = _customerPanel(intelData);
    document.getElementById('ci-p3').innerHTML = _transcriptPanel(toneSignals);
    const tlDiv = document.getElementById('ci-tl-actions');
    // Show Debrief only when reviewing someone else's session, not when TL/Admin records own
  if (tlDiv) tlDiv.style.display = (_canDebrief() && !_isOwnRecording) ? 'flex' : 'none';
  }

  // ── v586: ภาพรวม panel — sd2 design (mirror session detail pane1) ─────────
  function _overviewPanel(summary, tone) {
    const thaiConf = { high:'มั่นใจ', medium:'ปานกลาง', low:'ยังไม่มั่นใจ', not_applicable:'—', n_a:'—', na:'—' };
    const thaiEng  = { increasing:'ดีขึ้น', stable:'คงที่', declining:'ลดลง', not_applicable:'—', n_a:'—', na:'—' };
    let toneHtml = '';
    if (tone) {
      const _conf = tone.rep_confidence;
      const _eng  = tone.customer_engagement;
      // v599: not_applicable / missing → neutral grey ไม่ใช่ red
      const cConf = _conf==='high'?'#1F8A43':_conf==='medium'?'#B26A00':(_conf==='low'?'#C73E3E':'#8E8E93');
      const cEng  = _eng==='increasing'?'#1F8A43':_eng==='stable'?'#B26A00':(_eng==='declining'?'#C73E3E':'#8E8E93');
      const confTxt = thaiConf[_conf] || (_conf ? '—' : '—');
      const engTxt  = thaiEng[_eng]   || (_eng  ? '—' : '—');
      // ซ่อน card ทั้งหมดถ้าทั้งคู่เป็น not_applicable (เช่น sales session ที่ไม่มี rep)
      const bothNA = (!_conf || _conf==='not_applicable') && (!_eng || _eng==='not_applicable');
      if (!bothNA) {
        toneHtml = `<div class="sd2-lbl">Tone &amp; Energy</div>
<div class="sd2-tone">
  <div class="sd2-tcard"><div class="k">Confidence</div><div class="v" style="color:${cConf}">${confTxt}</div><div class="n">${tone.rep_confidence_note||''}</div></div>
  <div class="sd2-tcard"><div class="k">Engagement</div><div class="v" style="color:${cEng}">${engTxt}</div><div class="n">${tone.customer_engagement_note||''}</div></div>
</div>`;
      }
    }
    const summaryHtml = summary
      ? `<div class="sd2-lbl">สรุปบทสนทนา</div><div class="sd2-sum">${summary}</div>` : '';
    const allM = (tone?.key_moments||[]).map(m => _kmText(m)).filter(Boolean);
    const top  = allM.slice(0, 5);
    const momentsHtml = top.length
      ? `<div class="sd2-lbl">Key Moments${allM.length>5?` · เด่นสุด 5 จาก ${allM.length}`:''}</div>`
        + top.map(x => `<div style="font-size:14px;color:#1C1C1E;line-height:1.7;padding:8px 0;border-bottom:0.5px solid #ECECF0">${x}</div>`).join('')
        + (allM.length>5 ? `<div style="font-size:12px;color:#8E8E93;padding-top:8px">ดูครบ ${allM.length} จุดได้ใน tab Transcript</div>` : '')
      : '';
    return (toneHtml + summaryHtml + momentsHtml)
      || `<div style="padding:24px;text-align:center;font-size:13px;color:#AEAEB2">ไม่มีข้อมูลภาพรวม</div>`;
  }

  function _skillsPanel(d) {
    const shortBanner = (d?._short_transcript)
      ? `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:rgba(255,149,0,.08);border-radius:12px;margin-bottom:16px;border:0.5px solid rgba(255,149,0,.2)">
          <div style="flex-shrink:0;display:flex;align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning,#FF9500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <div>
            <div style="font-size:12px;font-weight:500;color:#FF9500;margin-bottom:2px">Transcript สั้น (${d._word_count||'?'} คำ)</div>
            <div style="font-size:11px;color:var(--tx2,#636366);line-height:1.5">Skill analysis ต้องการอย่างน้อย 80 คำ — บันทึกนานขึ้นเพื่อผลที่แม่นยำกว่านี้</div>
          </div>
        </div>`
      : '';
    const PIPC_STAGES = ['Prepare','Identify','Probe','Close'];
    const stageIdx = PIPC_STAGES.indexOf(d?.pipc_stage);
    const reached = stageIdx >= 0 ? stageIdx : 0;
    const segs = PIPC_STAGES.map((l,i) =>
      `<div class="pipc-seg${i<=reached?' done':''}"></div>`).join('');
    const lbls = PIPC_STAGES.map((l,i) =>
      `<span class="pipc-lbl${i<=reached?' done':''}">${l}</span>`).join('');

    const summary = d?.session_summary
      ? `<div class="sd2-lbl">สรุปทักษะ</div><div class="sd2-sum" style="margin-bottom:6px">${d.session_summary}</div>`
      : '';

    // v586: sd2 rows — module dot system (v569 app-wide) + ชื่อ skill จาก rubric DB
    const _rbName = c => { const r = (_rubricCache||[]).find(x => x.skill_code === c); return (r && r.skill_name_en) || ''; };
    const stMap = { pass:['ทำได้ดี','ok'], developing:['กำลังพัฒนา','dev'], not_applicable:['N/A','no'] };
    const rows = (d?.skills||[]).map(s => {
      const dotColor = (typeof window._skDotColor === 'function')
        ? window._skDotColor(s.code, s.score)
        : (s.score==='pass'?'#34C759':s.score==='developing'?'#FF9500':'#D1D1D6');
      const st = stMap[s.score] || ['ไม่พบ','no'];
      const ev   = (s.evidence||s.evidence_summary) && s.evidence!=='-' ? `<div class="sd2-sev">${s.evidence||s.evidence_summary}</div>` : '';
      const gap  = s.gap && s.gap !== '-' ? `<div style="font-size:12.5px;color:#8E8E93;line-height:1.6;margin-top:3px">ขาด: ${s.gap}</div>` : '';
      const note = s.coaching_note && s.coaching_note !== '-' ? `<div class="sd2-snote">${s.coaching_note}</div>` : '';
      return `<div class="sd2-srow">
        <span class="sd2-sdot" style="background:${dotColor}"></span>
        <div style="flex:1;min-width:0">
          <div class="sd2-scode">${s.code||''}</div>
          <div class="sd2-sname">${s.name || _rbName(s.code)}</div>
          ${ev}${gap}${note}
        </div>
        <span class="sd2-sstate ${st[1]}">${st[0]}</span>
      </div>`;
    }).join('');

    return shortBanner + `<div class="sd2-lbl">PIPC Progress</div>
      <div class="pipc-track">${segs}</div>
      <div class="pipc-labels">${lbls}</div>
      ${summary}${rows}`;
  }

  function _customerPanel(d) {
    // v582 fact capture · v586 sd2 polish — type scale 14px, state pills แบบ sd2-sstate,
    // มิติที่ยังไม่แตะยุบเหลือบรรทัดเดียว, Next Steps ต่อท้าย pane (โครงเดียวกับ session detail)
    const DIMS = [
      ['O','Operation ของร้าน'],
      ['C','ซัพเดิม · ราคา · สินค้า'],
      ['P','Payment · Billing'],
      ['B','Business Plan'],
    ];
    const TAGS = {
      pain_high:   ['pain · high','rgba(255,59,48,.08)','#C73E3E'],
      pain_medium: ['pain · med','rgba(255,149,0,.08)','#B26A00'],
      opportunity: ['โอกาส','rgba(52,199,89,.08)','#1F8A43'],
    };
    const ST = {
      answered:        ['ได้ข้อมูล','ok'],
      asked_no_answer: ['ถามแล้ว ไม่ได้คำตอบ','dev'],
      not_asked:       ['ยังไม่แตะ','no'],
    };
    const facts  = Array.isArray(d?.ocpb_facts) ? d.ocpb_facts : [];
    const status = d?.ocpb_status || {};

    const blocks = DIMS.map(([dim, label]) => {
      const fs = facts.filter(f => f && f.dim === dim);
      const stKey = status[dim] || (fs.length ? 'answered' : 'not_asked');
      const st = ST[stKey] || ST.not_asked;
      // มิติที่ไม่มีใครแตะ — ยุบเหลือบรรทัดเดียว ไม่กินสายตา (ช่องว่างคือคำตอบ ไม่ใช่ความผิด)
      if (!fs.length && stKey === 'not_asked') {
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 0;border-bottom:0.5px solid #ECECF0">
          <span style="font-size:13px;color:#AEAEB2">${dim} — ${label}</span>
          <span class="sd2-sstate no">${st[0]}</span>
        </div>`;
      }
      const rows = fs.map(f => {
        const tg = TAGS[f.tag];
        const tagChip = tg
          ? `<span style="background:${tg[1]};color:${tg[2]};font-size:11px;font-weight:500;padding:2px 9px;border-radius:999px;margin-right:7px;white-space:nowrap">${tg[0]}</span>`
          : '';
        const quote = (f.quote && String(f.quote).trim())
          ? `<div class="sd2-sev">&ldquo;${f.quote}&rdquo;${f.ts ? ` <span style="font-family:var(--mono,'IBM Plex Mono',monospace);font-size:11px;color:#8E8E93">${f.ts}</span>` : ''}</div>`
          : '';
        return `<div style="padding:8px 0 8px 2px">
          <div style="font-size:14px;color:#1C1C1E;line-height:1.7">${tagChip}${f.summary || '-'}</div>
          ${quote}
        </div>`;
      }).join('');
      const empty = fs.length ? '' :
        `<div style="font-size:12.5px;color:#8E8E93;padding:6px 0 6px 2px">rep ถามแล้ว แต่ยังไม่ได้คำตอบจากลูกค้า</div>`;
      return `<div style="padding:11px 0;border-bottom:0.5px solid #ECECF0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:14px;font-weight:600;color:#1C1C1E">${dim} — ${label}</span>
          <span class="sd2-sstate ${st[1]}">${st[0]}</span>
        </div>
        ${rows}${empty}
      </div>`;
    }).join('');

    // Next Steps — ต่อท้าย pane ลูกค้า (mirror session detail)
    const nexts = (d?.next_actions||[]).map((a,i) => {
      const ul = a.urgency==='3_days'?'ภายใน 3 วัน':a.urgency==='this_week'?'สัปดาห์นี้':'visit ถัดไป';
      return `<div class="sd2-next"><span class="num">${String(i+1).padStart(2,'0')}</span><div><div>${a.action||''}</div><div style="font-size:12px;color:#8E8E93;margin-top:3px">${a.owner||''} · ${ul}${a.reason?` — ${a.reason}`:''}</div></div></div>`;
    }).join('');
    const nextsHtml = nexts ? `<div class="sd2-lbl">Next Steps</div>${nexts}` : '';

    const hasIntel = facts.length || Object.keys(status).length;
    const intelHtml = hasIntel
      ? `<div class="sd2-lbl">ข้อมูลลูกค้า (OCPB)</div>${blocks}`
      : (nextsHtml ? '' : `<div style="padding:24px;text-align:center;font-size:13px;color:#AEAEB2">ยังไม่มีข้อมูลลูกค้าจาก session นี้</div>`);
    return intelHtml + nextsHtml;
  }

  function _transcriptPanel(tone, transcriptSummary) {
    // v586: Transcript = บ้านของ full transcript + key moments ครบทุกจุด
    // v599: รับ transcriptSummary เพิ่ม — แสดงเมื่อ overview ไม่ได้โชว์ (session detail path)
    const summaryHtml = transcriptSummary
      ? `<div class="sd2-lbl">สรุปบทสนทนา</div><div class="sd2-sum">${transcriptSummary}</div>`
      : '';
    const allM = (tone?.key_moments||[]).map(m => _kmText(m)).filter(Boolean);
    const momentsHtml = allM.length
      ? `<div class="sd2-lbl">Key Moments ทั้งหมด · ${allM.length} จุด</div>`
        + allM.map(x => `<div style="font-size:14px;color:#1C1C1E;line-height:1.7;padding:8px 0;border-bottom:0.5px solid #ECECF0">${x}</div>`).join('')
      : '';
    return (summaryHtml + momentsHtml)
      || `<div style="padding:24px;text-align:center;font-size:13px;color:#AEAEB2">ยังไม่มี transcript จาก session นี้</div>`;
  }


  // ── CI_TL_DEBRIEF ───────────────────────────────────────────────────────────
  // TL/Admin เท่านั้น — override AI score per skill + เพิ่ม coaching note
  // เปิดจาก "Debrief" button ใน result screen
  // Save ลง kam_skill_log.tl_override + tl_note

  let _debriefOverrides = {}; // { skillCode: { score, note } }

  function _canDebrief() {
    // v498: ad_tl can also debrief their team sessions
    // v551: sales_tl added — sees covisit panel + team history
    return isTLRole(getCurrentRole()) || isAdminRole(getCurrentRole()) || isADTLRole(getCurrentRole()) || isSalesTLRole(getCurrentRole());
  }

  function _buildDebriefCSS() {
    return `
#ci-debrief-sheet {
  position:fixed;top:0;bottom:0;left:50%;
  width:100%;max-width:440px;
  transform:translateX(-50%) translateY(100%);
  z-index:10000;
  padding-top:env(safe-area-inset-top,44px);
  background:#FFFFFF;
  font-family:'Noto Sans Thai',sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
}
#ci-debrief-sheet.open { transform:translateX(-50%) translateY(0); }
.db-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 24px 12px;border-bottom:0.5px solid var(--n-100,#E5E5EA);
  flex-shrink:0;
}
.db-title { font-size:15px;font-weight:500;color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.db-role-chip {
  font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;
  font-family:'Noto Sans Thai',sans-serif;
  padding:3px 8px;border-radius:100px;
  background:rgba(83,74,183,.1);color:#534AB7;
}
.db-body { flex:1;overflow-y:auto;padding:16px 24px;-webkit-overflow-scrolling:touch; }
.db-body::-webkit-scrollbar { display:none; }
.db-skill-row {
  padding:14px 0;border-bottom:0.5px solid var(--n-100,#E5E5EA);
}
.db-skill-row:last-child { border-bottom:none; }
.db-skill-head {
  display:flex;align-items:center;justify-content:space-between;
  margin-bottom:8px;gap:10px;
}
.db-skill-name { font-size:13px;font-weight:500;color:var(--n-900,#1C1C1E);letter-spacing:-.02em;flex:1; }
.db-ai-badge {
  font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;
  font-family:'Noto Sans Thai',sans-serif;
  padding:2px 7px;border-radius:100px;flex-shrink:0;
}
.db-ai-badge.pass { background:rgba(52,199,89,.12);color:#1a7a38; }
.db-ai-badge.dev  { background:rgba(255,149,0,.12);color:#a05800; }
.db-ai-badge.no   { background:rgba(0,0,0,.06);color:#888; }
.db-evidence { font-size:11px;color:var(--n-400,#636366);line-height:1.5;margin-bottom:8px; }
.db-override-row { display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap; }
.db-pill {
  padding:5px 12px;border-radius:100px;border:0.5px solid rgba(0,0,0,.12);
  font-size:11px;font-weight:500;font-family:'Noto Sans Thai',sans-serif;
  letter-spacing:.04em;cursor:pointer;background:rgba(0,0,0,.03);
  color:var(--n-400,#636366);transition:background 100ms,color 100ms,border-color 100ms;
}
.db-pill.sel-pass   { background:rgba(52,199,89,.12);color:#1a7a38;border-color:rgba(52,199,89,.3); }
.db-pill.sel-dev    { background:rgba(255,149,0,.12);color:#a05800;border-color:rgba(255,149,0,.3); }
.db-pill.sel-no     { background:rgba(0,0,0,.07);color:#555;border-color:rgba(0,0,0,.18); }
.db-pill.sel-na     { background:rgba(0,0,0,.04);color:#aaa;border-color:rgba(0,0,0,.1); }
.db-note {
  width:100%;box-sizing:border-box;
  border:0.5px solid rgba(0,0,0,.14);border-radius:10px;
  padding:9px 12px;font-size:12px;font-family:'Noto Sans Thai',sans-serif;
  color:var(--n-900,#1C1C1E);background:rgba(255,255,255,.7);
  resize:none;min-height:52px;outline:none;line-height:1.5;
  transition:border-color 150ms;
}
.db-note:focus { border-color:rgba(255,56,92,.35); }
.db-note::placeholder { color:var(--n-200,#AEAEB2); }
.db-footer {
  padding:12px 24px 36px;display:flex;gap:8px;flex-shrink:0;
  border-top:0.5px solid var(--n-100,#E5E5EA);
}
.db-btn {
  flex:1;padding:13px;border-radius:14px;border:none;
  font-family:'Noto Sans Thai',sans-serif;font-size:15px;
  font-weight:500;letter-spacing:-.02em;cursor:pointer;
  transition:opacity 60ms,transform 60ms;
}
.db-btn:active { transform:scale(.97);opacity:.85; }
.db-btn-primary { background:#FF385C;color:#fff; }
.db-btn-primary:hover { background:#e02d50; }
.db-btn-ghost { background:rgba(0,0,0,.045);color:var(--n-400,#636366); }
.db-saving { text-align:center;font-size:12px;color:var(--n-200,#AEAEB2);padding:4px 0; }
`;
  }

  function _openDebrief() {
    if (!_canDebrief() || !_lastResult?.skillData) return;
    _debriefOverrides = {};

    // Inject CSS once
    if (!document.getElementById('ci-debrief-style')) {
      const s = document.createElement('style');
      s.id = 'ci-debrief-style';
      s.textContent = _buildDebriefCSS();
      document.head.appendChild(s);
    }

    // Remove old sheet if exists
    document.getElementById('ci-debrief-sheet')?.remove();

    const skills = _lastResult.skillData.skills || [];
    const rows = skills.map(s => {
      const dc = s.score==='pass'?'pass':s.score==='developing'?'dev':'no';
      const bl = s.score==='pass'?'Pass':s.score==='developing'?'Developing':s.score==='not_applicable'?'N/A':'Not observed';
      const ev = s.evidence || s.evidence_summary || '-';
      return `<div class="db-skill-row" data-code="${s.code}">
        <div class="db-skill-head">
          <span class="db-skill-name">${s.code} · ${s.name||s.code}</span>
          <span class="db-ai-badge ${dc}">AI: ${bl}</span>
        </div>
        <div class="db-evidence">${ev}</div>
        <div class="db-override-row">
          <button class="db-pill" data-code="${s.code}" data-val="pass" onclick="CI._debriefPick(this)">Pass</button>
          <button class="db-pill" data-code="${s.code}" data-val="developing" onclick="CI._debriefPick(this)">Developing</button>
          <button class="db-pill" data-code="${s.code}" data-val="not_observed" onclick="CI._debriefPick(this)">Not observed</button>
          <button class="db-pill" data-code="${s.code}" data-val="not_applicable" onclick="CI._debriefPick(this)">N/A</button>
        </div>
        <textarea class="db-note" placeholder="Coaching note สำหรับ rep (optional)" rows="2"
          oninput="CI._debriefNote('${s.code}', this.value)"></textarea>
      </div>`;
    }).join('');

    const sheet = document.createElement('div');
    sheet.id = 'ci-debrief-sheet';
    sheet.innerHTML = `
      <div class="db-header">
        <span class="db-title">TL Debrief</span>
        <span class="db-role-chip">${roleLabel(getCurrentRole())}</span>
      </div>
      <div class="db-body">${rows}</div>
      <div class="db-footer">
        <button class="db-btn db-btn-ghost" onclick="CI._closeDebrief()">ยกเลิก</button>
        <button class="db-btn db-btn-primary" id="db-save-btn" onclick="CI._saveDebrief()">บันทึก Debrief</button>
      </div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));
  }

  function _debriefPick(btn) {
    const code = btn.dataset.code;
    const val  = btn.dataset.val;
    // Deselect siblings
    btn.closest('.db-override-row').querySelectorAll('.db-pill').forEach(b => {
      b.className = 'db-pill';
    });
    // Select this
    const cls = {pass:'sel-pass',developing:'sel-dev',not_observed:'sel-no',not_applicable:'sel-na'}[val]||'sel-no';
    btn.classList.add(cls);
    if (!_debriefOverrides[code]) _debriefOverrides[code] = {};
    _debriefOverrides[code].score = val;
  }

  function _debriefNote(code, val) {
    if (!_debriefOverrides[code]) _debriefOverrides[code] = {};
    _debriefOverrides[code].note = val;
  }

  function _closeDebrief() {
    const sheet = document.getElementById('ci-debrief-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 400);
  }

  async function _saveDebrief() {
    if (!_lastResult?.skillData) return;
    const btn = document.getElementById('db-save-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

    const tlEmail = currentUserProfile?.email;
    const today   = new Date().toISOString().split('T')[0];
    const rows = [];

    (_lastResult.skillData.skills || []).forEach(s => {
      const override = _debriefOverrides[s.code];
      if (!override?.score && !override?.note) return; // ไม่มีการเปลี่ยนแปลง
      rows.push({
        kam_email:        _lastResult.repEmail || tlEmail,
        account_id:       _accountGuid,
        session_date:     today,
        skill_code:       s.code,
        score:            s.score,          // AI score เดิม
        evidence_summary: s.evidence || s.evidence_summary || '',
        tl_override:      override.score || null,
        tl_note:          override.note  || null,
      });
    });

    if (rows.length === 0) { _closeDebrief(); return; }

    try {
      const { error } = await supa.from('kam_skill_log').insert(rows);
      if (error) throw error;
      _closeDebrief();
      _toast('บันทึก Debrief แล้ว');
    } catch(e) {
      console.warn('[CI debrief save]', e.message);
      if (btn) { btn.disabled = false; btn.textContent = 'บันทึก Debrief'; }
      _toast('บันทึกไม่สำเร็จ: ' + e.message);
    }
  }


  // ── CI_HISTORY ──────────────────────────────────────────────────────────────
  // ดูประวัติ CI sessions ย้อนหลัง per account
  // KAM เห็นของตัวเอง, TL/admin เห็นทุก rep ใน account นั้น

  async function _loadHistory() {
    const email = currentUserProfile?.email;
    if (!_accountGuid || !email) return [];
    try {
      let query = supa
        .from('kam_skill_log')
        .select('*')
        .eq('account_id', _accountGuid)
        .order('session_date', { ascending: false })
        .order('created_at', { ascending: false });

      // KAM เห็นเฉพาะของตัวเอง
      if (!_canDebrief()) query = query.eq('kam_email', email);

      const { data, error } = await query.limit(200);
      if (error) throw error;
      return data || [];
    } catch(e) {
      console.warn('[CI history]', e.message);
      return [];
    }
  }

  function _groupHistoryBySessions(rows) {
    // Group by (kam_email, session_date) — แต่ละ session = 1 วัน + 1 rep
    const map = {};
    rows.forEach(r => {
      const key = `${r.kam_email}__${r.session_date}`;
      if (!map[key]) map[key] = { kam_email: r.kam_email, session_date: r.session_date, skills: [] };
      map[key].skills.push(r);
    });
    return Object.values(map).sort((a,b) => b.session_date.localeCompare(a.session_date));
  }

  function _buildHistoryCSS() {
    return `
#ci-history-sheet {
  position:fixed;top:0;bottom:0;left:50%;
  width:100%;max-width:440px;
  transform:translateX(-50%) translateY(100%);
  z-index:10000;
  padding-top:env(safe-area-inset-top,44px);
  background:#FFFFFF;
  font-family:'Noto Sans Thai',sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
}
#ci-history-sheet.open { transform:translateX(-50%) translateY(0); }
.hist-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 24px 12px;border-bottom:0.5px solid var(--n-100,#E5E5EA);flex-shrink:0;
}
.hist-title { font-size:15px;font-weight:500;color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.hist-close { font-size:15px;color:var(--n-400,#636366);cursor:pointer;padding:4px; }
.hist-body { flex:1;overflow-y:auto;padding:12px 24px 24px;-webkit-overflow-scrolling:touch; }
.hist-body::-webkit-scrollbar { display:none; }
.hist-empty { text-align:center;padding:48px 0;font-size:13px;color:var(--n-200,#AEAEB2); }
.hist-session {
  background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:14px;border:0.5px solid rgba(255,255,255,.55);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);
  padding:14px 16px;margin-bottom:10px;
}
.hist-session-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
.hist-date { font-size:12px;font-weight:500;color:var(--n-900,#1C1C1E);letter-spacing:-.01em; }
.hist-rep  { font-size:10px;color:var(--n-400,#636366);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.03em; }
.hist-skills { display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px; }
.hist-skill-dot {
  display:flex;align-items:center;gap:4px;
  font-size:10px;font-family:'Noto Sans Thai',sans-serif;
  color:var(--n-400,#636366);letter-spacing:.03em;
}
.hsd { width:5px;height:5px;border-radius:50%;flex-shrink:0; }
.hsd.pass { background:#34C759; }
.hsd.dev  { background:#FF9500; }
.hsd.no   { background:#AEAEB2; }
.hist-coaching {
  font-size:11px;color:var(--ac,#FF385C);font-style:italic;line-height:1.5;
  border-top:0.5px solid rgba(255,56,92,.12);padding-top:6px;margin-top:6px;
}
.hist-tl-note {
  font-size:11px;color:#534AB7;font-style:italic;line-height:1.5;
  border-top:0.5px solid rgba(83,74,183,.12);padding-top:6px;margin-top:4px;
}
`;
  }

  async function _openHistory() {
    // Inject CSS once
    if (!document.getElementById('ci-history-style')) {
      const s = document.createElement('style');
      s.id = 'ci-history-style';
      s.textContent = _buildHistoryCSS();
      document.head.appendChild(s);
    }
    document.getElementById('ci-history-sheet')?.remove();

    const sheet = document.createElement('div');
    sheet.id = 'ci-history-sheet';
    sheet.innerHTML = `
      <div class="hist-header">
        <span class="hist-title">ประวัติการสนทนา</span>
        <span class="hist-close" onclick="CI._closeHistory()">ปิด</span>
      </div>
      <div class="hist-body" id="ci-hist-body">
        <div class="hist-empty">กำลังโหลด...</div>
      </div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));

    // Load async
    const rows = await _loadHistory();
    const sessions = _groupHistoryBySessions(rows);
    const body = document.getElementById('ci-hist-body');
    if (!body) return;

    if (sessions.length === 0) {
      body.innerHTML = '<div class="hist-empty">ยังไม่มีประวัติ</div>';
      return;
    }

    body.innerHTML = sessions.map(sess => {
      const isTL = _canDebrief();
      const repLabel = isTL ? `<span class="hist-rep">${sess.kam_email.split('@')[0]}</span>` : '';
      const dateLabel = new Date(sess.session_date).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' });

      // Skill dots — prefer tl_override if exists
      // v569 module dot system — hue by module, tint by state, codes on hover only
      const skillDots = sess.skills.map(sk => {
        const finalScore = sk.tl_override || sk.score;
        const col = (typeof window._skDotColor === 'function')
          ? window._skDotColor(sk.skill_code, finalScore)
          : (finalScore==='pass'?'#34C759':finalScore==='developing'?'#FF9500':'#AEAEB2');
        return `<span class="hist-skill-dot" title="${sk.skill_code}"><span class="hsd" style="background:${col};width:8px;height:8px"></span></span>`;
      }).join('');

      // Coaching notes from AI
      const notes = sess.skills
        .filter(sk => sk.score && sk.score !== 'pass' && sk.evidence_summary)
        .slice(0, 2)
        .map(sk => `${sk.skill_code}: ${sk.evidence_summary}`)
        .join(' · ');
      const coachingHtml = notes
        ? `<div class="hist-coaching">${notes}</div>` : '';

      // TL notes
      const tlNotes = sess.skills
        .filter(sk => sk.tl_note)
        .map(sk => `${sk.skill_code}: ${sk.tl_note}`)
        .join(' · ');
      const tlHtml = tlNotes
        ? `<div class="hist-tl-note">TL: ${tlNotes}</div>` : '';

      return `<div class="hist-session">
        <div class="hist-session-head">
          <span class="hist-date">${dateLabel}</span>
          ${repLabel}
        </div>
        <div class="hist-skills">${skillDots}</div>
        ${coachingHtml}${tlHtml}
      </div>`;
    }).join('');
  }

  function _closeHistory() {
    const sheet = document.getElementById('ci-history-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 400);
  }


  // ── CI_SKILL_TREND (TL view) ─────────────────────────────────────────────────
  // TL/admin เท่านั้น — heatmap skill score ต่อ rep ใน squad

  async function _loadSkillTrend(repEmails) {
    try {
      const { data, error } = await supa
        .from('kam_skill_log')
        .select('kam_email, skill_code, score, tl_override, session_date')
        .in('kam_email', repEmails)
        .order('session_date', { ascending: false })
        .limit(500);
      if (error) throw error;
      return data || [];
    } catch(e) {
      console.warn('[CI trend]', e.message);
      return [];
    }
  }

  function _buildTrendCSS() {
    return `
#ci-trend-sheet {
  position:fixed;top:0;bottom:0;left:50%;
  width:100%;max-width:440px;
  transform:translateX(-50%) translateY(100%);
  z-index:10000;
  padding-top:env(safe-area-inset-top,44px);
  background:#FFFFFF;
  font-family:'Noto Sans Thai',sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
}
#ci-trend-sheet.open { transform:translateX(-50%) translateY(0); }
.trend-header {
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 24px 12px;border-bottom:0.5px solid var(--n-100,#E5E5EA);flex-shrink:0;
}
.trend-title { font-size:15px;font-weight:500;color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.trend-close { font-size:15px;color:var(--n-400,#636366);cursor:pointer;padding:4px; }
.trend-body { flex:1;overflow-y:auto;overflow-x:auto;padding:16px 24px 24px;-webkit-overflow-scrolling:touch; }
.trend-body::-webkit-scrollbar { display:none; }
.trend-rep-row { margin-bottom:20px; }
.trend-rep-name { font-size:12px;font-weight:500;color:var(--n-900,#1C1C1E);margin-bottom:8px;letter-spacing:-.01em; }
.trend-grid { display:flex;flex-wrap:wrap;gap:5px; }
.trend-cell {
  width:44px;padding:5px 4px;border-radius:7px;text-align:center;
  font-size:9px;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;
}
.trend-cell-code { font-weight:500;margin-bottom:2px;line-height:1.2; }
.trend-cell-score { font-size:8px;opacity:.75; }
.trend-cell.pass { background:rgba(52,199,89,.14);color:#1a7a38; }
.trend-cell.dev  { background:rgba(255,149,0,.14);color:#a05800; }
.trend-cell.no   { background:rgba(0,0,0,.05);color:#888; }
.trend-cell.none { background:rgba(0,0,0,.03);color:#ccc; }
.trend-legend { display:flex;gap:14px;margin-bottom:16px; }
.tl-dot { width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px; }
.tl-legend-item { display:flex;align-items:center;font-size:10px;color:var(--n-400,#636366); }
`;
  }

  async function _openSkillTrend() {
    if (!_canDebrief()) return;

    if (!document.getElementById('ci-trend-style')) {
      const s = document.createElement('style');
      s.id = 'ci-trend-style';
      s.textContent = _buildTrendCSS();
      document.head.appendChild(s);
    }
    document.getElementById('ci-trend-sheet')?.remove();

    const sheet = document.createElement('div');
    sheet.id = 'ci-trend-sheet';
    sheet.innerHTML = `
      <div class="trend-header">
        <span class="trend-title">Skill Overview — Team</span>
        <span class="trend-close" onclick="CI._closeTrend()">ปิด</span>
      </div>
      <div class="trend-body" id="ci-trend-body">
        <div style="text-align:center;padding:48px 0;font-size:13px;color:#AEAEB2">กำลังโหลด...</div>
      </div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));

    // Get rep emails from squad (use portviewBulkData if available)
    let repEmails = [];
    if (typeof portviewBulkData !== 'undefined' && portviewBulkData) {
      const seen = new Set();
      portviewBulkData.forEach(r => {
        if (r.owner_email && !seen.has(r.owner_email)) {
          seen.add(r.owner_email);
          repEmails.push(r.owner_email);
        }
      });
    }
    if (repEmails.length === 0) {
      repEmails = [currentUserProfile?.email].filter(Boolean);
    }

    const rows = await _loadSkillTrend(repEmails);
    const body = document.getElementById('ci-trend-body');
    if (!body) return;

    if (rows.length === 0) {
      body.innerHTML = '<div style="text-align:center;padding:48px 0;font-size:13px;color:#AEAEB2">ยังไม่มีข้อมูล</div>';
      return;
    }

    // Aggregate: per rep, per skill → latest score
    const repMap = {}; // repEmail → { skillCode → { score, sessions } }
    rows.forEach(r => {
      if (!repMap[r.kam_email]) repMap[r.kam_email] = {};
      const code = r.skill_code;
      if (!repMap[r.kam_email][code]) repMap[r.kam_email][code] = { latest: null, pass: 0, dev: 0, no: 0, total: 0 };
      const bucket = repMap[r.kam_email][code];
      const finalScore = r.tl_override || r.score;
      if (!bucket.latest) bucket.latest = finalScore;
      if (finalScore === 'pass') bucket.pass++;
      else if (finalScore === 'developing') bucket.dev++;
      else bucket.no++;
      bucket.total++;
    });

    const skillCodes = (_rubricCache || []).map(s => s.skill_code);

    const legend = `<div class="trend-legend">
      <div class="tl-legend-item"><span class="tl-dot" style="background:#34C759"></span>Pass</div>
      <div class="tl-legend-item"><span class="tl-dot" style="background:#FF9500"></span>Developing</div>
      <div class="tl-legend-item"><span class="tl-dot" style="background:#AEAEB2"></span>Not observed</div>
    </div>`;

    const repRows = Object.entries(repMap).map(([email, skills]) => {
      const name = email.split('@')[0];
      const cells = skillCodes.map(code => {
        const sk = skills[code];
        if (!sk) return `<div class="trend-cell none"><div class="trend-cell-code">${code}</div><div class="trend-cell-score">—</div></div>`;
        const cls = sk.latest==='pass'?'pass':sk.latest==='developing'?'dev':'no';
        const pct = sk.total > 0 ? Math.round(sk.pass/sk.total*100) : 0;
        return `<div class="trend-cell ${cls}"><div class="trend-cell-code">${code}</div><div class="trend-cell-score">${pct}%</div></div>`;
      }).join('');
      return `<div class="trend-rep-row">
        <div class="trend-rep-name">${name}</div>
        <div class="trend-grid">${cells}</div>
      </div>`;
    }).join('');

    body.innerHTML = legend + repRows;
  }

  function _closeTrend() {
    const sheet = document.getElementById('ci-trend-sheet');
    if (!sheet) return;
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 400);
  }


  // ── History filter ─────────────────────────────────────────────────────────
  function _histFilter(mode) {
    _histFilterMode = mode;
    // Update chip active styles
    ['week','month','all'].forEach(k => {
      const btn = document.getElementById('ci-hf-' + k);
      if (!btn) return;
      const isActive = k === mode;
      btn.style.background = isActive ? 'var(--ac,#FF385C)' : 'rgba(0,0,0,.04)';
      btn.style.color = isActive ? '#fff' : 'var(--tx2,#636366)';
      btn.style.border = isActive ? '0.5px solid var(--ac,#FF385C)' : '0.5px solid rgba(0,0,0,.14)';
    });
    _loadInlineHistory();
  }

  // ── Visit badge (rep sees own week count) ──────────────────────────────────
  async function _loadVisitBadge() {
    const badge = document.getElementById('ci-visit-badge');
    if (!badge) return;
    const email = currentUserProfile?.email;
    if (!email || _canDebrief()) { badge.style.display = 'none'; return; }
    try {
      const now = new Date();
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const weekStart = new Date(now);
      weekStart.setHours(0,0,0,0);
      weekStart.setDate(now.getDate() - dow);
      const { count: _visitCount, error } = await supa
        .from('ci_sessions')
        .select('*', { count: 'exact', head: true })
        .eq('owner_email', email)
        .gte('visited_at', weekStart.toISOString());
      if (error) throw error;
      const count = _visitCount ?? 0;
      if (count > 0) {
        badge.textContent = count + ' visits this week';
        badge.style.display = '';
      } else {
        badge.style.display = 'none';
      }
    } catch(e) {
      badge.style.display = 'none';
    }
  }

  // ── ECHO STATE MACHINE — single source of truth for section visibility ────
  // Spec: docs/echo-state-spec.md (Table 1) — ห้าม toggle display ที่อื่น
  function _renderEchoState() {
    const isTL = _canDebrief();
    const rec  = _mainTab === 'record';
    const show = {
      'ci-chip-wrap':     rec && !isTL && !_showPicker && _phase !== 'recording',
      'ci-visit-hero':    rec && !_showPicker && _phase !== 'recording',
      'ci-picker-sec':    rec && !isTL && _showPicker && _phase === 'idle',
      'ci-rec-center':    rec && !isTL && !_showPicker && _phase === 'idle',
      'ci-covisit-panel': rec && isTL && _phase !== 'recording',
      'ci-rec-active':    rec && _phase === 'recording',
      'ci-rec-bottom':    rec && _phase === 'recording',
      'ci-inline-hist':   !rec,
    };
    const DISPLAY = {
      'ci-picker-sec':'flex', 'ci-rec-center':'flex', 'ci-covisit-panel':'flex',
      'ci-rec-active':'flex', 'ci-rec-bottom':'block', 'ci-inline-hist':'block',
    };
    Object.entries(show).forEach(([id, on]) => {
      const el = document.getElementById(id);
      if (el) el.style.display = on ? (DISPLAY[id] || '') : 'none';
    });
  }

  // ── Main tab switch (บันทึก / ประวัติ) ────────────────────────────────────────
  function _switchMainTab(tab) {
    _mainTab = tab === 'history' ? 'history' : 'record';
    const pill    = document.getElementById('ci-tab-pill');
    const recBtn  = document.getElementById('ci-tab-rec');
    const histBtn = document.getElementById('ci-tab-hist');
    const isTL    = _canDebrief();
    if (_mainTab === 'history') {
      if (pill) { pill.style.left = 'calc(50%)'; pill.style.width = 'calc(50% - 3px)'; }
      if (recBtn)  recBtn.classList.remove('on');
      if (histBtn) histBtn.classList.add('on');
    } else {
      if (pill) { pill.style.left = '3px'; pill.style.width = 'calc(50% - 3px)'; }
      if (recBtn)  recBtn.classList.add('on');
      if (histBtn) histBtn.classList.remove('on');
    }
    _renderEchoState();
    if (_mainTab === 'history') {
      const histPanel = document.getElementById('ci-inline-hist');
      // Inject filter chips bar once (rep only — TL sees all, no filter needed)
      if (histPanel && !isTL && !document.getElementById('ci-hist-filter-bar')) {
        const bar = document.createElement('div');
        bar.id = 'ci-hist-filter-bar';
        bar.style.cssText = 'padding:8px 0 4px;display:flex;gap:6px;flex-shrink:0;';
        bar.innerHTML = [
          {key:'week', label:'สัปดาห์นี้'},
          {key:'month', label:'เดือนนี้'},
          {key:'all', label:'ทั้งหมด'}
        ].map(({key, label}) =>
          `<button onclick="CI._histFilter('${key}')" id="ci-hf-${key}"
            style="font-size:11px;font-weight:500;padding:4px 12px;border-radius:100px;border:0.5px solid rgba(0,0,0,.14);background:${key==='week'?'var(--ac,#FF385C)':'rgba(0,0,0,.04)'};color:${key==='week'?'#fff':'var(--tx2,#636366)'};cursor:pointer;font-family:'Noto Sans Thai',sans-serif;transition:all .15s;-webkit-tap-highlight-color:transparent">${label}</button>`
        ).join('');
        const histBody = document.getElementById('ci-inline-hist-body');
        if (histBody) histPanel.insertBefore(bar, histBody);
      }
      _loadInlineHistory();
    }
  }

  async function _loadInlineHistory() {
    const body = document.getElementById('ci-inline-hist-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">กำลังโหลด...</div>';
    const email = currentUserProfile?.email;
    if (!email) { body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ไม่พบผู้ใช้งาน</div>'; return; }
    try {
      const isTL = _canDebrief();
      let q = supa.from('ci_sessions')
        .select('id,owner_email,account_id,account_name,visited_at,duration_secs,skill_scores,customer_intel,next_actions,transcript_summary,tone_signals,tl_reviewed_at,tl_reviewed_by,tl_note,covisit_verified,status')
        .order('visited_at', { ascending: false })
        .limit(isTL ? 100 : 50);

      // Date filter (rep only — TL always sees all for context)
      if (!isTL && _histFilterMode !== 'all') {
        const now = new Date();
        let since;
        if (_histFilterMode === 'week') {
          const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
          since = new Date(now); since.setHours(0,0,0,0); since.setDate(now.getDate() - dow);
        } else { // month
          since = new Date(now.getFullYear(), now.getMonth(), 1);
        }
        q = q.gte('visited_at', since.toISOString());
      }

      if (isTL) {
        // TL — ดู sessions ของทุกคนในทีม (ใช้ portviewBulkData หา emails)
        const teamEmails = _getTeamEmails();
        if (teamEmails.length > 0) {
          q = q.in('owner_email', teamEmails);
        }
        // ไม่ filter by account — TL เห็นทุก session ของทีม
      } else {
        // Sales — เห็นเฉพาะของตัวเอง
        q = q.eq('owner_email', email);
        if (_accountGuid) q = q.eq('account_id', _accountGuid);
      }

      const { data: _rawData, error } = await q;
      if (error) throw error;
      // v575: dedupe — double-save เดิมสร้าง row ซ้ำ (same owner+account+duration, ห่างกัน <60s)
      // เก็บ row แรก (ใหม่สุด เพราะ order desc) ทิ้งตัวซ้ำ
      const data = (_rawData || []).filter((s, i, arr) => {
        return !arr.slice(0, i).some(prev =>
          prev.owner_email === s.owner_email &&
          (prev.account_id || prev.account_name) === (s.account_id || s.account_name) &&
          prev.duration_secs === s.duration_secs &&
          Math.abs(new Date(prev.visited_at) - new Date(s.visited_at)) < 60000
        );
      });
      if (!data || !data.length) {
        const emptyMsg = _histFilterMode === 'week' ? 'ยังไม่มี visit สัปดาห์นี้' : _histFilterMode === 'month' ? 'ยังไม่มี visit เดือนนี้' : 'ยังไม่มีประวัติ Echo';
        body.innerHTML = `<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">${emptyMsg}</div>`;
        return;
      }
      body.innerHTML = isTL ? _renderTLTeamFeed(data) : _renderInlineHistory(data);
    } catch(e) {
      console.warn('[CI inline history]', e.message);
      const rows = await _loadHistory();
      const sessions = _groupHistoryBySessions(rows);
      if (!sessions.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ยังไม่มีประวัติ</div>';
        return;
      }
      body.innerHTML = _renderLegacyHistory(sessions);
    }
  }

  function _getTeamEmails() {
    const tlEmail = (currentUserProfile?.email || '').toLowerCase();
    if (!tlEmail) return [];
    const emails = new Set();
    // KAM team — portviewBulkData มี tlEmail + kamEmail
    if (typeof portviewBulkData !== 'undefined' && portviewBulkData) {
      portviewBulkData.forEach(r => {
        if (r.tlEmail && r.tlEmail.toLowerCase() === tlEmail && r.kamEmail)
          emails.add(r.kamEmail.toLowerCase());
      });
    }
    // v498: AD team — portviewBulkData uses same tlEmail+kamEmail columns for AD reps
    // (AD rep kamEmail is stored identically to KAM — no separate column needed)
    // Sales team — salesBulkData มี tl_email + owner_email
    if (typeof window.salesBulkData !== 'undefined' && window.salesBulkData) {
      window.salesBulkData.forEach(r => {
        if (r.tl_email && r.tl_email.toLowerCase() === tlEmail && r.owner_email)
          emails.add(r.owner_email.toLowerCase());
      });
    }
    // fallback: ถ้ายังไม่มี bulk data ให้ใส่ตัวเองไว้ก่อน
    if (emails.size === 0) emails.add(tlEmail);
    return [...emails];
  }

  // ── TL Team Feed ──────────────────────────────────────────────────────────
  function _renderTLTeamFeed(sessions) {
    if (!sessions.length) return '<div style="text-align:center;padding:48px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ยังไม่มี session</div>';

    return sessions.map(s => {
      const repName  = s.owner_email ? s.owner_email.split('@')[0] : '—';
      const acctLabel = s.account_name || '—';
      const date     = new Date(s.visited_at).toLocaleDateString('th-TH', { day:'numeric', month:'short' });
      const dur      = s.duration_secs ? _fmt(s.duration_secs) : '';
      const reviewed = !!s.tl_reviewed_at;

      // Skill dots
      const skills = s.skill_scores?.skills || [];
      const dots = skills.slice(0, 8).map(sk => {
        const sc  = sk.tl_override || sk.score;
        const col = sc==='pass'?'#34C759':sc==='developing'?'#FF9500':'#E5E5EA';
        return `<span style="width:6px;height:6px;border-radius:50%;background:${col};flex-shrink:0;display:inline-block"></span>`;
      }).join('');

      // Tone badge
      let toneBadge = '';
      if (s.tone_signals?.rep_confidence) {
        const c = s.tone_signals.rep_confidence;
        const col = c==='high'?'#34C759':c==='medium'?'#FF9500':'#FF3B30';
        toneBadge = `<span style="font-size:9px;font-weight:500;color:${col};background:${col}18;padding:2px 7px;border-radius:6px;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em">${c==='high'?'Confident':c==='medium'?'Steady':'Hesitant'}</span>`;
      }

      // Review badge
      const reviewBadge = reviewed
        ? `<span style="font-size:9px;font-weight:500;color:#34C759;background:#34C75918;padding:2px 7px;border-radius:6px;font-family:'Noto Sans Thai',sans-serif">✓ รีวิวแล้ว</span>`
        : `<span style="font-size:9px;font-weight:500;color:#FF9500;background:#FF950018;padding:2px 7px;border-radius:6px;font-family:'Noto Sans Thai',sans-serif">รอรีวิว</span>`;

      // Co-visit badge
      const cvBadge = s.covisit_verified
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:500;color:#34C759;background:#34C75918;padding:2px 7px;border-radius:6px;font-family:'Noto Sans Thai',sans-serif"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit</span>`
        : '';

      return `<div onclick="CI._openSessionDetail('${s.id}')" style="background:rgba(255,255,255,.72);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:14px;border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 12px rgba(0,0,0,.04);padding:12px 14px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:7px">
      <div style="width:22px;height:22px;border-radius:50%;background:rgba(255,56,92,.12);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:600;color:var(--ac,#FF385C);flex-shrink:0">${repName.slice(0,2).toUpperCase()}</div>
      <div>
        <div style="font-size:12px;font-weight:500;color:var(--tx,#1C1C1E);line-height:1.2">${repName}</div>
        <div style="font-size:10px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${acctLabel}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:10px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${date}${dur?' · '+dur:''}</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <div style="display:flex;gap:3px;align-items:center;flex:1">${dots}</div>
    ${toneBadge}
    ${cvBadge}
    ${reviewBadge}
  </div>
  ${s.tl_note ? `<div style="font-size:10px;color:#534AB7;font-style:italic;line-height:1.5;margin-top:6px;padding-top:6px;border-top:0.5px solid rgba(83,74,183,.12);font-family:'Noto Sans Thai',sans-serif">${s.tl_note}</div>` : ''}
</div>`;
    }).join('');
  }

  // ── Session Detail Sheet (TL) ──────────────────────────────────────────────
  async function _openSessionDetail(sessionId) {
    // v567: TL-only guard removed — the detail is now role-aware (v566): the
    // coaching editor is gated to TL inside the renderer; reps get read-only.
    // This guard was why reps could not open their own history detail.

    // Inject CSS once
    if (!document.getElementById('ci-sess-detail-style')) {
      const s = document.createElement('style');
      s.id = 'ci-sess-detail-style';
      s.textContent = `
#ci-sess-detail { position:fixed;top:0;bottom:0;left:50%;width:100%;max-width:440px;transform:translateX(-50%) translateY(100%);z-index:10001;padding-top:env(safe-area-inset-top,44px);background:#FFFFFF;font-family:'Noto Sans Thai',sans-serif;-webkit-font-smoothing:antialiased;display:flex;flex-direction:column;transition:transform 380ms cubic-bezier(0.16,1,0.3,1);overflow:hidden; }
#ci-sess-detail.open { transform:translateX(-50%) translateY(0); }
.sd-header { display:flex;align-items:center;justify-content:space-between;padding:16px 20px 12px;border-bottom:0.5px solid #E5E5EA;flex-shrink:0; }
.sd-title { font-size:15px;font-weight:500;color:#1C1C1E;letter-spacing:-.02em; }
.sd-close { font-size:15px;color:#636366;cursor:pointer;padding:4px 0 4px 12px; }
.sd-body { flex:1;overflow-y:auto;padding:16px 20px 24px;-webkit-overflow-scrolling:touch; }
.sd2-transcript { font-size:12.5px;color:#48484A;line-height:1.7;padding:12px 14px;background:rgba(255,56,92,.05);border:0.5px solid rgba(255,56,92,.12);border-radius:11px;letter-spacing:-.005em; }
.sd-body::-webkit-scrollbar { display:none; }
.sd-section-hd { font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin:16px 0 8px; }
.sd-skill-row { display:flex;gap:10px;padding:10px 0;border-bottom:0.5px solid #F2F2F7; }
.sd-skill-row:last-child { border-bottom:none; }
.sd-skill-dot { width:6px;height:6px;border-radius:50%;margin-top:4px;flex-shrink:0; }
.sd-skill-name { font-size:12px;font-weight:500;color:#1C1C1E;margin-bottom:2px; }
.sd-skill-ev { font-size:11px;color:#636366;line-height:1.5; }
.sd-skill-note { font-size:11px;color:#FF385C;margin-top:3px;font-style:italic;line-height:1.4; }
.sd-tone-row { display:flex;gap:10px;margin-bottom:12px; }
.sd-tone-card { flex:1;padding:10px 12px;background:#F7F7F7;border-radius:10px; }
.sd-tone-label { font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px; }
.sd-tone-val { font-size:13px;font-weight:500; }
.sd-tone-note { font-size:10px;color:#AEAEB2;margin-top:2px;line-height:1.4; }
.sd-summary { font-size:12px;color:#636366;line-height:1.7;padding:12px 14px;background:rgba(255,56,92,.05);border-radius:10px;border:0.5px solid rgba(255,56,92,.12); }
.sd-review-btn { width:100%;padding:14px;border-radius:14px;border:none;background:var(--ac,#FF385C);color:#fff;font-family:'Noto Sans Thai',sans-serif;font-size:15px;font-weight:500;cursor:pointer;letter-spacing:-.02em;transition:opacity 80ms; }
.sd-review-btn:active { opacity:.8; }
.sd-review-btn.done { background:#34C759; }
.sd-review-footer { padding:12px 20px 32px;flex-shrink:0;border-top:0.5px solid #E5E5EA; }
/* ── v568 redesign (approved mockup): readable type scale + tabs + collapsible states ── */
.sd2-name { font-size:17px;font-weight:600;color:#1C1C1E;letter-spacing:-.02em; }
.sd2-meta { font-size:13px;color:#48484A;margin-top:3px;line-height:1.55; }
.sd2-chips { display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap; }
.sd2-chip { display:inline-flex;align-items:center;gap:5px;font-size:12px;font-weight:600;padding:5px 12px;border-radius:999px;letter-spacing:.01em; }
.sd2-chip svg { flex-shrink:0; }
.sd2-chip.bad { color:#C73E3E;background:rgba(255,59,48,.08); }
.sd2-chip.dev { color:#B26A00;background:rgba(255,149,0,.09); }
.sd2-chip.good { color:#1F8A43;background:rgba(52,199,89,.09); }
.sd2-chip.cv { color:#34C759;background:rgba(52,199,89,.07); }
.sd2-chip.rev { color:#534AB7;background:rgba(83,74,183,.07); }
.sd2-whywrap { position:relative;margin-top:10px; }
.sd2-why { font-size:13.5px;color:#48484A;line-height:1.7;padding:12px 38px 12px 14px;background:#F7F7F8;border-radius:12px;transition:all .2s; }
.sd2-why.collapsed { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
.sd2-whytg { position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:8px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#8E8E93;transition:transform .2s; }
.sd2-whytg.flip { transform:rotate(180deg); }
.sd2-tabs { display:flex;gap:4px;margin-top:16px;background:#F7F7F8;border-radius:12px;padding:4px; }
.sd2-tab { flex:1;text-align:center;font-size:13.5px;font-weight:600;color:#8E8E93;padding:9px 0;border-radius:9px;cursor:pointer;transition:all .18s;-webkit-tap-highlight-color:transparent; }
.sd2-tab.on { background:#FFF;color:#1C1C1E;box-shadow:0 1px 4px rgba(0,0,0,.07); }
.sd2-pane { display:none;padding-top:16px; }
.sd2-pane.on { display:block;animation:sd2fade .22s ease; }
@keyframes sd2fade { from { opacity:0;transform:translateY(4px); } to { opacity:1;transform:none; } }
.sd2-lbl { font-size:11px;font-weight:600;letter-spacing:.12em;text-transform:uppercase;color:#8E8E93;margin:18px 0 10px;font-family:'Noto Sans Thai',sans-serif; }
.sd2-lbl:first-child { margin-top:0; }
.sd2-tone { display:flex;gap:10px; }
.sd2-tcard { flex:1;padding:13px 14px;background:#F7F7F8;border-radius:12px; }
.sd2-tcard .k { font-size:11px;font-weight:600;letter-spacing:.1em;text-transform:uppercase;color:#8E8E93; }
.sd2-tcard .v { font-size:15px;font-weight:600;margin-top:4px; }
.sd2-tcard .n { font-size:12.5px;color:#48484A;margin-top:4px;line-height:1.6; }
.sd2-sum { font-size:14px;color:#1C1C1E;line-height:1.8;padding:14px 16px;background:rgba(255,56,92,.03);border:0.5px solid rgba(255,56,92,.1);border-radius:12px; }
.sd2-srow { display:flex;gap:12px;padding:13px 0;border-bottom:0.5px solid #ECECF0; }
.sd2-srow:last-child { border:none; }
.sd2-sdot { width:8px;height:8px;border-radius:50%;margin-top:7px;flex-shrink:0; }
.sd2-scode { font-family:var(--mono,'IBM Plex Mono',monospace);font-size:10px;font-weight:500;color:#8E8E93;letter-spacing:.04em; }
.sd2-sname { font-size:14px;font-weight:600;color:#1C1C1E;margin-top:1px; }
.sd2-sev { font-size:13.5px;color:#48484A;line-height:1.7;margin-top:4px; }
.sd2-snote { font-size:13px;color:#C73E3E;line-height:1.65;margin-top:5px;padding-left:10px;border-left:2px solid rgba(255,59,48,.2); }
.sd2-sstate { margin-left:auto;flex-shrink:0;font-size:11px;font-weight:600;padding:3px 9px;border-radius:999px;height:fit-content;white-space:nowrap; }
.sd2-sstate.no { color:#8E8E93;background:#F7F7F8; }
.sd2-sstate.dev { color:#B26A00;background:rgba(255,149,0,.08); }
.sd2-sstate.ok { color:#1F8A43;background:rgba(52,199,89,.08); }
.sd2-iline { display:flex;gap:12px;padding:11px 0;border-bottom:0.5px solid #ECECF0; }
.sd2-iline:last-child { border:none; }
.sd2-ik { flex-shrink:0;width:64px;font-size:11px;font-weight:600;letter-spacing:.08em;text-transform:uppercase;color:#8E8E93;padding-top:3px; }
.sd2-iv { font-size:14px;color:#1C1C1E;line-height:1.7; }
.sd2-iv .sub { color:#48484A;font-size:13px; }
.sd2-ipoint { display:flex;gap:9px;padding:7px 0;font-size:14px;color:#1C1C1E;line-height:1.7; }
.sd2-ipoint::before { content:'';width:5px;height:5px;border-radius:50%;background:var(--ac,#FF385C);margin-top:9px;flex-shrink:0; }
.sd2-next { display:flex;gap:10px;padding:11px 13px;background:rgba(83,74,183,.03);border:0.5px solid rgba(83,74,183,.12);border-radius:11px;margin-bottom:8px;font-size:14px;color:#1C1C1E;line-height:1.65; }
.sd2-next .num { font-family:var(--mono,'IBM Plex Mono',monospace);font-size:11px;font-weight:500;color:#534AB7;padding-top:3px;flex-shrink:0; }
.sd2-notebar { display:flex;align-items:center;gap:9px;padding:13px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent; }
.sd2-notebar .t { flex:1;min-width:0;font-size:13.5px;font-weight:600;color:#534AB7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.sd2-notebar .t .pv { font-weight:400;color:#48484A; }
.sd2-notebar .ch { color:#8E8E93;transition:transform .2s;flex-shrink:0; }
.sd2-notebar.open .ch { transform:rotate(180deg); }
.sd2-note-editor { display:none;padding:0 16px 4px; }
.sd2-note-editor.open { display:block;animation:sd2fade .2s ease; }
.sd2-note-ro { font-size:13.5px;color:#3D3680;line-height:1.7;padding:11px 13px;background:rgba(83,74,183,.05);border:0.5px solid rgba(83,74,183,.16);border-radius:11px;margin-bottom:4px; }
      `;
      document.head.appendChild(s);
    }

    document.getElementById('ci-sess-detail')?.remove();
    const sheet = document.createElement('div');
    sheet.id = 'ci-sess-detail';
    sheet.innerHTML = `
      <div class="sd-header">
        <span class="sd-title">รายละเอียด Session</span>
        <span class="sd-close" onclick="CI._closeSessionDetail()">ปิด</span>
      </div>
      <div class="sd-body" id="sd-body-inner">
        <div style="text-align:center;padding:48px 0;font-size:13px;color:#AEAEB2">กำลังโหลด...</div>
      </div>
      <div class="sd-review-footer" id="sd-review-footer" style="display:none"></div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));

    // Load session data
    try {
      const { data, error } = await supa.from('ci_sessions')
        .select('id,owner_email,account_id,account_name,visited_at,duration_secs,skill_scores,customer_intel,next_actions,transcript_summary,tone_signals,tl_reviewed_at,tl_reviewed_by,tl_note,covisit_verified,status')
        .eq('id', sessionId)
        .single();
      if (error || !data) throw error || new Error('not found');
      // v552: merge verified จาก local cache + covisit_events (spec: source of truth)
      if (!data.covisit_verified) {
        if (_cvDoneCache()[data.id]) data.covisit_verified = true;
        else {
          try {
            const { data: ev } = await supa.from('covisit_events')
              .select('session_id').eq('session_id', data.id).eq('verified', true).limit(1);
            if (ev && ev.length) data.covisit_verified = true;
          } catch(_) {}
        }
      }
      _renderSessionDetailContent(data);
    } catch(e) {
      const b = document.getElementById('sd-body-inner');
      if (b) b.innerHTML = `<div style="text-align:center;padding:48px 0;font-size:13px;color:#AEAEB2">โหลดไม่สำเร็จ: ${e.message}</div>`;
    }
  }

  function _renderSessionDetailContent(s) {
    // v598: shared renderer — map ci_sessions row → same 4 panel functions as live result
    // เพื่อให้ design เดียวกันทั้ง live result และ session detail จาก history
    const body   = document.getElementById('sd-body-inner');
    const footer = document.getElementById('sd-review-footer');
    if (!body) return;

    const repName   = s.owner_email ? s.owner_email.split('@')[0] : '—';
    const acctLabel = s.account_name || '—';
    const date      = new Date(s.visited_at).toLocaleDateString('th-TH', { day:'numeric', month:'short', year:'2-digit' });
    const dur       = s.duration_secs ? _fmt(s.duration_secs) : '—';
    const reviewed  = !!s.tl_reviewed_at;
    const reviewedDate = reviewed
      ? new Date(s.tl_reviewed_at).toLocaleDateString('th-TH', { day:'numeric', month:'short' })
      : null;

    // ── Verdict + meta chips
    const overall = s.skill_scores?.overall;
    const vMap = { needs_work:['ต้องปรับปรุง','bad'], developing:['กำลังพัฒนา','dev'], strong:['ทำได้ดี','good'] };
    const v = vMap[overall] || null;
    const verdictChip = v ? `<span class="sd2-chip ${v[1]}">${v[0]}</span>` : '';
    const cvChip = s.covisit_verified
      ? `<span class="sd2-chip cv" id="sd-cv-badge"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit</span>`
      : `<span id="sd-cv-badge" style="display:none"></span>`;
    const revChip = reviewed
      ? `<span class="sd2-chip rev"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>รีวิวแล้ว ${reviewedDate}</span>` : '';

    // ── Collapsible session summary
    const whyTxt = s.skill_scores?.session_summary || '';
    const whyHtml = whyTxt ? `
<div class="sd2-whywrap">
  <div class="sd2-why" id="sd2-why">${whyTxt}</div>
  <div class="sd2-whytg" id="sd2-whytg" onclick="CI._sdToggleWhy()">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg>
  </div>
</div>` : '';

    // ── Map ci_sessions fields → shared panel function arguments
    // skill_scores: { skills, overall, pipc_stage, session_summary, no_speech }
    // apply tl_override per skill so shared renderer shows final score
    const skillData = Object.assign({}, s.skill_scores || {}, {
      skills: (s.skill_scores?.skills || []).map(sk => Object.assign({}, sk, {
        score: sk.tl_override || sk.score
      }))
    });
    // customer_intel: { ocpb_facts, ocpb_status, next_actions } + legacy fields
    const intelData = Object.assign({}, s.customer_intel || {}, {
      next_actions: s.next_actions || s.customer_intel?.next_actions || []
    });
    const toneSignals       = s.tone_signals || null;
    // v599: ถ้ามี whyHtml (session_summary) อยู่ใน header แล้ว
    // ไม่ส่ง transcriptSummary ให้ _overviewPanel เพื่อป้องกันสรุปซ้ำ
    // transcript_summary ยังคงแสดงใน tab Transcript ผ่าน _transcriptPanel
    const transcriptSummary = s.transcript_summary || null;
    const overviewSummary   = whyTxt ? null : transcriptSummary;

    // ── Build 4 panes using shared renderers (identical to live result)
    const pane1 = _overviewPanel(overviewSummary, toneSignals);
    const pane2 = _skillsPanel(skillData);
    const pane3 = _customerPanel(intelData);
    const pane4 = _transcriptPanel(toneSignals, transcriptSummary);

    body.innerHTML = `
<div class="sd2-name">${repName}</div>
<div class="sd2-meta">${acctLabel} · ${date} · ${dur}</div>
<div class="sd2-chips">${verdictChip}${cvChip}${revChip}</div>
${whyHtml}
<div class="sd2-tabs">
  <div class="sd2-tab on" onclick="CI._sdTab(this,'sd2p1')">ภาพรวม</div>
  <div class="sd2-tab" onclick="CI._sdTab(this,'sd2p2')">ทักษะ</div>
  <div class="sd2-tab" onclick="CI._sdTab(this,'sd2p3')">ลูกค้า</div>
  <div class="sd2-tab" onclick="CI._sdTab(this,'sd2p4')">Transcript</div>
</div>
<div class="sd2-pane on" id="sd2p1">${pane1}</div>
<div class="sd2-pane" id="sd2p2">${pane2}</div>
<div class="sd2-pane" id="sd2p3">${pane3}</div>
<div class="sd2-pane" id="sd2p4">${pane4}</div>`;

    // ── Footer — TL coaching note editor / read-only note for rep
    const _isTLViewer = (typeof _canDebrief === 'function') ? _canDebrief() : false;
    if (footer) footer.style.padding = '0 0 max(16px, env(safe-area-inset-bottom, 0px))';
    if (footer && !_isTLViewer) {
      const _hasNote = !!(s.tl_note && s.tl_note.trim());
      footer.style.display = _hasNote ? 'block' : 'none';
      if (_hasNote) {
        const pv = s.tl_note.length > 42 ? s.tl_note.slice(0, 42) + '\u2026' : s.tl_note;
        footer.innerHTML = `
<div class="sd2-notebar" id="sd2-notebar" onclick="CI._sdToggleNote()">
  <span class="t">TL Note <span class="pv">\u00b7 ${pv}</span></span>
  <span class="ch"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></span>
</div>
<div class="sd2-note-editor" id="sd2-note-editor">
  <div class="sd2-note-ro">${s.tl_note}</div>
</div>`;
      }
    }
    if (footer && _isTLViewer) {
      footer.style.display = 'block';
      const existingNote = s.tl_note || '';
      const pv = existingNote ? (existingNote.length > 36 ? existingNote.slice(0, 36) + '\u2026' : existingNote) : '';
      const barLabel = reviewed
        ? `รีวิวแล้ว ${reviewedDate}${pv ? ` <span class="pv">\u00b7 ${pv}</span>` : ''}`
        : 'เขียน Coaching Note + รีวิว';
      footer.innerHTML = `
<div class="sd2-notebar" id="sd2-notebar" onclick="CI._sdToggleNote()">
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#534AB7" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
  <span class="t">${barLabel}</span>
  <span class="ch"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"/></svg></span>
</div>
<div class="sd2-note-editor" id="sd2-note-editor">
  <textarea id="sd-tl-note" placeholder="บันทึก coaching note สำหรับ session นี้ (optional)" rows="3"
    style="width:100%;padding:11px 13px;border:0.5px solid rgba(83,74,183,.3);border-radius:11px;background:rgba(83,74,183,.04);color:#1C1C1E;font-family:'Noto Sans Thai',sans-serif;font-size:14px;line-height:1.65;resize:none;-webkit-appearance:none;outline:none"
    onfocus="this.style.borderColor='rgba(83,74,183,.55)'" onblur="this.style.borderColor='rgba(83,74,183,.3)'"
  >${existingNote}</textarea>
  <button class="sd-review-btn" id="sd-save-note-btn"
    style="margin-top:10px;background:#534AB7;font-size:15px;font-weight:600"
    onclick="CI._saveTLSessionNote('${s.id}', ${reviewed})">
    ${reviewed ? 'อัปเดต Note' : 'บันทึก + รีวิว'}
  </button>
</div>`;
    }
  }

  // ── v568 detail-sheet interactions ──────────────────────────────────────────
  function _sdTab(el, paneId) {
    try {
      el.parentElement.querySelectorAll('.sd2-tab').forEach(t => t.classList.remove('on'));
      el.classList.add('on');
      const body = document.getElementById('sd-body-inner');
      if (body) body.querySelectorAll('.sd2-pane').forEach(p => p.classList.remove('on'));
      const pane = document.getElementById(paneId);
      if (pane) pane.classList.add('on');
    } catch(e) {}
  }
  function _sdToggleWhy() {
    const w = document.getElementById('sd2-why');
    const tg = document.getElementById('sd2-whytg');
    if (!w) return;
    const collapsed = w.classList.toggle('collapsed');
    if (tg) tg.classList.toggle('flip', collapsed);
  }
  function _sdToggleNote() {
    const ed = document.getElementById('sd2-note-editor');
    const bar = document.getElementById('sd2-notebar');
    if (!ed) return;
    const open = ed.classList.toggle('open');
    if (bar) bar.classList.toggle('open', open);
    if (open) { try { const ta = document.getElementById('sd-tl-note'); if (ta) ta.focus(); } catch(e) {} }
  }

  async function _markSessionReviewed(sessionId) {
    await _saveTLSessionNote(sessionId, false);
  }

  async function _saveTLSessionNote(sessionId, alreadyReviewed) {
    const btn  = document.getElementById('sd-save-note-btn');
    const ta   = document.getElementById('sd-tl-note');
    const note = ta ? ta.value.trim() : '';
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }
    try {
      let reviewerId = null;
      try {
        const sk = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
        if (sk) { const ss = JSON.parse(localStorage.getItem(sk)); reviewerId = ss?.user?.id || null; }
      } catch(_) {}

      const payload = { tl_note: note || null };
      if (!alreadyReviewed) {
        payload.tl_reviewed_at = new Date().toISOString();
        payload.tl_reviewed_by = reviewerId;
      }

      let { data: updRows, error } = await supa.from('ci_sessions')
        .update(payload)
        .eq('id', sessionId)
        .select('id');

      // Graceful degrade: if tl_note column doesn't exist yet, retry without it
      if (error && error.message && error.message.includes('tl_note')) {
        const fallback = { ...payload };
        delete fallback.tl_note;
        const res2 = await supa.from('ci_sessions').update(fallback).eq('id', sessionId).select('id');
        error = res2.error; updRows = res2.data;
      }
      if (error) throw error;
      // v566 FAKE-SUCCESS FIX: when RLS filters the row, .update() returns success
      // with ZERO rows and no error — button showed ✓ but the DB never changed,
      // so the session stayed 'รอรีวิว' forever and could be re-reviewed endlessly.
      // .select('id') above makes the row count visible; zero rows = real failure.
      if (!updRows || !updRows.length) {
        throw new Error('สิทธิ์ในฐานข้อมูลยังไม่เปิดให้ TL รีวิว — รัน sql/ci_sessions_tl_review.sql ใน Supabase');
      }
      if (btn) {
        btn.disabled = false;
        btn.textContent = '✓ บันทึกแล้ว';
        btn.style.background = '#34C759';
        setTimeout(() => {
          btn.textContent = alreadyReviewed ? '✓ อัปเดต Note' : '✓ บันทึก + รีวิวแล้ว';
          btn.style.background = '#534AB7';
        }, 1800);
      }
      // v566: first review succeeded — flip the button into 'update note' mode so a
      // second tap updates the note instead of looking like a fresh review.
      if (!alreadyReviewed && btn) {
        try { btn.setAttribute('onclick', "CI._saveTLSessionNote('" + sessionId + "', true)"); } catch(_e) {}
      }
      // refresh feed + badge in background
      setTimeout(() => { _loadInlineHistory(); _loadVisitBadge(); _loadVisitHero(); }, 800);
    } catch(e) {
      if (btn) { btn.disabled = false; btn.textContent = alreadyReviewed ? '✓ อัปเดต Note' : 'บันทึก + รีวิว'; }
      _toast('บันทึกไม่สำเร็จ: ' + e.message);
    }
  }

  // ── Haversine distance (metres) between two lat/lng points ──────────────────
  function _haversine(lat1, lng1, lat2, lng2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2)*Math.sin(dLat/2)
            + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)
            * Math.sin(dLng/2)*Math.sin(dLng/2);
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  // (v552: duplicate _covisitVerify removed — เหลือตัวเดียวด้านล่าง รองรับทั้ง 2 entry)

  function _closeSessionDetail() {
    const sheet = document.getElementById('ci-sess-detail');
    if (!sheet) return;
    sheet.classList.remove('open');
    setTimeout(() => sheet.remove(), 400);
  }

  function _renderInlineHistory(sessions) {
    // v498: AD uses KAM-style grouping (by month), not sales-style (by account)
    const _salesMode = typeof isSalesRole === 'function' &&
      isSalesRole(typeof getCurrentRole === 'function' ? getCurrentRole() : '') &&
      !isADAny(typeof getCurrentRole === 'function' ? getCurrentRole() : '');
    const _groupBySales = _salesMode && !_accountGuid;

    function _renderSessionCard(s, opts) {
      const date = new Date(s.visited_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'});
      const dur = s.duration_secs ? _fmt(s.duration_secs) : '';
      const acctLabel = s.account_name || (portviewBulkData?.find(r=>(r.id||r.account_guid)===s.account_id)?.name) || s.account_id || '—';
      const skills = s.skill_scores?.skills || [];
      // v569 module dot system: hue = module, tint = state — no labels (they never fit)
      const skillDots = skills.slice(0,10).map(sk => {
        const code = sk.code || sk.skill_code || '';
        const sc = sk.tl_override || sk.score;
        const col = (typeof window._skDotColor === 'function')
          ? window._skDotColor(code, sc)
          : (sc==='pass'?'#34C759':sc==='developing'?'#FF9500':'#E5E5EA');
        return `<span style="width:8px;height:8px;border-radius:50%;background:${col};flex-shrink:0;display:inline-block" title="${code}"></span>`;
      }).join('');
      const actions = (s.next_actions||[]).slice(0,2).map(a=>
        `<span style="font-size:10px;color:var(--ac,#FF385C);background:rgba(255,56,92,.07);padding:3px 8px;border-radius:6px;font-weight:500">${a.action||a}</span>`
      ).join('');
      const titleLeft = opts?.showAccount ? acctLabel : ((_accountGuid || _groupBySales) ? date : acctLabel);
      const titleRight = opts?.showAccount ? date + (dur?' · '+dur:'') : ((_accountGuid || _groupBySales) ? dur : date + (dur?' · '+dur:''));
      // TL coaching note — purple dot indicator + read-only note (rep sees this)
      const hasTLNote = !!(s.tl_note && s.tl_note.trim());
      const tlNoteDot = hasTLNote
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:10px;font-weight:500;color:#534AB7;font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">` +
          `<span style="width:5px;height:5px;border-radius:50%;background:#534AB7;flex-shrink:0"></span>TL note</span>` : '';
      // v569: boxed style replaced with hairline-quote — matches Skills/Echo design
      // language (hairline accents over filled boxes) instead of the generic look
      const tlNoteHtml = hasTLNote
        ? `<div style="margin-top:8px;padding:2px 0 2px 10px;border-left:2px solid rgba(83,74,183,.35)">` +
          `<div style="font-size:10px;font-weight:600;letter-spacing:.1em;color:#534AB7;font-family:'Noto Sans Thai',sans-serif;margin-bottom:2px">TL NOTE</div>` +
          `<div style="font-size:13px;color:#48484A;line-height:1.65;font-family:'Noto Sans Thai',sans-serif">${s.tl_note}</div></div>` : '';
      // Co-visit badge — shown when TL has verified proximity
      const cvDot = s.covisit_verified
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;font-weight:500;color:#34C759;font-family:'Noto Sans Thai',sans-serif">` +
          `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit</span>` : '';
      return `<div onclick="CI._openSessionDetail('${s.id}')" style="cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:14px;border:0.5px solid ${hasTLNote?'rgba(83,74,183,.2)':'rgba(255,255,255,.55)'};box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:13px;font-weight:600;color:var(--tx,#1C1C1E);min-width:0;padding-right:8px">${titleLeft}</span>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;white-space:nowrap">
            ${cvDot}
            ${tlNoteDot}
            <span style="font-size:11px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${titleRight}</span>
          </div>
        </div>
        ${skillDots ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${(actions||hasTLNote)?'8px':'0'}">${skillDots}</div>` : ''}
        ${actions ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${hasTLNote?'8px':'0'}">${actions}</div>` : ''}
        ${tlNoteHtml}
      </div>`;
    }

    if (_groupBySales) {
      // Sales mode without specific account: group by account_name
      const byAccount = {};
      sessions.forEach(s => {
        const key = s.account_name || s.account_id || '—';
        if (!byAccount[key]) byAccount[key] = { label: key, items: [] };
        byAccount[key].items.push(s);
      });
      return Object.entries(byAccount).map(([,grp]) => {
        const items = grp.items.map(s => _renderSessionCard(s, { showAccount: false })).join('');
        return `<div style="font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:var(--mono,'Noto Sans Thai',monospace);margin:12px 0 8px">${grp.label}</div>${items}`;
      }).join('');
    }

    // Default (KAM): group by month
    const byMonth = {};
    sessions.forEach(s => {
      const d = new Date(s.visited_at);
      const key = d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0');
      if (!byMonth[key]) byMonth[key] = { label: d.toLocaleDateString('th-TH',{month:'long',year:'2-digit'}), items: [] };
      byMonth[key].items.push(s);
    });
    return Object.entries(byMonth).map(([,grp]) => {
      const items = grp.items.map(s => _renderSessionCard(s)).join('');
      return `<div style="font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:var(--mono,'Noto Sans Thai',monospace);margin:12px 0 8px">${grp.label}</div>${items}`;
    }).join('');
  }

  function _renderLegacyHistory(sessions) {
    return sessions.map(sess => {
      const dateLabel = new Date(sess.session_date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
      const skillDots = sess.skills.map(sk => {
        const sc = sk.tl_override||sk.score;
        const col = sc==='pass'?'var(--success,#34C759)':sc==='developing'?'var(--warning,#FF9500)':'var(--n-100,#E5E5EA)';
        return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:${col};font-family:'Noto Sans Thai',sans-serif"><span style="width:5px;height:5px;border-radius:50%;background:${col}"></span>${sk.skill_code}</span>`;
      }).join('');
      return `<div style="background:rgba(255,255,255,.72);backdrop-filter:blur(24px);border-radius:14px;border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);padding:12px 14px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:600;color:var(--tx,#1C1C1E);margin-bottom:8px">${dateLabel}</div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${skillDots}</div>
      </div>`;
    }).join('');
  }

  // ── Data scope (spec Table 2): rep เห็นเฉพาะพอร์ตตัวเอง ─────────────────────
  function _scopedPortview(rows) {
    if (_canDebrief()) return rows; // TL/Admin — full team (แต่ TL ไม่มี picker อยู่แล้ว)
    const me = (currentUserProfile && currentUserProfile.email || '').toLowerCase();
    if (!me || !rows || !rows.length) return rows || [];
    const hasOwnerField = rows.some(r => r.kamEmail || r.kam_email || r.owner_email);
    if (!hasOwnerField) return rows; // dataset ไม่มี owner column — อย่าทำ picker ว่างผิดๆ
    return rows.filter(r => {
      const e = (r.kamEmail || r.kam_email || r.owner_email || '');
      return e && e.toLowerCase() === me;
    });
  }

  // ── Inline picker builders (Echo design system) ──────────────────────────────
  function _buildKamPickerInline() {
    let recentRows = '';
    try {
      if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
        // v552: real fields = id/name/accountType + ownership scope
        const sorted = _scopedPortview(portviewBulkData)
          .filter(r => r.name || r.res_name)
          .sort((a,b) => (b.gmvToDate||b.gmv_mtd||0) - (a.gmvToDate||a.gmv_mtd||0))
          .slice(0, 6);
        recentRows = sorted.map(r => {
          const _n = r.name || r.res_name || '-';
          const _g = r.id || r.account_guid || '';
          const _s = r.accountType || r.account_type || '';
          return `
          <button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:14px;border:none;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left"
            onclick="CI._pickerConfirmKam('${_g}','${_n.replace(/'/g,"\\'")}','${_s}')">
            <span style="font-size:13px;font-weight:500;color:#1C1C1E;flex:1">${_n}</span>
            <span style="font-size:10px;font-weight:600;color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em">${_s}</span>
          </button>`;
        }).join('');
      }
    } catch(e) {}
    const emptyMsg = recentRows ? '' : '<div style="text-align:center;padding:24px 0;font-size:13px;color:#AEAEB2">ยังไม่มีข้อมูลร้านค้า</div>';
    return `
      <div style="font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">กำลังคุยกับร้านไหน?</div>
      <input id="ci-pk-search" type="search" placeholder="ค้นหาชื่อร้าน..." autocomplete="off"
        style="width:100%;padding:12px 16px;border:1px solid #E5E5EA;border-radius:12px;font-size:14px;outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        oninput="CI._pickerSearchInline(this.value)"
        onfocus="CI._pickerSearchInline(this.value)" />
      <div id="ci-pk-list-inline" style="display:flex;flex-direction:column;gap:8px;flex:1;overflow-y:auto">
        ${recentRows}${emptyMsg}
      </div>`;
  }

  function _buildSalesPickerInline() {
    // v552: hybrid (spec Table 2) — ร้านในพอร์ตตัวเอง + Lead free-text
    const own = _scopedPortview(
      (window.portviewBulkData && window.portviewBulkData.length)
        ? window.portviewBulkData
        : (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    ).filter(r => r.name || r.res_name);
    const ownRows = own
      .sort((a,b) => (b.gmvToDate||0) - (a.gmvToDate||0))
      .slice(0, 5)
      .map(r => _salesAcctRow(r)).join('');
    const acctSection = own.length ? `
      <div style="font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">ร้านในพอร์ตของคุณ</div>
      <input id="ci-sales-acct-search" type="search" placeholder="ค้นหาร้านในพอร์ต..." autocomplete="off"
        style="width:100%;padding:12px 16px;border:1px solid #E5E5EA;border-radius:12px;font-size:14px;outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        oninput="CI._salesPickerSearch(this.value)" />
      <div id="ci-sales-acct-list" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto">${ownRows}</div>
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0"><div style="flex:1;height:0.5px;background:#E5E5EA"></div><span style="font-size:10px;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif">หรือ</span><div style="flex:1;height:0.5px;background:#E5E5EA"></div></div>` : '';
    return acctSection + `
      <div style="font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">ร้านใหม่ / Lead</div>
      <input id="ci-sales-name-inline" type="text" placeholder="พิมพ์ชื่อร้านใหม่..." autocomplete="off"
        style="width:100%;padding:13px 16px;border:1.5px solid #FF385C;border-radius:12px;font-size:15px;outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        onkeydown="if(event.key==='Enter')CI._pickerConfirmSales(this.value)" />
      <button onclick="CI._pickerConfirmSales(document.getElementById('ci-sales-name-inline').value)"
        style="width:100%;padding:14px;border:none;border-radius:14px;background:#FF385C;color:#fff;font-size:15px;font-weight:500;cursor:pointer;font-family:'Noto Sans Thai',sans-serif;letter-spacing:-.02em">
        เริ่มบันทึก (Lead)
      </button>`;
  }

  function _salesAcctRow(r) {
    const _n = r.name || r.res_name || '-';
    const _g = r.id || r.account_guid || '';
    const _s = r.accountType || r.account_type || 'SA';
    return `<button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:14px;border:0.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left"
      onclick="CI._pickerConfirmKam('${_g}','${_n.replace(/'/g,"\\'")}','${_s}')">
      <span style="font-size:13px;font-weight:500;color:#1C1C1E;flex:1">${_n}</span>
      <span style="font-size:10px;font-weight:600;color:#FF385C;letter-spacing:.06em">${_s}</span>
    </button>`;
  }

  function _salesPickerSearch(q) {
    const list = document.getElementById('ci-sales-acct-list');
    if (!list) return;
    const own = _scopedPortview(
      (window.portviewBulkData && window.portviewBulkData.length)
        ? window.portviewBulkData
        : (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
    ).filter(r => r.name || r.res_name);
    const qLow = (q||'').toLowerCase().trim();
    const filtered = (qLow
      ? own.filter(r => ((r.name||r.res_name||'').toLowerCase().includes(qLow)))
      : own.sort((a,b) => (b.gmvToDate||0) - (a.gmvToDate||0))
    ).slice(0, 8);
    list.innerHTML = filtered.length
      ? filtered.map(r => _salesAcctRow(r)).join('')
      : '<div style="text-align:center;padding:16px 0;font-size:12px;color:#AEAEB2">ไม่พบในพอร์ต — ใช้ช่อง Lead ด้านล่าง</div>';
  }

  // ── Build outlet index from bulkOutletsData ─────────────────────────────────
  // Returns Map<outlet_name_lower → account_id>
  // Built once per search session — cheap, ~1000 outlets max
  function _buildOutletIndex() {
    const idx = new Map();
    try {
      const od = window.bulkOutletsData || (typeof bulkOutletsData !== 'undefined' ? bulkOutletsData : null);
      if (!od) return idx;
      Object.entries(od).forEach(([accountId, months]) => {
        // months = { 'พ.ค. 2569': [{outlet_id, outlet_name, ...}] }
        const seen = new Set();
        Object.values(months).forEach(outlets => {
          (outlets||[]).forEach(o => {
            const n = (o.outlet_name||'').trim();
            if (n && !seen.has(n)) { seen.add(n); idx.set(n.toLowerCase(), accountId); }
          });
        });
      });
    } catch(e) { /* non-fatal */ }
    return idx;
  }

  function _pickerSearchInline(q) {
    const list = document.getElementById('ci-pk-list-inline');
    if (!list) return;
    try {
      const _rawSrc = (window.portviewBulkData && window.portviewBulkData.length)
        ? window.portviewBulkData
        : (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
      const src = _scopedPortview(_rawSrc); // v552: rep เห็นเฉพาะพอร์ตตัวเอง (spec Table 2)
      const qLow = (q||'').toLowerCase().trim();

      let filtered;
      if (!qLow) {
        // Default: top accounts by GMV
        filtered = src.slice().sort((a,b) => (b.gmvToDate||b.gmv||0)-(a.gmvToDate||a.gmv||0)).slice(0,8)
          .map(r => ({ _r: r, _matchLabel: null }));
      } else {
        // 1. Match by account_name (r.name)
        const byAccount = src
          .filter(r => (r.name||'').toLowerCase().includes(qLow))
          .map(r => ({ _r: r, _matchLabel: null }));

        // 2. Match by outlet_name via index — map back to account row
        const outletIdx = _buildOutletIndex();
        const outletMatches = [];
        const seenIds = new Set(byAccount.map(x => x._r.id || x._r.account_guid));
        outletIdx.forEach((accountId, outletNameLow) => {
          if (!outletNameLow.includes(qLow)) return;
          if (seenIds.has(accountId)) return; // already in account matches
          const accountRow = src.find(r => (r.id||r.account_guid) === accountId);
          if (!accountRow) return;
          // Find the matching outlet name for display hint
          const od = window.bulkOutletsData || (typeof bulkOutletsData !== 'undefined' ? bulkOutletsData : null);
          let outletDisplayName = '';
          if (od && od[accountId]) {
            Object.values(od[accountId]).forEach(outlets => {
              (outlets||[]).forEach(o => {
                if ((o.outlet_name||'').toLowerCase().includes(qLow)) outletDisplayName = o.outlet_name;
              });
            });
          }
          seenIds.add(accountId);
          outletMatches.push({ _r: accountRow, _matchLabel: outletDisplayName });
        });

        filtered = [...byAccount, ...outletMatches].slice(0, 8);
      }

      if (!filtered.length) {
        list.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:13px;color:#AEAEB2">' +
          (src.length ? 'ไม่พบร้านค้า' : 'กำลังโหลดข้อมูล...') + '</div>';
        return;
      }

      list.innerHTML = filtered.map(({ _r: r, _matchLabel }) => {
        const name  = r.name || '-';
        const guid  = r.id || r.account_guid || '';
        const seg   = r.accountType || r.account_type || '';
        const safeName = name.replace(/'/g,"\'").replace(/"/g,'&quot;');
        // Outlet match hint — show outlet name in small text below account name
        const hint  = _matchLabel
          ? `<div style="font-size:11px;color:#6C6C70;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">outlet: ${_matchLabel}</div>`
          : '';
        return `<button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:14px;border:none;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left;margin-bottom:6px"
          onclick="CI._pickerConfirmKam('${guid}','${safeName}','${seg}')">
          <div style="flex:1;min-width:0;text-align:left">
            <div style="font-size:13px;font-weight:500;color:#1C1C1E">${name}</div>
            ${hint}
          </div>
          <span style="font-size:10px;font-weight:600;color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;flex-shrink:0;margin-left:8px">${seg}</span>
        </button>`;
      }).join('');
    } catch(e) { console.warn('[CI picker search]', e); }
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  function _topbarLeft() {
    if (_phase === 'recording') { _minimize(); }
    else { cancel(); }
  }

  function open(accountGuid) {
    _phase = 'idle'; _lastResult = null; _secs = 0; _sessionId = null; _isOwnRecording = false;
    _mainTab = 'record';
    _unmount();
    // v552: TL/Admin — covisit panel only, picker ห้ามเปิดเด็ดขาด (spec Table 3)
    if (_canDebrief()) {
      _accountGuid = null; _accountName = ''; _accountSeg = '';
      _showPicker = false;
      _ownerType = 'kam';
      setTimeout(_mount, 50);
      return;
    }
    // Detect owner type from profile
    const role = (typeof getCurrentRole === 'function') ? getCurrentRole() : 'rep';
    // v498: AD uses KAM picker (existing accounts) not Sales name-input
    _ownerType = (role === 'sales') ? 'sales' : (role === 'ad' || role === 'ad_tl') ? 'ad' : 'kam';

    if (_ownerType === 'sales') {
      // Sales always sees name input first
      _accountGuid = null; _accountName = ''; _accountSeg = '';
      _showPicker = true;
      setTimeout(_mount, 50);
      return;
    }
    // KAM: smart detect
    // Only skip picker if BOTH: has accountGuid/currentAccountId AND user is actively in account view
    const _inAccountView = document.body.classList.contains('restaurant-sheet');
    const resolved = accountGuid || (_inAccountView && typeof currentAccountId !== 'undefined' ? currentAccountId : null);
    if (resolved) {
      _accountGuid = resolved;
      const ctx = _ctx();
      _accountName = ctx.name; _accountSeg = ctx.seg;
      setTimeout(_mount, 50);
    } else {
      _accountGuid = null; _accountName = ''; _accountSeg = '';
      _showPicker = true;
      setTimeout(_mount, 50);
    }
  }

  function _mountPicker() {
    if (document.getElementById('ci-picker-sheet')) return;
    if (!document.getElementById('ci-style')) {
      const s = document.createElement('style');
      s.id = 'ci-style'; s.textContent = _CSS;
      document.head.appendChild(s);
    }
    const el = document.createElement('div');
    el.id = 'ci-picker-sheet';
    el.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(10,16,30,.72);display:flex;align-items:flex-end;justify-content:center;backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px)';
    el.innerHTML = _ownerType === 'sales' ? _buildSalesPickerHTML() : _buildKamPickerHTML();
    document.body.appendChild(el);
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const sheet = el.querySelector('.ci-picker-inner');
      if (sheet) sheet.style.transform = 'translateY(0)';
    }));
  }

  function _dismissPicker() {
    // Legacy — kept for compat
    const el = document.getElementById('ci-picker-sheet');
    if (el) el.remove();
  }

  // ── Orb tap dispatcher — check-in state vs record state ───────────────────
  function _orbTap() {
    if (_phase !== 'idle') return;
    const hint = document.getElementById('ci-thint');
    if (hint && hint.dataset.mode === 'checkin') {
      _doCheckin();
    } else {
      startRecording();
    }
  }

  // ── Show check-in orb (map-pin) — after picker confirm, before check-in ───
  function _showCheckinOrb() {
    const mic = document.getElementById('ci-orb-icon-mic');
    const pin = document.getElementById('ci-orb-icon-pin');
    const hint = document.getElementById('ci-thint');
    if (mic) mic.style.display = 'none';
    if (pin) pin.style.display = '';
    if (hint) { hint.textContent = 'กดเพื่อเช็คอิน'; hint.dataset.mode = 'checkin'; }
  }

  // ── Show mic orb — after check-in done ────────────────────────────────────
  function _showMicOrb() {
    const mic = document.getElementById('ci-orb-icon-mic');
    const pin = document.getElementById('ci-orb-icon-pin');
    const hint = document.getElementById('ci-thint');
    if (mic) mic.style.display = '';
    if (pin) pin.style.display = 'none';
    if (hint) { hint.textContent = 'กดเพื่อเริ่มบันทึก'; hint.dataset.mode = 'record'; }
  }

  // ── GPS check-in — snap location, cache, show bar + mic orb ──────────────
  async function _doCheckin() {
    const hint = document.getElementById('ci-thint');
    const core = document.getElementById('ci-orb-core');
    if (hint) hint.textContent = 'กำลังระบุตำแหน่ง...';
    if (core) core.classList.add('orb-snapping');   // v552: visual feedback ระหว่าง GPS snap
    try {
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('GPS ไม่รองรับ')); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
      });
      const now = new Date();
      _checkinCache = {
        rep_lat:       pos.coords.latitude,
        rep_lng:       pos.coords.longitude,
        checked_in_at: now.toISOString(),
        account_guid:  _accountGuid,
      };
      // Persist to localStorage so it survives app restart within session
      try { localStorage.setItem('ci_checkin_cache', JSON.stringify(_checkinCache)); } catch(_) {}

      // v552: success feedback — green flash + toast + pill บอกเวลาหมดอายุ (90 นาที)
      if (core) {
        core.classList.remove('orb-snapping');
        core.classList.add('orb-checkin-ok');
        setTimeout(() => core.classList.remove('orb-checkin-ok'), 1100);
      }
      const _tStr = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      const _expStr = new Date(now.getTime() + 90*60000).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      if (typeof showToast === 'function') showToast('เช็คอินสำเร็จ ' + _tStr, '✓');
      const pill = document.getElementById('ci-checkin-pill');
      const timeEl = document.getElementById('ci-checkin-time');
      if (timeEl) timeEl.textContent = _tStr + ' · ถึง ' + _expStr;
      if (pill) pill.style.display = 'flex';

      // Switch orb to mic
      _showMicOrb();

    } catch(e) {
      if (core) core.classList.remove('orb-snapping');
      const msg = e.code === 1 ? 'ไม่ได้รับสิทธิ์ GPS — อนุญาตในการตั้งค่า'
                : e.code === 2 ? 'ระบุตำแหน่งไม่ได้ — ลองกลางแจ้ง'
                : e.code === 3 ? 'GPS timeout — ลองอีกครั้ง'
                : 'GPS error: ' + e.message;
      _toast(msg);
      if (hint) { hint.textContent = 'กดเพื่อเช็คอิน'; hint.dataset.mode = 'checkin'; }
    }
  }

  function _hidePicker() {
    // Hide inline picker, reveal record UI + update chip
    // v552: visibility via state machine (callers set _showPicker=false first)
    _renderEchoState();
    const chip = document.getElementById('ci-chip-wrap');
    if (chip) {
      // Update chip text
      const ctx = _ctx();
      const nameEl = chip.querySelector('.chip-txt');
      const segEl = chip.querySelector('.chip-seg');
      const dotEl = chip.querySelector('.chip-dot');
      if (nameEl) nameEl.textContent = ctx.name || _accountName || 'ร้านค้า';
      if (segEl) { segEl.textContent = _accountSeg === 'LEAD' ? 'LEAD' : ctx.seg; segEl.style.color = _accountSeg === 'LEAD' ? '#FF9500' : ''; }
      if (dotEl) dotEl.style.background = _accountSeg === 'LEAD' ? '#FF9500' : '';
    }
  }

  function _pickerConfirmKam(guid, name, seg) {
    _accountGuid = guid; _accountName = name; _accountSeg = seg || '';
    _showPicker = false;
    _hidePicker();
    // Restore checkin cache if same account was checked-in this session
    try {
      const cached = JSON.parse(localStorage.getItem('ci_checkin_cache') || 'null');
      if (cached && cached.account_guid === guid) {
        const minsAgo = (Date.now() - new Date(cached.checked_in_at).getTime()) / 60000;
        if (minsAgo < 90) {
          _checkinCache = cached;
          const pill = document.getElementById('ci-checkin-pill');
          const timeEl = document.getElementById('ci-checkin-time');
          const t = new Date(cached.checked_in_at);
          const _exp = new Date(t.getTime() + 90*60000);
          if (timeEl) timeEl.textContent = t.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })
            + ' · ถึง ' + _exp.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
          if (pill) pill.style.display = 'flex';
          _showMicOrb();
          return;
        }
      }
    } catch(_) {}
    _showCheckinOrb();
  }

  function _pickerConfirmSales(name) {
    if (!name || !name.trim()) return;
    _accountGuid = null; _accountName = name.trim(); _accountSeg = 'LEAD';
    _showPicker = false;
    _hidePicker();
    _showCheckinOrb();
  }

  function _buildKamPickerHTML() {
    let recents = '';
    try {
      if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
        recents = portviewBulkData
          .filter(r => r.res_name)
          .sort((a,b) => (b.gmv_mtd||0) - (a.gmv_mtd||0))
          .slice(0, 5)
          .map(r => `<button class="ci-pk-item" onclick="CI._pickerConfirmKam('${r.account_guid}','${(r.res_name||'').replace(/'/g,"\\'")}','${r.account_type||''}')">
            <span class="ci-pk-name">${r.res_name||'-'}</span>
            <span class="ci-pk-seg">${r.account_type||'-'}</span>
          </button>`).join('');
      }
    } catch(e) {}
    return `<div class="ci-picker-inner" style="background:#fff;border-radius:28px 28px 0 0;padding:20px 20px 32px;width:100%;max-width:440px;transform:translateY(100%);transition:transform .3s cubic-bezier(.16,1,.3,1);">
      <div style="width:36px;height:4px;border-radius:2px;background:rgba(0,0,0,.12);margin:0 auto 20px;"></div>
      <div style="font-size:13px;font-weight:600;color:#1C1C1E;margin-bottom:4px;">เลือกร้านค้า</div>
      <div style="font-size:12px;color:#636366;margin-bottom:16px;">หรือค้นหาด้านล่าง</div>
      <input id="ci-pk-search" type="search" placeholder="ค้นหาชื่อร้าน..." autocomplete="off"
        style="width:100%;padding:11px 14px;border:1px solid #E5E5EA;border-radius:12px;font-size:14px;outline:none;margin-bottom:12px;box-sizing:border-box;"
        oninput="CI._pickerSearch(this.value)" />
      <div id="ci-pk-list" style="max-height:240px;overflow-y:auto;display:flex;flex-direction:column;gap:4px;">${recents}</div>
      <button onclick="CI._dismissPicker()" style="margin-top:16px;width:100%;padding:12px;border:none;border-radius:12px;background:rgba(0,0,0,.06);font-size:14px;color:#636366;cursor:pointer;">ยกเลิก</button>
    </div>`;
  }

  function _buildSalesPickerHTML() {
    return `<div class="ci-picker-inner" style="background:#fff;border-radius:28px 28px 0 0;padding:20px 20px 32px;width:100%;max-width:440px;transform:translateY(100%);transition:transform .3s cubic-bezier(.16,1,.3,1);">
      <div style="width:36px;height:4px;border-radius:2px;background:rgba(0,0,0,.12);margin:0 auto 20px;"></div>
      <div style="font-size:13px;font-weight:600;color:#1C1C1E;margin-bottom:4px;">คุณกำลังคุยกับร้านไหน?</div>
      <div style="font-size:12px;color:#636366;margin-bottom:16px;">พิมพ์ชื่อร้าน ใช้สำหรับเก็บประวัติการสนทนา</div>
      <input id="ci-sales-name" type="text" placeholder="ชื่อร้าน..." autocomplete="off"
        style="width:100%;padding:13px 14px;border:1.5px solid #FF385C;border-radius:12px;font-size:15px;outline:none;margin-bottom:12px;box-sizing:border-box;"
        onkeydown="if(event.key==='Enter')CI._pickerConfirmSales(this.value)" />
      <button onclick="CI._pickerConfirmSales(document.getElementById('ci-sales-name').value)"
        style="width:100%;padding:13px;border:none;border-radius:12px;background:#FF385C;color:#fff;font-size:15px;font-weight:600;cursor:pointer;margin-bottom:8px;">เริ่มบันทึก</button>
      <button onclick="CI._dismissPicker()" style="width:100%;padding:12px;border:none;border-radius:12px;background:rgba(0,0,0,.06);font-size:14px;color:#636366;cursor:pointer;">ยกเลิก</button>
    </div>`;
  }

  function _pickerSearch(q) {
    const list = document.getElementById('ci-pk-list');
    if (!list) return;
    try {
      const filtered = (typeof portviewBulkData !== 'undefined' ? portviewBulkData : [])
        .filter(r => r.res_name && r.res_name.toLowerCase().includes(q.toLowerCase()))
        .slice(0, 8);
      list.innerHTML = filtered.map(r =>
        `<button class="ci-pk-item" onclick="CI._pickerConfirmKam('${r.account_guid}','${(r.res_name||'').replace(/'/g,"\\'")}','${r.account_type||''}')">
          <span class="ci-pk-name">${r.res_name||'-'}</span>
          <span class="ci-pk-seg">${r.account_type||'-'}</span>
        </button>`).join('');
    } catch(e) {}
  }
  // ── Dark mode theme transition (recording ↔ idle) ─────────────────────────
  function _applyRecordingTheme(isRec) {
    const sheet = document.getElementById('ci-fullsheet');
    if (!sheet) return;

    // v552: visibility via state machine only (spec Table 1)
    _renderEchoState();

    // Status label
    const rlbl = document.getElementById('ci-rlbl');
    if (rlbl) {
      rlbl.textContent = isRec ? 'รับฟังอยู่' : '';
      rlbl.style.fontWeight = isRec ? '400' : '500';
    }
    // Topbar left
    const tbLeft = document.getElementById('ci-topbar-left-label');
    if (tbLeft) tbLeft.textContent = isRec ? 'ย่อ' : 'ยกเลิก';
    const tbIcon = document.getElementById('ci-topbar-left-icon');
    if (tbIcon) tbIcon.style.display = isRec ? 'none' : '';

    if (isRec) {
      sheet.classList.add('is-rec');
      // → DARK
      sheet.style.transition = 'transform 380ms cubic-bezier(0.16,1,0.3,1), background .7s ease';
      sheet.style.background = '#111111';
      // v601: iOS PWA renders the area outside/behind the sheet from <html> background
      // body.echo-active { background:#111 } catches body but not the html overscroll zone
      // Setting documentElement directly ensures the white gap below sheet disappears
      try { document.documentElement.style.background = '#111111'; } catch(_) {}
      const tb = sheet.querySelector('.topbar');
      if (tb) { tb.style.background='rgba(255,255,255,.04)'; tb.style.borderColor='rgba(255,255,255,.06)'; }
      _themeEl('ci-tval', 'color', 'rgba(255,255,255,.28)'); // v553: dim — working silently feel
      _themeEl('ci-rlbl',       'color', 'rgba(255,255,255,.25)');
      _themeEl('ci-topbar-left','color', 'rgba(255,255,255,.22)');
      _themeEl('ci-tab-pill',   'background', 'rgba(255,255,255,.1)');
      // chip
      const chip = sheet.querySelector('.chip');
      if (chip) chip.style.background = 'rgba(255,255,255,.06)';
      const chipTxt = sheet.querySelector('.chip-txt');
      if (chipTxt) chipTxt.style.color = 'rgba(255,255,255,.28)';
      // visit hero
      const vhCard = document.getElementById('ci-vh-card');
      if (vhCard) { vhCard.style.background = 'rgba(255,255,255,.04)'; vhCard.style.borderColor = 'rgba(255,255,255,.07)'; }
      _themeEl('ci-vh-div',    'background', 'rgba(255,255,255,.08)');
      _themeEl('ci-vh-wlabel', 'color', 'rgba(255,255,255,.2)');
      _themeEl('ci-vh-qlabel', 'color', 'rgba(255,255,255,.2)');
      _themeEl('ci-vh-wnum',   'color', 'rgba(255,255,255,.28)');
      _themeEl('ci-vh-qnum',   'color', 'rgba(255,255,255,.28)');
      _themeEl('ci-vh-wsub',   'color', 'rgba(255,255,255,.18)');
      _themeEl('ci-vh-qsub',   'color', 'rgba(255,255,255,.18)');
      // dots
      sheet.querySelectorAll('.ci-vh-dot-fill').forEach(d => d.style.background = 'rgba(255,56,92,.45)');
      sheet.querySelectorAll('.ci-vh-dot-gold').forEach(d => d.style.background = 'rgba(255,179,0,.45)');
      sheet.querySelectorAll('.ci-vh-dot-empty').forEach(d => d.style.background = 'rgba(255,255,255,.08)');
      // stop btn
      const sb = document.getElementById('ci-stop-btn');
      if (sb) { sb.style.background='transparent'; sb.style.color='rgba(255,255,255,.35)'; sb.style.borderColor='rgba(255,255,255,.16)'; }
      // tab bar
      const tabRec = document.getElementById('ci-tab-rec');
      if (tabRec) { tabRec.style.background='rgba(255,255,255,.1)'; tabRec.style.color='rgba(255,255,255,.4)'; tabRec.style.boxShadow='none'; }
      const tabHist = document.getElementById('ci-tab-hist');
      if (tabHist) tabHist.style.color = 'rgba(255,255,255,.2)';
      const tabBar = document.getElementById('ci-main-tabs');
      if (tabBar) tabBar.style.background = 'rgba(255,255,255,.06)';
    } else {
      sheet.classList.remove('is-rec');
      // → LIGHT
      sheet.style.background = '#ffffff';
      // v601: restore html background (was set dark during recording)
      try { document.documentElement.style.background = ''; } catch(_) {}
      const tbL = sheet.querySelector('.topbar');
      if (tbL) { tbL.style.background=''; tbL.style.borderColor=''; }
      _themeEl('ci-tval', 'color', ''); // restore timer color
      _themeEl('ci-rlbl',       'color', 'var(--ac,#FF385C)');
      _themeEl('ci-topbar-left','color', 'var(--tx2,#636366)');
      // chip
      const chip = sheet.querySelector('.chip');
      if (chip) chip.style.background = 'rgba(0,0,0,.04)';
      const chipTxt = sheet.querySelector('.chip-txt');
      if (chipTxt) chipTxt.style.color = '';
      // visit hero
      const vhCard = document.getElementById('ci-vh-card');
      if (vhCard) { vhCard.style.background = 'rgba(255,56,92,.04)'; vhCard.style.borderColor = 'rgba(255,56,92,.13)'; }
      _themeEl('ci-vh-div',    'background', 'rgba(255,56,92,.12)');
      _themeEl('ci-vh-wlabel', 'color', '#AEAEB2');
      _themeEl('ci-vh-qlabel', 'color', '#AEAEB2');
      _themeEl('ci-vh-wnum',   'color', '#1C1C1E');
      _themeEl('ci-vh-qnum',   'color', '#1C1C1E');
      _themeEl('ci-vh-wsub',   'color', '#AEAEB2');
      _themeEl('ci-vh-qsub',   'color', '#AEAEB2');
      // dots
      sheet.querySelectorAll('.ci-vh-dot-fill').forEach(d => d.style.background = '#FF385C');
      sheet.querySelectorAll('.ci-vh-dot-gold').forEach(d => d.style.background = '#FFB300');
      sheet.querySelectorAll('.ci-vh-dot-empty').forEach(d => d.style.background = 'rgba(255,56,92,.15)');
      // stop btn
      const sb = document.getElementById('ci-stop-btn');
      if (sb) { sb.style.background='transparent'; sb.style.color='rgba(0,0,0,.35)'; sb.style.borderColor='rgba(0,0,0,.14)'; }
      // tab bar
      const tabRec = document.getElementById('ci-tab-rec');
      if (tabRec) { tabRec.style.background='#fff'; tabRec.style.color='#1C1C1E'; tabRec.style.boxShadow='0 1px 3px rgba(0,0,0,.08)'; }
      const tabHist = document.getElementById('ci-tab-hist');
      if (tabHist) tabHist.style.color = 'var(--tx3,#AEAEB2)';
      const tabBar = document.getElementById('ci-main-tabs');
      if (tabBar) tabBar.style.background = '';
    }
  }

  // ── Visibility guard — PWA resume after screen lock ────────────────────────
  // When page becomes visible again: if we think we're recording but MediaRecorder
  // has stopped (iOS), show a recoverable error toast. Timer auto-corrects via Date.now().
  (function _initVisibilityGuard() {
    document.addEventListener('visibilitychange', function() {
      if (document.visibilityState !== 'visible') return;
      // v601: bfcache guard — ถ้า page restore แล้ว sheet ไม่อยู่ (minimized/killed)
      // แต่ body.overflow ยัง hidden ค้าง → restore ทันที
      if (document.body.style.overflow === 'hidden') {
        const sheet = document.getElementById('ci-fullsheet');
        if (!sheet || sheet.style.display === 'none') {
          _restoreBodyScroll();
        }
      }
      if (_phase !== 'recording') return;
      // Timer display self-corrects (Date.now() diff), just force a UI tick
      const el = document.getElementById('ci-tval');
      if (el) {
        _secs = Math.floor((Date.now() - _startTime) / 1000);
        el.textContent = _fmt(_secs);
      }
      // v555: MediaRecorder ถูก OS หยุด — กู้ chunks ที่มีไปวิเคราะห์ทันที
      // เช็ค _chunks.length กัน double-run (ถ้า onstop เคย fire แล้ว chunks ถูกเคลียร์)
      if (_recorder && _recorder.state === 'inactive' && _chunks.length > 0) {
        clearInterval(_timerRef);
        _durText = _fmt(_secs);
        try { _recorder.stream?.getTracks().forEach(t => t.stop()); } catch(_) {}
        try { if (_audioCtx) { _audioCtx.close(); _audioCtx = null; } } catch(_) {}
        _phase = 'processing';
        _applyRecordingTheme(false);
        _showScreen('ci-s-proc');
        _setStep('กำลังวิเคราะห์...', 'การบันทึกถูกหยุดโดยระบบ — ใช้เสียงที่มี', 14);
        _toast('การบันทึกถูกหยุดโดยระบบ — กำลังวิเคราะห์เสียงที่มี');
        _onStop();
      }
    });
  })();

  function _themeEl(id, prop, val) {
    const el = document.getElementById(id);
    if (el) el.style[prop.replace(/-([a-z])/g, (_,c) => c.toUpperCase())] = val;
  }

  // ── Load visit hero (weekly + quarterly counts from ci_sessions) ──────────
  async function _loadVisitHero() {
    const dots  = document.getElementById('ci-vh-dots');
    const wnum  = document.getElementById('ci-vh-wnum');
    const qnum  = document.getElementById('ci-vh-qnum');
    if (!dots || !wnum || !qnum) return;
    const email = currentUserProfile?.email;
    if (!email || _canDebrief()) return; // TL/Admin don't see hero
    try {
      const now = new Date();
      // Week start (Mon)
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const weekStart = new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(now.getDate() - dow);
      // Quarter start (Jan/Apr/Jul/Oct)
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);

      const [wRes, qRes] = await Promise.all([
        supa.from('ci_sessions').select('*', { count: 'exact', head: true })
          .eq('owner_email', email).gte('visited_at', weekStart.toISOString()),
        supa.from('ci_sessions').select('*', { count: 'exact', head: true })
          .eq('owner_email', email).gte('visited_at', qStart.toISOString()),
      ]);

      const wCount = wRes.count ?? 0;
      const qCount = qRes.count ?? 0;

      wnum.textContent = wCount;
      qnum.textContent = qCount;

      // Build dots: 1-5 red, 6-10 gold, empty up to next milestone of 5
      const totalDots = Math.max(5, Math.ceil(wCount / 5) * 5);
      let dotsHtml = '';
      for (let i = 1; i <= totalDots; i++) {
        if (i <= Math.min(wCount, 5)) {
          dotsHtml += '<div class="ci-vh-dot-fill" style="width:8px;height:8px;border-radius:50%;background:#FF385C;flex-shrink:0;transition:background .7s ease"></div>';
        } else if (i > 5 && i <= wCount) {
          dotsHtml += '<div class="ci-vh-dot-gold" style="width:8px;height:8px;border-radius:50%;background:#FFB300;flex-shrink:0;transition:background .7s ease"></div>';
        } else {
          dotsHtml += '<div class="ci-vh-dot-empty" style="width:8px;height:8px;border-radius:50%;background:rgba(255,56,92,.15);flex-shrink:0;transition:background .7s ease"></div>';
        }
      }
      // Add count label after dots
      const countLabel = wCount > 5
        ? `<span style="font-size:10px;color:#FFB300;font-weight:500;margin-left:4px;font-family:'Noto Sans Thai',sans-serif;transition:color .7s ease" class="ci-vh-count-lbl">${wCount} visits</span>`
        : `<span style="font-size:10px;color:#AEAEB2;margin-left:4px;font-family:'Noto Sans Thai',sans-serif;transition:color .7s ease" class="ci-vh-count-lbl">${wCount} / 5</span>`;
      dots.innerHTML = dotsHtml + countLabel;
    } catch(e) {
      console.warn('[CI hero]', e.message);
    }
  }

  // ── TL Co-visit Hero — query covisit_events ────────────────────────────────
  async function _loadCovisitHero() {
    const dots = document.getElementById('ci-vh-dots');
    const wnum = document.getElementById('ci-vh-wnum');
    const qnum = document.getElementById('ci-vh-qnum');
    const wlabel = document.getElementById('ci-vh-wlabel');
    if (!dots || !wnum || !qnum) return;
    const email = currentUserProfile?.email;
    if (!email) return;
    if (wlabel) wlabel.textContent = 'Co-visit สัปดาห์นี้';
    // Show hero card for TL
    const hero = document.getElementById('ci-visit-hero');
    if (hero) hero.style.display = '';
    try {
      const now = new Date();
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      const weekStart = new Date(now); weekStart.setHours(0,0,0,0); weekStart.setDate(now.getDate() - dow);
      const qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      const [wRes, qRes] = await Promise.all([
        supa.from('covisit_events').select('*', { count: 'exact', head: true })
          .eq('tl_email', email).eq('verified', true).gte('checked_at', weekStart.toISOString()),
        supa.from('covisit_events').select('*', { count: 'exact', head: true })
          .eq('tl_email', email).eq('verified', true).gte('checked_at', qStart.toISOString()),
      ]);
      const wCount = wRes.count ?? 0;
      const qCount = qRes.count ?? 0;
      wnum.textContent = wCount;
      qnum.textContent = qCount;
      const totalDots = Math.max(5, Math.ceil(wCount / 5) * 5);
      let dotsHtml = '';
      for (let i = 1; i <= totalDots; i++) {
        if (i <= Math.min(wCount, 5)) dotsHtml += '<div style="width:8px;height:8px;border-radius:50%;background:#FF385C;flex-shrink:0"></div>';
        else if (i > 5 && i <= wCount) dotsHtml += '<div style="width:8px;height:8px;border-radius:50%;background:#FFB300;flex-shrink:0"></div>';
        else dotsHtml += '<div style="width:8px;height:8px;border-radius:50%;background:rgba(255,56,92,.15);flex-shrink:0"></div>';
      }
      dots.innerHTML = dotsHtml + `<span style="font-size:10px;color:#AEAEB2;margin-left:4px;font-family:'Noto Sans Thai',sans-serif">${wCount} co-visits</span>`;
    } catch(e) { console.warn('[CI covisit hero]', e.message); }
  }

  // ── Co-visit verified local cache — กัน DB lag/RLS ทำ row กลับมา "พร้อม" ──
  const CV_DONE_KEY = 'ci_covisit_done';
  function _cvDoneCache() {
    try {
      const m = JSON.parse(localStorage.getItem(CV_DONE_KEY) || '{}');
      const cutoff = Date.now() - 24*3600*1000;
      let dirty = false;
      Object.keys(m).forEach(k => { if (m[k] < cutoff) { delete m[k]; dirty = true; } });
      if (dirty) localStorage.setItem(CV_DONE_KEY, JSON.stringify(m));
      return m;
    } catch(_) { return {}; }
  }
  function _cvMarkDone(sessionId) {
    try {
      const m = _cvDoneCache();
      m[sessionId] = Date.now();
      localStorage.setItem(CV_DONE_KEY, JSON.stringify(m));
    } catch(_) {}
  }

  // ── TL Co-visit List — load today's check-ins from team ───────────────────
  let _cvSelected = null; // { session_id, rep_email, rep_lat, rep_lng, checked_in_at }

  async function _loadCovisitList() {
    const body = document.getElementById('ci-cv-list-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:#AEAEB2">กำลังโหลด...</div>';
    _cvSelected = null;
    _updateCvVerifyBtn();
    try {
      const teamEmails = _getTeamEmails();
      if (!teamEmails.length) { body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:#AEAEB2">ไม่พบน้องในทีม</div>'; return; }
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      const { data, error } = await supa.from('ci_sessions')
        .select('id,owner_email,account_name,checked_in_at,rep_lat,rep_lng,covisit_verified')
        .in('owner_email', teamEmails)
        .gte('checked_in_at', todayStart.toISOString())
        .order('checked_in_at', { ascending: false });
      if (error) throw error;
      // v552: covisit_events คือ source of truth (spec) — ci_sessions flag อาจโดน RLS block
      const verifiedIds = new Set();
      try {
        const ids = (data || []).map(s => s.id);
        if (ids.length) {
          const { data: evs } = await supa.from('covisit_events')
            .select('session_id').eq('verified', true).in('session_id', ids);
          (evs || []).forEach(e => verifiedIds.add(e.session_id));
        }
      } catch(_) {}
      const localDone = _cvDoneCache();
      const merged = (data || []).map(s => ({
        ...s,
        covisit_verified: !!(s.covisit_verified || verifiedIds.has(s.id) || localDone[s.id])
      }));
      body.innerHTML = _renderCovisitList(merged);
    } catch(e) {
      console.warn('[CI covisit list]', e.message);
      body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:#AEAEB2">โหลดไม่สำเร็จ</div>';
    }
  }

  function _renderCovisitList(rows) {
    if (!rows.length) return '<div style="text-align:center;padding:40px 0;font-size:13px;color:#AEAEB2">ยังไม่มีน้องเช็คอินวันนี้</div>';
    const now = Date.now();
    const WINDOW_MS = 90 * 60 * 1000;
    return `<div class="cv-section-hd">วันนี้</div>` + rows.map(s => {
      const repName = s.owner_email ? s.owner_email.split('@')[0] : '—';
      const initials = repName.slice(0,2).toUpperCase();
      const acct = s.account_name || '—';
      const checkinMs = new Date(s.checked_in_at).getTime();
      const checkinTime = new Date(s.checked_in_at).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      const elapsed = now - checkinMs;
      const verified = !!s.covisit_verified;
      let badgeHtml, clickable;
      if (verified) {
        badgeHtml = `<span class="cv-badge cv-badge-done"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Verified</span>`;
        clickable = false;
      } else if (elapsed > WINDOW_MS) {
        badgeHtml = `<span class="cv-badge cv-badge-expired">หมดเวลา</span>`;
        clickable = false;
      } else {
        badgeHtml = `<span class="cv-badge cv-badge-ready"><svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>พร้อม</span>`;
        clickable = true;
      }
      const selStyle = clickable ? 'cursor:pointer;' : 'opacity:.6;';
      const onclickAttr = clickable
        ? `onclick="CI._cvSelectRow('${s.id}','${s.owner_email}',${s.rep_lat||'null'},${s.rep_lng||'null'},'${s.checked_in_at}','${repName}')"`
        : '';
      return `<div class="cv-row" id="cv-row-${s.id}" style="${selStyle}" ${onclickAttr}>
        <div class="cv-avatar">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="cv-name">${repName}</div>
          <div class="cv-sub">${acct} · เช็คอิน ${checkinTime}</div>
        </div>
        ${badgeHtml}
      </div>`;
    }).join('');
  }

  function _cvSelectRow(sessionId, repEmail, repLat, repLng, checkedInAt, repName) {
    _cvSelected = { session_id: sessionId, rep_email: repEmail, rep_lat: repLat, rep_lng: repLng, checked_in_at: checkedInAt };
    // Highlight selected row, deselect others
    document.querySelectorAll('.cv-row').forEach(r => r.style.background = '');
    const row = document.getElementById(`cv-row-${sessionId}`);
    if (row) row.style.background = 'rgba(255,56,92,.04)';
    // Update verify button (SVG pin, no emoji)
    const btn = document.getElementById('ci-cv-verify-btn');
    if (btn) btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>ยืนยัน Co-visit กับ ${repName}`;
    _updateCvVerifyBtn();
  }

  function _updateCvVerifyBtn() {
    const wrap = document.getElementById('ci-cv-verify-wrap');
    if (wrap) wrap.style.display = _cvSelected ? 'block' : 'none';
  }

  // ── Co-visit Verify — rework: Haversine + time window ─────────────────────
  async function _covisitVerify(sessionId, repEmail) {
    // Support both direct call (from session detail v541) and new TL flow (_cvSelected)
    const target = _cvSelected || (sessionId ? { session_id: sessionId, rep_email: repEmail, rep_lat: null, rep_lng: null, checked_in_at: null } : null);
    if (!target) return;

    const btn = document.getElementById('ci-cv-verify-btn') || document.getElementById('sd-covisit-btn');
    const badge = document.getElementById('sd-cv-badge');
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังระบุตำแหน่ง...'; }

    // Optimistic lock: hide verify wrap + lock selected row immediately
    const verifyWrap = document.getElementById('ci-cv-verify-wrap');
    const selectedRow = target.session_id ? document.getElementById(`cv-row-${target.session_id}`) : null;
    if (selectedRow) {
      selectedRow.style.opacity = '0.5';
      selectedRow.style.pointerEvents = 'none';
      selectedRow.onclick = null;
    }

    const THRESHOLD_M = 150;
    const WINDOW_MS = 90 * 60 * 1000;

    try {
      // 1. TL GPS snap
      const pos = await new Promise((resolve, reject) => {
        if (!navigator.geolocation) { reject(new Error('GPS ไม่รองรับ')); return; }
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy: true, timeout: 10000, maximumAge: 0
        });
      });
      const tlLat = pos.coords.latitude;
      const tlLng = pos.coords.longitude;

      // 2. Time window check (if we have checked_in_at)
      if (target.checked_in_at) {
        const elapsed = Date.now() - new Date(target.checked_in_at).getTime();
        if (elapsed > WINDOW_MS) {
          throw new Error(`หมดเวลา — น้องเช็คอินไปแล้ว ${Math.floor(elapsed/60000)} นาที (ต้องอยู่ใน 90 นาที)`);
        }
      }

      // 3. Haversine check (if rep has GPS)
      let proximityM = null;
      if (target.rep_lat && target.rep_lng) {
        proximityM = Math.round(_haversine(tlLat, tlLng, target.rep_lat, target.rep_lng));
        if (proximityM > THRESHOLD_M) {
          throw new Error(`ไกลเกินไป — ห่างกัน ${proximityM} เมตร (ต้องอยู่ใน ${THRESHOLD_M} เมตร)`);
        }
      }

      if (btn) btn.textContent = 'กำลังบันทึก...';

      // 4. Get TL user id
      let tlUserId = null;
      try {
        const sk = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
        if (sk) { const ss = JSON.parse(localStorage.getItem(sk)); tlUserId = ss?.user?.id || null; }
      } catch(_) {}

      const tlEmail = currentUserProfile?.email || null;
      const nowIso = new Date().toISOString();

      // 5. Upsert covisit_events
      try {
        const { error: cvErr } = await supa.from('covisit_events').upsert({
          session_id:  target.session_id,
          tl_email:    tlEmail,
          rep_email:   target.rep_email || null,
          tl_lat:      tlLat,
          tl_lng:      tlLng,
          rep_lat:     target.rep_lat || null,
          rep_lng:     target.rep_lng || null,
          proximity_m: proximityM,
          verified:    true,
          checked_at:  nowIso,
        }, { onConflict: 'session_id' });
        if (cvErr) console.warn('[CI] covisit_events upsert:', cvErr.message);
        else _cvMarkDone(target.session_id);  // v552: local truth — กัน verify ซ้ำหลัง re-open
      } catch(e) { console.warn('[CI] covisit_events unavailable:', e.message); }

      // 6. Update ci_sessions.covisit_verified
      // v567: .select('id') exposes RLS-filtered zero-row updates (same fake-success
      // class as the v566 review fix). Previously the sheet showed a checkmark
      // optimistically while the DB never changed — outer list badges read DB truth
      // and stayed empty, the exact mismatch reported in testing.
      try {
        const { data: _cvRows, error: _cvUpdErr } = await supa.from('ci_sessions')
          .update({ covisit_verified: true }).eq('id', target.session_id).select('id');
        if (_cvUpdErr) throw _cvUpdErr;
        if (!_cvRows || !_cvRows.length) throw new Error('RLS filtered update (0 rows)');
      } catch(e) {
        console.warn('[CI] ci_sessions covisit_verified update:', e.message);
        try { if (window.SenseSentinel && typeof window.SenseSentinel.report === 'function')
          window.SenseSentinel.report('data_quality', 'covisit_verified update failed: ' + e.message); } catch(_e) {}
        if (typeof showToast === 'function') showToast('บันทึก co-visit ไม่เข้าฐานข้อมูล — แจ้ง admin', '✗');
      }

      // 7. Update UI
      _cvSelected = null;
      // If in session detail sheet
      if (btn && btn.id === 'sd-covisit-btn') {
        btn.remove();
        if (badge) {
          badge.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:11px;font-weight:500;color:#34C759;font-family:\'Noto Sans Thai\',sans-serif;margin-bottom:10px';
          badge.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit ยืนยันแล้ว`;
        }
      }
      // If in TL covisit panel — update row badge optimistically before re-fetch
      if (btn && btn.id === 'ci-cv-verify-btn') {
        if (selectedRow) {
          // Swap badge to Verified immediately
          const badgeEl = selectedRow.querySelector('.cv-badge');
          if (badgeEl) {
            badgeEl.className = 'cv-badge cv-badge-done';
            badgeEl.innerHTML = `<svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Verified`;
          }
          selectedRow.style.opacity = '0.6';
          selectedRow.style.pointerEvents = 'none';
        }
        if (verifyWrap) verifyWrap.style.display = 'none';
        // Re-fetch after short delay to confirm from DB
        setTimeout(_loadCovisitList, 1000);
        setTimeout(_loadCovisitHero, 1100);
      }
      setTimeout(() => _loadInlineHistory(), 800);
      if (typeof showToast === 'function') showToast('Co-visit ยืนยันแล้ว', '✓');

    } catch(e) {
      // Restore locked row on error
      if (selectedRow) { selectedRow.style.opacity = ''; selectedRow.style.pointerEvents = ''; }
      const repName = _cvSelected?.rep_email?.split('@')[0] || '';
      if (btn) {
        btn.disabled = false;
        if (btn.id === 'sd-covisit-btn') {
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>ยืนยัน Co-visit`;
        } else {
          btn.innerHTML = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:5px"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>ยืนยัน Co-visit กับ ${repName}`;
        }
      }
      const msg = e.code === 1 ? 'ไม่ได้รับสิทธิ์ GPS — อนุญาตในการตั้งค่า'
                : e.code === 2 ? 'ระบุตำแหน่งไม่ได้ — ลองกลางแจ้ง'
                : e.code === 3 ? 'GPS timeout — ลองอีกครั้ง'
                : e.message;
      _toast(msg);
    }
  }

  return { open, startRecording, stopRecording, cancel, _loadVisitHero, _phase: () => _phase, _tab, _save: () => { cancel(); }, /* v575: data auto-saved in _processBlob — กดบันทึก = ปิดเฉยๆ ไม่ insert ซ้ำ */ _openDebrief, _closeDebrief, _debriefPick, _debriefNote, _saveDebrief, _openHistory, _closeHistory, _openSkillTrend, _closeTrend, _dismissPicker, _hidePicker, _pickerConfirmKam, _pickerConfirmSales, _pickerSearch, _pickerSearchInline, _salesPickerSearch, _minimize, _switchMainTab, _topbarLeft, _openSessionDetail, _closeSessionDetail, _sdTab, _sdToggleWhy, _sdToggleNote, _markSessionReviewed, _saveTLSessionNote, _covisitVerify, _cvSelectRow, _orbTap, _doCheckin, _histFilter, _recoverBuffer, _discardBuffer, _bustRubricCache: () => { _rubricCache = null; }, _reapplyBodyLock, _restoreBodyScroll };

})();

function ciOpen(accountGuid) { CI.open(accountGuid); }
function echoOpen() {
  // Guard: if recording in progress, expand sheet instead of killing session
  if (typeof CI !== 'undefined' && typeof CI._phase === 'function' && CI._phase() === 'recording') {
    echoExpand();
    return;
  }
  CI.open(null);
}
function echoHistory(accountId) {
  // Open Echo sheet on history tab for specific account
  CI.open(accountId || null);
  // Switch to history tab after mount
  setTimeout(() => CI._switchMainTab('history'), 100);
}
function echoExpand() {
  const pill = document.getElementById('echo-float-pill');
  if (pill) pill.classList.remove('visible');
  const sheet = document.getElementById('ci-fullsheet');
  if (sheet) {
    sheet.style.display = '';
    sheet.classList.add('ci-open');
    // v598: re-lock body scroll now that sheet is back on screen
    if (typeof CI !== 'undefined' && typeof CI._reapplyBodyLock === 'function') {
      CI._reapplyBodyLock();
    }
  }
  else { CI.open(null); }
}

// ── Echo Admin — Skill Rubric Manager (Admin-only, lives in data panel) ────
// Injects modal into body; list renders inside #adm-skill-list in dp-admin

(function(){
  'use strict';

  let _admSkills = [];
  let _admEditing = null; // id of skill being edited, null = new
  let _admLoaded  = false;

  // ── Supabase helper (reuses global `supa`) ────────────────────────────────
  async function _supaReq(table, opts = {}) {
    const { method = 'GET', filter = '', body = null, prefer = '' } = opts;
    // Use global SUPA_URL/SUPA_KEY (from 01_core.js) — supa.supabaseKey is undefined in Supabase JS v2
    const _key = (typeof SUPA_KEY !== 'undefined' && SUPA_KEY) ||
                 (window.FreshketSenseConfig && window.FreshketSenseConfig.supabase &&
                  (window.FreshketSenseConfig.supabase.publishableKey || window.FreshketSenseConfig.supabase.anonKey)) || '';
    const _url = (typeof SUPA_URL !== 'undefined' && SUPA_URL) || supa.supabaseUrl || '';
    const url = `${_url}/rest/v1/${table}${filter}`;
    let _jwt = _key;
    try { const _s = await supa.auth.getSession(); _jwt = _s?.data?.session?.access_token || _key; } catch(_) {}
    const headers = {
      'Content-Type': 'application/json',
      'apikey': _key,
      'Authorization': 'Bearer ' + _jwt,
    };
    if (prefer) headers['Prefer'] = prefer;
    const res = await fetch(url, { method, headers, body: body ? JSON.stringify(body) : undefined });
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.message || res.status); }
    // 204 No Content (DELETE, PATCH/POST with return=minimal) — no body to parse
    if (res.status === 204 || method === 'DELETE') return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }

  // ── Load & render list ────────────────────────────────────────────────────
  window.admLoadSkills = async function(force) {
    if (_admLoaded && !force) { _admRender(); return; }
    const el = document.getElementById('adm-skill-list');
    if (el) el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--n400,#AEAEB2);font-size:12px">กำลังโหลด...</div>';
    try {
      _admSkills = await _supaReq('skill_definitions', { filter: '?select=*&order=skill_code.asc' });
      _admLoaded = true;
      _admRender();
    } catch(e) {
      if (el) el.innerHTML = `<div style="text-align:center;padding:24px;color:#FF3B30;font-size:12px">โหลดไม่ได้: ${e.message}</div>`;
    }
  };

  function _admRender() {
    const total = _admSkills.length;
    const echoOn = _admSkills.filter(s => s.echo_enabled).length;
    const withObs = _admSkills.filter(s => s.echo_observable && s.echo_observable.trim()).length;
    const st = document.getElementById('adm-stat-total'); if (st) st.textContent = total;
    const se = document.getElementById('adm-stat-echo');  if (se) se.textContent = echoOn;
    const so = document.getElementById('adm-stat-obs');   if (so) so.textContent = withObs;

    const el = document.getElementById('adm-skill-list');
    if (!el) return;
    if (!_admSkills.length) { el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--n400,#AEAEB2);font-size:12px">ยังไม่มี Skill — กด เพิ่ม Skill ใหม่</div>'; return; }

    el.innerHTML = _admSkills.map(s => `
      <div onclick="admOpenModal('${s.id}')" style="display:grid;grid-template-columns:80px 1fr 56px;gap:8px;align-items:center;padding:10px 12px;background:#fff;cursor:pointer;border-bottom:0.5px solid var(--n100,#E5E5EA);transition:background .12s" onmouseover="this.style.background='#F7F7F7'" onmouseout="this.style.background='#fff'">
        <div style="font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:600;color:#FF385C">${s.skill_code||'—'}</div>
        <div>
          <div style="font-size:12px;font-weight:500;color:var(--n900,#1C1C1E);margin-bottom:1px">${s.skill_name_en||'—'}</div>
          <div style="font-size:10px;color:var(--n400,#AEAEB2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.echo_observable?'🎧 '+s.echo_observable.slice(0,60)+(s.echo_observable.length>60?'…':''):'ไม่มี hint'}</div>
        </div>
        <div style="display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:100px;font-size:10px;font-weight:600;${s.echo_enabled?'background:rgba(52,199,89,.1);color:#1a8a3a':'background:var(--n100,#E5E5EA);color:var(--n400,#AEAEB2)'}">${s.echo_enabled?'ON':'OFF'}</div>
      </div>`).join('');
  }

  // ── Modal ─────────────────────────────────────────────────────────────────
  function _injectModal() {
    if (document.getElementById('adm-modal-bg')) return;
    const div = document.createElement('div');
    div.id = 'adm-modal-bg';
    div.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:9000;padding:12px;display:none;box-sizing:border-box';
    div.onclick = e => { if (e.target === div) admCloseModal(); };
    div.innerHTML = `
      <div style="background:#fff;border-radius:16px;width:100%;max-width:440px;max-height:92vh;overflow-y:auto;padding:18px;box-sizing:border-box">
        <div style="font-size:15px;font-weight:600;color:var(--n900,#1C1C1E);margin-bottom:2px" id="adm-m-title">เพิ่ม Skill ใหม่</div>
        <div style="font-size:11px;color:var(--n400,#AEAEB2);margin-bottom:18px" id="adm-m-sub">กรอกข้อมูลแล้วกด บันทึก</div>

        <div style="margin-bottom:13px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">Skill Code</div>
          <input id="adm-f-code" placeholder="C06_NEW" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;font-family:'IBM Plex Mono',monospace" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px">
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">ชื่อ EN</div>
            <input id="adm-f-en" placeholder="Rapport Building" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;font-family:inherit" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
          </div>
          <div>
            <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">ชื่อ TH</div>
            <input id="adm-f-th" placeholder="สร้างความไว้วางใจ" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;font-family:inherit" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
          </div>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">หลักการ (Principle)</div>
          <textarea id="adm-f-principle" rows="3" placeholder="ทำไม skill นี้สำคัญต่อ visit..." style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">การฝึก (Practice) <span style="font-weight:400;color:var(--n400,#AEAEB2);text-transform:none;letter-spacing:0">— คั่นด้วย |</span></div>
          <textarea id="adm-f-practice" rows="3" placeholder="FKT Value 3 ระดับ: สิ่งที่ซัพฯ ทุกเจ้ามี | สิ่งที่ FKT ทำได้ดีกว่า | สิ่งที่ FKT เท่านั้นมี" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono',monospace">เกณฑ์ผ่าน (Pass Test)</div>
          <textarea id="adm-f-pass" rows="3" placeholder="Role play: TL ทดสอบ... Pass: ..." style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:15px">
          <div style="font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#FF385C;margin-bottom:5px;font-family:'IBM Plex Mono',monospace">Echo Observable Hint <span style="font-weight:400;color:var(--n400,#AEAEB2);text-transform:none;letter-spacing:0">— Gemini ฟังอะไรใน audio</span></div>
          <textarea id="adm-f-obs" rows="3" placeholder="ฟัง: rep หยุดก่อนตอบไหม? น้ำเสียง defensive หรือ acknowledge ก่อน? ลูกค้า engage มากขึ้นหลังจาก rep ตอบไหม?" style="width:100%;padding:8px 11px;border:0.5px solid #FFB3BF;border-radius:9px;font-size:13px;color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5;background:rgba(255,56,92,.03)" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#FFB3BF'"></textarea>
        </div>
        <!-- Echo toggle -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 13px;background:#F7F7F7;border-radius:10px;border:0.5px solid #E5E5EA;margin-bottom:18px">
          <div>
            <div style="font-size:13px;font-weight:500;color:#1C1C1E">ส่งให้ Echo วิเคราะห์</div>
            <div style="font-size:11px;color:#AEAEB2;margin-top:1px">ปิด = Gemini จะข้าม skill นี้</div>
          </div>
          <label style="position:relative;width:44px;height:26px;flex-shrink:0;cursor:pointer">
            <input type="checkbox" id="adm-f-echo" checked style="opacity:0;width:0;height:0"/>
            <span id="adm-toggle-slider" style="position:absolute;inset:0;background:#E5E5EA;border-radius:100px;transition:.2s;cursor:pointer">
              <span id="adm-toggle-knob" style="position:absolute;width:20px;height:20px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)"></span>
            </span>
          </label>
        </div>
        <!-- Footer -->
        <div style="display:flex;gap:8px" id="adm-m-footer">
          <button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:10px;font-size:13px;cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button>
          <button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">บันทึก</button>
        </div>
      </div>`;
    document.body.appendChild(div);

    // Wire toggle
    const cb = div.querySelector('#adm-f-echo');
    const sl = div.querySelector('#adm-toggle-slider');
    const kn = div.querySelector('#adm-toggle-knob');
    cb.addEventListener('change', () => {
      sl.style.background = cb.checked ? '#34C759' : '#E5E5EA';
      kn.style.transform = cb.checked ? 'translateX(18px)' : 'translateX(0)';
    });
    // Init toggle visual
    sl.style.background = '#34C759'; kn.style.transform = 'translateX(18px)';
  }

  window.admOpenModal = function(id) {
    _injectModal();
    _admEditing = id || null;
    const s = id ? _admSkills.find(x => String(x.id) === String(id)) : null;
    document.getElementById('adm-m-title').textContent = s ? 'แก้ไข Skill' : 'เพิ่ม Skill ใหม่';
    document.getElementById('adm-m-sub').textContent = s ? s.skill_code : 'กรอกข้อมูล แล้วกด บันทึก';
    const codeEl = document.getElementById('adm-f-code');
    codeEl.value = s ? (s.skill_code || '') : '';
    codeEl.disabled = !!s;
    codeEl.style.background = s ? '#F7F7F7' : '';
    document.getElementById('adm-f-en').value = s ? (s.skill_name_en || '') : '';
    document.getElementById('adm-f-th').value = s ? (s.skill_name_th || '') : '';
    document.getElementById('adm-f-principle').value = s ? (s.principle_th || '') : '';
    document.getElementById('adm-f-practice').value = s ? (s.practice_th || '') : '';
    document.getElementById('adm-f-pass').value = s ? (s.pass_test_th || '') : '';
    document.getElementById('adm-f-obs').value = s ? (s.echo_observable || '') : '';
    const cb = document.getElementById('adm-f-echo');
    const sl = document.getElementById('adm-toggle-slider');
    const kn = document.getElementById('adm-toggle-knob');
    cb.checked = s ? !!s.echo_enabled : true;
    sl.style.background = cb.checked ? '#34C759' : '#E5E5EA';
    kn.style.transform = cb.checked ? 'translateX(18px)' : 'translateX(0)';

    // Footer — add Delete button if editing
    document.getElementById('adm-m-footer').innerHTML = s
      ? `<button onclick="admDeleteSkill('${s.id}','${(s.skill_code||'').replace(/'/g,"\\'")}' )" style="flex:1;padding:10px;border:0.5px solid #FF3B30;border-radius:10px;font-size:13px;cursor:pointer;background:transparent;color:#FF3B30;font-family:inherit">ลบ</button><button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:10px;font-size:13px;cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button><button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">บันทึก</button>`
      : `<button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:10px;font-size:13px;cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button><button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:#fff;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;font-family:inherit">บันทึก</button>`;

    document.getElementById('adm-modal-bg').style.display = 'flex';
  };

  window.admCloseModal = function() {
    const m = document.getElementById('adm-modal-bg');
    if (m) m.style.display = 'none';
    _admEditing = null;
  };

  window.admSaveSkill = async function() {
    const btn = document.getElementById('adm-save-btn');
    if (!btn) return;
    btn.disabled = true; btn.textContent = 'กำลังบันทึก...';
    const payload = {
      skill_name_en:  document.getElementById('adm-f-en').value.trim(),
      skill_name_th:  document.getElementById('adm-f-th').value.trim(),
      principle_th:   document.getElementById('adm-f-principle').value.trim(),
      practice_th:    document.getElementById('adm-f-practice').value.trim(),
      pass_test_th:   document.getElementById('adm-f-pass').value.trim(),
      echo_observable:document.getElementById('adm-f-obs').value.trim(),
      echo_enabled:   document.getElementById('adm-f-echo').checked,
    };
    if (!payload.skill_name_en) { _admToast('กรุณากรอกชื่อ Skill (EN)','warn'); btn.disabled=false; btn.textContent='บันทึก'; return; }
    try {
      if (_admEditing) {
        await _supaReq(`skill_definitions?id=eq.${_admEditing}`, { method: 'PATCH', body: payload, prefer: 'return=minimal' });
      } else {
        const code = document.getElementById('adm-f-code').value.trim().toUpperCase();
        if (!code) { _admToast('กรุณากรอก Skill Code','warn'); btn.disabled=false; btn.textContent='บันทึก'; return; }
        payload.skill_code = code;
        await _supaReq('skill_definitions', { method: 'POST', body: payload, prefer: 'return=minimal' });
      }
      admCloseModal();
      _admLoaded = false;
      await admLoadSkills(true);
      _admToast(_admEditing ? 'บันทึกสำเร็จ ✓' : 'เพิ่ม Skill แล้ว ✓', 'ok');
      // Bust rubric cache so Echo picks up next time
      if (typeof CI !== 'undefined' && CI._bustRubricCache) CI._bustRubricCache();
    } catch(e) {
      _admToast('Error: '+e.message,'err');
      btn.disabled=false; btn.textContent='บันทึก';
    }
  };

  window.admDeleteSkill = async function(id, code) {
    if (!confirm(`ลบ "${code}" ออกจากระบบ?\nไม่สามารถย้อนกลับได้`)) return;
    try {
      await _supaReq(`skill_definitions?id=eq.${id}`, { method: 'DELETE' });
      admCloseModal();
      _admLoaded = false;
      await admLoadSkills(true);
      _admToast('ลบ '+code+' แล้ว','ok');
      if (typeof CI !== 'undefined' && CI._bustRubricCache) CI._bustRubricCache();
    } catch(e) { _admToast('Error: '+e.message,'err'); }
  };

  function _admToast(msg, type) {
    let t = document.getElementById('adm-toast');
    if (!t) { t = document.createElement('div'); t.id='adm-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:9px 18px;border-radius:100px;font-size:13px;font-weight:500;z-index:9999;color:#fff;white-space:nowrap;transition:opacity .3s;background:${type==='ok'?'#34C759':type==='warn'?'#FF9500':'#FF3B30'}`;
    t.style.opacity='1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity='0'; }, 2500);
  }
})();

