// Phase 5.1 extraction target: data loading pill UI facade.
// Runtime source of truth currently lives in src/runtime/dataRuntime.js.
// This file is kept valid and importable for the next extraction phase.

function getDataRuntime() {
  return window.FreshketSenseRuntime && window.FreshketSenseRuntime.data;
}

function resetDataPill() {
  const rt = getDataRuntime();
  if (rt && rt.resetDataPill) return rt.resetDataPill();
}

function setDataPillText(text, count) {
  const rt = getDataRuntime();
  if (rt && rt.setDataPillText) return rt.setDataPillText(text, count);
}

function finishDataPill(text, hideMs) {
  const rt = getDataRuntime();
  if (rt && rt.finishDataPill) return rt.finishDataPill(text, hideMs);
}

function markForegroundPillDot(index) {
  const rt = getDataRuntime();
  if (rt && rt.markForegroundPillDot) return rt.markForegroundPillDot(index);
}

function prepareProgressChips(keys, totalCount, specs) {
  const rt = getDataRuntime();
  if (rt && rt.prepareProgressChips) return rt.prepareProgressChips(keys, totalCount, specs);
}

export {
  resetDataPill,
  setDataPillText,
  finishDataPill,
  markForegroundPillDot,
  prepareProgressChips,
};
