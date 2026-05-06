// NeteaseCloudMusicApi adapter. Wraps the endpoints we actually use.
//
// NOTE: response shapes assumed below match the upstream binaryify fork.
// Run `node probe-ncm.js` first; if the field names differ on your fork,
// adjust the mappers in `normalize*` funcs.
const BASE = process.env.NCM_API_URL || 'http://localhost:3000';
const TIMEOUT_MS = Number(process.env.NCM_TIMEOUT_MS || 8000);

async function fetchJson(path) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${BASE}${path}`, { signal: ctrl.signal });
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

export async function songUrl(id) {
  const j = await fetchJson(`/song/url?id=${encodeURIComponent(id)}`);
  const item = j?.data?.[0];
  if (!item || !item.url) return null;
  return {
    url: item.url,
    br: item.br,
    size: item.size,
    type: item.type,
  };
}

export async function lyric(id) {
  try {
    const j = await fetchJson(`/lyric?id=${encodeURIComponent(id)}`);
    return j?.lrc?.lyric || null;
  } catch {
    return null;
  }
}

// "Best effort" pick: search top N, return the first one with a playable url.
export async function findPlayable(keywords) {
  const candidates = await search(keywords, 5);
  for (const c of candidates) {
    const u = await songUrl(c.id);
    if (u?.url) return { ...c, src: u.url, br: u.br };
  }
  return null;
}
