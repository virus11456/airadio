// DJ worker: keeps a small queue of {dj, music} items ready, broadcasts
// now-playing to the bus, records plays to SQLite. Falls back to a local
// plan when claude or ncm is unreachable.
import { buildContext } from '../core/context.js';
import { callClaude, validateContract, localFallback } from '../core/claude.js';
import * as ncm from '../core/ncm.js';
import { synthesize, estimateDurationMs } from '../core/tts.js';
import { state } from '../core/state.js';
import { publish, events } from '../core/bus.js';

const LOW_WATER = Number(process.env.QUEUE_LOW_WATER || 3);
const TICK_MS = 1000;

export const queue = [];
let current = null;
let skipFlag = false;
let paused = false;

export function snapshot() {
  return {
    current,
    queue: queue.slice(0, 10),
    paused,
  };
}

export function skip() { skipFlag = true; }
export function pause() { paused = true; }
export function resume() { paused = false; }

async function refill(hint = '') {
  let plan;
  try {
    const ctx = await buildContext(hint || '排下兩三首歌，照我品味與當前時段。');
    state.beat('dj');
    const inner = await callClaude({ system: ctx.system, user: ctx.user });
    state.beat('dj');
    const v = validateContract(inner);
    if (!v.ok) throw new Error(`contract: ${v.errors.join(', ')}`);
    plan = inner;
  } catch (e) {
    console.warn('[dj] claude failed, fallback:', e.message);
    plan = localFallback({ recentPlays: state.recentPlays(20), hint });
  }

  // 1) DJ talk segment first (if any) - with dedup
  const _recentDj = (state.recentMessages(20) || [])
    .filter(m => m && m.role === 'dj').slice(0, 3).map(m => (m.content||'').trim());
  const _isDup = plan.say && _recentDj.some(old =>
    !!old && (
      old === plan.say.trim() ||
      (old.length >= 18 && plan.say.trim().slice(0, 18) === old.slice(0, 18))
    )
  );
  if (_isDup) {
    console.warn('[dj] duplicate say detected, skipping DJ block:', plan.say.slice(0,40));
    plan.say = '';
  }
  if (plan.say && plan.say.trim()) {
    state.recordMessage('dj', plan.say.trim());
    let ttsPath = null;
    state.beat('dj');
    try { ttsPath = await synthesize(plan.say); }
    catch (e) { console.warn('[dj] tts failed:', e.message); }
    queue.push({
      kind: 'dj',
      say: plan.say,
      src: ttsPath,
      duration: estimateDurationMs(plan.say),
      reason: plan.reason,
    });
    publish(events.DJ_SAYING, { say: plan.say, src: ttsPath });
  }

  // 2) Music items
  for (const item of plan.play || []) {
    try {
      const song = await ncm.findPlayable(item.query);
      if (!song) {
        console.warn('[dj] no playable for', item.query);
        continue;
      }
      queue.push({
        kind: 'music',
        songId: song.id,
        title: song.name,
        artist: song.artists.join(' / '),
        src: song.src,
        duration: song.duration,
        reason: item.reason,
      });
    } catch (e) {
      console.warn('[dj] ncm failed for', item.query, e.message);
    }
  }

  publish(events.QUEUE_UPDATE, { queue: snapshot().queue });
}

async function play(item) {
  current = item;
  if (item.kind === 'music') {
    state.recordPlay({
      songId: item.songId, title: item.title, artist: item.artist,
      src: item.src, duration: item.duration,
    });
  }
  publish(events.NOW_PLAYING, item);

  const dur = item.duration || 5000;
  const start = Date.now();
  while (Date.now() - start < dur) {
    if (skipFlag) { skipFlag = false; break; }
    if (paused) { await sleep(500); continue; }
    await sleep(Math.min(TICK_MS, dur - (Date.now() - start)));
  }
  current = null;
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

export async function djLoop() {
  console.log('[dj] loop started');
  while (true) {
    state.beat('dj');
    if (queue.length < LOW_WATER) {
      try { await refill(); }
      catch (e) {
        console.error('[dj] refill catastrophic:', e);
        await sleep(5000);
      }
    }
    if (queue.length === 0) {
      // total drain — tiny pause then loop
      await sleep(2000);
      continue;
    }
    await play(queue.shift());
  }
}
