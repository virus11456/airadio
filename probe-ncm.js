// probe-ncm.js
// 目的：確認 NeteaseCloudMusicApi 起來了，且關鍵 endpoint 都通
// 用法：先 docker run，再 node probe-ncm.js

const BASE = process.env.NCM_API_URL || 'http://localhost:3000';

console.log('=== probe-ncm.js ===');
console.log('BASE:', BASE);
console.log('---');

async function hit(label, path) {
  const url = `${BASE}${path}`;
  console.log(`\n▶ [${label}] GET ${url}`);
  try {
    const t0 = Date.now();
    const res = await fetch(url);
    const ms = Date.now() - t0;
    const text = await res.text();
    console.log(`  status: ${res.status} (${ms}ms)`);
    let data;
    try { data = JSON.parse(text); } catch { data = null; }
    if (!data) {
      console.log('  ❌ 不是 JSON，前 300 字:', text.slice(0, 300));
      return null;
    }
    // 只印關鍵欄位，避免噴一大坨
    const summary = JSON.stringify(data).slice(0, 500);
    console.log('  body 前 500 字:', summary);
    return data;
  } catch (e) {
    console.log(`  ❌ fetch 失敗:`, e.message);
    console.log('  → 確認容器有起來：docker ps | grep ncm');
    return null;
  }
}

async function main() {
  // 1. 健康檢查（根路徑通常會回個歡迎頁或 404，能連上就行）
  await hit('health', '/');

  // 2. 搜歌
  const search = await hit('search', '/search?keywords=' + encodeURIComponent('竹內まりや'));
  let songId = null;
  try {
    songId = search?.result?.songs?.[0]?.id;
    console.log('  → 抓到 songId:', songId);
  } catch {}

  if (!songId) {
    console.log('\n❌ 搜歌沒拿到 id，後續測試跳過');
    console.log('→ 可能要先登入 cookie，或這個 API fork 路徑不一樣');
    console.log('→ 試試其他 fork：https://gitlab.com/Binaryify/NeteaseCloudMusicApi');
    return;
  }

  // 3. 取直鏈
  const url = await hit('song_url', `/song/url?id=${songId}`);
  const playUrl = url?.data?.[0]?.url;
  console.log('  → 直鏈:', playUrl ? playUrl.slice(0, 80) + '...' : '(空，可能要 VIP/登入)');

  // 4. 歌詞
  await hit('lyric', `/lyric?id=${songId}`);

  // 5. 推薦（需要登入，可能 401）
  await hit('recommend', '/recommend/songs');

  console.log('\n---');
  console.log('=== 結論判斷 ===');
  if (playUrl) {
    console.log('✅ NCM 可以搜歌 + 取直鏈，可以開工');
  } else {
    console.log('⚠️ 搜歌通了但拿不到直鏈，多半是版權/登入問題');
    console.log('   → 方案 A: 用 cookie 登入 (POST /login/cellphone)');
    console.log('   → 方案 B: 改用其他源（YouTube Music API、QQ 音樂 API）');
  }
}

main();
