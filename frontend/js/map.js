/* ============================================================
   SURAKSHA — map.js
   Real-road safety map. Every coloured line is a ~100 m piece of
   a real OpenStreetMap road, scored from lamps / shops / bus stops /
   police nearby, recent reports and women's ratings.
   ============================================================ */

'use strict';

const DEFAULT_CENTER = [12.9716, 79.1575]; // VIT Vellore
const DEFAULT_ZOOM   = 15;
const MIN_ZOOM_DATA  = 14;                 // below this the area is too big to draw

const map = L.map('map', { center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM, zoomControl: true, preferCanvas: true });

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '© OpenStreetMap contributors',
  maxZoom: 19,
}).addTo(map);

/* ─── Layers & state ─────────────────────────────────────── */
const roadLayer = L.layerGroup().addTo(map);
const flagLayer = L.layerGroup();
let heatLayer   = null;
let flagCoords  = null;
let selectedId  = null;
let loadSeq     = 0;
const layerState = { scores: true, heatmap: true, flags: false };

const COLORS = { safe: '#22c55e', caution: '#f59e0b', risk: '#ef4444', nodata: '#6b7280' };
const GRADE_LABEL = { safe: 'Safe', caution: 'Caution', risk: 'High risk', nodata: 'No data' };
const GRADE_CLASS = { safe: 'safe', caution: 'warn', risk: 'danger', nodata: 'warn' };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function clientId() {
  return TokenManager.get() || TokenManager.generate();
}

function selectedHour() {
  const v = document.getElementById('hourSel')?.value;
  return v === 'now' || v === undefined ? null : Number(v);
}

/* ─── Road segments ──────────────────────────────────────── */
async function loadRoads() {
  const seq = ++loadSeq;
  const hint = document.getElementById('zoomHint');

  if (map.getZoom() < MIN_ZOOM_DATA) {
    roadLayer.clearLayers();
    if (hint) { hint.style.display = 'block'; hint.textContent = 'Zoom in to see road safety scores'; }
    return;
  }
  const b = map.getBounds();
  const q = new URLSearchParams({
    south: b.getSouth().toFixed(5), west: b.getWest().toFixed(5),
    north: b.getNorth().toFixed(5), east: b.getEast().toFixed(5),
  });
  const h = selectedHour();
  if (h !== null) q.set('hour', h);

  try {
    const data = await apiFetch(`${API.safetySegments}?${q}`);
    if (seq !== loadSeq) return; // a newer request replaced this one
    roadLayer.clearLayers();

    let sum = 0, known = 0;
    data.segments.forEach((s) => {
      const grade = s.grade;
      const line = L.polyline(s.path, {
        color: COLORS[grade] || COLORS.nodata,
        weight: grade === 'nodata' ? 3 : 5,
        opacity: grade === 'nodata' ? 0.5 : 0.9,
        dashArray: grade === 'nodata' ? '4 6' : null,
        lineCap: 'round',
      });
      line.on('click', () => selectSegment(s.id));
      line.bindTooltip(`${esc(s.name || 'Unnamed road')} · ${s.score ?? '—'}`, { sticky: true });
      roadLayer.addLayer(line);
      if (s.score != null) { sum += s.score; known++; }
    });

    const avgEl = document.getElementById('stat-avg');
    if (avgEl) avgEl.textContent = known ? Math.round(sum / known) : '—';

    if (hint) {
      if (!data.count) {
        hint.style.display = 'block';
        hint.textContent = 'No road data loaded for this area yet (run the OSM import).';
      } else hint.style.display = 'none';
    }
  } catch (err) {
    console.error('Failed to load roads:', err);
  }
}

/* ─── Selected road panel ────────────────────────────────── */
async function selectSegment(id) {
  selectedId = id;
  const box = document.getElementById('scoreContent');
  if (!box) return;
  box.innerHTML = '<p style="font-size:var(--text-xs);color:var(--clr-text-3);">Loading…</p>';
  try {
    const d = await apiFetch(`${API.safetySegment}/${id}`);
    if (selectedId !== id) return;
    renderPanel(d);
    loadPrediction(d.lat, d.lng);
  } catch {
    box.innerHTML = '<p style="font-size:var(--text-xs);color:var(--clr-text-3);">Could not load this road.</p>';
  }
}

