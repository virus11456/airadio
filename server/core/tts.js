// TTS adapter: Fish.audio (primary) -> Edge TTS (free fallback).
// Falls back to Edge TTS automatically when Fish key missing or returns error
// (e.g. 402 Insufficient Balance).
//
// Env:
//   FISH_API_KEY   (optional) — Fish.audio API key
//   FISH_VOICE_ID  (optional) — Fish voice reference
//   EDGE_TTS_VOICE default: zh-TW-HsiaoChenNeural
//   TTS_CACHE_DIR  default: cache/tts
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const FISH_API   = 'https://api.fish.audio/v1/tts';
const CACHE_DIR  = process.env.TTS_CACHE_DIR || 'cache/tts';
const EDGE_VOICE = process.env.EDGE_TTS_VOICE || 'zh-TW-HsiaoChenNeural';

if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });

function cachePath(text, voice) {
  const hash = crypto.createHash('md5').update(`${voice}::${text}`).digest('hex');
  return path.join(CACHE_DIR, `${hash}.mp3`);
}

async function synthesizeFish(text, voiceId) {
  if (!process.env.FISH_API_KEY) throw new Error('FISH_API_KEY not set');
  const body = { text, format: 'mp3', ...(voiceId ? { reference_id: voiceId } : {}) };
  const res = await fetch(FISH_API, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.FISH_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Fish ${res.status}: ${err.slice(0, 160)}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function synthesizeEdge(text, voice) {
  const t = new MsEdgeTTS();
  await t.setMetadata(voice, OUTPUT_FORMAT.AUDIO_24KHZ_48KBITRATE_MONO_MP3);
  const tmpDir = path.join('/tmp', `edge-${crypto.randomBytes(6).toString('hex')}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  try {
    const r = await t.toFile(tmpDir, text);
    const fpath = (r && r.audioFilePath) || path.join(tmpDir, 'audio.mp3');
    return fs.readFileSync(fpath);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

export async function synthesize(text, voice) {
  if (!text || !text.trim()) return null;
  const v = voice || process.env.FISH_VOICE_ID || 'default';
  const out = cachePath(text, v);
  if (fs.existsSync(out)) return out;

  let buf = null;
  // Try Fish first when configured.
  if (process.env.FISH_API_KEY) {
    try {
      buf = await synthesizeFish(text, process.env.FISH_VOICE_ID);
    } catch (e) {
      console.warn(`[tts] Fish failed (${e.message}) -> Edge TTS fallback`);
    }
  }
  // Fallback to free Edge TTS.
  if (!buf) {
    try {
      buf = await synthesizeEdge(text, EDGE_VOICE);
    } catch (e) {
      console.warn(`[tts] Edge TTS also failed: ${e.message}`);
      return null;
    }
  }
  fs.writeFileSync(out, buf);
  return out;
}

export function estimateDurationMs(text) {
  // Rough estimate: 4 chars/sec for Mandarin-leaning TTS.
  const chars = (text || '').length;
  return Math.max(1500, Math.round((chars / 4) * 1000));
}
