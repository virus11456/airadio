#!/usr/bin/env node
/**
 * probe-claude.js
 *
 * 探針：確認 `claude -p --output-format json` 在當前環境的輸出格式。
 *
 * 用途：在寫 server/core/claude.js 之前，先把實際的 stdout 結構搞清楚，
 * 避免後續 JSON.parse 兩層剝殼時踩坑。
 *
 * 跑法：
 *   node probe-claude.js
 *   node probe-claude.js "自訂 prompt"
 *
 * 退出碼：
 *   0  全部通過（外層 JSON 合法 + 內層 JSON 合法）
 *   1  外層 JSON 解析失敗
 *   2  內層 result/content/text 解析失敗
 *   3  claude CLI 找不到 / spawn 失敗
 *   4  claude 進程非零退出
 *   5  超時
 */

import { spawn } from 'node:child_process';
import { performance } from 'node:perf_hooks';

const TIMEOUT_MS = 60_000;

const SYSTEM = `你是一個只會回 JSON 的助手。
規則：
1. 永遠回合法 JSON，無 markdown 包裹
2. 欄位固定：{ "say": string, "play": [{"query": string, "reason": string}], "reason": string, "segue": string }`;

const USER_INPUT = process.argv[2]
  ?? '探針測試：請排兩首深夜爵士並說一句開場。';

const PROMPT = `${SYSTEM}\n\n---\n\n${USER_INPUT}`;

function log(label, data) {
  console.log(`\n========== ${label} ==========`);
  console.log(typeof data === 'string' ? data : JSON.stringify(data, null, 2));
}

function detectMarkdownFence(s) {
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```\s*$/m.exec(s.trim());
  return fenced ? fenced[1] : null;
}

async function run() {
  const args = ['-p', '--output-format', 'json'];

  console.log(`[probe-claude] cmd: claude ${args.join(' ')}`);
  console.log(`[probe-claude] ANTHROPIC_BASE_URL=${process.env.ANTHROPIC_BASE_URL || '(unset)'}`);
  console.log(`[probe-claude] prompt bytes=${Buffer.byteLength(PROMPT)}`);

  const t0 = performance.now();
  let proc;
  try {
    proc = spawn('claude', args, {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch (e) {
    log('SPAWN ERROR', e.message);
    process.exit(3);
  }

  let stdout = '';
  let stderr = '';
  proc.stdout.on('data', (d) => { stdout += d.toString(); });
  proc.stderr.on('data', (d) => { stderr += d.toString(); });

  const timer = setTimeout(() => {
    console.error('[probe-claude] timeout, killing');
    proc.kill('SIGKILL');
  }, TIMEOUT_MS);

  proc.on('error', (e) => {
    clearTimeout(timer);
    log('PROC ERROR', e.message);
    if (e.code === 'ENOENT') {
      console.error('claude CLI 不在 PATH。執行 `which claude` 確認，或設定絕對路徑。');
    }
    process.exit(3);
  });

  proc.stdin.write(PROMPT);
  proc.stdin.end();

  const code = await new Promise((resolve) => proc.on('close', resolve));
  clearTimeout(timer);

  const elapsed = ((performance.now() - t0) / 1000).toFixed(2);
  console.log(`\n[probe-claude] exit=${code} elapsed=${elapsed}s`);
  console.log(`[probe-claude] stdout bytes=${stdout.length} stderr bytes=${stderr.length}`);

  if (stderr.trim()) log('STDERR', stderr);
  log('STDOUT (raw)', stdout);

  if (code !== 0) {
    console.error(`[probe-claude] 非零退出碼 ${code}`);
    process.exit(4);
  }

  // 外層解析
  let outer;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    log('OUTER PARSE FAIL', e.message);
    console.error('外層 stdout 不是合法 JSON。可能 --output-format json 不支援，或多了 banner 文字。');
    process.exit(1);
  }
  log('OUTER (parsed)', outer);
  log('OUTER KEYS', Object.keys(outer));

  // 找出可能的內容欄位
  const candidates = ['result', 'content', 'text', 'output', 'response'];
  const innerKey = candidates.find((k) => typeof outer[k] === 'string');
  if (!innerKey) {
    log('NO STRING FIELD', '在 result/content/text/output/response 都找不到字串欄位');
    console.warn('內層欄位需要根據 OUTER KEYS 手動調整 claude.js');
    process.exit(2);
  }

  const innerRaw = outer[innerKey];
  console.log(`\n[probe-claude] inner field = "${innerKey}", bytes=${innerRaw.length}`);
  log('INNER (raw)', innerRaw);

  // 嘗試剝 markdown fence
  const stripped = detectMarkdownFence(innerRaw);
  if (stripped !== null) {
    console.warn('[probe-claude] inner 被 ```json 包了，需要在 claude.js 加剝殼邏輯');
    log('INNER (after strip fence)', stripped);
  }

  let inner;
  try {
    inner = JSON.parse(stripped ?? innerRaw);
  } catch (e) {
    log('INNER PARSE FAIL', e.message);
    console.error('內層 JSON 解析失敗。模型沒乖乖回 JSON，需要強化 prompt 或寫容錯。');
    process.exit(2);
  }
  log('INNER (parsed)', inner);

  // 契約檢查
  const contractKeys = ['say', 'play', 'reason', 'segue'];
  const missing = contractKeys.filter((k) => !(k in inner));
  if (missing.length) {
    console.warn(`[probe-claude] 契約欄位缺失: ${missing.join(', ')}`);
  } else {
    console.log('[probe-claude] ✅ 契約欄位齊全 {say, play, reason, segue}');
  }
  if (Array.isArray(inner.play)) {
    console.log(`[probe-claude] play[] 共 ${inner.play.length} 首`);
  }

  console.log('\n[probe-claude] DONE');
}

run().catch((e) => {
  console.error('[probe-claude] uncaught:', e);
  process.exit(5);
});