function renderPanel(d) {
  const grade = d.grade, cls = GRADE_CLASS[grade], color = COLORS[grade];
  const scoreTxt = d.score == null ? '—' : d.score;
  const reasons = (d.reasons || []).map((r) =>
    `<li style="margin-bottom:3px;color:${r.startsWith('−') ? '#fca5a5' : 'var(--clr-text-2)'};">${esc(r)}</li>`).join('');
  const f = d.facts || {};
  const rated = d.ratings && d.ratings.count
    ? `${d.ratings.count} rating(s), avg ${d.ratings.average}/10` : 'No ratings yet';

  document.getElementById('scoreContent').innerHTML = `
    <div class="score-display">
      <div class="score-circle score-circle--${cls}">${scoreTxt}</div>
      <div>
        <div style="font-size:var(--text-sm);font-weight:700;color:${color};margin-bottom:2px;">${GRADE_LABEL[grade]}</div>
        <div style="font-size:var(--text-xs);color:var(--clr-text-2);line-height:1.4;">${esc(d.name)}</div>
        <div style="font-size:10px;color:var(--clr-text-3);">Confidence: ${esc(d.confidence)}</div>
      </div>
    </div>
    <ul style="margin:var(--space-3) 0 0;padding-left:16px;font-size:11px;line-height:1.4;">${reasons}</ul>
    <div style="margin-top:var(--space-3);font-size:10px;color:var(--clr-text-3);line-height:1.5;">
      Lamps ${f.lamps ?? 0} · Shops ${f.shops ?? 0} · Bus stops ${f.busStops ?? 0} · Reports nearby ${d.incidentsNearby ?? 0}<br/>
      ${rated}
    </div>
    <div style="margin-top:var(--space-3);padding-top:var(--space-3);border-top:1px solid var(--clr-border);">
      <div style="font-size:11px;font-weight:700;margin-bottom:6px;">Walked here? Rate this road (1 = unsafe, 10 = safe)</div>
      <div id="rateRow" style="display:flex;flex-wrap:wrap;gap:4px;">
        ${[1,2,3,4,5,6,7,8,9,10].map((n) => `<button data-r="${n}" class="btn btn--secondary btn--sm" style="padding:2px 8px;min-width:28px;">${n}</button>`).join('')}
      </div>
      <div id="rateMsg" style="font-size:10px;color:var(--clr-text-3);margin-top:4px;">Anonymous · one rating per road per day</div>
    </div>
    <div style="font-size:9px;color:var(--clr-text-3);margin-top:var(--space-2);">Data: OpenStreetMap contributors + Suraksha users</div>
  `;

  document.querySelectorAll('#rateRow button').forEach((btn) => {
    btn.addEventListener('click', async () => {
      try {
        await apiFetch(API.safetyRate, {
          method: 'POST',
          body: JSON.stringify({ segmentId: d.id, clientId: clientId(), rating: Number(btn.dataset.r) }),
        });
        Toast.success('Thanks — your rating was saved.');
        selectSegment(d.id);
        loadRoads();
      } catch (e) {
        Toast.error(e.message || 'Could not save rating.');
      }
    });
  });
}

/* ─── "Same road, next hours" ────────────────────────────── */
async function loadPrediction(lat, lng) {
  const predCard = document.getElementById('predCard');
  const predContent = document.getElementById('predContent');
  if (!predCard || !predContent) return;
  try {
    const data = await apiFetch(`${API.safetyPredict}?lat=${lat}&lng=${lng}`);
    const p = data.predictions || [];
    if (!p.length) { predCard.style.display = 'none'; return; }
    predCard.style.display = 'block';
    const worst = p.reduce((a, b) => ((a.score ?? 101) < (b.score ?? 101) ? a : b));
    predContent.innerHTML = `
      <p style="font-size:var(--text-xs);color:var(--clr-text-2);line-height:1.5;">
        Lowest in the next hours: <strong>${worst.score ?? '—'}/100</strong> at ${esc(worst.label)}
      </p>
      <div style="margin-top:var(--space-2);display:flex;flex-direction:column;gap:4px;">
        ${p.map((x) => `<div style="display:flex;justify-content:space-between;font-size:10px;">
          <span style="color:var(--clr-text-3);">${esc(x.label)}</span>
          <span style="color:${COLORS[x.colour === 'green' ? 'safe' : x.colour === 'amber' ? 'caution' : 'risk']};font-weight:600;">${x.score ?? '—'}</span></div>`).join('')}
      </div>
      <p style="font-size:9px;color:var(--clr-text-3);margin-top:6px;">Only time of day changes — not a forecast of incidents.</p>`;
  } catch { predCard.style.display = 'none'; }
}

/* ─── Flags: heatmap + markers ───────────────────────────── */
function makeFlagIcon(type) {
  const icons = { harassment: '😠', poor_lighting: '💡', unsafe_crowd: '👥', other: '⚠️' };
  return L.divIcon({
    className: '',
    html: `<div style="width:28px;height:28px;border-radius:50%;background:rgba(239,68,68,0.15);border:2px solid #ef4444;display:flex;align-items:center;justify-content:center;font-size:12px;cursor:pointer;">${icons[type] || '⚠️'}</div>`,
    iconSize: [28, 28], iconAnchor: [14, 14], popupAnchor: [0, -16],
  });
}

const FLAG_LABELS = { harassment: 'Harassment', poor_lighting: 'Poor lighting', unsafe_crowd: 'Unsafe crowd', other: 'Other concern' };

