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
  position:fixed;inset:0;z-index:9999;
  background:var(--n-50,#F2F2F7);
  font-family:'DM Sans',-apple-system,sans-serif;
  -webkit-font-smoothing:antialiased;
  display:flex;flex-direction:column;
  transform:translateY(100%);
  transition:transform 380ms cubic-bezier(0.16,1,0.3,1);
}
#ci-fullsheet.ci-open { transform:translateY(0); }
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

      _setStep('Building next actions...', 'Claude Sonnet', 96);
      await _save(skillData, intelData);

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
  const _SKILL_SYS = `คุณคือ AI coach สำหรับ Freshket sales team วิเคราะห์ transcript การสนทนาระหว่าง KAM กับลูกค้าร้านอาหาร match กับ 14 skill cards: APIPC(PIPC Framework) A5(Freshket Value) A9(Planning) A10(Pipeline) B2(Decision Maker) B3(Appointment) B4(Pre-Visit Prep) C0(Rapport) C1(Discovery 7 dimensions) C3(Connect Pain) C4(Objection) C5(Close) D1(Wallet Size) D2(Follow-Up). ตอบ JSON เท่านั้น: {"skills":[{"code":"C0","score":"pass|developing|not_observed","evidence_summary":"..."}],"pipc_stage":"P1|I|P2|C","overall":"strong|developing|needs_work"}`;

  const _INTEL_SYS = `คุณคือ customer intelligence analyst ตอบ JSON เท่านั้น: {"buyer_type":"price|relationship|value|convenience","buyer_icon":"🤝|💰|💎|⚡","buyer_evidence":"...","pain_points":[{"dimension":"Quality|Price|Delivery|Product|Completeness|Expansion|Credit","severity":"high|medium|opportunity","summary":"..."}],"next_actions":[{"action":"...","owner":"KAM|TL","urgency":"3_days|this_week|next_visit"}]}`;

  async function _analyzeSkills(text) {
    const raw = await callAI('haiku', _SKILL_SYS, [{ role: 'user', content: `Transcript:\n${text}` }], 2000);
    return JSON.parse((raw?.content?.[0]?.text||'').trim().replace(/```json|```/g,''));
  }

  async function _analyzeIntel(text) {
    const ctx = _ctx();
    const raw = await callAI('sonnet', _INTEL_SYS, [{ role: 'user', content: `ร้าน: ${ctx.name} (${ctx.seg})\nTranscript:\n${text}` }], 2000);
    return JSON.parse((raw?.content?.[0]?.text||'').trim().replace(/```json|```/g,''));
  }

  // ── Supabase save ──────────────────────────────────────────────────────────
  async function _save(skillData, intelData) {
    if (!skillData && !intelData) return;
    const email = currentUserProfile?.email;
    if (!email) return;
    const today = new Date().toISOString().split('T')[0];
    // save to kam_skill_log
    if (skillData?.skills?.length) {
      const rows = skillData.skills.map(s => ({
        kam_email: email, account_id: _accountGuid,
        session_date: today, skill_code: s.code,
        score: s.score, evidence_summary: s.evidence_summary || ''
      }));
      await supa.from('kam_skill_log').insert(rows);
    }
    // upsert ci columns to kam_visits
    await supa.from('kam_visits').upsert({
      kam_email: email, account_id: _accountGuid, visit_date: today,
      ci_skill_scores: skillData, ci_customer_signals: intelData,
      ci_next_actions: intelData?.next_actions || [], ci_mode: 'voice'
    }, { onConflict: 'kam_email,account_id,visit_date' });
  }

  // ── Render result panels ───────────────────────────────────────────────────
  function _renderResult() {
    const { skillData, intelData } = _lastResult;
    document.getElementById('ci-p0').innerHTML = _skillsPanel(skillData);
    document.getElementById('ci-p1').innerHTML = _customerPanel(intelData);
    document.getElementById('ci-p2').innerHTML = _actionsPanel(intelData);
  }

  function _skillsPanel(d) {
    const stages = ['P · Rapport','I · Discovery','P · Pitch','C · Close'];
    const stageIdx = {P1:0,I:1,P2:2,C:3}[d?.pipc_stage] ?? 0;
    const segs = stages.map((l,i) =>
      `<div class="pipc-seg${i<=stageIdx?' done':''}"></div>`).join('');
    const lbls = stages.map((l,i) =>
      `<span class="pipc-lbl${i<=stageIdx?' done':''}">${l}</span>`).join('');
    const rows = (d?.skills||[]).map(s => {
      const dc = s.score==='pass'?'pass':s.score==='developing'?'dev':'no';
      const bl = s.score==='pass'?'Pass':s.score==='developing'?'Developing':'Not observed';
      return `<div class="skill-row">
        <div class="sk-dot ${dc}"></div>
        <div class="sk-body">
          <div class="sk-head"><span class="sk-name">${s.code}</span><span class="sk-badge ${dc}">${bl}</span></div>
          <p class="sk-note">${s.evidence_summary||'-'}</p>
        </div>
      </div>`;
    }).join('');
    return `<div class="eyebrow">PIPC Progress</div>
      <div class="pipc-track">${segs}</div>
      <div class="pipc-labels">${lbls}</div>${rows}`;
  }

  function _customerPanel(d) {
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
    return `<div class="buyer-card">
        <div class="buyer-icon-wrap">${d?.buyer_icon||'🤝'}</div>
        <div>
          <div class="buyer-lbl">Buyer Type</div>
          <div class="buyer-type">${d?.buyer_type||'-'}</div>
          <div class="buyer-ev">${d?.buyer_evidence||''}</div>
        </div>
      </div>
      <div class="eyebrow">Pain Points</div>${painRows}`;
  }

  function _actionsPanel(d) {
    return (d?.next_actions||[]).map((a,i) => {
      const uc = a.urgency==='3_days'?'hi':'md';
      const ul = a.urgency==='3_days'?'ภายใน 3 วัน':a.urgency==='this_week'?'สัปดาห์นี้':'visit ถัดไป';
      return `<div class="action-card">
        <div class="action-top"><span class="action-n">${String(i+1).padStart(2,'0')}</span><span class="urg ${uc}">${ul}</span></div>
        <p class="action-txt">${a.action}</p>
        <span class="action-who">${a.owner}</span>
      </div>`;
    }).join('');
  }

  // ── Public ─────────────────────────────────────────────────────────────────
  function open(accountGuid) {
    _accountGuid = accountGuid || (typeof currentAccountId !== 'undefined' ? currentAccountId : null);
    _phase = 'idle'; _lastResult = null; _secs = 0;
    _unmount();
    setTimeout(_mount, 50);
  }

  return { open, startRecording, stopRecording, cancel, _tab, _save: () => { cancel(); } };
})();

function ciOpen(accountGuid) { CI.open(accountGuid); }
