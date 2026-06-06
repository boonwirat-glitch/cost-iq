// =============================================================================
// 09_conv_intel.js — Conversation Intelligence Module
// CSS + HTML ตรงจาก ci_mockup_v2 — ห้ามแก้ design โดยไม่ update mockup ด้วย
// =============================================================================

const CI = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const WORKER_URL = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
  const MAX_SECS   = 180;

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
      if (row) return { name: row.res_name||'-', seg: row.account_type||'-', days: row.days_with_current_kam||0 };
    }
    return { name: _accountName||'-', seg: _accountSeg||'-', days: 0 };
  }

  // ── CSS from mockup (verbatim) ─────────────────────────────────────────────
  const _CSS = `
/* ── SPEC TOKENS ── */
:root{
  --n-0:#FFFFFF;--n-50:#F2F2F7;--n-100:#E5E5EA;--n-200:#AEAEB2;--n-400:#636366;--n-900:#1C1C1E;
  --teal:#008065;--teal-h:#00a882;
  --teal-5:rgba(0,128,101,.05);--teal-8:rgba(0,128,101,.08);--teal-12:rgba(0,128,101,.12);--teal-20:rgba(0,128,101,.20);
  --danger:#FF3B30;--danger-bg:rgba(255,59,48,.08);
  --warning:#FF9500;--warning-bg:rgba(255,149,0,.08);
  --success:#34C759;
  --glass-0:rgba(255,255,255,.72);--glass-1:rgba(255,255,255,.88);
  --glass-border:rgba(255,255,255,.55);--glass-spec:rgba(255,255,255,.90);
  --bg:var(--n-50);--tx:var(--n-900);--tx2:var(--n-400);--tx3:var(--n-200);
  --br:var(--n-100);--ac:var(--teal);--ac-h:var(--teal-h);
  --font:'DM Sans',-apple-system,sans-serif;--mono:'DM Mono','IBM Plex Mono',monospace;
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
.tb-lbl{font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);}
.tb-rec{font-size:12px;font-weight:500;color:var(--ac);display:flex;align-items:center;gap:5px;font-family:var(--mono);}
.rec-dot{width:5px;height:5px;border-radius:50%;background:var(--danger);opacity:0;transition:opacity .3s;}
.rec-dot.on{opacity:1;animation:blink 1.3s ease-in-out infinite;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.15}}

/* ── CHIP ── */
.chip{display:inline-flex;align-items:center;gap:6px;padding:5px 12px;border-radius:100px;background:rgba(0,0,0,.04);}
.chip-dot{width:5px;height:5px;border-radius:50%;background:var(--ac);flex-shrink:0;}
.chip-txt{font-size:13px;color:var(--tx2);letter-spacing:-.01em;}
.chip-seg{font-size:10px;font-weight:500;color:var(--ac);font-family:var(--mono);letter-spacing:.06em;}

/* ── RECORD CENTER ── */
.rec-center{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:28px;padding:0 24px;}

/* ── ORB ── */
.orb-wrap{position:relative;width:200px;height:200px;display:flex;align-items:center;justify-content:center;}
.orb-ring{position:absolute;border-radius:50%;border:1px solid var(--teal-12);opacity:0;pointer-events:none;}
.orb-ring-1{width:100%;height:100%;}
.orb-ring-2{width:136%;height:136%;border-color:var(--teal-8);}
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
.is-rec .orb-outer{box-shadow:inset 0 1px 0 rgba(255,255,255,.95),0 8px 36px rgba(0,128,101,.13);}
.orb-core{
  width:114px;height:114px;border-radius:50%;
  background:var(--n-0);
  box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 14px rgba(0,0,0,.09);
  display:flex;align-items:center;justify-content:center;
  transition:box-shadow 220ms var(--ease);
}
.is-rec .orb-core{box-shadow:inset 0 1.5px 0 rgba(255,255,255,1),0 3px 18px rgba(0,128,101,.16);}
.orb-core svg{width:38px;height:38px;color:var(--ac);transition:transform 120ms var(--ease);}
.is-rec .orb-core svg{transform:scale(1.08);}

/* ambient — very subtle, only when recording */
.orb-ambient{
  position:absolute;width:280px;height:280px;border-radius:50%;
  background:radial-gradient(circle,rgba(0,128,101,.06) 0%,transparent 65%);
  pointer-events:none;opacity:0;transition:opacity 600ms var(--ease);
}
.is-rec .orb-ambient{opacity:1;}

/* ── TIMER ── */
.timer-block{text-align:center;}
.timer-val{font-size:52px;font-weight:200;letter-spacing:-.04em;line-height:1;color:var(--tx);font-variant-numeric:tabular-nums;}
.timer-hint{font-size:10px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);margin-top:5px;font-family:var(--mono);transition:color 220ms;}
.is-rec .timer-hint{color:var(--ac);}

/* ── WAVEFORM ── */
.waveform{display:flex;align-items:center;gap:2.5px;height:44px;padding:0 28px;width:100%;}
.wb{flex:1;border-radius:3px;background:var(--teal-20);height:3px;min-height:3px;transition:height .11s ease,opacity .11s ease;opacity:.25;}
.is-rec .wb{opacity:.55;}

/* ── RECORD BOTTOM ── */
.rec-bottom{padding:8px 24px 40px;display:flex;flex-direction:column;gap:10px;}
.btn-stop{
  width:100%;padding:15px;border-radius:14px;border:none;
  background:rgba(0,0,0,.055);color:var(--tx2);
  font-family:var(--font);font-size:15px;font-weight:500;letter-spacing:-.02em;
  cursor:pointer;transition:background 120ms,color 120ms,transform 60ms linear;
}
.btn-stop:hover{background:rgba(0,0,0,.08);color:var(--tx);}
.btn-stop:active{transform:scale(.98);}
.stop-hint{text-align:center;font-size:11px;color:var(--tx3);font-family:var(--mono);letter-spacing:.04em;}

/* ── PROCESSING SCREEN ── */
.proc-wrap{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:40px 24px;}
.proc-dots{display:flex;gap:7px;align-items:center;margin-bottom:16px;}
.proc-dot{width:7px;height:7px;border-radius:50%;background:var(--ac);opacity:.2;animation:dbreathe 1.2s ease-in-out infinite;}
.proc-dot:nth-child(2){animation-delay:.2s;}
.proc-dot:nth-child(3){animation-delay:.4s;}
@keyframes dbreathe{0%,100%{opacity:.2;transform:scale(.8)}50%{opacity:1;transform:scale(1.1)}}
.proc-step{font-size:15px;font-weight:400;color:var(--tx);letter-spacing:-.02em;text-align:center;}
.proc-sub{font-size:10px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);margin-top:3px;text-align:center;}
.proc-line{width:148px;height:1px;background:var(--n-100);border-radius:1px;margin-top:24px;overflow:hidden;}
.proc-fill{height:100%;background:var(--ac);width:0%;transition:width .65s var(--ease);}

/* ── RESULT SCREEN ── */
.result-hdr{padding:20px 24px 0;}
.result-meta{display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.result-acct{font-size:16px;font-weight:500;letter-spacing:-.02em;color:var(--tx);}
.dur-chip{display:inline-flex;align-items:center;padding:4px 10px;border-radius:100px;background:rgba(0,0,0,.04);font-family:var(--mono);font-size:12px;color:var(--tx3);letter-spacing:.02em;}

/* ── TAB BAR — sliding pill ── */
.tab-bar{position:relative;display:flex;background:rgba(0,0,0,.042);border-radius:10px;padding:3px;gap:0;margin-bottom:18px;}
.tab-pill{position:absolute;top:3px;bottom:3px;background:var(--n-0);border-radius:7px;box-shadow:0 1px 4px rgba(0,0,0,.10);pointer-events:none;transition:left 120ms var(--ease),width 120ms var(--ease);}
.tab-btn{flex:1;padding:8px 6px;font-size:12px;font-weight:500;color:var(--tx3);background:transparent;border:none;border-radius:7px;cursor:pointer;font-family:var(--font);letter-spacing:-.01em;transition:color 120ms;position:relative;z-index:1;white-space:nowrap;}
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
.pipc-lbl{font-size:9px;font-weight:500;letter-spacing:.12em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);transition:color 220ms;}
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
.sk-badge{font-size:9px;font-weight:500;letter-spacing:.08em;text-transform:uppercase;font-family:var(--mono);}
.sk-badge.pass{color:var(--success);}
.sk-badge.dev{color:var(--warning);}
.sk-badge.no{color:var(--tx3);}
.sk-note{font-size:12px;color:var(--tx2);line-height:1.5;letter-spacing:-.005em;}

/* eyebrow */
.eyebrow{font-size:9px;font-weight:500;letter-spacing:.16em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);margin-bottom:12px;}

/* BUYER CARD */
.buyer-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:16px;border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 4px 20px rgba(0,0,0,.05);
  padding:16px;display:flex;align-items:center;gap:14px;margin-bottom:24px;
}
.buyer-icon-wrap{width:46px;height:46px;border-radius:12px;background:var(--n-50);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;}
.buyer-lbl{font-size:9px;font-weight:500;letter-spacing:.14em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);margin-bottom:4px;}
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
.pain-dim{font-size:9px;font-weight:500;letter-spacing:.13em;text-transform:uppercase;color:var(--tx3);font-family:var(--mono);margin-bottom:3px;}
.pain-txt{font-size:12px;color:var(--tx2);line-height:1.5;}

/* ACTION CARDS */
.action-card{
  background:var(--glass-0);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);
  border-radius:14px;border:0.5px solid var(--glass-border);
  box-shadow:inset 0 1px 0 var(--glass-spec),0 3px 16px rgba(0,0,0,.045);
  padding:14px 16px;margin-bottom:8px;
}
.action-top{display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;}
.action-n{font-size:10px;font-weight:500;color:var(--tx3);font-family:var(--mono);letter-spacing:.08em;}
.urg{font-size:9px;font-weight:500;padding:3px 8px;border-radius:100px;letter-spacing:.06em;text-transform:uppercase;font-family:var(--mono);}
.urg.hi{background:var(--danger-bg);color:var(--danger);}
.urg.md{background:var(--warning-bg);color:var(--warning);}
.action-txt{font-size:12px;color:var(--tx);line-height:1.5;margin-bottom:5px;letter-spacing:-.01em;}
.action-who{font-size:10px;color:var(--tx3);font-family:var(--mono);letter-spacing:.04em;}

/* RESULT CTA */
.result-cta{display:flex;gap:8px;padding:14px 24px 40px;}
.btn{flex:1;padding:14px;border-radius:14px;border:none;font-family:var(--font);font-size:15px;font-weight:500;letter-spacing:-.02em;cursor:pointer;transition:opacity 60ms linear,transform 60ms linear;}
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
  background:var(--n-50,#F2F2F7);
  font-family:'DM Sans',-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
  overflow:hidden;
}
#ci-fullsheet.ci-open { transform:translateX(-50%) translateY(0); }
#ci-fullsheet .scr { display:none; flex-direction:column; flex:1; min-height:0; }
#ci-fullsheet .scr.on { display:flex; }
`;

  // ── Mount / unmount sheet ──────────────────────────────────────────────────
  function _mount() {
    if (document.getElementById('ci-fullsheet')) return;
    // inject font
    if (!document.getElementById('ci-font')) {
      const l = document.createElement('link');
      l.id = 'ci-font'; l.rel = 'stylesheet';
      l.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,200;9..40,400;9..40,500&family=DM+Mono:wght@400;500&display=swap';
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

  // ── HTML (structure from mockup) ───────────────────────────────────────────
  function _buildHTML() {
    const ctx = _ctx();
    return `
<div id="ci-s-record" class="scr on">
  <div class="topbar">
    <span class="tb-act" onclick="CI.cancel()">ยกเลิก</span>
    <span class="tb-lbl">Conversation Intel</span>
    <span class="tb-rec"><span class="rec-dot" id="ci-rdot"></span><span id="ci-rlbl">Full Record</span></span>
  </div>
  <div style="padding:0 24px 16px">
    <div class="chip">
      <div class="chip-dot"></div>
      <span class="chip-txt">${ctx.name}</span>
      <span class="chip-seg">${ctx.seg}</span>
    </div>
  </div>
  <div class="rec-center" id="ci-rec-center">
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
  <div class="waveform" id="ci-wf"></div>
  <div class="rec-bottom">
    <button class="btn-stop" onclick="CI.stopRecording()">หยุด &amp; วิเคราะห์</button>
    <span class="stop-hint">ระบบจะ transcribe และวิเคราะห์ด้วย AI อัตโนมัติ</span>
    <button onclick="CI._openHistory()" style="background:none;border:none;font-size:11px;color:var(--tx3,#AEAEB2);cursor:pointer;font-family:'DM Mono','IBM Plex Mono',monospace;letter-spacing:.06em;text-transform:uppercase;padding:4px 0">ดูประวัติ</button>
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
    <button onclick="CI._openDebrief()" style="flex:1;padding:10px;border-radius:12px;border:0.5px solid rgba(83,74,183,.3);background:rgba(83,74,183,.07);color:#534AB7;font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',-apple-system,sans-serif">Debrief</button>
    <button onclick="CI._openHistory()" style="flex:1;padding:10px;border-radius:12px;border:0.5px solid rgba(0,0,0,.12);background:rgba(0,0,0,.04);color:var(--tx2,#636366);font-size:13px;font-weight:500;cursor:pointer;font-family:'DM Sans',-apple-system,sans-serif">ประวัติ</button>
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
    _setStep('Transcribing...', 'Whisper · ภาษาไทย', 14);
  }

  function cancel() {
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

  // ── Audio → transcript ─────────────────────────────────────────────────────
  async function _onStop() {
    const blob = new Blob(_chunks, { type: _recorder?.mimeType || 'audio/webm' });
    _chunks = [];
    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      form.append('prompt', 'การสนทนาระหว่าง sales rep กับเจ้าของร้านอาหาร เรื่องวัตถุดิบ freshket');
      const res = await fetch(`${WORKER_URL}/transcribe`, { method: 'POST', body: form });
      if (!res.ok) throw new Error(`transcribe ${res.status}`);
      const { text } = await res.json();
      if (!text || text.trim().length < 5) throw new Error('transcript ว่างเปล่า');

      _setStep('Analyzing skills...', 'Claude Haiku · 14 skills', 44);
      const skillData = await _analyzeSkills(text);

      _setStep('Reading customer signals...', 'Claude Sonnet · restaurant context', 74);
      const intelData = await _analyzeIntel(text);

      _setStep('Saving...', '', 96);
      await _saveToSupabase(skillData, intelData);

      _setStep('Done', '', 100);
      setTimeout(() => {
        _lastResult = { skillData, intelData };
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
  // SKILL RUBRIC — source of truth จาก Modules Sales Lead (Feb 2026)
  // แต่ละ skill มี: principle (ทำไม), pass_criteria (ผ่านต้องทำอะไรได้),
  //                 observable (สัญญาณที่ฟังออกได้จาก transcript)
  // B1 ตัดออก — เป็น pre-visit activity ไม่มีใน conversation
  //
  const _SKILL_RUBRIC = [
    {
      code: 'APIPC',
      name: 'PIPC Framework',
      principle: 'ทุกการสนทนาต้องเป็นไปตามลำดับ Prepare→Identify→Probe→Close — ไม่ใช่ script แต่เป็นเครื่องมือวินิจฉัย',
      pass_criteria: [
        'สามารถระบุได้ว่า benchmark กับใคร และนำ value ไปตอบโจทย์ได้เหมาะสม',
        'ถ้า conversation เริ่มจาก price → สามารถ redirect กลับมาที่ value ได้',
        'ครบ 4 ขั้นตอน: แนะนำตัว/FKT → ถามหา need/pain → เชื่อม solution → มี next step'
      ],
      observable: 'ลำดับการพูด — มีการ introduce ก่อน probe ก่อน pitch, ไม่ขาย product ก่อนถาม pain',
      ci_scope: 'full'
    },
    {
      code: 'A5',
      name: 'Freshket Value & USP',
      principle: 'เปลี่ยนมุมมองลูกค้าจาก "ซัพฯ อีกเจ้า" → "พันธมิตรที่ขจัดความเสี่ยงประจำวัน"',
      pass_criteria: [
        'อธิบาย 3-tier logic ได้: สิ่งที่ซัพฯ ทุกเจ้ามี / สิ่งที่ FKT ทำได้ดีกว่า / สิ่งที่ FKT เท่านั้นมี',
        'เชื่อม value เข้ากับบริบทของร้านนั้นๆ ไม่ใช่แค่ list feature'
      ],
      observable: 'rep พูดถึง quality/delivery/completeness/OMS ในบริบทของปัญหาร้านนั้น ไม่ใช่ท่อง spec',
      ci_scope: 'full'
    },
    {
      code: 'A9',
      name: 'Planning & Target Tracking',
      principle: 'การวางแผนคือเครื่องมือคิด ไม่ใช่แบบฟอร์ม',
      pass_criteria: [
        'กล่าวถึง target/plan/priority ในการสนทนา — มีตรรกะรองรับตัวเลข ไม่ใช่แค่บอกว่าจะทำมากขึ้น'
      ],
      observable: 'rep mention เป้า/แผน/ลำดับความสำคัญระหว่างคุย — แต่ behavior จริงอยู่นอก conversation',
      ci_scope: 'partial'
    },
    {
      code: 'A10',
      name: 'Pipeline Management',
      principle: 'Lead ดีมีชัยไปกว่าครึ่ง',
      pass_criteria: [
        'กล่าวถึง stage ของลูกค้า + next activity ที่จะทำได้ชัดเจน',
        'วิเคราะห์แยก Hot/Warm/Cold ได้พร้อม logic'
      ],
      observable: 'rep mention next step/stage/timeline ที่ชัดเจน — quality ของ pipeline จริงอยู่นอก conversation',
      ci_scope: 'partial'
    },
    {
      code: 'B2',
      name: 'Finding the Decision Maker',
      principle: 'เจอคนตัดสินใจ → ปิดขายเร็วขึ้น',
      pass_criteria: [
        'ระบุ stakeholder ที่คุยอยู่ได้: Gatekeeper / Decision Maker / User',
        'มีวิธีคุยที่ต่างกันในแต่ละ role (owner / chef / จัดซื้อ / บัญชี / ผจก.ร้าน)',
        'confirm authority ก่อน pitch จริงจัง'
      ],
      observable: 'rep ถามหรือ confirm role ของคนที่คุยด้วย ก่อนเริ่ม pitch ลึก',
      ci_scope: 'full'
    },
    {
      code: 'B3',
      name: 'Making an Appointment',
      principle: 'เป้าหมายการโทรไม่ใช่ขาย FKT แต่คือขาย "เวลา 20 นาที" ของเจ้าของร้าน',
      pass_criteria: [
        'พูดด้วยความมั่นใจ อธิบาย FKT ได้กระชับ',
        'handle objection ได้อย่างน้อย 3 สถานการณ์',
        'จบด้วยการนัด + ระบุ role ของลูกค้า + timeline ชัดเจน'
      ],
      observable: 'มีการนัดเวลาที่เฉพาะเจาะจง หรือ commit next meeting ในการสนทนา',
      ci_scope: 'full'
    },
    {
      code: 'B4',
      name: 'Pre-Visit Preparation',
      principle: 'rep ที่เตรียมดีจะถามคำถามได้ดีกว่า เพราะรู้แล้วว่าคำถามไหนสำคัญ',
      pass_criteria: [
        'ระบุ DM ที่น่าจะเป็นได้พร้อมเหตุผล',
        'วิเคราะห์เมนูเพื่อหา SKU ที่เหมาะได้',
        'มีสินค้า 3 รายการที่จะเสนอพร้อม logic'
      ],
      observable: 'อนุมานจากคุณภาพคำถาม — rep ที่เตรียมดีจะถามเจาะจง ไม่ถาม generic',
      ci_scope: 'partial'
    },
    {
      code: 'C0',
      name: 'Rapport & Reading the Room',
      principle: 'ขายของกับคนที่ยังไม่เชื่อใจไม่ได้ — ต้องอ่านทัศนคติลูกค้าก่อนแล้วปรับตัว',
      pass_criteria: [
        'วิเคราะห์ personality type ของลูกค้าได้ (BANK: Blueprint/Action/Nurturing/Knowledge)',
        'เปิดใจลูกค้าได้ตาม type',
        'รับมือ first impression เชิงลบได้ (ไม่เคยได้ยิน FKT / เคยมีประสบการณ์แย่ / ไม่มีอำนาจตัดสินใจ)'
      ],
      observable: 'ลูกค้า self-disclose pain/context เอง โดย rep ไม่ interrupt — มี small talk ก่อน pitch',
      ci_scope: 'full'
    },
    {
      code: 'C1',
      name: 'Discovery — OCPB Framework',
      principle: 'การตั้งคำถามเพื่อเข้าใจให้ถึงจุดที่ปิดการขายได้',
      pass_criteria: [
        'cover ครบ OCPB: Operation / Competitor+service+price / Payment+Billing / Business Plan',
        'สรุปข้อมูลได้ลึก และระบุช่องโหว่ข้อมูลของตัวเองได้'
      ],
      observable: 'นับ dimensions ที่ rep ถามครอบคลุม: O=ถามเรื่อง ops ร้าน, C=ถามเรื่องซัพเดิม/ราคา, P=ถาม billing/credit, B=ถาม plan ร้าน',
      ci_scope: 'full'
    },
    {
      code: 'C3',
      name: 'Analyze & Connect Pain to Solution',
      principle: 'ปิดช่องว่างระหว่างสิ่งที่ได้ยิน กับสิ่งที่ FKT แก้ได้ — โดยใช้คำพูดของลูกค้าเอง',
      pass_criteria: [
        'ระบุ pain point จากข้อมูลที่ถามมาได้ชัดเจน',
        'เชื่อม pain → FKT value ได้ถูกต้อง ไม่แค่ list feature',
        'ใช้คำหรือ context ที่ลูกค้าพูดมาก่อนในการ pitch'
      ],
      observable: 'rep echo คำพูดลูกค้า + ลิ้งหา solution — ไม่ pitch แบบ generic ที่ไม่ relate กับร้านนั้น',
      ci_scope: 'full'
    },
    {
      code: 'C4',
      name: 'Objection Handling',
      principle: 'คำคัดค้านไม่ใช่การปฏิเสธ — เป็นสัญญาณว่าลูกค้ายังประเมินอยู่',
      pass_criteria: [
        'ใช้ sequence: Acknowledge → Clarify → Reframe → Confirm',
        'ไม่ defend ทันที — รับทราบก่อน เข้าใจก่อน',
        'handle ได้ใน 4 หัวข้อหลัก: Quality / Price / Completeness / Logistics'
      ],
      observable: 'เมื่อลูกค้า object: rep ไม่รีบโต้ตอบ มีการ acknowledge + ถามเพิ่ม ก่อน reframe',
      ci_scope: 'full'
    },
    {
      code: 'C5',
      name: 'Close & Next Step',
      principle: 'การปิดขายต้องมี next step ชัดว่า action อะไรที่จะทำให้เกิดการสั่งซื้อ',
      pass_criteria: [
        'ทวน pain ของลูกค้าก่อนปิด',
        'ยืนยันวันที่ที่แน่นอน',
        'มีอย่างน้อย 1 อย่างที่ลูกค้า commit จะทำ (customer action item)'
      ],
      observable: 'ending ของ conversation — มี pain recap + specific date + customer commitment',
      ci_scope: 'full'
    },
    {
      code: 'D1',
      name: 'Estimating Wallet Size',
      principle: 'จัดลำดับว่าควรลงทุนเวลากับลูกค้าคนนี้แค่ไหน',
      pass_criteria: [
        'ประเมิน Wallet Size และ Wallet Share ได้พร้อม logic',
        'จัด Hot/Warm/Cold พร้อมหลักฐานที่เฉพาะเจาะจง'
      ],
      observable: 'อนุมานจากคำพูด — rep mention category mix / competitor share / potential order size',
      ci_scope: 'partial'
    },
    {
      code: 'D2',
      name: 'Follow-Up with Purpose',
      principle: 'ติดตามต้องมีวัตถุประสงค์ชัด + หา option/solution ใหม่',
      pass_criteria: [
        'มีกลยุทธ์ต่างกันชัดเจนใน 3 กลุ่ม: ยังไม่สั่ง / สั่งแล้วหาย / สั่งน้อยลง-เพิ่มขึ้น',
        'ระบุ actions + timeline ที่เฉพาะเจาะจง'
      ],
      observable: 'next steps ที่ rep commit ใน conversation — มีความชัดเจนในแต่ละ scenario',
      ci_scope: 'full'
    }
  ];

  const _SKILL_SYS = (() => {
    const rubricText = _SKILL_RUBRIC.map(s =>
      `[${s.code}] ${s.name} (${s.ci_scope === 'partial' ? 'partial — อนุมานจากบางส่วน' : 'ประเมินจาก conversation ได้'})
Principle: ${s.principle}
Pass criteria: ${s.pass_criteria.join(' | ')}
สัญญาณที่ฟังได้: ${s.observable}`
    ).join('\n\n');

    return `คุณคือ AI coach สำหรับ Freshket sales team
วิเคราะห์ transcript การสนทนาระหว่าง Sales/KAM กับลูกค้าร้านอาหาร
ประเมินตาม skill rubric ด้านล่าง — ใช้ pass_criteria เป็นเกณฑ์ตัดสิน ไม่ใช่แค่ความรู้สึก

${rubricText}

scoring:
- pass = เห็นหลักฐานชัดว่าทำตาม pass_criteria ได้ครบ
- developing = เริ่มทำแต่ยังไม่ครบ หรือทำได้บางส่วน
- not_observed = ไม่มีส่วนนี้ใน conversation เลย
- not_applicable = skill นี้ไม่ใช้ใน context นี้ (เช่น B3 สำหรับ visit ที่ไม่มีการนัด)

ตอบ JSON เท่านั้น ไม่มี markdown ไม่มี preamble:
{
  "skills": [
    {
      "code": "C0",
      "name": "Rapport & Reading the Room",
      "score": "pass|developing|not_observed|not_applicable",
      "evidence": "คำพูดหรือพฤติกรรมจริงที่เห็นใน transcript (ถ้าไม่มีให้ใส่ '-')",
      "gap": "สิ่งที่ขาดไปจาก pass_criteria (ถ้าผ่านแล้วใส่ '-')",
      "coaching_note": "คำแนะนำสำหรับ TL ใช้ debrief กับ rep (1-2 ประโยค)"
    }
  ],
  "pipc_stage": "Prepare|Identify|Probe|Close",
  "pipc_reached": "ขั้นตอนสูงสุดที่ rep ทำถึงใน conversation นี้",
  "overall": "strong|developing|needs_work",
  "session_summary": "สรุปภาพรวม 2-3 ประโยค — จุดเด่น จุดที่ต้องพัฒนา"
}`;
  })();

  const _INTEL_SYS = `คุณคือ customer intelligence analyst สำหรับ Freshket
วิเคราะห์ insight จากการสนทนากับลูกค้าร้านอาหาร
ใช้ข้อมูลร้านที่ให้มาประกอบการวิเคราะห์

OCPB framework (ตาม C1 Discovery):
- O: Operation — วิธีทำงาน ปัญหา ops ประจำวัน
- C: Competitor/Service/Price — ซัพเดิมคือใคร ปัญหาอะไร เปรียบเทียบราคา
- P: Payment/Billing — credit term, billing cycle, วิธีจ่ายเงิน
- B: Business Plan — แผนขยาย เปิดสาขา เปลี่ยน concept

Buyer type (BANK framework):
- Blueprint (B): ต้องการข้อมูลครบ process ชัด ตัดสินใจช้าแต่ละเอียด
- Action (A): ต้องการผลลัพธ์เร็ว direct to the point ไม่ชอบ process ยาว
- Nurturing (N): ให้ความสำคัญกับความสัมพันธ์ trust ก่อน deal
- Knowledge (K): ต้องการ expertise และ data รองรับทุกอย่าง

ตอบ JSON เท่านั้น ไม่มี markdown:
{
  "buyer_type": "Blueprint|Action|Nurturing|Knowledge",
  "buyer_type_th": "ชื่อภาษาไทย",
  "buyer_icon": "📋|⚡|🤝|🔍",
  "buyer_evidence": "หลักฐานจากการสนทนาว่าทำไมถึง type นี้",
  "ocpb_covered": ["O","C","P","B"],
  "ocpb_missing": ["dimension ที่ยังไม่ถาม"],
  "pain_points": [
    {
      "dimension": "Quality|Price|Delivery|Completeness|Service|Credit",
      "severity": "high|medium|opportunity",
      "summary": "สรุป pain ที่ลูกค้าพูด — ใช้ภาษาใกล้เคียงกับที่ลูกค้าพูด"
    }
  ],
  "upsell_signals": [
    {"category": "หมวดสินค้า", "evidence": "หลักฐานที่บ่งชี้ถึงความต้องการ"}
  ],
  "wallet_estimate": "hot|warm|cold",
  "wallet_logic": "เหตุผลที่ประเมิน hot/warm/cold",
  "next_actions": [
    {
      "action": "สิ่งที่ต้องทำ",
      "owner": "KAM|TL",
      "urgency": "3_days|this_week|next_visit",
      "reason": "ทำไมถึง urgent ระดับนี้"
    }
  ]
}`;

  async function _analyzeSkills(text) {
    const raw = await callAI('haiku', _SKILL_SYS, [{ role: 'user', content: `Transcript:\n${text}` }], 6000);
    const txt = (raw?.content?.[0]?.text||'').trim().replace(/```json\n?|```/g,'').trim();
    console.log('[CI skills raw]', txt.substring(0,400));
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('skills no JSON: ' + txt.substring(0,80));
    return JSON.parse(txt.slice(s, e+1));
  }

  async function _analyzeIntel(text) {
    const ctx = _ctx();
    const accountCtx = `ข้อมูลร้าน:
- ชื่อ: ${ctx.name}
- Segment: ${ctx.seg}
- อยู่กับ rep มา: ${ctx.days} วัน`;
    const raw = await callAI('sonnet', _INTEL_SYS, [{
      role: 'user',
      content: `${accountCtx}\n\nTranscript:\n${text}`
    }], 6000);
    const txt = (raw?.content?.[0]?.text||'').trim().replace(/```json\n?|```/g,'').trim();
    console.log('[CI intel raw]', txt.substring(0,400));
    const s = txt.indexOf('{'), e = txt.lastIndexOf('}');
    if (s === -1 || e === -1) throw new Error('intel no JSON: ' + txt.substring(0,80));
    return JSON.parse(txt.slice(s, e+1));
  }

  // ── Supabase save ──────────────────────────────────────────────────────────
  async function _saveToSupabase(skillData, intelData) {
    if (!skillData && !intelData) return;
    const email = currentUserProfile?.email;
    if (!email) return;
    const today = new Date().toISOString().split('T')[0];
    if (skillData?.skills?.length) {
      const rows = skillData.skills.map(s => ({
        kam_email: email, account_id: _accountGuid,
        session_date: today, skill_code: s.code,
        score: s.score,
        evidence_summary: s.evidence || s.evidence_summary || ''
      }));
      const { error } = await supa.from('kam_skill_log').insert(rows);
      if (error) console.warn('[CI] kam_skill_log insert error:', error.message);
    }
    const { error: visitError } = await supa.from('kam_visits').upsert({
      kam_email: email, account_id: _accountGuid, visit_date: today,
      ci_skill_scores: skillData, ci_customer_signals: intelData,
      ci_next_actions: intelData?.next_actions || [], ci_mode: 'voice',
      ci_created_at: new Date().toISOString()
    }, { onConflict: 'kam_email,account_id,visit_date' });
    if (visitError) console.warn('[CI] kam_visits upsert error:', visitError.message);
  }

  // ── Render result panels ───────────────────────────────────────────────────
  function _renderResult() {
    const { skillData, intelData } = _lastResult;
    document.getElementById('ci-p0').innerHTML = _skillsPanel(skillData);
    document.getElementById('ci-p1').innerHTML = _customerPanel(intelData);
    document.getElementById('ci-p2').innerHTML = _actionsPanel(intelData);
    const tlDiv = document.getElementById('ci-tl-actions');
    if (tlDiv) tlDiv.style.display = _canDebrief() ? 'flex' : 'none';
  }

  function _skillsPanel(d) {
    const PIPC_STAGES = ['Prepare','Identify','Probe','Close'];
    const stageIdx = PIPC_STAGES.indexOf(d?.pipc_stage);
    const reached = stageIdx >= 0 ? stageIdx : 0;
    const segs = PIPC_STAGES.map((l,i) =>
      `<div class="pipc-seg${i<=reached?' done':''}"></div>`).join('');
    const lbls = PIPC_STAGES.map((l,i) =>
      `<span class="pipc-lbl${i<=reached?' done':''}">${l}</span>`).join('');

    const summary = d?.session_summary
      ? `<div style="margin-bottom:20px;padding:12px 14px;background:rgba(0,128,101,.06);border-radius:10px;border:0.5px solid rgba(0,128,101,.15)"><p style="font-size:12px;color:var(--tx2,#636366);line-height:1.6;margin:0">${d.session_summary}</p></div>`
      : '';

    const rows = (d?.skills||[]).map(s => {
      const dc = s.score==='pass'?'pass':s.score==='developing'?'dev':'no';
      const bl = s.score==='pass'?'Pass':s.score==='developing'?'Developing':s.score==='not_applicable'?'N/A':'Not observed';
      const coaching = s.coaching_note && s.coaching_note !== '-'
        ? `<p style="font-size:11px;color:var(--ac,#008065);margin:4px 0 0;font-style:italic;line-height:1.5">💬 ${s.coaching_note}</p>`
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

    return `<div class="eyebrow">PIPC Progress</div>
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
        <div style="width:32px;height:32px;border-radius:8px;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:500;background:${done?'rgba(0,128,101,.12)':'rgba(0,0,0,.04)'};color:${done?'var(--ac,#008065)':'var(--tx3,#AEAEB2)'}">${dim}</div>
        <div style="font-size:9px;color:${done?'var(--ac,#008065)':'var(--tx3,#AEAEB2)'};font-family:var(--mono);letter-spacing:.06em;text-transform:uppercase">${label}</div>
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
            <div style="font-size:12px;font-weight:500;color:var(--ac,#008065);min-width:80px">${u.category}</div>
            <div style="font-size:12px;color:var(--tx2,#636366);flex:1">${u.evidence}</div>
          </div>`).join('')
      : '';

    const walletColor = d?.wallet_estimate==='hot'?'var(--danger,#FF3B30)':d?.wallet_estimate==='warm'?'var(--warning,#FF9500)':'var(--tx3,#AEAEB2)';

    return `<div class="buyer-card">
        <div class="buyer-icon-wrap">${d?.buyer_icon||'🤝'}</div>
        <div style="flex:1">
          <div class="buyer-lbl">Buyer Type (BANK)</div>
          <div class="buyer-type">${d?.buyer_type_th||d?.buyer_type||'-'}</div>
          <div class="buyer-ev">${d?.buyer_evidence||''}</div>
        </div>
        <div style="text-align:center;min-width:48px">
          <div style="font-size:9px;font-weight:500;letter-spacing:.1em;text-transform:uppercase;color:var(--tx3,#AEAEB2);font-family:var(--mono);margin-bottom:3px">Wallet</div>
          <div style="font-size:16px;font-weight:500;color:${walletColor}">${(d?.wallet_estimate||'-').toUpperCase()}</div>
          <div style="font-size:9px;color:var(--tx3,#AEAEB2);font-family:var(--mono)">${d?.wallet_logic||''}</div>
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
        ? `<div style="font-size:10px;color:var(--tx3,#AEAEB2);margin-top:3px;font-family:var(--mono);letter-spacing:.03em">${a.reason}</div>`
        : '';
      return `<div class="action-card">
        <div class="action-top"><span class="action-n">${String(i+1).padStart(2,'0')}</span><span class="urg ${uc}">${ul}</span></div>
        <p class="action-txt">${a.action}</p>
        <span class="action-who">${a.owner}</span>
        ${reason}
      </div>`;
    }).join('');
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
  background:var(--n-50,#F2F2F7);
  font-family:'DM Sans',-apple-system,sans-serif;
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
  font-family:'DM Mono','IBM Plex Mono',monospace;
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
  font-family:'DM Mono','IBM Plex Mono',monospace;
  padding:2px 7px;border-radius:100px;flex-shrink:0;
}
.db-ai-badge.pass { background:rgba(52,199,89,.12);color:#1a7a38; }
.db-ai-badge.dev  { background:rgba(255,149,0,.12);color:#a05800; }
.db-ai-badge.no   { background:rgba(0,0,0,.06);color:#888; }
.db-evidence { font-size:11px;color:var(--n-400,#636366);line-height:1.5;margin-bottom:8px; }
.db-override-row { display:flex;gap:6px;margin-bottom:8px;flex-wrap:wrap; }
.db-pill {
  padding:5px 12px;border-radius:100px;border:0.5px solid rgba(0,0,0,.12);
  font-size:11px;font-weight:500;font-family:'DM Mono','IBM Plex Mono',monospace;
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
  padding:9px 12px;font-size:12px;font-family:'DM Sans',-apple-system,sans-serif;
  color:var(--n-900,#1C1C1E);background:rgba(255,255,255,.7);
  resize:none;min-height:52px;outline:none;line-height:1.5;
  transition:border-color 150ms;
}
.db-note:focus { border-color:rgba(0,128,101,.35); }
.db-note::placeholder { color:var(--n-200,#AEAEB2); }
.db-footer {
  padding:12px 24px 36px;display:flex;gap:8px;flex-shrink:0;
  border-top:0.5px solid var(--n-100,#E5E5EA);
}
.db-btn {
  flex:1;padding:13px;border-radius:14px;border:none;
  font-family:'DM Sans',-apple-system,sans-serif;font-size:15px;
  font-weight:500;letter-spacing:-.02em;cursor:pointer;
  transition:opacity 60ms,transform 60ms;
}
.db-btn:active { transform:scale(.97);opacity:.85; }
.db-btn-primary { background:#008065;color:#fff; }
.db-btn-primary:hover { background:#00a882; }
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
  background:var(--n-50,#F2F2F7);
  font-family:'DM Sans',-apple-system,sans-serif;
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
.hist-rep  { font-size:10px;color:var(--n-400,#636366);font-family:'DM Mono','IBM Plex Mono',monospace;letter-spacing:.03em; }
.hist-skills { display:flex;flex-wrap:wrap;gap:5px;margin-bottom:6px; }
.hist-skill-dot {
  display:flex;align-items:center;gap:4px;
  font-size:10px;font-family:'DM Mono','IBM Plex Mono',monospace;
  color:var(--n-400,#636366);letter-spacing:.03em;
}
.hsd { width:5px;height:5px;border-radius:50%;flex-shrink:0; }
.hsd.pass { background:#34C759; }
.hsd.dev  { background:#FF9500; }
.hsd.no   { background:#AEAEB2; }
.hist-coaching {
  font-size:11px;color:var(--teal,#008065);font-style:italic;line-height:1.5;
  border-top:0.5px solid rgba(0,128,101,.12);padding-top:6px;margin-top:6px;
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
  background:var(--n-50,#F2F2F7);
  font-family:'DM Sans',-apple-system,sans-serif;
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
  font-size:9px;font-family:'DM Mono','IBM Plex Mono',monospace;letter-spacing:.04em;
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

    const skillCodes = _SKILL_RUBRIC.filter(s => s.ci_scope !== 'none').map(s => s.code);

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


  // ── Public ─────────────────────────────────────────────────────────────────
  function open(accountGuid) {
    _accountGuid = accountGuid || (typeof currentAccountId !== 'undefined' ? currentAccountId : null);
    _phase = 'idle'; _lastResult = null; _secs = 0;
    _unmount();
    setTimeout(_mount, 50);
  }

  return { open, startRecording, stopRecording, cancel, _tab, _save: () => { _saveToSupabase(_lastResult?.skillData, _lastResult?.intelData); cancel(); }, _openDebrief, _closeDebrief, _debriefPick, _debriefNote, _saveDebrief, _openHistory, _closeHistory, _openSkillTrend, _closeTrend };

})();

function ciOpen(accountGuid) { CI.open(accountGuid); }
