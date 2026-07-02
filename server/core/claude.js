// MiniMax adapter (drop-in replacement for the original Claude CLI adapter).
// Same exports: callClaude, localFallback, validateContract.
// Contract (returned object): { say, play: [{query, reason}], reason, segue }
//
// Env vars:
//   MINIMAX_API_KEY       (required)
//   MINIMAX_MODEL         default: MiniMax-M2
//   MINIMAX_BASE_URL      default: https://api.minimaxi.com
//   MINIMAX_TIMEOUT_MS    default: 60000
//   MINIMAX_TEMPERATURE   default: 0.7
//   MINIMAX_MAX_TOKENS    default: 1024

const BASE_URL   = (process.env.MINIMAX_BASE_URL || 'https://api.minimaxi.com').replace(/\/+$/, '');
const MODEL      = process.env.MINIMAX_MODEL || 'MiniMax-M2';
const TIMEOUT_MS = Number(process.env.MINIMAX_TIMEOUT_MS || 60_000);
const TEMPERATURE= Number(process.env.MINIMAX_TEMPERATURE || 0.7);
const MAX_TOKENS = Number(process.env.MINIMAX_MAX_TOKENS || 2048);
const INNER_FIELDS = ['result', 'content', 'text', 'output', 'response'];

function stripFence(s) {
  if (typeof s !== 'string') return s;
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/m.exec(s.trim());
  return m ? m[1] : s;
}

function tryParseInner(content) {
  if (typeof content !== 'string') return null;
  // Try direct JSON parse after fence strip
  try { return JSON.parse(stripFence(content)); } catch (_) {}
  // Fallback: extract first {...} balanced block
  const start = content.indexOf('{');
  const end   = content.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(content.slice(start, end + 1)); } catch (_) {}
  }
  return null;
}

export async function callClaude({ system, user, model, signal } = {}) {
  const apiKey = process.env.MINIMAX_API_KEY;
  if (!apiKey) throw new Error('MINIMAX_API_KEY not set');

  const messages = [];
  if (system) messages.push({ role: 'system', content: String(system) });
  messages.push({ role: 'user', content: String(user || '') });

  const body = {
    model: model || MODEL,
    messages,
    temperature: TEMPERATURE,
    max_tokens: MAX_TOKENS,
    stream: false,
    // Force JSON output. MiniMax M2/M3 are reasoning models that otherwise
    // narrate their thinking ("Let me analyze the current situation:") before
    // the answer, which breaks tryParseInner. json_object mode strips that.
    response_format: { type: 'json_object' },
  };

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  if (signal) signal.addEventListener('abort', () => ctrl.abort(), { once: true });

  let res;
  try {
    // OpenAI-compatible endpoint. The native `/v1/text/chatcompletion_v2`
    // path requires a MiniMax JWT and is not exposed by proxy keys (sk-cp-*).
    // Body is already OpenAI-shaped, so only the URL needs changing.
    res = await fetch(`${BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    throw new Error(`minimax fetch failed: ${e.message || e}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`minimax http ${res.status}: ${txt.slice(0, 300)}`);
  }

  let json;
  try { json = await res.json(); } catch (e) {
    throw new Error(`minimax response not JSON: ${e.message}`);
  }

  // Check business-layer status (MiniMax China returns base_resp.status_code !== 0 on error)
  const status = json.base_resp && json.base_resp.status_code;
  if (status !== undefined && status !== 0) {
    throw new Error(`minimax base_resp ${status}: ${json.base_resp.status_msg || ''}`);
  }

  const choice = json.choices && json.choices[0];
  const message = choice && choice.message;
  let content = message && message.content;
  // M2 reasoning model: when answer truncated by max_tokens, content may be
  // empty and the JSON ends up in reasoning_content instead.
  if ((!content || typeof content !== 'string' || !content.trim()) && message && message.reasoning_content) {
    content = message.reasoning_content;
  }
  if (!content || typeof content !== 'string') {
    // Try INNER_FIELDS at top level just in case
    for (const k of INNER_FIELDS) {
      if (typeof json[k] === 'string') {
        const inner = tryParseInner(json[k]);
        if (inner) return inner;
      }
    }
    throw new Error(`minimax: no content in response keys=${Object.keys(json).join(',')}`);
  }

  const inner = tryParseInner(content);
  if (!inner) {
    throw new Error(`minimax: cannot parse inner JSON; head=${content.slice(0, 200)}`);
  }
  return inner;
}

// Fallback used when the LLM is unreachable. Keeps the radio alive by
// pulling actual Suno track titles from user/suno-library.json — those are
// guaranteed playable (mp3s already on disk). NCM-style queries can fail
// when NCM is down; Suno can't.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath as _fu } from 'node:url';
const _dirname = path.dirname(_fu(import.meta.url));
const _SUNO_LIB = path.join(_dirname, '..', '..', 'user', 'suno-library.json');

function _readSunoLibrary() {
  try { return JSON.parse(fs.readFileSync(_SUNO_LIB, 'utf8')) || []; }
  catch { return []; }
}

export function localFallback({ recentPlays = [], hint = '' } = {}) {
  const lib = _readSunoLibrary();
  const seenIds = new Set(recentPlays.map(p => p.song_id));
  const pickFromSuno = (count) => {
    if (!lib.length) return [];
    const fresh = lib.filter(t => !seenIds.has('suno:' + t.id));
    const pool = fresh.length ? fresh : lib;
    const out = [];
    const used = new Set();
    while (out.length < count && used.size < pool.length) {
      const i = Math.floor(Math.random() * pool.length);
      if (used.has(i)) continue;
      used.add(i);
      const t = pool[i];
      out.push({
        query: t.title || t.tags || 'city pop',
        reason: 'fallback (Suno library)',
      });
    }
    return out;
  };

  const sunoSeeds = pickFromSuno(2);
  if (sunoSeeds.length) {
    return {
      say: hint ? `${hint}，先放兩首墊著。` : '先放兩首墊著，等大腦回神。',
      play: sunoSeeds,
      reason: 'fallback plan (LLM unreachable, Suno library random)',
      segue: '',
    };
  }

  // Last resort — broad tags that should match almost any track via Suno
  // tag scoring, plus a couple of NCM-friendly queries.
  return {
    say: hint ? `${hint}，先放兩首墊著。` : '先放兩首墊著，等大腦回神。',
    play: [
      { query: 'city pop', reason: 'fallback verified-playable' },
      { query: 'kayokyoku', reason: 'fallback verified-playable' },
    ],
    reason: 'fallback plan (LLM + Suno library unavailable)',
    segue: '',
  };
}

// Shape validator. Returns { ok, errors[] }.
export function validateContract(inner) {
  const errors = [];
  if (!inner || typeof inner !== 'object') {
    return { ok: false, errors: ['not an object'] };
  }
  if (typeof inner.say !== 'string') errors.push('say not string');
  if (!Array.isArray(inner.play)) errors.push('play not array');
  else {
    inner.play.forEach((p, i) => {
      if (!p || typeof p.query !== 'string') errors.push(`play[${i}].query missing`);
    });
  }
  if (typeof inner.reason !== 'string') errors.push('reason not string');
  if (typeof inner.segue !== 'string') inner.segue = '';
  return { ok: errors.length === 0, errors };
}
