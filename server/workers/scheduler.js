// Cron scheduler. Triggers planned moments — daily plan generation,
// morning greeting, hourly mood check, bedtime mode, hourly time chime.
import cron from 'node-cron';
import { buildContext } from '../core/context.js';
import { callClaude, validateContract, localFallback } from '../core/claude.js';
import { state } from '../core/state.js';
import { publish, events } from '../core/bus.js';
import { getWeather } from '../core/weather.js';
import * as dj from './dj.js';

function today() { return new Date().toISOString().slice(0, 10); }

// ---------- 整點報時 ----------
// Fixed template + weather — deliberately NOT the LLM, so the chime lands
// on the hour even when the brain is down. TTS md5-cache means each unique
// line is synthesized once.
async function hourlyChime() {
  const tz = process.env.TZ || 'Asia/Taipei';
  const now = new Date(new Date().toLocaleString('en-US', { timeZone: tz }));
  const h = now.getHours();
  const phase = h < 5 ? '凌晨' : h < 9 ? '早上' : h < 12 ? '上午'
              : h < 14 ? '中午' : h < 18 ? '下午' : h < 23 ? '晚上' : '深夜';
  const h12 = (h % 12) === 0 ? 12 : h % 12;

  let say = `現在時間，${phase}${h12}點整。`;
  try {
    const w = await getWeather();
    if (w && !w.includes('未知')) say += `${w}。`;
  } catch (_) {}
  if (h >= 0 && h < 5)       say += '還醒著的你，這裡繼續有音樂。';
  else if (h >= 7 && h < 9)  say += '新的一天，先來一首。';
  else if (h === 23)         say += '差不多該收心了，接下來放慢一點。';

  console.log('[scheduler] hourly chime:', say);
  try { await dj.queueAnnouncement(say, 'hourly-chime'); }
  catch (e) { console.warn('[scheduler] chime failed:', e.message); }
}

async function generateDayPlan() {
  console.log('[scheduler] generating day plan');
  try {
    const ctx = await buildContext('規劃一下今天的節目單骨架，分早中晚三段，每段給個基調。');
    const inner = await callClaude({ system: ctx.system, user: ctx.user });
    const v = validateContract(inner);
    const planText = JSON.stringify(v.ok ? inner : localFallback({}));
    state.setPlan(today(), planText);
    publish(events.PLAN_UPDATED, { date: today(), plan: planText });
  } catch (e) {
    console.warn('[scheduler] day plan failed:', e.message);
    state.setPlan(today(), JSON.stringify(localFallback({ hint: 'fallback day plan' })));
  }
}

function pulse(label) {
  console.log(`[scheduler] pulse: ${label}`);
  publish(events.CMD, { action: 'pulse', label });
}

export function startScheduler() {
  cron.schedule('0 7 * * *', generateDayPlan);
  cron.schedule('0 9 * * *', () => pulse('morning-greeting'));
  cron.schedule('0 * * * *', () => pulse('hourly-mood-check'));
  cron.schedule('0 * * * *', () => { hourlyChime().catch(() => {}); });
  cron.schedule('0 23 * * *', () => pulse('bedtime'));

  // tick heartbeat once a minute
  cron.schedule('* * * * *', () => state.beat('scheduler'));
  state.beat('scheduler');

  // ensure today has a plan
  if (!state.getPlan(today())) {
    generateDayPlan().catch(() => {});
  }
  console.log('[scheduler] started');
}
