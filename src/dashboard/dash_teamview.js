// ── dash_teamview.js — Team/Commission/Skills panels ─────────
// Freshket TL Dashboard v703 — Phase 3: DashState sync

// ── Sidebar team summary ──────────────────────────────────────
function renderSidebarTeam() {
  const groups = buildKamGroups();
  const total    = groups.reduce((s,g) => s + g.totalGMV, 0);
  const baseline = groups.reduce((s,g) => s + g.baseline, 0);
  const teamPace = baseline > 0 ? Math.round(total / baseline * 100) : 0;
  const cls = paceCls(teamPace);

  const danger = groups.filter(g => g.cls === 'danger').length;
  const warn   = groups.filter(g => g.cls === 'warn').length;
  const ok     = groups.filter(g => g.cls === 'ok').length;
  const star   = groups.filter(g => g.cls === 'star').length;

  // Rep rows — data-rep-email for sync targeting
  const repsHtml = groups.map(g => `
    <div class="td-rep-row ${g.cls}" data-rep-email="${g.email}"
      onclick="DashState.selectRep('${g.email}')">
      <div class="td-rep-body">
        <div class="td-rep-name">${g.name}</div>
        <div class="td-rep-bar-row">
          <div class="td-rep-bar-wrap">
            <div class="ds-bar-track">
              <div class="ds-bar-fill" style="width:${Math.min(g.pace,100)}%"></div>
            </div>
          </div>
          <span class="td-rep-pace">${g.pace}%</span>
        </div>
      </div>
      <span class="td-rep-chip">${g.count} acc</span>
    </div>`).join('');

  document.getElementById('sidebar-content').innerHTML = `
    <div class="td-team-hero">
      <div class="td-team-pace-row">
        <div class="td-team-pace-num ${cls}">${teamPace}%</div>
        <div class="td-team-pace-meta">
          <div class="td-team-pace-gmv">${fmtGMV(total)}</div>
          <div class="td-team-pace-sub">Pro Rate · ${groups.length} KAM</div>
        </div>
      </div>
      <div class="ds-bar-track md">
        <div class="ds-bar-fill ${cls}" style="width:${Math.min(teamPace,100)}%"></div>
      </div>
      <div class="td-signal-row" style="margin-top:var(--space-3)">
        <div class="td-signal"><div class="td-signal-val danger">${danger}</div><div class="td-signal-lbl">DANGER</div></div>
        <div class="td-signal"><div class="td-signal-val warn">${warn}</div><div class="td-signal-lbl">WARN</div></div>
        <div class="td-signal"><div class="td-signal-val ok">${ok}</div><div class="td-signal-lbl">OK</div></div>
        <div class="td-signal"><div class="td-signal-val star">${star}</div><div class="td-signal-lbl">STAR</div></div>
      </div>
    </div>
    <div class="td-rep-list-hd">
      <span class="ds-eyebrow">KAM</span>
      <button class="td-sort-btn" onclick="DashState.clearAll()">ล้าง ✕</button>
    </div>
    <div id="rep-rows-wrap">
      ${repsHtml}
    </div>`;
}

