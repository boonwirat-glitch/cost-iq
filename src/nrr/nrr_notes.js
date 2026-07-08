// ── nrr_notes.js — TL/Admin notes on churn/comeback outlets ──────────────
// Reads/writes the `nrr_outlet_notes` Supabase table. This table does NOT
// exist yet as of first implementation — the exact CREATE TABLE + RLS
// policy SQL lives in the plan doc and must be run manually in the
// Supabase SQL editor before this feature does anything. Every function
// here is defensive: if the table/policy is missing, we detect that once,
// set nrrNotesAvailable = false, and the UI hides the "add note" affordance
// entirely rather than showing a broken button or spamming errors.

var nrrNotesAvailable = null; // null = not checked yet, true/false once known
var nrrNotesCache = {}; // outlet_id -> [{note, author_email, created_at}]

async function nrrFetchNotesForOutlets(outletIds, periodMonth) {
  nrrNotesCache = {};
  if (!outletIds.length || !supa) return nrrNotesCache;
  try {
    var resp = await supa.from('nrr_outlet_notes')
      .select('outlet_id,note,author_email,movement_type,created_at')
      .in('outlet_id', outletIds)
      .eq('period_month', periodMonth)
      .order('created_at', { ascending: false });
    if (resp.error) throw resp.error;
    nrrNotesAvailable = true;
    (resp.data || []).forEach(function (n) {
      if (!nrrNotesCache[n.outlet_id]) nrrNotesCache[n.outlet_id] = [];
      nrrNotesCache[n.outlet_id].push(n);
    });
  } catch (e) {
    // Table missing, RLS denies, or any other error — feature unavailable,
    // fail quiet. Logged once for whoever's debugging, not shown to user.
    nrrNotesAvailable = false;
    console.warn('[nrr] outlet notes unavailable (table likely not migrated yet):', e.message || e);
  }
  return nrrNotesCache;
}
window.nrrFetchNotesForOutlets = nrrFetchNotesForOutlets;

async function nrrSaveNote(outletId, periodMonth, quarterId, movementType, noteText) {
  if (!supa || !nrrProfile) return { ok: false, error: 'not_authenticated' };
  try {
    var resp = await supa.from('nrr_outlet_notes').insert({
      outlet_id: outletId,
      period_month: periodMonth,
      quarter_id: quarterId,
      movement_type: movementType,
      author_email: nrrProfile.email,
      note: noteText
    });
    if (resp.error) throw resp.error;
    return { ok: true };
  } catch (e) {
    console.warn('[nrr] failed to save outlet note', e);
    return { ok: false, error: e.message || String(e) };
  }
}
window.nrrSaveNote = nrrSaveNote;
