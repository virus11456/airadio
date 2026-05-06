// Single-page PWA controller. One <audio> element. WS for live events.
// Three views toggled by nav buttons. Profile writes back via PUT /api/taste.

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const status = $('status');

// View switching
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    $(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'profile') loadProfile();
  });
});

// --- Audio control ---
let djEnabled = true;
let currentItem = null;

function setNow(item) {
  currentItem = item;
  if (!item) return;
  if (item.kind === 'music') {
    $('now-title').textContent = item.title || '—';
    $('now-artist').textContent = item.artist || '';
    $('cover').textContent = '♪';
    if (item.src) {
      audio.src = item.src;
      audio.play().catch(e => console.warn('audio play failed', e));
    }
  } else if (item.kind === 'dj') {
    $('dj-line').textContent = item.say || '';
    if (item.src && djEnabled) {
      audio.src = item.src.startsWith('/') ? item.src : `/audio/tts/${item.src.split('/').pop()}`;
      audio.play().catch(() => {});
    }
  }
}

function setQueue(queue) {
  const list = $('queue-list');
  list.innerHTML = '';
  for (const q of queue) {
    const div = document.createElement('div');
    div.className = 'queue-item';
    const label = q.kind === 'dj' ? 'DJ' : '♪';
    const text = q.kind === 'dj' ? (q.say || '').slice(0, 60) : `${q.title} — ${q.artist || ''}`;
    div.innerHTML = `<span class="kind">${label}</span><span>${escapeHtml(text)}</span>`;
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Controls ---
$('btn-toggle').addEventListener('click', async () => {
  if (audio.paused) {
    audio.play().catch(() => {});
    await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '繼續' }) });
    $('btn-toggle').textContent = '⏸';
  } else {
    audio.pause();
    await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '暫停' }) });
    $('btn-toggle').textContent = '▶︎';
  }
});

$('btn-skip').addEventListener('click', async () => {
  await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '下一首' }) });
});

$('btn-prev').addEventListener('click', () => {
  audio.currentTime = 0;
  audio.play().catch(() => {});
});

// --- Chat ---
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('chat-input').value = '';
  await fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

// --- Profile ---
async function loadProfile() {
  const r = await fetch('/api/taste');
  const data = await r.json();
  $('profile-taste').value = data.taste || '';
  $('profile-routines').value = data.routines || '';
  $('profile-mood').value = data.mood || '';
  $('profile-playlists').value = data.playlists || '';
}

$('profile-save').addEventListener('click', async () => {
  const body = {
    taste: $('profile-taste').value,
    routines: $('profile-routines').value,
    mood: $('profile-mood').value,
    playlists: $('profile-playlists').value,
  };
  const r = await fetch('/api/taste', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  alert(j.ok ? '已儲存：' + j.updated.join(', ') : '失敗');
});

// --- Settings ---
$('set-volume').addEventListener('input', e => {
  audio.volume = e.target.value / 100;
});
audio.volume = 0.8;

$('set-dj').addEventListener('change', e => {
  djEnabled = e.target.checked;
});

// --- WS ---
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${proto}//${location.host}/stream`);
  ws.onopen = () => { status.textContent = 'connected'; };
  ws.onclose = () => {
    status.textContent = 'disconnected, retrying…';
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => { status.textContent = 'ws error'; };
  ws.onmessage = (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    handleEvent(msg);
  };
}

function handleEvent(msg) {
  const { type, payload } = msg;
  switch (type) {
    case 'now-playing': setNow(payload); break;
    case 'queue-update': setQueue(payload.queue || []); break;
    case 'dj-saying': $('dj-line').textContent = payload.say || ''; break;
    case 'plan-updated': console.log('plan updated'); break;
    case 'cmd':
      if (payload.action === 'pause') { audio.pause(); $('btn-toggle').textContent = '▶︎'; }
      if (payload.action === 'resume') { audio.play().catch(() => {}); $('btn-toggle').textContent = '⏸'; }
      break;
    case 'hello': status.textContent = `connected · ${new Date(payload.ts).toLocaleTimeString()}`; break;
  }
}

// --- Bootstrap ---
async function bootstrap() {
  try {
    const now = await fetch('/api/now').then(r => r.json());
    if (now.current) setNow(now.current);
    const next = await fetch('/api/next').then(r => r.json());
    setQueue(next.queue || []);
  } catch (e) {
    console.warn('bootstrap failed', e);
  }
  connectWS();
}

audio.addEventListener('ended', () => {
  // Server-driven advancement; just nudge the WS in case we missed an event.
  fetch('/api/now').then(r => r.json()).then(j => j.current && setNow(j.current));
});

bootstrap();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
