// ── nrr_router.js — hash router for the two-layer app ────────────────────
// Layer 1 "Dashboard"  = the original one-page notebook (tl/admin).
// Layer 2 "Portfolio"  = per-KAM operational drill-down (portfolio →
//                        account), added Phase B/C/D.
//
// Routes:
//   #/                      → dashboard (rep is redirected to #/portfolio)
//   #/portfolio             → own portfolio (rep) / KAM switcher (tl/admin)
//   #/portfolio/<kamEmail>  → a specific KAM's portfolio (permission-guarded)
//   #/account/<accountId>   → one account's detail (permission-guarded)
//
// Views are sibling containers (`.nrr-view`, id="nrr-view-<name>") toggled
// with [hidden] — the dashboard DOM is never torn down, so its render cycle
// (nrrRenderAll) keeps working exactly as before this router existed.
// Render hooks are registered per view via nrrRouterRegister(); the router
// only guards, toggles visibility, and dispatches.

var nrrRoutes = {};          // { viewName: function(route) }
var nrrCurrentRoute = null;

function nrrRouterRegister(name, fn) { nrrRoutes[name] = fn; }
window.nrrRouterRegister = nrrRouterRegister;

function nrrParseHash() {
  var h = (location.hash || '').replace(/^#\/?/, '');
  var parts = h.split('/').filter(Boolean);
  if (!parts.length) return { view: 'dashboard', param: null };
  if (parts[0] === 'portfolio') return { view: 'portfolio', param: parts[1] ? decodeURIComponent(parts[1]) : null };
  if (parts[0] === 'account') return { view: 'account', param: parts[1] ? decodeURIComponent(parts[1]) : null };
  if (parts[0] === 'company') return { view: 'company', param: null };
  if (parts[0] === 'sales') return { view: 'sales', param: null };
  if (parts[0] === 'pulse') return { view: 'pulse', param: null };
  return { view: 'dashboard', param: null };
}

// Role guard. Returns the route to actually show; sets .redirect when the
// requested one is not allowed for this profile.
//  - rep: portfolio layer only, and only their own portfolio. Account-level
//    ownership (rep opening someone else's account) is enforced by the
//    account view itself once it has portview data (Phase C) — the router
//    can't know account→KAM mapping before that data loads.
//  - tl: dashboard (own team) + portfolio, but only KAMs in their own team
//    (Phase B, 2026-07-09) — without this a TL could open
//    #/portfolio/<kamEmail> for a KAM outside their team by editing the
//    URL directly; the KAM-switcher UI only ever *offers* their own team,
//    it doesn't enforce it, so the guard has to be here too.
//  - admin: everything.
function nrrRouteGuard(route) {
  var p = window.nrrProfile;
  if (!p) return route;
  // Company overview + Sales pipeline (v28) + Pulse signage (v45): whole-
  // company data — admin only.
  if ((route.view === 'company' || route.view === 'sales' || route.view === 'pulse') && p.role !== 'admin') {
    return { view: 'dashboard', param: null, redirect: true };
  }
  if (p.role === 'rep') {
    if (route.view === 'dashboard') return { view: 'portfolio', param: null, redirect: true };
    if (route.view === 'portfolio' && route.param && route.param !== p.email) {
      return { view: 'portfolio', param: null, redirect: true };
    }
  }
  if (p.role === 'tl' && route.view === 'portfolio' && route.param) {
    var ownTeam = (typeof nrrListKamsForTeam === 'function' ? nrrListKamsForTeam(p.email) : []);
    var inTeam = ownTeam.some(function (k) { return k.email === route.param; });
    if (!inTeam) return { view: 'portfolio', param: null, redirect: true };
  }
  return route;
}

function nrrRouteHash(route) {
  if (route.view === 'dashboard') return '#/';
  return '#/' + route.view + (route.param ? '/' + encodeURIComponent(route.param) : '');
}

function nrrNavigate(hash) {
  if (location.hash === hash) { nrrHandleRoute(); return; }
  location.hash = hash;
}
window.nrrNavigate = nrrNavigate;

function nrrHandleRoute() {
  var route = nrrRouteGuard(nrrParseHash());
  if (route.redirect) { location.replace(nrrRouteHash(route)); return; }

  var changedView = !nrrCurrentRoute || nrrCurrentRoute.view !== route.view;

  document.querySelectorAll('.nrr-view').forEach(function (el) {
    el.hidden = el.id !== 'nrr-view-' + route.view;
  });

  // App-level nav active state: the account view belongs to the portfolio
  // family; company/sales (v28) are their own tabs.
  var navFamily = route.view === 'dashboard' ? 'dashboard'
    : (route.view === 'company' || route.view === 'sales' || route.view === 'pulse') ? route.view
    : 'portfolio';
  document.querySelectorAll('#nrr-appnav a').forEach(function (a) {
    a.classList.toggle('on', a.dataset.view === navFamily);
  });

  // The scrollspy subnav (and its divider) only make sense inside the
  // dashboard's long scroll.
  var subnav = document.getElementById('nrr-subnav');
  if (subnav) subnav.style.display = route.view === 'dashboard' ? '' : 'none';
  var navDiv = document.querySelector('.nrr-appnav-div');
  if (navDiv) navDiv.style.display = route.view === 'dashboard' ? '' : 'none';

  nrrCurrentRoute = route;
  var fn = nrrRoutes[route.view];
  if (fn) fn(route);
  if (changedView) window.scrollTo(0, 0);
}
window.nrrHandleRoute = nrrHandleRoute;

window.addEventListener('hashchange', nrrHandleRoute);
