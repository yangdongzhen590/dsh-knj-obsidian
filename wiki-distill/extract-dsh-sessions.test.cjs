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

t('sessionIncluded: 无过滤时全通过，过滤时按会话目录/id 匹配（单个会话蒸馏）', () => {
  assert.strictEqual(M.sessionIncluded('sess-abc', ''), true);
  assert.strictEqual(M.sessionIncluded('sess-abc', undefined), true);
  assert.strictEqual(M.sessionIncluded('sess-abc', 'sess-abc'), true);
  // 前缀匹配：允许用 id 前缀缩略指定；但不是任意子串匹配
  assert.strictEqual(M.sessionIncluded('sess-abc-123', 'sess-abc'), true);
  assert.strictEqual(M.sessionIncluded('sess-abc-123', 'abc'), false, '片段出现在中间不应命中');
  assert.strictEqual(M.sessionIncluded('sess-abc', 'other'), false);
  // 多个 id 用逗号分隔（批量指定）
  assert.strictEqual(M.sessionIncluded('sess-b', 'sess-a,sess-b'), true);
  assert.strictEqual(M.sessionIncluded('sess-c', 'sess-a, sess-b'), false);
});

t('pickSessionFile: 认 v4 命名、旧命名兜底、多版本取最高、无关文件返回 undefined', () => {
  assert.strictEqual(M.pickSessionFile(['session.v4.jsonl.zstd']), 'session.v4.jsonl.zstd');
  assert.strictEqual(M.pickSessionFile(['session.jsonl.zstd']), 'session.jsonl.zstd');
  assert.strictEqual(
    M.pickSessionFile(['session.v2.jsonl.zstd', 'session.jsonl.zstd', 'session.v4.jsonl.zstd']),
    'session.v4.jsonl.zstd',
  );
  assert.strictEqual(M.pickSessionFile(['session.v4.jsonl.zstd.bak', 'catalog.json', 'notes.md']), undefined);
  assert.strictEqual(M.pickSessionFile([]), undefined);
});

t('CLI 集成：会话目录只有 session.v4.jsonl.zstd 时也能蒸到该会话', () => {
  const fs = require('fs');
  const os = require('os');
  const zlib = require('zlib');
  const { spawnSync } = require('child_process');
  const script = path.join(__dirname, 'extract-dsh-sessions.cjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-distill-v4-'));
  try {
    const projDir = path.join(root, 'sessions', '--proj--', 'sess-v4');
    fs.mkdirSync(projDir, { recursive: true });
    const jsonl = [
      JSON.stringify({ type: 'session', id: 'sess-v4', cwd: 'D:\\proj', delegationDepth: 0, time: Date.parse('2026-11-01T10:00:00.000Z') }),
      JSON.stringify({ type: 'user/message', time: Date.parse('2026-11-01T10:00:01.000Z'), data: { message: { content: [{ type: 'text', text: '验证 v4 命名发现' }] } } }),
      JSON.stringify({ type: 'assistant/message', time: Date.parse('2026-11-01T10:00:02.000Z'), data: { message: { content: [{ type: 'text', text: '已完成验证' }] } } }),
    ].join('\n');
    fs.writeFileSync(path.join(projDir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(jsonl, 'utf8')));

    const outDir = path.join(root, 'out');
    const r = spawnSync(process.execPath, [script, path.join(root, 'sessions'), outDir, '--proj--', '', ''], { encoding: 'utf8' });
    assert.strictEqual(r.status, 0, `CLI 退出码 ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /total=1 kept=1/, `stdout=${r.stdout}`);
    const catalog = JSON.parse(fs.readFileSync(path.join(outDir, 'catalog.json'), 'utf8'));
    assert.strictEqual(catalog.length, 1);
    assert.strictEqual(catalog[0].dir, 'sess-v4');
    assert.ok(catalog[0].digestFile, 'catalog 应记录 digestFile');
    assert.ok(
      fs.readFileSync(path.join(outDir, catalog[0].digestFile), 'utf8').includes('验证 v4 命名发现'),
      '生成的 md 应含 fixture 的用户消息',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
