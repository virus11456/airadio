// 6-piece context assembler. Glues persona + corpus + env + memory + input + trace
// into the system/user prompts handed to claude.js.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { state } from './state.js';
import { getWeather } from './weather.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../../');

function readSafe(rel) {
  try { return fs.readFileSync(path.join(ROOT, rel), 'utf8'); }
  catch { return ''; }
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

// A fresh random menu of REAL library tracks each refill. Without this the
// LLM narrated real-world artists (韋禮安 / 9m88 / 孫燕姿) it cannot actually
// play — fuzzy matching then silently substituted random Suno tracks, so the
// on-air talk never matched what listeners heard.
function pickLibraryMenu(n = 40) {
  try {
    const lib = JSON.parse(readSafe('user/suno-library.json') || '[]');
    if (!Array.isArray(lib) || !lib.length) return '';
    const recent = new Set(
      (state.recentPlays(20) || []).map(p => String(p.song_id || '').replace(/^suno:/, ''))
    );
    const pool = lib.filter(t => !recent.has(t.id));
    const src = pool.length >= 10 ? pool : lib;
    const picks = [];
    const used = new Set();
    while (picks.length < Math.min(n, src.length)) {
      const i = Math.floor(Math.random() * src.length);
      if (used.has(i)) continue;
      used.add(i);
      const t = src[i];
      const tags = String(t.tags || '').split(',').map(x => x.trim()).filter(Boolean).slice(0, 3).join(', ');
      picks.push(`- ${t.title}${tags ? `（${tags}）` : ''}`);
    }
    return picks.join('\n');
  } catch { return ''; }
}

const WEEKDAY_TW = ['日', '一', '二', '三', '四', '五', '六'];

export async function buildContext(userInput, opts = {}) {
  // ① persona
  const persona = readSafe('prompts/dj-persona.md');

  // ② user corpus
  const taste = readSafe('user/taste.md');
  const routines = readSafe('user/routines.md');
  const moodRules = readSafe('user/mood-rules.md');
  const playlists = readSafe('user/playlists.json');

  // ③ environment
  const now = new Date();
  const weather = await getWeather();
  const tzNow = new Date(now.toLocaleString('en-US', { timeZone: process.env.TZ || 'Asia/Taipei' }));
  const hour = tzNow.getHours();
  const phase = hour < 5 ? '凌晨' : hour < 9 ? '早晨' : hour < 12 ? '上午' : hour < 14 ? '中午' : hour < 18 ? '下午' : hour < 22 ? '晚間' : '深夜';
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;
  let vibe = '';
  if (hour >= 7 && hour < 9)        vibe = '通勤時段';
  else if (hour >= 12 && hour < 13) vibe = '午餐尖峰';
  else if (hour >= 17 && hour < 19) vibe = '下班尖峰';
  else if (hour >= 22 || hour < 2)  vibe = '夜生活時段';
  else if (isWeekend && hour >= 10 && hour < 16) vibe = '週末悝閑';
  const FESTIVALS = [
    { d: '01-01', name: '元旦' },{ d: '02-14', name: '西洋情人節' },
    { d: '02-28', name: '228' },{ d: '04-04', name: '兒童節' },
    { d: '04-05', name: '清明' },{ d: '05-01', name: '勞動節' },
    { d: '06-22', name: '端午' },{ d: '07-07', name: '七夕' },
    { d: '08-08', name: '父親節' },{ d: '09-29', name: '教師節' },
    { d: '10-10', name: '國慶' },{ d: '10-31', name: '萬聖節' },
    { d: '11-27', name: '感恩節' },{ d: '12-25', name: '聖誕節' },
    { d: '12-31', name: '跨年' },
  ];
  const mmdd = (d) => `${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  let festival = '';
  for (let off = 0; off <= 7; off++) {
    const d = new Date(now); d.setDate(d.getDate() + off);
    const f = FESTIVALS.find(x => x.d === mmdd(d));
    if (f) { festival = off === 0 ? `今天是${f.name}` : off === 1 ? `明天是${f.name}` : `${off}天後是${f.name}`; break; }
  }
  // Currently playing track
  let nowPlaying = '';
  try {
    const cur = (state.getCurrent && state.getCurrent()) || (state.now && state.now()) || null;
    if (cur && cur.kind === 'music' && cur.title) {
      nowPlaying = `現在正在播：《${cur.title}》· ${cur.artist || ''}`;
    }
  } catch (_) {}

  const env = [
    `現在: ${now.toISOString()} (TZ=${process.env.TZ || 'Asia/Taipei'})`,
    `星期${WEEKDAY_TW[now.getDay()]}·${phase}${isWeekend ? '·週末' : '·平日'}`,
    `天氣: ${weather}`,
    vibe ? `氛圍: ${vibe}` : '',
    festival ? `節日: ${festival}` : '',
    nowPlaying,
  ].filter(Boolean).join('\n');

  // ④ retrieved memory
  const recentPlays = state.recentPlays(opts.recentPlays ?? 10);
  const memory = recentPlays.length
    ? recentPlays.map(p => `- ${p.title ?? '?'} / ${p.artist ?? '?'}`).join('\n')
    : '(尚無播放紀錄)';

  // DJ recent dedup pool — was previously referenced but undefined.
  const recentDjSays = (state.recentMessages(30) || [])
    .filter(m => m && m.role === 'dj')
    .slice(0, 5)
    .map(m => (m.content || '').trim())
    .filter(Boolean);

  // Listener feedback — surfaces likes / dislikes so the DJ biases selection.
  let likedSummary = '（尚無）';
  let dislikedSummary = '（尚無）';
  try {
    const likes    = state.topLiked(8)    || [];
    const dislikes = state.topDisliked(8) || [];
    if (likes.length)    likedSummary    = likes.map(r => `- ${r.title || r.track_id}${r.artist ? ' / ' + r.artist : ''} (×${r.n})`).join('\n');
    if (dislikes.length) dislikedSummary = dislikes.map(r => `- ${r.title || r.track_id}${r.artist ? ' / ' + r.artist : ''} (×${r.n})`).join('\n');
  } catch (_) {}

  // Fan letters — pending listener messages the DJ should consider replying to.
  let fanLettersBlock = '（沒有人來信）';
  let pendingFanIds = [];
  try {
    state.expireOldFanMessages?.(30 * 60 * 1000); // age out > 30min so DJ doesnt reply to stale things
    const letters = state.unaddressedFanMessages?.(5) || [];
    if (letters.length) {
      pendingFanIds = letters.map(l => l.id);
      fanLettersBlock = letters.map(l => {
        const sender = (l.sender || 'anon').slice(0, 8);
        const ago = Math.round((Date.now() - l.ts) / 1000);
        return `[#${l.id}] (${sender}, ${ago}秒前) ${(l.content || '').slice(0, 200)}`;
      }).join('\n');
    }
  } catch (_) {}

  // ⑤ user input / tool result
  const input = userInput
    ? `用戶輸入: ${userInput}`
    : '系統觸發: 排下一段歌單';

  // ⑥ execution trace
  const today = fmtDate(now);
  const planRow = state.getPlan(today);
  const trace = planRow?.plan ? `今日節目單: ${planRow.plan}` : '今日尚無節目單';

  const system = [
    persona,
    '## 用戶品味', taste,
    '## 作息', routines,
    '## 心情規則', moodRules,
    '## 收藏種子', playlists,
    '## 環境', env,
    '## 記憶（最近播放）', memory,
    '## 聽眾按讚（請優先排這類風格 / 同首歌可以多播）', likedSummary,
    '## 聽眾倒讚（請避開以下歌曲 / 同類風格降低權重）', dislikedSummary,
    '## 聽眾來信（待你在 say 裡親自回應；引用時請在 JSON 加 replied_to:[#id,#id]）',
    fanLettersBlock,
    '> 收信原則：\n> 1) 每段最多挑 1-2 封來信回覆，挑最有趣 / 最有戲的。\n> 2) 回覆時口語：「剛收到 #42 號聽眾來信說...」，不要照抄整段。\n> 3) 回覆完務必把那幾封的 id 放進 replied_to。\n> 4) 沒人來信就不要硬扯，回到正常排歌。',
    '## DJ 最近講過（重要：請勿重複以下任一句的內容或開頭）', recentDjSays.map(s => '- ' + s).join('\n') || '（還沒講過）',
    '## 軌跡', trace,
  ].filter(Boolean).join('\n\n');

    // Hard-coded prefix in user message so M2 cannot ignore time/weather.
  const tzNowStr = now.toLocaleString('zh-TW', { timeZone: process.env.TZ || 'Asia/Taipei', hour12: false });
  // Library menu goes in the USER message for the same reason as letters:
  // the M2 family routinely ignores the system prompt.
  const libraryMenu = pickLibraryMenu(40);
  const menuCtx = libraryMenu
    ? `\n[本段可選曲庫菜單]\n${libraryMenu}\n鐵律：play 裡的 query 必須逐字使用上面清單中的歌名；say 提到的歌名也只能來自清單。本台全部是自製曲庫，嚴禁宣稱正在播放任何真實歌手（例如韋禮安、孫燕姿、9m88、山下達郎）的歌；只能用「有○○的味道」這種比喻方式提到他們。\n`
    : '';

  // Fan letters ALSO go in the user message: M2-family models routinely
  // ignore the system prompt, and a letter buried there never gets replied.
  const lettersCtx = pendingFanIds.length
    ? `\n[聽眾來信，等你回覆]\n${fanLettersBlock}\n請務必在 say 裡口語回覆其中 1-2 封（例：「剛收到 #${pendingFanIds[0]} 號聽眾來信說⋯」，轉述不要照抄），並在 JSON 裡加 "replied_to":[${pendingFanIds[0]}] 這樣的欄位。\n`
    : '';
  const hardCtx = `[現在實際狀態]
時間：${tzNowStr} (${phase}, 星期${WEEKDAY_TW[now.getDay()]})
天氣：${weather}
${vibe ? '氛圍：' + vibe + '\n' : ''}${festival ? '節日：' + festival + '\n' : ''}${nowPlaying ? nowPlaying + '\n' : ''}${menuCtx}${lettersCtx}
[你的任務]
${input}

記住：say 必須明確提到上面的時間與天氣，不要使用「凌晨」「深夜」這類不符合現在時段的詞。`;
  return { system, user: hardCtx, pendingFanIds };
}
