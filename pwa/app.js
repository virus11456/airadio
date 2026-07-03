// Single-page PWA controller. One <audio> element. WS for live events.
// Two views toggled by nav buttons. Like / Dislike feedback persists per
// device via a localStorage clientId; AI cover image fades in when present.

const $ = (id) => document.getElementById(id);
const audio = $('audio');
const status = $('status');

// ---------- Anonymous client id (persists per device) ----------
const CLIENT_ID = (() => {
  const key = 'airadio.clientId';
  let id = null;
  try { id = localStorage.getItem(key); } catch (_) {}
  if (!id) {
    id = 'c-' + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);
    try { localStorage.setItem(key, id); } catch (_) {}
  }
  return id;
})();

// Stable identity for whatever audio is currently loaded into the <audio>
// element. The server's per-item duration estimate is best-effort, so the
// audio.ended → /api/now refetch path can hand us the SAME item we just
// finished. Without this guard, setting audio.src to the same URL replays
// it (Safari/iOS in particular). Always skip re-issuing playback when the
// incoming item maps to the same key.
let lastPlayedKey = null;
function itemKey(item) {
  if (!item) return null;
  if (item.kind === 'music') return 'm:' + (item.songId || item.src || item.title || '');
  if (item.kind === 'dj')    return 'd:' + (item.src || (item.say || '').slice(0, 60));
  return 'x:' + JSON.stringify(item).slice(0, 80);
}

// ---------- View switching ----------
document.querySelectorAll('nav button').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    btn.classList.add('active');
    const view = $(`view-${btn.dataset.view}`);
    if (view) view.classList.add('active');
  });
});

// ---------- Audio ----------
let djEnabled = true;
let currentItem = null;

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

// ---------- GBC console ----------
const coverEl = $('cover');       // the LCD screen inside the bezel
const gbcEl = $('gbc');           // the whole console shell
const djBox = $('dj-box');        // RPG dialogue box on screen
const aiCoverEl = $('ai-cover');  // per-track AI cover img on screen

// Per-track AI cover on the screen. Falls back to the sky + equalizer
// backdrop when a track has no cover.
let _lastMusicCover = null;
function setCover(url) {
  if (url) _lastMusicCover = url;
  if (!aiCoverEl) return;
  if (url) {
    if (aiCoverEl.getAttribute('src') !== url) {
      aiCoverEl.classList.remove('show');
      aiCoverEl.src = url;
    } else {
      aiCoverEl.classList.add('show');
    }
  } else {
    aiCoverEl.classList.remove('show');
    aiCoverEl.removeAttribute('src');
  }
}
if (aiCoverEl) {
  aiCoverEl.addEventListener('load',  () => aiCoverEl.classList.add('show'));
  aiCoverEl.addEventListener('error', () => { aiCoverEl.classList.remove('show'); aiCoverEl.removeAttribute('src'); });
}

// Console state: DJ talking → ON AIR LED pulses + dialogue box on screen.
function setStage(item) {
  const isDj = !!(item && item.kind === 'dj');
  if (gbcEl) gbcEl.classList.toggle('on-air', isDj);
  if (djBox) {
    if (isDj && item.say && String(item.say).trim()) {
      djBox.textContent = String(item.say);
      djBox.hidden = false;
    } else {
      djBox.hidden = true;
    }
  }
}

// Equalizer dances only while something is audibly playing.
function syncScreenPlaying() {
  const audible = !audio.paused && !audio.muted;
  if (coverEl) coverEl.classList.toggle('playing', audible);
  if (gbcEl) gbcEl.classList.toggle('playing', audible);
}
audio.addEventListener('play',  syncScreenPlaying);
audio.addEventListener('pause', syncScreenPlaying);
audio.addEventListener('volumechange', syncScreenPlaying);

// Day/night screen backdrop. 5–19 → Nagai day sky, 19–5 → night city sky.
function refreshScreenTime() {
  if (!coverEl) return;
  const h = new Date().getHours();
  const mode = (h >= 5 && h < 19) ? 'day' : 'night';
  if (coverEl.dataset.time !== mode) coverEl.dataset.time = mode;
}
refreshScreenTime();
setInterval(refreshScreenTime, 5 * 60 * 1000);

