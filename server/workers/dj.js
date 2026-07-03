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
let startedAt = 0;
let skipFlag = false;
let paused = false;

export function snapshot() {
  return {
    current: current ? { ...current, startedAt, serverNow: Date.now() } : null,
    queue: queue.slice(0, 10),
    paused,
  };
}

export function skip() { skipFlag = true; }
export function pause() { paused = true; }
export function resume() { paused = false; }

// ---------- Station-ID jingles (台呼) ----------
// Every N music tracks the station identifies itself — the single biggest
// "this is a real radio" cue. Fixed lines, no LLM involved; Edge/Fish TTS
// caches by md5 so each line is synthesized exactly once, ever.
const JINGLE_EVERY = Number(process.env.JINGLE_EVERY_SONGS || 4);
const JINGLES_DAY = [
  '你正在收聽的是 AIRADIO FM，二十四小時不打烊的 AI 電台。',
  'AIRADIO FM——城市的頻率，永遠在線。',
  'AIRADIO FM，polyboy 點 tech，隨時歡迎回來。',
];
const JINGLES_NIGHT = [
  '深夜的 AIRADIO FM，還醒著的人，我們一起聽下去。',
  '你正在收聽的是 AIRADIO FM，陪你到天亮。',
];
let musicSinceJingle = 0;
let jingleIdx = 0;

async function makeJingleItem() {
  const h = new Date(new Date().toLocaleString('en-US', { timeZone: process.env.TZ || 'Asia/Taipei' })).getHours();
  const pool = (h >= 23 || h < 6) ? JINGLES_NIGHT : JINGLES_DAY;
  const say = pool[jingleIdx++ % pool.length];
  let src = null;
  try { src = await synthesize(say); }
  catch (e) { console.warn('[dj] jingle tts failed:', e.message); }
  return {
    kind: 'dj', say, src,
    duration: estimateDurationMs(say),
    reason: 'station-id',
  };
}

// ---------- Scheduled announcements (整點報時 etc.) ----------
// Pushed to the FRONT of the queue so it plays right after the current
// track — never interrupts mid-song. Not recorded as a dj message so the
// LLM's dedup / context stays clean.
export async function queueAnnouncement(say, reason = 'announcement') {
  if (!say || !say.trim()) return;
  let src = null;
  try { src = await synthesize(say); }
  catch (e) { console.warn('[dj] announcement tts failed:', e.message); }
  queue.unshift({
    kind: 'dj', say, src,
    duration: estimateDurationMs(say),
    reason,
  });
  publish(events.QUEUE_UPDATE, { queue: snapshot().queue });
}

async function refill(hint = '') {
  let plan;
  let pendingFanIds = [];
  try {
    const ctx = await buildContext(hint || '排下兩三首歌，照我品味與當前時段。');
    pendingFanIds = ctx.pendingFanIds || [];
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

    // Mark the listener letters this segment addressed. If the LLM emitted
    // replied_to: [ids], use those (precise). Otherwise heuristically mark
    // any letter whose id was quoted in the say (#42 etc), so we don't loop
    // on the same letters next cycle.
    const replied = Array.isArray(plan.replied_to) ? plan.replied_to.map(Number).filter(Number.isFinite) : [];
    const quoted = [];
    if (pendingFanIds.length) {
      const m = (plan.say.match(/#\d+/g) || []).map(s => Number(s.slice(1)));
      for (const id of m) if (pendingFanIds.includes(id)) quoted.push(id);
    }
    const toMark = [...new Set([...replied, ...quoted])];
    if (toMark.length) {
      const n = state.markFanAddressed(toMark);
      if (n) console.log('[dj] marked fan letters addressed:', toMark.join(','));
    }

    let ttsPath = null;
    state.beat('dj');
    try { ttsPath = await synthesize(plan.say); }
    catch (e) { console.warn('[dj] tts failed:', e.message); }
    // Pull the actual letter bodies for the front-end mailbag scene.
    const repliedToLetters = toMark
      .map(id => state.getMessageById?.(id))
      .filter(m => m && m.role === 'fan')
      .map(m => ({ id: m.id, sender: (m.sender || 'anon').slice(0, 8), content: m.content || '', ts: m.ts }));

    const djItem = {
      kind: 'dj',
      say: plan.say,
      src: ttsPath,
      duration: estimateDurationMs(plan.say),
      reason: plan.reason,
      repliedTo: toMark,
      repliedToLetters,
    };
    // Letter replies jump the queue: airing right after the current track
    // makes the listener feel heard. Regular banter keeps its place.
    if (toMark.length) queue.unshift(djItem);
    else queue.push(djItem);
    publish(events.DJ_SAYING, { say: plan.say, src: ttsPath, repliedTo: toMark, repliedToLetters });
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
        cover: song.cover || null,
        duration: song.duration,
        reason: item.reason,
        tags: song.tags || '',
        playlistId: song.playlistId || null,
      });
    } catch (e) {
      console.warn('[dj] ncm failed for', item.query, e.message);
    }
  }

  publish(events.QUEUE_UPDATE, { queue: snapshot().queue });
}

