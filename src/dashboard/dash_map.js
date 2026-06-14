// ── dash_map.js — D3 choropleth map ─────────────────────────
// Freshket TL Dashboard v707
// GeoJSON: fetched lazily from geo/ folder

let BKK_GEO = null;
let SUR_GEO = null;

async function loadGeoJSON() {
  if (BKK_GEO && SUR_GEO) return true;  // already loaded
  try {
    const [bkkResp, surResp] = await Promise.all([
      fetch('/geo/bangkok_khet.geojson'),
      fetch('/geo/surrounding_provinces.geojson'),
    ]);
    if (!bkkResp.ok || !surResp.ok) throw new Error('GeoJSON fetch failed');
    [BKK_GEO, SUR_GEO] = await Promise.all([bkkResp.json(), surResp.json()]);
    DashLog.info('map', 'GeoJSON loaded');
    return true;
  } catch(e) {
    DashLog.error('map_geojson', e.message);
    return false;
  }
}


// Mock district data until real CSV arrives (Phase 3)
const MOCK_DISTRICT = (() => {
  const districts = BKK_GEO.features.map(f => f.properties.name_th);
  const seed = (s) => { let x=s; return () => { x=(x*1664525+1013904223)&0xFFFFFFFF; return (x>>>0)/0xFFFFFFFF; }; };
  const data = {};
  districts.forEach((name, idx) => {
    const r = seed(idx * 7919 + 42);
    const base = r() * 8 + 0.5; // 0.5M – 8.5M
    data[name] = { hub_zone: 'Hub ' + (Math.floor(idx/5)+1), months: {} };
    let trend = base;
    ['Nov 25','Dec 25','Jan 26','Feb 26','Mar 26','Apr 26'].forEach(m => {
      trend *= (1 + (r()-0.45)*0.15);
      data[name].months[m] = {
        gmv: Math.round(trend * 1e6),
        accounts: Math.round(r()*150+15),
        outlets: Math.round(r()*300+30),
        new_accounts: Math.round(r()*6)
      };
    });
  });
  return data;
})();

// ── Map state ─────────────────────────────────────────────────
let mapSvg, mapProjection, mapPath, mapZoomBehavior, mapG;
let mapScope = 'bkk';

const METRIC_LABELS = {
  gmv: 'GMV ฿', accounts: 'Accounts', outlets: 'Outlets', new_accounts: 'New Acc'
};

// ── Init ──────────────────────────────────────────────────────
async function initMap() {
  const ok = await loadGeoJSON();
  if (!ok) {
    const container = document.getElementById('map-container');
    if (container) container.innerHTML = errorPanel('map', 'โหลดแผนที่ไม่ได้ — กรุณา refresh');
    return;
  }
  const container = document.getElementById('map-container');
  const W = container.clientWidth  || 800;
  const H = container.clientHeight || 600;

  mapProjection = d3.geoMercator()
    .center([100.52, 13.75])
    .scale(W * 5.5)
    .translate([W/2, H/2]);

  mapPath = d3.geoPath().projection(mapProjection);

  mapZoomBehavior = d3.zoom()
    .scaleExtent([0.4, 14])
    .on('zoom', e => { mapG.attr('transform', e.transform); });

  mapSvg = d3.select('#map-svg').call(mapZoomBehavior);
  mapG   = mapSvg.append('g');

  // Surrounding (background)
  mapG.append('g').attr('class', 'g-sur')
    .selectAll('path').data(SUR_GEO.features).join('path')
    .attr('class','td-poly-bg').attr('d', mapPath);

  // Bangkok districts
  mapG.append('g').attr('class', 'g-bkk')
    .selectAll('path').data(BKK_GEO.features).join('path')
    .attr('class','td-poly')
    .attr('d', mapPath)
    .on('mousemove', onPolyHover)
    .on('mouseleave', onPolyLeave)
    .on('click', onPolyClick);

  updateMapColors();
  renderMapToolbar();
  renderMapLegend();
  if (DashState?.salesOverlay) renderSalesOverlay();
}

// ── Colors ────────────────────────────────────────────────────
function getDistrictValue(nameTh) {
  const d = MOCK_DISTRICT[nameTh];
  if (!d) return 0;
  return d.months[currentMonth]?.[currentMetric] || 0;
}

