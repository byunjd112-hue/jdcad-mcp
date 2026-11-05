#!/usr/bin/env node
// JDCAD MCP server — zero dependencies (Node 18+).
//   stdio (Claude Desktop / Claude Code):  node server.js
//   HTTP  (remote connector):              node server.js --http 8787   → POST /mcp
'use strict';
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const JD = require('./engine.js'), SAMPLES = require('./samples.js'), K = require('./knowledge.js');

const VERSION = '0.3.0';
const HOME = process.env.JDCAD_HOME || path.join(os.homedir(), '.jdcad');
const CFG = path.join(HOME, 'config.json'), HIST = path.join(HOME, 'history.jsonl'), BK = path.join(HOME, 'backups');
const HTTP_MODE = process.argv.includes('--http');

// ---------- persistence (last save folder, history, backups) ----------
const ensure = d => fs.mkdirSync(d, { recursive: true });
const readCfg = () => { try { return JSON.parse(fs.readFileSync(CFG, 'utf8')); } catch { return {}; } };
const writeCfg = c => { ensure(HOME); fs.writeFileSync(CFG, JSON.stringify(c, null, 2)); };
const addHist = r => { ensure(HOME); fs.appendFileSync(HIST, JSON.stringify(r) + '\n'); };
const readHist = n => { try { return fs.readFileSync(HIST, 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)).slice(-n).reverse(); } catch { return []; } };
const safeName = s => String(s || 'drawing').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 80);
function backup(name, spec) {
  const d = path.join(BK, safeName(name)); ensure(d);
  fs.writeFileSync(path.join(d, new Date().toISOString().replace(/[:.]/g, '-') + '.json'), JSON.stringify(spec));
  const fsx = fs.readdirSync(d).sort(); while (fsx.length > 20) fs.unlinkSync(path.join(d, fsx.shift()));
}

// ---------- helpers ----------
const parseSpec = s => { if (typeof s === 'string') s = JSON.parse(s); if (!s || !Array.isArray(s.entities)) throw new Error('spec.entities 배열이 필요합니다. jdcad_guide로 형식을 확인하세요.'); return s; };
function summary(m, spec) {
  const checks = (m.checks || []).map(c => `- [${c.level || 'warn'}] ${c.msg}`).join('\n') || '- 문제 없음';
  return `도면: ${spec.title || '(제목 없음)'} / 도번 ${spec.drawingNo || '-'}\n자동 축척 ${m.scaleLabel}, 용지 ${m.sheet}, 요소 ${spec.entities.length}개${m.warn && m.warn.length ? `\n경고: ${m.warn.join('; ')}` : ''}\n규격·생산성 점검:\n${checks}`;
}
const text = t => ({ type: 'text', text: t });

const GUIDE = () => K.RULES.replace('사용자 요청을 JDCAD 도면 사양 JSON 하나로만 답하세요. 설명 문장이나 코드펜스 없이 { 로 시작해 } 로 끝나는 JSON만 출력합니다.',
  '사용자 요청을 JDCAD 도면 사양 JSON으로 만든 뒤 jdcad_draw 도구로 넘기면 DXF/SVG가 만들어집니다.') +
  `\n저장 규칙: 저장 전에 항상 사용자에게 저장 폴더를 물어보고, 마지막 저장 폴더(jdcad_history의 lastDir)를 기본값으로 제안합니다.\n\n사양 형식:\n${K.SCHEMA}\n\n표준 데이터는 jdcad_standards, 예시는 jdcad_sample로 볼 수 있습니다.`;