async function play(item) {
  current = item;
  startedAt = Date.now();
  if (item.kind === 'music') {
    state.recordPlay({
      songId: item.songId, title: item.title, artist: item.artist,
      src: item.src, duration: item.duration,
    });
  }
  publish(events.NOW_PLAYING, { ...item, startedAt, serverNow: Date.now() });

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

// Track whether a refill is already in flight so we don't fire two LLM
// calls in parallel (and so the loop doesn't block waiting for one).
let _refilling = false;
function maybeRefillAsync(hint = '') {
  if (_refilling) return;
  if (queue.length >= REFILL_AT) return;
  _refilling = true;
  refill(hint)
    .catch(e => console.error('[dj] refill failed:', e?.message || e))
    .finally(() => { _refilling = false; });
}

// Refill threshold — kick off async refill when 1 item or fewer remain so
// the LLM call overlaps the currently playing track instead of blocking.
const REFILL_AT = Math.max(LOW_WATER, 1);

// A fresh listener letter forces a refill immediately (bypassing the
// queue-length check) so the on-air reply lands within about one track.
// 45s cooldown batches rapid-fire letters into a single LLM call.
let _lastLetterRefill = 0;
export function requestLetterReply() {
  const now = Date.now();
  if (now - _lastLetterRefill < 45_000) return;
  if (_refilling) return;
  _lastLetterRefill = now;
  _refilling = true;
  refill('有聽眾剛剛來信。請在這一段優先回覆來信（JSON 記得帶 replied_to），然後照常排歌。')
    .catch(e => console.error('[dj] letter-reply refill failed:', e?.message || e))
    .finally(() => { _refilling = false; });
}

export async function djLoop() {
  console.log('[dj] loop started');
  while (true) {
    state.beat('dj');

    // Always keep the queue topped up, but don't await it.
    if (queue.length < REFILL_AT) maybeRefillAsync();

    if (queue.length === 0) {
      // Refill is in flight (or failed). Don't go silent — push a random
      // Suno track instantly so the listener always hears music.
      let pushed = false;
      try {
        const fallback = await ncm.findPlayable(''); // returns a random Suno song
        if (fallback) {
          queue.push({
            kind: 'music',
            songId: fallback.id,
            title: fallback.name,
            artist: (fallback.artists || ['Suno']).join(' / '),
            src: fallback.src,
            cover: fallback.cover || null,
            duration: fallback.duration,
            reason: 'instant fallback (queue empty)',
            tags: fallback.tags || '',
            playlistId: fallback.playlistId || null,
          });
          pushed = true;
          console.log('[dj] instant fallback —', fallback.name);
        }
      } catch (e) {
        console.warn('[dj] instant fallback failed:', e.message);
      }
      if (!pushed) {
        await sleep(1500);
        continue;
      }
    }

    const item = queue.shift();
    await play(item);

    // Station-ID cadence: after every JINGLE_EVERY music tracks, slot a
    // jingle in as the very next item. Skips DJ/announcement items so the
    // count reflects actual songs.
    if (item.kind === 'music') {
      musicSinceJingle++;
      if (musicSinceJingle >= JINGLE_EVERY) {
        musicSinceJingle = 0;
        try {
          queue.unshift(await makeJingleItem());
          publish(events.QUEUE_UPDATE, { queue: snapshot().queue });
        } catch (e) {
          console.warn('[dj] jingle failed:', e.message);
        }
      }
    }
  }
}
