// NCM (NetEase Cloud Music) adapter via binaryify/netease_cloud_music_api.
// Env:
//   NCM_API_URL     default http://localhost:3000
//   NCM_TIMEOUT_MS  default 8000
//   NCM_COOKIE      e.g. "MUSIC_U=xxxxx" (optional, unlocks more songs for logged-in account)
//
// NOTE: response shapes assumed below match the upstream binaryify fork.
// Run `node probe-ncm.js` first; if the field names differ on your fork, adjust the mappers.
const BASE = process.env.NCM_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = Number(process.env.NCM_TIMEOUT_MS || 8000);
const COOKIE = process.env.NCM_COOKIE || '';

function withCookie(path) {
  if (!COOKIE) return path;
  const sep = path.includes('?') ? '&' : '?';
  return path + sep + 'cookie=' + encodeURIComponent(COOKIE);
}

async function fetchJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${withCookie(path)}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`NCM ${path} ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(t);
  }
}

function normalizeSong(s) {
  if (!s) return null;
  return {
    id: String(s.id),
    name: s.name,
    artists: (s.artists || s.ar || []).map(a => a.name).filter(Boolean),
    duration: s.duration ?? s.dt ?? null,
    album: s.album?.name ?? s.al?.name ?? null,
  };
}

export async function search(keywords, limit = 10) {
  const j = await fetchJson(`/search?keywords=${encodeURIComponent(keywords)}&limit=${limit}`);
  const songs = j?.result?.songs || j?.songs || [];
  return songs.map(normalizeSong).filter(Boolean);
}

// Try multiple bitrates: some songs are only available at lower quality.
// 999000 = lossless (VIP), 320000 = HQ, 128000 = standard.
export async function songUrl(id) {
  for (const br of ['', '&br=999000', '&br=320000', '&br=128000']) {
    try {
      const j = await fetchJson(`/song/url?id=${encodeURIComponent(id)}${br}`);
      const item = j?.data?.[0];
      if (item && item.url) {
        return { url: item.url, br: item.br, size: item.size, type: item.type };
      }
    } catch (_) { /* try next */ }
  }
  return null;
}

export async function lyric(id) {
  try {
    const j = await fetchJson(`/lyric?id=${encodeURIComponent(id)}`);
    return j?.lrc?.lyric || null;
  } catch {
    return null;
  }
}

// --- Suno library (primary source) ---
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SUNO_LIB_PATH = path.join(__dirname, '..', '..', 'user', 'suno-library.json');
let _sunoCache = null;
let _sunoMtime = 0;
function loadSuno() {
  try {
    const m = fs.statSync(SUNO_LIB_PATH).mtimeMs;
    if (_sunoCache && m === _sunoMtime) return _sunoCache;
    _sunoCache = JSON.parse(fs.readFileSync(SUNO_LIB_PATH, 'utf8'));
    _sunoMtime = m;
    return _sunoCache;
  } catch { return []; }
}
function sunoToSong(c) {
  return {
    id: 'suno:' + c.id,
    name: c.title || 'Untitled',
    artists: ['Suno'],
    duration: Math.round((c.duration || 0) * 1000),
    album: 'Suno Library',
    src: '/audio/suno/' + c.id + '.mp3',
    br: 192000,
    tags: c.tags || '',
  };
}
function matchSunoByQuery(keywords) {
  const lib = loadSuno();
  if (!lib.length) return null;
  const q = String(keywords || '').toLowerCase().trim();
  if (!q) return sunoToSong(lib[Math.floor(Math.random()*lib.length)]);
  // Tokenise; score each clip on (title hits * 3) + tag hits.
  const tokens = q.split(/[\s,，、；;]+/).filter(t => t.length >= 2);
  let best = null, bestScore = 0;
  const ranked = [];
  for (const c of lib) {
    const text = ((c.title || '') + ' ' + (c.tags || '')).toLowerCase();
    let s = 0;
    for (const t of tokens) {
      if ((c.title || '').toLowerCase().includes(t)) s += 3;
      if ((c.tags  || '').toLowerCase().includes(t)) s += 1;
    }
    if (s > 0) ranked.push([s, c]);
    if (s > bestScore) { best = c; bestScore = s; }
  }
  if (ranked.length) {
    // pick random among top-3 to add variety
    ranked.sort((a,b) => b[0]-a[0]);
    const top = ranked.slice(0, 3);
    return sunoToSong(top[Math.floor(Math.random()*top.length)][1]);
  }
  // No match: still serve a random Suno song so the radio never goes silent.
  return sunoToSong(lib[Math.floor(Math.random()*lib.length)]);
}

// "Best effort" pick: try Suno library first (primary source), fall back to NCM.
export async function findPlayable(keywords) {
  const suno = matchSunoByQuery(keywords);
  if (suno) return suno;
  // NCM fallback (legacy, for when Suno library is empty)
  const candidates = await search(keywords, 5);
  for (const c of candidates) {
    const u = await songUrl(c.id);
    if (u?.url) return { ...c, src: u.url, br: u.br };
  }
  return null;
}
