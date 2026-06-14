// ── dash_layout.js — App init, view routing, topbar ──────────
// Freshket TL Dashboard v703 — Phase 3: bidirectional sync

let currentView = 'map';

// ── Sync state (Phase 3) ──────────────────────────────────────
// Single source of truth for selection state
const DashState = {
  selectedRepEmail:    null,   // KAM selected in sidebar
  selectedDistrictName:null,   // district selected on map
  zoneFilterActive:    false,  // map zone filtering rep list
  salesOverlay:        false,  // show sales acquisition dots

  // Set rep selection — triggers map highlight
  selectRep(email) {
    this.selectedRepEmail = this.selectedRepEmail === email ? null : email;
    this.selectedDistrictName = null;  // clear zone selection
    this.zoneFilterActive = false;
    this._syncAll();
  },

  // Set district selection — triggers list filter
  selectDistrict(name) {
    this.selectedDistrictName = this.selectedDistrictName === name ? null : name;
    this.selectedRepEmail = null;    // clear rep selection
    this.zoneFilterActive = !!this.selectedDistrictName;
    this._syncAll();
  },

  // Clear everything
  clearAll() {
    this.selectedRepEmail     = null;
    this.selectedDistrictName = null;
    this.zoneFilterActive     = false;
    this._syncAll();
  },

  _syncAll() {
    syncMapToRep();
    syncRepListToZone();
    renderZoneFilterChip();
    renderSidebarRepHighlight();
  }
};

