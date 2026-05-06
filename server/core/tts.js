// Fish Audio TTS pipeline with on-disk cache.
// Same text + voice → same md5 → same mp3, no re-synthesize.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = path.resolve(__dirname, '../../', process.env.TTS_CACHE_DIR || 'cache/tts');
fs.mkdirSync(CACHE_DIR, { recursive: true });

const FISH_API = 'https://api.fish.audio/v1/tts';

function cachePath(text, voice) {
  const hash = crypto.createHash('md5').update(`${voice}::${text}`).digest('hex');
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

export async function synthesize(text, voice) {
  if (!text || !text.trim()) return null;
  const v = voice || process.env.FISH_VOICE_ID || 'default';
  const out = cachePath(text, v);
  if (fs.existsSync(out)) return out;

  if (!process.env.FISH_API_KEY) {
    // Degraded mode — no key, no audio. Worker layer should handle null.
    console.warn('[tts] FISH_API_KEY not set, skipping synthesis');
    return null;
  }

  const body = {
    text,
    format: 'mp3',
    ...(process.env.FISH_VOICE_ID ? { reference_id: process.env.FISH_VOICE_ID } : {}),
  };

  const res = await fetch(FISH_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FISH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Fish TTS ${res.status}: ${errText.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(out, buf);
  return out;
}

export function estimateDurationMs(text) {
  // Rough estimate: 4 chars/sec for Mandarin-leaning TTS. Used to schedule
  // crossfade timing without reading the mp3.
  const chars = (text || '').length;
  return Math.max(1500, Math.round((chars / 4) * 1000));
}