// ── Main team view ────────────────────────────────────────────
function renderTeamView() {
  const groups = buildKamGroups();
  const el = document.getElementById('team-content');

  const rows = groups.map(g => {
    const prevIdx = MONTHS.indexOf(currentMonth) - 1;
    const prevGMV = prevIdx >= 0
      ? g.accounts.reduce((s,a) => s+(a.gmv[MONTHS[prevIdx]]||0), 0) : 0;
    const delta = prevGMV > 0 ? fmtDelta(g.totalGMV, prevGMV) : '';
    const dcls  = prevGMV > 0 ? deltaCls(g.totalGMV, prevGMV) : '';
    const acColor = g.cls === 'star' ? 'ac' : g.cls;
    const isSelected = g.email === DashState.selectedRepEmail;

    return `<tr style="border-bottom:1px solid var(--hair);${isSelected?'background:var(--ac-dim)':''};cursor:pointer"
        onclick="DashState.selectRep('${g.email}')">
      <td style="padding:10px 16px;${isSelected?'border-left:2px solid var(--ac)':''}">
        <div style="font-size:var(--text-sm);font-weight:700;color:var(--ink-1)">${g.name}</div>
        <div style="font-size:var(--text-micro);color:var(--ink-4);font-family:var(--font-mono)">${g.email}</div>
      </td>
      <td style="padding:10px 16px;text-align:right">
        <div style="font-family:var(--font-mono);font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${fmtGMV(g.totalGMV)}</div>
        ${delta ? `<span class="ds-delta ${dcls}">${delta}</span>` : ''}
      </td>
      <td style="padding:10px 16px;min-width:140px">
        <div style="display:flex;align-items:center;gap:8px">
          <div class="ds-bar-track" style="flex:1">
            <div class="ds-bar-fill ${g.cls}" style="width:${Math.min(g.pace,100)}%"></div>
          </div>
          <span style="font-family:var(--font-mono);font-size:var(--text-xs);font-weight:600;color:var(--${acColor})">${g.pace}%</span>
        </div>
      </td>
      <td style="padding:10px 16px;font-family:var(--font-mono);font-size:var(--text-xs);color:var(--ink-3);text-align:right">${g.count}</td>
    </tr>`;
  }).join('');

  el.innerHTML = `
    <table style="width:100%;border-collapse:collapse">
      <thead>
        <tr style="background:var(--surface)">
          <th style="padding:10px 16px;text-align:left;font-family:var(--font-mono);font-size:var(--text-3xs);letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">KAM</th>
          <th style="padding:10px 16px;text-align:right;font-family:var(--font-mono);font-size:var(--text-3xs);letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">GMV ${currentMonth}</th>
          <th style="padding:10px 16px;font-family:var(--font-mono);font-size:var(--text-3xs);letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Pace</th>
          <th style="padding:10px 16px;text-align:right;font-family:var(--font-mono);font-size:var(--text-3xs);letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Acc</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ── Commission view ───────────────────────────────────────────
function renderCommissionView() {
  const groups   = buildKamGroups();
  const total    = groups.reduce((s,g) => s+g.totalGMV, 0);
  const baseline = groups.reduce((s,g) => s+g.baseline, 0);
  const pace     = baseline > 0 ? Math.round(total/baseline*100) : 0;

  const brackets = [
    { min:0,   max:84,  rate:0,     label:'< 85%'     },
    { min:85,  max:89,  rate:.0055, label:'85–90%'   },
    { min:90,  max:94,  rate:.007,  label:'90–95%'   },
    { min:95,  max:99,  rate:.008,  label:'95–100%'  },
    { min:100, max:119, rate:.010,  label:'100–120%' },
    { min:120, max:999, rate:.012,  label:'> 120%'   },
  ];
  const bracket = brackets.find(b => pace >= b.min && pace <= b.max) || brackets[0];
  const commAmt = Math.round(total * bracket.rate);

  // Per-KAM commission breakdown
  const kamRows = groups.map(g => {
    const kamPace = g.baseline > 0 ? Math.round(g.totalGMV/g.baseline*100) : 0;
    const b = brackets.find(br => kamPace >= br.min && kamPace <= br.max) || brackets[0];
    const kamComm = Math.round(g.totalGMV * b.rate);
    return `<tr style="border-bottom:1px solid var(--hair)">
      <td style="padding:8px 16px;font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${g.name}</td>
      <td style="padding:8px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--${paceCls(kamPace)})">${kamPace}%</td>
      <td style="padding:8px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--ink-2)">${fmtGMV(g.totalGMV)}</td>
      <td style="padding:8px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--ok)">${fmtGMV(kamComm)}</td>
    </tr>`;
  }).join('');

  document.getElementById('commission-content').innerHTML = `
    <div style="max-width:640px">
      <!-- Hero -->
      <div style="background:var(--surface);border-radius:var(--r-md);padding:var(--space-5);margin-bottom:var(--space-6);position:relative;overflow:hidden">
        <div style="position:absolute;top:0;left:0;right:0;height:2.5px;background:var(--ac)"></div>
        <div class="ds-eyebrow" style="margin-bottom:4px">COMMISSION ESTIMATE · ${currentMonth}</div>
        <div style="font-family:var(--font-mono);font-size:var(--text-display);font-weight:700;letter-spacing:var(--ls-tight);line-height:1;color:var(--ok)">${fmtGMV(commAmt)}</div>
        <div style="font-size:var(--text-sm);color:var(--ink-3);margin-top:6px">Team ${pace}% × ${(bracket.rate*100).toFixed(2)}% × ${fmtGMV(total)}</div>
      </div>

      <!-- Summary stats -->
      <div style="margin-bottom:var(--space-6)">
        <div class="ds-stat-row"><span class="ds-stat-label">Team GMV</span><span class="ds-stat-value">${fmtGMV(total)}</span></div>
        <div class="ds-stat-row"><span class="ds-stat-label">Pro Rate</span><span class="ds-stat-value" style="color:var(--${paceCls(pace)})">${pace}%</span></div>
        <div class="ds-stat-row"><span class="ds-stat-label">Rate bracket</span><span class="ds-stat-value">${bracket.label} → ${(bracket.rate*100).toFixed(2)}%</span></div>
        <div class="ds-stat-row"><span class="ds-stat-label">Team commission</span><span class="ds-stat-value" style="color:var(--ok)">${fmtGMV(commAmt)}</span></div>
      </div>

      <!-- Per KAM breakdown -->
      <div class="ds-eyebrow" style="margin-bottom:var(--space-3)">Per KAM Breakdown</div>
      <table style="width:100%;border-collapse:collapse;background:var(--surface);border-radius:var(--r-md);overflow:hidden">
        <thead>
          <tr style="background:var(--surface-2)">
            <th style="padding:8px 16px;text-align:left;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">KAM</th>
            <th style="padding:8px 16px;text-align:right;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Pace</th>
            <th style="padding:8px 16px;text-align:right;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">GMV</th>
            <th style="padding:8px 16px;text-align:right;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Comm.</th>
          </tr>
        </thead>
        <tbody>${kamRows}</tbody>
      </table>
    </div>`;
}

// ── Skills view ───────────────────────────────────────────────
function renderSkillsView() {
  document.getElementById('skills-content').innerHTML = `
    <div style="max-width:480px;padding:var(--space-10) 0;text-align:center">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--ink-4)" stroke-width="1.5" style="margin-bottom:var(--space-4)">
        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/>
      </svg>
      <div style="font-size:var(--text-h3);font-weight:600;color:var(--ink-2);margin-bottom:8px">Skills — Phase 5</div>
      <div style="font-size:var(--text-body);color:var(--ink-3)">ดู Skills progress ของ rep ใน Sense บนมือถือได้แล้วตอนนี้</div>
    </div>`;
}
