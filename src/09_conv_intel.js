// =============================================================================
// SECTION:CI_RECORDER
// MediaRecorder wrapper — iOS compat, consent, 60s Phase 1 limit
// =============================================================================

const CI = (() => {
  'use strict';

  // ── Constants ──────────────────────────────────────────────────────────────
  const WORKER_URL   = 'https://freshket-sense-ai-proxy.boonwirat-t.workers.dev';
  const MAX_DURATION = 180; // seconds — Phase 1 cap
  const SUPA_URL     = 'https://menslbnyyvpxiyvjywcm.supabase.co';
  const SUPA_KEY     = 'sb_publishable_DRCzHd782Gry8Edu4ZIiHA_KuOgBIIG';

  // ── State ──────────────────────────────────────────────────────────────────
  let _recorder    = null;
  let _chunks      = [];
  let _startTime   = 0;
  let _timerRef    = null;
  let _accountGuid = null;
  let _sessionId   = null;
  let _phase       = 'idle'; // idle | recording | processing | result | history

  // ── Helpers ────────────────────────────────────────────────────────────────
  function _uuid() {
    return crypto.randomUUID ? crypto.randomUUID()
      : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
          const r = Math.random() * 16 | 0;
          return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
        });
  }

  function _fmt(secs) {
    const m = String(Math.floor(secs / 60)).padStart(2, '0');
    const s = String(secs % 60).padStart(2, '0');
    return `${m}:${s}`;
  }

  function _bestMime() {
    const types = [
      'audio/webm;codecs=opus',
      'audio/webm',
      'audio/mp4',
      'audio/ogg;codecs=opus',
    ];
    for (const t of types) {
      if (MediaRecorder.isTypeSupported(t)) return t;
    }
    return '';
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  async function startRecording() {
    if (_phase !== 'idle') return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = _bestMime();
      _recorder    = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
      _chunks      = [];

      _recorder.ondataavailable = e => { if (e.data && e.data.size > 0) _chunks.push(e.data); };
      _recorder.onstop          = _onRecordStop;
      _recorder.start(1000); // collect every 1s
      _startTime = Date.now();
      _phase     = 'recording';
      _renderSheet();

      // Timer tick
      _timerRef = setInterval(() => {
        const elapsed = Math.floor((Date.now() - _startTime) / 1000);
        const el = document.getElementById('ci-timer');
        if (el) el.textContent = _fmt(elapsed);
        // Waveform pulse
        const wave = document.getElementById('ci-wave');
        if (wave) wave.style.opacity = (Math.sin(Date.now() / 300) * 0.3 + 0.7).toFixed(2);
        // Auto-stop at MAX_DURATION
        if (elapsed >= MAX_DURATION) stopRecording();
      }, 500);

    } catch (err) {
      _phase = 'idle';
      _showToast(err.name === 'NotAllowedError'
        ? 'กรุณาอนุญาตไมโครโฟนก่อนบันทึก'
        : 'เปิดไมค์ไม่ได้: ' + err.message);
    }
  }

  function stopRecording() {
    if (_phase !== 'recording' || !_recorder) return;
    clearInterval(_timerRef);
    _recorder.stop();
    _recorder.stream.getTracks().forEach(t => t.stop());
    _phase = 'processing';
    _renderSheet();
  }

  function cancelRecording() {
    if (_phase === 'recording') {
      clearInterval(_timerRef);
      _recorder && _recorder.stop();
      _recorder && _recorder.stream.getTracks().forEach(t => t.stop());
    }
    _phase       = 'idle';
    _accountGuid = null;
    _sessionId   = null;
    _closeSheet();
  }

  // ==========================================================================
  // SECTION:CI_TRANSCRIBE
  // Audio blob → /transcribe Worker → Thai text
  // ==========================================================================

  async function _onRecordStop() {
    const blob = new Blob(_chunks, { type: _recorder.mimeType || 'audio/webm' });
    _chunks = []; // free memory immediately

    try {
      const transcript = await _transcribe(blob);
      if (!transcript || transcript.trim().length < 10) {
        throw new Error('transcript ว่างเปล่า — ลองบันทึกอีกครั้ง');
      }
      await _analyzeAndSave(transcript);
    } catch (err) {
      _phase = 'idle';
      _renderSheet();
      _showToast('วิเคราะห์ไม่สำเร็จ: ' + err.message);
    }
  }

  async function _transcribe(blob) {
    const form = new FormData();
    form.append('audio', blob, 'recording.webm');
    form.append('prompt', 'การสนทนาระหว่าง sales representative กับเจ้าของร้านอาหาร เรื่องวัตถุดิบ ราคา การส่งของ freshket supplier');

    const res  = await fetch(`${WORKER_URL}/transcribe`, { method: 'POST', body: form });
    if (!res.ok) throw new Error(`transcribe ${res.status}`);
    const data = await res.json();
    return data.text || '';
  }

  // ==========================================================================
  // SECTION:CI_SKILL_ANALYSIS
  // transcript → Claude Haiku → 14 skill scores JSON
  // ==========================================================================

  const SKILL_SYSTEM = `คุณคือ AI coach สำหรับ Freshket sales team
วิเคราะห์ transcript การสนทนาระหว่าง sales rep กับลูกค้าร้านอาหาร
แล้ว match กับ 14 skill cards ต่อไปนี้:

APIPC: PIPC Framework — ดูว่า rep ทำครบ Prepare→Investigate→Propose→Close
A5: Freshket Value — นำเสนอ value ไม่ lead ด้วยราคา
A9: Planning — กล่าวถึง plan/target/priority
A10: Pipeline — กล่าวถึง next step/stage/follow-up date
B2: Decision Maker — confirm authority ก่อน pitch
B3: Appointment — จบด้วย specific date
B4: Pre-Visit Prep — rep รู้ menu/context ก่อนถาม
C0: Rapport — ลูกค้าเปิดเผย pain เอง, rep ไม่ interrupt
C1: Discovery — cover ≥3/7 dimensions (Product/Price/Quality/Delivery/Completeness/Expansion/Credit)
C3: Connect Pain — link ลูกค้า pain → Freshket value ด้วยคำของลูกค้าเอง
C4: Objection — Acknowledge→Clarify→Reframe→Confirm sequence
C5: Close — restate pain + specific date + customer action
D1: Wallet Size — classify Hot/Warm/Cold with evidence
D2: Follow-Up — different strategy per account status

ตอบเป็น JSON เท่านั้น ไม่มี markdown ไม่มี preamble:
{
  "skills": [
    {
      "code": "C0",
      "score": "pass|developing|not_observed|not_applicable",
      "evidence_summary": "สิ่งที่ observe ได้ (ไม่ใช่ quote ตรงๆ)"
    }
  ],
  "pipc_stage": "P1|I|P2|C",
  "overall": "strong|developing|needs_work"
}`;

  async function _analyzeSkills(transcript) {
    const raw = await callAI('haiku', SKILL_SYSTEM,
      [{ role: 'user', content: `Transcript:\n${transcript}` }], 2000);
    const text = (raw?.content?.[0]?.text || raw || '').trim().replace(/^```json|```$/gm, '');
    return JSON.parse(text);
  }

  // ==========================================================================
  // SECTION:CI_CUSTOMER_INTEL
  // transcript + account context → Claude Sonnet → customer intel JSON
  // ==========================================================================

  function _buildCustomerIntelPrompt(transcript, ctx) {
    return `วิเคราะห์ insight จากการสนทนานี้ โดยใช้ข้อมูลร้านอาหารต่อไปนี้ประกอบ:

ข้อมูลร้าน:
- ชื่อ: ${ctx.name || '-'}
- Segment: ${ctx.segment || '-'}
- อยู่กับ KAM นี้: ${ctx.days_with_current_kam || 0} วัน

Transcript:
${transcript}

ตอบเป็น JSON เท่านั้น ไม่มี markdown:
{
  "buyer_type": "price|relationship|value|convenience",
  "buyer_evidence": "เหตุผลสั้นๆ",
  "pain_points": [
    {"dimension": "Quality|Price|Delivery|Product|Completeness|Expansion|Credit",
     "summary": "...", "severity": "high|medium|opportunity"}
  ],
  "dimensions_covered": ["Product","Price"],
  "upsell_signals": [{"item": "...", "evidence": "..."}],
  "next_actions": [
    {"action": "...", "owner": "KAM|TL", "urgency": "3_days|this_week|next_visit"}
  ]
}`;
  }

  async function _analyzeCustomerIntel(transcript, ctx) {
    const prompt = _buildCustomerIntelPrompt(transcript, ctx);
    const raw = await callAI('sonnet', 'You are a customer intelligence analyst. Return only valid JSON.',
      [{ role: 'user', content: prompt }], 2000);
    const text = (raw?.content?.[0]?.text || raw || '').trim().replace(/^```json|```$/gm, '');
    return JSON.parse(text);
  }

  // ==========================================================================
  // SECTION:CI_STORAGE
  // Supabase save — structured only, no transcript stored
  // ==========================================================================

  async function _saveSession(skillData, intelData) {
    const email = currentUserProfile?.email;
    if (!email) throw new Error('no user email');

    const sessionId = _uuid();
    _sessionId = sessionId;
    const today = new Date().toISOString().split('T')[0];

    // 1. Upsert kam_visits ci_ columns
    const visitPayload = {
      ci_session_id:       sessionId,
      ci_skill_scores:     skillData,
      ci_customer_signals: intelData,
      ci_next_actions:     intelData?.next_actions || [],
      ci_mode:             'voice_note',
      ci_created_at:       new Date().toISOString()
    };

    // Find existing visit for today + account
    const visitRes = await _supaFetch('POST', '/rest/v1/rpc/ci_upsert_visit', {
      p_account_id:  _accountGuid,
      p_kam_email:   email,
      p_date:        today,
      p_ci_payload:  visitPayload
    });

    // 2. Insert individual skill rows to kam_skill_log
    if (skillData?.skills?.length) {
      const rows = skillData.skills.map(s => ({
        kam_email:        email,
        account_id:       _accountGuid,
        session_date:     today,
        skill_code:       s.code,
        score:            s.score,
        evidence_summary: s.evidence_summary || ''
      }));
      await _supaFetch('POST', '/rest/v1/kam_skill_log', rows);
    }

    return sessionId;
  }

  async function _supaFetch(method, path, body) {
    const token = (typeof supa !== 'undefined' && supa.auth?.session?.()?.access_token)
      || SUPA_KEY;
    const res = await fetch(`${SUPA_URL}${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey':        SUPA_KEY,
        'Authorization': `Bearer ${token}`,
        'Prefer':        'return=minimal'
      },
      body: body ? JSON.stringify(body) : undefined
    });
    if (!res.ok) {
      const err = await res.text();
      console.warn('CI supaFetch error', path, err);
    }
    return res;
  }

  // ==========================================================================
  // SECTION:CI_HISTORY
  // Load past CI sessions for current account
  // ==========================================================================

  async function _loadHistory(accountGuid) {
    const token = (typeof supa !== 'undefined' && supa.auth?.session?.()?.access_token)
      || SUPA_KEY;
    const url = `${SUPA_URL}/rest/v1/kam_skill_log`
      + `?account_id=eq.${encodeURIComponent(accountGuid)}`
      + `&order=session_date.desc&limit=30`;
    const res = await fetch(url, {
      headers: { 'apikey': SUPA_KEY, 'Authorization': `Bearer ${token}` }
    });
    if (!res.ok) return [];
    return res.json();
  }

  // ==========================================================================
  // SECTION:CI_UI_SHEET
  // Bottom sheet — recording / processing / result screens
  // ==========================================================================

  function _getSheet() { return document.getElementById('ci-sheet'); }

  function _closeSheet() {
    const s = _getSheet();
    if (s) { s.style.transform = 'translateY(100%)'; setTimeout(() => s.remove(), 350); }
    document.getElementById('ci-fab-overlay')?.remove();
  }

  function _showToast(msg) {
    if (typeof showToast === 'function') showToast(msg, '⚠');
    else console.warn('CI:', msg);
  }

  function _renderSheet() {
    let sheet = _getSheet();
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'ci-sheet';
      sheet.style.cssText = `
        position:fixed;bottom:0;left:0;right:0;z-index:9999;
        background:rgba(255,255,255,0.95);
        backdrop-filter:blur(40px);-webkit-backdrop-filter:blur(40px);
        border-radius:20px 20px 0 0;
        box-shadow:0 -2px 40px rgba(0,0,0,0.12);
        transform:translateY(100%);
        transition:transform 350ms cubic-bezier(0.16,1,0.3,1);
        padding:0 0 env(safe-area-inset-bottom,16px);
        max-height:88dvh;overflow-y:auto;
      `;
      document.body.appendChild(sheet);
      // Overlay
      let ov = document.getElementById('ci-fab-overlay');
      if (!ov) {
        ov = document.createElement('div');
        ov.id = 'ci-fab-overlay';
        ov.style.cssText = 'position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,0.25);';
        ov.onclick = () => { if (_phase === 'idle' || _phase === 'result') cancelRecording(); };
        document.body.appendChild(ov);
      }
      requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
    }
    sheet.innerHTML = _sheetHTML();
  }

  function _sheetHTML() {
    if (_phase === 'recording') return _htmlRecording();
    if (_phase === 'processing') return _htmlProcessing();
    if (_phase === 'result' && _lastResult) return _htmlResult(_lastResult);
    return _htmlIdle();
  }

  function _htmlIdle() {
    return `
      <div style="padding:20px 20px 8px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:500;color:#1C1C1E;letter-spacing:-0.02em">บันทึกการสนทนา</div>
        <button onclick="CI.cancelRecording()" style="background:none;border:none;font-size:22px;color:#636366;padding:4px;cursor:pointer">✕</button>
      </div>
      <div style="padding:16px 20px 24px;text-align:center">
        <div style="font-size:13px;color:#636366;margin-bottom:24px">
          เสียงจะไม่ถูกบันทึก — AI จะวิเคราะห์ทักษะและ insight จากการสนทนาเท่านั้น
        </div>
        <button onclick="CI.startRecording()" style="
          width:72px;height:72px;border-radius:50%;border:none;
          background:linear-gradient(135deg,#008065,#00a882);
          color:#fff;font-size:28px;cursor:pointer;
          box-shadow:0 4px 20px rgba(0,128,101,0.35);
        ">🎙</button>
        <div style="font-size:11px;color:#AEAEB2;margin-top:12px;text-transform:uppercase;letter-spacing:0.14em">กดเพื่อเริ่ม</div>
      </div>`;
  }

  function _htmlRecording() {
    return `
      <div style="padding:20px 20px 8px;display:flex;align-items:center;justify-content:space-between">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="width:8px;height:8px;border-radius:50%;background:#FF3B30;animation:ci-pulse 1s infinite"></div>
          <div style="font-size:16px;font-weight:500;color:#1C1C1E;letter-spacing:-0.02em">กำลังบันทึก...</div>
        </div>
        <button onclick="CI.cancelRecording()" style="background:none;border:none;font-size:13px;color:#636366;cursor:pointer">ยกเลิก</button>
      </div>
      <div style="padding:8px 20px 32px;text-align:center">
        <div id="ci-wave" style="font-size:32px;margin:16px 0;transition:opacity 0.3s">🎵</div>
        <div id="ci-timer" style="font-family:'IBM Plex Mono',monospace;font-size:52px;font-weight:200;color:#1C1C1E;letter-spacing:-0.04em;margin-bottom:24px">00:00</div>
        <button onclick="CI.stopRecording()" style="
          width:72px;height:72px;border-radius:50%;border:none;
          background:#FF3B30;color:#fff;font-size:24px;cursor:pointer;
          box-shadow:0 4px 20px rgba(255,59,48,0.35);
        ">⏹</button>
        <div style="font-size:11px;color:#AEAEB2;margin-top:12px;text-transform:uppercase;letter-spacing:0.14em">กดเพื่อหยุด</div>
        <div style="font-size:11px;color:#AEAEB2;margin-top:4px">สูงสุด ${Math.floor(MAX_DURATION/60)} นาที</div>
      </div>
      <style>
        @keyframes ci-pulse { 0%,100%{opacity:1} 50%{opacity:0.2} }
      </style>`;
  }

  function _htmlProcessing() {
    return `
      <div style="padding:20px 20px 8px">
        <div style="font-size:16px;font-weight:500;color:#1C1C1E;letter-spacing:-0.02em">กำลังวิเคราะห์...</div>
      </div>
      <div style="padding:16px 20px 40px;text-align:center">
        <div style="display:flex;justify-content:center;gap:6px;margin:24px 0" id="ci-dots">
          <div style="width:8px;height:8px;border-radius:50%;background:#008065;animation:ci-stagger 1.2s infinite 0s"></div>
          <div style="width:8px;height:8px;border-radius:50%;background:#008065;animation:ci-stagger 1.2s infinite 0.2s"></div>
          <div style="width:8px;height:8px;border-radius:50%;background:#008065;animation:ci-stagger 1.2s infinite 0.4s"></div>
        </div>
        <div style="font-size:13px;color:#636366" id="ci-step-label">กำลัง transcribe...</div>
        <div style="font-size:11px;color:#AEAEB2;margin-top:4px">ใช้เวลา ~30 วินาที</div>
      </div>
      <style>
        @keyframes ci-stagger { 0%,80%,100%{transform:scale(.6);opacity:.4} 40%{transform:scale(1);opacity:1} }
      </style>`;
  }

  let _lastResult = null;

  function _htmlResult(result) {
    const { skillData, intelData } = result;
    const overall = skillData?.overall || 'developing';
    const overallLabel = { strong: '🌟 เยี่ยม', developing: '📈 กำลังพัฒนา', needs_work: '🎯 ต้องฝึกเพิ่ม' }[overall] || overall;
    const overallColor = { strong: '#34C759', developing: '#FF9500', needs_work: '#FF3B30' }[overall] || '#636366';

    const scoreColor = s => ({ pass: '#34C759', developing: '#FF9500', not_observed: '#AEAEB2', not_applicable: '#AEAEB2' }[s] || '#AEAEB2');
    const scoreLabel = s => ({ pass: 'ผ่าน', developing: 'พัฒนา', not_observed: '-', not_applicable: 'N/A' }[s] || s);

    const skillRows = (skillData?.skills || []).map(s => `
      <div style="display:flex;align-items:center;padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,0.06)">
        <div style="flex:0 0 44px;font-family:'IBM Plex Mono',monospace;font-size:11px;font-weight:500;color:#636366">${s.code}</div>
        <div style="flex:1;font-size:12px;color:#1C1C1E">${s.evidence_summary || '-'}</div>
        <div style="flex:0 0 52px;text-align:right;font-size:11px;font-weight:500;color:${scoreColor(s.score)}">${scoreLabel(s.score)}</div>
      </div>`).join('');

    const actions = (intelData?.next_actions || []).map((a, i) => `
      <div style="display:flex;gap:10px;padding:10px 0;border-bottom:0.5px solid rgba(0,0,0,0.06)">
        <div style="flex:0 0 20px;font-size:11px;font-weight:500;color:#AEAEB2;font-family:'IBM Plex Mono',monospace;padding-top:1px">${i+1}</div>
        <div style="flex:1">
          <div style="font-size:13px;color:#1C1C1E">${a.action}</div>
          <div style="font-size:11px;color:#AEAEB2;margin-top:2px;text-transform:uppercase;letter-spacing:0.08em">${a.owner} · ${a.urgency?.replace(/_/g,' ')}</div>
        </div>
      </div>`).join('');

    const buyer = intelData?.buyer_type || '-';
    const buyerLabel = { price: '💰 Price-driven', relationship: '🤝 Relationship', value: '💎 Value-seeking', convenience: '⚡ Convenience' }[buyer] || buyer;

    return `
      <div style="padding:20px 20px 8px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:500;color:#1C1C1E;letter-spacing:-0.02em">ผลวิเคราะห์</div>
        <button onclick="CI.cancelRecording()" style="background:none;border:none;font-size:13px;color:#008065;cursor:pointer;font-weight:500">เสร็จ</button>
      </div>

      <!-- Overall badge -->
      <div style="margin:0 16px 16px;padding:14px 16px;background:rgba(0,0,0,0.03);border-radius:14px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:13px;color:#636366">ภาพรวมการสนทนา</div>
        <div style="font-size:13px;font-weight:500;color:${overallColor}">${overallLabel}</div>
      </div>

      <!-- Buyer type -->
      <div style="margin:0 16px 8px;padding:12px 16px;background:rgba(0,128,101,0.06);border-radius:12px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#636366;margin-bottom:4px">ประเภทลูกค้า</div>
        <div style="font-size:13px;font-weight:500;color:#1C1C1E">${buyerLabel}</div>
        ${intelData?.buyer_evidence ? `<div style="font-size:12px;color:#636366;margin-top:3px">${intelData.buyer_evidence}</div>` : ''}
      </div>

      <!-- Next actions -->
      ${actions ? `
      <div style="padding:0 16px;margin-top:16px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#636366;margin-bottom:8px">Action Items</div>
        ${actions}
      </div>` : ''}

      <!-- Skill scores -->
      <div style="padding:0 16px;margin-top:16px;margin-bottom:8px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#636366;margin-bottom:8px">ทักษะ 14 ด้าน</div>
        ${skillRows}
      </div>

      <!-- Pain points -->
      ${(intelData?.pain_points||[]).length ? `
      <div style="padding:0 16px;margin-top:16px;margin-bottom:24px">
        <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#636366;margin-bottom:8px">Pain Points</div>
        ${(intelData.pain_points).map(p => `
          <div style="padding:8px 0;border-bottom:0.5px solid rgba(0,0,0,0.06)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:2px">
              <div style="font-size:11px;font-weight:500;color:#008065;text-transform:uppercase;letter-spacing:0.08em">${p.dimension}</div>
              <div style="font-size:10px;color:${{high:'#FF3B30',medium:'#FF9500',opportunity:'#34C759'}[p.severity]||'#AEAEB2'}">${p.severity}</div>
            </div>
            <div style="font-size:12px;color:#1C1C1E">${p.summary}</div>
          </div>`).join('')}
      </div>` : '<div style="height:24px"></div>'}
    `;
  }

  // ==========================================================================
  // SECTION:CI_TL_DEBRIEF
  // TL override UI — shown in account view for TL/admin role
  // ==========================================================================

  async function openDebrief(accountGuid, sessionId) {
    const rows = await _loadHistory(accountGuid);
    const session = rows.find(r => r.session_date === new Date().toISOString().split('T')[0]);
    if (!session) { _showToast('ยังไม่มี session วันนี้'); return; }
    _renderDebriefSheet(rows, accountGuid);
  }

  function _renderDebriefSheet(rows, accountGuid) {
    let sheet = document.getElementById('ci-debrief-sheet');
    if (!sheet) {
      sheet = document.createElement('div');
      sheet.id = 'ci-debrief-sheet';
      sheet.style.cssText = `
        position:fixed;bottom:0;left:0;right:0;z-index:9999;
        background:rgba(255,255,255,0.95);backdrop-filter:blur(40px);
        border-radius:20px 20px 0 0;box-shadow:0 -2px 40px rgba(0,0,0,0.12);
        transform:translateY(100%);transition:transform 350ms cubic-bezier(0.16,1,0.3,1);
        padding:0 0 env(safe-area-inset-bottom,16px);max-height:88dvh;overflow-y:auto;
      `;
      document.body.appendChild(sheet);
      requestAnimationFrame(() => { sheet.style.transform = 'translateY(0)'; });
    }

    const grouped = {};
    rows.forEach(r => {
      if (!grouped[r.session_date]) grouped[r.session_date] = [];
      grouped[r.session_date].push(r);
    });

    const scoreColor = s => ({ pass: '#34C759', developing: '#FF9500', not_observed: '#AEAEB2', not_applicable: '#AEAEB2' }[s] || '#AEAEB2');

    sheet.innerHTML = `
      <div style="padding:20px 20px 8px;display:flex;align-items:center;justify-content:space-between">
        <div style="font-size:16px;font-weight:500;color:#1C1C1E">ประวัติทักษะ</div>
        <button onclick="document.getElementById('ci-debrief-sheet').remove()" style="background:none;border:none;font-size:13px;color:#636366;cursor:pointer">ปิด</button>
      </div>
      ${Object.entries(grouped).map(([date, skills]) => `
        <div style="padding:8px 16px">
          <div style="font-size:10px;text-transform:uppercase;letter-spacing:0.14em;color:#636366;margin-bottom:6px">${date}</div>
          ${skills.map(s => `
            <div style="display:flex;align-items:center;padding:6px 0;border-bottom:0.5px solid rgba(0,0,0,0.06)">
              <div style="flex:0 0 44px;font-family:'IBM Plex Mono',monospace;font-size:11px;color:#636366">${s.skill_code}</div>
              <div style="flex:1;font-size:12px;color:#1C1C1E">${s.evidence_summary||'-'}</div>
              <div style="flex:0 0 52px;text-align:right;font-size:11px;font-weight:500;color:${scoreColor(s.score)}">${s.score}</div>
            </div>`).join('')}
        </div>`).join('')}
      <div style="height:16px"></div>
    `;
  }

  // ==========================================================================
  // Orchestrator — ties transcribe → skill → intel → save → render
  // ==========================================================================

  async function _analyzeAndSave(transcript) {
    // Update step label
    const setLabel = t => { const el = document.getElementById('ci-step-label'); if (el) el.textContent = t; };

    try {
      setLabel('วิเคราะห์ทักษะ...');
      const skillData = await _analyzeSkills(transcript);

      setLabel('วิเคราะห์ข้อมูลลูกค้า...');
      const ctx = _getAccountContext();
      const intelData = await _analyzeCustomerIntel(transcript, ctx);

      setLabel('บันทึกผล...');
      await _saveSession(skillData, intelData);

      _lastResult = { skillData, intelData };
      _phase = 'result';
      _renderSheet();

    } catch (err) {
      _phase = 'idle';
      _lastResult = null;
      _renderSheet();
      _showToast('วิเคราะห์ไม่สำเร็จ: ' + err.message);
    }
  }

  function _getAccountContext() {
    if (typeof portviewBulkData !== 'undefined' && _accountGuid) {
      const row = portviewBulkData.find(r => r.account_guid === _accountGuid || r.account_id === _accountGuid);
      if (row) return {
        name:                 row.res_name || row.account_name || '-',
        segment:              row.account_type || '-',
        days_with_current_kam: row.days_with_current_kam || 0,
      };
    }
    return { name: '-', segment: '-', days_with_current_kam: 0 };
  }

  // ==========================================================================
  // Public entry points
  // ==========================================================================

  function open(accountGuid) {
    _accountGuid = accountGuid || currentAccountId;
    _phase       = 'idle';
    _lastResult  = null;
    _renderSheet();
  }

  return {
    open,
    startRecording,
    stopRecording,
    cancelRecording,
    openDebrief,
  };
})();

// =============================================================================
// Global helpers — CI button injected into account view
// =============================================================================

function ciOpen(accountGuid) { CI.open(accountGuid); }
function ciDebrief(accountGuid) { CI.openDebrief(accountGuid); }
