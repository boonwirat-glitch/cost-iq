// Phase 6.2 Chat Grounding Runtime Notes
// The live app is still monolith-compatible, but these are the intended grounding rules.
// Intent: make Olive smarter and safer, not rigid.
// Core contract: facts from context only; interpretations allowed; hypotheses must be labeled.
export const CHAT_GROUNDING_RULES = Object.freeze({
  noSampleFallbackForChat: true,
  noWeeklyClaimsFromMonthlyContext: true,
  labelOperationalHypotheses: true,
  balanceRiskAndOpportunity: true,
  flexibleOutputNotRigidTemplate: true
});