// ---------- Now playing ----------
function setNow(item) {
  currentItem = item;
  if (!item) return;

  setStage(item);

  if (item.kind === 'music') {
    $('now-title').textContent = item.title || '—';
    $('now-artist').textContent = item.artist || '';
    setCover(item.cover || null);
    showFeedback(item);
    if ('mediaSession' in navigator) {
      try {
        const artwork = item.cover
          ? [{ src: item.cover, sizes: '768x768', type: 'image/jpeg' },
             { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }]
          : [{ src: '/icon-512.png', sizes: '512x512', type: 'image/png' }];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: item.title || '',
          artist: item.artist || '',
          album: 'AIRADIO.FM',
          artwork,
        });
        navigator.mediaSession.setActionHandler('play',  () => audio.play().catch(()=>{}));
        navigator.mediaSession.setActionHandler('pause', () => audio.pause());
        navigator.mediaSession.setActionHandler('stop',  () => audio.pause());
        navigator.mediaSession.playbackState = audio.paused ? 'paused' : 'playing';
      } catch (_) {}
    }
    if (item.src) {
      const k = itemKey(item);
      if (k !== lastPlayedKey) {
        // Compute live-offset so a fresh tune-in joins the song mid-play, like
        // a real radio. startedAt + serverNow come from the server snapshot.
        let seekSeconds = 0;
        if (item.startedAt && item.serverNow) {
          const drift = Date.now() - item.serverNow;             // local vs server clock
          const elapsedMs = (Date.now() - item.startedAt) - drift;
          const durMs = item.duration || 0;
          if (elapsedMs > 1500 && (!durMs || elapsedMs < durMs - 2000)) {
            seekSeconds = elapsedMs / 1000;
          }
        }
        audio.src = item.src;
        const seekOnce = () => {
          try {
            if (seekSeconds > 0 && isFinite(audio.duration) && audio.duration > seekSeconds + 1) {
              audio.currentTime = seekSeconds;
            }
          } catch (_) {}
          audio.removeEventListener('loadedmetadata', seekOnce);
        };
        if (seekSeconds > 0) audio.addEventListener('loadedmetadata', seekOnce);
        tryPlay();
        lastPlayedKey = k;
      }
    }
  } else if (item.kind === 'dj') {
    if (item.say && item.say.trim()) $('dj-line').textContent = item.say;
    if (item.src && djEnabled) {
      const k = itemKey(item);
      if (k !== lastPlayedKey) {
        audio.src = item.src.startsWith('/') ? item.src : `/audio/tts/${item.src.split('/').pop()}`;
        tryPlay();
        lastPlayedKey = k;
      }
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

// ---------- Feedback (like / dislike) ----------
const fbWrap = $('feedback');
const btnLike = $('btn-like');
const btnDislike = $('btn-dislike');
const likeCountEl = $('like-count');
const dislikeCountEl = $('dislike-count');
let fbState = { trackId: null, mine: null, likes: 0, dislikes: 0 };

function renderFeedback() {
  if (!fbWrap) return;
  if (likeCountEl)    likeCountEl.textContent = fbState.likes ?? 0;
  if (dislikeCountEl) dislikeCountEl.textContent = fbState.dislikes ?? 0;
  if (btnLike)    btnLike.classList.toggle('is-active', fbState.mine === 'like');
  if (btnDislike) btnDislike.classList.toggle('is-active', fbState.mine === 'dislike');
}

async function showFeedback(item) {
  if (!fbWrap || !item || !item.songId) {
    if (fbWrap) fbWrap.classList.add('inactive');
    return;
  }
  fbWrap.classList.remove('inactive');
  fbState = { trackId: item.songId, mine: null, likes: 0, dislikes: 0 };
  renderFeedback();
  try {
    const r = await fetch(`/api/feedback/${encodeURIComponent(item.songId)}`, {
      headers: { 'X-Client-Id': CLIENT_ID },
    });
    if (!r.ok) return;
    const j = await r.json();
    fbState = { trackId: item.songId, mine: j.mine || null, likes: j.likes || 0, dislikes: j.dislikes || 0 };
    renderFeedback();
  } catch (_) { /* non-fatal */ }
}

async function sendFeedback(kind) {
  if (!currentItem || currentItem.kind !== 'music' || !currentItem.songId) return;
  const trackId = currentItem.songId;
  const target = kind === 'like' ? btnLike : btnDislike;
  const existed = fbState.mine === kind;
  if (target) target.classList.add('pulse');
  setTimeout(() => target && target.classList.remove('pulse'), 380);
  try {
    if (existed) {
      // Toggle off
      const r = await fetch(`/api/feedback/${encodeURIComponent(trackId)}`, {
        method: 'DELETE',
        headers: { 'X-Client-Id': CLIENT_ID },
      });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      fbState = { trackId, mine: null, likes: j.likes || 0, dislikes: j.dislikes || 0 };
    } else {
      const r = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
        body: JSON.stringify({
          trackId,
          kind,
          title: currentItem.title || '',
          artist: currentItem.artist || '',
        }),
      });
      if (!r.ok) throw new Error('http ' + r.status);
      const j = await r.json();
      fbState = { trackId, mine: kind, likes: j.likes || 0, dislikes: j.dislikes || 0 };
    }
    renderFeedback();
    showToast(existed ? '已取消' : (kind === 'like' ? '✓ 已按讚' : '✓ 已倒讚 · DJ 之後會避開'));
  } catch (e) {
    console.warn('feedback failed', e);
    showToast('Feedback failed: ' + e.message);
  }
}