function updateMapColors() {
  if (!mapG) return;
  const values = BKK_GEO.features.map(f => getDistrictValue(f.properties.name_th));
  const max = d3.max(values) || 1;
  const min = d3.min(values.filter(v => v > 0)) || 0;

  // Read CSS vars for choropleth
  const cs = getComputedStyle(document.documentElement);
  const c0 = cs.getPropertyValue('--choro-0').trim() || '#FFF5F7';
  const c5 = cs.getPropertyValue('--choro-5').trim() || '#CC1A3A';

  const colorScale = d3.scaleSequential()
    .domain([min, max])
    .interpolator(d3.interpolateRgb(c0, c5));

  mapG.select('.g-bkk').selectAll('path')
    .transition().duration(300)
    .attr('fill', d => {
      const v = getDistrictValue(d.properties.name_th);
      return v > 0 ? colorScale(v) : '#F5F5F5';
    });

  // Update legend labels
  const fmtVal = currentMetric === 'gmv'
    ? v => fmtGMV(v)
    : v => fmtNum(Math.round(v));
  const legMin = document.getElementById('map-leg-min');
  const legMax = document.getElementById('map-leg-max');
  if (legMin) legMin.textContent = fmtVal(0);
  if (legMax) legMax.textContent = fmtVal(max);
}

// ── Toolbar ───────────────────────────────────────────────────
function renderMapToolbar() {
  const tb = document.getElementById('map-toolbar');
  if (!tb) return;
  tb.innerHTML = `
    <div class="ds-seg-ctrl">
      <button class="ds-seg-item active" onclick="setMapScope('bkk',this)">กรุงเทพฯ</button>
      <button class="ds-seg-item" onclick="setMapScope('metro',this)">กทม.+ปริมณฑล</button>
    </div>`;
}

function setMapScope(scope, btn) {
  mapScope = scope;
  document.querySelectorAll('#map-toolbar .ds-seg-item').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  const container = document.getElementById('map-container');
  const W = container.clientWidth, H = container.clientHeight;
  if (scope === 'bkk') {
    mapProjection.center([100.52,13.75]).scale(W*5.5);
  } else {
    mapProjection.center([100.40,13.80]).scale(W*3.0);
  }
  mapPath = d3.geoPath().projection(mapProjection);
  mapSvg.call(mapZoomBehavior.transform, d3.zoomIdentity);
  mapG.selectAll('path').transition().duration(400).attr('d', mapPath);
}

// ── Legend ────────────────────────────────────────────────────
function renderMapLegend() {
  const leg = document.getElementById('map-legend');
  if (!leg) return;
  leg.innerHTML = `
    <div class="map-legend-title" id="map-leg-title">${METRIC_LABELS[currentMetric] || currentMetric}</div>
    <div class="map-legend-gradient"></div>
    <div class="map-legend-labels">
      <span id="map-leg-min">0</span>
      <span id="map-leg-max">—</span>
    </div>`;
}

// ── Hover ─────────────────────────────────────────────────────
function onPolyHover(event, d) {
  const name = d.properties.name_th;
  const dist = MOCK_DISTRICT[name];
  const entry = dist?.months[currentMonth];
  const prevM = MONTHS[MONTHS.indexOf(currentMonth)-1];
  const prev  = dist?.months[prevM];

  const tt = document.getElementById('map-tooltip');
  if (!entry) return;

  const delta = prev ? fmtDelta(entry[currentMetric], prev[currentMetric]) : '';
  const dcls  = prev ? deltaCls(entry[currentMetric], prev[currentMetric]) : '';

  tt.innerHTML = `
    <div class="tt-name">${name}</div>
    <div class="tt-zone">${dist.hub_zone || '—'}</div>
    <div class="tt-row"><span>GMV</span><span class="tt-val">${fmtGMV(entry.gmv)} ${delta ? `<span class="ds-delta ${dcls}">${delta}</span>` : ''}</span></div>
    <div class="tt-row"><span>Accounts</span><span class="tt-val">${fmtNum(entry.accounts)}</span></div>
    <div class="tt-row"><span>Outlets</span><span class="tt-val">${fmtNum(entry.outlets)}</span></div>`;

  const [mx,my] = d3.pointer(event, document.getElementById('map-container'));
  const aw = document.getElementById('map-container').clientWidth;
  const ah = document.getElementById('map-container').clientHeight;
  tt.style.left = (mx+14+170 > aw ? mx-174 : mx+14) + 'px';
  tt.style.top  = (my+14+110 > ah ? my-114 : my+14) + 'px';
  tt.classList.add('show');

  d3.select(event.target).style('opacity', '0.7');
}

