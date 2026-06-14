// ── dash_commission.js — Commission engine (Phase 4) ─────────
// Freshket TL Dashboard v704
//
// Architecture: query Supabase commission_payout_snapshots directly
// (pre-computed by Sense) — no need to re-implement computation logic.
// Falls back to local pace-based estimate when snapshots unavailable.


// ── Bracket resolver — Supabase tiers first, hardcoded fallback ──
function _getSalesTLBrackets() {
  // Attempt to read from loaded commTierData (commission_rule_tiers)
  try {
    const tlPlan = Object.values(commPlanData || {}).find(p => p.beneficiary_role === 'tl');
    if (tlPlan) {
      const rule = Object.values(commTierData || {}).flat()
        .filter(t => {
          // find rule that belongs to TL plan
          return true; // tier rows don't have plan_id directly — use fallback
        });
    }
  } catch(e) { /* fallback */ }
  // Hardcoded fallback (Sales TL Commission PDF Apr 2026)
  return [
    { min:0,   max:84,  rate:0,     label:'< 85%'    },
    { min:85,  max:89,  rate:.0055, label:'85–90%'  },
    { min:90,  max:94,  rate:.007,  label:'90–95%'  },
    { min:95,  max:99,  rate:.008,  label:'95–100%' },
    { min:100, max:119, rate:.010,  label:'100–120%'},
    { min:120, max:999, rate:.012,  label:'≥ 120%'  },
  ];
}

// ── State ─────────────────────────────────────────────────────
let commSnapshotData  = [];   // commission_payout_snapshots rows
let commPlanData      = {};   // planCode → plan
let commTierData      = {};   // ruleId → tiers[]
let commAssignments   = [];   // plan assignments per period
let commDataReady     = false;

// Month label ↔ ISO — derived from MONTHS array in dash_data.js (no hardcode)
// MONTHS = ['Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26']
function _buildMonthISO() {
  const map = {};
  (typeof MONTHS !== 'undefined' ? MONTHS : []).forEach(m => {
    const [mon, yr] = m.split(' ');
    const moNum = {'Nov':'11','Dec':'12','Jan':'01','Feb':'02','Mar':'03',
                   'Apr':'04','May':'05','Jun':'06','Jul':'07','Aug':'08','Sep':'09','Oct':'10'}[mon];
    const year  = parseInt(yr) < 50 ? '20' + yr : '19' + yr;
    if (moNum) map[m] = `${year}-${moNum}`;
  });
  return map;
}
const MONTH_ISO     = _buildMonthISO();
const MONTH_DISPLAY = Object.fromEntries(Object.entries(MONTH_ISO).map(([d,iso]) => [iso,d]));

// ── Load from Supabase ────────────────────────────────────────
async function loadCommissionData() {
  if (!supa) return;
  const periods = Object.values(MONTH_ISO);  // last 6 months

  try {
    // 1. Snapshots (pre-computed by Sense)
    const { data: snaps } = await supa
      .from('commission_payout_snapshots')
      .select('id,period_month,beneficiary_role,beneficiary_email,team_lead_email,raw_nrr_pct,governed_nrr_pct,payout_amount,snapshot_status,breakdown,updated_at')
      .in('period_month', periods);
    commSnapshotData = snaps || [];
  } catch(e) {
    DashLog.error('commission_snapshots', e.message);
    commSnapshotData = [];
  }

  try {
    // 2. Plans + tiers (for bracket display)
    const { data: plans } = await supa
      .from('commission_plans')
      .select('id,plan_code,plan_name,beneficiary_role,status')
      .in('beneficiary_role', ['tl','kam'])
      .neq('status','inactive');

    const planMap = {};
    const planIds = [];
    (plans || []).forEach(p => {
      if (!p?.plan_code) return;
      planMap[p.plan_code] = p;
      planIds.push(p.id);
    });
    // Fallback standard plans
    if (!planMap.TL_NRR_STD)  planMap.TL_NRR_STD  = { plan_code:'TL_NRR_STD',  plan_name:'TL NRR Standard',  beneficiary_role:'tl' };
    if (!planMap.KAM_NRR_STD) planMap.KAM_NRR_STD = { plan_code:'KAM_NRR_STD', plan_name:'KAM NRR Standard', beneficiary_role:'kam' };
    commPlanData = planMap;

    if (planIds.length) {
      const { data: rules } = await supa
        .from('commission_rules')
        .select('id,plan_id,metric_code,payout_type')
        .in('plan_id', planIds);

      const ruleIds = (rules || []).map(r => r.id);
      if (ruleIds.length) {
        const { data: tiers } = await supa
          .from('commission_rule_tiers')
          .select('id,rule_id,tier_order,min_value,max_value,payout_value,payout_label')
          .in('rule_id', ruleIds)
          .order('tier_order', { ascending: true });
        const tm = {};
        (tiers || []).forEach(t => {
          if (!tm[t.rule_id]) tm[t.rule_id] = [];
          tm[t.rule_id].push(t);
        });
        commTierData = tm;
      }
    }
  } catch(e) {
    DashLog.error('commission_plans', e.message);
  }

  commDataReady = true;
  if (currentView === 'commission') renderCommissionView();
}