if (btnLike)    btnLike.addEventListener('click', () => sendFeedback('like'));
if (btnDislike) btnDislike.addEventListener('click', () => sendFeedback('dislike'));

function showToast(text) {
  let t = $('chat-toast');
  if (!t) return;
  t.textContent = text;
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2000);
}

// ---------- Mute toggle ----------
$('btn-toggle').addEventListener('click', () => {
  audio.muted = !audio.muted;
  $('btn-toggle').textContent = audio.muted ? 'START·✕' : 'START·♪';
  syncScreenPlaying();
});

// ---------- GBC hardware: D-pad volume, SELECT -> mailbox ----------
$('dpad-left')?.addEventListener('click', () => {
  audio.volume = Math.max(0, Math.round((audio.volume - 0.1) * 10) / 10);
  showToast('VOL ◀ ' + Math.round(audio.volume * 10) + '/10');
});
$('dpad-right')?.addEventListener('click', () => {
  audio.volume = Math.min(1, Math.round((audio.volume + 0.1) * 10) / 10);
  showToast('VOL ▶ ' + Math.round(audio.volume * 10) + '/10');
});
$('btn-mail')?.addEventListener('click', () => {
  const inp = $('chat-input');
  if (!inp) return;
  inp.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => inp.focus(), 350);
});

// ---------- Chat ----------
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
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
      body: JSON.stringify({ text }),
    });
    if (!r.ok) throw new Error('http ' + r.status);
    inp.value = '';
    showToast('✓ 信寄出 · 老 C 收到了，下段廣播可能會回'); refreshMail();
  } catch (e) {
    alert('送信失敗: ' + e.message);
  } finally {
    inp.classList.remove('sending');
  }
}

// ---------- Settings ----------
$('set-volume').addEventListener('input', e => { audio.volume = e.target.value / 100; });
audio.volume = 0.8;

$('set-dj').addEventListener('change', e => { djEnabled = e.target.checked; });

// ---------- WebSocket ----------
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
      if (payload.action === 'pause')  { audio.pause(); }
      if (payload.action === 'resume') { tryPlay(); }
      break;
    case 'hello': status.textContent = `connected · ${new Date(payload.ts).toLocaleTimeString()}`; break;
    case 'reaction': spawnHeart(payload); break;
    case 'user-message': refreshMail(); break;
  }
}

// ============ Heart Rain ============
const hearts = document.getElementById('hearts');
const hctx = hearts ? hearts.getContext('2d') : null;
const reactionBar = document.getElementById('reaction-bar');
let particles = [];
let lastFrame = 0;
let myReactionCooldown = 0;

function resizeHearts() {
  if (!hearts) return;
  const r = coverEl.getBoundingClientRect();
  hearts.width = Math.max(1, Math.round(r.width));
  hearts.height = Math.max(1, Math.round(r.height));
}
window.addEventListener('resize', resizeHearts);
setTimeout(resizeHearts, 50);

