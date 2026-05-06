// Music prefetch worker. The PWA already prefetches the next track via fetch,
// but this worker can warm the NCM song_url cache and (optionally) mirror the
// mp3 to cache/music for resilience.
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { state } from '../core/state.js';
import { queue } from './dj.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../', process.env.MUSIC_CACHE_DIR || 'cache/music');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const MIRROR = process.env.MUSIC_MIRROR === '1';

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function maybeMirror(item) {
  if (!MIRROR || !item.songId || !item.src) return;
  const out = path.join(CACHE_DIR, `${item.songId}.mp3`);
  if (fs.existsSync(out)) return;
  try {
    const res = await fetch(item.src);
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(out, buf);
  } catch (e) {
    console.warn('[music] mirror failed', item.songId, e.message);
  }
}

export async function musicLoop() {
  console.log('[music] loop started');
  while (true) {
    state.beat('music');
    const upcoming = queue.find(q => q.kind === 'music');
    if (upcoming) await maybeMirror(upcoming);
    await sleep(5000);
  }
}
