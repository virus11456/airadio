// Cron scheduler. Triggers planned moments — daily plan generation,
// morning greeting, hourly mood check, bedtime mode.
import cron from 'node-cron';
import { buildContext } from '../core/context.js';
import { callClaude, validateContract, localFallback } from '../core/claude.js';
import { state } from '../core/state.js';
import { publish, events } from '../core/bus.js';

function today() { return new Date().toISOString().slice(0, 10); }

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
