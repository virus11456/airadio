#!/usr/bin/env node
/**
 * probe-ncm.js
 *
 * 探針：確認本地 NeteaseCloudMusicApi (binaryify/netease_cloud_music_api)
 * 在當前環境的回應結構與是否能拿到可播放直鏈。
 *
 * 前置：
 *   docker run -d -p 3000:3000 --name ncm binaryify/netease_cloud_music_api
 *   docker logs ncm   # 看到 server running 就 OK
 *
 * 跑法：
 *   node probe-ncm.js
 *   NCM_API_URL=http://localhost:3000 node probe-ncm.js "山下達郎"
 *
 * 退出碼：
 *   0  search + song_url 都拿到了
 *   1  /search 失敗或無結果
 *   2  /song/url 失敗或回空 url
 *   3  連線失敗（容器沒起）
 */

const BASE = process.env.NCM_API_URL || 'http://localhost:3000';
const QUERY = process.argv[2] || '竹內まりや 駅';
const TIMEOUT_MS = 15_000;

function log(label, data) {
  console.log(`\n========== ${label} ==========`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

async function fetchJson(path) {
  const url = `${BASE}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    const text = await res.text();
    let json;
    try { json = JSON.parse(text); }
    catch { json = { __raw: text }; }
    return { ok: res.ok, status: res.status, json };
  } finally {
    clearTimeout(t);
  }
}

async function probeRoot() {
  console.log(`[probe-ncm] BASE=${BASE}`);
  try {
    const r = await fetchJson('/');
    console.log(`[probe-ncm] root status=${r.status}`);
  } catch (e) {
    console.error(`[probe-ncm] 連線失敗: ${e.message}`);
    console.error('檢查：docker ps | grep ncm，curl ' + BASE);
    process.exit(3);
  }
}

async function probeSearch() {
  console.log(`\n[probe-ncm] /search keywords="${QUERY}"`);
  const r = await fetchJson(`/search?keywords=${encodeURIComponent(QUERY)}`);
  log('SEARCH STATUS', r.status);
  log('SEARCH JSON (top-level keys)', Object.keys(r.json));

  // 結構嘗試：result.songs[] 或 songs[]
  const songs = r.json?.result?.songs || r.json?.songs;
  if (!Array.isArray(songs) || songs.length === 0) {
    log('SEARCH FAIL', r.json);
    console.error('[probe-ncm] /search 沒有 songs 陣列，可能：未登入 / API 版本不同 / 關鍵字無結果');
    process.exit(1);
  }

  const top = songs.slice(0, 3).map((s) => ({
    id: s.id,
    name: s.name,
    artists: (s.artists || s.ar || []).map((a) => a.name),
    duration: s.duration || s.dt,
  }));
  log('SEARCH TOP3', top);
  return songs[0];
}

async function probeSongUrl(songId) {
  console.log(`\n[probe-ncm] /song/url?id=${songId}`);
  const r = await fetchJson(`/song/url?id=${songId}`);
  log('SONG_URL STATUS', r.status);
  log('SONG_URL JSON', r.json);

  const data = r.json?.data;
  if (!Array.isArray(data) || data.length === 0) {
    console.error('[probe-ncm] /song/url 沒有 data[]');
    process.exit(2);
  }
  const url = data[0].url;
  if (!url) {
    console.error('[probe-ncm] data[0].url 為空。可能：版權保護 / 需要登入。');
    console.error('解法：/login/cellphone 拿 cookie，或挑沒版權保護的歌。');
    process.exit(2);
  }
  console.log(`[probe-ncm] ✅ 拿到直鏈 (br=${data[0].br}, size=${data[0].size}):\n  ${url}`);
  return url;
}

async function probeLyric(songId) {
  console.log(`\n[probe-ncm] /lyric?id=${songId}`);
  try {
    const r = await fetchJson(`/lyric?id=${songId}`);
    log('LYRIC KEYS', Object.keys(r.json));
    const lrc = r.json?.lrc?.lyric;
    if (lrc) console.log(`[probe-ncm] 歌詞前 200 字:\n${lrc.slice(0, 200)}`);
  } catch (e) {
    console.warn(`[probe-ncm] /lyric 失敗（非致命）: ${e.message}`);
  }
}

async function probeRecommend() {
  console.log(`\n[probe-ncm] /recommend/songs（未登入會 401，預期內）`);
  try {
    const r = await fetchJson('/recommend/songs');
    log('RECOMMEND STATUS', r.status);
    if (r.status === 200) {
      const list = r.json?.data?.dailySongs || r.json?.recommend;
      console.log(`[probe-ncm] 拿到推薦 ${Array.isArray(list) ? list.length : '?'} 首`);
    } else {
      console.log('[probe-ncm] 未登入，推薦 API 不可用（之後接 /login/cellphone）');
    }
  } catch (e) {
    console.warn(`[probe-ncm] /recommend 失敗: ${e.message}`);
  }
}

async function run() {
  await probeRoot();
  const top = await probeSearch();
  await probeSongUrl(top.id);
  await probeLyric(top.id);
  await probeRecommend();
  console.log('\n[probe-ncm] DONE');
}

run().catch((e) => {
  console.error('[probe-ncm] uncaught:', e);
  process.exit(3);
});
