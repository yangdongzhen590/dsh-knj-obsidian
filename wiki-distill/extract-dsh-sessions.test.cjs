// Red/green tests for extract-dsh-sessions logic. Run: node extract-dsh-sessions.test.cjs
const assert = require('assert');
const path = require('path');
const M = require(path.join(__dirname, 'extract-dsh-sessions.cjs'));

let failed = 0, passed = 0;
function t(name, fn) {
  try { fn(); passed++; console.log('PASS', name); }
  catch (e) { failed++; console.log('FAIL', name, '::', e.message); }
}

t('shouldIncludeFile: mtime before cutoff excluded', () => {
  assert.strictEqual(M.shouldIncludeFile(Date.parse('2026-08-23T12:00:00Z'), Date.parse('2026-08-24T00:00:00Z')), false);
  assert.strictEqual(M.shouldIncludeFile(Date.parse('2026-08-24T12:00:00Z'), Date.parse('2026-08-24T00:00:00Z')), true);
  assert.strictEqual(M.shouldIncludeFile(Date.parse('2026-08-23T12:00:00Z'), 0), true);
});

t('isTopLevel: delegationDepth 0 with user message', () => {
  assert.strictEqual(M.isTopLevel({ delegationDepth: 0 }), true);
  assert.strictEqual(M.isTopLevel({ delegationDepth: 1 }), false);
  assert.strictEqual(M.isTopLevel(undefined), false);
});

t('digestSubagent: only the final assistant report survives', () => {
  const texts = ['中间探索步骤一', '中间探索步骤二', '最终报告：完成 X，结论 Y'];
  assert.deepStrictEqual(M.digestSubagent(texts), ['最终报告：完成 X，结论 Y']);
  assert.deepStrictEqual(M.digestSubagent([]), []);
});

t('redact: masks keys, tokens, passwords, keeps prose', () => {
  const out = M.redact('sk-abc123DEF456ghi789JKL 用它调用 API，password=hunter2secret 结束');
  assert.ok(!out.includes('abc123DEF456'));
  assert.ok(!out.includes('hunter2secret'));
  assert.ok(out.includes('用它调用 API'));
  assert.ok(out.includes('结束'));
  const bearer = M.redact('Authorization: Bearer eyJhbGciOi.very.long.jwt.value9182');
  assert.ok(!bearer.includes('eyJhbGciOi'));
});

t('redact: plain Chinese text untouched', () => {
  assert.strictEqual(M.redact('插件 v4 UI 重构完成，圆角统一 8px'), '插件 v4 UI 重构完成，圆角统一 8px');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