// ── Getters ───────────────────────────────────────────────────
function getCommSnaps(periodMonth, role) {
  return commSnapshotData.filter(s =>
    s.period_month === periodMonth &&
    (!role || s.beneficiary_role === role)
  );
}

function getMyCommSnaps(role) {
  if (!currentProfile?.email) return [];
  return commSnapshotData.filter(s =>
    (s.beneficiary_email === currentProfile.email ||
     s.team_lead_email   === currentProfile.email) &&
    (!role || s.beneficiary_role === role)
  );
}

// TL payout for a given month (from snapshots)
function getTLPayoutForMonth(isoMonth) {
  const snap = getMyCommSnaps('tl').find(s => s.period_month === isoMonth);
  return snap ? (Number(snap.payout_amount) || 0) : null;
}

// All KAM payouts under this TL for a month
function getKAMPayoutsForMonth(isoMonth) {
  if (!currentProfile?.email) return [];
  return commSnapshotData.filter(s =>
    s.period_month === isoMonth &&
    s.team_lead_email === currentProfile.email &&
    s.beneficiary_role === 'kam'
  );
}

// ── Pace-based estimate (fallback when no snapshot) ───────────
function estimateTLCommission(groups) {
  const total    = groups.reduce((s,g) => s+g.totalGMV, 0);
  const baseline = groups.reduce((s,g) => s+g.baseline, 0);
  const pace     = baseline > 0 ? Math.round(total/baseline*100) : 0;
  const _eb  = _getSalesTLBrackets();
  const bracket = _eb.find(b => pace >= b.min && pace <= b.max) || _eb[0];
  return { pace, total, baseline, bracket, est: Math.round(total * bracket.rate) };
}