function onPolyLeave(event) {
  document.getElementById('map-tooltip').classList.remove('show');
  if (!d3.select(event.target).classed('selected'))
    d3.select(event.target).style('opacity', null);
}

// ── Click ─────────────────────────────────────────────────────
function onPolyClick(event, d) {
  const name = d.properties.name_th;
  DashState.selectDistrict(name);
  if (!DashState.selectedDistrictName) {
    // was deselected — close detail
    closeDetail();
    return;
  }
  // Update polygon selected state
  mapG.select('.g-bkk').selectAll('path')
    .classed('selected', dd => dd.properties.name_th === name)
    .style('opacity', null);  // clear rep-dim when zone selected
  openDetailForDistrict(name, d.properties);
}

function openDetailForDistrict(name, props) {
  const dist  = MOCK_DISTRICT[name];
  const entry = dist?.months[currentMonth] || {};
  const prevM = MONTHS[MONTHS.indexOf(currentMonth)-1];
  const prev  = dist?.months[prevM] || {};

  const delta = prev.gmv ? fmtDelta(entry.gmv, prev.gmv) : '';
  const dcls  = prev.gmv ? deltaCls(entry.gmv, prev.gmv) : '';

  // Sparkline
  const maxGMV = Math.max(...Object.values(dist?.months||{}).map(m=>m.gmv||0)) || 1;
  const sparks = MONTHS.map(m => {
    const v = dist?.months[m]?.gmv || 0;
    const h = Math.max(4, Math.round((v/maxGMV)*44));
    const cur = m === currentMonth;
    return `<div class="td-spark-bar${cur?' cur':''}" style="height:${h}px" title="${m}: ${fmtGMV(v)}"></div>`;
  }).join('');
  const sparkLabels = MONTHS.map(m =>
    `<span style="${m===currentMonth?'color:var(--ac)':''}">${m.split(' ')[0]}</span>`
  ).join('');

  // Mock accounts
  const mockAccounts = [
    { name:'ร้านอาหารสุขุมวิท', seg:'SA', status:'active', gmv:280000 },
    { name:'The Coffee Club', seg:'Chain', status:'active', gmv:420000 },
    { name:'Local Bistro', seg:'MC', status:'atrisk', gmv:95000 },
    { name:'Hotel Kitchen', seg:'Chain', status:'active', gmv:780000 },
    { name:'Mini Mart', seg:'SA', status:'inactive', gmv:12000 },
  ].slice(0, Math.max(2, Math.floor(Math.random()*5)+2));

  const accRows = mockAccounts.map(a => `
    <div class="td-acc-row">
      <div class="td-acc-dot ${a.status}"></div>
      <div class="td-acc-name">${a.name}</div>
      <span class="ds-seg-sa" style="flex-shrink:0">${a.seg}</span>
      <div class="td-acc-gmv">${fmtGMV(a.gmv)}</div>
    </div>`).join('');

  openDetail(`
    <div class="td-detail-hd">
      <div class="ds-eyebrow">${dist?.hub_zone || 'DISTRICT'}</div>
      <div class="td-detail-title">${name}</div>
      <div class="td-detail-sub">${props.name_en || ''} · กรุงเทพมหานคร</div>
    </div>
    <div class="td-detail-body">
      <div class="td-spark-wrap">
        <div class="ds-eyebrow" style="margin-bottom:var(--space-2)">GMV 6 เดือน</div>
        <div class="td-spark">${sparks}</div>
        <div class="td-spark-labels" style="margin-top:3px">${sparkLabels}</div>
      </div>
      <div class="td-detail-section">
        <div class="ds-eyebrow" style="margin-bottom:var(--space-3)">Metrics · ${currentMonth}</div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">GMV</span>
          <span class="ds-stat-value">${fmtGMV(entry.gmv)} ${delta ? `<span class="ds-delta ${dcls}">${delta}</span>` : ''}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">Active Accounts</span>
          <span class="ds-stat-value">${fmtNum(entry.accounts)}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">Outlets</span>
          <span class="ds-stat-value">${fmtNum(entry.outlets)}</span>
        </div>
        <div class="ds-stat-row">
          <span class="ds-stat-label">New Accounts (Sales)</span>
          <span class="ds-stat-value">${fmtNum(entry.new_accounts)}</span>
        </div>
      </div>
      <div class="td-detail-section">
        <div class="ds-eyebrow" style="margin-bottom:0">Accounts ใน District</div>
      </div>
      ${accRows}
    </div>`);
}