function spawnHeart(payload) {
  if (!hctx || !hearts || !payload) return;
  resizeHearts();
  const w = hearts.width, h = hearts.height;
  const x = (typeof payload.x === 'number') ? payload.x * w : Math.random() * w;
  const y = (typeof payload.y === 'number') ? payload.y * h : (h * 0.7 + Math.random() * h * 0.2);
  particles.push({
    emoji: payload.emoji || '💖',
    x, y,
    vx: (Math.random() - 0.5) * 0.6,
    vy: -1.4 - Math.random() * 1.0,
    life: 0,
    maxLife: 2200 + Math.random() * 700,
    size: 22 + Math.random() * 10,
  });
  if (particles.length > 80) particles.splice(0, particles.length - 80);
  if (!lastFrame) lastFrame = performance.now(), requestAnimationFrame(stepHearts);
}

function stepHearts(now) {
  if (!hctx) return;
  const dt = Math.min(48, now - (lastFrame || now));
  lastFrame = now;
  hctx.clearRect(0, 0, hearts.width, hearts.height);
  for (const p of particles) {
    p.life += dt;
    p.x += p.vx * dt * 0.06;
    p.y += p.vy * dt * 0.06;
    p.vy *= 0.995;
    const t = p.life / p.maxLife;
    const alpha = t < 0.1 ? t * 10 : Math.max(0, 1 - (t - 0.1) / 0.9);
    hctx.globalAlpha = alpha;
    hctx.font = `${p.size}px serif`;
    hctx.textAlign = 'center';
    hctx.fillText(p.emoji, p.x, p.y);
  }
  hctx.globalAlpha = 1;
  particles = particles.filter(p => p.life < p.maxLife);
  if (particles.length) requestAnimationFrame(stepHearts);
  else lastFrame = 0;
}

async function sendReaction(emoji, x, y) {
  const now = Date.now();
  if (now - myReactionCooldown < 250) return; // simple anti-spam
  myReactionCooldown = now;
  spawnHeart({ emoji, x, y });
  try {
    await fetch('/api/reaction', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Client-Id': CLIENT_ID },
      body: JSON.stringify({ emoji, x, y }),
    });
  } catch (_) {}
}

// Tap on cover -> show emoji bar (mobile-friendly). Click on bar emoji -> spawn.
if (coverEl) {
  let barTimer = null;
  coverEl.addEventListener('click', (ev) => {
    if (ev.target.closest('.reaction-bar')) return; // bar click handled below
    const r = coverEl.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const y = (ev.clientY - r.top) / r.height;
    sendReaction('💖', x, y);
    coverEl.classList.add('show-bar');
    clearTimeout(barTimer);
    barTimer = setTimeout(() => coverEl.classList.remove('show-bar'), 2400);
  });
}
if (reactionBar) {
  reactionBar.addEventListener('click', (ev) => {
    const btn = ev.target.closest('button[data-emoji]');
    if (!btn) return;
    const emoji = btn.dataset.emoji;
    sendReaction(emoji, 0.4 + Math.random() * 0.2, 0.55 + Math.random() * 0.25);
  });
}

// ============ Listener Mail List ============
const mailListBody = document.getElementById('mail-list-body');
let mailRefreshTimer = null;

async function refreshMail() {
  if (!mailListBody) return;
  try {
    const r = await fetch('/api/mail/recent?limit=6');
    if (!r.ok) return;
    const j = await r.json();
    renderMail(j.letters || []);
  } catch (_) {}
}
function renderMail(letters) {
  if (!mailListBody) return;
  if (!letters.length) {
    mailListBody.innerHTML = '<div class="empty">還沒有來信。第一封就由你寫。</div>';
    return;
  }
  mailListBody.innerHTML = '';
  for (const l of letters) {
    const div = document.createElement('div');
    div.className = 'letter ' + (l.addressed ? 'is-replied' : 'is-pending');
    const who = (l.sender || 'anon').slice(0, 6);
    const ago = humanAgo(Date.now() - l.ts);
    div.innerHTML =
      `<span class="who">#${l.id} · ${escapeHtml(who)}</span>` +
      `<span class="body">${escapeHtml(l.content || '')} <span style="opacity:0.4;font-size:10px">${ago}</span></span>`;
    mailListBody.appendChild(div);
  }
}
function humanAgo(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60)   return s + ' 秒前';
  if (s < 3600) return Math.round(s / 60) + ' 分前';
  return Math.round(s / 3600) + ' 小時前';
}

