// =============================================================================
// 09_conv_intel.js — Conversation Intelligence Module
// CSS + HTML ตรงจาก ci_mockup_v2 — ห้ามแก้ design โดยไม่ update mockup ด้วย
// =============================================================================

const CI = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const WORKER_URL = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';

  // v_echonick: อีเมล → ชื่อเล่น (Pop, Ply, Kwang...) · helper กลางอยู่ที่
  // 01_core.js (senseRepLabel) — ห่อไว้ตรงนี้เพราะ Echo เรียกถี่มากและต้องมี
  // fallback ที่ปลอดภัยถ้า core ยังไม่โหลด (Echo เปิดได้ก่อน portview พร้อม)
  function _echoRep(email) {
    try {
      if (typeof senseRepLabel === 'function') return senseRepLabel(email);
    } catch (_) {}
    return String(email || '').split('@')[0] || '—';
  }
  const MAX_SECS   = 4800; // v587: 80min — v_echor3 bitrate 48kbps = 6000B/s (80 นาที ≈ 29MB)
  let _micSettings = null;   // ค่าไมค์ที่ได้จริง (บางรุ่นเมินค่าที่ขอไปเงียบๆ)
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
  let _histFilterMode = 'week'; // today|week|month|quarter|all — ใช้ร่วมทุก role
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
      const ts = m.ts ? `<span style="font-family:'IBM Plex Mono','Noto Sans Thai',monospace;font-size:var(--text-xs);color:var(--tx3,#AEAEB2)">${m.ts}</span> ` : '';
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
.sbar-t{font-size:var(--text-lg2);font-weight:var(--fw-medium);color:var(--tx);letter-spacing:-.02em;}
.sbar-r{font-size:var(--text-base);color:var(--tx2);}

/* ── SCREENS ── */
#ci-fullsheet .scr{display:none;flex-direction:column;min-height:780px;}
#ci-fullsheet .scr.on{display:flex;}

/* ── TOPBAR ── */
#ci-fullsheet .topbar{display:flex;align-items:center;justify-content:space-between;padding:16px 24px 10px;background:transparent;}
.tb-act{font-size:var(--text-lg2);font-weight:var(--fw-normal);color:var(--tx2);cursor:pointer;padding:6px 0;}
.tb-act:hover{color:var(--tx);}
.tb-lbl{font-size:var(--text-xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;position:absolute;left:50%;transform:translateX(-50%);pointer-events:none;}
.tb-rec{font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--ac);display:flex;align-items:center;gap:5px;font-family:'Noto Sans Thai',sans-serif;}
.rec-dot{width:5px;height:5px;border-radius:50%;background:var(--danger);opacity:0;transition:opacity .3s;}
.rec-dot.on{opacity:1;animation:blink 1.3s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}
@keyframes ci-dot-pulse{0%,100%{opacity:.25;transform:scale(.8)}50%{opacity:1;transform:scale(1.15)}}

/* ── CHIP ── */
#ci-fullsheet .chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:100px;background:rgba(0,0,0,.04);}
#ci-fullsheet .chip-dot{width:5px;height:5px;border-radius:50%;background:var(--ac);flex-shrink:0;}
#ci-fullsheet .chip-txt{font-size:var(--text-base);color:var(--tx2);letter-spacing:-.01em;}
#ci-fullsheet .chip-seg{font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--ac);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;}

/* ── RECORD CENTER ── */
#ci-fullsheet .rec-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:0 24px;}

/* ── ORB ── */
#ci-fullsheet .orb-wrap{position:relative;width:200px;height:200px;display:flex;align-items:center;justify-content:center;}
#ci-fullsheet .orb-ring{position:absolute;border-radius:50%;border:1px solid var(--echo-ac-12);opacity:0;pointer-events:none;}
.orb-ring-1{width:100%;height:100%;}
.orb-ring-2{width:136%;height:136%;border-color:var(--echo-ac-8);}
.is-rec .orb-ring-1{animation:opulse 2.4s var(--ease) infinite;}
.is-rec .orb-ring-2{animation:opulse 2.4s var(--ease) .8s infinite;}
@keyframes opulse{0%{opacity:.55;transform:scale(.88)}100%{opacity:0;transform:scale(1.1)}}
#ci-fullsheet .orb-outer{
  width:172px;height:172px;border-radius:50%;cursor:pointer;
  background:rgba(255,255,255,.62);
  backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);
  border:0.5px solid rgba(255,255,255,.72);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.92),0 6px 28px rgba(0,0,0,.08);
  display:flex;align-items:center;justify-content:center;
  transition:box-shadow 220ms var(--ease),transform 60ms linear;
}
#ci-fullsheet .orb-outer:active{transform:scale(.96);}
.is-rec .orb-outer{box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 8px 36px rgba(255,56,92,.13);}
#ci-fullsheet .orb-core{
  width:114px;height:114px;border-radius:50%;
  background:var(--n-0);
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 14px rgba(0,0,0,.09);
  display:flex;align-items:center;justify-content:center;
  transition:box-shadow 220ms var(--ease);
}
.is-rec .orb-core{box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 18px rgba(255,56,92,.16);}
#ci-fullsheet .orb-core svg{width:38px;height:38px;color:var(--ac);transition:transform 120ms var(--ease);}
.is-rec .orb-core svg{transform:scale(1.08);}

/* ambient — very subtle, only when recording */
.orb-ambient{
  position:absolute;width:280px;height:280px;border-radius:50%;
  background:radial-gradient(circle,rgba(255,56,92,.06) 0%,transparent 65%);
  pointer-events:none;opacity:0;transition:opacity 600ms var(--ease);
}
.is-rec .orb-ambient{opacity:1;}