// ── Render: Commission view (Phase 4) ─────────────────────────
function renderCommissionView() {
  const el = document.getElementById('commission-content');
  if (!el) return;
  if (!commDataReady) { el.innerHTML = skeletonBlock(4); return; }

  const groups = buildKamGroups();
  const isoNow = MONTH_ISO[currentMonth] || Object.values(MONTH_ISO)[Object.values(MONTH_ISO).length-1];

  // TL own payout this month
  const tlSnap    = getMyCommSnaps('tl').find(s => s.period_month === isoNow);
  const tlPayout  = tlSnap ? Number(tlSnap.payout_amount||0) : null;
  const kamSnaps  = getKAMPayoutsForMonth(isoNow);
  const kamTotal  = kamSnaps.reduce((s,r) => s+Number(r.payout_amount||0), 0);

  // Fallback estimate
  const est = estimateTLCommission(groups);
  const showEst = tlPayout === null;

  // 6-month trend from snapshots
  const trend6 = Object.entries(MONTH_ISO).map(([disp, iso]) => {
    const snap = getMyCommSnaps('tl').find(s => s.period_month === iso);
    const v = snap ? Number(snap.payout_amount||0) : null;
    return { disp, iso, v };
  });
  const maxTrend = Math.max(1, ...trend6.map(t => t.v || 0));

  // Spark bars
  const sparks = trend6.map(t => {
    const h = t.v != null ? Math.max(4, Math.round((t.v/maxTrend)*44)) : 4;
    const isCur = t.disp === currentMonth;
    const opacity = t.v != null ? '' : 'opacity:.25';
    return `<div class="td-spark-bar${isCur?' cur':''}" style="height:${h}px;${opacity}"
      title="${t.disp}: ${t.v != null ? fmtGMV(t.v) : 'รอ snapshot'}"></div>`;
  }).join('');
  const sparkLabels = trend6.map(t =>
    `<span style="${t.disp===currentMonth?'color:var(--ac)':''}">${t.disp.split(' ')[0]}</span>`
  ).join('');

  // KAM breakdown rows
  const kamRows = kamSnaps.length
    ? kamSnaps.sort((a,b) => Number(b.payout_amount||0)-Number(a.payout_amount||0)).map(r => {
        const nrr = r.governed_nrr_pct ?? r.raw_nrr_pct;
        const nrrCls = nrr >= 100 ? 'ok' : nrr >= 95 ? 'warn' : 'danger';
        return `<tr style="border-bottom:1px solid var(--hair)">
          <td style="padding:9px 16px;font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${r.beneficiary_email?.split('@')[0] || '—'}</td>
          <td style="padding:9px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--${nrrCls})">${nrr != null ? nrr+'%' : '—'}</td>
          <td style="padding:9px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--ok)">${fmtGMV(Number(r.payout_amount||0))}</td>
          <td style="padding:9px 16px;font-size:10px;color:var(--ink-4)">${r.snapshot_status || '—'}</td>
        </tr>`;
      }).join('')
    : groups.map(g => {
        // Fallback: pace-based per KAM
        const kamEst = estimateTLCommission([g]);
        const nrrCls = paceCls(kamEst.pace);
        return `<tr style="border-bottom:1px solid var(--hair)">
          <td style="padding:9px 16px;font-size:var(--text-sm);font-weight:600;color:var(--ink-1)">${g.name}</td>
          <td style="padding:9px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--${nrrCls})">${kamEst.pace}% <span style="color:var(--ink-4);font-size:9px">est.</span></td>
          <td style="padding:9px 16px;font-family:var(--font-mono);font-size:var(--text-xs);text-align:right;color:var(--ok)">${fmtGMV(kamEst.est)}</td>
          <td style="padding:9px 16px;font-size:10px;color:var(--ink-4)">estimate</td>
        </tr>`;
      }).join('');

  el.innerHTML = `<div style="max-width:680px">

    <!-- Hero: TL payout -->
    <div style="background:var(--surface);border-radius:var(--r-md);padding:var(--space-5);margin-bottom:var(--space-5);position:relative;overflow:hidden">
      <div style="position:absolute;top:0;left:0;right:0;height:2.5px;background:var(--ac)"></div>
      <div class="ds-eyebrow" style="margin-bottom:4px">TL COMMISSION ${currentMonth}${showEst?' · ESTIMATE':''}</div>
      <div style="font-family:var(--font-mono);font-size:var(--text-display);font-weight:700;letter-spacing:var(--ls-tight);line-height:1;color:var(--ok)">
        ${showEst ? fmtGMV(est.est) : fmtGMV(tlPayout)}
      </div>
      ${showEst
        ? `<div style="font-size:var(--text-sm);color:var(--ink-3);margin-top:6px">
            Team ${est.pace}% × ${(est.bracket.rate*100).toFixed(2)}% × ${fmtGMV(est.total)}
           </div>`
        : `<div style="font-size:var(--text-sm);color:var(--ink-3);margin-top:6px">
            KAM team ${fmtGMV(kamTotal)} · status: ${tlSnap?.snapshot_status || '—'}
           </div>`
      }
    </div>

    <!-- 6-month trend -->
    <div style="background:var(--surface);border-radius:var(--r-md);padding:var(--space-4);margin-bottom:var(--space-5)">
      <div class="ds-eyebrow" style="margin-bottom:var(--space-3)">Commission 6 เดือน</div>
      <div class="td-spark">${sparks}</div>
      <div class="td-spark-labels" style="margin-top:3px">${sparkLabels}</div>
      ${showEst ? `<div style="font-size:10px;color:var(--ink-4);margin-top:8px;font-family:var(--font-mono)">
        * ยังไม่มี snapshot — แสดงค่าประมาณจาก pace</div>` : ''}
    </div>

    <!-- Team summary stat row -->
    <div style="margin-bottom:var(--space-5)">
      <div class="ds-stat-row">
        <span class="ds-stat-label">Team GMV ${currentMonth}</span>
        <span class="ds-stat-value">${fmtGMV(est.total)}</span>
      </div>
      <div class="ds-stat-row">
        <span class="ds-stat-label">Pro Rate</span>
        <span class="ds-stat-value" style="color:var(--${paceCls(est.pace)})">${est.pace}%</span>
      </div>
      <div class="ds-stat-row">
        <span class="ds-stat-label">Rate bracket</span>
        <span class="ds-stat-value">${est.bracket.label} → ${(est.bracket.rate*100).toFixed(2)}%</span>
      </div>
      ${kamTotal > 0 ? `<div class="ds-stat-row">
        <span class="ds-stat-label">KAM team commission</span>
        <span class="ds-stat-value" style="color:var(--ok)">${fmtGMV(kamTotal)}</span>
      </div>` : ''}
    </div>

    <!-- Per-KAM breakdown -->
    <div class="ds-eyebrow" style="margin-bottom:var(--space-3)">Per KAM · ${currentMonth}</div>
    <div style="border-radius:var(--r-md);overflow:hidden;border:1px solid var(--hair)">
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="background:var(--surface-2)">
            <th style="padding:9px 16px;text-align:left;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">KAM</th>
            <th style="padding:9px 16px;text-align:right;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">NRR / Pace</th>
            <th style="padding:9px 16px;text-align:right;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Commission</th>
            <th style="padding:9px 16px;font-family:var(--font-mono);font-size:9px;letter-spacing:.1em;color:var(--ink-4);text-transform:uppercase;border-bottom:1px solid var(--hair)">Status</th>
          </tr>
        </thead>
        <tbody>${kamRows}</tbody>
      </table>
    </div>

  </div>`;
}