// Pull mail every 25s and right after sending one (`refreshMail` is also
// called from the WS user-message handler).
function startMailPolling() {
  if (mailRefreshTimer) return;
  refreshMail();
  mailRefreshTimer = setInterval(refreshMail, 25000);
}
startMailPolling();

// ---------- Bootstrap ----------
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

// 30-second poll: in case the WS now-playing event was missed (background
// tab, network blip, server restart) we refetch /api/now and let setNow's
// guards either advance to a new track or no-op on the same one. Also kicks
// playback if the audio is paused but server says music is current.
setInterval(async () => {
  try {
    const j = await fetch('/api/now').then(r => r.json());
    const c = j.current;
    if (c) {
      setNow(c);
      // If server has music + we have a src + audio is paused but not muted,
      // try to resume.
      if (c.kind === 'music' && audio.src && audio.paused && !audio.muted) {
        tryPlay();
      }
    }
  } catch (_) { /* ignore */ }
}, 30 * 1000);

audio.addEventListener('ended', () => {
  // The just-finished item's key is still in lastPlayedKey. If the server
  // hasn't transitioned yet, /api/now will hand us the same item — setNow's
  // guard then no-ops, leaving the audio silent (correct) until the server
  // moves on and the WS now-playing event arrives with the next item.
  fetch('/api/now').then(r => r.json()).then(j => j.current && setNow(j.current));
});

bootstrap();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js').catch(() => {});
}


// ============ PWA install hint ============
// Mobile users only. Tells them why they should add the site to home
// screen — Safari pauses audio in tabs when the screen locks, but PWA
// standalone mode keeps it playing.
(function setupInstallHint() {
  const hint = document.getElementById('install-hint');
  if (!hint) return;
  const txt = document.getElementById('install-hint-text');
  const closeBtn = document.getElementById('install-hint-close');
  const installBtn = document.getElementById('install-hint-install');
  if (!hint || !txt || !closeBtn || !installBtn) return;

  const STORAGE_KEY = 'airadio.install-dismissed';
  let dismissedAt = 0;
  try { dismissedAt = Number(localStorage.getItem(STORAGE_KEY) || 0); } catch (_) {}
  const oneWeek = 7 * 24 * 60 * 60 * 1000;
  if (dismissedAt && Date.now() - dismissedAt < oneWeek) return;

  const isStandalone = () =>
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true;
  if (isStandalone()) return;

  // Detect platform for the right wording
  const ua = navigator.userAgent || '';
  const isIOS = /iPad|iPhone|iPod/.test(ua) && !window.MSStream;
  const isAndroid = /Android/.test(ua);
  const isMobile = isIOS || isAndroid || window.matchMedia('(max-width: 760px)').matches;
  if (!isMobile) return;

  let deferredPrompt = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    installBtn.hidden = false;
    txt.innerHTML = '熄屏想繼續聽？把 <b>AIRADIO</b> 安裝起來';
  });

  if (isIOS) {
    txt.innerHTML = '熄屏想繼續聽？點 <b>分享</b> → <b>加到主畫面</b>';
  }

  hint.hidden = false;
  setTimeout(() => hint.classList.add('show'), 300);

  closeBtn.addEventListener('click', () => {
    hint.classList.remove('show');
    setTimeout(() => { hint.hidden = true; }, 360);
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
  });

  installBtn.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    await deferredPrompt.userChoice;
    deferredPrompt = null;
    hint.classList.remove('show');
    setTimeout(() => { hint.hidden = true; }, 360);
    try { localStorage.setItem(STORAGE_KEY, String(Date.now())); } catch (_) {}
  });

  // Auto-hide after 25s if user ignores
  setTimeout(() => {
    if (hint.classList.contains('show')) {
      hint.classList.remove('show');
      setTimeout(() => { hint.hidden = true; }, 360);
    }
  }, 25000);
})();
