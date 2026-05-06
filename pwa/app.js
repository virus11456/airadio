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

// --- Autoplay overlay helper (browser autoplay policy) ---
function showTapOverlay() {
  let ov = document.getElementById('tap-overlay');
  if (ov) return;
  ov = document.createElement('div');
  ov.id = 'tap-overlay';
  ov.innerHTML = '<div class="tap-inner">&gt; TAP TO TUNE IN<br><span class="tap-sub">[ AIRADIO.FM ]</span></div>';
  document.body.appendChild(ov);
  ov.addEventListener('click', () => {
    audio.muted = false;
    tryPlay();
    ov.remove();
  });
}
function tryPlay() {
  return audio.play().catch(err => {
    if (err && (err.name === 'NotAllowedError' || /interact|gesture|user/i.test(err.message || ''))) {
      showTapOverlay();
    } else {
      console.warn('audio play failed', err);
    }
  });
}


function setNow(item) {
  currentItem = item;
  if (!item) return;
  if (item.kind === 'music') {
    $('now-title').textContent = item.title || '—';
    $('now-artist').textContent = item.artist || '';
    // keep Pac-Man canvas alive (do not overwrite cover)
    if (item.src) {
      audio.src = item.src;
      tryPlay();
    }
  } else if (item.kind === 'dj') {
    if (item.say && item.say.trim()) $('dj-line').textContent = item.say;
    if (item.src && djEnabled) {
      audio.src = item.src.startsWith('/') ? item.src : `/audio/tts/${item.src.split('/').pop()}`;
      tryPlay();
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
$('btn-toggle').addEventListener('click', () => {
  const a = $('audio');
  a.muted = !a.muted;
  $('btn-toggle').textContent = a.muted ? '[X] MUTED' : '[♪] LIVE';
});

// --- Chat ---
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

async function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  const inp = $('chat-input');
  inp.classList.add('sending');
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error('http ' + r.status);
    inp.value = '';
    const t = $('chat-toast');
    if (t) { t.classList.add('show'); setTimeout(()=>t.classList.remove('show'), 2000); }
  } catch (e) {
    alert('送信失敗: ' + e.message);
  } finally {
    inp.classList.remove('sending');
  }
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
    case 'dj-saying': if (payload.say && payload.say.trim()) $('dj-line').textContent = payload.say; break;
    case 'plan-updated': console.log('plan updated'); break;
    case 'cmd':
      if (payload.action === 'pause') { audio.pause(); $('btn-toggle').textContent = '▶︎'; }
      if (payload.action === 'resume') { tryPlay(); $('btn-toggle').textContent = '⏸'; }
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