// ---------- tools ----------
const specProp = { description: 'JDCAD 도면 사양 JSON (객체 또는 문자열). 형식은 jdcad_guide 참고.', anyOf: [{ type: 'object' }, { type: 'string' }] };
const TOOLS = [
  { name: 'jdcad_guide', description: 'JDCAD 작도 규칙(KS 제도·치수·레이어), 도면 사양 JSON 형식을 돌려줍니다. 도면을 만들기 전에 먼저 호출하세요.', inputSchema: { type: 'object', properties: {} } },
  { name: 'jdcad_standards', description: '설계용 표준 데이터 표(미터 볼트 구멍·탭·자리파기, 62xx 베어링, ISO 286 끼워맞춤, 평행 키, MCCB 정격).', inputSchema: { type: 'object', properties: { table: { type: 'string', enum: Object.keys(K.STD), description: '생략하면 전부' } } } },
  { name: 'jdcad_sample', description: '예제 도면 사양(bracket 기계 브라켓, panel 전기 단선결선도)을 돌려줍니다.', inputSchema: { type: 'object', properties: { name: { type: 'string', enum: Object.keys(SAMPLES) } }, required: ['name'] } },
  { name: 'jdcad_check', description: '사양을 빌드만 해서 자동 축척·용지와 규격·생산성 점검 결과를 돌려줍니다(파일 저장 없음).', inputSchema: { type: 'object', properties: { spec: specProp }, required: ['spec'] } },
  { name: 'jdcad_draw', description: '도면 사양으로 AutoCAD 호환 DXF(R12)와 SVG 미리보기를 만듭니다. 로컬 모드에서는 outDir에 저장하고(생략 시 마지막 저장 폴더), 이력과 백업을 남깁니다. 저장 전 사용자에게 폴더를 확인하세요.',
    inputSchema: { type: 'object', properties: { spec: specProp, name: { type: 'string', description: '파일 이름(확장자 제외)' }, outDir: { type: 'string', description: '저장 폴더 절대경로' }, formats: { type: 'array', items: { type: 'string', enum: ['dxf', 'svg', 'json'] }, description: '기본 ["dxf","svg","json"]' }, returnContent: { type: 'boolean', description: 'DXF·SVG 본문을 응답에 포함 (원격 모드는 항상 포함)' } }, required: ['spec'] } },
  { name: 'jdcad_history', description: '저장 이력(시간·이름·형식·경로)과 마지막 저장 폴더, 백업 목록을 돌려줍니다.', inputSchema: { type: 'object', properties: { limit: { type: 'number' } } } },
  { name: 'jdcad_restore', description: '자동 백업에서 도면 사양을 복원합니다. file 생략 시 해당 도면의 가장 최근 백업.', inputSchema: { type: 'object', properties: { name: { type: 'string' }, file: { type: 'string' } }, required: ['name'] } },
];
const LOCAL_ONLY = new Set(['jdcad_history', 'jdcad_restore']);

function call(name, a = {}) {
  switch (name) {
    case 'jdcad_guide': return [text(GUIDE())];
    case 'jdcad_standards': {
      const ts = a.table ? [K.STD[a.table]] : Object.values(K.STD);
      return [text(ts.map(t => `[${t.cap}]\n${t.cols.join(' | ')}\n${t.rows.map(r => r.join(' | ')).join('\n')}`).join('\n\n'))];
    }
    case 'jdcad_sample': { const s = SAMPLES[a.name]; if (!s) throw new Error('예제 이름: ' + Object.keys(SAMPLES).join(', ')); return [text(JSON.stringify(s))]; }
    case 'jdcad_check': { const spec = parseSpec(a.spec); return [text(summary(JD.build(spec), spec))]; }
    case 'jdcad_draw': {
      const spec = parseSpec(a.spec), m = JD.build(spec);
      const fmts = a.formats && a.formats.length ? a.formats : ['dxf', 'svg', 'json'];
      const files = { dxf: () => JD.toDXF(m, spec), svg: () => JD.toSVG(m, { bg: '#fff' }), json: () => JSON.stringify(spec, null, 1) };
      const out = [text(summary(m, spec))], name = safeName(a.name || spec.drawingNo || spec.title);
      if (!HTTP_MODE) {
        const cfg = readCfg(); const dir = (a.outDir || cfg.lastDir) && path.resolve(a.outDir || cfg.lastDir);
        if (!dir) throw new Error('저장 폴더가 정해지지 않았습니다. 사용자에게 저장할 폴더를 물어본 뒤 outDir로 넘겨 주세요.');
        ensure(dir); const saved = [];
        for (const f of fmts) { const p = path.join(dir, `${name}.${f}`); if (fs.existsSync(p)) fs.copyFileSync(p, p + '.bak'); fs.writeFileSync(p, files[f]()); saved.push(p); }
        writeCfg({ ...cfg, lastDir: dir }); backup(name, spec);
        addHist({ time: new Date().toISOString(), name, title: spec.title || '', formats: fmts, dir, scale: m.scaleLabel, sheet: m.sheet });
        out.push(text('저장한 파일:\n' + saved.join('\n') + '\nDWG가 필요하면 AutoCAD에서 DXF를 열고 다른 이름으로 저장(DWG)하세요.'));
      }
      if (HTTP_MODE || a.returnContent) for (const f of fmts) out.push({ type: 'resource', resource: { uri: `jdcad://drawing/${name}.${f}`, mimeType: f === 'svg' ? 'image/svg+xml' : f === 'json' ? 'application/json' : 'application/dxf', text: files[f]() } });
      return out;
    }
    case 'jdcad_history': {
      const h = readHist(a.limit || 20), cfg = readCfg();
      let bks = []; try { bks = fs.readdirSync(BK).map(d => `${d} (${fs.readdirSync(path.join(BK, d)).length}개)`); } catch {}
      return [text(`마지막 저장 폴더: ${cfg.lastDir || '(없음)'}\n\n최근 저장:\n${h.map(r => `${r.time}  ${r.name} [${r.formats.join(',')}] ${r.scale} ${r.sheet}  → ${r.dir}`).join('\n') || '(없음)'}\n\n백업: ${bks.join(', ') || '(없음)'}`)];
    }
    case 'jdcad_restore': {
      const d = path.join(BK, safeName(a.name)); const fsx = fs.existsSync(d) ? fs.readdirSync(d).sort() : [];
      if (!fsx.length) throw new Error('백업이 없습니다: ' + a.name);
      const f = a.file && fsx.includes(a.file) ? a.file : fsx[fsx.length - 1];
      return [text(`백업 ${f} (전체 ${fsx.length}개: ${fsx.join(', ')})`), text(fs.readFileSync(path.join(d, f), 'utf8'))];
    }
  }
  throw new Error('알 수 없는 도구: ' + name);
}

