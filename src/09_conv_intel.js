// =============================================================================
// 09_conv_intel.js — Conversation Intelligence Module
// CSS + HTML ตรงจาก ci_mockup_v2 — ห้ามแก้ design โดยไม่ update mockup ด้วย
// =============================================================================

const CI = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const WORKER_URL = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
  const MAX_SECS   = 7200; // 2hr safety cap — Gemini รับได้ถึง 2hr audio

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
  let _sessionId   = null; // ci_sessions UUID after save

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
  function _ctx() {
    if (typeof portviewBulkData !== 'undefined' && _accountGuid) {
      const row = portviewBulkData.find(r => r.account_guid === _accountGuid);
      if (row) return {
        name: row.res_name||'-',
        seg: row.account_type||'-',
        days: row.days_with_current_kam||0,
        // enriched fields for AI context
        gmv_mtd: row.gmv_to_date||0,
        gmv_baseline: row.baseline_gmv||row.gmv_last_month||0,
        pace_pct: row.pace_pct||null,
        churn_count: row.churned_sku_count||0,
        missing_cats: row.missing_cat_count||0,
        account_class: row.account_class||'-',
        is_new: (row.days_with_current_kam||0) <= 30
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
.is-rec .timer-hint{color:var(--ac);}

/* ── WAVEFORM ── */
.waveform{display:flex;align-items:center;gap:2.5px;height:44px;padding:0 28px;width:100%;}
.wb{flex:1;border-radius:3px;background:var(--echo-ac-20);height:3px;min-height:3px;transition:height .11s ease,opacity .11s ease;opacity:.25;}
.is-rec .wb{opacity:.55;}

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
.result-cta{display:flex;gap:8px;padding:14px 24px 40px;}
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
  left:50%;
  width:100%;max-width:440px;
  transform:translateX(-50%) translateY(100%);
  z-index:9999;
  background:#FFFFFF!important;
  font-family:'Noto Sans Thai',sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
  color:#1C1C1E!important;
}
#ci-fullsheet .topbar{
  background:#fff!important;
  border-bottom:0.5px solid rgba(0,0,0,.07);
}
#ci-fullsheet.ci-open { transform:translateX(-50%) translateY(0); }
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
    requestAnimationFrame(() => {
      requestAnimationFrame(() => { el.classList.add('ci-open'); });
    });
    _initWaveform();
    _showScreen('ci-s-record');
  }

  function _unmount() {
    const el = document.getElementById('ci-fullsheet');
    if (!el) return;
    el.classList.remove('ci-open');
    setTimeout(() => el.remove(), 400);
    clearInterval(_timerRef);
    clearInterval(_waveRef);
  }

  function _minimize() {
    if (_phase !== 'recording') return;
    const sheet = document.getElementById('ci-fullsheet');
    if (sheet) sheet.style.display = 'none';
    const pill = document.getElementById('echo-float-pill');
    if (pill) { pill.classList.add('visible'); _startFloatTimer(); }
    document.body.classList.add('echo-active');
    // Update topbar: left button shows minimize hint
    const _tbLeft = document.getElementById('ci-topbar-left-label');
    const _tbIcon = document.getElementById('ci-topbar-left-icon');
    if (_tbLeft) _tbLeft.textContent = 'ย่อ';
    if (_tbIcon) _tbIcon.style.display = 'none';
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
    <span class="tb-rec"><span class="rec-dot" id="ci-rdot"></span><span id="ci-rlbl">พร้อมบันทึก</span></span>
  </div>
  <div style="padding:8px 24px 0">
    <div class="tab-bar" id="ci-main-tabs">
      <div class="tab-pill" id="ci-tab-pill" style="left:3px;width:calc(50% - 3px)"></div>
      <button class="tab-btn on" id="ci-tab-rec" onclick="CI._switchMainTab('record')">บันทึก</button>
      <button class="tab-btn" id="ci-tab-hist" onclick="CI._switchMainTab('history')">ประวัติ</button>
    </div>
  </div>
  <!-- Inline picker section — shown when no account selected -->
  <div id="ci-picker-sec" style="display:${_showPicker?'flex':'none'};flex-direction:column;flex:1;padding:0 24px 24px;gap:12px;overflow-y:auto">
    ${_ownerType==='sales' ? _buildSalesPickerInline() : _buildKamPickerInline()}
  </div>
  <div id="ci-chip-wrap" style="padding:4px 24px 12px;display:${_showPicker?'none':''}">
    <div class="chip">
      <div class="chip-dot" style="${_accountSeg==='LEAD'?'background:#FF9500':''}"></div>
      <span class="chip-txt">${ctx.name||'ร้านค้า'}</span>
      <span class="chip-seg" style="${_accountSeg==='LEAD'?'color:#FF9500':''}">${_accountSeg==='LEAD'?'LEAD':ctx.seg}</span>
    </div>
  </div>
  <div class="rec-center" id="ci-rec-center" style="${_showPicker?'display:none':''}">
    <div class="orb-wrap">
      <div class="orb-ambient"></div>
      <div class="orb-ring orb-ring-1"></div>
      <div class="orb-ring orb-ring-2"></div>
      <div class="orb-outer" onclick="CI.startRecording()">
        <div class="orb-core">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3z"/>
            <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
            <line x1="12" y1="19" x2="12" y2="22"/>
            <line x1="8" y1="22" x2="16" y2="22"/>
          </svg>
        </div>
      </div>
    </div>
    <div class="timer-block">
      <div class="timer-val" id="ci-tval">0:00</div>
      <div class="timer-hint" id="ci-thint">กดเพื่อเริ่มบันทึก</div>
    </div>
  </div>
  <div class="waveform" id="ci-wf" style="${_showPicker?'display:none':''}" ></div>
  <div class="rec-bottom" style="${_showPicker?'display:none':''}">
    <button class="btn-stop" onclick="CI.stopRecording()">หยุด &amp; วิเคราะห์</button>
    <span class="stop-hint">ระบบจะ transcribe และวิเคราะห์ด้วย AI อัตโนมัติ</span>
    </div>
  <!-- inline history panel — shown when tab=history -->
  <div id="ci-inline-hist" style="display:none;flex:1;overflow-y:auto;padding:0 24px 32px;-webkit-overflow-scrolling:touch">
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
      <button class="tab-btn on" onclick="CI._tab(0,this)">Skills</button>
      <button class="tab-btn" onclick="CI._tab(1,this)">ลูกค้า</button>
      <button class="tab-btn" onclick="CI._tab(2,this)">Next Steps</button>
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
    for (let i = 0; i < 34; i++) {
      const b = document.createElement('div');
      b.className = 'wb'; wf.appendChild(b);
    }
    let t = 0;
    _waveRef = setInterval(() => {
      t++;
      const bars = wf.querySelectorAll('.wb');
      const isRec = _phase === 'recording';
      bars.forEach((b, i) => {
        if (isRec) {
          b.style.height = (3 + Math.random() * 32) + 'px';
          b.style.opacity = (.3 + Math.random() * .65).toFixed(2);
        } else {
          b.style.height = (3 + Math.sin(t/4 + i * .42) * 1.6) + 'px';
          b.style.opacity = '.22';
        }
      });
    }, 105);
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

  // ── Recording ─────────────────────────────────────────────────────────────
  async function startRecording() {
    document.body.classList.add('echo-active');
    if (_phase !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = _bestMime();
      _recorder    = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      _chunks      = [];
      _secs        = 0;
      _recorder.ondataavailable = e => { if (e.data?.size > 0) _chunks.push(e.data); };
      _recorder.onstop = _onStop;
      _recorder.start(1000);
      _startTime = Date.now();
      _phase     = 'recording';

      // UI
      document.getElementById('ci-rec-center')?.classList.add('is-rec');
      document.getElementById('ci-rdot')?.classList.add('on');
      const rlbl = document.getElementById('ci-rlbl');
      if (rlbl) rlbl.textContent = 'REC';
      const thint = document.getElementById('ci-thint');
      if (thint) thint.textContent = 'กำลังบันทึก';

      _timerRef = setInterval(() => {
        _secs++;
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
    _phase = 'processing';
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
    _phase = 'idle'; _recorder = null; _chunks = [];
    _unmount();
  }

  // ── Processing steps ───────────────────────────────────────────────────────
  function _setStep(step, sub, pct) {
    const ps = document.getElementById('ci-pstep');
    const pb = document.getElementById('ci-psub');
    const pf = document.getElementById('ci-pfill');
    if (ps) ps.textContent = step;
    if (pb) pb.textContent = sub;
    if (pf) pf.style.width = pct + '%';
  }

  // ── Audio → Gemini analyze (single call) ──────────────────────────────────
  async function _onStop() {
    const blob = new Blob(_chunks, { type: _recorder?.mimeType || 'audio/webm' });
    _chunks = [];
    try {
      _setStep('กำลังวิเคราะห์...', 'Gemini · audio + skills', 20);

      // Load rubric from DB if not cached yet
      if (!_rubricCache) await _loadRubricFromDB();

      const result = await _analyzeWithGemini(blob);

      _setStep('กำลังบันทึก...', '', 92);
      await _saveToSupabase(result.skillData, result.intelData, result.transcriptSummary, result.toneSignals);

      _setStep('เสร็จแล้ว', '', 100);
      setTimeout(() => {
        _lastResult = { skillData: result.skillData, intelData: result.intelData,
                        transcriptSummary: result.transcriptSummary, toneSignals: result.toneSignals };
        _renderResult();
        document.getElementById('ci-dur-chip').textContent = _durText;
        _showScreen('ci-s-result');
        setTimeout(_initPill, 80);
      }, 400);

    } catch (err) {
      _phase = 'idle';
      _unmount();
      _toast('วิเคราะห์ไม่สำเร็จ: ' + err.message);
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
    const ctx = _ctx();
    const fmtK = n => n >= 1e6 ? (n/1e6).toFixed(1)+'M' : n >= 1e3 ? Math.round(n/1e3)+'K' : String(n);

    // Account context
    let acctSection = '';
    if (_accountName || _accountGuid) {
      acctSection = `\n\nข้อมูลร้าน (ใช้ประกอบการวิเคราะห์ D1/D2):
- ชื่อ: ${ctx.name} | Segment: ${ctx.seg} | Class: ${ctx.account_class}
- อยู่กับ rep มา: ${ctx.days} วัน${ctx.is_new ? ' (ร้านใหม่)' : ''}`;
      if (ctx.gmv_mtd > 0) {
        acctSection += `\n- GMV เดือนนี้: ${fmtK(ctx.gmv_mtd)} / baseline: ${fmtK(ctx.gmv_baseline)}`;
        if (ctx.pace_pct) acctSection += ` | Pace: ${ctx.pace_pct}%`;
      }
      if (ctx.churn_count > 0)  acctSection += `\n- SKU หยุดสั่ง: ${ctx.churn_count} รายการ`;
      if (ctx.missing_cats > 0) acctSection += `\n- Category ยังไม่สั่ง: ${ctx.missing_cats} หมวด`;
      if (_ownerType === 'sales') acctSection += `\n- ประเภท: Sales lead (ยังไม่เป็นลูกค้า Freshket)`;
    }

    // Skill rubric จาก DB
    const rubricText = (_rubricCache || []).map(s => {
      const obs = s.echo_observable ? `\nสัญญาณในเสียง: ${s.echo_observable}` : '';
      return `[${s.skill_code}] ${s.skill_name_en}
หลักการ: ${s.principle_th || '-'}
เกณฑ์ผ่าน: ${(s.pass_test_th || '-').replace(/\//g, ' | ')}${obs}`;
    }).join('\n\n');

    return `คุณคือ AI coach สำหรับ Freshket sales team
ฟัง audio การสนทนาต่อไปนี้ระหว่าง Sales rep กับเจ้าของร้านอาหาร${acctSection}

ทำ 3 อย่างในคำตอบเดียว:

1. แยก speaker: ระบุชัดว่าส่วนไหนคือ Sales พูด ส่วนไหนคือลูกค้าพูด
2. วิเคราะห์ skills ตาม rubric ด้านล่าง — ประเมินจากสิ่งที่ได้ยินจริง ทั้งคำพูดและน้ำเสียง
3. วิเคราะห์ customer intelligence ตาม OCPB framework

SKILL RUBRIC (ประเมินเฉพาะ skills เหล่านี้):
${rubricText}

TONE & EMOTION signals ที่ต้องสังเกต:
- rep_confidence: Sales พูดมั่นใจ ชัด หรือลังเล อ้อมค้อม?
- customer_engagement: ลูกค้า engage มากขึ้นหรือน้อยลงตลอด session?
- key_moments: จุดไหนที่ dynamics เปลี่ยน เช่น ลูกค้า warm ขึ้น หรือ push back

OCPB framework (customer intel):
- O: Operation — วิธีทำงาน ปัญหา ops ประจำวัน
- C: Competitor/Service/Price — ซัพเดิมคือใคร ปัญหาอะไร เปรียบราคา
- P: Payment/Billing — credit term, billing cycle
- B: Business Plan — แผนขยาย เปิดสาขา เปลี่ยน concept

Buyer type (BANK): Blueprint=ต้องการข้อมูลครบ | Action=ต้องการผลเร็ว | Nurturing=ให้ความสำคัญ trust | Knowledge=ต้องการ expertise

ตอบ JSON เท่านั้น ไม่มี markdown ไม่มี preamble:
{
  "transcript_summary": "สรุปบทสนทนา 3-5 ประโยค ระบุว่าใครพูดอะไร จุดสำคัญคืออะไร",
  "tone_signals": {
    "rep_confidence": "high|medium|low",
    "rep_confidence_note": "เหตุผลสั้นๆ",
    "customer_engagement": "increasing|stable|decreasing",
    "customer_engagement_note": "เหตุผลสั้นๆ",
    "key_moments": ["จุดสำคัญ 1", "จุดสำคัญ 2"]
  },
  "skills": [
    {
      "code": "A01_PIPC",
      "score": "pass|developing|not_observed|not_applicable",
      "evidence": "คำพูดหรือพฤติกรรมจริงที่ได้ยิน",
      "gap": "สิ่งที่ขาดจากเกณฑ์ผ่าน หรือ '-'",
      "coaching_note": "คำแนะนำสำหรับ TL ใช้ debrief 1-2 ประโยค"
    }
  ],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "ขั้นตอนสูงสุดที่ rep ทำถึง",
  "overall": "strong|developing|needs_work",
  "session_summary": "สรุปภาพรวม skill 2-3 ประโยค จุดเด่น จุดที่ต้องพัฒนา",
  "buyer_type": "Blueprint|Action|Nurturing|Knowledge",
  "buyer_evidence": "หลักฐานจาก audio",
  "ocpb_covered": ["O","C","P","B"],
  "ocpb_missing": ["dimension ที่ยังไม่ถาม"],
  "pain_points": [
    {"dimension": "Quality|Price|Delivery|Completeness|Service|Credit", "severity": "high|medium|opportunity", "summary": "สรุป pain"}
  ],
  "upsell_signals": [{"category": "หมวดสินค้า", "evidence": "หลักฐาน"}],
  "wallet_estimate": "hot|warm|cold",
  "wallet_logic": "เหตุผล",
  "next_actions": [
    {"action": "สิ่งที่ต้องทำ", "owner": "Sales|TL", "urgency": "3_days|this_week|next_visit", "reason": "ทำไม"}
  ]
}`;
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

    const res = await fetch(`${WORKER_URL}/analyze-audio`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_b64: b64audio,
        mime_type: mimeType,
        prompt: _buildGeminiPrompt(),
      })
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => res.status);
      throw new Error(`Gemini ${res.status}: ${errText}`);
    }
    const data = await res.json();
    const raw = data?.text || data?.content?.[0]?.text || '';
    console.log('[CI Gemini raw]', raw.substring(0, 300));

    const s = raw.indexOf('{'), e = raw.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('Gemini no JSON: ' + raw.substring(0, 120));
    const parsed = JSON.parse(raw.slice(s, e + 1));

    // Split combined response into skillData + intelData + new fields
    const skillData = {
      skills:          parsed.skills || [],
      pipc_stage:      parsed.pipc_stage || null,
      pipc_reached:    parsed.pipc_reached || null,
      overall:         parsed.overall || null,
      session_summary: parsed.session_summary || null,
    };
    const intelData = {
      buyer_type:       parsed.buyer_type || null,
      buyer_evidence:   parsed.buyer_evidence || null,
      ocpb_covered:     parsed.ocpb_covered || [],
      ocpb_missing:     parsed.ocpb_missing || [],
      pain_points:      parsed.pain_points || [],
      upsell_signals:   parsed.upsell_signals || [],
      wallet_estimate:  parsed.wallet_estimate || null,
      wallet_logic:     parsed.wallet_logic || null,
      next_actions:     parsed.next_actions || [],
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
        status:             'saved'
      }).select('id').single();
      if (sessionErr) console.warn('[CI] ci_sessions insert (table may not exist yet):', sessionErr.message);
      else if (sessionRow) _sessionId = sessionRow.id;
    } catch(e) { console.warn('[CI] ci_sessions unavailable:', e.message); }

    // 2. Save skill log rows (all roles — Sales uses account_name fallback when no guid)
    if (skillData?.skills?.length) {
      const rows = skillData.skills.map(s => ({
        kam_email: email,
        account_id: _accountGuid || null,
        account_name: _accountName || null,
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
    if (skillData?.skills?.length) {
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
    document.getElementById('ci-p0').innerHTML = _skillsPanel(skillData);
    document.getElementById('ci-p1').innerHTML = _customerPanel(intelData);
    document.getElementById('ci-p2').innerHTML = _actionsPanel(intelData);
    document.getElementById('ci-p3').innerHTML = _transcriptPanel(transcriptSummary, toneSignals);
    const tlDiv = document.getElementById('ci-tl-actions');
    if (tlDiv) tlDiv.style.display = _canDebrief() ? 'flex' : 'none';
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
      ? `<div style="margin-bottom:20px;padding:12px 14px;background:rgba(255,56,92,.06);border-radius:10px;border:0.5px solid rgba(255,56,92,.15)"><p style="font-size:12px;color:var(--tx2,#636366);line-height:1.6;margin:0">${d.session_summary}</p></div>`
      : '';

    const rows = (d?.skills||[]).map(s => {
      const dc = s.score==='pass'?'pass':s.score==='developing'?'dev':'no';
      const bl = s.score==='pass'?'Pass':s.score==='developing'?'Developing':s.score==='not_applicable'?'N/A':'Not observed';
      const coaching = s.coaching_note && s.coaching_note !== '-'
        ? `<p style="font-size:11px;color:var(--ac,#FF385C);margin:4px 0 0;font-style:italic;line-height:1.5"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:-1px"><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg> ${s.coaching_note}</p>`
        : '';
      const gap = s.gap && s.gap !== '-'
        ? `<p style="font-size:11px;color:var(--tx3,#AEAEB2);margin:3px 0 0;line-height:1.4">▸ ขาด: ${s.gap}</p>`
        : '';
      return `<div class="skill-row">
        <div class="sk-dot ${dc}"></div>
        <div class="sk-body">
          <div class="sk-head"><span class="sk-name">${s.code} · ${s.name||''}</span><span class="sk-badge ${dc}">${bl}</span></div>
          <p class="sk-note">${s.evidence||s.evidence_summary||'-'}</p>
          ${gap}${coaching}
        </div>
      </div>`;
    }).join('');

    return shortBanner + `<div class="eyebrow">PIPC Progress</div>
      <div class="pipc-track">${segs}</div>
      <div class="pipc-labels">${lbls}</div>
      ${summary}${rows}`;
  }

  function _customerPanel(d) {
    const ocpbAll = ['O','C','P','B'];
    const covered = d?.ocpb_covered || [];
    const ocpbBar = ocpbAll.map(dim => {
      const done = covered.includes(dim);
      const label = {O:'Operation',C:'Competitor',P:'Payment',B:'Business'}[dim];
      return `<div style="flex:1;text-align:center">
        <div style="width:32px;height:32px;border-radius:8px;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;background:${done?'rgba(255,56,92,.12)':'rgba(0,0,0,.04)'};color:${done?'var(--ac,#FF385C)':'var(--tx3,#AEAEB2)'}">${dim}</div>
        <div style="font-size:9px;color:${done?'var(--ac,#FF385C)':'var(--tx3,#AEAEB2)'};font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em;text-transform:uppercase">${label}</div>
      </div>`;
    }).join('');

    const painRows = (d?.pain_points||[]).map(p => {
      const dc = p.severity==='high'?'hi':p.severity==='medium'?'md':'op';
      return `<div class="pain-row">
        <div class="pain-dot ${dc}"></div>
        <div class="pain-body">
          <div class="pain-dim">${p.dimension} · ${p.severity}</div>
          <div class="pain-txt">${p.summary}</div>
        </div>
      </div>`;
    }).join('');

    const upsells = (d?.upsell_signals||[]).length
      ? `<div class="eyebrow" style="margin-top:20px">Upsell Signals</div>` +
        (d.upsell_signals||[]).map(u =>
          `<div style="display:flex;gap:10px;padding:8px 0;border-bottom:0.5px solid var(--br,#E5E5EA)">
            <div style="font-size:12px;font-weight:500;color:var(--ac,#FF385C);min-width:80px">${u.category}</div>
            <div style="font-size:12px;color:var(--tx2,#636366);flex:1">${u.evidence}</div>
          </div>`).join('')
      : '';

    const walletColor = d?.wallet_estimate==='hot'?'var(--danger,#FF3B30)':d?.wallet_estimate==='warm'?'var(--warning,#FF9500)':'var(--tx3,#AEAEB2)';

    return `<div class="buyer-card">
        <div class="buyer-icon-wrap" style="background:rgba(255,56,92,.08);border-radius:12px;width:46px;height:46px;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <div style="font-size:11px;font-weight:500;color:var(--ac,#FF385C);font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em">${({'Blueprint':'BPRT','Action':'ACT','Nurturing':'NUR','Knowledge':'KNOW'})[d?.buyer_type]||'--'}</div>
        </div>
        <div style="flex:1">
          <div class="buyer-lbl">Buyer Type (BANK)</div>
          <div class="buyer-type">${({'Blueprint':'Blueprint','Action':'Action','Nurturing':'Nurturing','Knowledge':'Knowledge'})[d?.buyer_type]||d?.buyer_type||'-'}</div>
          <div class="buyer-ev">${d?.buyer_evidence||''}</div>
        </div>
        <div style="text-align:right;min-width:44px;max-width:60px;flex-shrink:0">
          <div style="font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;margin-bottom:3px">Wallet</div>
          <div style="font-size:16px;font-weight:500;color:${walletColor}">${(d?.wallet_estimate||'-').toUpperCase()}</div>
          <div style="font-size:9px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;max-width:64px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${d?.wallet_logic||''}">${(d?.wallet_logic||'').slice(0,18)}</div>
        </div>
      </div>
      <div class="eyebrow" style="margin-bottom:10px">Discovery Coverage (OCPB)</div>
      <div style="display:flex;gap:8px;margin-bottom:20px">${ocpbBar}</div>
      <div class="eyebrow">Pain Points</div>${painRows}${upsells}`;
  }

  function _actionsPanel(d) {
    return (d?.next_actions||[]).map((a,i) => {
      const uc = a.urgency==='3_days'?'hi':'md';
      const ul = a.urgency==='3_days'?'ภายใน 3 วัน':a.urgency==='this_week'?'สัปดาห์นี้':'visit ถัดไป';
      const reason = a.reason
        ? `<div style="font-size:10px;color:var(--tx3,#AEAEB2);margin-top:3px;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.03em">${a.reason}</div>`
        : '';
      return `<div class="action-card">
        <div class="action-top"><span class="action-n">${String(i+1).padStart(2,'0')}</span><span class="urg ${uc}">${ul}</span></div>
        <p class="action-txt">${a.action}</p>
        <span class="action-who">${a.owner}</span>
        ${reason}
      </div>`;
    }).join('');
  }

  function _transcriptPanel(summary, tone) {
    if (!summary && !tone) {
      return `<div style="padding:24px;text-align:center;font-size:13px;color:var(--tx3,#AEAEB2)">ไม่มีข้อมูล</div>`;
    }
    // Tone signals block
    let toneHtml = '';
    if (tone) {
      const confColor = tone.rep_confidence==='high'?'var(--success,#34C759)':tone.rep_confidence==='medium'?'var(--warning,#FF9500)':'var(--danger,#FF3B30)';
      const engColor  = tone.customer_engagement==='increasing'?'var(--success,#34C759)':tone.customer_engagement==='stable'?'var(--warning,#FF9500)':'var(--danger,#FF3B30)';
      const moments   = (tone.key_moments||[]).map(m =>
        `<div style="font-size:12px;color:var(--tx2,#636366);padding:6px 0;border-bottom:0.5px solid var(--br,#E5E5EA);line-height:1.5">${m}</div>`
      ).join('');
      toneHtml = `
<div class="eyebrow" style="margin-bottom:10px">Tone & Energy</div>
<div style="display:flex;gap:12px;margin-bottom:16px">
  <div style="flex:1;padding:12px;background:rgba(0,0,0,.03);border-radius:10px">
    <div style="font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;margin-bottom:4px">Sales confidence</div>
    <div style="font-size:14px;font-weight:500;color:${confColor}">${tone.rep_confidence||'-'}</div>
    <div style="font-size:11px;color:var(--tx3,#AEAEB2);margin-top:2px">${tone.rep_confidence_note||''}</div>
  </div>
  <div style="flex:1;padding:12px;background:rgba(0,0,0,.03);border-radius:10px">
    <div style="font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif;margin-bottom:4px">Customer engagement</div>
    <div style="font-size:14px;font-weight:500;color:${engColor}">${tone.customer_engagement||'-'}</div>
    <div style="font-size:11px;color:var(--tx3,#AEAEB2);margin-top:2px">${tone.customer_engagement_note||''}</div>
  </div>
</div>
${moments ? `<div class="eyebrow" style="margin-bottom:8px">Key Moments</div>${moments}` : ''}`;
    }
    // Summary block
    const summaryHtml = summary
      ? `<div class="eyebrow" style="margin-top:20px;margin-bottom:8px">สรุปบทสนทนา</div>
<div style="font-size:13px;color:var(--tx2,#636366);line-height:1.7;padding:12px 14px;background:rgba(255,56,92,.05);border-radius:10px;border:0.5px solid rgba(255,56,92,.12)">${summary}</div>`
      : '';
    return toneHtml + summaryHtml;
  }


  // ── CI_TL_DEBRIEF ───────────────────────────────────────────────────────────
  // TL/Admin เท่านั้น — override AI score per skill + เพิ่ม coaching note
  // เปิดจาก "Debrief" button ใน result screen
  // Save ลง kam_skill_log.tl_override + tl_note

  let _debriefOverrides = {}; // { skillCode: { score, note } }

  function _canDebrief() {
    return isTLRole(getCurrentRole()) || isAdminRole(getCurrentRole());
  }

  function _buildDebriefCSS() {
    return `
#ci-debrief-sheet {
  position:fixed;top:0;bottom:0;left:50%;
  width:100%;max-width:440px;
  transform:translateX(-50%) translateY(100%);
  z-index:10000;
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
      const skillDots = sess.skills.map(sk => {
        const finalScore = sk.tl_override || sk.score;
        const dc = finalScore==='pass'?'pass':finalScore==='developing'?'dev':'no';
        return `<span class="hist-skill-dot"><span class="hsd ${dc}"></span>${sk.skill_code}</span>`;
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


  // ── Main tab switch (บันทึก / ประวัติ) ────────────────────────────────────────
  function _switchMainTab(tab) {
    const pill = document.getElementById('ci-tab-pill');
    const recBtn = document.getElementById('ci-tab-rec');
    const histBtn = document.getElementById('ci-tab-hist');
    const recArea = document.getElementById('ci-rec-center');
    const wf = document.getElementById('ci-wf');
    const recBottom = document.querySelector('#ci-s-record .rec-bottom');
    const histPanel = document.getElementById('ci-inline-hist');
    const chip = document.querySelector('#ci-s-record .chip')?.parentElement;

    if (tab === 'history') {
      if (pill) { pill.style.left = 'calc(50%)'; pill.style.width = 'calc(50% - 3px)'; }
      if (recBtn) recBtn.classList.remove('on');
      if (histBtn) histBtn.classList.add('on');
      if (recArea) recArea.style.display = 'none';
      if (wf) wf.style.display = 'none';
      if (recBottom) recBottom.style.display = 'none';
      if (chip) chip.style.display = 'none';
      if (histPanel) { histPanel.style.display = 'block'; _loadInlineHistory(); }
    } else {
      if (pill) { pill.style.left = '3px'; pill.style.width = 'calc(50% - 3px)'; }
      if (recBtn) recBtn.classList.add('on');
      if (histBtn) histBtn.classList.remove('on');
      if (recArea) recArea.style.display = '';
      if (wf) wf.style.display = '';
      if (recBottom) recBottom.style.display = '';
      if (chip) chip.style.display = '';
      if (histPanel) histPanel.style.display = 'none';
    }
  }

  async function _loadInlineHistory() {
    const body = document.getElementById('ci-inline-hist-body');
    if (!body) return;
    body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">กำลังโหลด...</div>';
    const email = currentUserProfile?.email;
    if (!email) { body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ไม่พบผู้ใช้งาน</div>'; return; }
    try {
      // Query ci_sessions — all user sessions, newest first
      let q = supa.from('ci_sessions')
        .select('id,account_id,account_name,visited_at,duration_secs,skill_scores,next_actions,status')
        .eq('owner_email', email)
        .order('visited_at', { ascending: false })
        .limit(50);
      if (_accountGuid) {
        q = q.eq('account_id', _accountGuid);
      } else if (typeof isSalesRole === 'function' && isSalesRole(typeof getCurrentRole === 'function' ? getCurrentRole() : '')) {
        // Sales mode: no account_id filter — show all own sessions, group by account_name
        // (query already filtered by owner_email above)
      }
      const { data, error } = await q;
      if (error) throw error;
      if (!data || !data.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ยังไม่มีประวัติ Echo</div>';
        return;
      }
      body.innerHTML = _renderInlineHistory(data);
    } catch(e) {
      console.warn('[CI inline history]', e.message);
      // Fallback to kam_skill_log if ci_sessions not ready
      const rows = await _loadHistory();
      const sessions = _groupHistoryBySessions(rows);
      if (!sessions.length) {
        body.innerHTML = '<div style="text-align:center;padding:40px 0;font-size:13px;color:var(--tx3,#AEAEB2)">ยังไม่มีประวัติ</div>';
        return;
      }
      body.innerHTML = _renderLegacyHistory(sessions);
    }
  }

  function _renderInlineHistory(sessions) {
    const _salesMode = typeof isSalesRole === 'function' &&
      isSalesRole(typeof getCurrentRole === 'function' ? getCurrentRole() : '');
    const _groupBySales = _salesMode && !_accountGuid;

    function _renderSessionCard(s, opts) {
      const date = new Date(s.visited_at).toLocaleDateString('th-TH',{day:'numeric',month:'short'});
      const dur = s.duration_secs ? _fmt(s.duration_secs) : '';
      const acctLabel = s.account_name || (portviewBulkData?.find(r=>r.account_guid===s.account_id)?.res_name) || s.account_id || '—';
      const skills = s.skill_scores?.skills || [];
      const skillDots = skills.slice(0,6).map(sk => {
        const sc = sk.tl_override || sk.score;
        const col = sc==='pass'?'var(--success,#34C759)':sc==='developing'?'var(--warning,#FF9500)':'var(--n-100,#E5E5EA)';
        return `<span style="display:inline-flex;align-items:center;gap:3px;font-size:9px;color:${col};font-family:var(--mono,'Noto Sans Thai',monospace)"><span style="width:5px;height:5px;border-radius:50%;background:${col};flex-shrink:0"></span>${sk.code||sk.skill_code||''}</span>`;
      }).join('');
      const actions = (s.next_actions||[]).slice(0,2).map(a=>
        `<span style="font-size:10px;color:var(--ac,#FF385C);background:rgba(255,56,92,.07);padding:3px 8px;border-radius:6px;font-weight:500">${a.action||a}</span>`
      ).join('');
      const titleLeft = opts?.showAccount ? acctLabel : ((_accountGuid || _groupBySales) ? date : acctLabel);
      const titleRight = opts?.showAccount ? date + (dur?' · '+dur:'') : ((_accountGuid || _groupBySales) ? dur : date + (dur?' · '+dur:''));
      return `<div style="background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border-radius:14px;border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 3px 16px rgba(0,0,0,.045);padding:12px 14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
          <span style="font-size:12px;font-weight:600;color:var(--tx,#1C1C1E)">${titleLeft}</span>
          <span style="font-size:10px;color:var(--tx3,#AEAEB2);font-family:'Noto Sans Thai',sans-serif">${titleRight}</span>
        </div>
        ${skillDots ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:${actions?'8px':'0'}">${skillDots}</div>` : ''}
        ${actions ? `<div style="display:flex;gap:6px;flex-wrap:wrap">${actions}</div>` : ''}
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

  // ── Inline picker builders (Echo design system) ──────────────────────────────
  function _buildKamPickerInline() {
    let recentRows = '';
    try {
      if (typeof portviewBulkData !== 'undefined' && portviewBulkData.length) {
        const sorted = portviewBulkData
          .filter(r => r.res_name)
          .sort((a,b) => (b.gmv_mtd||0) - (a.gmv_mtd||0))
          .slice(0, 6);
        recentRows = sorted.map(r => `
          <button style="display:flex;align-items:center;justify-content:space-between;width:100%;padding:12px 16px;border-radius:14px;border:none;background:rgba(255,255,255,.72);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:0.5px solid rgba(255,255,255,.55);box-shadow:inset 0 1px 0 rgba(255,255,255,.9),0 2px 8px rgba(0,0,0,.04);cursor:pointer;font-family:'Noto Sans Thai',sans-serif;text-align:left"
            onclick="CI._pickerConfirmKam('${r.account_guid}','${(r.res_name||'').replace(/'/g,"\\'")}','${r.account_type||''}')">
            <span style="font-size:13px;font-weight:500;color:#1C1C1E;flex:1">${r.res_name}</span>
            <span style="font-size:10px;font-weight:600;color:#FF385C;font-family:'Noto Sans Thai',sans-serif;letter-spacing:.06em">${r.account_type||''}</span>
          </button>`).join('');
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
    return `
      <div style="font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:#AEAEB2;font-family:'Noto Sans Thai',sans-serif;padding:4px 0 8px">คุณกำลังคุยกับร้านไหน?</div>
      <input id="ci-sales-name-inline" type="text" placeholder="ชื่อร้าน..." autocomplete="off"
        style="width:100%;padding:13px 16px;border:1.5px solid #FF385C;border-radius:12px;font-size:15px;outline:none;font-family:'Noto Sans Thai',sans-serif;background:#fff;color:#1C1C1E;-webkit-appearance:none"
        onkeydown="if(event.key==='Enter')CI._pickerConfirmSales(this.value)" />
      <button onclick="CI._pickerConfirmSales(document.getElementById('ci-sales-name-inline').value)"
        style="width:100%;padding:14px;border:none;border-radius:14px;background:#FF385C;color:#fff;font-size:15px;font-weight:500;cursor:pointer;font-family:'Noto Sans Thai',sans-serif;letter-spacing:-.02em">
        เริ่มบันทึก
      </button>
      <div style="text-align:center;font-size:12px;color:#AEAEB2;padding:4px 0">พิมพ์ชื่อร้าน แล้วกด Enter หรือปุ่มด้านบน</div>`;
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
      const src = (window.portviewBulkData && window.portviewBulkData.length)
        ? window.portviewBulkData
        : (typeof portviewBulkData !== 'undefined' ? portviewBulkData : []);
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
    _phase = 'idle'; _lastResult = null; _secs = 0; _sessionId = null;
    _unmount();
    // Detect owner type from profile
    const role = (typeof getCurrentRole === 'function') ? getCurrentRole() : 'rep';
    _ownerType = (role === 'sales') ? 'sales' : 'kam';

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

  function _hidePicker() {
    // Hide inline picker, reveal record UI + update chip
    const pickerSec = document.getElementById('ci-picker-sec');
    const recCenter = document.getElementById('ci-rec-center');
    const wf = document.getElementById('ci-wf');
    const recBottom = document.querySelector('#ci-s-record .rec-bottom');
    const chip = document.getElementById('ci-chip-wrap');
    if (pickerSec) pickerSec.style.display = 'none';
    if (recCenter) recCenter.style.display = '';
    if (wf) wf.style.display = '';
    if (recBottom) recBottom.style.display = '';
    if (chip) {
      chip.style.display = '';
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
  }

  function _pickerConfirmSales(name) {
    if (!name || !name.trim()) return;
    _accountGuid = null; _accountName = name.trim(); _accountSeg = 'LEAD';
    _showPicker = false;
    _hidePicker();
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
  return { open, startRecording, stopRecording, cancel, _tab, _save: () => { _saveToSupabase(_lastResult?.skillData, _lastResult?.intelData); cancel(); }, _openDebrief, _closeDebrief, _debriefPick, _debriefNote, _saveDebrief, _openHistory, _closeHistory, _openSkillTrend, _closeTrend, _dismissPicker, _hidePicker, _pickerConfirmKam, _pickerConfirmSales, _pickerSearch, _pickerSearchInline, _minimize, _switchMainTab, _topbarLeft };

})();

function ciOpen(accountGuid) { CI.open(accountGuid); }
function echoOpen() { CI.open(null); }
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
  if (sheet) { sheet.style.display = ''; sheet.classList.add('ci-open'); }
  else { CI.open(null); }
}