// ── Zoom controls ─────────────────────────────────────────────
function mapZoom(factor) {
  if (!mapSvg) return;
  mapSvg.transition().duration(280).call(mapZoomBehavior.scaleBy, factor);
}
function mapReset() {
  if (!mapSvg) return;
  mapSvg.transition().duration(380).call(mapZoomBehavior.transform, d3.zoomIdentity);
}

// ── Boot: init map when map view becomes active ───────────────
function checkInitMap() {
  if (!mapG && document.getElementById('view-map')?.classList.contains('active')) {
    setTimeout(initMap, 0);
  }
}
// Called from setView override
const _origSetView = typeof setView === 'function' ? setView : null;

// Watch for map view — init on first show
let _mapInited = false;
const _mapObserver = new MutationObserver(() => {
  const mapView = document.getElementById('view-map');
  if (mapView?.classList.contains('active') && !_mapInited) {
    _mapInited = true;
    setTimeout(initMap, 60);
  }
});
document.addEventListener('DOMContentLoaded', () => {
  const mapView = document.getElementById('view-map');
  if (mapView) {
    _mapObserver.observe(mapView, { attributes: true, attributeFilter: ['class'] });
    // If already active on load
    if (mapView.classList.contains('active')) {
      _mapInited = true;
      setTimeout(initMap, 80);
    }
  }
});


// ── Sales overlay (Phase 3) ───────────────────────────────────
function renderSalesOverlay() {
  // Remove existing overlay
  mapG?.selectAll('.td-sales-dot').remove();
  if (!DashState.salesOverlay || !mapG) return;

  // Mock: generate acquisition dots across Bangkok
  // Phase 2: replace with real first_dollar_date + lat/lng from R2
  const mockDots = BKK_GEO.features.flatMap(f => {
    const centroid = mapPath?.centroid(f);
    if (!centroid || isNaN(centroid[0])) return [];
    const dist = MOCK_DISTRICT?.[f.properties.name_th];
    const count = dist?.months[currentMonth]?.new_accounts || 0;
    return Array.from({length: Math.min(count, 6)}, (_, i) => ({
      x: centroid[0] + (Math.random()-0.5) * 20,
      y: centroid[1] + (Math.random()-0.5) * 20,
      name: f.properties.name_th,
      gmv: Math.round(Math.random() * 200000 + 50000)
    }));
  });

  mapG.append('g').attr('class', 'td-sales-dot-group')
    .selectAll('circle').data(mockDots).join('circle')
    .attr('class', 'td-sales-dot')
    .attr('cx', d => d.x)
    .attr('cy', d => d.y)
    .attr('r', 5)
    .style('fill', 'var(--info)')
    .style('stroke', 'white')
    .style('stroke-width', '1.5')
    .style('opacity', '0')
    .style('cursor', 'pointer')
    .on('mousemove', (event, d) => {
      const tt = document.getElementById('map-tooltip');
      tt.innerHTML = `<div class="tt-name" style="color:var(--info)">New Account (Sales)</div>
        <div class="tt-zone">${d.name}</div>
        <div class="tt-row"><span>GMV</span><span class="tt-val">${fmtGMV(d.gmv)}</span></div>`;
      const [mx,my] = d3.pointer(event, document.getElementById('map-container'));
      tt.style.left = (mx+14) + 'px'; tt.style.top = (my+14) + 'px';
      tt.classList.add('show');
    })
    .on('mouseleave', () => document.getElementById('map-tooltip').classList.remove('show'))
    .transition().duration(300)
    .style('opacity', '0.85');
}

// Window resize
window.addEventListener('resize', () => {
  if (!_mapInited || !mapSvg) return;
  const container = document.getElementById('map-container');
  if (!container) return;
  const W = container.clientWidth, H = container.clientHeight;
  mapProjection.translate([W/2, H/2]);
  mapPath = d3.geoPath().projection(mapProjection);
  mapG.selectAll('path').attr('d', mapPath);
});
