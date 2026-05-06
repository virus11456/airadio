// probe-claude.js
// 目的：搞清楚 `claude -p --output-format json` 在你環境吐什麼
// 用法：node probe-claude.js

import { spawn } from 'child_process';

const PROMPT = '請只回我一個合法 JSON，內容是 {"hello":"world","time":"now"}，不要任何其他文字、不要 markdown code fence。';

console.log('=== probe-claude.js ===');
console.log('cwd:', process.cwd());
console.log('ANTHROPIC_BASE_URL:', process.env.ANTHROPIC_BASE_URL || '(未設定，走官方)');
console.log('---');
console.log('送出 prompt:', PROMPT);
console.log('---');

const startedAt = Date.now();
const proc = spawn('claude', ['-p', '--output-format', 'json'], {
  env: process.env,
  stdio: ['pipe', 'pipe', 'pipe']
});

let stdout = '';
let stderr = '';

proc.stdout.on('data', d => stdout += d.toString());
proc.stderr.on('data', d => stderr += d.toString());

proc.on('error', err => {
  console.error('[spawn error]', err.message);
  console.error('→ 確認 claude CLI 在 PATH 裡：which claude');
  process.exit(1);
});

proc.on('close', code => {
  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(2);
  console.log(`[exit code]: ${code}`);
  console.log(`[elapsed]: ${elapsed}s`);
  console.log('---');
  console.log('=== STDERR (原樣) ===');
  console.log(stderr || '(空)');
  console.log('---');
  console.log('=== STDOUT (原樣) ===');
  console.log(stdout || '(空)');
  console.log('---');
  console.log('=== STDOUT 嘗試 JSON.parse 第一層 ===');
  try {
    const outer = JSON.parse(stdout);
    console.log('外層欄位:', Object.keys(outer));
    console.log(JSON.stringify(outer, null, 2));

    // Claude Code 通常把回答塞在 .result 或 .content
    const inner = outer.result ?? outer.content ?? outer.text ?? null;
    if (inner) {
      console.log('---');
      console.log('=== 內層 (outer.result / .content / .text) ===');
      console.log(inner);
      console.log('---');
      console.log('=== 嘗試把內層當 JSON 再 parse ===');
      try {
        const parsed = JSON.parse(inner);
        console.log('✅ 內層是合法 JSON:', parsed);
      } catch (e) {
        console.log('❌ 內層不是純 JSON，可能被包了 markdown 或多了文字');
        console.log('error:', e.message);
      }
    }
  } catch (e) {
    console.log('❌ 外層也不是 JSON，可能 --output-format json 沒生效');
    console.log('error:', e.message);
  }
});

proc.stdin.write(PROMPT);
proc.stdin.end();
