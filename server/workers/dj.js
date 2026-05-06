// DJ worker: keeps a small queue of {dj, music} items ready, broadcasts
// now-playing to the bus, records plays to SQLite. Falls back to a local
// plan when claude or ncm is unreachable.
import path from 'node:path';
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
let nextHint = '';

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

// Inject a hint that will be consumed by the next refill cycle. Used by
// /api/chat so user requests reach the LLM without waiting for queue drain.
export function setNextHint(h) {
  if (typeof h === 'string' && h.trim()) nextHint = h.trim();
}

async function refill(externalHint = '') {
  const hint = externalHint || nextHint;
  if (hint === nextHint) nextHint = '';
  let plan;
  try {
    const ctx = await buildContext(hint || '排下兩三首歌，照我品味與當前時段。');
    const inner = await callClaude({ system: ctx.system, user: ctx.user });
    const v = validateContract(inner);
    if (!v.ok) throw new Error(`contract: ${v.errors.join(', ')}`);
    plan = inner;
  } catch (e) {
    console.warn('[dj] claude failed, fallback:', e.message);
    plan = localFallback({ recentPlays: state.recentPlays(20), hint });
  }

  // 1) DJ talk segment first (if any)
  if (plan.say && plan.say.trim()) {
    let ttsPath = null;
    try { ttsPath = await synthesize(plan.say); }
    catch (e) { console.warn('[dj] tts failed:', e.message); }
    // ttsPath is an absolute filesystem path; the PWA needs the URL where
    // the static plugin serves it (/audio/tts/<basename>). null = no audio,
    // PWA still shows the text via dj-line.
    const ttsSrc = ttsPath ? `/audio/tts/${path.basename(ttsPath)}` : null;
    queue.push({
      kind: 'dj',
      say: plan.say,
      src: ttsSrc,
      duration: estimateDurationMs(plan.say),
      reason: plan.reason,
    });
  }

  // 2) Music items
  for (const item of plan.play || []) {
    try {
      const song = await ncm.findPlayable(item.query);
      if (!song) {
        console.warn('[dj] no playable for', item.query);
        continue;
      }
      // Always use server proxy. Avoids NCM CDN CORS quirks and lets us
      // re-resolve expiring tokens at play time.
      queue.push({
        kind: 'music',
        songId: song.id,
        title: song.name,
        artist: song.artists.join(' / '),
        src: `/audio/music/${song.id}`,
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
