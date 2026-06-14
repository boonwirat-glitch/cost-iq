// ── dash_layout.js — App init, view routing, topbar ──────────
// Freshket TL Dashboard v702

let currentView = 'map';

// ── App init (called after auth) ─────────────────────────────
function initApp() {
  renderTopbarUser();
  renderTopbarControls();
  renderSidebarShimmer();
  loadDashData();
}

function renderTopbarUser() {
  if (!currentProfile) return;
  const initials = (currentProfile.name || currentProfile.email || '?')
    .trim().charAt(0).toUpperCase();
  document.getElementById('user-avatar').textContent = initials;
  document.getElementById('user-name').textContent =
    currentProfile.name || currentProfile.email?.split('@')[0] || '—';
}

function renderTopbarControls() {
  const c = document.getElementById('topbar-controls');
  c.innerHTML = `
    <div class="ds-seg-ctrl" id="metric-toggle">
      <button class="ds-seg-item active-ac" data-m="gmv"          onclick="setMetric('gmv',this)">GMV ฿</button>
      <button class="ds-seg-item"           data-m="accounts"     onclick="setMetric('accounts',this)">Accounts</button>
      <button class="ds-seg-item"           data-m="outlets"      onclick="setMetric('outlets',this)">Outlets</button>
      <button class="ds-seg-item"           data-m="new_accounts" onclick="setMetric('new_accounts',this)">New Acc</button>
    </div>
    <div class="ds-seg-ctrl" id="month-toggle">
      ${MONTHS.map(m =>
        `<button class="ds-seg-item${m===currentMonth?' active-ac':''}"
          onclick="setMonth('${m}',this)">${m}</button>`
      ).join('')}
    </div>`;
}

function setMetric(m, btn) {
  currentMetric = m;
  document.querySelectorAll('#metric-toggle .ds-seg-item').forEach(b => {
    b.classList.remove('active-ac');
  });
  btn.classList.add('active-ac');
  updateMapColors();
  renderCurrentView();
}

function setMonth(m, btn) {
  currentMonth = m;
  document.querySelectorAll('#month-toggle .ds-seg-item').forEach(b => {
    b.classList.remove('active-ac');
  });
  btn.classList.add('active-ac');
  updateMapColors();
  renderSidebarTeam();
  renderCurrentView();
}

// ── View routing ─────────────────────────────────────────────
function setView(v, btn) {
  currentView = v;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v)?.classList.add('active');
  document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  document.getElementById('topbar-section').textContent = {
    map: 'Territory Map', team: 'ภาพรวมทีม',
    commission: 'Commission', skills: 'Skills'
  }[v] || v;
  renderCurrentView();
}

function renderCurrentView() {
  if (!dataReady) return;
  if (currentView === 'team')       renderTeamView();
  if (currentView === 'commission') renderCommissionView();
  if (currentView === 'skills')     renderSkillsView();
}

// ── Sidebar shimmer ───────────────────────────────────────────
function renderSidebarShimmer() {
  document.getElementById('sidebar-shimmer').style.display = 'flex';
}
function hideSidebarShimmer() {
  document.getElementById('sidebar-shimmer').style.display = 'none';
}

// ── Detail panel ──────────────────────────────────────────────
let selectedDistrict = null;

function openDetail(html) {
  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-panel').classList.add('open');
}
function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  selectedDistrict = null;
  // Deselect map polygon
  document.querySelectorAll('.td-poly.selected').forEach(p => p.classList.remove('selected'));
}