/* ── TIMER ── */
#ci-fullsheet .timer-block{text-align:center;}
#ci-fullsheet .timer-val{font-size:52px;font-weight:200;letter-spacing:-.04em;line-height:1;color:var(--tx);font-variant-numeric:tabular-nums;}
#ci-fullsheet .timer-hint{font-size:var(--text-sm);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:#8e8e93;margin-top:5px;font-family:'Noto Sans Thai',sans-serif;transition:color 220ms;}
.is-rec .timer-hint{color:rgba(255,255,255,.52);}

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
.ci-checkin-bar{display:none;margin:0 24px 4px;background:rgba(52,199,89,.06);border:0.5px solid rgba(52,199,89,.2);border-radius:var(--r-card);padding:8px 12px;align-items:center;gap:8px;}
.ci-checkin-bar.show{display:flex;}
.ci-checkin-icon{width:18px;height:18px;border-radius:50%;background:rgba(52,199,89,.15);display:flex;align-items:center;justify-content:center;flex-shrink:0;}
.ci-checkin-txt{font-size:var(--text-md);font-weight:var(--fw-medium);color:#1C1C1E;}
.ci-checkin-sub{font-size:var(--text-xs);color:#8e8e93;}

/* ── COVISIT LIST (TL screen) ── */
.cv-list-wrap{flex:1;overflow-y:auto;padding:0 0 max(32px,calc(env(safe-area-inset-bottom,0px)+80px));-webkit-overflow-scrolling:touch;}
.cv-section-hd{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:12px 24px 6px;}
.cv-row{display:flex;align-items:center;gap:10px;padding:10px 24px;border-bottom:0.5px solid #E5E5EA;}
.cv-row:last-child{border-bottom:none;}
.cv-avatar{width:30px;height:30px;border-radius:50%;background:rgba(255,56,92,.1);display:flex;align-items:center;justify-content:center;font-size:var(--text-xs);font-weight:var(--fw-semi);color:#FF385C;flex-shrink:0;}
.cv-name{font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E;}
.cv-sub{font-size:var(--text-xs);color:#AEAEB2;margin-top:1px;font-family:'Noto Sans Thai',sans-serif;}
.cv-badge{display:inline-flex;align-items:center;gap:3px;padding:3px 9px;border-radius:100px;font-size:var(--text-2xs);font-weight:var(--fw-medium);white-space:nowrap;}
.cv-badge-ready{background:rgba(52,199,89,.1);color:#1A7A3A;}
.cv-badge-wait{background:rgba(255,149,0,.1);color:#995500;}
.cv-badge-done{background:rgba(52,199,89,.1);color:#1A7A3A;}
.cv-badge-expired{background:rgba(255,59,48,.08);color:#CC2200;}
.cv-verify-btn{display:block;margin:12px 24px 4px;width:calc(100% - 48px);padding:14px;border-radius:var(--r-lg);border:none;background:#FF385C;color:var(--tk-text-primary);font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg2);font-weight:var(--fw-medium);letter-spacing:-.02em;cursor:pointer;transition:opacity 80ms;}
.cv-verify-btn:disabled{background:#E5E5EA;color:#AEAEB2;cursor:not-allowed;}
.cv-verify-btn:active{opacity:.85;}
.cv-note{text-align:center;font-size:var(--text-xs);color:#AEAEB2;padding:4px 24px 16px;line-height:1.5;font-family:'Noto Sans Thai',sans-serif;}

/* ── RECORD BOTTOM ── */
.rec-bottom{padding:8px 24px 40px;display:flex;flex-direction:column;gap:10px;}
#ci-fullsheet .btn-stop{
  width:100%;padding:15px;border-radius:var(--r-lg);border:none;
  background:rgba(0,0,0,.055);color:var(--tx2);
  font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg2);font-weight:var(--fw-medium);letter-spacing:-.02em;
  cursor:pointer;transition:background 120ms,color 120ms,transform 60ms linear;
}
#ci-fullsheet .btn-stop:hover{background:rgba(0,0,0,.08);color:var(--tx);}
#ci-fullsheet .btn-stop:active{transform:scale(.98);}
#ci-fullsheet .stop-hint{text-align:center;font-size:var(--text-sm);color:#8e8e93;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;}

/* ── PROCESSING SCREEN ── */
#ci-fullsheet .proc-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 24px;}
#ci-fullsheet .proc-dots{display:flex;gap:7px;align-items:center;margin-bottom:16px;}
#ci-fullsheet .proc-dot{width:7px;height:7px;border-radius:50%;background:var(--ac);opacity:.2;animation:dbreathe 1.2s ease-in-out infinite;}
#ci-fullsheet .proc-dot:nth-child(2){animation-delay:.2s;}
#ci-fullsheet .proc-dot:nth-child(3){animation-delay:.4s;}
@keyframes dbreathe{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
#ci-fullsheet .proc-step{font-size:var(--text-lg2);font-weight:var(--fw-normal);color:var(--tx);letter-spacing:-.02em;text-align:center;}
#ci-fullsheet .proc-sub{font-size:var(--text-xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-top:3px;text-align:center;}
#ci-fullsheet .proc-line{width:148px;height:1px;background:var(--n-100);border-radius:1px;margin-top:24px;overflow:hidden;}
#ci-fullsheet .proc-fill{height:100%;background:var(--ac);width:0%;transition:width .65s var(--ease);}

/* ── RESULT SCREEN ── */
#ci-fullsheet .result-hdr{padding:20px 24px 0;}
#ci-fullsheet .result-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
#ci-fullsheet .result-acct{font-size:var(--text-xl);font-weight:var(--fw-medium);letter-spacing:-.02em;color:var(--tx);}
.dur-chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:100px;background:rgba(0,0,0,.04);font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-md);color:var(--tx3);letter-spacing:.02em;}

/* ── TAB BAR — sliding pill ── */
#ci-fullsheet .tab-bar{position:relative;display:flex;background:rgba(0,0,0,.042);border-radius:var(--r-md);padding:3px;gap:0;margin-bottom:18px;}
#ci-fullsheet .tab-pill{position:absolute;top:3px;bottom:3px;background:var(--n-0);border-radius:var(--r-7);box-shadow:0 1px 4px rgba(0,0,0,.10);pointer-events:none;transition:left 120ms var(--ease),width 120ms var(--ease);}
#ci-fullsheet .tab-btn{flex:1;padding:8px 6px;font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx3);background:transparent;border:none;border-radius:var(--r-7);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;letter-spacing:-.01em;transition:color 120ms;position:relative;z-index:1;white-space:nowrap;}
#ci-fullsheet .tab-btn.on{color:var(--tx);}

/* ── RESULT BODY ── */
#ci-fullsheet .result-body{flex:1;overflow-y:auto;padding:0 24px;-webkit-overflow-scrolling:touch;}
#ci-fullsheet .result-body::-webkit-scrollbar{display:none;}
#ci-fullsheet .panel{display:none;}
#ci-fullsheet .panel.on{display:block;}

/* PIPC */
.pipc-track{display:flex;gap:4px;margin-bottom:6px;}
.pipc-seg{flex:1;height:2px;border-radius:var(--r-xxs);background:var(--n-100);transition:background 220ms;}
.pipc-seg.done{background:var(--ac);}
.pipc-labels{display:flex;justify-content:space-between;margin-bottom:24px;}
.pipc-lbl{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;transition:color 220ms;}
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
.sk-name{font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--tx);letter-spacing:-.02em;}
.sk-badge{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.08em;text-transform:uppercase;font-family:'Noto Sans Thai',sans-serif;}
.sk-badge.pass{color:var(--success);}
.sk-badge.dev{color:var(--warning);}
.sk-badge.no{color:var(--tx3);}
.sk-note{font-size:var(--text-md);color:var(--tx2);line-height:1.5;letter-spacing:-.005em;}

/* eyebrow */
#ci-fullsheet .eyebrow{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:12px;}

/* BUYER CARD */
.buyer-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:16px;border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 4px 20px rgba(0,0,0,.05);
  padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:24px;
}
.buyer-icon-wrap{width:46px;height:46px;border-radius:var(--r-card);background:var(--n-50);display:flex;align-items:center;justify-content:center;font-size:var(--text-3xl);flex-shrink:0;}
.buyer-lbl{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:4px;}
.buyer-type{font-size:var(--text-2xl);font-weight:300;letter-spacing:-.03em;color:var(--tx);line-height:1.1;}
.buyer-ev{font-size:var(--text-sm);color:var(--tx3);margin-top:2px;letter-spacing:-.005em;}

/* PAIN ROWS */
#ci-fullsheet .pain-row{display:flex;gap:12px;padding:12px 0;border-bottom:0.5px solid var(--br);}
#ci-fullsheet .pain-row:last-child{border-bottom:none;}
#ci-fullsheet .pain-dot{width:5px;height:5px;border-radius:50%;margin-top:4px;flex-shrink:0;}
#ci-fullsheet .pain-dot.hi{background:var(--danger);}
#ci-fullsheet .pain-dot.md{background:var(--warning);}
#ci-fullsheet .pain-dot.op{background:var(--ac);}
.pain-body{flex:1;}
#ci-fullsheet .pain-dim{font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.13em;text-transform:uppercase;color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;}
#ci-fullsheet .pain-txt{font-size:var(--text-md);color:var(--tx2);line-height:1.5;}

/* ACTION CARDS */
.action-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:var(--r-lg);border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 3px 16px rgba(0,0,0,.045);
  padding:14px 16px;margin-bottom:8px;
}
.action-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}
#ci-fullsheet .action-n{font-size:var(--text-xs);font-weight:var(--fw-medium);color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.08em;}
.urg{font-size:var(--text-2xs);font-weight:var(--fw-medium);padding:3px 8px;border-radius:100px;letter-spacing:.06em;text-transform:uppercase;font-family:'Noto Sans Thai',sans-serif;}
.urg.hi{background:var(--danger-bg);color:var(--danger);}
.urg.md{background:var(--warning-bg);color:var(--warning);}
#ci-fullsheet .action-txt{font-size:var(--text-md);color:var(--tx);line-height:1.5;margin-bottom:5px;letter-spacing:-.01em;}
#ci-fullsheet .action-who{font-size:var(--text-xs);color:var(--tx3);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;}

/* RESULT CTA */
.result-cta{display:flex;gap:8px;padding:14px 24px max(40px,calc(env(safe-area-inset-bottom,0px) + 20px));}
.btn{flex:1;padding:14px;border-radius:var(--r-lg);border:none;font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg2);font-weight:var(--fw-medium);letter-spacing:-.02em;cursor:pointer;transition:opacity 60ms linear,transform 60ms linear;}
.btn:active{transform:scale(.97);opacity:.85;}
.btn-primary{background:var(--ac);color:var(--tk-text-primary);}
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
  position:relative;
  top:auto;left:auto;right:auto;
  max-width:none;
  z-index:1;
  margin:0;
  padding:16px 24px 10px;
  background:transparent;
  border-bottom:0.5px solid rgba(0,0,0,.07);
  transition:background .7s ease,border-color .7s ease;
}
#ci-fullsheet.ci-open { transform:translateY(0); }
#ci-fullsheet .scr { display:none; flex-direction:column; flex:1; min-height:0; }
#ci-fullsheet .scr.on { display:flex; }
/* ── Picker sheet items ── */
.ci-pk-item{display:flex;align-items:center;justify-content:space-between;padding:11px 12px;border-radius:var(--r-md);border:none;background:rgba(0,0,0,.03);cursor:pointer;width:100%;text-align:left;transition:background .15s;margin-bottom:2px;}
.ci-pk-item:active{background:rgba(255,56,92,.08);}
.ci-pk-name{font-size:var(--text-base);color:#1C1C1E;font-weight:var(--fw-medium);flex:1;text-align:left;}
.ci-pk-seg{font-size:var(--text-xs);font-weight:var(--fw-semi);color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;margin-left:8px;}
/* ── Readability overrides ── */
.sk-name{font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E;letter-spacing:-.02em}
.sk-note{font-size:var(--text-md);color:#636366;line-height:1.55;letter-spacing:-.005em}
.sk-badge{font-size:var(--text-xs);letter-spacing:.08em}
.buyer-type{font-size:var(--text-2xl);font-weight:300;letter-spacing:-.03em;color:#1C1C1E}
.buyer-ev{font-size:var(--text-md);color:#636366;line-height:1.5}
.buyer-lbl{font-size:var(--text-2xs);letter-spacing:.14em;color:#6C6C70;margin-bottom:4px}
#ci-fullsheet .pain-txt{font-size:var(--text-md);color:#636366;line-height:1.55}
#ci-fullsheet .pain-dim{font-size:var(--text-xs);color:#6C6C70;letter-spacing:.13em}
#ci-fullsheet .action-txt{font-size:var(--text-base);color:#1C1C1E;line-height:1.5}
#ci-fullsheet .action-who{font-size:var(--text-sm);color:#6C6C70}
#ci-fullsheet .action-n{font-size:var(--text-xs);color:#6C6C70;letter-spacing:.08em}
#ci-fullsheet .eyebrow{font-size:var(--text-xs);color:#6C6C70;letter-spacing:.16em}
#ci-fullsheet .tab-btn{font-size:var(--text-base);font-weight:var(--fw-normal);color:#6C6C70}
#ci-fullsheet .tab-btn.on{color:#1C1C1E;font-weight:var(--fw-medium)}
#ci-fullsheet .proc-step{font-size:var(--text-lg2);color:#1C1C1E}
#ci-fullsheet .proc-sub{font-size:var(--text-sm);color:#6C6C70}
#ci-fullsheet .timer-val{color:#1C1C1E}
#ci-fullsheet .timer-hint{font-size:var(--text-sm);color:#6C6C70}
#ci-fullsheet .stop-hint{font-size:var(--text-sm);color:#6C6C70}
#ci-fullsheet .btn-stop{font-size:var(--text-lg2);color:#1C1C1E;background:rgba(0,0,0,.055)}
#ci-fullsheet .chip-txt{font-size:var(--text-base);color:#636366}
#ci-fullsheet .chip-seg{font-size:var(--text-xs);color:#FF385C}
`;

  // ── Mount / unmount sheet ──────────────────────────────────────────────────
  function _mount() {
    // v604: ถ้า ci-fullsheet เก่ายังอยู่ใน DOM (อยู่ระหว่าง 400ms slide-out)
    // ให้ remove ทันทีแทนที่จะ return — กัน blank screen จาก race ระหว่าง
    // _unmount(400ms) กับ _mount(50ms) ใน open()
    const _stale = document.getElementById('ci-fullsheet');
    if (_stale) { _stale.remove(); }
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
    _restoreBodyScroll();
    // v603: flush queued renders after Echo closes
    setTimeout(() => {
      try {
        // ถ้า shimmer ค้างอยู่ระหว่าง Echo เปิด → deactivate ก่อน render
        if (window._pwaShimmerActive && typeof window._deactivatePortviewShimmer === 'function') {
          window._deactivatePortviewShimmer();
        }
        if (window._pendingRefreshAll && typeof refreshAll === 'function') {
          window._pendingRefreshAll = false;
          refreshAll();
        }
      } catch(_) {}
    }, 450);
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
      <span id="ci-topbar-left-icon" style="font-size:var(--text-xl);line-height:1">←</span>
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
        <span style="font-size:var(--text-xs);font-weight:var(--fw-medium);color:#1A7A3A;font-family:'Noto Sans Thai',sans-serif">เช็คอิน <span id="ci-checkin-time">—</span></span>
      </div>
    </div>
  </div>
  <!-- visit hero — hide during picker state, show after account selected -->
  <div id="ci-visit-hero" style="padding:0 24px 10px;${_showPicker?'display:none':''}">
    <div id="ci-vh-card" style="background:rgba(255,56,92,.04);border:0.5px solid rgba(255,56,92,.13);border-radius:var(--r-lg);padding:12px 14px;transition:background .7s ease,border-color .7s ease">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:10px">
        <div>
          <div id="ci-vh-wlabel" style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.13em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;transition:color .7s ease">สัปดาห์นี้</div>
          <div id="ci-vh-wnum" style="font-size:var(--text-3xl);font-weight:300;color:#1C1C1E;letter-spacing:-.03em;line-height:1.1;transition:color .7s ease">—</div>
          <div id="ci-vh-wsub" style="font-size:var(--text-xs);color:#AEAEB2;margin-top:1px;transition:color .7s ease">visits</div>
        </div>
        <div id="ci-vh-div" style="width:0.5px;background:rgba(255,56,92,.12);align-self:stretch;transition:background .7s ease"></div>
        <div style="text-align:right">
          <div id="ci-vh-qlabel" style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.13em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px;transition:color .7s ease">ไตรมาสนี้</div>
          <div id="ci-vh-qnum" style="font-size:var(--text-3xl);font-weight:300;color:#1C1C1E;letter-spacing:-.03em;line-height:1.1;transition:color .7s ease">—</div>
          <div id="ci-vh-qsub" style="font-size:var(--text-xs);color:#AEAEB2;margin-top:1px;transition:color .7s ease">visits</div>
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
    <!-- v_echor2: สรุปผลการ visit ย้ายไปรวมกับแท็บ "ประวัติ" แล้ว (เดิมเป็นหน้าแยก
         ที่ query คนละครั้ง ตัวเลขจึงไม่ตรงกับรายการที่แสดง) -->
    <button onclick="CI._switchMainTab('history')"
      style="display:flex;align-items:center;justify-content:space-between;margin:4px 0 10px;padding:12px 14px;border:0.5px solid rgba(0,0,0,.1);border-radius:var(--r-lg);background:rgba(255,255,255,.72);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;-webkit-tap-highlight-color:transparent;width:100%">
      <span style="display:inline-flex;align-items:center;gap:7px;font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx,#1C1C1E)"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>ผลการ visit</span>
      <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2)">ดูในแท็บประวัติ →</span>
    </button>
    <div class="cv-list-wrap" id="ci-cv-list-body">
      <div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:#AEAEB2">กำลังโหลด...</div>
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
               font-size:var(--text-md);font-weight:var(--fw-medium);letter-spacing:.05em;text-transform:uppercase;
               font-family:'Noto Sans Thai',sans-serif;cursor:pointer;
               transition:background .7s ease,color .7s ease,border-color .7s ease">
        จบ &amp; วิเคราะห์
      </button>
      <button onclick="CI.cancel()"
        style="width:40px;height:40px;flex-shrink:0;border:none;border-radius:var(--r-card);cursor:pointer;
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
      <div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">กำลังโหลด...</div>
    </div>
  </div>
</div>

<div id="ci-s-proc" class="scr">
  <div class="proc-wrap">
    <div class="proc-dots">
      <div class="proc-dot"></div><div class="proc-dot"></div><div class="proc-dot"></div>
    </div>
    <p class="proc-step" id="ci-pstep">กำลัง transcript...</p>
    <p class="proc-sub" id="ci-psub">Gemini · ฟัง audio ทั้งหมด</p>
    <div class="proc-line"><div class="proc-fill" id="ci-pfill"></div></div>
    <div style="display:flex;gap:8px;margin-top:12px;justify-content:center" id="ci-proc-steps">
      <div id="ci-proc-s1" style="font-size:var(--text-xs);padding:3px 10px;border-radius:var(--r-xl);background:rgba(255,56,92,.15);color:#FF385C;border:1px solid rgba(255,56,92,.3);font-family:'Noto Sans Thai',sans-serif">1 · Transcript</div>
      <div id="ci-proc-s2" style="font-size:var(--text-xs);padding:3px 10px;border-radius:var(--r-xl);background:rgba(255,255,255,.06);color:var(--tx3,#AEAEB2);border:1px solid rgba(255,255,255,.1);font-family:'Noto Sans Thai',sans-serif">2 · สรุป</div>
      <div id="ci-proc-s3" style="font-size:var(--text-xs);padding:3px 10px;border-radius:var(--r-xl);background:rgba(255,255,255,.06);color:var(--tx3,#AEAEB2);border:1px solid rgba(255,255,255,.1);font-family:'Noto Sans Thai',sans-serif">3 · ทักษะ</div>
    </div>
    <p style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);margin-top:10px;font-family:'Noto Sans Thai',sans-serif" id="ci-pelapsed"></p>
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
      <button class="tab-btn on" onclick="CI._tab(0,this)">บทสนทนา</button>
      <button class="tab-btn" onclick="CI._tab(1,this)">ทักษะ</button>
      <button class="tab-btn" onclick="CI._tab(2,this)">ลูกค้า</button>
    </div>
  </div>
  <div class="result-body" id="ci-result-body">
    <div class="panel on" id="ci-p0"></div>
    <div class="panel" id="ci-p1"></div>
    <div class="panel" id="ci-p2"></div>
  </div>
  <div class="result-cta">
    <button class="btn btn-ghost" onclick="CI.cancel()">ทิ้ง</button>
    <button class="btn btn-primary" onclick="CI._save()">บันทึก</button>
  </div>
  <div id="ci-tl-actions" style="display:none;padding:0 24px 12px;gap:8px;flex-shrink:0">
    <button onclick="CI._openDebrief()" style="flex:1;padding:10px;border-radius:var(--r-card);border:0.5px solid rgba(83,74,183,.3);background:rgba(83,74,183,.07);color:#534AB7;font-size:var(--text-base);font-weight:var(--fw-medium);cursor:pointer;font-family:'Noto Sans Thai',-apple-system,sans-serif">Debrief</button>
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
      const r = indexedDB.open(IDB_NAME, 2);
      r.onupgradeneeded = (ev) => {
        const db = r.result;
        if (!db.objectStoreNames.contains('chunks'))   db.createObjectStore('chunks', { autoIncrement: true });
        if (!db.objectStoreNames.contains('meta'))     db.createObjectStore('meta');
        if (!db.objectStoreNames.contains('pipeline')) db.createObjectStore('pipeline'); // v709: transcript + stage
      };
      r.onsuccess = () => res(r.result);
      r.onerror   = () => rej(r.error);
    });
  }
  // v_echofix (2026-07-21): IDB write failures used to be swallowed silently
  // (.catch(()=>{})) — in Safari private mode / full storage, recording
  // proceeded with ZERO warning that crash-recovery wouldn't work. Warn the
  // rep ONCE per session (not per 1s chunk) — recording itself continues,
  // only the safety net is degraded.
  let _idbWarned = false;
  function _warnIdbOnce(e) {
    if (_idbWarned) return;
    _idbWarned = true;
    _toast('เก็บไฟล์กันเสียงหายไม่ได้ (พื้นที่เต็ม/โหมดส่วนตัว?) — ถ้าแอปถูกปิดกลางทาง เสียงจะกู้คืนไม่ได้');
    try { window.SenseSentinel?.report('ci_idb_write_fail', String(e?.message || e || 'unknown')); } catch(_) {}
  }
  function _idbPutChunk(blob) {
    _idbOpen().then(db => { db.transaction('chunks','readwrite').objectStore('chunks').add(blob); }).catch(_warnIdbOnce);
  }
  function _idbSetMeta(meta) {
    _idbOpen().then(db => { db.transaction('meta','readwrite').objectStore('meta').put(meta,'current'); }).catch(_warnIdbOnce);
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
      const tx = db.transaction(['chunks','meta','pipeline'],'readwrite');
      tx.objectStore('chunks').clear();
      tx.objectStore('meta').clear();
      tx.objectStore('pipeline').clear();
    }).catch(()=>{});
  }
  // v709: pipeline state — เก็บ transcript + stage เผื่อ recovery resume จากขั้นที่ค้าง
  function _idbSetPipeline(data) {
    _idbOpen().then(db => { db.transaction('pipeline','readwrite').objectStore('pipeline').put(data,'current'); }).catch(()=>{});
  }
  function _idbGetPipeline() {
    return _idbOpen().then(db => new Promise(res => {
      const r = db.transaction('pipeline').objectStore('pipeline').get('current');
      r.onsuccess = () => res(r.result || null);
      r.onerror   = () => res(null);
    })).catch(() => null);
  }

  // ── Recovery — เช็ค buffer ค้างตอนเปิด Echo (rep เท่านั้น, idle เท่านั้น) ──
  async function _checkRecoverBuffer() {
    if (_phase !== 'idle' || _sessionId || _canDebrief()) return; // v728: ไม่ recover ถ้ามี session active อยู่
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
    div.style.cssText = 'margin:4px 24px 8px;padding:12px 14px;border-radius:var(--r-lg);background:rgba(255,149,0,.08);border:0.5px solid rgba(255,149,0,.25)';
    div.innerHTML = `
      <div style="font-size:var(--text-md);font-weight:var(--fw-semi);color:#995500;margin-bottom:2px;font-family:'Noto Sans Thai',sans-serif">พบการบันทึกค้าง ${_fmt(secs)} นาที</div>
      <div style="font-size:var(--text-sm);color:#8e8e93;margin-bottom:8px;font-family:'Noto Sans Thai',sans-serif">${meta.account_name || 'ไม่ระบุร้าน'} · แอพถูกปิดก่อนวิเคราะห์เสร็จ</div>
      <div style="display:flex;gap:8px">
        <button onclick="CI._recoverBuffer()" style="flex:1;padding:9px;border:none;border-radius:var(--r-md);background:#FF9500;color:var(--tk-text-primary);font-size:var(--text-md);font-weight:var(--fw-semi);font-family:'Noto Sans Thai',sans-serif;cursor:pointer">วิเคราะห์ต่อ</button>
        <button onclick="CI._discardBuffer()" style="padding:9px 14px;border:0.5px solid rgba(0,0,0,.12);border-radius:var(--r-md);background:transparent;color:#8e8e93;font-size:var(--text-md);font-family:'Noto Sans Thai',sans-serif;cursor:pointer">ทิ้ง</button>
      </div>`;
    const anchor = document.getElementById('ci-chip-wrap');
    if (anchor && anchor.parentElement === scr) scr.insertBefore(div, anchor);
    else scr.appendChild(div);
  }

  async function _recoverBuffer() {
    const meta     = await _idbGetMeta();
    const chunks   = await _idbGetChunks();
    const pipeline = await _idbGetPipeline(); // v709: check if transcript already done
    document.getElementById('ci-recover-banner')?.remove();
    if (!chunks.length && !pipeline?.segments?.length) { _toast('ไม่พบข้อมูลเสียง'); _idbClear(); return; }
    _accountGuid = meta?.account_guid || null;
    _accountName = meta?.account_name || '';
    _accountSeg  = meta?.account_seg  || '';
    _ownerType   = meta?.owner_type   || _ownerType;
    // v_echog1: กู้ _checkinCache ด้วย — เดิมกู้ทุกอย่างยกเว้นตัวนี้ ทำให้แถวที่
    // save จากเส้นทางกู้คืนเสีย GPS (rep_lat=null) และไม่เชื่อมกับแถวเช็คอินใน DB
    // เงื่อนไขจับคู่: ร้านเดียวกัน + เช็คอินเกิดก่อนเริ่มอัดไม่เกิน 90 นาที
    try {
      const cached = JSON.parse(localStorage.getItem('ci_checkin_cache') || 'null');
      if (cached) {
        const sameAcct = cached.account_guid
          ? cached.account_guid === _accountGuid
          : (!_accountGuid && cached.account_name && cached.account_name === _accountName);
        const ciT  = new Date(cached.checked_in_at).getTime();
        const recT = meta?.started_at || Date.now();
        if (sameAcct && ciT <= recT && (recT - ciT) < 90 * 60000) _checkinCache = cached;
      }
    } catch(_) {}
    _secs = chunks.length; _durText = _fmt(_secs);
    _isOwnRecording = true;
    _phase = 'processing';
    _renderEchoState();
    _showScreen('ci-s-proc');
    // v709: ถ้ามี transcript แล้วให้ resume จาก Step 2 ไม่ต้อง re-transcript
    if (pipeline?.segments?.length && pipeline.stage === 'transcribed') {
      _setStep('กำลังสรุปบทสนทนา...', 'กู้คืน — resume จาก transcript', 45);
      const blob = chunks.length ? new Blob(chunks, { type: meta?.mime || 'audio/webm' }) : new Blob([]);
      _processBlob(blob, pipeline.segments);
    } else {
      _setStep('กำลัง transcript...', 'กู้คืนจากบันทึกค้าง', 10);
      const blob = new Blob(chunks, { type: meta?.mime || 'audio/webm' });
      _processBlob(blob);
    }
  }

  async function _discardBuffer() {
    document.getElementById('ci-recover-banner')?.remove();
    await _idbClear();
  }

  // ── v_echog1: "วิเคราะห์ต่อ" จากแถว history ที่ค้างขั้น transcribed ──────────
  // ปุ่มนี้ถูก error message สัญญาไว้ตั้งแต่ v709 แต่ไม่เคยมีจริง — session ที่
  // transcript สำเร็จแต่วิเคราะห์พัง (AI คิวเต็ม ฯลฯ) เลยตันถาวร
  // flow: อ่าน transcript จากแถว DB → ตั้ง _sessionId เป็นแถวนั้น → วิ่ง pipeline
  // ครึ่งหลังเดิมผ่าน _processBlob(resume) → _saveAnalysisToExistingSession
  // UPDATE แถวเดิมเป็น analyzed/saved เอง
  async function _resumeAnalysis(sessionId) {
    if (!sessionId) return;
    if (_phase === 'recording' || _phase === 'processing') { _toast('มี session กำลังทำงานอยู่ — รอให้เสร็จก่อน'); return; }
    try {
      const { data: row, error } = await supa.from('ci_sessions')
        .select('id,owner_email,account_id,account_name,duration_secs,transcript,pipeline_stage,owner_type')
        .eq('id', sessionId).single();
      if (error || !row) throw error || new Error('ไม่พบ session');
      const segments = Array.isArray(row.transcript) ? row.transcript : [];
      if (!segments.length) { _toast('แถวนี้ไม่มี transcript ให้วิเคราะห์ต่อ'); return; }
      const me = (_authEmail() || '').toLowerCase(); // v952
      if ((row.owner_email || '').toLowerCase() !== me) { _toast('วิเคราะห์ต่อได้เฉพาะ session ของตัวเอง'); return; }

      // A2v2.1: prefer server-side processing — if the deployed worker has
      // /process, the rep doesn't need to keep the app open for the analysis
      if (!_asyncEndpointMissing) {
        try {
          const r = await fetch(`${WORKER_URL}/process`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: row.id })
          });
          if (r.status === 202) {
            _toast('ส่งให้ระบบวิเคราะห์แล้ว — ผลจะขึ้นในประวัติสักครู่ ปิดหน้าจอได้เลย');
            return;
          }
          if (r.status === 404 || r.status === 405) _asyncEndpointMissing = true;
        } catch(_) { /* network — fall through to local resume */ }
      }

      _sessionId   = row.id;
      _accountGuid = row.account_id || null;
      _accountName = row.account_name || '';
      // ECHO GOAL 2: use the REAL row's owner_type for rubric bucketing — not
      // whatever _ownerType last happened to be from a previous open()/picker
      _ownerType = row.owner_type || _ownerType;
      _secs = row.duration_secs || 0; _durText = _fmt(_secs);
      _isOwnRecording = true;
      _phase = 'processing';
      _renderEchoState();
      _showScreen('ci-s-proc');
      _setStep('กำลังสรุปบทสนทนา...', 'วิเคราะห์ต่อจาก transcript ที่บันทึกไว้', 45);
      // v951: await + refresh — เดิม fire-and-forget ทำให้ history ไม่รู้ว่าจบแล้ว
      // (_processBlob ตรึง ctx ของตัวเองจาก globals ที่เพิ่งตั้งข้างบน — การเซฟ
      // จึงลงแถวนี้เสมอ ต่อให้ user ปิด/สลับหน้าระหว่างรอ)
      await _processBlob(new Blob([]), segments);
      try { _loadInlineHistory(); } catch(_) {}
    } catch(e) {
      _phase = 'idle';
      _toast('เริ่มวิเคราะห์ต่อไม่สำเร็จ: ' + e.message);
    }
  }

  // ── Recording ─────────────────────────────────────────────────────────────
  async function startRecording() {
    document.body.classList.add('echo-active');
    if (_phase !== 'idle') return;
    // RECORD-HANG-DIAG: getUserMedia() has zero telemetry today — if it truly
    // hangs (mic held by another process, browser deadlock) the promise never
    // settles and the catch block below never runs, leaving no trace at all.
    // This watchdog fires once even if getUserMedia eventually resolves late.
    let _gumSettled = false;
    const _gumWatchdog = setTimeout(() => {
      if (_gumSettled) return;
      try { window.SenseSentinel?.report('ci_record_start_timeout', 'getUserMedia not settled after 8s'); } catch(_) {}
    }, 8000);
    try {
      // v_echor3 (2026-08-08): เดิมขอไมค์ด้วย { audio: true } เปล่าๆ = ปล่อยให้
      // มือถือใช้ค่า default ซึ่งจูนมาเพื่อ "โทรศัพท์" — คนเดียว ปากใกล้ไมค์ ตัด
      // ทุกอย่างที่ไม่ใช่เสียงนั้นทิ้ง · สถานการณ์จริงของ Echo ตรงข้ามเป๊ะ: วาง
      // มือถือบนโต๊ะ สองคนนั่งคนละฝั่ง ในร้านอาหารเสียงดัง
      //   noiseSuppression → กินเสียงลูกค้าที่นั่งไกลทิ้งไปด้วย
      //   autoGainControl  → ดันเสียงรบกวนขึ้นมาตอนไม่มีใครพูด
      //   echoCancellation → ออกแบบมาเพื่อตัดเสียงลำโพงตัวเอง ไม่มีประโยชน์ที่นี่
      // ขอปิดทั้ง 3 ตัว · เบราว์เซอร์ไหนไม่รองรับจะเมินค่าที่ขอไปเฉยๆ ไม่ error
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl:  false,
          channelCount:     1,
          sampleRate:       48000
        }
      });
      _gumSettled = true; clearTimeout(_gumWatchdog);
      // บันทึกว่าได้ค่าที่ขอจริงไหม — บางรุ่นเมินเงียบๆ ต้องรู้ตอนไล่คุณภาพเสียง
      try {
        const st = stream.getAudioTracks()[0]?.getSettings?.() || {};
        _micSettings = {
          echoCancellation: st.echoCancellation, noiseSuppression: st.noiseSuppression,
          autoGainControl: st.autoGainControl, sampleRate: st.sampleRate, channelCount: st.channelCount
        };
        console.log('[CI mic]', JSON.stringify(_micSettings));
      } catch(_) { _micSettings = null; }
      const mime   = _bestMime();
      // v_echor3: 24k → 48k · ที่ 24kbps Opus บีบเสียงพูดคนเดียวใกล้ไมค์ได้พอดี
      // แต่สองคนคนละระยะในห้องมีเสียงรบกวนคือสัญญาณที่ซับซ้อนกว่ามาก 48k ยังนับว่า
      // ประหยัด (80 นาที ≈ 29MB) และเป็นตัวแปรที่ถูกที่สุดที่ยังไม่เคยลองขยับเลย
      _recorder    = new MediaRecorder(stream, { ...(mime ? { mimeType: mime } : {}), audioBitsPerSecond: 48000 });
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
      // v_echog1: retry เช็คอินที่ค้างในเครื่อง (จุดกดเช็คอินเน็ตอาจหลุด) —
      // idempotent: มี session_id แล้วจะข้ามเอง · fire-and-forget ไม่บล็อกการอัด
      _syncCheckinToDb().catch(() => {});
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
      _gumSettled = true; clearTimeout(_gumWatchdog);
      _phase = 'idle';
      // RECORD-HANG-DIAG: this catch never wrote to app_errors before — only a
      // toast the rep could dismiss/miss, leaving zero trace for diagnosis later
      try { window.SenseSentinel?.report('ci_record_start_fail', (err?.name || 'Error') + ':' + (err?.message || 'unknown')); } catch(_) {}
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
    _startAsyncPipeline(blob);
  }

  // ── A2v2.1 (2026-08-05): async pipeline — upload then fire-and-forget ──────
  // Real rep behavior: stop recording, pocket the phone. So the client does ONE
  // quick upload (seconds) + one tiny keepalive trigger, and the WORKER runs
  // transcript→analyze server-side. If the live worker doesn't have /process
  // yet (pre-deploy window) we fall back to the proven local pipeline, on the
  // same row, transparently.
  function _getAuthUserId() {
    try {
      for (const store of [localStorage, sessionStorage]) {
        const k = Object.keys(store).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
        if (k) {
          const s = JSON.parse(store.getItem(k));
          const id = s?.user?.id || s?.data?.user?.id;
          if (id) return id;
        }
      }
    } catch(_) {}
    return null;
  }

  // v_queue (2026-08-12): ตัวตรวจไฟล์เสียงตัวเดียวที่ใช้ร่วมกันทุกเส้นทาง
  //
  // ทำไม: ของเดิมตรวจอยู่ใน _processBlob (เส้นทาง legacy) เท่านั้น — เส้นทางหลัก
  // _startAsyncPipeline ไม่เคยเรียกเลย · ผลคือ 11 ส.ค. มีคลิป 24KB/54KB จากการอัด
  // 19-48 นาที (iOS ตัดไมค์ตอนล็อกจอ) หลุดขึ้นไปทั้งก้อน แล้ววนกิน Groq อยู่ 24 ชม.
  //
  // ค่าคงที่เดิมคือ _secs * 3000 ซึ่งอิง bitrate 24kbps ของยุคก่อน — เครื่องอัด
  // ตั้งไว้ที่ 48kbps มาตั้งแต่ v_echor3 ทำให้เกณฑ์หย่อนไปเท่าตัว
  // เกณฑ์ fatal 0.15 มาจากข้อมูลจริง: ไฟล์ดีอยู่ที่ 0.25-0.51 MB/นาที
  // ไฟล์พังอยู่ที่ 0.0011-0.02 MB/นาที — ห่างกัน 25 เท่า ตัดตรงกลางได้สบาย
  const REC_BYTES_PER_SEC = 48000 / 8;   // ต้องตรงกับ audioBitsPerSecond ตอนอัด
  function _audioLooksTruncated(blobSize, secs) {
    if (!secs || secs < 60) return null;               // สั้นเกินกว่าจะตัดสิน
    const expected = secs * REC_BYTES_PER_SEC;
    if (expected <= 0) return null;
    const ratio = blobSize / expected;
    const gotMins = Math.round(blobSize / REC_BYTES_PER_SEC / 60);
    if (ratio < 0.15) return { fatal: true,  ratio, gotMins };   // ใช้งานไม่ได้จริง
    if (ratio < 0.7)  return { fatal: false, ratio, gotMins };   // ขาดบางช่วง
    return null;
  }

  // ── v_ears (2026-08-14): glossary ชื่อสินค้าของร้านนี้ ───────────────────
  //
  // Whisper รับ `prompt` เพื่อ "ใบ้" การสะกดคำเฉพาะ — ของเดิมใส่แค่ 6 คำคงที่
  // ทั้งที่เรามีรายชื่อสินค้าที่ร้านนี้ซื้อประจำอยู่ในมือแล้ว (bulkSkusData)
  // ผลคือคำอย่าง "เป็กโกรีโน" / "พิคานย่า" ถอดออกมาเพี้ยนทุกครั้ง เพราะโมเดล
  // ไม่เคยเห็นคำนี้ในบริบทนี้มาก่อน
  //
  // เพดาน prompt ของ Whisper คือ 224 token — เกินแล้วมันตัดหัวทิ้งเงียบๆ
  // จึงคุมด้วยจำนวนอักษรแทน (ไทยกินหลาย token ต่ออักษร ตัดที่ ~260 ตัวอักษร
  // เผื่อไว้มาก) และเรียงตาม GMV เพื่อให้คำที่พูดถึงบ่อยสุดได้ที่ก่อน
  const SKU_GLOSSARY_MAX_CHARS = 260;
  function _skuGlossaryFor(accountGuid) {
    try {
      if (!accountGuid || typeof bulkSkusData === 'undefined' || !bulkSkusData) return '';
      const byMonth = bulkSkusData[accountGuid];
      if (!byMonth) return '';
      // เดือนล่าสุดที่มีข้อมูล
      const months = Object.keys(byMonth).sort();
      const rows = byMonth[months[months.length - 1]] || [];
      const seen = new Set(), names = [];
      rows.slice()
        .sort((a, b) => (b.gmv || 0) - (a.gmv || 0))
        .forEach(r => {
          const n = String(r.n || '').trim();
          // ข้ามชื่อสั้นเกินจนไม่ช่วยอะไร และชื่อยาวเกินจนกินโควตา
          if (n.length < 3 || n.length > 28) return;
          const k = n.toLowerCase();
          if (seen.has(k)) return;
          seen.add(k); names.push(n);
        });
      let out = '';
      for (const n of names) {
        const next = out ? out + ' ' + n : n;
        if (next.length > SKU_GLOSSARY_MAX_CHARS) break;
        out = next;
      }
      return out;
    } catch (e) { return ''; }
  }

  async function _startAsyncPipeline(blob) {
    // pin ctx at start — same v951 discipline as _processBlob (globals can be
    // wiped by open()/picker while we await network)
    const ctx = {
      sessionId:    _sessionId || null,
      checkinCache: _checkinCache || null,
      accountGuid:  _accountGuid || null,
      accountName:  _accountName || '',
      skuGlossary:  _skuGlossaryFor(_accountGuid),
      ownerType:    _ownerType,
      secs:         _secs,
    };
    _startProcTimer();
    _setStep('กำลังบันทึกขึ้นระบบ...', 'อัปโหลดเสียง — ไม่กี่วินาที', 30);
    try {
      const userId = _getAuthUserId();
      const email  = _authEmail();
      if (!userId || !email) throw new Error('no-auth');

      // 1) upload audio to the rep's own prefix (RLS-scoped)
      const ext  = (blob.type || '').includes('mp4') ? 'mp4' : 'webm';
      const rand = (typeof crypto !== 'undefined' && crypto.randomUUID)
        ? crypto.randomUUID() : (Date.now() + '-' + Math.random().toString(36).slice(2));
      const path = `echo-audio/${userId}/${rand}.${ext}`;
      const { error: upErr } = await supa.storage.from('ciq-data')
        .upload(path, blob, { upsert: true, contentType: blob.type || 'audio/webm' });
      if (upErr) throw upErr;

      // 2) claim/create the session row at stage 'uploaded'
      await _syncCheckinToDb(ctx.checkinCache).catch(() => {});
      let rowId = ctx.sessionId || ctx.checkinCache?.session_id || null;
      const nowIso = new Date().toISOString();

      // v_queue: ไฟล์ที่สั้นผิดปกติเทียบกับเวลาอัด = ถอดเสียงไม่ได้แน่นอน
      // ตีตราจบตั้งแต่ตรงนี้ ไม่ส่งเข้าคิว — ประหยัดโควตา Groq และบอก rep ทันที
      // ตั้งแต่ยังอยู่หน้าร้าน (ยังอัปไฟล์ขึ้นไปตามปกติ เพราะต้องเก็บไว้เป็นหลักฐาน
      // ว่าไมค์มีปัญหาจริง ตามกติกา "ห้ามลบเสียงทิ้ง" ของ v_echor3)
      const _trunc = _audioLooksTruncated(blob.size, ctx.secs);
      const _dead  = !!(_trunc && _trunc.fatal);
      const _stage = _dead ? 'failed_audio' : 'uploaded';
      const _deadNote = _dead
        ? `${nowIso} [client] ไฟล์เสียงไม่สมบูรณ์ — ได้เสียงจริง ~${_trunc.gotMins} นาที จากการอัด ${Math.round(ctx.secs / 60)} นาที`
        : null;
      if (rowId) {
        const { error } = await supa.from('ci_sessions')
          .update({ pipeline_stage: _stage, audio_path: path, duration_secs: ctx.secs,
                    sku_glossary: ctx.skuGlossary || null,
                    pipeline_error: _deadNote })
          .eq('id', rowId);
        if (error) throw error;
      } else {
        const { data: rowIns, error } = await supa.from('ci_sessions').insert({
          owner_email:    email,
          owner_type:     ctx.ownerType,
          account_id:     ctx.accountGuid || null,
          account_name:   ctx.accountName || null,
          sku_glossary:   ctx.skuGlossary || null,
          visited_at:     ctx.checkinCache?.checked_in_at || nowIso,
          duration_secs:  ctx.secs,
          pipeline_stage: _stage,
          pipeline_error: _deadNote,
          audio_path:     path,
          rep_lat:        ctx.checkinCache?.rep_lat ?? null,
          rep_lng:        ctx.checkinCache?.rep_lng ?? null,
          checked_in_at:  ctx.checkinCache?.checked_in_at || null,
          status:         'draft'
        }).select('id').single();
        if (error || !rowIns) throw error || new Error('insert failed');
        rowId = rowIns.id;
        if (ctx.checkinCache) ctx.checkinCache.session_id = rowId;
      }

      // v_queue: ไฟล์ใช้ไม่ได้ = ไม่ต้องปลุก worker เลย จบตรงนี้แบบบอกความจริง
      if (_dead) {
        _idbClear(); _stopProcTimer(); _phase = 'idle'; _sessionId = null;
        if (_checkinCache && _checkinCache === ctx.checkinCache) {
          _checkinCache = null;
          try { localStorage.removeItem('ci_checkin_cache'); } catch(_) {}
        }
        _setStep('บันทึก visit แล้ว', 'แต่ไฟล์เสียงไม่สมบูรณ์ — วิเคราะห์ไม่ได้', 100);
        setTimeout(() => {
          _unmount();
          _toast('เสียงที่อัดได้จริงมีแค่ ~' + _trunc.gotMins + ' นาที — visit นับปกติ แต่วิเคราะห์ไม่ได้ ครั้งหน้าลองไม่ล็อกจอ');
        }, 2400);
        return;
      }

      // 3) trigger — keepalive survives the rep closing the app immediately
      _setStep('ส่งให้ระบบวิเคราะห์...', '', 70);
      let endpointMissing = false;
      try {
        const res = await fetch(`${WORKER_URL}/process`, {
          method: 'POST', keepalive: true,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ session_id: rowId })
        });
        if (res.status === 404 || res.status === 405) endpointMissing = true;
        else console.log('[CI async] /process trigger status=' + res.status);
      } catch(_) { /* network blip — the audio+row are durable; sweep retries */ }

      if (endpointMissing) {
        // old worker without /process — clean up the uploaded file and run the
        // proven local pipeline against this same row
        _asyncEndpointMissing = true;
        try { await supa.storage.from('ciq-data').remove([path]); } catch(_) {}
        try { await supa.from('ci_sessions').update({ audio_path: null }).eq('id', rowId); } catch(_) {}
        _sessionId = rowId; // local pipeline's pinned ctx targets this row
        _stopProcTimer();
        return _processBlob(blob);
      }

      // async mode engaged — everything durable server-side, phone can close
      _idbClear();
      _stopProcTimer();
      _phase = 'idle';
      _sessionId = null;
      // v951 discipline: only clear the global when it's still THIS visit's cache
      if (_checkinCache && _checkinCache === ctx.checkinCache) {
        _checkinCache = null;
        try { localStorage.removeItem('ci_checkin_cache'); } catch(_) {}
      }
      _setStep('บันทึกเรียบร้อย ✓', 'ระบบวิเคราะห์ต่อเองเบื้องหลัง — ปิดหน้าจอได้เลย ผลจะขึ้นในประวัติ', 100);
      setTimeout(() => {
        _unmount();
        _toast('ส่งให้ระบบวิเคราะห์แล้ว — ผลจะขึ้นในประวัติ');
      }, 2400);
    } catch (err) {
      // upload path failed (offline / storage / auth) — the blob is still in
      // memory + IDB; behave exactly like before this feature existed
      console.warn('[CI async] upload path failed, falling back to local pipeline:', err?.message || err);
      try { window.SenseSentinel?.report('ci_async_upload_fail', String(err?.message || err).slice(0, 200)); } catch(_) {}
      _stopProcTimer();
      _processBlob(blob);
    }
  }

  // A2v2.1: safety net — on app boot / resume, re-trigger my own rows stuck in
  // an async stage (worker died mid-stage, or the trigger call never landed).
  // Mirrors the v952 checkin retry pattern; /process stage claims are
  // idempotent so over-triggering is harmless.
  let _asyncSweepLast = 0;
  let _asyncEndpointMissing = false;
  async function _sweepStuckAsyncRows(force) {
    if (_asyncEndpointMissing) return;      // old worker — nothing to sweep to
    if (_phase !== 'idle') return;          // never race a live local pipeline
    const now = Date.now();
    if (!force && now - _asyncSweepLast < 5 * 60 * 1000) return;
    _asyncSweepLast = now;
    try {
      const email = _authEmail();
      if (!email) return;
      const staleIso = new Date(now - 3 * 60 * 1000).toISOString();
      const { data: rows } = await supa.from('ci_sessions')
        .select('id,pipeline_stage,processing_since')
        .eq('owner_email', email)
        .in('pipeline_stage', ['uploaded', 'transcribed'])
        .eq('status', 'draft')
        .order('visited_at', { ascending: false })
        .limit(10);
      const stuck = (rows || []).filter(r => !r.processing_since || r.processing_since < staleIso);
      for (const r of stuck) {
        try {
          const res = await fetch(`${WORKER_URL}/process`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: r.id })
          });
          if (res.status === 404 || res.status === 405) { _asyncEndpointMissing = true; return; }
        } catch(_) { return; } // offline — try again next resume
      }
    } catch(_) {}
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') setTimeout(_sweepStuckAsyncRows, 4000);
  });
  setTimeout(_sweepStuckAsyncRows, 9000);

  // v709: pipeline — 3 calls แยก task แทน 1 call ทำทุกอย่าง
  // transcript (ground truth) → summary → skills+OCPB
  // แต่ละขั้น save IDB ก่อน proceed — recovery resume ได้จากขั้นที่ค้าง
  async function _processBlob(blob, _resumeFromSegments) {
    _startProcTimer();
    // v951: ตรึง context ของ pipeline ตอนเริ่ม — การเซฟทุกจุดอ่านจาก ctx นี้เท่านั้น
    // เดิมอ่าน globals ตอนเซฟ ซึ่ง open()/picker ล้างได้ระหว่างรอ AI 1-3 นาที
    // → ผลวิเคราะห์หลุดไปสร้างแถวกำพร้า (เคสจริง 2026-08-04: แถว analyzed
    // ที่ account=null, 0 วิ ทั้งที่ transcript คือเสียงร้านโยโยเล 19 วิ)
    // หมายเหตุ: checkinCache เก็บเป็น "reference" ไม่ใช่สำเนา — กันเฉพาะเคสตัวแปร
    // global ถูก set เป็น null แต่ยังแชร์ session_id ที่ sync สำเร็จทีหลังได้
    const _ctx = {
      sessionId:    _sessionId || null,          // resume ตั้งไว้ก่อนเรียก
      checkinCache: _checkinCache || null,
      accountGuid:  _accountGuid || null,
      accountName:  _accountName || '',
      skuGlossary:  _skuGlossaryFor(_accountGuid),
      ownerType:    _ownerType,
      secs:         _secs,
    };
    try {
      // ── audio integrity check ──────────────────────────────────────────────
      // v_queue: ใช้ตัวตรวจตัวเดียวกับเส้นทางหลัก (เดิมคำนวณเองด้วยเลข 24kbps)
      // v_echog1: resume จาก transcript ส่ง blob เปล่ามา — อย่าเตือนเสียงหายผิดๆ
      const _tr = _resumeFromSegments ? null : _audioLooksTruncated(blob.size, _secs);
      if (_tr) {
        try { window.SenseSentinel?.report('ci_audio_gap', 'ratio=' + _tr.ratio.toFixed(2)); } catch(_) {}
        _toast('เสียงที่อัดได้จริง ~' + _tr.gotMins + ' นาที (บางช่วงอาจหายจากการสลับแอพหรือล็อคจอ)');
      }

      // Load rubric from DB if not cached yet
      if (!_rubricCache) await _loadRubricFromDB();

      // ── Step 1: Transcript (ground truth) ───────────────────────────────────
      // Echo v2: save transcript to Supabase immediately after this step
      // Analysis layers are disposable — transcript is permanent
      let segments = _resumeFromSegments || null;
      if (!segments) {
        _setStep('กำลัง transcript...', 'Whisper + Gemini · ถอดเสียง + แยกคนพูด', 10); // v3 hybrid pipeline (worker /transcript)
        // Dynamic timeout: at least 6 min, scale with recording length
        const transcriptTimeout = Math.max(360000, _secs * 1000 * 1.5);
        const transcriptResult = await _callTranscript(blob, transcriptTimeout, _ctx.accountName, _ctx.skuGlossary);
        if (transcriptResult.no_speech) {
          _phase = 'idle'; _idbClear(); _unmount();
          _toast('ไม่พบเสียงพูดใน audio'); return;
        }
        segments = transcriptResult.segments || [];
        // Fallback: diarize failed but Whisper text exists (source = 'whisper_fallback')
        if (!segments.length) throw new Error('Transcript ไม่ได้ผล — ไม่มี segments');
        _idbSetPipeline({ segments, stage: 'transcribed' });
        console.log('[CI pipeline] transcript done —', segments.length, 'segments, source=' + (transcriptResult.source || 'unknown'));
        // Phase A0: carry the worker's own quality signal through ctx so it can
        // be persisted — was computed already, just never read anywhere before
        _ctx.transcriptConfidence = typeof transcriptResult.avg_transcript_confidence === 'number' ? transcriptResult.avg_transcript_confidence : null;
        _ctx.speakerConfidence    = typeof transcriptResult.avg_speaker_confidence === 'number' ? transcriptResult.avg_speaker_confidence : null;

        // ── Echo v2: Save transcript to Supabase immediately (permanent ground truth) ──
        _setStep('กำลังบันทึก transcript...', '', 20);
        await _saveTranscriptOnly(segments, transcriptResult.source || 'unknown', _ctx);

      } else {
        console.log('[CI pipeline] resuming from transcript —', segments.length, 'segments');
      }

      // ── Progressive: เข้าหน้า result ทันทีหลัง transcript เสร็จ ───────────
      _lastResult = { segments, summaryData: null, skillData: null, intelData: null,
                      transcriptSummary: null, toneSignals: null };
      _renderResult();
      // v951: guard null — ถ้า Echo DOM ถูกถอด (user ปิด sheet ระหว่างรอ) ห้าม throw
      // ทั้ง pipeline เพราะขั้นเซฟยังต้องวิ่งต่อให้จบ
      const _durChip = document.getElementById('ci-dur-chip');
      if (_durChip) _durChip.textContent = _durText;
      _showScreen('ci-s-result');
      setTimeout(_initPill, 80);

      // ── Step 2: Summary ──────────────────────────────────────────────────────
      _setStep('กำลังสรุปบทสนทนา...', 'Gemini · อ่าน transcript', 45);
      let summaryResult = null;
      try {
        summaryResult = await _callSummarize(segments);
      } catch(summaryErr) {
        // Summary failure is non-fatal — analysis proceeds with null summary
        console.warn('[CI pipeline] summary failed (non-fatal):', summaryErr.message);
        summaryResult = null;
      }
      _idbSetPipeline({ segments, summary: summaryResult, stage: 'summarized' });
      console.log('[CI pipeline] summary done, result=' + (summaryResult ? 'ok' : 'null'));

      // Update Tab 1 immediately after summary (guard: user may have cancelled)
      if (_lastResult) {
        _lastResult.summaryData = summaryResult;
        _lastResult.transcriptSummary = summaryResult?.transcript_summary || null;
        _lastResult.toneSignals = summaryResult?.tone || null;
        _updatePanel(0);
      }

      // ── Step 3: Skills + OCPB ────────────────────────────────────────────────
      _setStep('กำลังวิเคราะห์ทักษะ...', 'Claude · ประเมิน skills + OCPB', 70);
      const analysisResult = await _callAnalyze(segments, summaryResult, _ctx);
      console.log('[CI pipeline] analysis done');

      // Update Tab 2 + 3 (guard: user may have cancelled/unmounted)
      if (_lastResult) {
        _lastResult.skillData  = analysisResult.skillData;
        _lastResult.intelData  = analysisResult.intelData;
        _updatePanel(1);
        _updatePanel(2);
      }

      // ── Save full analysis to Supabase ───────────────────────────────────────
      // Transcript was already saved in step 1 — this updates the same row
      _setStep('กำลังบันทึก...', '', 92);
      console.log('[CI pipeline] reaching save step, _sessionId=' + _sessionId);
      await _saveAnalysisToExistingSession(segments, summaryResult, analysisResult, _ctx);
      _sessionId = null; // v731: pipeline owns _sessionId — release after save completes
      _idbClear();
      _setStep('', '', 100);
      _stopProcTimer();
      const procBanner = document.getElementById('ci-proc-banner');
      if (procBanner) procBanner.style.display = 'none';

    } catch (err) {
      _stopProcTimer();
      _phase = 'idle';
      console.error('[CI pipeline] FAILED:', err.message, err.stack?.split('\n').slice(0,2).join(' | '));
      _unmount();
      try { window.SenseSentinel?.report('ci_analyze_fail',
        err.message.slice(0, 200) + ' | secs=' + _secs + ' | acct=' + (_accountName || '-')); } catch(_) {}
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
      // If transcript was already saved, user can retry analysis from history
      if (_sessionId) {
        _toast(_human + ' — transcript บันทึกแล้ว กด "วิเคราะห์ใหม่" ใน history ได้เลย');
      } else {
        _toast(_human + ' — บันทึกเสียงถูกเก็บไว้แล้ว เปิด Echo อีกครั้งแล้วกด "วิเคราะห์ต่อ" ได้เลย');
      }
    }
  }

  // ── Pipeline API calls ────────────────────────────────────────────────────────

  async function _callTranscript(audioBlob, timeoutMs, accountName, skuGlossary) {
    const arrayBuf = await audioBlob.arrayBuffer();
    const uint8 = new Uint8Array(arrayBuf);
    let binary = '';
    const chunkSize = 8192;
    for (let i = 0; i < uint8.length; i += chunkSize) {
      binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
    }
    const b64audio = btoa(binary);
    const mimeType = audioBlob.type || 'audio/webm';
    const FETCH_TIMEOUT_MS = timeoutMs || Math.max(360000, _secs * 1000 * 1.5); // dynamic

    let res, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        _setStep(`ลองใหม่ครั้งที่ ${attempt-1}/2...`, 'Whisper + Gemini · ระบบคิวเต็ม', 10 + attempt * 5);
        await new Promise(r => setTimeout(r, attempt === 2 ? 3000 : 7000));
      }
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(`${WORKER_URL}/transcript`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Phase A0: account_name lets the (yet-to-deploy) worker bias Whisper's
          // spelling of this visit's store/company name — old worker just ignores
          // the extra field, so this is safe to ship ahead of the worker deploy
          body: JSON.stringify({ audio_b64: b64audio, mime_type: mimeType, duration_secs: _secs, account_name: accountName || undefined, sku_glossary: skuGlossary || undefined }),
          signal: ctrl.signal,
        });
        if (res.ok) { clearTimeout(tmo); break; }
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Transcript ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) { clearTimeout(tmo); throw lastErr; }
        res = null;
      } catch(e) {
        if (e.name === 'AbortError') throw new Error('หมดเวลา transcript (' + Math.round(FETCH_TIMEOUT_MS/60000) + ' นาที)');
        if (e.message && !e.message.startsWith('Transcript 503') && !e.message.startsWith('Transcript 429')) throw e;
        lastErr = e;
      } finally { clearTimeout(tmo); }
    }
    if (!res || !res.ok) throw lastErr || new Error('Transcript unavailable');
    const data = await res.json();
    const raw = data?.text || '';
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Transcript: no JSON in response');
    let parsed;
    try { parsed = JSON.parse(raw.slice(s, e+1)); }
    catch(_) { parsed = _ciRepairJson(raw.slice(s, e+1)); }
    if (!parsed) throw new Error('Transcript: JSON parse failed');
    return parsed;
  }

  async function _callSummarize(segments) {
    const FETCH_TIMEOUT_MS = 120000; // 2 นาที — text input เร็วกว่า audio
    let res, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, attempt === 2 ? 2000 : 5000));
      }
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(`${WORKER_URL}/summarize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments }),
          signal: ctrl.signal,
        });
        if (res.ok) { clearTimeout(tmo); break; }
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Summarize ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) { clearTimeout(tmo); throw lastErr; }
        res = null;
      } catch(e) {
        if (e.name === 'AbortError') throw new Error('หมดเวลา summarize (2 นาที)');
        lastErr = e;
      } finally { clearTimeout(tmo); }
    }
    if (!res || !res.ok) throw lastErr || new Error('Summarize unavailable');
    const data = await res.json();
    const raw = data?.text || '';
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) return {}; // graceful — summary ไม่มีไม่ block analyze
    try { return JSON.parse(raw.slice(s, e+1)); }
    catch(_) { return _ciRepairJson(raw.slice(s, e+1)) || {}; }
  }

  async function _callAnalyze(segments, summary, ctx) {
    const FETCH_TIMEOUT_MS = 180000; // 3 นาที
    // ECHO GOAL 2 / Phase R: filter the rubric to the visit owner's role bucket
    // before it ever leaves the client — worker only sees skills that apply
    // to this role. skillRoleBucket(ctx.ownerType) is an identity op today
    // (ownerType is already a bucket value) but stays correct if that ever changes.
    const _bucket = (typeof skillRoleBucket === 'function') ? skillRoleBucket(ctx?.ownerType) : 'kam';
    const _rubricForSend = _rubricForBucket(_bucket);
    let res, lastErr;
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (attempt > 1) {
        await new Promise(r => setTimeout(r, attempt === 2 ? 2000 : 5000));
      }
      const ctrl = new AbortController();
      const tmo = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      try {
        res = await fetch(`${WORKER_URL}/analyze`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ segments, summary, rubric: _rubricForSend, role: _bucket }),
          signal: ctrl.signal,
        });
        if (res.ok) { clearTimeout(tmo); break; }
        const errText = await res.text().catch(() => String(res.status));
        lastErr = new Error(`Analyze ${res.status}: ${errText}`);
        if (res.status !== 503 && res.status !== 429) { clearTimeout(tmo); throw lastErr; }
        res = null;
      } catch(e) {
        if (e.name === 'AbortError') throw new Error('หมดเวลา analyze (3 นาที)');
        lastErr = e;
      } finally { clearTimeout(tmo); }
    }
    if (!res || !res.ok) throw lastErr || new Error('Analyze unavailable');
    const data = await res.json();
    const raw = data?.text || '';
    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Analyze: no JSON in response');
    let parsed;
    try { parsed = JSON.parse(raw.slice(s, e+1)); }
    catch(_) { parsed = _ciRepairJson(raw.slice(s, e+1)); }
    if (!parsed) throw new Error('Analyze: JSON parse failed');
    // ECHO GOAL 2 / Phase R: guard against the model returning a skill_code that
    // wasn't in the rubric subset we sent for this role bucket — drop + warn
    // instead of trusting it (out-of-role skill shouldn't reach skill_scores/logs)
    let _skills = Array.isArray(parsed.skills) ? parsed.skills : [];
    if (_skills.length) {
      const _sentCodes = new Set(_rubricForSend.map(d => d.skill_code));
      const _kept = _skills.filter(s => _sentCodes.has(s.code));
      if (_kept.length !== _skills.length) {
        const _dropped = _skills.filter(s => !_sentCodes.has(s.code)).map(s => s.code);
        console.warn('[CI] analyze returned out-of-role skill code(s), dropped:', _dropped, 'bucket=' + _bucket);
      }
      _skills = _kept;
    }
    return {
      skillData: {
        no_speech: false,
        skills:          _skills,
        pipc_stage:      parsed.pipc_stage || null,
        pipc_reached:    parsed.pipc_reached || null,
        overall:         parsed.overall || null,
        session_summary: parsed.session_summary || null,
      },
      intelData: {
        ocpb_status: parsed.ocpb_status || null,
        ocpb_facts:  Array.isArray(parsed.ocpb_facts) ? parsed.ocpb_facts : [],
        next_actions: parsed.next_actions || [],
      },
    };
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

  // ── v952: email พร้อมตั้งแต่วินาทีที่ 0 — ไม่รอ profiles fetch ────────────
  // สเปค "เช็คอิน insert ทันทีที่กด" เคยพังเพราะทุกจุดเซฟรอ currentUserProfile
  // ซึ่งโหลด async — ทั้งที่ email อยู่ใน JWT ที่ localStorage/sessionStorage
  // แบบ synchronous อยู่แล้ว (pattern เดียวกับ _userId lookup ใน save path)
  function _authEmail() {
    if (currentUserProfile?.email) return currentUserProfile.email;
    try {
      for (const store of [localStorage, sessionStorage]) {
        const k = Object.keys(store).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
        if (k) {
          const s = JSON.parse(store.getItem(k));
          const em = s?.user?.email || s?.data?.user?.email;
          if (em) return em;
        }
      }
    } catch(_) {}
    return null;
  }

  // ── Rubric cache — โหลดจาก DB ครั้งเดียว ──────────────────────────────────
  let _rubricCache = null; // null = ยังไม่โหลด

  async function _loadRubricFromDB() {
    try {
      const { data, error } = await supa
        .from('skill_definitions')
        .select('skill_code,skill_name_en,skill_name_th,principle_th,pass_test_th,echo_observable,echo_enabled,roles') // v_echofix: +skill_name_th for the worker's richer rubric text · ECHO GOAL 2: +roles
        .eq('echo_enabled', true)
        .order('skill_code');
      if (error) throw error;
      _rubricCache = data || []; // v_goal2: cache stays the FULL set always — filtering happens per-use via _rubricForBucket
      console.log('[CI] rubric loaded from DB:', _rubricCache.length, 'skills');
    } catch(e) {
      console.warn('[CI] rubric DB load failed, using empty fallback:', e.message);
      _rubricCache = [];
    }
  }

  // ECHO GOAL 2 / Phase R: rubric subset actually sent to the worker for a given
  // role bucket. _rubricCache itself is never filtered/mutated — every def-lookup
  // site (pending queue, name lookups, etc.) keeps seeing the full set, which is
  // what prevents silent-drop bugs.
  function _rubricForBucket(bucket) {
    return (_rubricCache || []).filter(def =>
      (typeof skillDefMatchesBucket === 'function') ? skillDefMatchesBucket(def, bucket) : true);
  }

  // v_echofix (2026-07-21): deleted the dead audio-native Gemini path
  // (_buildGeminiPrompt + _analyzeWithGemini, ~150 lines) — fully built but
  // never invoked anywhere since the Echo v2 3-stage pipeline replaced it.
  // Recover from git history if an audio-native A/B test is ever wanted;
  // the worker-side /analyze-audio endpoint it called is still deployed.

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



  // ── v709: pipeline save — saves transcript to new column ─────────────────────
