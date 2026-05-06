// Claude Code adapter. Spawns `claude -p --output-format json`, parses
// the two-layer JSON response, validates the contract.
//
// Contract (inner JSON): { say, play: [{query, reason}], reason, segue }
//
// NOTE: the exact shape of the *outer* JSON depends on your claude CLI version.
// Run `node probe-claude.js` first; if `result` isn't the inner field, adjust
// INNER_FIELDS below.
import { spawn } from 'node:child_process';

const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const TIMEOUT_MS = Number(process.env.CLAUDE_TIMEOUT_MS || 60_000);
const INNER_FIELDS = ['result', 'content', 'text', 'output', 'response'];

function stripFence(s) {
  if (typeof s !== 'string') return s;
  const m = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/m.exec(s.trim());
  return m ? m[1] : s;
}

function pickInner(outer) {
  for (const k of INNER_FIELDS) {
    if (typeof outer[k] === 'string') return outer[k];
    if (outer[k] && typeof outer[k] === 'object') return outer[k];
  }
  return null;
}

export async function callClaude({ system, user, model, signal } = {}) {
  const args = ['-p', '--output-format', 'json'];
  if (model) args.push('--model', model);

  return await new Promise((resolve, reject) => {
    let proc;
    try {
      proc = spawn(CLAUDE_BIN, args, { env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });
    } catch (e) {
      return reject(e);
    }

    let stdout = '';
    let stderr = '';
    proc.stdout.on('data', d => { stdout += d.toString(); });
    proc.stderr.on('data', d => { stderr += d.toString(); });

    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error('claude timeout'));
    }, TIMEOUT_MS);

    if (signal) signal.addEventListener('abort', () => proc.kill('SIGKILL'), { once: true });

    proc.on('error', e => { clearTimeout(timer); reject(e); });

    proc.on('close', code => {
      clearTimeout(timer);
      if (code !== 0) {
        return reject(new Error(`claude exit ${code}: ${stderr.slice(0, 300)}`));
      }
      try {
        const outer = JSON.parse(stdout);
        const innerRaw = pickInner(outer);
        if (innerRaw == null) {
          return reject(new Error(`no inner field in ${Object.keys(outer).join(',')}`));
        }
        const inner = typeof innerRaw === 'string'
          ? JSON.parse(stripFence(innerRaw))
          : innerRaw;
        resolve(inner);
      } catch (e) {
        reject(new Error(`parse failed: ${e.message}; stdout head=${stdout.slice(0, 200)}`));
      }
    });

    const prompt = system ? `${system}\n\n---\n\n${user || ''}` : (user || '');
    proc.stdin.write(prompt);
    proc.stdin.end();
  });
}

// Fallback used when CLI is missing or upstream is failing. Keeps the radio
// alive by serving a deterministic plan derived from local seeds.
export function localFallback({ recentPlays = [], hint = '' } = {}) {
  const seeds = [
    { query: '竹內まりや 駅', reason: 'fallback city pop' },
    { query: '山下達郎 さよなら夏の日', reason: 'fallback' },
    { query: '落日飛車 My Jinji', reason: 'fallback indie' },
    { query: 'Yiruma River Flows in You', reason: 'fallback piano' },
  ];
  const seenIds = new Set(recentPlays.map(p => p.song_id));
  const pick = seeds.filter(s => !seenIds.has(s.query)).slice(0, 2);
  return {
    say: hint ? `${hint}，先放兩首墊著。` : '先放兩首墊著，等大腦回神。',
    play: pick.length ? pick : seeds.slice(0, 2),
    reason: 'fallback plan (claude unreachable)',
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
