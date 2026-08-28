// Extract DSH session transcripts (.zstd multi-frame JSONL) into compact per-session digests.
// Usage: node extract-dsh-sessions.cjs <sessions-root> <out-dir> [project-filter] [min-mtime-ISO]
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

// ---------- pure helpers (tested) ----------

function shouldIncludeFile(mtimeMs, minMtime) {
  if (!minMtime) return true;
  return mtimeMs >= minMtime;
}

function isTopLevel(sessionHeader) {
  return !!(sessionHeader && sessionHeader.delegationDepth === 0);
}

function digestSubagent(assistantTexts) {
  if (!assistantTexts.length) return [];
  const last = assistantTexts[assistantTexts.length - 1];
  return last ? [last] : [];
}

const REDACT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{8,}/g,                                   // OpenAI-style keys
  /\b(?:password|passwd|pwd)\s*[=:]\s*(\S{6,})/gi,             // password=
  /\b(?:token|api[_-]?key|secret|access[_-]?key)\s*[=:]\s*(\S{8,})/gi,
  /Bearer\s+[A-Za-z0-9._-]{12,}/g,                              // bearer tokens incl. JWT
  /\beyJ[A-Za-z0-9._-]{10,}/g,                                  // raw JWTs
];

function redact(s) {
  if (!s) return s;
  let out = s;
  for (const re of REDACT_PATTERNS) {
    out = out.replace(re, m => {
      const lead = /^(password|passwd|pwd|token|api[_-]?key|secret|access[_-]?key)\s*[=:]/i.exec(m);
      if (lead) return lead[1] + m.slice(lead[1].length, lead[1].length + 1) + '[REDACTED]';
      const skLead = /^sk-/.exec(m);
      if (skLead) return 'sk-[REDACTED]';
      const bearer = /^Bearer\s+/i.exec(m);
      if (bearer) return 'Bearer [REDACTED]';
      return '[REDACTED]';
    });
  }
  return out;
}

module.exports = { shouldIncludeFile, isTopLevel, digestSubagent, redact };

// ---------- extraction pipeline ----------

if (require.main === module) main().catch(e => { console.error('FATAL', e); process.exit(1); });

async function main() {
  const sessionsRoot = process.argv[2];
  const outDir = process.argv[3];
  const projectFilter = process.argv[4] || '';
  const minMtime = process.argv[5] ? Date.parse(process.argv[5]) : 0;
  fs.mkdirSync(path.join(outDir, 'sessions'), { recursive: true });

  const projects = fs.readdirSync(sessionsRoot).filter(d => {
    try { return fs.statSync(path.join(sessionsRoot, d)).isDirectory(); } catch { return false; }
  });
  const catalog = [];
  for (const proj of projects) {
    if (projectFilter && !proj.includes(projectFilter)) continue;
    const projDir = path.join(sessionsRoot, proj);
    for (const sessDir of fs.readdirSync(projDir)) {
      const f = path.join(projDir, sessDir, 'session.jsonl.zstd');
      if (!fs.existsSync(f)) continue;
      const st = fs.statSync(f);
      if (st.size === 0 || !shouldIncludeFile(st.mtimeMs, minMtime)) continue;
      let text;
      try { text = (await decompressAll(f)).text; } catch (e) {
        catalog.push({ proj, dir: sessDir, error: e.message, bytes: st.size });
        continue;
      }
      catalog.push(await digestSession(text, { proj, dir: sessDir, bytes: st.size }, outDir));
    }
  }
  fs.writeFileSync(path.join(outDir, 'catalog.json'), JSON.stringify(catalog, null, 1));
  const kept = catalog.filter(c => !c.skipped);
  const ts = kept.map(c => c.firstTs).filter(Boolean);
  console.log(`total=${catalog.length} kept=${kept.length} skipped=${catalog.length - kept.length} errors=${catalog.filter(c => c.error).length}`);
  if (ts.length) console.log(`span: ${new Date(Math.min(...ts)).toISOString()} ~ ${new Date(Math.max(...kept.map(c => c.lastTs).filter(Boolean))).toISOString()}`);
}