// ── Echo v2: Save transcript immediately (permanent ground truth) ─────────────
  async function _saveTranscriptOnly(segments, source, ctx) {
    const email = _authEmail(); // v952: ไม่รอ profiles fetch
    if (!email) {
      // v_echofix (2026-07-21): used to silently return — a profile-load race
      // at save time meant the transcript was NEVER persisted and the rep had
      // no idea. Now: tell the rep, keep the IDB buffer alive (caller's
      // success path only clears IDB after analysis save), and report it.
      _toast('บันทึกไม่สำเร็จ (โปรไฟล์ยังไม่พร้อม) — เสียงถูกเก็บไว้ เปิด Echo ใหม่แล้วกด "วิเคราะห์ต่อ"');
      try { window.SenseSentinel?.report('ci_save_no_profile', 'stage=transcript'); } catch(_) {}
      return;
    }
    // v951: อ่านจาก pinned ctx เท่านั้น — globals อาจถูก open()/picker ล้างไปแล้ว
    ctx = ctx || { checkinCache: _checkinCache, accountGuid: _accountGuid,
                   accountName: _accountName, ownerType: _ownerType, secs: _secs };
    const nowIso = new Date().toISOString();
    try {
      // v_echog1: ถ้าเช็คอินสร้างแถวไว้แล้ว (pipeline_stage:'checked_in') ให้
      // UPDATE แถวเดิม ไม่ INSERT ซ้ำ — 1 visit ต้องเป็น 1 แถวเสมอ
      // retry เช็คอินของ visit นี้ก่อนหนึ่งรอบ เผื่อ insert ตอนกดพลาดเพราะเน็ต
      await _syncCheckinToDb(ctx.checkinCache).catch(() => {});
      // A2v2.1: prefer ctx.sessionId — the async-upload fallback path creates
      // the row BEFORE the local pipeline runs, so this update must land on
      // that row (not INSERT a duplicate below)
      const _ciSessionId = ctx.sessionId || ctx.checkinCache?.session_id || null;

      if (_ciSessionId) {
        // visited_at ไม่ทับ — วันที่ไปคือเวลาที่เช็คอิน ไม่ใช่เวลาถอดเสียงเสร็จ
        const { data: updRow, error } = await supa.from('ci_sessions').update({
          duration_secs:  ctx.secs,
          transcript:     segments,
          pipeline_stage: 'transcribed',
          transcript_source: source || 'unknown',
          // Phase A0: worker-computed quality signal — surfaced in UI as a low-confidence warning
          transcript_confidence: ctx.transcriptConfidence ?? null,
          speaker_confidence:    ctx.speakerConfidence ?? null
        }).eq('id', _ciSessionId).select('id').single();
        if (!error && updRow) {
          ctx.sessionId = updRow.id;
          _sessionId = updRow.id;
          console.log('[CI] transcript saved onto checkin row, session_id=' + updRow.id);
          return;
        }
        // v951 self-heal: UPDATE พลาด/0 แถว (แถวถูกลบ หรือ cache ค้างชี้แถวที่
        // ไม่มีแล้ว) — ห้ามจบแค่ toast แล้วปล่อยข้อมูลหาย → ตกลงไป INSERT ข้างล่าง
        console.error('[CI] transcript update failed (' + (error?.message || '0 rows') + ') — self-healing via insert');
        try { window.SenseSentinel?.report('ci_save_selfheal', 'transcript update→insert: ' + (error?.message || '0 rows')); } catch(_) {}
        if (ctx.checkinCache) ctx.checkinCache.session_id = null; // อย่าให้จุดอื่นใช้ id เสียซ้ำ
      }

      const { data: sessionRow, error } = await supa.from('ci_sessions').insert({
        owner_email:    email,
        owner_type:     ctx.ownerType,
        account_id:     ctx.accountGuid || null,
        account_name:   ctx.accountName || null,
        visited_at:     ctx.checkinCache?.checked_in_at || nowIso,
        duration_secs:  ctx.secs,
        transcript:     segments,
        pipeline_stage: 'transcribed',
        transcript_source: source || 'unknown',
        transcript_confidence: ctx.transcriptConfidence ?? null,
        speaker_confidence:    ctx.speakerConfidence ?? null,
        rep_lat:        ctx.checkinCache?.rep_lat ?? null,
        rep_lng:        ctx.checkinCache?.rep_lng ?? null,
        checked_in_at:  ctx.checkinCache?.checked_in_at || null,
        status:         'draft'
      }).select('id').single();
      if (error) {
        console.error('[CI] _saveTranscriptOnly insert FAILED:', error.message, error.code, error.details, error.hint);
        // v_echog1: เดิมพังเงียบ — rep เห็นหน้า result ปกติทั้งที่ไม่มีอะไรถูกเซฟ
        _toast('บันทึก transcript ไม่สำเร็จ — เสียงยังอยู่ในเครื่อง เปิด Echo ใหม่แล้วกด "วิเคราะห์ต่อ"');
      } else if (sessionRow) {
        ctx.sessionId = sessionRow.id;
        if (ctx.checkinCache) ctx.checkinCache.session_id = sessionRow.id;
        _sessionId = sessionRow.id;
        console.log('[CI] transcript saved, session_id=' + sessionRow.id);
      } else {
        console.error('[CI] _saveTranscriptOnly: no error but no row returned');
      }
    } catch(e) {
      console.warn('[CI] _saveTranscriptOnly unavailable:', e.message);
      _toast('บันทึก transcript ไม่สำเร็จ — เสียงยังอยู่ในเครื่อง เปิด Echo ใหม่แล้วกด "วิเคราะห์ต่อ"');
    }
  }

  // ── Echo v2: Update existing session row with analysis ───────────────────
  // v951: รับ pinned ctx — การเซฟห้ามอ่าน globals (open()/picker ล้างได้ระหว่างรอ AI)
  // + self-heal ทุก branch: UPDATE พลาด/0 แถว → ตกลงไป INSERT เสมอ ข้อมูลห้ามหาย
  async function _saveAnalysisToExistingSession(segments, summaryData, analysisResult, ctx) {
    const skillData  = analysisResult?.skillData  || null;
    const intelData  = analysisResult?.intelData  || null;
    const transcriptSummary = summaryData?.transcript_summary || null;
    const toneSignals = summaryData?.tone || null;
    const email = _authEmail(); // v952: ไม่รอ profiles fetch
    if (!email) {
      // v_echofix: same silent-loss guard as _saveTranscriptOnly above.
      _toast('บันทึกผลวิเคราะห์ไม่สำเร็จ (โปรไฟล์ยังไม่พร้อม) — เปิด Echo ใหม่แล้วกด "วิเคราะห์ต่อ"');
      try { window.SenseSentinel?.report('ci_save_no_profile', 'stage=analysis'); } catch(_) {}
      return;
    }
    ctx = ctx || { sessionId: _sessionId, checkinCache: _checkinCache, accountGuid: _accountGuid,
                   accountName: _accountName, ownerType: _ownerType, secs: _secs };
    const today = new Date().toISOString().split('T')[0];
    const nowIso = new Date().toISOString();

    const analysisFields = {
      pipeline_stage:     'analyzed',
      skill_scores:       skillData || null,
      customer_intel:     intelData || null,
      next_actions:       intelData?.next_actions || [],
      transcript_summary: transcriptSummary || null,
      tone_signals:       toneSignals || null,
      summary_data:       summaryData || null,
      status:             'saved'
    };

    // เป้าหมาย: แถวจาก transcript save ก่อน ถ้าไม่มีใช้แถวเช็คอิน
    let targetId = ctx.sessionId || ctx.checkinCache?.session_id || null;
    let saved = false;

    console.log('[CI save] targetId=' + targetId + ' skillData=' + !!skillData + ' intelData=' + !!intelData);
    if (targetId) {
      try {
        // แถวที่ยังไม่ผ่าน transcript save (มาจากเช็คอินล้วน) ต้องได้ transcript+duration ด้วย
        const viaCheckinOnly = !ctx.sessionId;
        const updFields = viaCheckinOnly
          ? { ...analysisFields, duration_secs: ctx.secs,
              transcript: segments?.length ? segments : null, transcript_source: 'unknown' }
          : analysisFields;
        const { data: updRow, error: updErr } = await supa.from('ci_sessions')
          .update(updFields).eq('id', targetId).select('id').single();
        if (!updErr && updRow) {
          _sessionId = updRow.id;
          ctx.sessionId = updRow.id;
          saved = true;
          console.log('[CI] analysis saved to session_id=' + updRow.id);
        } else {
          // v951 self-heal: แถวเป้าหมายหาย (ถูกลบ/cache ค้าง) — ห้ามทิ้งผลวิเคราะห์
          console.error('[CI] analysis update failed (' + (updErr?.message || '0 rows') + ') — self-healing via insert');
          try { window.SenseSentinel?.report('ci_save_selfheal', 'analysis update→insert: ' + (updErr?.message || '0 rows')); } catch(_) {}
        }
      } catch(e) {
        console.warn('[CI] analysis update unavailable:', e.message);
      }
    }

    if (!saved) {
      // Fallback insert — ใช้ค่าจาก pinned ctx เท่านั้น (เดิมอ่าน globals ที่ถูกล้าง
      // ระหว่างรอ AI → แถวกำพร้า account=null, 0 วิ อย่างเคสจริง 2026-08-04)
      try {
        const { data: sessionRow, error: sessionErr } = await supa.from('ci_sessions').insert({
          owner_email:        email,
          owner_type:         ctx.ownerType,
          account_id:         ctx.accountGuid || null,
          account_name:       ctx.accountName || null,
          visited_at:         ctx.checkinCache?.checked_in_at || nowIso,
          duration_secs:      ctx.secs,
          transcript:         segments?.length ? segments : null,
          transcript_source:  'unknown',
          rep_lat:            ctx.checkinCache?.rep_lat ?? null,
          rep_lng:            ctx.checkinCache?.rep_lng ?? null,
          checked_in_at:      ctx.checkinCache?.checked_in_at || null,
          ...analysisFields
        }).select('id').single();
        if (sessionErr) {
          console.warn('[CI] ci_sessions insert:', sessionErr.message);
          _toast('บันทึกผลวิเคราะห์ไม่สำเร็จ: ' + sessionErr.message);
        } else if (sessionRow) {
          _sessionId = sessionRow.id;
          ctx.sessionId = sessionRow.id;
          saved = true;
        }
      } catch(e) {
        console.warn('[CI] ci_sessions unavailable:', e.message);
        _toast('บันทึกผลวิเคราะห์ไม่สำเร็จ: ' + e.message);
      }
    }

    // v951: เคลียร์เช็คอิน cache เฉพาะเมื่อ global ยังชี้ visit เดียวกับที่เพิ่งเซฟจบ
    // — ถ้า user ไปเช็คอินร้านใหม่ระหว่างรอ AI ห้ามล้างของเขา
    if (saved && _checkinCache && _checkinCache === ctx.checkinCache) {
      _checkinCache = null;
      try { localStorage.removeItem('ci_checkin_cache'); } catch(_) {}
    }

    // skill log
    if (skillData?.skills?.length) {
      const rows = skillData.skills.map(s => ({
        kam_email: email, account_id: ctx.accountGuid || null,
        session_date: today, skill_code: s.code,
        score: s.score,
        evidence_summary: s.evidence || s.evidence_summary || '',
        ci_session_id: ctx.sessionId || null
      }));
      const { error } = await supa.from('kam_skill_log').insert(rows);
      if (error) console.warn('[CI] kam_skill_log insert error:', error.message);
    }

    // echo_skill_observations
    if (skillData?.skills?.length) {
      try {
        let _userId = null;
        try {
          const _sk = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.includes('-auth-token'));
          if (_sk) { const _ss = JSON.parse(localStorage.getItem(_sk)); _userId = _ss?.user?.id || null; }
        } catch(_) {}
        if (_userId) {
          // v_echog1: DB enum รับแค่ 4 ค่านี้ — LLM เคยคืนค่านอก enum แล้วทำ batch
          // insert ล่มทั้งชุดเงียบๆ (ทุก skill หาย ไม่ใช่แค่ตัวที่ผิด) → map เป็น
          // not_observed + warn แทน
          const _VALID_SCORES = ['pass', 'developing', 'not_observed', 'not_applicable'];
          const obsRows = skillData.skills.map(s => ({
            session_id:    ctx.sessionId || null,
            user_id:       _userId,
            skill_code:    ECHO_TO_SKILL_CODE[s.code] || s.code,
            echo_code:     s.code,
            ai_score:      _VALID_SCORES.includes(s.score) ? s.score
                             : (console.warn('[CI] off-enum ai_score:', s.code, s.score), 'not_observed'),
            evidence:      s.evidence || s.evidence_summary || null,
            coaching_note: s.coaching_note || null,
            gap:           s.gap || null,
            observed_at:   nowIso,
          }));
          const { error: obsErr } = await supa.from('echo_skill_observations').insert(obsRows);
          if (obsErr) console.warn('[CI] echo_skill_observations insert:', obsErr.message);
        }
      } catch(e) { console.warn('[CI] echo_skill_observations unavailable:', e.message); }
    }

    // kam_visits snapshot
    if (ctx.accountGuid) {
      const { error: visitError } = await supa.from('kam_visits').upsert({
        kam_email: email, account_id: ctx.accountGuid,
        ci_skill_scores: skillData, ci_customer_signals: intelData,
        ci_next_actions: intelData?.next_actions || [], ci_mode: 'echo',
        ci_created_at: nowIso, last_seen: nowIso, modes: ['echo']
      }, { onConflict: 'kam_email,account_id' });
      if (visitError) console.warn('[CI] kam_visits upsert error:', visitError.message);
    }

    // localStorage echo visits dot
    if (ctx.accountGuid) {
      try {
        const _echoKey = 'ciq_echo_visits';
        const _store = JSON.parse(localStorage.getItem(_echoKey) || '{}');
        const _eKey = email + '::' + ctx.accountGuid;
        _store[_eKey] = { ts: Date.now(), count: (_store[_eKey]?.count || 0) + 1 };
        const _cutoff = Date.now() - 30*24*60*60*1000;
        Object.keys(_store).forEach(k => { if (_store[k].ts < _cutoff) delete _store[k]; });
        localStorage.setItem(_echoKey, JSON.stringify(_store));
      } catch(e) { /* non-fatal */ }
    }
  }

  // ── Render result panels ───────────────────────────────────────────────────
  // v712: update single panel without full re-render
  function _updatePanel(idx) {
    if (!_lastResult) return;
    const { skillData, intelData, segments, summaryData } = _lastResult;
    const _tone = summaryData?.tone || null;
    const _summaryText = summaryData?.transcript_summary || null;
    if (idx === 0) {
      const el = document.getElementById('ci-p0');
      if (el) el.innerHTML = _overviewPanel(_summaryText, _tone, segments, summaryData);
    } else if (idx === 1) {
      const el = document.getElementById('ci-p1');
      if (el) el.innerHTML = skillData ? _skillsPanel(skillData) : _loadingPanel('กำลังประเมินทักษะ...');
    } else if (idx === 2) {
      const el = document.getElementById('ci-p2');
      if (el) el.innerHTML = intelData ? _customerPanel(intelData) : _loadingPanel('กำลังวิเคราะห์ข้อมูลลูกค้า...');
    }
  }

  function _loadingPanel(msg, isDone) {
    // isDone=true → แสดง "ไม่มีข้อมูล" แทน spinner
    if (isDone) {
      return '<div style="padding:24px;text-align:center;font-size:var(--text-base);color:#AEAEB2">ไม่มีข้อมูลในส่วนนี้</div>';
    }
    return '<div style="padding:32px 24px;display:flex;flex-direction:column;align-items:center;gap:12px">'
      + '<div style="display:flex;gap:5px;align-items:center">'
      + '<span style="width:5px;height:5px;border-radius:50%;background:#AEAEB2;animation:ci-dot-pulse 1.2s ease-in-out infinite"></span>'
      + '<span style="width:5px;height:5px;border-radius:50%;background:#AEAEB2;animation:ci-dot-pulse 1.2s ease-in-out .2s infinite"></span>'
      + '<span style="width:5px;height:5px;border-radius:50%;background:#AEAEB2;animation:ci-dot-pulse 1.2s ease-in-out .4s infinite"></span>'
      + '</div>'
      + '<div style="font-size:var(--text-md);color:#AEAEB2;letter-spacing:.04em">' + (msg||'กำลังประมวลผล...') + '</div>'
      + '</div>';
  }

  function _renderResult() {
    // v709: pipeline result — segments + summaryData added
    const { skillData, intelData, transcriptSummary, toneSignals, segments, summaryData } = _lastResult;
    // tone comes from summaryData.tone (pipeline) or toneSignals (legacy)
    const _tone = summaryData?.tone || toneSignals || null;
    // summary text from summaryData or transcriptSummary
    const _summaryText = summaryData?.transcript_summary || transcriptSummary || null;

    // Guard: no speech
    if (skillData?.no_speech) {
      const noSpeechHTML = `
        <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;gap:16px">
          <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
            <line x1="1" y1="1" x2="23" y2="23"/><path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6"/>
            <path d="M17 16.95A7 7 0 0 1 5 12v-2m14 0v2a7 7 0 0 1-.11 1.23"/>
            <line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>
          </svg>
          <div style="font-size:var(--text-lg2);font-weight:var(--fw-semi);color:var(--tx,#1C1C1E)">ไม่พบเสียงการสนทนา</div>
          <div style="font-size:var(--text-base);color:var(--tx2,#636366);line-height:1.6;max-width:260px">
            Audio ที่ส่งไปไม่มีเสียงพูด หรือเสียงเบาเกินไป<br>กรุณาลองบันทึกใหม่ และตรวจสอบว่าไมโครโฟนทำงานได้
          </div>
        </div>`;
      document.getElementById('ci-p0').innerHTML = noSpeechHTML;
      document.getElementById('ci-p1').innerHTML = noSpeechHTML;
      document.getElementById('ci-p2').innerHTML = noSpeechHTML;
      const tlDiv = document.getElementById('ci-tl-actions');
      if (tlDiv) tlDiv.style.display = 'none';
      return;
    }

    // v712: progressive — handle null states while pipeline continues
    document.getElementById('ci-p0').innerHTML = _overviewPanel(_summaryText, _tone, segments, summaryData);
    document.getElementById('ci-p1').innerHTML = skillData ? _skillsPanel(skillData) : _loadingPanel('กำลังประเมินทักษะ...');
    document.getElementById('ci-p2').innerHTML = intelData ? _customerPanel(intelData) : _loadingPanel('กำลังวิเคราะห์ข้อมูลลูกค้า...');
    const tlDiv = document.getElementById('ci-tl-actions');
    if (tlDiv) tlDiv.style.display = (_canDebrief() && !_isOwnRecording) ? 'flex' : 'none';
  }

  // ── v709: "บทสนทนา" panel — transcript segments + tone + summary ────────────
  function _overviewPanel(summary, tone, segments, summaryData) {
    const thaiConf = { high:'มั่นใจ', medium:'ปานกลาง', low:'ยังไม่มั่นใจ', not_applicable:'—', n_a:'—', na:'—' };
    const thaiEng  = { increasing:'ดีขึ้น', stable:'คงที่', declining:'ลดลง', not_applicable:'—', n_a:'—', na:'—' };

    // Tone & Energy
    let toneHtml = '';
    if (tone) {
      const _conf = tone.rep_confidence;
      const _eng  = tone.customer_engagement;
      const cConf = _conf==='high'?'#1F8A43':_conf==='medium'?'#B26A00':(_conf==='low'?'#C73E3E':'#8E8E93');
      const cEng  = _eng==='increasing'?'#1F8A43':_eng==='stable'?'#B26A00':(_eng==='declining'?'#C73E3E':'#8E8E93');
      const confTxt = thaiConf[_conf] || '—';
      const engTxt  = thaiEng[_eng]   || '—';
      const bothNA = (!_conf || _conf==='not_applicable') && (!_eng || _eng==='not_applicable');
      if (!bothNA) {
        toneHtml = `<div class="sd2-lbl">Tone &amp; Energy</div>
<div class="sd2-tone">
  <div class="sd2-tcard"><div class="k">Confidence</div><div class="v" style="color:${cConf}">${confTxt}</div><div class="n">${tone.rep_confidence_note||''}</div></div>
  <div class="sd2-tcard"><div class="k">Engagement</div><div class="v" style="color:${cEng}">${engTxt}</div><div class="n">${tone.customer_engagement_note||''}</div></div>
</div>`;
      }
    }

    // Summary
    const summaryHtml = summary
      ? `<div class="sd2-lbl">สรุปบทสนทนา</div><div class="sd2-sum">${summary}</div>` : '';

    // v709: Transcript segments — ground truth แทน key_moments
    let transcriptHtml = '';
    if (segments && segments.length) {
      const speakerColor = (sp) => {
        if (!sp) return '#636366';
        const s = sp.toLowerCase();
        if (s === 'sales') return '#FF385C';
        if (s.startsWith('ลูกค้า')) return '#1F8A43';
        return '#636366';
      };
      const rows = segments.map(seg => {
        const color = speakerColor(seg.speaker);
        const ts = seg.ts ? `<span style="font-family:'IBM Plex Mono',monospace;font-size:var(--text-xs);color:#AEAEB2;margin-right:6px;flex-shrink:0">${seg.ts}</span>` : '';
        const spk = seg.speaker ? `<span style="font-size:var(--text-xs);font-weight:var(--fw-semi);color:${color};margin-right:6px;flex-shrink:0;text-transform:uppercase;letter-spacing:.04em">${seg.speaker}</span>` : '';
        return `<div style="display:flex;align-items:baseline;gap:0;padding:7px 0;border-bottom:0.5px solid rgba(0,0,0,.06)">
          <div style="display:flex;align-items:baseline;gap:0;flex-shrink:0;width:120px">${ts}${spk}</div>
          <div style="font-size:var(--text-base);color:#1C1C1E;line-height:1.6;flex:1">${seg.text||''}</div>
        </div>`;
      }).join('');
      transcriptHtml = `<div class="sd2-lbl">บทสนทนา · ${segments.length} segments</div>
<div style="margin-bottom:8px">${rows}</div>`;
    }

    // v712: notes format (Google Meet style) — แสดงแทน transcript ยาวๆ
    let notesHtml = '';
    const notes = summaryData?.notes || [];
    if (notes.length) {
      notesHtml = '<div class="sd2-lbl">บันทึกการสนทนา</div>';
      notesHtml += notes.map(n => {
        const bullets = (n.bullets||[]).map(b =>
          '<div style="display:flex;gap:8px;padding:4px 0;font-size:var(--text-base);color:#1C1C1E;line-height:1.6">'
          + '<span style="color:#AEAEB2;flex-shrink:0">•</span><span>' + b + '</span></div>'
        ).join('');
        return '<div style="margin-bottom:14px">'
          + (n.heading ? '<div style="font-size:var(--text-md);font-weight:var(--fw-semi);color:#636366;text-transform:uppercase;letter-spacing:.06em;margin-bottom:6px">' + n.heading + '</div>' : '')
          + bullets + '</div>';
      }).join('');
    } else if (segments && segments.length) {
      // notes ว่าง (session เก่า / summarize fail) — fallback แสดง transcript segments แทน
      // ไม่ต้องเช็ค !summaryData เพราะ session เก่ามี summaryData แต่ไม่มี notes field
      notesHtml = transcriptHtml;
      transcriptHtml = ''; // ป้องกัน duplicate
    } else if (!summaryData) {
      // ไม่มีทั้ง notes, segments, summaryData — session ยังไม่ได้ analyze หรือ fail
      notesHtml = _loadingPanel('ยังไม่มีข้อมูล', true);
    }

    // customer_said — สิ่งที่ลูกค้าบอก
    let customerSaidHtml = '';
    const customerSaid = summaryData?.customer_said || [];
    if (customerSaid.length) {
      customerSaidHtml = '<div class="sd2-lbl">ลูกค้าบอกว่า</div>';
      customerSaidHtml += customerSaid.map(c =>
        '<div style="padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,.06)">'
        + '<div style="font-size:var(--text-base);color:#1C1C1E;line-height:1.6;margin-bottom:2px">' + (c.point||'') + '</div>'
        + (c.quote ? '<div class="sd2-sev">&ldquo;' + c.quote + '&rdquo;'
          + (c.ts ? ' <span style="font-family:var(--mono);font-size:var(--text-sm);color:#8E8E93">' + c.ts + '</span>' : '')
          + '</div>' : '')
        + '</div>'
      ).join('');
    }

    return (toneHtml + summaryHtml + notesHtml + customerSaidHtml)
      || _loadingPanel('ยังไม่มีข้อมูล', true);
  }

  function _skillsPanel(d) {
    const shortBanner = (d?._short_transcript)
      ? `<div style="display:flex;align-items:flex-start;gap:10px;padding:12px 14px;background:rgba(255,149,0,.08);border-radius:var(--r-card);margin-bottom:16px;border:0.5px solid rgba(255,149,0,.2)">
          <div style="flex-shrink:0;display:flex;align-items:center;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--warning,#FF9500)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg></div>
          <div>
            <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:#FF9500;margin-bottom:2px">Transcript สั้น (${d._word_count||'?'} คำ)</div>
            <div style="font-size:var(--text-sm);color:var(--tx2,#636366);line-height:1.5">Skill analysis ต้องการอย่างน้อย 80 คำ — บันทึกนานขึ้นเพื่อผลที่แม่นยำกว่านี้</div>
          </div>
        </div>`
      : '';

    // v606: ลบ PIPC progress bar ออก — A01_PIPC เป็น skill หนึ่งใน rows อยู่แล้ว
    // ลบ session_summary ("สรุปทักษะ") ออก — อยู่ใน tab บทสนทนาแล้ว

    const summary = d?.session_summary
      ? `<div class="sd2-lbl">สรุปทักษะ</div><div class="sd2-sum" style="margin-bottom:6px">${d.session_summary}</div>`
      : '';

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

    return shortBanner + summary + (rows || `<div style="padding:24px;text-align:center;font-size:var(--text-base);color:#AEAEB2">ยังไม่มีการประเมินทักษะ</div>`);
  }

  // ── หน้า "ลูกค้า" (v_echor2 2026-08-08) ───────────────────────────────────
  // เดิมเรียง needs → unknowns → progress → OCPB → Next Steps = ต้องอ่าน 5 การ์ด
  // กับ 4 บล็อกก่อนจะรู้ว่า "แล้วต้องทำอะไร" · rep เปิดอ่านเพื่อหาว่าทำอะไรต่อ
  // TL เปิดอ่านเพื่อหาว่าลูกน้องพลาดตรงไหน (= ช่องว่าง OCPB ที่ยังไม่ได้ถาม)
  // ลำดับใหม่จึงเป็น: สรุปหนึ่งบรรทัด → ทำอะไรต่อ → ช่องว่าง OCPB → รายละเอียดพับเก็บ
  //
  // รองรับข้อมูลเก่า: session ที่วิเคราะห์ก่อนหน้านี้ไม่มี headline/need_id/priority
  // ทุกส่วนต้องยุบเงียบๆ ไม่พัง และ needs เก่าที่ยังมี suggested_action ติดมาก็ยัง
  // แสดงในรายละเอียด (ของใหม่ไม่มีแล้ว เพราะย้ายไปรวมที่ "ทำอะไรต่อ" ที่เดียว)
  function _customerPanel(d) {
    const DIMS = [
      ['O','Operation ของร้าน'],
      ['C','ซัพเดิม · ราคา · สินค้า'],
      ['P','Payment · Billing'],
      ['B','Business Plan'],
    ];
    const ST = {
      answered:        ['ได้ข้อมูล','ok'],
      asked_no_answer: ['ถามแล้ว ไม่ได้คำตอบ','dev'],
      not_asked:       ['ยังไม่แตะ','no'],
    };
    // กรอง null/undefined ทิ้งทุกลิสต์ตั้งแต่ต้นทาง — โมเดลเคยคาย element ว่างมา
    // แล้วหน้าทั้งหน้าพังทั้งที่ข้อมูลที่เหลือใช้ได้ (harness จับได้ 2026-08-08)
    const arr    = v => (Array.isArray(v) ? v.filter(Boolean) : []);
    const facts  = arr(d?.ocpb_facts);
    const status = d?.ocpb_status || {};
    const needs  = arr(d?.needs);
    const acts   = arr(d?.next_actions);
    const esc = v => String(v == null ? '' : v);

    // ── ชั้น 1: สรุปหนึ่งบรรทัด ────────────────────────────────────────────
    // ไม่มี headline (แถวเก่า) → ปั้นจาก pain ที่แรงที่สุด แล้วค่อย need ข้อแรก
    let headline = (typeof d?.headline === 'string' && d.headline.trim()) ? d.headline.trim() : '';
    if (!headline) {
      const pain = facts.find(f => f && f.tag === 'pain_high') || facts.find(f => f && f.tag === 'pain_medium');
      if (pain && pain.summary) headline = String(pain.summary);
      else if (needs.length && needs[0].need) headline = String(needs[0].need);
    }
    const headlineHtml = headline
      ? `<div style="margin:2px 0 16px;padding:14px 16px;border-radius:var(--r-lg);background:rgba(83,74,183,.06);border:0.5px solid rgba(83,74,183,.18)">
           <div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:#534AB7;margin-bottom:6px">สรุป</div>
           <div style="font-size:var(--text-xl);font-weight:var(--fw-semi);color:#1C1C1E;line-height:1.55">${esc(headline)}</div>
         </div>` : '';

    // ── ชั้น 2: ทำอะไรต่อ — 3 การ์ดแรก อ่านจบใน 5 วินาที ────────────────────
    const URG = {
      '3_days':    ['ภายใน 3 วัน',  '#C73E3E', 'rgba(255,59,48,.08)'],
      'this_week': ['สัปดาห์นี้',    '#B26A00', 'rgba(255,149,0,.08)'],
    };
    const needById = {};
    needs.forEach(n => { if (n && n.id) needById[n.id] = n; });
    const actsSorted = acts.slice().sort((a, b) => (a?.priority || 99) - (b?.priority || 99));
    const TOP_ACTS = 3;
    const actCard = (a, i) => {
      const u = URG[a?.urgency] || ['visit ถัดไป', '#636366', 'rgba(0,0,0,.05)'];
      const linked = a?.need_id ? needById[a.need_id] : null;
      const why = linked?.need ? `เพราะลูกค้าติดเรื่อง: ${linked.need}` : (a?.reason || '');
      return `<div style="display:flex;gap:11px;padding:13px 0;border-bottom:0.5px solid #ECECF0">
        <span style="flex-shrink:0;width:22px;height:22px;border-radius:50%;background:#534AB7;color:#fff;font-size:var(--text-xs);font-weight:var(--fw-semi);display:flex;align-items:center;justify-content:center;font-variant-numeric:tabular-nums">${i + 1}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:var(--text-lg);font-weight:var(--fw-semi);color:#1C1C1E;line-height:1.55">${esc(a?.action)}</div>
          ${why ? `<div style="font-size:13.5px;color:#636366;line-height:1.6;margin-top:4px">${esc(why)}</div>` : ''}
          <div style="margin-top:6px;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
            <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);padding:2px 8px;border-radius:var(--r-sm);color:${u[1]};background:${u[2]}">${u[0]}</span>
            ${a?.owner ? `<span style="font-size:var(--text-2xs);color:#8E8E93">${esc(a.owner)}</span>` : ''}
          </div>
        </div>
      </div>`;
    };
    const restActs = actsSorted.slice(TOP_ACTS);
    const actsHtml = actsSorted.length
      ? `<div class="sd2-lbl">ทำอะไรต่อ</div>` +
        actsSorted.slice(0, TOP_ACTS).map(actCard).join('') +
        (restActs.length
          ? `<details style="margin-top:2px"><summary style="cursor:pointer;padding:10px 0;font-size:var(--text-base);color:#534AB7;-webkit-tap-highlight-color:transparent">อีก ${restActs.length} ข้อ</summary>${restActs.map((a, i) => actCard(a, i + TOP_ACTS)).join('')}</details>`
          : '')
      : '';

    // ── ชั้น 3: แถบ OCPB 4 จุด — เห็นช่องว่างใน 1 วินาที ────────────────────
    const DOT_COLOR = { answered: '#34C759', asked_no_answer: '#FF9500', not_asked: '#D1D1D6' };
    const dimState = {};
    DIMS.forEach(([dim]) => {
      dimState[dim] = status[dim] || (facts.some(f => f && f.dim === dim) ? 'answered' : 'not_asked');
    });
    const gapCount = DIMS.filter(([dim]) => dimState[dim] === 'not_asked').length;
    const stripHtml = `<div class="sd2-lbl">เก็บข้อมูลครบแค่ไหน (OCPB)</div>
      <div style="display:flex;gap:8px;align-items:stretch;margin-bottom:4px">
        ${DIMS.map(([dim, label]) => `
          <div style="flex:1;text-align:center;padding:10px 4px;border-radius:var(--r-card);border:0.5px solid rgba(0,0,0,.07);background:rgba(0,0,0,.02)">
            <div style="width:9px;height:9px;border-radius:50%;background:${DOT_COLOR[dimState[dim]] || DOT_COLOR.not_asked};margin:0 auto 6px"></div>
            <div style="font-size:var(--text-md);font-weight:var(--fw-semi);color:#1C1C1E">${dim}</div>
            <div style="font-size:var(--text-3xs);color:#8E8E93;margin-top:2px;line-height:1.35">${esc(label).split(' · ')[0]}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:var(--text-sm);color:#8E8E93;padding-bottom:2px">${
        gapCount ? `ยังไม่ได้ถาม ${gapCount} มิติ — เป็นการบ้าน visit หน้า` : 'ถามครบทั้ง 4 มิติแล้ว'
      }</div>`;

    // ── ชั้น 4: รายละเอียด พับเก็บทั้งหมด ──────────────────────────────────
    const NEED_TYPE = {
      product:'สินค้า', price:'ราคา', delivery:'การส่ง', credit:'เครดิต',
      quality:'คุณภาพ', service:'บริการ', operations:'ปฏิบัติการ', other:'อื่นๆ'
    };
    const needsHtml = needs.map(n => {
      const typeChip = `<span class="sd2-sstate dev" style="color:#534AB7;background:rgba(83,74,183,.08)">${NEED_TYPE[n.type] || n.type || '—'}</span>`;
      const stChip = n.status === 'addressed'
        ? `<span class="sd2-sstate ok">ตอบสนองแล้ว</span>`
        : `<span class="sd2-sstate dev">ค้างอยู่</span>`;
      const srcChip = n.intensity === 'implied'
        ? `<span class="sd2-sstate no" title="${esc(n.inferred_from).replace(/"/g,'&quot;')}">อ่านระหว่างบรรทัด</span>`
        : `<span class="sd2-sstate no">ลูกค้าพูดเอง</span>`;
      const quote = (n.quote && String(n.quote).trim())
        ? `<div class="sd2-sev">&ldquo;${esc(n.quote)}&rdquo;</div>` : '';
      const imp = n.implication
        ? `<div style="font-size:13.5px;color:#48484A;line-height:1.65;margin-top:5px">${esc(n.implication)}</div>` : '';
      // แถวเก่าเท่านั้น — ของใหม่ย้ายไปอยู่ใน "ทำอะไรต่อ" ที่เดียวแล้ว
      const legacyAct = n.suggested_action
        ? `<div style="font-size:var(--text-base);color:#534AB7;line-height:1.65;margin-top:5px;padding-left:10px;border-left:2px solid rgba(83,74,183,.3)">เกมที่ควรเดิน: ${esc(n.suggested_action)}</div>` : '';
      return `<div style="padding:12px 0;border-bottom:0.5px solid #ECECF0">
        <div style="display:flex;align-items:flex-start;gap:8px">
          <div style="flex:1;font-size:var(--text-lg);font-weight:var(--fw-semi);color:#1C1C1E;line-height:1.6">${esc(n.need) || '-'}</div>
          <div style="display:flex;gap:5px;flex-shrink:0;flex-wrap:wrap;justify-content:flex-end">${typeChip}${stChip}</div>
        </div>
        <div style="margin-top:3px">${srcChip}</div>
        ${quote}${imp}${legacyAct}
      </div>`;
    }).join('');

    const unknowns = Array.isArray(d?.unknowns) ? d.unknowns : [];
    const unknownsHtml = unknowns.map((q, i) =>
      `<div class="sd2-next"><span class="num">${String(i+1).padStart(2,'0')}</span><div>${esc(q)}</div></div>`
    ).join('');

    const prog = Array.isArray(d?.progress_vs_last) ? d.progress_vs_last : [];
    const PROG_V = {
      'คืบหน้า':   ['คืบหน้า','ok'],
      'ถอยหลัง':   ['ถอยหลัง','no'],
      'ค้างที่เดิม': ['ค้างที่เดิม','dev'],
    };
    const progHtml = prog.map(p => {
      const v = PROG_V[p.verdict] || [p.verdict || '—', 'dev'];
      return `<div style="padding:10px 0;border-bottom:0.5px solid #ECECF0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:var(--text-lg);font-weight:var(--fw-semi);color:#1C1C1E">${esc(p.topic) || '-'}</span>
          <span class="sd2-sstate ${v[1]}">${v[0]}</span>
        </div>
        <div style="font-size:13.5px;color:#48484A;line-height:1.65;margin-top:4px">ครั้งก่อน: ${esc(p.before) || '—'}<br>รอบนี้: ${esc(p.now) || '—'}</div>
      </div>`;
    }).join('');

    const blocks = DIMS.map(([dim, label]) => {
      const fs = facts.filter(f => f && f.dim === dim);
      const st = ST[dimState[dim]] || ST.not_asked;
      if (!fs.length && dimState[dim] === 'not_asked') {
        return `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;padding:11px 0;border-bottom:0.5px solid #ECECF0">
          <span style="font-size:var(--text-base);color:#AEAEB2">${dim} — ${label}</span>
          <span class="sd2-sstate no">${st[0]}</span>
        </div>`;
      }
      const rows = fs.map(f => {
        const quote = (f.quote && String(f.quote).trim())
          ? `<div class="sd2-sev">&ldquo;${esc(f.quote)}&rdquo;${f.ts ? ` <span style="font-family:var(--mono,'IBM Plex Mono','Noto Sans Thai',monospace);font-size:var(--text-sm);color:#8E8E93">${esc(f.ts)}</span>` : ''}</div>`
          : '';
        return `<div style="padding:8px 0 8px 2px">
          <div style="font-size:var(--text-lg);color:#1C1C1E;line-height:1.7">${esc(f.summary) || '-'}</div>
          ${quote}
        </div>`;
      }).join('');
      const empty = fs.length ? '' :
        `<div style="font-size:12.5px;color:#8E8E93;padding:6px 0 6px 2px">rep ถามแล้ว แต่ยังไม่ได้คำตอบจากลูกค้า</div>`;
      return `<div style="padding:11px 0;border-bottom:0.5px solid #ECECF0">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <span style="font-size:var(--text-lg);font-weight:var(--fw-semi);color:#1C1C1E">${dim} — ${label}</span>
          <span class="sd2-sstate ${st[1]}">${st[0]}</span>
        </div>
        ${rows}${empty}
      </div>`;
    }).join('');

    const fold = (title, count, inner) => inner
      ? `<details style="border-top:0.5px solid #ECECF0">
           <summary style="cursor:pointer;padding:13px 0;font-size:var(--text-lg);font-weight:var(--fw-medium);color:#1C1C1E;-webkit-tap-highlight-color:transparent;display:flex;justify-content:space-between;align-items:center">
             <span>${title}</span><span style="font-size:var(--text-base);color:#8E8E93;font-weight:var(--fw-regular)">${count}</span>
           </summary>
           <div style="padding-bottom:8px">${inner}</div>
         </details>` : '';

    const details =
      fold('สิ่งที่ควรถามครั้งหน้า', unknowns.length + ' ข้อ', unknownsHtml) +
      fold('ความต้องการลูกค้า', needs.length + ' ข้อ', needsHtml) +
      fold('ความคืบหน้าจากครั้งก่อน', prog.length + ' เรื่อง', progHtml) +
      fold('ข้อมูล OCPB ที่เก็บได้', facts.length + ' จุด', blocks);

    const anything = headlineHtml || actsHtml || facts.length || needs.length || unknowns.length || prog.length;
    if (!anything) {
      return `<div style="padding:24px;text-align:center;font-size:var(--text-base);color:#AEAEB2">ยังไม่มีข้อมูลลูกค้าจาก session นี้</div>`;
    }
    return headlineHtml + actsHtml + stripHtml + details;
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
        + allM.map(x => `<div style="font-size:var(--text-lg);color:#1C1C1E;line-height:1.7;padding:8px 0;border-bottom:0.5px solid #ECECF0">${x}</div>`).join('')
      : '';
    return (summaryHtml + momentsHtml)
      || `<div style="padding:24px;text-align:center;font-size:var(--text-base);color:#AEAEB2">ยังไม่มี transcript จาก session นี้</div>`;
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
.db-title { font-size:var(--text-lg2);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.db-role-chip {
  font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;
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
.db-skill-name { font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);letter-spacing:-.02em;flex:1; }
.db-ai-badge {
  font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.08em;text-transform:uppercase;
  font-family:'Noto Sans Thai',sans-serif;
  padding:2px 7px;border-radius:100px;flex-shrink:0;
}
.db-ai-badge.pass { background:rgba(52,199,89,.12);color:#1a7a38; }
.db-ai-badge.dev  { background:rgba(255,149,0,.12);color:#a05800; }
.db-ai-badge.no   { background:rgba(0,0,0,.06);color:#888; }
.db-evidence { font-size:var(--text-sm);color:var(--n-400,#636366);line-height:1.5;margin-bottom:8px; }
.db-override-row { display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap; }
.db-pill {
  padding:5px 12px;border-radius:100px;border:0.5px solid rgba(0,0,0,.12);
  font-size:var(--text-sm);font-weight:var(--fw-medium);font-family:'Noto Sans Thai',sans-serif;
  letter-spacing:.04em;cursor:pointer;background:rgba(0,0,0,.03);
  color:var(--n-400,#636366);transition:background 100ms,color 100ms,border-color 100ms;
}
.db-pill.sel-pass   { background:rgba(52,199,89,.12);color:#1a7a38;border-color:rgba(52,199,89,.3); }
.db-pill.sel-dev    { background:rgba(255,149,0,.12);color:#a05800;border-color:rgba(255,149,0,.3); }
.db-pill.sel-no     { background:rgba(0,0,0,.07);color:#555;border-color:rgba(0,0,0,.18); }
.db-pill.sel-na     { background:rgba(0,0,0,.04);color:#aaa;border-color:rgba(0,0,0,.1); }
.db-note {
  width:100%;box-sizing:border-box;
  border:0.5px solid rgba(0,0,0,.14);border-radius:var(--r-md);
  padding:9px 12px;font-size:var(--text-md);font-family:'Noto Sans Thai',sans-serif;
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
  flex:1;padding:13px;border-radius:var(--r-lg);border:none;
  font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg2);
  font-weight:var(--fw-medium);letter-spacing:-.02em;cursor:pointer;
  transition:opacity 60ms,transform 60ms;
}
.db-btn:active { transform:scale(.97);opacity:.85; }
.db-btn-primary { background:#FF385C;color:var(--tk-text-primary); }
.db-btn-primary:hover { background:#e02d50; }
.db-btn-ghost { background:rgba(0,0,0,.045);color:var(--n-400,#636366); }
.db-saving { text-align:center;font-size:var(--text-md);color:var(--n-200,#AEAEB2);padding:4px 0; }
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
.hist-title { font-size:var(--text-lg2);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.hist-close { font-size:var(--text-lg2);color:var(--n-400,#636366);cursor:pointer;padding:4px; }
.hist-body { flex:1;overflow-y:auto;padding:12px 24px 24px;-webkit-overflow-scrolling:touch; }
.hist-body::-webkit-scrollbar { display:none; }
.hist-empty { text-align:center;padding:48px 0;font-size:var(--text-base);color:var(--n-200,#AEAEB2); }
.hist-session {
  background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:var(--r-lg);border:0.5px solid rgba(255,255,255,.55);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);
  padding:14px 16px;margin-bottom:10px;
}
.hist-session-head { display:flex;align-items:center;justify-content:space-between;margin-bottom:8px; }
.hist-date { font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);letter-spacing:-.01em; }
.hist-rep  { font-size:var(--text-xs);color:var(--n-400,#636366);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.03em; }
.hist-skills { display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px; }
.hist-skill-dot {
  display:flex;align-items:center;gap:4px;
  font-size:var(--text-xs);font-family:'Noto Sans Thai',sans-serif;
  color:var(--n-400,#636366);letter-spacing:.03em;
}
.hsd { width:5px;height:5px;border-radius:50%;flex-shrink:0; }
.hsd.pass { background:#34C759; }
.hsd.dev  { background:#FF9500; }
.hsd.no   { background:#AEAEB2; }
.hist-coaching {
  font-size:var(--text-sm);color:var(--ac,#FF385C);font-style:italic;line-height:1.5;
  border-top:0.5px solid rgba(255,56,92,.12);padding-top:6px;margin-top:6px;
}
.hist-tl-note {
  font-size:var(--text-sm);color:#534AB7;font-style:italic;line-height:1.5;
  border-top:0.5px solid rgba(83,74,183,.12);padding-top:6px;margin-top:4px;
}
`;
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
.trend-title { font-size:var(--text-lg2);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);letter-spacing:-.02em; }
.trend-close { font-size:var(--text-lg2);color:var(--n-400,#636366);cursor:pointer;padding:4px; }
.trend-body { flex:1;overflow-y:auto;overflow-x:auto;padding:16px 24px 24px;-webkit-overflow-scrolling:touch; }
.trend-body::-webkit-scrollbar { display:none; }
.trend-rep-row { margin-bottom:20px; }
.trend-rep-name { font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--n-900,#1C1C1E);margin-bottom:8px;letter-spacing:-.01em; }
.trend-grid { display:flex;flex-wrap:wrap;gap:5px; }
.trend-cell {
  width:44px;padding:5px 4px;border-radius:var(--r-7);text-align:center;
  font-size:var(--text-2xs);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em;
}
.trend-cell-code { font-weight:var(--fw-medium);margin-bottom:2px;line-height:1.2; }
.trend-cell-score { font-size:var(--text-3xs);opacity:.75; }
.trend-cell.pass { background:rgba(52,199,89,.14);color:#1a7a38; }
.trend-cell.dev  { background:rgba(255,149,0,.14);color:#a05800; }
.trend-cell.no   { background:rgba(0,0,0,.05);color:#888; }
.trend-cell.none { background:rgba(0,0,0,.03);color:#ccc; }
.trend-legend { display:flex;gap:14px;margin-bottom:16px; }
.tl-dot { width:8px;height:8px;border-radius:50%;display:inline-block;margin-right:4px; }
.tl-legend-item { display:flex;align-items:center;font-size:var(--text-xs);color:var(--n-400,#636366); }
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
        <div style="text-align:center;padding:48px 0;font-size:var(--text-base);color:#AEAEB2">กำลังโหลด...</div>
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
      body.innerHTML = '<div style="text-align:center;padding:48px 0;font-size:var(--text-base);color:#AEAEB2">ยังไม่มีข้อมูล</div>';
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
      const name = _echoRep(email);
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

  // ── ช่วงเวลาของแท็บประวัติ ────────────────────────────────────────────────
  // v_echor2: เดิมมีสองหน้าจอ ("ผลการ visit" ของ TL กับ "ประวัติ") ที่ query
  // ci_sessions คนละครั้งและ dedupe ไม่เหมือนกัน → ตัวเลขสองหน้าไม่ตรงกัน
  // ตอนนี้เหลือหน้าเดียวคือแท็บประวัติ · ช่วงเวลาใช้ helper ตัวนี้ตัวเดียวทุก role
  // นิยามการนับ (บุชเคาะ): เช็คอิน = visit จริง · นับทั้งเช็คอินเปล่าและมีอัดเสียง
  // แยกตัวเลข — แยกด้วย pipeline_stage ('checked_in' = เปล่า, ที่เหลือ = มีเสียง)
  const HIST_PERIODS = [
    { key: 'today',   label: 'วันนี้' },
    { key: 'week',    label: 'สัปดาห์นี้' },
    { key: 'month',   label: 'เดือนนี้' },
    { key: 'quarter', label: 'ไตรมาสนี้' },
    { key: 'all',     label: 'ทั้งหมด' },
  ];

  function _histSince(period) {
    if (period === 'all') return null;
    const now = new Date();
    const d = new Date(now); d.setHours(0, 0, 0, 0);
    if (period === 'week') {
      // สัปดาห์เริ่มจันทร์ (convention เดิมของไฟล์)
      const dow = now.getDay() === 0 ? 6 : now.getDay() - 1;
      d.setDate(now.getDate() - dow);
    } else if (period === 'month') {
      return new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (period === 'quarter') {
      // calendar quarter = รอบ commission เป๊ะ (Q3 = ก.ค.–ก.ย.)
      return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
    }
    return d;
  }

  function _ensureHistCSS() {
    if (document.getElementById('ci-hist-style')) return;
    const s = document.createElement('style');
    s.id = 'ci-hist-style';
    // _buildHistoryCSS = คลาส .hist-* ที่ _renderLegacyHistory (fallback ตอน query
    // พัง) ใช้ · เดิมฉีดโดย sheet ประวัติเก่าที่ลบไปแล้ว fallback จึงไม่มีสไตล์
    s.textContent = _buildHistoryCSS() + `
.vd-pill {
  font-size:var(--text-sm);font-weight:var(--fw-medium);padding:5px 12px;border-radius:100px;
  border:0.5px solid rgba(0,0,0,.14);background:rgba(0,0,0,.04);color:var(--tx2,#636366);
  cursor:pointer;font-family:'Noto Sans Thai',sans-serif;-webkit-tap-highlight-color:transparent;
  transition:background .15s,color .15s,border-color .15s;
}
.vd-pill.on { background:var(--ac,#FF385C);border-color:var(--ac,#FF385C);color:#fff; }
.vd-cards { display:flex;gap:8px;margin-bottom:4px; }
.vd-card {
  flex:1;padding:12px 10px;border-radius:var(--r-lg);text-align:center;
  border:0.5px solid rgba(0,0,0,.07);background:rgba(0,0,0,.02);
}
.vd-card-num { font-size:var(--text-xl);font-weight:var(--fw-semi);color:var(--n-900,#1C1C1E);font-variant-numeric:tabular-nums; }
.vd-card-lbl { font-size:var(--text-2xs);color:var(--n-400,#636366);margin-top:2px;line-height:1.4; }
.vd-sec-hd {
  font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;
  color:var(--tx3,#AEAEB2);margin:16px 0 8px;
}
.vd-rep-row {
  display:flex;align-items:center;gap:8px;padding:8px 0;
  border-bottom:0.5px solid rgba(0,0,0,.05);font-size:var(--text-md);
}
.vd-rep-name { flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--n-900,#1C1C1E);font-weight:var(--fw-medium); }
.vd-rep-num { width:52px;text-align:right;font-variant-numeric:tabular-nums;color:var(--tx2,#636366);font-size:var(--text-sm);flex-shrink:0; }
.vd-rep-head { border-bottom:none;padding-bottom:2px; }
.vd-rep-head .vd-rep-num { font-size:var(--text-3xs);letter-spacing:.05em;color:var(--tx3,#AEAEB2);text-transform:uppercase; }
`;
    document.head.appendChild(s);
  }

  // co-visit ที่ยืนยันแล้ว — ci_sessions.covisit_verified อาจโดน RLS ตอน TL กด
  // ยืนยันแล้ว update ไม่เข้า covisit_events จึงเป็น source of truth · กรองด้วย
  // หน้าต่างเวลา ไม่ .in() ด้วย id หลายร้อยตัว (URL ยาวเกินจน request พัง)
  async function _histCovisitSet(sinceIso) {
    const out = new Set();
    try {
      let q = supa.from('covisit_events').select('session_id').eq('verified', true).limit(500);
      if (sinceIso) q = q.gte('checked_at', sinceIso);
      const { data } = await q;
      (data || []).forEach(e => out.add(e.session_id));
    } catch(_) {}
    return out;
  }

  // บล็อกสรุปหัวแท็บประวัติของ TL/admin — คิดจาก sessions ชุดเดียวกับที่แสดง
  // ข้างล่างเป๊ะๆ (dedupe แล้ว) เดิมแยก query กับหน้า "ผลการ visit" จึงนับไม่ตรงกัน
  function _histSummaryHtml(sessions, cvSet) {
    const isCk = s => s.pipeline_stage === 'checked_in';
    const isCv = s => !!(s.covisit_verified || cvSet.has(s.id));
    const total = sessions.length;
    const rec   = sessions.filter(s => !isCk(s)).length;
    const cv    = sessions.filter(isCv).length;

    const perRep = {};
    sessions.forEach(s => {
      const k = s.owner_email ? _echoRep(s.owner_email) : '—';
      if (!perRep[k]) perRep[k] = { total: 0, rec: 0, cv: 0 };
      perRep[k].total++;
      if (!isCk(s)) perRep[k].rec++;
      if (isCv(s)) perRep[k].cv++;
    });
    const repRows = Object.entries(perRep)
      .sort((a, b) => b[1].total - a[1].total)
      .map(([name, c]) => `<div class="vd-rep-row">
        <span class="vd-rep-name">${name}</span>
        <span class="vd-rep-num">${c.total}</span>
        <span class="vd-rep-num">${c.rec}</span>
        <span class="vd-rep-num">${c.cv}</span>
      </div>`).join('');

    return `
      <div class="vd-cards">
        <div class="vd-card"><div class="vd-card-num">${total}</div><div class="vd-card-lbl">เช็คอินทั้งหมด</div></div>
        <div class="vd-card"><div class="vd-card-num">${rec}</div><div class="vd-card-lbl">มีบันทึกเสียง<br>+วิเคราะห์</div></div>
        <div class="vd-card"><div class="vd-card-num">${cv}</div><div class="vd-card-lbl">co-visit<br>ยืนยันแล้ว</div></div>
      </div>
      <div class="vd-sec-hd">รายคน</div>
      <div class="vd-rep-row vd-rep-head">
        <span class="vd-rep-name"></span>
        <span class="vd-rep-num">เช็คอิน</span>
        <span class="vd-rep-num">มีเสียง</span>
        <span class="vd-rep-num">co-visit</span>
      </div>
      ${repRows}
      <div class="vd-sec-hd">รายการ visit</div>`;
  }


  // ── History filter ─────────────────────────────────────────────────────────
  function _histFilter(mode) {
    _histFilterMode = mode;
    HIST_PERIODS.forEach(p => {
      const btn = document.getElementById('ci-hf-' + p.key);
      if (btn) btn.classList.toggle('on', p.key === mode);
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
      // v_echor2: chips ช่วงเวลาใช้ได้ทุก role (เดิม rep ได้ 3 ตัว TL ไม่ได้เลย
      // จึงต้องมีหน้า "ผลการ visit" แยกไว้เลือกช่วง — ตอนนี้รวมมาที่นี่แล้ว)
      _ensureHistCSS();
      if (histPanel && !document.getElementById('ci-hist-filter-bar')) {
        const bar = document.createElement('div');
        bar.id = 'ci-hist-filter-bar';
        bar.style.cssText = 'padding:8px 0 4px;display:flex;gap:6px;flex-shrink:0;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;';
        bar.innerHTML = HIST_PERIODS.map(p =>
          `<button class="vd-pill${p.key === _histFilterMode ? ' on' : ''}" id="ci-hf-${p.key}" onclick="CI._histFilter('${p.key}')" style="flex-shrink:0">${p.label}</button>`
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
    _ensureHistCSS();
    body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">กำลังโหลด...</div>';
    const email = currentUserProfile?.email;
    if (!email) { body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">ไม่พบผู้ใช้งาน</div>'; return; }
    try {
      const isTL = _canDebrief();
      // v_echog1: + pipeline_stage — list ต้องแยกแถว "เช็คอินอย่างเดียว" ออกจาก
      // session ที่วิเคราะห์จบ (transcript/summary_data ไม่ดึงที่นี่ — หนักเกินสำหรับ
      // list 100 แถว detail view ดึงเองตอนเปิด)
      let q = supa.from('ci_sessions')
        .select('id,owner_email,account_id,account_name,visited_at,duration_secs,skill_scores,customer_intel,next_actions,transcript_summary,tone_signals,tl_reviewed_at,tl_reviewed_by,tl_note,covisit_verified,status,pipeline_stage')
        .order('visited_at', { ascending: false })
        .limit(isTL ? 100 : 50);

      // v_echor2: ช่วงเวลาใช้กับทุก role (เดิม TL ไม่มีตัวกรองเลย ต้องไปหน้าอื่น)
      const _since = _histSince(_histFilterMode);
      const sinceIso = _since ? _since.toISOString() : null;
      if (sinceIso) q = q.gte('visited_at', sinceIso);

      if (isTL) {
        // TL — ดู sessions ของทุกคนในทีม (ใช้ portviewBulkData หา emails)
        // v951: admin ห้ามใส่ .in() — รายชื่อทั้งบริษัทหลายร้อยอีเมลทำ URL ยาวเกิน
        // request พังเงียบแล้วตกไป fallback ที่โชว์ "ยังไม่มีประวัติ" (เคสจริง
        // 2026-08-04 admin เปิดประวัติไม่ได้) · RLS เปิดให้ admin เห็นทุกแถวอยู่แล้ว
        if (!(typeof isAdminRole === 'function' && isAdminRole(getCurrentRole()))) {
          const teamEmails = _getTeamEmails();
          if (teamEmails.length > 0) {
            q = q.in('owner_email', teamEmails);
          }
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
        const pLabel = (HIST_PERIODS.find(p => p.key === _histFilterMode) || {}).label || '';
        const emptyMsg = _histFilterMode === 'all' ? 'ยังไม่มีประวัติ Echo' : `ยังไม่มี visit ${pLabel}`;
        body.innerHTML = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">${emptyMsg}</div>`;
        return;
      }
      // TL/admin ได้บล็อกสรุปนำหน้า — คิดจาก data ชุดเดียวกับรายการข้างล่าง
      const head = isTL ? _histSummaryHtml(data, await _histCovisitSet(sinceIso)) : '';
      body.innerHTML = head + (isTL ? _renderTLTeamFeed(data) : _renderInlineHistory(data));
    } catch(e) {
      console.warn('[CI inline history]', e.message);
      // v951: error ≠ ว่าง — เดิม fallback ตีหน้าเป็น "ยังไม่มีประวัติ" ทำให้
      // ปัญหา query (เช่น URL ยาวเกินของ admin) ถูกกลืนหาย ไล่บั๊กไม่ได้
      if (_canDebrief()) {
        body.innerHTML = `<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">โหลดประวัติไม่สำเร็จ<br><span style="font-size:var(--text-xs)">${(e.message || '').slice(0, 120)}</span></div>`;
        return;
      }
      const rows = await _loadHistory();
      const sessions = _groupHistoryBySessions(rows);
      if (!sessions.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">ยังไม่มีประวัติ</div>';
        return;
      }
      body.innerHTML = _renderLegacyHistory(sessions);
    }
  }

  function _getTeamEmails() {
    const tlEmail = (currentUserProfile?.email || '').toLowerCase();
    if (!tlEmail) return [];
    const emails = new Set();

    // v_echog1: admin ไม่ใช่ TL ของใคร — เดิม match tlEmail === ตัวเองได้ 0 คน แล้ว
    // fallback เป็น [ตัวเอง] ทำให้ admin เห็นหน้าว่างทุก feed โดยไม่รู้สาเหตุ
    // → admin เห็น rep ทุกคนทั้งบริษัท · bulk ยังไม่โหลด = คืน [] ให้ผู้เรียกโชว์
    // "กำลังโหลด" (ห้าม fallback เป็นตัวเอง เพราะจะกลายเป็นหน้าว่างถาวรอีก)
    const _isAdmin = typeof isAdminRole === 'function' && isAdminRole(getCurrentRole());
    if (_isAdmin) {
      if (typeof portviewBulkData !== 'undefined' && portviewBulkData) {
        portviewBulkData.forEach(r => { if (r.kamEmail) emails.add(r.kamEmail.toLowerCase()); });
      }
      if (typeof window.salesBulkData !== 'undefined' && window.salesBulkData) {
        window.salesBulkData.forEach(r => { if (r.owner_email) emails.add(r.owner_email.toLowerCase()); });
      }
      return [...emails];
    }

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
    if (!sessions.length) return '<div style="text-align:center;padding:48px 0;font-size:var(--text-base);color:var(--tx3,#AEAEB2)">ยังไม่มี session</div>';

    return sessions.map(s => {
      const repName  = s.owner_email ? _echoRep(s.owner_email) : '—';
      const acctLabel = s.account_name || '—';
      const date     = new Date(s.visited_at).toLocaleDateString('th-TH', { day:'numeric', month:'short' });

      // v_echog1: แถวเช็คอินอย่างเดียว (ยังไม่มีเสียง/วิเคราะห์) — การ์ดย่อของตัวเอง
      // แทนที่จะเรนเดอร์เป็นการ์ด session พังๆ (dots ว่าง + ป้ายรอรีวิวที่ไม่มีวันจบ)
      if (s.pipeline_stage === 'checked_in') {
        const time = new Date(s.visited_at).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
        return `<div onclick="CI._openSessionDetail('${s.id}')" style="background:rgba(255,255,255,.55);border-radius:var(--r-lg);border:0.5px dashed rgba(0,0,0,.14);padding:10px 14px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent;display:flex;align-items:center;gap:8px">
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
  <div style="flex:1;min-width:0">
    <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx,#1C1C1E);line-height:1.2">${repName}</div>
    <div style="font-size:var(--text-xs);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${acctLabel} · ${date} ${time}</div>
  </div>
  <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#FF9500;background:#FF950018;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;flex-shrink:0">เช็คอินอย่างเดียว</span>
</div>`;
      }

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
        toneBadge = `<span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:${col};background:${col}18;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.04em">${c==='high'?'Confident':c==='medium'?'Steady':'Hesitant'}</span>`;
      }

      // Review badge
      const reviewBadge = reviewed
        ? `<span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#34C759;background:#34C75918;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif">✓ รีวิวแล้ว</span>`
        : `<span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#FF9500;background:#FF950018;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif">รอรีวิว</span>`;

      // Co-visit badge
      const cvBadge = s.covisit_verified
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#34C759;background:#34C75918;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif"><svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit</span>`
        : '';

      return `<div onclick="CI._openSessionDetail('${s.id}')" style="background:rgba(255,255,255,.72);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-radius:var(--r-lg);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 12px rgba(0,0,0,.04);padding:12px 14px;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px">
    <div style="display:flex;align-items:center;gap:7px">
      <div style="width:22px;height:22px;border-radius:50%;background:rgba(255,56,92,.12);display:flex;align-items:center;justify-content:center;font-size:var(--text-2xs);font-weight:var(--fw-semi);color:var(--ac,#FF385C);flex-shrink:0">${repName.slice(0,2).toUpperCase()}</div>
      <div>
        <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx,#1C1C1E);line-height:1.2">${repName}</div>
        <div style="font-size:var(--text-xs);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${acctLabel}</div>
      </div>
    </div>
    <div style="text-align:right">
      <div style="font-size:var(--text-xs);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${date}${dur?' · '+dur:''}</div>
    </div>
  </div>
  <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
    <div style="display:flex;gap:3px;align-items:center;flex:1">${dots}</div>
    ${toneBadge}
    ${cvBadge}
    ${reviewBadge}
  </div>
  ${s.tl_note ? `<div style="font-size:var(--text-xs);color:#534AB7;font-style:italic;line-height:1.5;margin-top:6px;padding-top:6px;border-top:0.5px solid rgba(83,74,183,.12);font-family:'Noto Sans Thai',sans-serif">${s.tl_note}</div>` : ''}
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
.sd-title { font-size:var(--text-lg2);font-weight:var(--fw-medium);color:#1C1C1E;letter-spacing:-.02em; }
.sd-close { font-size:var(--text-lg2);color:#636366;cursor:pointer;padding:4px 0 4px 12px; }
.sd-body { flex:1;overflow-y:auto;padding:16px 20px 24px;-webkit-overflow-scrolling:touch; }
.sd2-transcript { font-size:12.5px;color:#48484A;line-height:1.7;padding:12px 14px;background:rgba(255,56,92,.05);border:0.5px solid rgba(255,56,92,.12);border-radius:11px;letter-spacing:-.005em; }
.sd-body::-webkit-scrollbar { display:none; }
.sd-section-hd { font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin:16px 0 8px; }
.sd-skill-row { display:flex;gap:10px;padding:10px 0;border-bottom:0.5px solid #F2F2F7; }
.sd-skill-row:last-child { border-bottom:none; }
.sd-skill-dot { width:6px;height:6px;border-radius:50%;margin-top:4px;flex-shrink:0; }
.sd-skill-name { font-size:var(--text-md);font-weight:var(--fw-medium);color:#1C1C1E;margin-bottom:2px; }
.sd-skill-ev { font-size:var(--text-sm);color:#636366;line-height:1.5; }
.sd-skill-note { font-size:var(--text-sm);color:#FF385C;margin-top:3px;font-style:italic;line-height:1.4; }
.sd-tone-row { display:flex;gap:10px;margin-bottom:12px; }
.sd-tone-card { flex:1;padding:10px 12px;background:#F7F7F7;border-radius:var(--r-md); }
.sd-tone-label { font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.1em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px; }
.sd-tone-val { font-size:var(--text-base);font-weight:var(--fw-medium); }
.sd-tone-note { font-size:var(--text-xs);color:#AEAEB2;margin-top:2px;line-height:1.4; }
.sd-summary { font-size:var(--text-md);color:#636366;line-height:1.7;padding:12px 14px;background:rgba(255,56,92,.05);border-radius:var(--r-md);border:0.5px solid rgba(255,56,92,.12); }
.sd-review-btn { width:100%;padding:14px;border-radius:var(--r-lg);border:none;background:var(--ac,#FF385C);color:var(--tk-text-primary);font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg2);font-weight:var(--fw-medium);cursor:pointer;letter-spacing:-.02em;transition:opacity 80ms; }
.sd-review-btn:active { opacity:.8; }
.sd-review-btn.done { background:#34C759; }
.sd-review-footer { padding:12px 20px 32px;flex-shrink:0;border-top:0.5px solid #E5E5EA; }
/* ── v568 redesign (approved mockup): readable type scale + tabs + collapsible states ── */
.sd2-name { font-size:var(--text-xl2);font-weight:var(--fw-semi);color:#1C1C1E;letter-spacing:-.02em; }
.sd2-meta { font-size:var(--text-base);color:#48484A;margin-top:3px;line-height:1.55; }
.sd2-chips { display:flex;align-items:center;gap:8px;margin-top:10px;flex-wrap:wrap; }
.sd2-chip { display:inline-flex;align-items:center;gap:5px;font-size:var(--text-md);font-weight:var(--fw-semi);padding:5px 12px;border-radius:var(--r-pill);letter-spacing:.01em; }
.sd2-chip svg { flex-shrink:0; }
.sd2-chip.bad { color:#C73E3E;background:rgba(255,59,48,.08); }
.sd2-chip.dev { color:#B26A00;background:rgba(255,149,0,.09); }
.sd2-chip.good { color:#1F8A43;background:rgba(52,199,89,.09); }
.sd2-chip.cv { color:#34C759;background:rgba(52,199,89,.07); }
.sd2-chip.rev { color:#534AB7;background:rgba(83,74,183,.07); }
.sd2-whywrap { position:relative;margin-top:10px; }
.sd2-why { font-size:13.5px;color:#48484A;line-height:1.7;padding:12px 38px 12px 14px;background:#F7F7F8;border-radius:var(--r-card);transition:all .2s; }
.sd2-why.collapsed { display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden; }
.sd2-whytg { position:absolute;top:10px;right:10px;width:24px;height:24px;border-radius:var(--r-8);display:flex;align-items:center;justify-content:center;cursor:pointer;color:#8E8E93;transition:transform .2s; }
.sd2-whytg.flip { transform:rotate(180deg); }
.sd2-tabs { display:flex;gap:4px;margin-top:16px;background:#F7F7F8;border-radius:var(--r-card);padding:4px; }
.sd2-tab { flex:1;text-align:center;font-size:13.5px;font-weight:var(--fw-semi);color:#8E8E93;padding:9px 0;border-radius:var(--r-9);cursor:pointer;transition:all .18s;-webkit-tap-highlight-color:transparent; }
.sd2-tab.on { background:#FFF;color:#1C1C1E;box-shadow:0 1px 4px rgba(0,0,0,.07); }
.sd2-pane { display:none;padding-top:16px; }
.sd2-pane.on { display:block;animation:sd2fade .22s ease; }
@keyframes sd2fade { from { opacity:0;transform:translateY(4px); } to { opacity:1;transform:none; } }
.sd2-lbl { font-size:var(--text-sm);font-weight:var(--fw-semi);letter-spacing:.12em;text-transform:uppercase;color:#8E8E93;margin:18px 0 10px;font-family:'Noto Sans Thai',sans-serif; }
.sd2-lbl:first-child { margin-top:0; }
.sd2-tone { display:flex;gap:10px; }
.sd2-tcard { flex:1;padding:13px 14px;background:#F7F7F8;border-radius:var(--r-card); }
.sd2-tcard .k { font-size:var(--text-sm);font-weight:var(--fw-semi);letter-spacing:.1em;text-transform:uppercase;color:#8E8E93; }
.sd2-tcard .v { font-size:var(--text-lg2);font-weight:var(--fw-semi);margin-top:4px; }
.sd2-tcard .n { font-size:12.5px;color:#48484A;margin-top:4px;line-height:1.6; }
.sd2-sum { font-size:var(--text-lg);color:#1C1C1E;line-height:1.8;padding:14px 16px;background:rgba(255,56,92,.03);border:0.5px solid rgba(255,56,92,.1);border-radius:var(--r-card); }
.sd2-srow { display:flex;gap:12px;padding:13px 0;border-bottom:0.5px solid #ECECF0; }
.sd2-srow:last-child { border:none; }
.sd2-sdot { width:8px;height:8px;border-radius:50%;margin-top:7px;flex-shrink:0; }
.sd2-scode { font-family:var(--mono,'IBM Plex Mono','Noto Sans Thai',monospace);font-size:var(--text-xs);font-weight:var(--fw-medium);color:#8E8E93;letter-spacing:.04em; }
.sd2-sname { font-size:var(--text-lg);font-weight:var(--fw-semi);color:#1C1C1E;margin-top:1px; }
.sd2-sev { font-size:13.5px;color:#48484A;line-height:1.7;margin-top:4px; }
.sd2-snote { font-size:var(--text-base);color:#C73E3E;line-height:1.65;margin-top:5px;padding-left:10px;border-left:2px solid rgba(255,59,48,.2); }
.sd2-sstate { margin-left:auto;flex-shrink:0;font-size:var(--text-sm);font-weight:var(--fw-semi);padding:3px 9px;border-radius:var(--r-pill);height:fit-content;white-space:nowrap; }
.sd2-sstate.no { color:#8E8E93;background:#F7F7F8; }
.sd2-sstate.dev { color:#B26A00;background:rgba(255,149,0,.08); }
.sd2-sstate.ok { color:#1F8A43;background:rgba(52,199,89,.08); }
.sd2-iline { display:flex;gap:12px;padding:11px 0;border-bottom:0.5px solid #ECECF0; }
.sd2-iline:last-child { border:none; }
.sd2-ik { flex-shrink:0;width:64px;font-size:var(--text-sm);font-weight:var(--fw-semi);letter-spacing:.08em;text-transform:uppercase;color:#8E8E93;padding-top:3px; }
.sd2-iv { font-size:var(--text-lg);color:#1C1C1E;line-height:1.7; }
.sd2-iv .sub { color:#48484A;font-size:var(--text-base); }
.sd2-ipoint { display:flex;gap:9px;padding:7px 0;font-size:var(--text-lg);color:#1C1C1E;line-height:1.7; }
.sd2-ipoint::before { content:'';width:5px;height:5px;border-radius:50%;background:var(--ac,#FF385C);margin-top:9px;flex-shrink:0; }
.sd2-next { display:flex;gap:10px;padding:11px 13px;background:rgba(83,74,183,.03);border:0.5px solid rgba(83,74,183,.12);border-radius:11px;margin-bottom:8px;font-size:var(--text-lg);color:#1C1C1E;line-height:1.65; }
.sd2-next .num { font-family:var(--mono,'IBM Plex Mono','Noto Sans Thai',monospace);font-size:var(--text-sm);font-weight:var(--fw-medium);color:#534AB7;padding-top:3px;flex-shrink:0; }
.sd2-notebar { display:flex;align-items:center;gap:9px;padding:13px 16px;cursor:pointer;-webkit-tap-highlight-color:transparent; }
.sd2-notebar .t { flex:1;min-width:0;font-size:13.5px;font-weight:var(--fw-semi);color:#534AB7;white-space:nowrap;overflow:hidden;text-overflow:ellipsis; }
.sd2-notebar .t .pv { font-weight:var(--fw-normal);color:#48484A; }
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
        <div style="text-align:center;padding:48px 0;font-size:var(--text-base);color:#AEAEB2">กำลังโหลด...</div>
      </div>
      <div class="sd-review-footer" id="sd-review-footer" style="display:none"></div>`;
    document.body.appendChild(sheet);
    requestAnimationFrame(() => requestAnimationFrame(() => sheet.classList.add('open')));

    // Load session data
    try {
      // v_echog1: + transcript,summary_data (เดิมไม่ดึง → แท็บบทสนทนาว่างเสมอเมื่อ
      // เปิดจาก history) + pipeline_stage,rep_lat,rep_lng,checked_in_at (แถบเช็คอิน
      // + สถานะเช็คอินอย่างเดียว)
      const { data, error } = await supa.from('ci_sessions')
        .select('id,owner_email,account_id,account_name,visited_at,duration_secs,skill_scores,customer_intel,next_actions,transcript_summary,tone_signals,tl_reviewed_at,tl_reviewed_by,tl_note,covisit_verified,status,pipeline_stage,pipeline_error,transcript,summary_data,rep_lat,rep_lng,checked_in_at,transcript_confidence')
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
      if (b) b.innerHTML = `<div style="text-align:center;padding:48px 0;font-size:var(--text-base);color:#AEAEB2">โหลดไม่สำเร็จ: ${e.message}</div>`;
    }
  }

  function _renderSessionDetailContent(s) {
    // v598: shared renderer — map ci_sessions row → same 4 panel functions as live result
    // เพื่อให้ design เดียวกันทั้ง live result และ session detail จาก history
    const body   = document.getElementById('sd-body-inner');
    const footer = document.getElementById('sd-review-footer');
    if (!body) return;

    const repName   = s.owner_email ? _echoRep(s.owner_email) : '—';
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
    // v606: ส่ง transcriptSummary ให้ _overviewPanel โดยตรง (ไม่มี whyHtml กรอง)
    const transcriptSummary = s.transcript_summary || null;
    // Echo v2: pass segments + summaryData so history matches live result
    const segments   = Array.isArray(s.transcript) ? s.transcript : [];
    const summaryData = s.summary_data || null;

    // ── v_echog1: แถบเช็คอิน — เวลาถึงร้าน + ลิงก์พิกัดบน Google Maps
    let checkinBar = '';
    if (s.checked_in_at) {
      const ckTime = new Date(s.checked_in_at).toLocaleString('th-TH', { day:'numeric', month:'short', hour:'2-digit', minute:'2-digit' });
      const hasGps = s.rep_lat != null && s.rep_lng != null;
      const mapLink = hasGps
        ? ` · <a href="https://www.google.com/maps?q=${s.rep_lat},${s.rep_lng}" target="_blank" rel="noopener" style="color:#534AB7;text-decoration:none">ดูพิกัด ↗</a>`
        : '';
      checkinBar = `<div style="display:flex;align-items:center;gap:6px;font-size:var(--text-sm);color:var(--tx2,#636366);font-family:'Noto Sans Thai',sans-serif;margin:6px 0 2px">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
        <span>เช็คอิน ${ckTime}${mapLink}</span>
      </div>`;
    }

    // ── Phase A0: low transcript-confidence warning — worker already computed
    // this per session, it just was never surfaced before. Threshold is a
    // starting estimate (Whisper avg_logprob-derived, 0-1), not calibrated
    // against real data yet — revisit once Phase E has baseline numbers.
    // Copy deliberately does NOT say "listen to the original audio" — Echo
    // never stores/replays the recording, only the transcript.
    let confBanner = '';
    if (typeof s.transcript_confidence === 'number' && s.transcript_confidence < 0.6) {
      confBanner = `<div style="display:flex;align-items:flex-start;gap:8px;padding:10px 12px;margin-top:10px;background:rgba(255,149,0,.08);border:0.5px solid rgba(255,149,0,.22);border-radius:var(--r-md);font-size:var(--text-sm);color:#B26A00;line-height:1.5;font-family:'Noto Sans Thai',sans-serif">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        <span>ถอดเสียงไม่ชัดเจน (ความมั่นใจ ${Math.round(s.transcript_confidence*100)}%) — ควรตรวจสอบความถูกต้องก่อนเชื่อผลวิเคราะห์ในหน้านี้</span>
      </div>`;
    }

    // ── v_queue: pipeline ยอมแพ้ — บอกเหตุผลจริง ไม่ปล่อยให้เดา
    if (s.pipeline_stage === 'failed_audio' || s.pipeline_stage === 'failed_system') {
      const _isAudio = s.pipeline_stage === 'failed_audio';
      body.innerHTML = `
<div class="sd2-name">${repName}</div>
<div class="sd2-meta">${acctLabel} · ${date}${dur !== '—' ? ' · ' + dur : ''}</div>
${checkinBar}
<div class="sd2-chips">${cvChip}</div>
<div style="text-align:center;padding:36px 16px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">
  <div style="margin-bottom:10px"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FF3B30" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v5M12 16.5v.01"/></svg></div>
  <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx2,#636366);margin-bottom:4px">${_isAudio ? 'ไฟล์เสียงใช้ไม่ได้' : 'วิเคราะห์ไม่สำเร็จ'}</div>
  <div style="font-size:var(--text-sm);line-height:1.6">${_isAudio
    ? 'เสียงขาดระหว่างอัด (มักเกิดตอนล็อกจอหรือสลับแอพ)<br>visit นี้ยังนับตามปกติ — ครั้งหน้าลองอัดโดยเปิดหน้าจอทิ้งไว้'
    : 'ระบบลองวิเคราะห์หลายรอบแล้วยังไม่ผ่าน<br>กด "ลองใหม่" ที่การ์ดในหน้าประวัติได้'}</div>
  ${s.pipeline_error ? `<div style="margin-top:14px;font-size:var(--text-2xs);color:var(--tx3,#AEAEB2);font-family:'IBM Plex Mono',monospace;word-break:break-all;opacity:.7">${String(s.pipeline_error).slice(0, 160)}</div>` : ''}
</div>`;
      if (footer) footer.style.display = 'none';
      return;
    }

    // ── A2v2.1: async pipeline กำลังทำงาน / ไม่พบเสียง — สถานะตรงๆ แทนแท็บว่าง
    if (s.pipeline_stage === 'uploaded' || s.pipeline_stage === 'no_speech') {
      const _isProcessing = s.pipeline_stage === 'uploaded';
      body.innerHTML = `
<div class="sd2-name">${repName}</div>
<div class="sd2-meta">${acctLabel} · ${date}${dur !== '—' ? ' · ' + dur : ''}</div>
${checkinBar}
<div class="sd2-chips">${cvChip}</div>
<div style="text-align:center;padding:40px 16px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">
  ${_isProcessing
    ? `<div style="display:flex;gap:5px;align-items:center;justify-content:center;margin-bottom:12px">
        <span style="width:6px;height:6px;border-radius:50%;background:#534AB7;animation:ci-dot-pulse 1.2s ease-in-out infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#534AB7;animation:ci-dot-pulse 1.2s ease-in-out .2s infinite"></span>
        <span style="width:6px;height:6px;border-radius:50%;background:#534AB7;animation:ci-dot-pulse 1.2s ease-in-out .4s infinite"></span>
      </div>
      <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx2,#636366);margin-bottom:4px">ระบบกำลังวิเคราะห์เบื้องหลัง</div>
      <div style="font-size:var(--text-sm);line-height:1.6">ไม่ต้องเปิดหน้าจอรอ — เสร็จแล้วผลจะขึ้นแทนหน้านี้เอง<br>(ปกติภายใน 15 นาที)</div>`
    : `<div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx2,#636366);margin-bottom:4px">ไม่พบเสียงพูดในไฟล์ที่อัด</div>
      <div style="font-size:var(--text-sm);line-height:1.6">visit นี้ยังนับเช็คอินตามปกติ — ถ้าต้องการผลวิเคราะห์ ลองอัดใหม่ใน visit หน้า</div>`}
</div>`;
      if (footer) footer.style.display = 'none';
      return;
    }

    // ── v_echog1: visit แบบเช็คอินอย่างเดียว — ไม่มีเสียง/วิเคราะห์ให้โชว์
    // แสดงสถานะตรงๆ แทน 3 แท็บว่างที่ดูเหมือนข้อมูลหาย
    if (s.pipeline_stage === 'checked_in') {
      body.innerHTML = `
<div class="sd2-name">${repName}</div>
<div class="sd2-meta">${acctLabel} · ${date}</div>
${checkinBar}
<div class="sd2-chips">${cvChip}</div>
<div style="text-align:center;padding:40px 16px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">
  <div style="margin-bottom:10px"><svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg></div>
  <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--tx2,#636366);margin-bottom:4px">เช็คอินอย่างเดียว</div>
  <div style="font-size:var(--text-sm);line-height:1.6">visit นี้ไม่มีบันทึกเสียง — นับเป็น visit ตามปกติ<br>ถ้า rep อัดเสียงต่อจากเช็คอินนี้ ผลวิเคราะห์จะมาแทนหน้านี้เอง</div>
</div>`;
      if (footer) footer.style.display = 'none';
      return;
    }

    // ── Build 3 panes (v606: รวม overview+transcript → "บทสนทนา")
    const pane1 = _overviewPanel(transcriptSummary, toneSignals, segments, summaryData);
    const pane2 = _skillsPanel(skillData);
    const pane3 = _customerPanel(intelData);

    body.innerHTML = `
<div class="sd2-name">${repName}</div>
<div class="sd2-meta">${acctLabel} · ${date} · ${dur}</div>
${checkinBar}
<div class="sd2-chips">${verdictChip}${cvChip}${revChip}</div>
${confBanner}
<div class="sd2-tabs">
  <div class="sd2-tab on" onclick="CI._sdTab(this,'sd2p1')">บทสนทนา</div>
  <div class="sd2-tab" onclick="CI._sdTab(this,'sd2p2')">ทักษะ</div>
  <div class="sd2-tab" onclick="CI._sdTab(this,'sd2p3')">ลูกค้า</div>
</div>
<div class="sd2-pane on" id="sd2p1">${pane1}</div>
<div class="sd2-pane" id="sd2p2">${pane2}</div>
<div class="sd2-pane" id="sd2p3">${pane3}</div>`;

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
    style="width:100%;padding:11px 13px;border:0.5px solid rgba(83,74,183,.3);border-radius:11px;background:rgba(83,74,183,.04);color:#1C1C1E;font-family:'Noto Sans Thai',sans-serif;font-size:var(--text-lg);line-height:1.65;resize:none;-webkit-appearance:none;outline:none"
    onfocus="this.style.borderColor='rgba(83,74,183,.55)'" onblur="this.style.borderColor='rgba(83,74,183,.3)'"
  >${existingNote}</textarea>
  <button class="sd-review-btn" id="sd-save-note-btn"
    style="margin-top:10px;background:#534AB7;font-size:var(--text-lg2);font-weight:var(--fw-semi)"
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

      // v_echog1: visit แบบเช็คอินอย่างเดียว — การ์ดย่อของตัวเอง ไม่ใช่การ์ด session เปล่า
      if (s.pipeline_stage === 'checked_in') {
        const time = new Date(s.visited_at).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
        return `<div onclick="CI._openSessionDetail('${s.id}')" style="cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(255,255,255,.55);border-radius:var(--r-lg);border:0.5px dashed rgba(0,0,0,.14);padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#FF9500" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0"><path d="M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>
          <span style="flex:1;min-width:0;font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--tx,#1C1C1E)">${opts?.showAccount || !(_accountGuid || _groupBySales) ? acctLabel : date}</span>
          <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#FF9500;background:#FF950018;padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;flex-shrink:0">เช็คอินอย่างเดียว</span>
          <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${date} ${time}</span>
        </div>`;
      }

      // v_echog1: session ค้างขั้น transcribed (วิเคราะห์พังกลางทาง) — ปุ่มวิเคราะห์ต่อ
      if (s.pipeline_stage === 'transcribed') {
        return `<div style="background:rgba(255,255,255,.72);border-radius:var(--r-lg);border:0.5px solid rgba(255,149,0,.3);padding:12px 14px;margin-bottom:8px">
          <div onclick="CI._openSessionDetail('${s.id}')" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;cursor:pointer;-webkit-tap-highlight-color:transparent">
            <span style="font-size:var(--text-base);font-weight:var(--fw-semi);color:var(--tx,#1C1C1E);min-width:0;padding-right:8px">${opts?.showAccount || !(_accountGuid || _groupBySales) ? acctLabel : date}</span>
            <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${date}${dur ? ' · ' + dur : ''}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="flex:1;font-size:var(--text-xs);color:#a05800;font-family:'Noto Sans Thai',sans-serif">transcript บันทึกแล้ว · ยังไม่ได้วิเคราะห์</span>
            <button onclick="event.stopPropagation();CI._resumeAnalysis('${s.id}')"
              style="padding:6px 14px;border:none;border-radius:100px;background:#FF9500;color:#fff;font-size:var(--text-sm);font-weight:var(--fw-semi);font-family:'Noto Sans Thai',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent">วิเคราะห์ต่อ</button>
          </div>
        </div>`;
      }
      // A2v2.1: async pipeline in flight — server is still working on this row
      if (s.pipeline_stage === 'uploaded') {
        return `<div onclick="CI._openSessionDetail('${s.id}')" style="cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(255,255,255,.72);border-radius:var(--r-lg);border:0.5px solid rgba(83,74,183,.25);padding:12px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
          <span style="width:8px;height:8px;border-radius:50%;background:#534AB7;flex-shrink:0;animation:ci-dot-pulse 1.2s ease-in-out infinite"></span>
          <span style="flex:1;min-width:0;font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--tx,#1C1C1E)">${opts?.showAccount || !(_accountGuid || _groupBySales) ? acctLabel : date}</span>
          <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#534AB7;background:rgba(83,74,183,.09);padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;flex-shrink:0">กำลังวิเคราะห์เบื้องหลัง</span>
          <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${date}${dur ? ' · ' + dur : ''}</span>
        </div>`;
      }

      // v_queue: pipeline ยอมแพ้แล้ว — ต้องบอกตามจริง ไม่ใช่ปล่อยให้ค้างที่
      // "กำลังวิเคราะห์เบื้องหลัง" ตลอดกาลแบบที่เกิดขึ้นจริง 11-12 ส.ค.
      if (s.pipeline_stage === 'failed_audio' || s.pipeline_stage === 'failed_system') {
        const isAudio = s.pipeline_stage === 'failed_audio';
        const why  = isAudio ? 'ไฟล์เสียงใช้ไม่ได้' : 'วิเคราะห์ไม่สำเร็จ';
        const hint = isAudio
          ? 'เสียงขาดระหว่างอัด — visit นี้ยังนับปกติ ครั้งหน้าลองอัดโดยไม่ล็อกจอ'
          : 'ระบบลองหลายรอบแล้วไม่ผ่าน — แตะเพื่อลองใหม่';
        return `<div style="background:rgba(255,255,255,.72);border-radius:var(--r-lg);border:0.5px solid rgba(255,59,48,.28);padding:12px 14px;margin-bottom:8px">
          <div onclick="CI._openSessionDetail('${s.id}')" style="display:flex;align-items:center;justify-content:space-between;margin-bottom:6px;cursor:pointer;-webkit-tap-highlight-color:transparent">
            <span style="font-size:var(--text-base);font-weight:var(--fw-semi);color:var(--tx,#1C1C1E);min-width:0;padding-right:8px">${opts?.showAccount || !(_accountGuid || _groupBySales) ? acctLabel : date}</span>
            <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#FF3B30;background:rgba(255,59,48,.10);padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;flex-shrink:0;white-space:nowrap">${why}</span>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="flex:1;font-size:var(--text-xs);color:var(--tx2,#636366);font-family:'Noto Sans Thai',sans-serif">${hint}</span>
            ${isAudio ? '' : `<button onclick="event.stopPropagation();CI._resumeAnalysis('${s.id}')"
              style="padding:6px 14px;border:none;border-radius:100px;background:#FF3B30;color:#fff;font-size:var(--text-sm);font-weight:var(--fw-semi);font-family:'Noto Sans Thai',sans-serif;cursor:pointer;-webkit-tap-highlight-color:transparent;flex-shrink:0">ลองใหม่</button>`}
            <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${date}${dur ? ' · ' + dur : ''}</span>
          </div>
        </div>`;
      }

      // A2v2.1: server-side pipeline found no speech in the audio
      if (s.pipeline_stage === 'no_speech') {
        return `<div onclick="CI._openSessionDetail('${s.id}')" style="cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(255,255,255,.55);border-radius:var(--r-lg);border:0.5px dashed rgba(0,0,0,.14);padding:10px 14px;margin-bottom:8px;display:flex;align-items:center;gap:8px">
          <span style="flex:1;min-width:0;font-size:var(--text-base);font-weight:var(--fw-medium);color:var(--tx2,#636366)">${opts?.showAccount || !(_accountGuid || _groupBySales) ? acctLabel : date}</span>
          <span style="font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#8E8E93;background:rgba(0,0,0,.05);padding:2px 7px;border-radius:var(--r-sm);font-family:'Noto Sans Thai',sans-serif;flex-shrink:0">ไม่พบเสียงพูด</span>
          <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${date}</span>
        </div>`;
      }

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
        `<span style="font-size:var(--text-xs);color:var(--ac,#FF385C);background:rgba(255,56,92,.07);padding:3px 8px;border-radius:var(--r-sm);font-weight:var(--fw-medium)">${a.action||a}</span>`
      ).join('');
      const titleLeft = opts?.showAccount ? acctLabel : ((_accountGuid || _groupBySales) ? date : acctLabel);
      const titleRight = opts?.showAccount ? date + (dur?' · '+dur:'') : ((_accountGuid || _groupBySales) ? dur : date + (dur?' · '+dur:''));
      // TL coaching note — purple dot indicator + read-only note (rep sees this)
      const hasTLNote = !!(s.tl_note && s.tl_note.trim());
      const tlNoteDot = hasTLNote
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:var(--text-xs);font-weight:var(--fw-medium);color:#534AB7;font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">` +
          `<span style="width:5px;height:5px;border-radius:50%;background:#534AB7;flex-shrink:0"></span>TL note</span>` : '';
      // v569: boxed style replaced with hairline-quote — matches Skills/Echo design
      // language (hairline accents over filled boxes) instead of the generic look
      const tlNoteHtml = hasTLNote
        ? `<div style="margin-top:8px;padding:2px 0 2px 10px;border-left:2px solid rgba(83,74,183,.35)">` +
          `<div style="font-size:var(--text-xs);font-weight:var(--fw-semi);letter-spacing:.1em;color:#534AB7;font-family:'Noto Sans Thai',sans-serif;margin-bottom:2px">TL NOTE</div>` +
          `<div style="font-size:var(--text-base);color:#48484A;line-height:1.65;font-family:'Noto Sans Thai',sans-serif">${s.tl_note}</div></div>` : '';
      // Co-visit badge — shown when TL has verified proximity
      const cvDot = s.covisit_verified
        ? `<span style="display:inline-flex;align-items:center;gap:3px;font-size:var(--text-2xs);font-weight:var(--fw-medium);color:#34C759;font-family:'Noto Sans Thai',sans-serif">` +
          `<svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#34C759" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>Co-visit</span>` : '';
      return `<div onclick="CI._openSessionDetail('${s.id}')" style="cursor:pointer;-webkit-tap-highlight-color:transparent;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:var(--r-lg);border:0.5px solid ${hasTLNote?'rgba(83,74,183,.2)':'rgba(255,255,255,.55)'};box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:var(--text-base);font-weight:var(--fw-semi);color:var(--tx,#1C1C1E);min-width:0;padding-right:8px">${titleLeft}</span>
          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;white-space:nowrap">
            ${cvDot}
            ${tlNoteDot}
            <span style="font-size:var(--text-sm);color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;white-space:nowrap">${titleRight}</span>
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
        return `<div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:var(--mono,'Noto Sans Thai',monospace);margin:12px 0 8px">${grp.label}</div>${items}`;
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
      return `<div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.12em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:var(--mono,'Noto Sans Thai',monospace);margin:12px 0 8px">${grp.label}</div>${items}`;
    }).join('');
  }

  function _renderLegacyHistory(sessions) {
    return sessions.map(sess => {
      const dateLabel = new Date(sess.session_date).toLocaleDateString('th-TH',{day:'numeric',month:'short',year:'2-digit'});
      const skillDots = sess.skills.map(sk => {
        const sc = sk.tl_override||sk.score;
        const col = sc==='pass'?'var(--success,#34C759)':sc==='developing'?'var(--warning,#FF9500)':'var(--n-100,#E5E5EA)';
        return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:var(--text-2xs);color:${col};font-family:'Noto Sans Thai',sans-serif"><span style="width:5px;height:5px;border-radius:50%;background:${col}"></span>${sk.skill_code}</span>`;
      }).join('');
      return `<div style="background:rgba(255,255,255,.72);backdrop-filter:blur(24px);border-radius:var(--r-lg);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);padding:12px 14px;margin-bottom:8px">
        <div style="font-size:var(--text-md);font-weight:var(--fw-semi);color:var(--tx,#1C1C1E);margin-bottom:8px">${dateLabel}</div>
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
          <button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:var(--r-lg);border:none;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left"
            onclick="CI._pickerConfirmKam('${_g}','${_n.replace(/'/g,"\\'")}','${_s}')">
            <span style="font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E;flex:1">${_n}</span>
            <span style="font-size:var(--text-xs);font-weight:var(--fw-semi);color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em">${_s}</span>
          </button>`;
        }).join('');
      }
    } catch(e) {}
    const emptyMsg = recentRows ? '' : '<div style="text-align:center;padding:24px 0;font-size:var(--text-base);color:#AEAEB2">ยังไม่มีข้อมูลร้านค้า</div>';
    return `
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">กำลังคุยกับร้านไหน?</div>
      <input id="ci-pk-search" type="search" placeholder="ค้นหาชื่อร้าน..." autocomplete="off"
        style="width:100%;padding:12px 16px;border:1px solid #E5E5EA;border-radius:var(--r-card);font-size:var(--text-lg);outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
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
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">ร้านในพอร์ตของคุณ</div>
      <input id="ci-sales-acct-search" type="search" placeholder="ค้นหาร้านในพอร์ต..." autocomplete="off"
        style="width:100%;padding:12px 16px;border:1px solid #E5E5EA;border-radius:var(--r-card);font-size:var(--text-lg);outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        oninput="CI._salesPickerSearch(this.value)" />
      <div id="ci-sales-acct-list" style="display:flex;flex-direction:column;gap:6px;max-height:240px;overflow-y:auto">${ownRows}</div>
      <div style="display:flex;align-items:center;gap:10px;padding:6px 0"><div style="flex:1;height:0.5px;background:#E5E5EA"></div><span style="font-size:var(--text-xs);color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif">หรือ</span><div style="flex:1;height:0.5px;background:#E5E5EA"></div></div>` : '';
    return acctSection + `
      <div style="font-size:var(--text-2xs);font-weight:var(--fw-medium);letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">ร้านใหม่ / Lead</div>
      <input id="ci-sales-name-inline" type="text" placeholder="พิมพ์ชื่อร้านใหม่..." autocomplete="off"
        style="width:100%;padding:13px 16px;border:1.5px solid #FF385C;border-radius:var(--r-card);font-size:var(--text-lg2);outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        onkeydown="if(event.key==='Enter')CI._pickerConfirmSales(this.value)" />
      <button onclick="CI._pickerConfirmSales(document.getElementById('ci-sales-name-inline').value)"
        style="width:100%;padding:14px;border:none;border-radius:var(--r-lg);background:#FF385C;color:var(--tk-text-primary);font-size:var(--text-lg2);font-weight:var(--fw-medium);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;letter-spacing:-.02em">
        เริ่มบันทึก (Lead)
      </button>`;
  }

  function _salesAcctRow(r) {
    const _n = r.name || r.res_name || '-';
    const _g = r.id || r.account_guid || '';
    const _s = r.accountType || r.account_type || 'SA';
    return `<button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:var(--r-lg);border:0.5px solid rgba(255,255,255,.55);background:rgba(255,255,255,.72);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left"
      onclick="CI._pickerConfirmKam('${_g}','${_n.replace(/'/g,"\\'")}','${_s}')">
      <span style="font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E;flex:1">${_n}</span>
      <span style="font-size:var(--text-xs);font-weight:var(--fw-semi);color:#FF385C;letter-spacing:.06em">${_s}</span>
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
      : '<div style="text-align:center;padding:16px 0;font-size:var(--text-md);color:#AEAEB2">ไม่พบในพอร์ต — ใช้ช่อง Lead ด้านล่าง</div>';
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
        list.innerHTML = '<div style="text-align:center;padding:24px 0;font-size:var(--text-base);color:#AEAEB2">' +
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
          ? `<div style="font-size:var(--text-sm);color:#6C6C70;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px">outlet: ${_matchLabel}</div>`
          : '';
        return `<button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:var(--r-lg);border:none;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left;margin-bottom:6px"
          onclick="CI._pickerConfirmKam('${guid}','${safeName}','${seg}')">
          <div style="flex:1;min-width:0;text-align:left">
            <div style="font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E">${name}</div>
            ${hint}
          </div>
          <span style="font-size:var(--text-xs);font-weight:var(--fw-semi);color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;flex-shrink:0;margin-left:8px">${seg}</span>
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
    // Guard: do not reset _sessionId if pipeline is still saving (processing/result phase)
    // Resetting _sessionId mid-pipeline causes fallback insert to create orphan row
    // v731: _sessionId belongs to the pipeline — preserve it if pipeline saved a transcript
    // _phase may already be 'idle' (user pressed cancel) but pipeline still runs in background
    // Only null _sessionId if there is genuinely no active session
    const _hadActiveSession = !!_sessionId;
    _phase = 'idle'; _lastResult = null; _secs = 0;
    if (!_hadActiveSession) _sessionId = null;
    // Note: if _hadActiveSession=true, pipeline will null _sessionId itself after _saveAnalysis completes
    _isOwnRecording = false;
    _mainTab = 'record';
    _unmount();
    // v552: TL/Admin — covisit panel only, picker ห้ามเปิดเด็ดขาด (spec Table 3)
    if (_canDebrief()) {
      _accountGuid = null; _accountName = ''; _accountSeg = '';
      _showPicker = false;
      // ECHO GOAL 2: bucket by the debriefing TL's own flavor (sales_tl→sales,
      // ad_tl→ad) instead of hardcoding 'kam' for every _canDebrief() role
      _ownerType = (typeof skillRoleBucket === 'function') ? skillRoleBucket(getCurrentRole()) : 'kam';
      setTimeout(_mount, 50);
      return;
    }
    // Detect owner type from profile
    const role = (typeof getCurrentRole === 'function') ? getCurrentRole() : 'rep';
    // v498: AD uses KAM picker (existing accounts) not Sales name-input
    // PM also uses KAM picker; tagged its own owner_type for tracking, no pm_tl variant
    // ECHO GOAL 2: central skillRoleBucket mapper (identical output to the old
    // inline ternary for rep/sales/ad/pm — this branch never sees *_tl roles,
    // those are intercepted by _canDebrief() above)
    _ownerType = (typeof skillRoleBucket === 'function') ? skillRoleBucket(role) : ((role === 'sales') ? 'sales' : (role === 'ad' || role === 'ad_tl') ? 'ad' : (role === 'pm') ? 'pm' : 'kam');

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
    // v728: _checkRecoverBuffer is called from _mount() — no duplicate needed here
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

  // ── GPS check-in — snap location, WRITE ci_sessions, show bar + mic orb ──
  //
  // v_echog1: เดิมกด "เช็คอิน" แล้วขึ้น toast สำเร็จทั้งที่ยังไม่มีอะไรถูกส่งขึ้น
  // ระบบเลย — พิกัดนอนอยู่ใน localStorage แล้วค่อยติดไปกับแถว ci_sessions ตอนถอด
  // เสียงจบ แปลว่าเช็คอินแล้วไม่อัด/อัดสั้น/AI พัง = การไปถึงร้านหายไปเงียบๆ
  // และ TL ไม่มีทางเห็น rep ที่กำลังอยู่ในร้านเพื่อกดยืนยัน co-visit ได้เลย
  // (แถวเพิ่งเกิดตอน rep เดินออกจากร้านไปแล้ว)
  //
  // ตอนนี้: เช็คอิน = INSERT ทันที (pipeline_stage:'checked_in') → co-visit เห็น
  // แถวระหว่างยังอยู่ในร้าน · การอัดเสียงที่ตามมา UPDATE แถวเดิม (ดู
  // _saveTranscriptOnly) · แถวที่ไม่มีเสียงตามมา = visit แบบ "เช็คอินอย่างเดียว"
  // ซึ่งนับเป็น visit จริงตามนิยามที่บุชเคาะ (นับทั้งคู่ แยกตัวเลข)
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
        account_name:  _accountName || null,  // v_echog1: ให้ sales (ไม่มี guid) restore cache ได้
        session_id:    null,   // v_echog1: เติมโดย _syncCheckinToDb เมื่อ insert สำเร็จ
      };
      // Persist to localStorage so it survives app restart within session
      try { localStorage.setItem('ci_checkin_cache', JSON.stringify(_checkinCache)); } catch(_) {}

      // v552: visual feedback — green flash + pill บอกเวลาหมดอายุ (90 นาที)
      if (core) {
        core.classList.remove('orb-snapping');
        core.classList.add('orb-checkin-ok');
        setTimeout(() => core.classList.remove('orb-checkin-ok'), 1100);
      }
      const _tStr = now.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      const _expStr = new Date(now.getTime() + 90*60000).toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      const pill = document.getElementById('ci-checkin-pill');
      const timeEl = document.getElementById('ci-checkin-time');
      if (timeEl) timeEl.textContent = _tStr + ' · ถึง ' + _expStr;
      if (pill) pill.style.display = 'flex';

      // Switch orb to mic — ทำก่อนรอ network เพื่อให้ UI ไม่ค้างบนเน็ตช้า
      _showMicOrb();

      // v_echog1: เขียนขึ้นระบบจริง แล้วค่อยประกาศผลตามความจริง
      // v951: อย่ารีบฟ้อง — ครั้งแรกมักพลาดเพราะโปรไฟล์ยังโหลดไม่เสร็จ (เปิดแอปแล้ว
      // เข้า Echo เร็ว) → รอ 1.2 วิ retry อีกรอบก่อน แล้วบอกเหตุผลจริงถ้ายังไม่ได้
      let synced = await _syncCheckinToDb();
      if (!synced) {
        await new Promise(r => setTimeout(r, 1200));
        synced = await _syncCheckinToDb();
      }
      if (typeof showToast === 'function') {
        if (synced) showToast('เช็คอินสำเร็จ ' + _tStr, '✓');
        else {
          const why = _lastCheckinSyncError || 'การเชื่อมต่อขัดข้อง';
          showToast('เช็คอินเก็บไว้ในเครื่องแล้ว (' + why + ') — ระบบจะส่งซ้ำให้เองอัตโนมัติ', '⚠');
        }
      }
      // v952: ยังไม่เข้า → เข้าคิวยิงซ้ำเองจนกว่าจะสำเร็จ (ไม่ต้องรอเริ่มอัดเสียง)
      if (!synced) _armCheckinRetry();

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

  // v_echog1: ส่งเช็คอินขึ้น ci_sessions — idempotent เรียกซ้ำได้ไม่เกิดแถวใหม่
  // (มี session_id แล้ว = ส่งไปแล้ว ข้าม) · เรียกจาก 3 จุด: _doCheckin ทันทีที่กด,
  // startRecording (retry เผื่อจุดแรกเน็ตหลุด), และ _saveTranscriptOnly ผ่านทาง
  // ธรรมชาติของมันเอง (insert ใหม่เมื่อไม่มี session_id)
  // คืน true = มีแถวใน DB แล้วแน่ๆ
  // v_echodedupe: คีย์กันซ้ำแบบ deterministic — คำนวณจาก cache ล้วน ไม่สุ่ม ไม่ต้อง
  // เก็บ state เพิ่ม → ทุกเส้นทาง retry (และแม้เปิดแอปใหม่แล้ว restore cache)
  // คำนวณได้ค่าเดิมเป๊ะ แล้วชนกับ unique index ที่ DB แทนที่จะได้แถวใหม่
  function _checkinDedupeKey(cache, email) {
    if (!cache || !email || !cache.checked_in_at) return null;
    return email + '|' + (cache.account_guid || '-') + '|' + cache.checked_in_at;
  }

  // v_echodedupe: กันสองสายวิ่งพร้อมกัน (interval 15 วิ ชนกับ visibilitychange
  // ตอนแอปกลับมา foreground เป็นเคสจริงที่เจอ) — สายที่สองรอผลสายแรกแทนที่จะ
  // ยิง insert ของตัวเอง
  let _checkinSyncInFlight = null;
  async function _syncCheckinToDb(cacheArg) {
    if (_checkinSyncInFlight) return _checkinSyncInFlight;
    _checkinSyncInFlight = _syncCheckinToDbInner(cacheArg)
      .finally(() => { _checkinSyncInFlight = null; });
    return _checkinSyncInFlight;
  }

  async function _syncCheckinToDbInner(cacheArg) {
    // v951: รับ cache ที่ pipeline ตรึงไว้ได้ — เดิมอ่าน global อย่างเดียว ซึ่ง
    // อาจถูก null/สลับเป็นเช็คอินร้านใหม่ไปแล้วระหว่างรอ AI
    const cache = cacheArg || _checkinCache;
    if (!cache) return false;
    if (cache.session_id) return true;
    // v952: email จาก JWT ได้เลย ไม่รอ profiles fetch (สเปค = insert ทันทีที่กด)
    const email = _authEmail();
    if (!email) { _lastCheckinSyncError = 'ยังไม่พบ session ผู้ใช้'; return false; }
    const dedupeKey = _checkinDedupeKey(cache, email);
    try {
      // v952: PWA ฟื้นจาก background แล้ว token ค้างเป็นปัญหาที่รู้จักของแอปนี้
      // (01_core SIGNED_OUT handler) — getSession() ให้ supabase-js refresh ให้ก่อน
      // insert เสมอ (pattern เดียวกับ _skCacheJWT ใน 11_skills)
      try { await supa.auth.getSession(); } catch(_) {}
      const { data: row, error } = await supa.from('ci_sessions').insert({
        owner_email:    email,
        owner_type:     _ownerType,
        account_id:     cache.account_guid || null,
        account_name:   cache.account_name || _accountName || null,
        // visited_at = เวลาที่ไปถึงร้าน ไม่ใช่เวลาถอดเสียงเสร็จ — ตัวนับ visit
        // รายวัน/สัปดาห์ทุกตัว query จาก visited_at จึงต้องเป็นวันที่ไปจริง
        visited_at:     cache.checked_in_at,
        checked_in_at:  cache.checked_in_at,
        rep_lat:        cache.rep_lat,
        rep_lng:        cache.rep_lng,
        pipeline_stage: 'checked_in',
        status:         'draft',
        client_dedupe_key: dedupeKey
      }).select('id').single();
      let rowId = row && row.id;
      if (error && !rowId) {
        // v_echodedupe: 23505 = ชนคีย์กันซ้ำ แปลว่าแถวนี้เข้า DB ไปแล้วรอบก่อน
        // (มักเป็นเคส "commit สำเร็จแต่ response หาย" ที่ทำให้เกิดแถวซ้ำมาตลอด)
        // → ไปหยิบ id ของแถวเดิมมาใช้ ไม่ใช่สร้างใหม่ · จงใจไม่ใช้ upsert เพราะ
        // DO UPDATE จะดัน pipeline_stage กลับเป็น 'checked_in' ทับของที่เดินไปแล้ว
        if (error.code === '23505' && dedupeKey) {
          try {
            const { data: existing } = await supa.from('ci_sessions')
              .select('id').eq('client_dedupe_key', dedupeKey).limit(1).single();
            if (existing && existing.id) rowId = existing.id;
          } catch (_) {}
        }
        if (!rowId) {
          console.warn('[CI] checkin insert failed:', error?.message);
          _lastCheckinSyncError = error?.message || 'no row returned';
          return false;
        }
      }
      if (!rowId) {
        _lastCheckinSyncError = 'no row returned';
        return false;
      }
      cache.session_id = rowId;
      if (cache === _checkinCache) {
        try { localStorage.setItem('ci_checkin_cache', JSON.stringify(cache)); } catch(_) {}
      }
      // จุด echo บนพอร์ตติดตั้งแต่วันไป ไม่ต้องรอวิเคราะห์จบ (โครงเดียวกับ
      // upsert ใน _saveAnalysisToExistingSession — onConflict กันแถวซ้ำ)
      if (cache.account_guid) {
        try {
          await supa.from('kam_visits').upsert({
            kam_email:     email,
            account_id:    cache.account_guid,
            last_seen:     cache.checked_in_at,
            modes:         ['echo'],
            ci_session_id: rowId,
            ci_created_at: cache.checked_in_at,
            visit_date:    cache.checked_in_at.slice(0, 10)
          }, { onConflict: 'kam_email,account_id' });
        } catch(_) {}
      }
      return true;
    } catch(e) {
      console.warn('[CI] checkin sync unavailable:', e.message);
      _lastCheckinSyncError = e.message;
      return false;
    }
  }
  let _lastCheckinSyncError = null; // v951: ให้ _doCheckin บอกเหตุผลจริงใน toast

  // ── v952: retry queue — เช็คอินที่ค้างในเครื่องต้องหาทางขึ้นระบบเองจนได้ ────
  // ยิงซ้ำทุก 15 วิ (สูงสุด 8 ครั้ง = 2 นาที) + ยิงทันทีตอนแอปกลับมา visible
  // สำเร็จ → toast ✓ เงียบๆ · แพ้ครบ → รายงานเหตุผลจริงเข้า app_errors (เลิกเดา)
  let _checkinRetryTimer = null, _checkinRetryCount = 0;
  function _disarmCheckinRetry() {
    if (_checkinRetryTimer) { clearInterval(_checkinRetryTimer); _checkinRetryTimer = null; }
  }
  function _armCheckinRetry() {
    if (_checkinRetryTimer) return;
    _checkinRetryCount = 0;
    _checkinRetryTimer = setInterval(async () => {
      if (!_checkinCache || _checkinCache.session_id) { _disarmCheckinRetry(); return; }
      _checkinRetryCount++;
      const ok = await _syncCheckinToDb().catch(() => false);
      if (ok) {
        _disarmCheckinRetry();
        if (typeof showToast === 'function') showToast('เช็คอินส่งขึ้นระบบแล้ว', '✓');
      } else if (_checkinRetryCount >= 8) {
        _disarmCheckinRetry();
        try {
          window.SenseSentinel?.report('ci_checkin_sync_fail',
            (_lastCheckinSyncError || 'unknown') + ' | role=' +
            (typeof getCurrentRole === 'function' ? getCurrentRole() : '?'));
        } catch(_) {}
      }
    }, 15000);
  }
  // กลับมาหน้าแอป (สลับแอพ/ปลดล็อคจอ) แล้วมีเช็คอินค้าง → ยิงทันที ไม่รอรอบ 15 วิ
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (!_checkinCache || _checkinCache.session_id) return;
    _syncCheckinToDb().then(ok => {
      if (ok) {
        _disarmCheckinRetry();
        if (typeof showToast === 'function') showToast('เช็คอินส่งขึ้นระบบแล้ว', '✓');
      }
    }).catch(() => {});
  });

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

  // v_echog1: restore เช็คอินจาก localStorage ถ้ายังสด (<90 นาที) และตรงร้าน
  // ใช้ร่วมกันทั้ง KAM (match ด้วย guid) และ sales (match ด้วยชื่อ เพราะไม่มี guid)
  // คืน true = restore แล้ว + อัปเดต pill เวลาเช็คอินให้ด้วย
  function _restoreCheckinIfFresh(matches) {
    try {
      const cached = JSON.parse(localStorage.getItem('ci_checkin_cache') || 'null');
      if (!cached || !matches(cached)) return false;
      const minsAgo = (Date.now() - new Date(cached.checked_in_at).getTime()) / 60000;
      if (minsAgo >= 90) return false;
      _checkinCache = cached;
      const pill = document.getElementById('ci-checkin-pill');
      const timeEl = document.getElementById('ci-checkin-time');
      const t = new Date(cached.checked_in_at);
      const _exp = new Date(t.getTime() + 90*60000);
      if (timeEl) timeEl.textContent = t.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' })
        + ' · ถึง ' + _exp.toLocaleTimeString('th-TH', { hour:'2-digit', minute:'2-digit' });
      if (pill) pill.style.display = 'flex';
      return true;
    } catch(_) { return false; }
  }

  function _pickerConfirmKam(guid, name, seg) {
    _accountGuid = guid; _accountName = name; _accountSeg = seg || '';
    _showPicker = false;
    _hidePicker();
    if (_restoreCheckinIfFresh(c => c.account_guid === guid)) { _showMicOrb(); return; }
    _showCheckinOrb();
  }

  function _pickerConfirmSales(name) {
    if (!name || !name.trim()) return;
    _accountGuid = null; _accountName = name.trim(); _accountSeg = 'LEAD';
    _showPicker = false;
    _hidePicker();
    // v_echog1: restore แบบเดียวกับ KAM — เดิม sales เลือกร้านแล้วเช็คอินหายทุกครั้ง
    if (_restoreCheckinIfFresh(c => !c.account_guid && c.account_name === _accountName)) { _showMicOrb(); return; }
    _showCheckinOrb();
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
      if (tabBar) { tabBar.style.background = 'rgba(255,255,255,.06)'; if (tabBar.parentElement) tabBar.parentElement.style.display = 'none'; }
    } else {
      sheet.classList.remove('is-rec');
      // → LIGHT
      sheet.style.background = '#ffffff';
      const tabBarR = document.getElementById('ci-main-tabs');
      if (tabBarR && tabBarR.parentElement) tabBarR.parentElement.style.display = '';
      if (tabBarR) tabBarR.style.background = '';
      const tabRecR = document.getElementById('ci-tab-rec');
      if (tabRecR) { tabRecR.style.background = ''; tabRecR.style.color = ''; tabRecR.style.boxShadow = ''; }
      const tabHistR = document.getElementById('ci-tab-hist');
      if (tabHistR) tabHistR.style.color = '';

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
        ? `<span style="font-size:var(--text-xs);color:#FFB300;font-weight:var(--fw-medium);margin-left:4px;font-family:'Noto Sans Thai',sans-serif;transition:color .7s ease" class="ci-vh-count-lbl">${wCount} visits</span>`
        : `<span style="font-size:var(--text-xs);color:#AEAEB2;margin-left:4px;font-family:'Noto Sans Thai',sans-serif;transition:color .7s ease" class="ci-vh-count-lbl">${wCount} / 5</span>`;
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
      dots.innerHTML = dotsHtml + `<span style="font-size:var(--text-xs);color:#AEAEB2;margin-left:4px;font-family:'Noto Sans Thai',sans-serif">${wCount} co-visits</span>`;
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
    body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:#AEAEB2">กำลังโหลด...</div>';
    _cvSelected = null;
    _updateCvVerifyBtn();
    try {
      const teamEmails = _getTeamEmails();
      // v_echog1: admin เห็นทั้งบริษัท — list ว่าง (bulk ยังไม่โหลด) ให้ query แบบ
      // ไม่กรอง owner แทน (RLS เปิดให้ admin อ่านทุกแถวอยู่แล้ว) · TL list ว่าง = ตันจริง
      const _adminScope = typeof isAdminRole === 'function' && isAdminRole(getCurrentRole());
      if (!teamEmails.length && !_adminScope) { body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:#AEAEB2">ไม่พบน้องในทีม</div>'; return; }
      const todayStart = new Date(); todayStart.setHours(0,0,0,0);
      let cvQ = supa.from('ci_sessions')
        .select('id,owner_email,account_name,checked_in_at,rep_lat,rep_lng,covisit_verified,pipeline_stage')
        .gte('checked_in_at', todayStart.toISOString())
        .order('checked_in_at', { ascending: false });
      // v951: admin ไม่ใส่ .in() — รายชื่อทั้งบริษัททำ URL ยาวเกินจน request พัง
      if (teamEmails.length && !_adminScope) cvQ = cvQ.in('owner_email', teamEmails);
      const { data, error } = await cvQ;
      if (error) throw error;
      // v952: admin เห็นจอว่างเป็นเคสที่เคยไล่บั๊กไม่ได้เพราะไม่มี telemetry —
      // report เฉพาะเคสน่าสงสัย (admin + 0 แถว) จะได้เห็นจาก app_errors ทันที
      if (_adminScope && !(data || []).length) {
        try { window.SenseSentinel?.report('ci_admin_covisit_empty', 'rows=0 team=' + teamEmails.length); } catch(_) {}
      }
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
      body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:#AEAEB2">โหลดไม่สำเร็จ</div>';
    }
  }

  function _renderCovisitList(rows) {
    if (!rows.length) return '<div style="text-align:center;padding:40px 0;font-size:var(--text-base);color:#AEAEB2">ยังไม่มีน้องเช็คอินวันนี้</div>';
    const now = Date.now();
    const WINDOW_MS = 90 * 60 * 1000;
    return `<div class="cv-section-hd">วันนี้</div>` + rows.map(s => {
      const repName = s.owner_email ? _echoRep(s.owner_email) : '—';
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
      // v_echog1: != null ไม่ใช่ truthy — พิกัด 0 คือค่าจริง
      const onclickAttr = clickable
        ? `onclick="CI._cvSelectRow('${s.id}','${s.owner_email}',${s.rep_lat != null ? s.rep_lat : 'null'},${s.rep_lng != null ? s.rep_lng : 'null'},'${s.checked_in_at}','${repName}')"`
        : '';
      // v_echog1: แถวที่เพิ่งเช็คอิน (ยังไม่มีเสียง) โผล่ที่นี่ได้แล้วตั้งแต่กดเช็คอิน
      // — บอกสถานะให้ TL รู้ว่า rep ยังอยู่ในร้าน ไม่ใช่ visit ที่จบแล้ว
      const stageNote = s.pipeline_stage === 'checked_in'
        ? ' · <span style="color:#FF9500">ยังไม่อัดเสียง</span>' : '';
      return `<div class="cv-row" id="cv-row-${s.id}" style="${selStyle}" ${onclickAttr}>
        <div class="cv-avatar">${initials}</div>
        <div style="flex:1;min-width:0">
          <div class="cv-name">${repName}</div>
          <div class="cv-sub">${acct} · เช็คอิน ${checkinTime}${stageNote}</div>
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
      // v_echog1: ทางเข้าจาก session detail ส่ง null มา ซึ่งเดิมทำให้ "ข้าม" ทั้ง
      // เช็คระยะและเช็คเวลาเงียบๆ (verify ผ่านตลอด) — ดึงค่าจริงของแถวมาก่อนเสมอ
      // ค่าที่ยังเป็น null หลัง fetch = แถวนั้นไม่มีข้อมูลจริงๆ (เช่น อัดโดยไม่เช็คอิน)
      // ถึงจะข้ามเช็คนั้นได้อย่างถูกต้อง
      if (target.session_id && (target.rep_lat == null || !target.checked_in_at)) {
        const { data: srow } = await supa.from('ci_sessions')
          .select('rep_lat,rep_lng,checked_in_at,owner_email')
          .eq('id', target.session_id).single();
        if (srow) {
          if (target.rep_lat == null) target.rep_lat = srow.rep_lat;
          if (target.rep_lng == null) target.rep_lng = srow.rep_lng;
          if (!target.checked_in_at)  target.checked_in_at = srow.checked_in_at;
          if (!target.rep_email)      target.rep_email = srow.owner_email;
        }
      }

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
      // v_echog1: != null ไม่ใช่ truthy — พิกัด 0 คือค่าจริง (เส้นศูนย์สูตร/เส้นเมริเดียน)
      let proximityM = null;
      if (target.rep_lat != null && target.rep_lng != null) {
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
          badge.style.cssText = 'display:flex;align-items:center;gap:5px;font-size:var(--text-sm);font-weight:var(--fw-medium);color:#34C759;font-family:\'Noto Sans Thai\',sans-serif;margin-bottom:10px';
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
      const repName = _cvSelected?.rep_email ? _echoRep(_cvSelected.rep_email) : '';
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

  return { open, startRecording, stopRecording, cancel, _loadVisitHero, _phase: () => _phase, _tab, _save: () => { cancel(); }, /* v575: data auto-saved in _processBlob — กดบันทึก = ปิดเฉยๆ ไม่ insert ซ้ำ */ _openDebrief, _closeDebrief, _debriefPick, _debriefNote, _saveDebrief, _openSkillTrend, _closeTrend, _hidePicker, _pickerConfirmKam, _pickerConfirmSales, _pickerSearchInline, _salesPickerSearch, _minimize, _switchMainTab, _topbarLeft, _openSessionDetail, _closeSessionDetail, _sdTab, _sdToggleWhy, _sdToggleNote, _markSessionReviewed, _saveTLSessionNote, _covisitVerify, _cvSelectRow, _orbTap, _doCheckin, _histFilter, _recoverBuffer, _discardBuffer, _bustRubricCache: () => { _rubricCache = null; }, _reapplyBodyLock, _restoreBodyScroll, _renderEchoState, _resumeAnalysis, _startAsyncPipeline, _sweepStuckAsyncRows };

})();

function ciOpen(accountGuid) { CI.open(accountGuid); }
function echoOpen() {
  // Guard: if recording OR processing in progress, expand sheet instead of killing session
  if (typeof CI !== 'undefined' && typeof CI._phase === 'function') {
    const _p = CI._phase();
    if (_p === 'recording') { echoExpand(); return; }
    if (_p === 'processing') { echoExpand(); return; } // v730: ไม่ kill pipeline ระหว่าง analyze
  }
  // v715 Fix 3A: MOUNT-FIRST — CI.open() has no data dependency, always open immediately.
  // Previous: silent return when !allCriticalReady() → user sees blank screen with no feedback.
  // Now: open sheet → show toast if data still loading → re-render Echo state when data arrives.
  CI.open(null);
  if (typeof allCriticalReady === 'function' && !allCriticalReady()) {
    if (typeof showToast === 'function') showToast('กำลังโหลดข้อมูล...');
    if (window.DataRegistry) {
      window.DataRegistry.waitFor(1).then(function(){
        try{
          if (typeof CI !== 'undefined' && typeof CI._renderEchoState === 'function') {
            CI._renderEchoState();
          }
        }catch(e){}
      }).catch(function(){});
    }
  }
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
  // ECHO GOAL 2 / Phase M: role chips — Set of currently-selected buckets in the modal
  let _admSelectedRoles = new Set();
  const ADM_ROLE_LABEL = { kam:'KAM', sales:'Sales', ad:'AD', pm:'PM' };
  const ADM_ROLE_ABBR  = { kam:'K', sales:'S', ad:'A', pm:'P' };
  const ADM_ROLE_ORDER = ['kam','sales','ad','pm'];

  function _admRoleBadges(roles) {
    if (!roles || !roles.length) return '';
    return roles.map(r =>
      `<span style="display:inline-block;font-size:9px;font-weight:var(--fw-bold);letter-spacing:.04em;padding:2px 5px;border-radius:4px;background:rgba(83,74,183,.1);color:#534AB7;flex-shrink:0">${ADM_ROLE_ABBR[r]||r}</span>`
    ).join('');
  }

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
    if (el) el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--n400,#AEAEB2);font-size:var(--text-md)">กำลังโหลด...</div>';
    try {
      _admSkills = await _supaReq('skill_definitions', { filter: '?select=*&order=skill_code.asc' });
      _admLoaded = true;
      _admRender();
    } catch(e) {
      if (el) el.innerHTML = `<div style="text-align:center;padding:24px;color:#FF3B30;font-size:var(--text-md)">โหลดไม่ได้: ${e.message}</div>`;
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
    if (!_admSkills.length) { el.innerHTML = '<div style="text-align:center;padding:24px;color:var(--n400,#AEAEB2);font-size:var(--text-md)">ยังไม่มี Skill — กด เพิ่ม Skill ใหม่</div>'; return; }

    el.innerHTML = _admSkills.map(s => `
      <div onclick="admOpenModal('${s.id}')" style="display:grid;grid-template-columns:80px 1fr 56px;gap:8px;align-items:center;padding:10px 12px;background:#fff;cursor:pointer;border-bottom:0.5px solid var(--n100,#E5E5EA);transition:background .12s" onmouseover="this.style.background='#F7F7F7'" onmouseout="this.style.background='#fff'">
        <div style="font-family:'IBM Plex Mono','Noto Sans Thai',monospace;font-size:var(--text-sm);font-weight:var(--fw-semi);color:#FF385C">${s.skill_code||'—'}</div>
        <div>
          <div style="font-size:var(--text-md);font-weight:var(--fw-medium);color:var(--n900,#1C1C1E);margin-bottom:1px;display:flex;align-items:center;gap:5px;flex-wrap:wrap">${s.skill_name_en||'—'}${_admRoleBadges(s.roles)}</div>
          <div style="font-size:var(--text-xs);color:var(--n400,#AEAEB2);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${s.echo_observable?s.echo_observable.slice(0,60)+(s.echo_observable.length>60?'…':''):'ไม่มี hint'}</div>
        </div>
        <div style="display:inline-flex;align-items:center;justify-content:center;padding:3px 8px;border-radius:100px;font-size:var(--text-xs);font-weight:var(--fw-semi);${s.echo_enabled?'background:rgba(52,199,89,.1);color:#1a8a3a':'background:var(--n100,#E5E5EA);color:var(--n400,#AEAEB2)'}">${s.echo_enabled?'ON':'OFF'}</div>
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
        <div style="font-size:var(--text-lg2);font-weight:var(--fw-semi);color:var(--n900,#1C1C1E);margin-bottom:2px" id="adm-m-title">เพิ่ม Skill ใหม่</div>
        <div style="font-size:var(--text-sm);color:var(--n400,#AEAEB2);margin-bottom:18px" id="adm-m-sub">กรอกข้อมูลแล้วกด บันทึก</div>

        <div style="margin-bottom:13px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">Skill Code</div>
          <input id="adm-f-code" placeholder="C06_NEW" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;font-family:'IBM Plex Mono','Noto Sans Thai',monospace" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:13px">
          <div>
            <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">ชื่อ EN</div>
            <input id="adm-f-en" placeholder="Rapport Building" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;font-family:inherit" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
          </div>
          <div>
            <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">ชื่อ TH</div>
            <input id="adm-f-th" placeholder="สร้างความไว้วางใจ" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;font-family:inherit" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"/>
          </div>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">หลักการ (Principle)</div>
          <textarea id="adm-f-principle" rows="3" placeholder="ทำไม skill นี้สำคัญต่อ visit..." style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">การฝึก (Practice) <span style="font-weight:var(--fw-normal);color:var(--n400,#AEAEB2);text-transform:none;letter-spacing:0">— คั่นด้วย |</span></div>
          <textarea id="adm-f-practice" rows="3" placeholder="FKT Value 3 ระดับ: สิ่งที่ซัพฯ ทุกเจ้ามี | สิ่งที่ FKT ทำได้ดีกว่า | สิ่งที่ FKT เท่านั้นมี" style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:13px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">เกณฑ์ผ่าน (Pass Test)</div>
          <textarea id="adm-f-pass" rows="3" placeholder="Role play: TL ทดสอบ... Pass: ..." style="width:100%;padding:8px 11px;border:0.5px solid #E5E5EA;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#E5E5EA'"></textarea>
        </div>
        <div style="margin-bottom:15px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:#FF385C;margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">Echo Observable Hint <span style="font-weight:var(--fw-normal);color:var(--n400,#AEAEB2);text-transform:none;letter-spacing:0">— Gemini ฟังอะไรใน audio</span></div>
          <textarea id="adm-f-obs" rows="3" placeholder="ฟัง: rep หยุดก่อนตอบไหม? น้ำเสียง defensive หรือ acknowledge ก่อน? ลูกค้า engage มากขึ้นหลังจาก rep ตอบไหม?" style="width:100%;padding:8px 11px;border:0.5px solid #FFB3BF;border-radius:var(--r-9);font-size:var(--text-base);color:#1C1C1E;outline:none;resize:vertical;font-family:inherit;line-height:1.5;background:rgba(255,56,92,.03)" onfocus="this.style.borderColor='#FF385C'" onblur="this.style.borderColor='#FFB3BF'"></textarea>
        </div>
        <!-- ECHO GOAL 2 / Phase M: role chips — which positions this skill is evaluated for -->
        <div style="margin-bottom:13px">
          <div style="font-size:var(--text-xs);font-weight:var(--fw-bold);text-transform:uppercase;letter-spacing:.05em;color:var(--n900,#1C1C1E);margin-bottom:5px;font-family:'IBM Plex Mono','Noto Sans Thai',monospace">ประเมินสำหรับ Role</div>
          <div id="adm-f-roles" style="display:flex;flex-wrap:wrap;gap:7px"></div>
          <div style="font-size:var(--text-xs);color:var(--n400,#AEAEB2);margin-top:6px">ไม่เลือกเลย = ประเมินทุกตำแหน่ง</div>
        </div>
        <!-- Echo toggle -->
        <div style="display:flex;align-items:center;justify-content:space-between;padding:11px 13px;background:#F7F7F7;border-radius:var(--r-md);border:0.5px solid #E5E5EA;margin-bottom:18px">
          <div>
            <div style="font-size:var(--text-base);font-weight:var(--fw-medium);color:#1C1C1E">ส่งให้ Echo วิเคราะห์</div>
            <div style="font-size:var(--text-sm);color:#AEAEB2;margin-top:1px">ปิด = Gemini จะข้าม skill นี้</div>
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
          <button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:var(--r-md);font-size:var(--text-base);cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button>
          <button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:var(--tk-text-primary);border:none;border-radius:var(--r-md);font-size:var(--text-base);font-weight:var(--fw-semi);cursor:pointer;font-family:inherit">บันทึก</button>
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

  // ECHO GOAL 2 / Phase M: role chips — render active/inactive states from _admSelectedRoles
  function _admRenderRoleChips() {
    const box = document.getElementById('adm-f-roles');
    if (!box) return;
    box.innerHTML = ADM_ROLE_ORDER.map(r => {
      const active = _admSelectedRoles.has(r);
      return `<button type="button" data-role="${r}" onclick="admToggleRoleChip('${r}')" style="padding:6px 13px;border-radius:100px;font-size:var(--text-sm);font-weight:var(--fw-semi);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;transition:background .12s,border-color .12s,color .12s;${
        active ? 'border:0.5px solid #534AB7;background:rgba(83,74,183,.1);color:#534AB7'
               : 'border:0.5px solid #E5E5EA;background:transparent;color:#636366'
      }">${ADM_ROLE_LABEL[r]}</button>`;
    }).join('');
  }

  window.admToggleRoleChip = function(role) {
    if (_admSelectedRoles.has(role)) _admSelectedRoles.delete(role);
    else _admSelectedRoles.add(role);
    _admRenderRoleChips();
  };

  window.admOpenModal = function(id) {
    _injectModal();
    _admEditing = id || null;
    const s = id ? _admSkills.find(x => String(x.id) === String(id)) : null;
    _admSelectedRoles = new Set(Array.isArray(s?.roles) ? s.roles : []);
    _admRenderRoleChips();
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
      ? `<button onclick="admDeleteSkill('${s.id}','${(s.skill_code||'').replace(/'/g,"\\'")}' )" style="flex:1;padding:10px;border:0.5px solid #FF3B30;border-radius:var(--r-md);font-size:var(--text-base);cursor:pointer;background:transparent;color:#FF3B30;font-family:inherit">ลบ</button><button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:var(--r-md);font-size:var(--text-base);cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button><button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:var(--tk-text-primary);border:none;border-radius:var(--r-md);font-size:var(--text-base);font-weight:var(--fw-semi);cursor:pointer;font-family:inherit">บันทึก</button>`
      : `<button onclick="admCloseModal()" style="flex:1;padding:10px;border:0.5px solid #E5E5EA;border-radius:var(--r-md);font-size:var(--text-base);cursor:pointer;background:#fff;color:#1C1C1E;font-family:inherit">ยกเลิก</button><button onclick="admSaveSkill()" id="adm-save-btn" style="flex:2;padding:10px;background:#FF385C;color:var(--tk-text-primary);border:none;border-radius:var(--r-md);font-size:var(--text-base);font-weight:var(--fw-semi);cursor:pointer;font-family:inherit">บันทึก</button>`;

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
      // ECHO GOAL 2 / Phase M: none selected OR all 4 selected both mean "all roles" —
      // store NULL for both so it matches the column's own default semantics
      roles: (_admSelectedRoles.size === 0 || _admSelectedRoles.size >= ADM_ROLE_ORDER.length)
        ? null : Array.from(_admSelectedRoles),
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
    t.style.cssText = `position:fixed;bottom:24px;left:50%;transform:translateX(-50%);padding:9px 18px;border-radius:100px;font-size:var(--text-base);font-weight:var(--fw-medium);z-index:9999;color:var(--tk-text-primary);white-space:nowrap;transition:opacity .3s;background:${type==='ok'?'#34C759':type==='warn'?'#FF9500':'#FF3B30'}`;
    t.style.opacity='1';
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.style.opacity='0'; }, 2500);
  }
})();

