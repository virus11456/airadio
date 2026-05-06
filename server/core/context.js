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
  const env = [
    `現在: ${now.toISOString()} (TZ=${process.env.TZ || 'UTC'})`,
    `星期${WEEKDAY_TW[now.getDay()]}`,
    `天氣: ${weather}`,
  ].join('\n');

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

  return { system, user: input };
}
