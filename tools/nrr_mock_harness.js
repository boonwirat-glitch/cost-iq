// ── /nrr preview mock harness ────────────────────────────────────────────
// Paste into the browser console (or run via preview_eval) on a locally
// served nrr.html to exercise the Commission section WITHOUT a real
// Supabase login. Bypasses only the auth/data layer — every render path
// is the real production code.
//
// Data below is the REAL June 2026 commission_payout_snapshots content
// (pulled via Supabase 2026-07-08) so what you see matches production.
//
// Usage:
//   1. serve repo root (any static server with /nrr → nrr.html rewrite)
//   2. open /nrr, run this whole file in the console
//   3. optional: nrrCommViewMode = 'summary'|'full'; nrrRenderCommissionSection()
(function () {
  document.getElementById('nrr-app').innerHTML = nrrShellHtml();
  nrrShowApp();
  window.nrrProfile = { role: 'admin', email: 'admin@freshket.co', name: 'Admin (mock)' };
  window.nrrState.period = '2026-07';

  var JUNE_ROWS = [
    { beneficiary_role: 'kam', beneficiary_email: 'anusorn.k@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '0.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 92, gmv_gate: { gate_active: true, cap_multiplier: 0 }, handover: { payout: 0, retention_pct: 0 }, kam_name: 'Bookbig', nrr_payout: 0, upsell_sku: { p1: { gmv: 141445, comm: 4236, groups: [] }, p3: { comm: 2223, groups: [], gmv_incremental: 74218 }, total_commission: 6459 }, final_payout: 0, upsell_outlet: { commission: 3212, outlet_gmv: 214155 } } },
    { beneficiary_role: 'kam', beneficiary_email: 'chaklid.n@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '5112.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 97.19, gmv_gate: { gate_active: true, cap_multiplier: 0.7 }, handover: { payout: 0, retention_pct: 0 }, kam_name: 'Dent', nrr_payout: 0, upsell_sku: { p1: { gmv: 177103, comm: 5307, groups: [] }, p3: { comm: 1289, groups: [], gmv_incremental: 43002 }, total_commission: 6596 }, final_payout: 5112, upsell_outlet: { commission: 707, outlet_gmv: 47146 } } },
    { beneficiary_role: 'kam', beneficiary_email: 'duangruedee.bu@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '43461.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 100, gmv_gate: { gate_active: false, cap_multiplier: 1 }, handover: { payout: 0, retention_pct: 0 }, kam_name: 'Ning', nrr_payout: 5000, upsell_sku: { p1: { gmv: 831252, comm: 24919, groups: [] }, p3: { comm: 9016, groups: [], gmv_incremental: 300755 }, total_commission: 33935 }, final_payout: 43461, upsell_outlet: { commission: 4526, outlet_gmv: 301703 } } },
    { beneficiary_role: 'kam', beneficiary_email: 'nuttawan.ma@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '16945.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 100, gmv_gate: { gate_active: false, cap_multiplier: 1 }, handover: { payout: 0, retention_pct: 85.4 }, kam_name: 'Kwang', nrr_payout: 5000, upsell_sku: { p1: { gmv: 242736, comm: 7273, groups: [] }, p3: { comm: 2005, groups: [], gmv_incremental: 66953 }, total_commission: 9278 }, final_payout: 16945, upsell_outlet: { commission: 2667, outlet_gmv: 177768 } } },
    { beneficiary_role: 'kam', beneficiary_email: 'rinlaphat.s@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '5305.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 95.32, gmv_gate: { gate_active: true, cap_multiplier: 0.7 }, handover: { payout: 0, retention_pct: 0 }, kam_name: 'Mild', nrr_payout: 0, upsell_sku: { p1: { gmv: 252940, comm: 7578, groups: [] }, p3: { comm: 0, groups: [], gmv_incremental: 0 }, total_commission: 7578 }, final_payout: 5305, upsell_outlet: { commission: 0, outlet_gmv: 0 }, adjustment_note: 'Excludes ฿6556 May back-pay (paid via May correction instead)' } },
    { beneficiary_role: 'kam', beneficiary_email: 'siriprapa.p@freshket.co', team_lead_email: 'pavarisa.mu@freshket.co', payout_amount: '22229.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 100.91, gmv_gate: { gate_active: false, cap_multiplier: 1 }, handover: { payout: 5000, retention_pct: 164.66 }, kam_name: 'Pop', nrr_payout: 5000, upsell_sku: { p1: { gmv: 230843, comm: 6913, groups: [] }, p3: { comm: 5316, groups: [], gmv_incremental: 177282 }, total_commission: 12229 }, final_payout: 22229, upsell_outlet: { commission: 0, outlet_gmv: 0 } } },
    { beneficiary_role: 'kam', beneficiary_email: 'warissara.c@freshket.co', team_lead_email: 'pavarisa.mu@freshket.co', payout_amount: '27293.00', snapshot_status: 'final', breakdown: { role: 'kam', type: 'kam_full', period: '2026-06', nrr_pct: 104.45, gmv_gate: { gate_active: false, cap_multiplier: 1 }, handover: { payout: 0, retention_pct: 0 }, kam_name: 'Ply', nrr_payout: 10000, upsell_sku: { p1: { gmv: 484782, comm: 14532, groups: [] }, p3: { comm: 1543, groups: [], gmv_incremental: 51532 }, total_commission: 16075 }, final_payout: 27293, upsell_outlet: { commission: 1218, outlet_gmv: 81217 } } },
    { beneficiary_role: 'tl', beneficiary_email: 'nitipat.s@freshket.co', team_lead_email: 'nitipat.s@freshket.co', payout_amount: '0.00', snapshot_status: 'final', breakdown: { role: 'tl', type: 'tl_full', period: '2026-06', nrr_pct: 98, nrr_payout: 0, upsell_mult: '1x', final_payout: 0, team_lead_name: 'Nitipat (Name) Suparattanas', team_upsell_gmv: 2788583 } },
    { beneficiary_role: 'tl', beneficiary_email: 'pavarisa.mu@freshket.co', team_lead_email: 'pavarisa.mu@freshket.co', payout_amount: '18000.00', snapshot_status: 'final', breakdown: { role: 'tl', type: 'tl_full', period: '2026-06', nrr_pct: 101, nrr_payout: 12000, upsell_mult: '2x', final_payout: 18000, team_lead_name: 'Pavarisa (Ploiiy) Muangtaen', team_upsell_gmv: 2290408 } }
  ];

  // Minimal supabase-js query-shape stub — resolves the exact query chains
  // nrr_commission.js uses (.select().in(), .select().eq(), bare thenable
  // .select('period_month')). Extend if new query shapes get added.
  window.supa = {
    from: function (table) {
      var q = {
        select: function () { return q; },
        eq: function (col, val) {
          if (table === 'commission_payout_snapshots' && col === 'period_month') {
            return Promise.resolve({ data: val === '2026-06' ? JUNE_ROWS : [] });
          }
          return Promise.resolve({ data: [] });
        },
        in: function () { return Promise.resolve({ data: [] }); },
        then: function (resolve) {
          if (table === 'commission_payout_snapshots') resolve({ data: [{ period_month: '2026-05' }, { period_month: '2026-06' }] });
          else resolve({ data: [] });
        }
      };
      return q;
    }
  };

  window.nrrCommRatesCache = {
    loaded: true,
    byKey: {
      upsell_sku_params: { p1_rate: 0.01, p3_rate: 0.01, p3_threshold_pct: 2.0, p3_min_incremental: 8000, p1_min_gmv: 5000 },
      upsell_outlet_params: { rate: 0.005 },
      gmv_gate_params: { threshold_1: 98, threshold_2: 95, cap_1: 0.3, cap_2: 0 }
    }
  };
  window.nrrCommSnapshots = { loaded: true, byEmail: {} };
  window.nrrListTeams = function () {
    return [
      { email: 'nitipat.s@freshket.co', name: 'Nitipat (Name)' },
      { email: 'pavarisa.mu@freshket.co', name: 'Pavarisa (Ploiiy)' }
    ];
  };
  window.nrrListKamsForTeam = function () {
    return [{ email: 'duangruedee.bu@freshket.co', name: 'Ning' }, { email: 'anusorn.k@freshket.co', name: 'Bookbig' }];
  };
  window.nrrTeamResult = function () { return { by_month: { '2026-07': { nrr_pct: 98 } } }; };
  window.nrrKamResult = function () { return { by_month: { '2026-07': { nrr_pct: 96, rows: [] } } }; };
  window.nrrMonthTriple = function () { return { base: 14000000, mtd: 13700000, run_rate: 13700000, curr_days: 8, days_in_month: 31, is_partial: true }; };

  nrrCommViewMode = 'full';
  nrrRenderCommissionSection();
  document.getElementById('nrr-comm-strip').scrollIntoView();
  console.log('[nrr mock harness] ready — try: nrrCommViewMode="summary"; nrrRenderCommissionSection()');
})();