async function loadFlags() {
  try {
    const { flags } = await apiFetch(API.safetyFlags);
    flagLayer.clearLayers();
    const dayAgo = Date.now() - 86400000;
    let last24 = 0;
    flags.forEach((f) => {
      if (new Date(f.createdAt).getTime() >= dayAgo) last24++;
      L.marker([f.lat, f.lng], { icon: makeFlagIcon(f.flagType) })
        .bindPopup(`<b>${esc(FLAG_LABELS[f.flagType] || 'Flag')}</b><br/>${new Date(f.createdAt).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`)
        .addTo(flagLayer);
    });
    const inc = document.getElementById('stat-incidents'); if (inc) inc.textContent = last24;
    const cnt = document.getElementById('stat-flags');     if (cnt) cnt.textContent = flags.length;

    if (heatLayer) { map.removeLayer(heatLayer); heatLayer = null; }
    if (flags.length && typeof L.heatLayer === 'function') {
      heatLayer = L.heatLayer(flags.map((f) => [f.lat, f.lng, 0.8]), {
        radius: 25, blur: 20, maxZoom: 17,
        gradient: { 0.0: '#f59e0b', 0.6: '#ef4444', 1.0: '#7f1d1d' },
      });
      if (layerState.heatmap) heatLayer.addTo(map);
    }
  } catch (err) { console.error('Failed to load flags:', err); }
}

/* ─── Toggles ────────────────────────────────────────────── */
document.getElementById('toggleScores').addEventListener('click', function () {
  layerState.scores = !layerState.scores;
  this.classList.toggle('active', layerState.scores);
  if (layerState.scores) { roadLayer.addTo(map); loadRoads(); } else map.removeLayer(roadLayer);
});

document.getElementById('toggleHeatmap').addEventListener('click', function () {
  layerState.heatmap = !layerState.heatmap;
  this.classList.toggle('active', layerState.heatmap);
  if (heatLayer) { layerState.heatmap ? heatLayer.addTo(map) : map.removeLayer(heatLayer); }
});

document.getElementById('toggleFlags').addEventListener('click', function () {
  layerState.flags = !layerState.flags;
  this.classList.toggle('active', layerState.flags);
  layerState.flags ? flagLayer.addTo(map) : map.removeLayer(flagLayer);
});

document.getElementById('hourSel')?.addEventListener('change', loadRoads);

/* ─── Locate me ──────────────────────────────────────────── */
document.getElementById('locateMe').addEventListener('click', () => {
  if (!navigator.geolocation) { Toast.error('Geolocation not supported.'); return; }
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude: lat, longitude: lng } = pos.coords;
      map.setView([lat, lng], 17);
      L.circle([lat, lng], { radius: 40, color: '#f5a623', fillColor: '#f5a62333', fillOpacity: 0.4, weight: 2 })
        .addTo(map).bindPopup('<b style="color:#f5a623;">You are here</b>').openPopup();
      apiFetch(`${API.safetyScore}?lat=${lat}&lng=${lng}`)
        .then((s) => { if (s.segmentId) selectSegment(s.segmentId); })
        .catch(() => {});
    },
    () => Toast.error('Could not get your location.')
  );
});

/* ─── Flag modal ─────────────────────────────────────────── */
document.getElementById('openFlagModal').addEventListener('click', () => {
  const c = map.getCenter();
  flagCoords = { lat: c.lat.toFixed(5), lng: c.lng.toFixed(5) };
  document.getElementById('flagCoords').textContent = `${flagCoords.lat}, ${flagCoords.lng}`;
  document.getElementById('flagModal').classList.add('visible');
});

map.on('click', (e) => {
  if (document.getElementById('flagModal').classList.contains('visible')) {
    flagCoords = { lat: e.latlng.lat.toFixed(5), lng: e.latlng.lng.toFixed(5) };
    document.getElementById('flagCoords').textContent = `${flagCoords.lat}, ${flagCoords.lng}`;
  }
});

window.closeFlagModal = () => document.getElementById('flagModal').classList.remove('visible');

document.getElementById('submitFlag').addEventListener('click', async () => {
  const flagType = document.querySelector('input[name="flagType"]:checked')?.value;
  if (!flagType) { Toast.warning('Please select the type of concern.'); return; }
  const btn = document.getElementById('submitFlag');
  setLoading(btn, true);
  try {
    await apiFetch(API.safetyFlag, {
      method: 'POST',
      body: JSON.stringify({ lat: parseFloat(flagCoords.lat), lng: parseFloat(flagCoords.lng), flagType, description: FLAG_LABELS[flagType] }),
    });
    Toast.success('Flag submitted anonymously. Thank you!');
    closeFlagModal();
    loadFlags();
    loadRoads();
  } catch { Toast.error('Failed to submit flag. Please try again.'); }
  finally { setLoading(btn, false); }
});

/* ─── Refresh on move, every 60 s ────────────────────────── */
let moveDebounce;
map.on('moveend', () => { clearTimeout(moveDebounce); moveDebounce = setTimeout(loadRoads, 400); });
setInterval(() => { loadRoads(); loadFlags(); }, 60000);

loadRoads();
loadFlags();
