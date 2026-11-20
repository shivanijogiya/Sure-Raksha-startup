// ─────────────────────────────────────────────
//  Suraksha — frontend/js/route.js
//  Walking routes scored on real roads; recommends the safest.
// ─────────────────────────────────────────────
let map, fromMarker, toMarker;
let fromCoords = null, toCoords = null;
let clickState = 'from';
let routeLayers = [];       // polylines for each candidate
let dangerMarkers = [];
let lastResult = null;
let selectedRouteId = null;

const GRADE_COLOR = { safe: '#22c55e', caution: '#f59e0b', risk: '#ef4444', nodata: '#9ca3af' };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

document.addEventListener('DOMContentLoaded', () => {
  map = L.map('routeMap').setView([12.9716, 79.1591], 15); // VIT Vellore default
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors', maxZoom: 19,
  }).addTo(map);
  map.on('click', onMapClick);

  document.getElementById('useMyLoc')?.addEventListener('click', (e) => {
    e.preventDefault();
    if (!navigator.geolocation) { Toast.error('Geolocation not supported.'); return; }
    navigator.geolocation.getCurrentPosition(
      (pos) => { setFrom(pos.coords.latitude, pos.coords.longitude); map.setView([pos.coords.latitude, pos.coords.longitude], 16); },
      () => Toast.error('Could not get your location.')
    );
  });
});

function setFrom(lat, lng) {
  fromCoords = { lat, lng };
  document.getElementById('fromInput').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (fromMarker) map.removeLayer(fromMarker);
  fromMarker = L.marker([lat, lng], { icon: colorIcon('green'), title: 'From' }).addTo(map).bindPopup('Start');
  clickState = 'to';
  document.getElementById('checkRouteBtn').disabled = !(fromCoords && toCoords);
}

function setTo(lat, lng) {
  toCoords = { lat, lng };
  document.getElementById('toInput').value = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
  if (toMarker) map.removeLayer(toMarker);
  toMarker = L.marker([lat, lng], { icon: colorIcon('blue'), title: 'To' }).addTo(map).bindPopup('Destination');
  clickState = 'from';
  document.getElementById('checkRouteBtn').disabled = !(fromCoords && toCoords);
}

function onMapClick(e) {
  const { lat, lng } = e.latlng;
  clickState === 'from' ? setFrom(lat, lng) : setTo(lat, lng);
}

// ── Ask the backend for scored walking routes ─────────────────────────────────
async function checkRoute() {
  if (!fromCoords || !toCoords) return;
  const btn = document.getElementById('checkRouteBtn');
  btn.textContent = 'Finding safest route…';
  btn.disabled = true;
  try {
    const params = new URLSearchParams({
      fromLat: fromCoords.lat, fromLng: fromCoords.lng, toLat: toCoords.lat, toLng: toCoords.lng,
    });
    const data = await apiFetch(`${API.safetyRoute}?${params}`);
    lastResult = data;
    selectedRouteId = data.recommendedId;
    draw();
    renderResult();
  } catch (err) {
    console.error(err);
    Toast.error(err.message || 'Could not find a route.');
  } finally {
    btn.textContent = 'Check Route Safety';
    btn.disabled = false;
  }
}

function draw() {
  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];
  clearDangerMarkers();
  if (!lastResult) return;

  // Unselected first (thin, dashed), selected last (thick, coloured, on top)
  const ordered = [...lastResult.candidates].sort((a, b) => (a.id === selectedRouteId) - (b.id === selectedRouteId));
  ordered.forEach((c) => {
    const sel = c.id === selectedRouteId;
    const line = L.polyline(c.path, {
      color: sel ? GRADE_COLOR[c.grade] : '#6b7280',
      weight: sel ? 7 : 4,
      opacity: sel ? 0.95 : 0.7,
      dashArray: sel ? null : '6 8',
    }).addTo(map);
    line.on('click', () => { selectedRouteId = c.id; draw(); renderResult(); });
    routeLayers.push(line);
    if (sel) {
      map.fitBounds(line.getBounds(), { padding: [40, 40] });
      c.dangerZones.forEach((z) => {
        dangerMarkers.push(
          L.circleMarker([z.lat, z.lng], { radius: 10, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.45, weight: 2 })
            .addTo(map)
            .bindPopup(`⚠️ ${esc(z.name || 'Low-scoring stretch')} · ${z.score}/100 · ~${z.lengthM} m<br>${z.reasons.map(esc).join('<br>')}`)
        );
      });
    }
  });
}

function routeTitle(c) {
  if (c.isRecommended && c.isFastest) return 'Recommended · also the fastest';
  if (c.isRecommended) return 'Recommended (safest reasonable)';
  if (c.isFastest) return 'Fastest';
  return 'Alternative';
}

