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
    '## 軌跡', trace,
  ].filter(Boolean).join('\n\n');

    // Hard-coded prefix in user message so M2 cannot ignore time/weather.
  const tzNowStr = now.toLocaleString('zh-TW', { timeZone: process.env.TZ || 'Asia/Taipei', hour12: false });
  const hardCtx = `[現在實際狀態]
時間：${tzNowStr} (${phase}, 星期${WEEKDAY_TW[now.getDay()]})
天氣：${weather}
${vibe ? '氛圍：' + vibe + '\n' : ''}${festival ? '節日：' + festival + '\n' : ''}${nowPlaying ? nowPlaying + '\n' : ''}
[你的任務]
${input}

記住：say 必須明確提到上面的時間與天氣，不要使用「凌晨」「深夜」這類不符合現在時段的詞。`;
  return { system, user: hardCtx };
}
