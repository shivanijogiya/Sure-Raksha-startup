/* ============================================================
   SURAKSHA — trip.js
   "Start walk" → after the expected walking time, ask her to rate
   the roads she walked (1–10). Ratings feed the road scores.
   Needs app.js (API, apiFetch, Toast, TokenManager).
   NOTE: the reminder works while Suraksha is open in a browser tab;
   true background push would need Firebase Cloud Messaging.
   ============================================================ */
'use strict';

const Trip = (() => {
  const KEY = 'suraksha_trip';
  const TAGS = [
    ['felt-safe', 'Felt safe'], ['well-lit', 'Well lit'], ['crowded', 'Crowded'],
    ['poorly-lit', 'Poorly lit'], ['empty', 'Empty'], ['felt-followed', 'Felt followed'],
  ];
  let timer = null;

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const get = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
  const clear = () => { localStorage.removeItem(KEY); clearTimeout(timer); document.getElementById('tripBar')?.remove(); };

  function start(route) {
    const roads = (route.roads || []).filter((r) => r.segmentIds.length);
    if (!roads.length) { Toast.warning('No mapped roads on this route to rate later.'); return false; }
    localStorage.setItem(KEY, JSON.stringify({
      startedAt: Date.now(), durationMin: route.durationMin, distanceM: route.distanceM, roads,
    }));
    if ('Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    Toast.success(`Walk started. We'll ask you to rate it in about ${route.durationMin} min.`);
    schedule();
    return true;
  }

  function schedule() {
    clearTimeout(timer);
    const t = get();
    if (!t) return;
    showBar(t);
    const dueIn = t.startedAt + t.durationMin * 60000 - Date.now();
    if (dueIn <= 0) { notify(); return; }
    timer = setTimeout(notify, dueIn);
  }

  function notify() {
    if ('Notification' in window && Notification.permission === 'granted' && document.hidden) {
      try {
        const n = new Notification('Suraksha — how was your walk?', { body: 'Rate the roads you just walked (takes 10 seconds).', tag: 'suraksha-trip' });
        n.onclick = () => { window.focus(); openPrompt(); n.close(); };
      } catch { /* ignore */ }
    }
    openPrompt();
  }

  function showBar(t) {
    if (document.getElementById('tripBar')) return;
    const bar = document.createElement('div');
    bar.id = 'tripBar';
    bar.style.cssText = 'position:fixed;left:50%;bottom:16px;transform:translateX(-50%);z-index:9000;background:#111318;border:1px solid #f5a623;color:#e5e7eb;border-radius:12px;padding:10px 14px;font-size:13px;display:flex;gap:12px;align-items:center;box-shadow:0 8px 30px rgba(0,0,0,.5);';
    bar.innerHTML = `<span>🚶 Walk in progress (~${t.durationMin} min)</span>
      <button id="tripArrived" style="background:#f5a623;color:#111;border:0;border-radius:8px;padding:6px 12px;font-weight:700;cursor:pointer;">I arrived — rate</button>
      <button id="tripCancel" style="background:none;border:0;color:#9ca3af;cursor:pointer;">✕</button>`;
    document.body.appendChild(bar);
    bar.querySelector('#tripArrived').onclick = openPrompt;
    bar.querySelector('#tripCancel').onclick = clear;
  }

  function openPrompt() {
    const t = get();
    if (!t || document.getElementById('tripModal')) return;
    let overall = null;
    const tags = new Set();
    const roads = t.roads.slice(0, 8);

    const wrap = document.createElement('div');
    wrap.id = 'tripModal';
    wrap.style.cssText = 'position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;padding:16px;';
    wrap.innerHTML = `
      <div style="background:#111318;border:1px solid #2a2e38;border-radius:16px;max-width:440px;width:100%;max-height:90vh;overflow:auto;padding:20px;color:#e5e7eb;font-size:14px;">
        <h3 style="margin:0 0 4px;font-size:18px;">How was your walk?</h3>
        <p style="margin:0 0 12px;color:#9ca3af;font-size:12px;">Your anonymous rating helps other women choose safer roads. 1 = felt unsafe, 10 = felt very safe.</p>
        <div id="tOverall" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          ${[1,2,3,4,5,6,7,8,9,10].map((n) => `<button data-n="${n}" style="min-width:34px;padding:6px 0;border-radius:8px;border:1px solid #2a2e38;background:#1a1d24;color:#e5e7eb;cursor:pointer;">${n}</button>`).join('')}
        </div>
        <div id="tTags" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px;">
          ${TAGS.map(([k, l]) => `<button data-t="${k}" style="padding:4px 10px;border-radius:999px;border:1px solid #2a2e38;background:#1a1d24;color:#e5e7eb;cursor:pointer;font-size:12px;">${l}</button>`).join('')}
        </div>
        ${roads.length > 1 ? `<details style="margin-bottom:12px;"><summary style="cursor:pointer;color:#f5a623;font-size:13px;">Rate individual roads (optional)</summary>
          ${roads.map((r, i) => `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px;gap:8px;">
            <span style="font-size:12px;">${esc(r.name)}</span>
            <select data-road="${i}" style="background:#1a1d24;color:#e5e7eb;border:1px solid #2a2e38;border-radius:6px;padding:3px;">
              <option value="">same as overall</option>${[1,2,3,4,5,6,7,8,9,10].map((n) => `<option>${n}</option>`).join('')}
            </select></div>`).join('')}</details>` : ''}
        <div style="display:flex;gap:8px;justify-content:flex-end;">
          <button id="tSkip" style="background:none;border:1px solid #2a2e38;color:#9ca3af;border-radius:8px;padding:8px 14px;cursor:pointer;">Skip</button>
          <button id="tSend" disabled style="background:#f5a623;color:#111;border:0;border-radius:8px;padding:8px 16px;font-weight:700;cursor:pointer;opacity:.5;">Submit</button>
        </div>
      </div>`;
    document.body.appendChild(wrap);

    const send = wrap.querySelector('#tSend');
    wrap.querySelectorAll('#tOverall button').forEach((b) => b.onclick = () => {
      overall = Number(b.dataset.n);
      wrap.querySelectorAll('#tOverall button').forEach((x) => { x.style.background = x === b ? '#f5a623' : '#1a1d24'; x.style.color = x === b ? '#111' : '#e5e7eb'; });
      send.disabled = false; send.style.opacity = 1;
    });
    wrap.querySelectorAll('#tTags button').forEach((b) => b.onclick = () => {
      const k = b.dataset.t;
      tags.has(k) ? tags.delete(k) : tags.add(k);
      b.style.background = tags.has(k) ? '#334155' : '#1a1d24';
    });
    wrap.querySelector('#tSkip').onclick = () => { wrap.remove(); clear(); };
    send.onclick = async () => {
      send.disabled = true;
      const ratings = [];
      t.roads.forEach((r, i) => {
        const sel = wrap.querySelector(`select[data-road="${i}"]`);
        const val = sel && sel.value ? Number(sel.value) : overall;
        r.segmentIds.forEach((id) => ratings.push({ segmentId: id, rating: val }));
      });
      try {
        await apiFetch(API.safetyRateBatch, {
          method: 'POST',
          body: JSON.stringify({ clientId: TokenManager.get() || TokenManager.generate(), ratings: ratings.slice(0, 300), tags: [...tags] }),
        });
        Toast.success('Thank you! Your rating will help other women.');
        wrap.remove(); clear();
      } catch (e) {
        Toast.error(e.message || 'Could not save — try again.');
        send.disabled = false;
      }
    };
  }

  // Resume after page reload / on any page that loads this file
  document.addEventListener('DOMContentLoaded', () => {
    const t = get();
    if (t && Date.now() - t.startedAt > 24 * 3600 * 1000) { clear(); return; }
    schedule();
  });

  return { start, get, clear, openPrompt };
})();