async function decompressAll(file) {
  const b = fs.readFileSync(file);
  let off = 0; const outs = [];
  while (off + 4 <= b.length && b[off] === 0x28 && b[off + 1] === 0xB5 && b[off + 2] === 0x2F && b[off + 3] === 0xFD) {
    const r = await new Promise((res, rej) => {
      const d = zlib.createZstdDecompress();
      const cs = [];
      d.on('data', c => cs.push(c));
      d.on('end', () => res({ buf: Buffer.concat(cs), consumed: d.bytesWritten }));
      d.on('error', rej);
      d.end(b.subarray(off));
    });
    if (!r.consumed) break;
    outs.push(r.buf); off += r.consumed;
    if (outs.length > 50000) break;
  }
  return { text: Buffer.concat(outs).toString('utf8'), consumed: off, size: b.length };
}

function blockText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.filter(b => b && b.type === 'text').map(b => b.text || '').join('\n');
  return '';
}
function truncate(s, n) { s = (s || '').trim(); return s.length > n ? s.slice(0, n) + ' …[截断]' : s; }
function y(ts) { return new Date(ts).toISOString().replace('T', ' ').slice(0, 16); }

async function digestSession(text, metaIn, outDir) {
  const lines = text.split('\n').filter(Boolean);
  const meta = { ...metaIn, lines: lines.length };
  const userMsgs = [], asstTexts = [], titles = [], toolCalls = {};
  let sessionHeader = null, firstTs = null, lastTs = null;
  for (const ln of lines) {
    let o; try { o = JSON.parse(ln); } catch { continue; }
    const ts = o.time || o.time0;
    if (ts) { if (!firstTs) firstTs = ts; lastTs = ts; }
    const t = o.type;
    if (t === 'session') sessionHeader = o;
    else if (t === 'session/title') titles.push(o.data?.title || o.title || '');
    else if (t === 'user/message') {
      const m = o.data?.message || o.data;
      const txt = blockText(m?.content);
      if (txt) userMsgs.push({ ts, txt });
    } else if (t === 'assistant/message') {
      const m = o.data?.message || o.data;
      const content = m?.content;
      if (Array.isArray(content)) {
        const txt = content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (txt) asstTexts.push(txt);
        for (const b of content) if (b.type === 'tool-call') toolCalls[b.name] = (toolCalls[b.name] || 0) + 1;
      }
    }
  }
  const topLevel = isTopLevel(sessionHeader);
  meta.id = sessionHeader?.id || metaIn.dir;
  meta.cwd = sessionHeader?.cwd || '';
  meta.delegationDepth = sessionHeader?.delegationDepth;
  meta.title = titles[titles.length - 1] || '';
  meta.firstTs = firstTs; meta.lastTs = lastTs;
  meta.userMsgCount = userMsgs.length;
  meta.toolCalls = toolCalls;
  meta.firstUser = userMsgs[0] ? truncate(redact(userMsgs[0].txt), 400) : '';
  if (userMsgs.length === 0 && !meta.title) { meta.skipped = true; return meta; }
  const keptTexts = topLevel ? asstTexts : digestSubagent(asstTexts);
  meta.role = topLevel ? 'top' : 'subagent';

  let md = `# ${meta.title || metaIn.dir}\n\n- session: ${meta.id}\n- project: ${meta.proj}\n- cwd: ${meta.cwd}\n- time: ${firstTs ? y(firstTs) : '?'} ~ ${lastTs ? y(lastTs) : '?'}\n- delegationDepth: ${meta.delegationDepth ?? '?'} (${meta.role})\n- tools: ${JSON.stringify(toolCalls)}\n\n`;
  if (topLevel) {
    md += `## 用户消息 (${userMsgs.length})\n\n`;
    for (const u of userMsgs) {
      const clean = u.txt.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<command-message>[\s\S]*?<\/command-message>/g, '').trim();
      if (!clean) continue;
      md += `### [${y(u.ts)}]\n${truncate(redact(clean), 3000)}\n\n`;
    }
  } else if (userMsgs.length) {
    md += `## 子代理任务指令\n\n${truncate(redact(userMsgs[0].txt), 800)}\n\n`;
  }
  md += `## 助手结论文本 (${keptTexts.length}${topLevel ? '' : '，仅最终报告'})\n\n`;
  for (const a of keptTexts) md += `---\n${truncate(redact(a), topLevel ? 2000 : 3000)}\n\n`;
  const safe = (meta.title ? meta.title.replace(/[\\/:*?"<>|#^\[\]]/g, '_').slice(0, 50) + '.' : '') + metaIn.dir;
  fs.writeFileSync(path.join(outDir, 'sessions', safe + '.md'), md);
  meta.digestFile = 'sessions/' + safe + '.md';
  return meta;
}