// ---------- JSON-RPC / MCP ----------
function handle(msg) {
  const { id, method, params = {} } = msg;
  const ok = result => ({ jsonrpc: '2.0', id, result }), err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
  if (id === undefined) return null; // notification
  try {
    switch (method) {
      case 'initialize': return ok({ protocolVersion: params.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'jdcad', version: VERSION },
        instructions: 'JDCAD: KS 규격 2D 기계·전기 도면을 JSON 사양으로 만들어 AutoCAD 호환 DXF로 출력합니다. 먼저 jdcad_guide를 호출하세요. 저장 전 항상 저장 폴더를 사용자에게 확인하세요.' });
      case 'ping': return ok({});
      case 'tools/list': return ok({ tools: HTTP_MODE ? TOOLS.filter(t => !LOCAL_ONLY.has(t.name)) : TOOLS });
      case 'tools/call': {
        if (HTTP_MODE && LOCAL_ONLY.has(params.name)) return ok({ content: [text('원격 모드에서는 지원하지 않습니다.')], isError: true });
        try { return ok({ content: call(params.name, params.arguments || {}) }); }
        catch (e) { return ok({ content: [text('오류: ' + e.message)], isError: true }); }
      }
      default: return err(-32601, 'Method not found: ' + method);
    }
  } catch (e) { return err(-32603, e.message); }
}

if (HTTP_MODE) {
  const port = +process.argv[process.argv.indexOf('--http') + 1] || +process.env.PORT || 8787;
  const token = process.env.JDCAD_TOKEN || '';
  const mpath = '/mcp' + (process.env.JDCAD_SECRET ? '/' + process.env.JDCAD_SECRET : ''); // claude.ai 커넥터용 비밀 주소
  http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/') { res.end('JDCAD MCP ' + VERSION); return; }
    let up = req.url.split('?')[0]; try { up = decodeURIComponent(up); } catch {} if (up.replace(/\/+$/, '') !== mpath) { res.writeHead(404).end(); return; }
    if (req.method !== 'POST') { res.writeHead(405, { Allow: 'POST' }).end(); return; }
    if (token && req.headers.authorization !== 'Bearer ' + token) { res.writeHead(401).end(); return; }
    let body = ''; req.on('data', c => body += c); req.on('end', () => {
      let m; try { m = JSON.parse(body); } catch { res.writeHead(400).end(); return; }
      const r = Array.isArray(m) ? m.map(handle).filter(Boolean) : handle(m);
      if (!r || (Array.isArray(r) && !r.length)) { res.writeHead(202).end(); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(r));
    });
  }).listen(port, () => console.error(`JDCAD MCP (HTTP) on :${port}${process.env.JDCAD_SECRET ? '/mcp/<secret>' : '/mcp'}`));
} else {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => {
    buf += d; let i;
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (!line) continue;
      let m; try { m = JSON.parse(line); } catch { continue; }
      const r = Array.isArray(m) ? m.map(handle).filter(Boolean) : handle(m);
      if (r && (!Array.isArray(r) || r.length)) process.stdout.write(JSON.stringify(r) + '\n');
    }
  });
}