// ── App init ──────────────────────────────────────────────────
function initApp() {
  renderTopbarUser();
  renderTopbarControls();
  renderSidebarShimmer();
  loadDashData();
  loadCommissionData();  // Phase 4: load in parallel
  loadSkillsData();         // Phase 5: load in parallel
  loadEchoData();           // Phase 6: load in parallel
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
      <button class="ds-seg-item active-ac" onclick="setMetric('gmv',this)">GMV ฿</button>
      <button class="ds-seg-item" onclick="setMetric('accounts',this)">Accounts</button>
      <button class="ds-seg-item" onclick="setMetric('outlets',this)">Outlets</button>
      <button class="ds-seg-item" onclick="setMetric('new_accounts',this)">New Acc</button>
    </div>
    <div class="ds-seg-ctrl" id="month-toggle">
      ${MONTHS.map(m =>
        `<button class="ds-seg-item${m===currentMonth?' active-ac':''}"
          onclick="setMonth('${m}',this)">${m}</button>`
      ).join('')}
    </div>
    <button class="td-overlay-btn${DashState.salesOverlay?' active':''}"
      id="sales-overlay-btn" onclick="toggleSalesOverlay()" title="Sales acquisition overlay">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12"/>
      </svg>
      Sales
    </button>`;
}

function setMetric(m, btn) {
  currentMetric = m;
  document.querySelectorAll('#metric-toggle .ds-seg-item').forEach(b => b.classList.remove('active-ac'));
  btn.classList.add('active-ac');
  updateMapColors();
  renderCurrentView();
}

function setMonth(m, btn) {
  currentMonth = m;
  document.querySelectorAll('#month-toggle .ds-seg-item').forEach(b => b.classList.remove('active-ac'));
  btn.classList.add('active-ac');
  updateMapColors();
  renderSidebarTeam();
  renderCurrentView();
}

function toggleSalesOverlay() {
  DashState.salesOverlay = !DashState.salesOverlay;
  const btn = document.getElementById('sales-overlay-btn');
  btn?.classList.toggle('active', DashState.salesOverlay);
  renderSalesOverlay();
}

// ── View routing ──────────────────────────────────────────────
function setView(v, btn) {
  currentView = v;
  document.querySelectorAll('.view').forEach(el => el.classList.remove('active'));
  document.getElementById('view-' + v)?.classList.add('active');
  document.querySelectorAll('.snav-btn').forEach(b => b.classList.remove('active'));
  btn?.classList.add('active');
  document.getElementById('topbar-section').textContent = {
    map: 'Territory Map', team: 'ภาพรวมทีม',
    commission: 'Commission', skills: 'Skills', echo: 'Echo Sessions'
  }[v] || v;
  renderCurrentView();
}

function renderCurrentView() {
  if (!dataReady) return;
  if (currentView === 'team')       renderTeamView();
  if (currentView === 'commission') renderCommissionView();
  if (currentView === 'skills')     renderSkillsView();
  if (currentView === 'echo')       renderEchoView();
}

// ── Shimmer ───────────────────────────────────────────────────
function renderSidebarShimmer() {
  document.getElementById('sidebar-shimmer').style.display = 'flex';
}
function hideSidebarShimmer() {
  document.getElementById('sidebar-shimmer').style.display = 'none';
}

// ── Zone filter chip ──────────────────────────────────────────
function renderZoneFilterChip() {
  let chip = document.getElementById('zone-filter-chip');
  if (!DashState.zoneFilterActive || !DashState.selectedDistrictName) {
    chip?.remove();
    return;
  }
  if (!chip) {
    chip = document.createElement('div');
    chip.id = 'zone-filter-chip';
    chip.className = 'td-zone-chip';
    // Insert above rep list
    const content = document.getElementById('sidebar-content');
    if (content) content.prepend(chip);
  }
  chip.innerHTML = `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
    </svg>
    <span>${DashState.selectedDistrictName}</span>
    <button onclick="DashState.clearAll()" title="ล้าง filter">
      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6 6 18M6 6l12 12"/>
      </svg>
    </button>`;
}

// ── Sync: Map → Rep highlight ─────────────────────────────────
function syncRepListToZone() {
  if (!DashState.zoneFilterActive) {
    // Show all reps at full opacity
    document.querySelectorAll('.td-rep-row').forEach(r => {
      r.style.opacity = '';
      r.style.pointerEvents = '';
    });
    return;
  }
  // Find which KAMs have accounts in selected district
  // For now using mock: hub_zone matches rep index group
  // Phase 2: replace with real account → district mapping
  const dist = DashState.selectedDistrictName;
  const distData = MOCK_DISTRICT?.[dist];
  const hubZone  = distData?.hub_zone || '';

  document.querySelectorAll('.td-rep-row').forEach(r => {
    const repEmail = r.dataset.repEmail;
    const groups = buildKamGroups();
    const repGroup = groups.find(g => g.email === repEmail);
    // Simple heuristic: KAMs with accounts in this hub zone
    // In Phase 2 replace with: repGroup.accounts.some(a => a.district === dist)
    const isInZone = hubZone
      ? (repGroup?.key?.charCodeAt(0) || 0) % 3 === (hubZone.charCodeAt(hubZone.length-1) || 0) % 3
      : true;
    r.style.opacity      = isInZone ? '' : '0.28';
    r.style.pointerEvents = isInZone ? '' : 'none';
  });
}

// ── Sync: Rep → Map highlight ─────────────────────────────────
function syncMapToRep() {
  if (typeof mapG === 'undefined' || !mapG) return;
  const email = DashState.selectedRepEmail;
  if (!email) {
    // Reset all polygons
    mapG.select('.g-bkk').selectAll('path')
      .style('opacity', null)
      .classed('rep-highlight', false)
      .classed('rep-dim', false);
    return;
  }
  // Find accounts owned by this rep
  const repAccounts = getMyAccounts().filter(a => a.kamEmail === email);
  // For now map to districts via mock hub_zone logic
  // Phase 2: use real account.district field
  const repIdx = buildKamGroups().findIndex(g => g.email === email);
  const hubMatch = 'Hub ' + (repIdx + 1);

  mapG.select('.g-bkk').selectAll('path')
    .classed('rep-highlight', d => MOCK_DISTRICT?.[d.properties.name_th]?.hub_zone === hubMatch)
    .classed('rep-dim',       d => MOCK_DISTRICT?.[d.properties.name_th]?.hub_zone !== hubMatch)
    .style('opacity', d => {
      const hz = MOCK_DISTRICT?.[d.properties.name_th]?.hub_zone;
      if (hz === hubMatch) return '1';
      return '0.22';
    });
}

// ── Sync: rep row highlight from external call ────────────────
function renderSidebarRepHighlight() {
  document.querySelectorAll('.td-rep-row').forEach(r => {
    r.classList.toggle('selected', r.dataset.repEmail === DashState.selectedRepEmail);
  });
}

// ── Detail panel ──────────────────────────────────────────────
function openDetail(html) {
  document.getElementById('detail-content').innerHTML = html;
  document.getElementById('detail-panel').classList.add('open');
}
function closeDetail() {
  document.getElementById('detail-panel').classList.remove('open');
  DashState.clearAll();
}
