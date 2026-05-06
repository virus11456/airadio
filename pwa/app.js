// Single-page PWA controller. One <audio> element. WS for live events.
// Three views toggled by nav buttons. Profile writes back via PUT /api/taste.

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const statusEl = $('status');
const pill = $('pill-status');

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
let started = false; // user has tapped to allow audio

function setStatus(text, level = 'ok') {
  statusEl.textContent = text;
  pill.textContent = text;
  pill.classList.remove('ok', 'warn', 'err');
  pill.classList.add(level);
}

function setNow(item) {
  currentItem = item;
  if (!item) return;
  if (item.kind === 'music') {
    $('now-title').textContent = item.title || '—';
    $('now-artist').textContent = item.artist || '';
    $('cover-empty').style.display = 'none';
    $('dj-line').classList.remove('speaking');
    if (item.src) playAudio(item.src);
    if (item.songId) loadLyrics(item.songId);
  } else if (item.kind === 'dj') {
    $('dj-line').textContent = item.say || '';
    $('dj-line').classList.add('speaking');
    if (item.src && djEnabled) {
      // src is already a URL like /audio/tts/<hash>.mp3
      playAudio(item.src);
    }
  }
}

function playAudio(src) {
  audio.src = src;
  if (!started) return; // tap-to-start gate
  audio.play().catch(e => {
    console.warn('audio play failed', e);
    setStatus('autoplay blocked · tap player', 'warn');
  });
}

function setQueue(queue) {
  const list = $('queue-list');
  list.innerHTML = '';
  for (const q of queue) {
    const div = document.createElement('div');
    div.className = 'queue-item' + (q.kind === 'dj' ? ' dj' : '');
    const label = q.kind === 'dj' ? 'DJ' : '♪';
    const text = q.kind === 'dj' ? (q.say || '').slice(0, 60) : `${q.title} — ${q.artist || ''}`;
    div.innerHTML = `<span class="kind">${label}</span><span>${escapeHtml(text)}</span>`;
    list.appendChild(div);
  }
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// --- Lyrics ---
let lyricsCache = {};
async function loadLyrics(songId) {
  if (!songId) return;
  $('lyrics').textContent = '';
  if (lyricsCache[songId] !== undefined) {
    $('lyrics').textContent = lyricsCache[songId] || '（這首沒詞）';
    return;
  }
  try {
    const r = await fetch(`/api/lyrics/${encodeURIComponent(songId)}`);
    const j = await r.json();
    const txt = (j.lyric || '').replace(/^\[.*?\]/gm, '').trim();
    lyricsCache[songId] = txt;
    $('lyrics').textContent = txt || '（這首沒詞）';
  } catch {
    $('lyrics').textContent = '';
  }
}

$('lyrics-toggle').addEventListener('click', () => {
  const el = $('lyrics');
  const t = $('lyrics-toggle');
  el.classList.toggle('show');
  t.textContent = el.classList.contains('show') ? '▴ 收起歌詞' : '▾ 顯示歌詞';
});

// --- Controls ---
$('btn-toggle').addEventListener('click', async () => {
  if (audio.paused) {
    started = true;
    audio.play().catch(() => {});
    await postChat('繼續');
    $('btn-toggle').textContent = '⏸';
  } else {
    audio.pause();
    await postChat('暫停');
    $('btn-toggle').textContent = '▶︎';
  }
});

$('btn-skip').addEventListener('click', async () => {
  await postChat('下一首');
});

$('btn-prev').addEventListener('click', () => {
  audio.currentTime = 0;
  audio.play().catch(() => {});
});

// --- Chat ---
$('chat-send').addEventListener('click', sendChat);
$('chat-input').addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

async function postChat(text) {
  return fetch('/api/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
}

async function sendChat() {
  const text = $('chat-input').value.trim();
  if (!text) return;
  $('chat-input').value = '';
  await postChat(text);
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
let ws = null;
function connectWS() {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${proto}//${location.host}/stream`);
  ws.onopen = () => setStatus('connected', 'ok');
  ws.onclose = () => {
    setStatus('disconnected · retrying', 'warn');
    setTimeout(connectWS, 3000);
  };
  ws.onerror = () => setStatus('connection error', 'err');
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
    case 'dj-saying':
      $('dj-line').textContent = payload.say || '';
      $('dj-line').classList.add('speaking');
      break;
    case 'plan-updated': console.log('plan updated'); break;
    case 'cmd':
      if (payload.action === 'pause') { audio.pause(); $('btn-toggle').textContent = '▶︎'; }
      if (payload.action === 'resume') { audio.play().catch(() => {}); $('btn-toggle').textContent = '⏸'; }
      break;
    case 'hello': setStatus(`live · ${new Date(payload.ts).toLocaleTimeString()}`, 'ok'); break;
  }
}

audio.addEventListener('play', () => { $('btn-toggle').textContent = '⏸'; });
audio.addEventListener('pause', () => { $('btn-toggle').textContent = '▶︎'; });
audio.addEventListener('error', (e) => {
  console.warn('audio error', e, audio.error);
  setStatus('audio error · skipping', 'warn');
  // ask server to advance — likely a CORS or 403 on NCM CDN
  postChat('下一首').catch(() => {});
});

// --- Bootstrap ---
async function bootstrap() {
  try {
    const now = await fetch('/api/now').then(r => r.json());
    if (now.current) setNow(now.current);
    const next = await fetch('/api/next').then(r => r.json());
    setQueue(next.queue || []);
  } catch (e) {
    console.warn('bootstrap failed', e);
    setStatus('bootstrap failed', 'err');
  }
  connectWS();
}

audio.addEventListener('ended', () => {
  // Server-driven advancement; just nudge in case we missed an event.
  fetch('/api/now').then(r => r.json()).then(j => j.current && setNow(j.current));
});

// --- Tap to start (browser autoplay policy unlock) ---
$('tap-overlay').addEventListener('click', async () => {
  started = true;
  $('tap-overlay').classList.add('hidden');
  // Prime audio: play a tiny silent buffer so subsequent .src+.play() works
  // without re-gesture (iOS / Chrome autoplay).
  try {
    audio.muted = false;
    await audio.play().catch(() => {});
  } catch {}
  // If a current item is already loaded, retry play
  if (currentItem?.src) {
    audio.src = currentItem.src;
    audio.play().catch(() => {});
  }
}, { once: true });

bootstrap();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}