function renderResult() {
  const sec = document.getElementById('routeResult');
  sec.classList.remove('hidden');
  const r = lastResult;
  const rec = r.candidates.find((c) => c.id === r.recommendedId);
  const fast = r.candidates.find((c) => c.id === r.fastestId);

  // headline comparison
  let head = '';
  if (!r.roadDataLoaded) {
    head = `<div class="badge badge--warn">No road data loaded for this area yet — showing walking routes only. Run the OSM import.</div>`;
  } else if (rec.id !== fast.id && rec.score != null && fast.score != null) {
    const extra = rec.durationMin - fast.durationMin;
    head = `<div style="font-size:15px;"><b>Safer route found:</b> ${rec.score}/100 vs ${fast.score}/100 for the fastest — ${extra > 0 ? `${extra} min longer` : 'same time'}.</div>`;
  } else if (rec.score != null) {
    head = `<div style="font-size:15px;">The fastest route is also the safest option here (${rec.score}/100).</div>`;
  }
  document.getElementById('scoreDisplay').innerHTML = head;

  document.getElementById('routeCards').innerHTML = r.candidates.map((c) => {
    const sel = c.id === selectedRouteId;
    const col = GRADE_COLOR[c.grade];
    const km = (c.distanceM / 1000).toFixed(2);
    const cov = Math.round(c.coverage * 100);
    return `<div data-id="${c.id}" style="cursor:pointer;border:2px solid ${sel ? col : 'rgba(255,255,255,.12)'};border-radius:12px;padding:12px 14px;display:flex;gap:14px;align-items:center;">
      <div style="min-width:58px;height:58px;border-radius:50%;border:3px solid ${col};display:flex;align-items:center;justify-content:center;font-weight:800;font-size:18px;color:${col};">${c.score ?? '—'}</div>
      <div style="flex:1;">
        <div style="font-weight:700;">${routeTitle(c)}</div>
        <div style="font-size:13px;opacity:.8;">${c.durationMin} min · ${km} km · ${c.dangerZones.length} low-score stretch(es) · map data on ${cov}% of route</div>
        <div style="font-size:12px;opacity:.65;">via ${esc(c.roads.slice(0, 3).map((x) => x.name).join(', ') || 'unnamed roads')}</div>
      </div>
      ${sel ? `<button class="btn-primary" id="startWalkBtn" style="white-space:nowrap;">Start walk</button>` : ''}
    </div>`;
  }).join('');

  document.querySelectorAll('#routeCards [data-id]').forEach((el) => {
    el.addEventListener('click', (e) => {
      if (e.target.id === 'startWalkBtn') return;
      selectedRouteId = el.dataset.id; draw(); renderResult();
    });
  });
  document.getElementById('startWalkBtn')?.addEventListener('click', () => {
    const c = r.candidates.find((x) => x.id === selectedRouteId);
    if (Trip.start(c)) document.getElementById('startWalkBtn').textContent = 'Walk started ✓';
  });

  // danger list for the selected route
  const sel = r.candidates.find((c) => c.id === selectedRouteId);
  const list = document.getElementById('dangerList');
  list.innerHTML = sel.dangerZones.length
    ? `<h3 style="margin-top:14px;color:#ef4444;">⚠️ ${sel.dangerZones.length} low-score stretch(es) on this route</h3>` +
      sel.dangerZones.map((z) => `<div class="danger-zone-item">📍 ${esc(z.name || 'Unnamed road')} — ~${z.lengthM} m, score ${z.score}<br><span style="opacity:.75;font-size:12px;">${z.reasons.map(esc).join(' · ')}</span></div>`).join('')
    : (sel.score == null
        ? `<p style="opacity:.8;">Not enough map data along this route to score it. Stay on busy roads and share your live location.</p>`
        : `<p style="color:#22c55e;">✅ No low-score stretches on this route.</p>`);
  document.getElementById('routeNote').textContent = r.note || '';
}

function clearDangerMarkers() {
  dangerMarkers.forEach((m) => map.removeLayer(m));
  dangerMarkers = [];
}

function resetRoute() {
  fromCoords = null; toCoords = null; clickState = 'from'; lastResult = null; selectedRouteId = null;
  document.getElementById('fromInput').value = '';
  document.getElementById('toInput').value = '';
  document.getElementById('checkRouteBtn').disabled = true;
  document.getElementById('routeResult').classList.add('hidden');
  if (fromMarker) map.removeLayer(fromMarker);
  if (toMarker) map.removeLayer(toMarker);
  routeLayers.forEach((l) => map.removeLayer(l));
  routeLayers = [];
  clearDangerMarkers();
}

function colorIcon(color) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;background:${color};border:2px solid #fff;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  });
}
