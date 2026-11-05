/* JDCAD engine: spec (1:1 model, mm) -> primitives -> auto scale/sheet -> SVG / DXF(R12)
   No external dependencies. */
const JD = (() => {
  const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420], A1: [841, 594], A0: [1189, 841] };
  const SHEET_ORDER = ['A4', 'A3', 'A2', 'A1', 'A0'];
  const SCALES = [[5, 1], [2, 1], [1, 1], [1, 2], [1, 2.5], [1, 5], [1, 10], [1, 20], [1, 25], [1, 50], [1, 100], [1, 200], [1, 500], [1, 1000]];
  // paper line widths (mm), ACI colors, linetypes
  const LAYERS = {
    OUTLINE: { color: 7, lt: 'CONTINUOUS', lw: 0.5, ko: '외형선' },
    HIDDEN: { color: 3, lt: 'HIDDEN', lw: 0.35, ko: '숨은선' },
    CENTER: { color: 1, lt: 'CENTER', lw: 0.18, ko: '중심선' },
    CUT: { color: 1, lt: 'CENTER', lw: 0.18, ko: '절단선' },
    HATCH: { color: 8, lt: 'CONTINUOUS', lw: 0.18, ko: '해칭' },
    DIM: { color: 4, lt: 'CONTINUOUS', lw: 0.18, ko: '치수' },
    TEXT: { color: 2, lt: 'CONTINUOUS', lw: 0.25, ko: '문자' },
    SYMBOL: { color: 6, lt: 'CONTINUOUS', lw: 0.35, ko: '심볼' },
    WIRE: { color: 5, lt: 'CONTINUOUS', lw: 0.35, ko: '배선' },
    BUS: { color: 30, lt: 'CONTINUOUS', lw: 0.7, ko: '모선' },
    PHANTOM: { color: 8, lt: 'PHANTOM', lw: 0.18, ko: '가상선' },
    BORDER: { color: 7, lt: 'CONTINUOUS', lw: 0.7, ko: '도곽' },
    TITLE: { color: 7, lt: 'CONTINUOUS', lw: 0.25, ko: '표제란' },
  };
  const LTYPES = { CONTINUOUS: [], CENTER: [12, -3, 2, -3], HIDDEN: [3, -1.5], PHANTOM: [12, -3, 2, -3, 2, -3] };
  const A = { asz: 3, exo: 1, exe: 2, txt: 3.5, gap: 1, dimoff: 10 };

  // ---------- small math ----------
  const rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
  const add = (a, b) => [a[0] + b[0], a[1] + b[1]], sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
  const mul = (a, k) => [a[0] * k, a[1] * k], len = a => Math.hypot(a[0], a[1]);
  const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l]; };
  const perp = a => [-a[1], a[0]];
  const rot = (p, ang) => { const c = Math.cos(ang), s = Math.sin(ang); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c]; };
  const P = v => Array.isArray(v) ? [Number(v[0]) || 0, Number(v[1]) || 0] : [Number(v.x) || 0, Number(v.y) || 0];
  const fmt = v => { const r = Math.round(v * 100) / 100; return String(Math.abs(r) < 1e-9 ? 0 : r); };
  const tw = (s, h) => { let w = 0; for (const ch of String(s)) w += ch.charCodeAt(0) > 0x2000 ? h * 1.0 : h * 0.62; return w; };

  // bulge polyline -> points
  function tessBulge(pts, closed) {
    const out = []; const n = pts.length;
    for (let i = 0; i < n; i++) {
      const p = pts[i]; out.push([p[0], p[1]]);
      if (!closed && i === n - 1) break;
      const q = pts[(i + 1) % n]; const b = p[2] || 0;
      if (Math.abs(b) > 1e-9) {
        const arc = bulgeArc(p, q, b); const steps = 12;
        for (let k = 1; k < steps; k++) {
          const t = arc.s + (arc.e - arc.s) * k / steps;
          out.push([arc.c[0] + arc.r * Math.cos(t), arc.c[1] + arc.r * Math.sin(t)]);
        }
      }
    }
    return out;
  }
  function bulgeArc(p, q, b) {
    const th = 4 * Math.atan(b); const chord = sub(q, p); const c = len(chord);
    const r = c / (2 * Math.sin(th / 2)); const mid = mul(add(p, q), 0.5);
    const h = r * Math.cos(th / 2); const n = unit(perp(chord));
    const center = add(mid, mul(n, h));
    const s = Math.atan2(p[1] - center[1], p[0] - center[0]);
    return { c: center, r: Math.abs(r), s, e: s + th };
  }

  // ---------- primitive builders ----------
  const prim = {
    line: (a, b, L) => ({ k: 'line', a, b, L }),
    circle: (c, r, L) => ({ k: 'circle', c, r, L }),
    arc: (c, r, s, e, L) => ({ k: 'arc', c, r, s, e, L }), // degrees CCW
    pline: (pts, closed, L, w) => ({ k: 'pline', pts, closed: !!closed, L, w: w || 0 }),
    text: (p, h, s, L, al = 0, va = 0, r = 0) => ({ k: 'text', p, h, s: String(s), L, al, va, r }),
    solid: (pts, L) => ({ k: 'solid', pts, L }),
  };

  function arrow(tip, dir, S, L) { // dir: unit vector from tip toward tail
    const l = A.asz * S, w = l / 6; const n = perp(dir);
    const base = add(tip, mul(dir, l));
    return prim.solid([tip, add(base, mul(n, w)), add(base, mul(n, -w))], L);
  }

  function textUpright(angDeg) { let a = ((angDeg % 360) + 360) % 360; if (a > 90.5 && a <= 270.5) a -= 180; return a; }

  // ---------- dimensions ----------
  function dimLinear(e, S) {
    const p1 = P(e.p1), p2 = P(e.p2); const kind = e.kind || 'h';
    const off = (e.offset ?? A.dimoff) * S; let q1, q2, dir, meas, ang;
    if (kind === 'h') {
      const yd = off >= 0 ? Math.max(p1[1], p2[1]) + off : Math.min(p1[1], p2[1]) + off;
      q1 = [p1[0], yd]; q2 = [p2[0], yd]; meas = Math.abs(p2[0] - p1[0]); ang = 0;
    } else if (kind === 'v') {
      const xd = off >= 0 ? Math.max(p1[0], p2[0]) + off : Math.min(p1[0], p2[0]) + off;
      q1 = [xd, p1[1]]; q2 = [xd, p2[1]]; meas = Math.abs(p2[1] - p1[1]); ang = 90;
    } else {
      const u = unit(sub(p2, p1)); const n = perp(u);
      q1 = add(p1, mul(n, off)); q2 = add(p2, mul(n, off)); meas = len(sub(p2, p1)); ang = deg(Math.atan2(u[1], u[0]));
    }
    const items = []; const L = 'DIM';
    // extension lines
    for (const [p, q] of [[p1, q1], [p2, q2]]) {
      const v = sub(q, p); const l = len(v); if (l < 1e-9) continue; const u = unit(v);
      items.push(prim.line(add(p, mul(u, A.exo * S)), add(q, mul(u, A.exe * S)), L));
    }
    const u = unit(sub(q2, q1)); const span = len(sub(q2, q1));
    const label = (e.prefix || '') + (e.text ?? fmt(meas)) + (e.suffix || '');
    const h = A.txt * S; const twid = tw(label, h);
    const inside = span >= 2 * A.asz * S + 1 * S;
    if (inside) {
      items.push(prim.line(q1, q2, L));
      items.push(arrow(q1, u, S, L), arrow(q2, mul(u, -1), S, L));
    } else {
      const ext = 2 * A.asz * S;
      items.push(prim.line(sub(q1, mul(u, ext)), add(q2, mul(u, ext)), L));
      items.push(arrow(q1, mul(u, -1), S, L), arrow(q2, u, S, L));
    }
    const ta = textUpright(ang); const up = rot([0, 1], rad(ta));
    let mid = mul(add(q1, q2), 0.5);
    if (!inside && twid > span) mid = add(q2, mul(u, 2 * A.asz * S + twid / 2 + S));
    const tp = add(mid, mul(up, A.gap * S));
    items.push(prim.text(tp, h, label, L, 1, 0, ta));
    return { k: 'dim', L, items, dxf: { type: kind === 'aligned' ? 1 : 0, def: q2, mid: tp, p1, p2, ang: kind === 'aligned' ? 0 : ang, text: e.text != null || e.prefix || e.suffix ? label : '' } };
  }

  function dimAngular(e, S) {
    const c = P(e.c || [e.cx, e.cy]); const a1 = Number(e.a1), a2 = Number(e.a2); const r = Number(e.r);
    let sw = ((a2 - a1) % 360 + 360) % 360; if (sw < 1e-9) sw = 360; const L = 'DIM'; const items = [];
    const pa = a => add(c, [r * Math.cos(rad(a)), r * Math.sin(rad(a))]);
    items.push(prim.arc(c, r, a1, a1 + sw, L));
    const t1 = [-Math.sin(rad(a1)), Math.cos(rad(a1))], t2 = [Math.sin(rad(a1 + sw)), -Math.cos(rad(a1 + sw))];
    items.push(arrow(pa(a1), t1, S, L), arrow(pa(a1 + sw), t2, S, L));
    for (const [a, ref] of [[a1, e.r1], [a1 + sw, e.r2]]) { if (ref == null) continue; const from = Math.min(Number(ref), r), to = r + A.exe * S;
      if (Number(ref) < r - A.exo * S) items.push(prim.line(pa(a).map((v, i) => c[i] + (v - c[i]) * (Number(ref) + A.exo * S) / r), add(c, [to * Math.cos(rad(a)), to * Math.sin(rad(a))]), L)); }
    const label = (e.prefix || '') + (e.text ?? (fmt(sw) + '°')) + (e.suffix || '');
    const am = a1 + sw / 2; const ta = textUpright(am - 90); const up = rot([0, 1], rad(ta));
    const tp = add(pa(am), mul(up, A.gap * S)); items.push(prim.text(tp, A.txt * S, label, L, 1, 0, ta));
    return { k: 'dim', L, items, dxf: { type: 5, def: pa(am), mid: tp, p13: pa(a1), p14: pa(a1 + sw), p15: c, text: (e.text != null || e.prefix || e.suffix) ? label : '' } };
  }
  function dimRadial(e, S, dia) {
    const c = P(e.c || [e.cx, e.cy]); const r = Number(e.r); const a = rad(e.angle ?? 45);
    const u = [Math.cos(a), Math.sin(a)]; const L = 'DIM'; const items = [];
    const label = (e.prefix || '') + (e.text ?? ((dia ? 'Ø' : 'R') + fmt(dia ? 2 * r : r))) + (e.suffix || '');
    const h = A.txt * S; const twid = tw(label, h);
    const B = add(c, mul(u, r)); const Aa = dia ? add(c, mul(u, -r)) : c;
    const tail = add(B, mul(u, twid + 2 * S));
    items.push(prim.line(Aa, tail, L));
    items.push(arrow(B, mul(u, -1), S, L));
    if (dia) items.push(arrow(Aa, u, S, L));
    const ta = textUpright(deg(a)); const up = rot([0, 1], rad(ta));
    const tp = add(add(B, mul(u, twid / 2 + S)), mul(up, A.gap * S));
    items.push(prim.text(tp, h, label, L, 1, 0, ta));
    return { k: 'dim', L, items, dxf: { type: dia ? 3 : 4, def: dia ? Aa : c, p15: B, mid: tp, text: (e.text != null || e.prefix || e.suffix) ? label : '' } };
  }

  // ---------- hatch (scanline clip, even-odd) ----------
  function hatch(e, S) {
    const loops = (e.loops || [e.points]).filter(Boolean).map(l => tessBulge(l.map(p => [Number(p[0]), Number(p[1]), Number(p[2] || 0)]), true));
    const pat = (e.pattern || 'ANSI31').toUpperCase();
    const sp = (e.spacing ?? 2.5) * S; const base = e.angle ?? 45;
    const angles = pat === 'ANSI37' ? [base, base + 90] : [base];
    const items = [];
    for (const ag of angles) {
      const ar = rad(ag); const R = loops.map(l => l.map(p => rot(p, -ar)));
      let ymin = Infinity, ymax = -Infinity; R.forEach(l => l.forEach(p => { ymin = Math.min(ymin, p[1]); ymax = Math.max(ymax, p[1]); }));
      for (let y = Math.ceil(ymin / sp) * sp; y <= ymax; y += sp) {
        const xs = [];
        for (const l of R) for (let i = 0; i < l.length; i++) {
          const p = l[i], q = l[(i + 1) % l.length];
          if ((p[1] <= y && q[1] > y) || (q[1] <= y && p[1] > y)) xs.push(p[0] + (y - p[1]) * (q[0] - p[0]) / (q[1] - p[1]));
        }
        xs.sort((a, b) => a - b);
        for (let i = 0; i + 1 < xs.length; i += 2) items.push(prim.line(rot([xs[i], y], ar), rot([xs[i + 1], y], ar), 'HATCH'));
      }
    }
    return { k: 'block', L: 'HATCH', kind: 'hatch', items };
  }

  // ---------- electrical symbols (paper-mm local coords, 0..12 along +y) ----------
  function symbol(e, S) {
    const z = (e.size || 1) * S; const ang = rad(e.angle || 0); const o = P([e.x, e.y]);
    const T = p => add(o, rot(mul(p, z), ang)); const L = 'SYMBOL'; const it = [];
    const ln = (a, b) => it.push(prim.line(T(a), T(b), L));
    const ci = (c, r) => it.push(prim.circle(T(c), r * z, L));
    const tx = (p, s, h = 3) => it.push(prim.text(T(p), h * z, s, L, 1, 2, 0));
    switch ((e.name || '').toLowerCase()) {
      case 'breaker': case 'mccb': case 'acb':
        ln([0, 0], [0, 3]); ln([0, 3], [-3.5, 9]); ln([0, 9], [0, 12]); ln([-1, 8], [1, 10]); ln([-1, 10], [1, 8]); break;
      case 'switch': ln([0, 0], [0, 3]); ln([0, 3], [-3.5, 9]); ln([0, 9], [0, 12]); break;
      case 'fuse': ln([0, 0], [0, 12]); it.push(prim.pline([T([-1.2, 3]), T([1.2, 3]), T([1.2, 9]), T([-1.2, 9])], true, L)); break;
      case 'transformer': case 'tr': ln([0, 0], [0, 1]); ci([0, 4], 3); ci([0, 8], 3); ln([0, 11], [0, 12]); break;
      case 'motor': ln([0, 0], [0, 2]); ci([0, 6], 4); tx([0, 6], 'M', 3.5); ln([0, 10], [0, 12]); break;
      case 'lamp': case 'load': ln([0, 0], [0, 3]); ci([0, 6], 3); ln([-2.1, 3.9], [2.1, 8.1]); ln([-2.1, 8.1], [2.1, 3.9]); ln([0, 9], [0, 12]); break;
      case 'meter': ln([0, 0], [0, 2]); ci([0, 6], 4); tx([0, 6], e.text || 'kWh', 2.2); ln([0, 10], [0, 12]); break;
      case 'ct': ln([0, 0], [0, 12]); ci([0, 6], 2.5); break;
      case 'ground': case 'earth': ln([0, 12], [0, 6]); ln([-4, 6], [4, 6]); ln([-2.6, 4.5], [2.6, 4.5]); ln([-1.2, 3], [1.2, 3]); break;
      case 'contact': case 'no': ln([0, 0], [0, 4]); ln([0, 4], [-2.5, 8.5]); ln([0, 8], [0, 12]); break;
      case 'nc': ln([0, 0], [0, 4]); ln([0, 4], [2.5, 8.5]); ln([0, 8], [0, 12]); ln([0, 8], [3, 8]); break;
      case 'coil': ln([0, 0], [0, 3]); it.push(prim.pline([T([-3, 3]), T([3, 3]), T([3, 9]), T([-3, 9])], true, L)); ln([0, 9], [0, 12]); if (e.text) tx([0, 6], e.text, 2.5); break;
      default: it.push(prim.pline([T([-3, 0]), T([3, 0]), T([3, 12]), T([-3, 12])], true, L)); tx([0, 6], e.name || '?', 2.5);
    }
    if (e.label) {
      const lines = String(e.label).split('\n');
      lines.forEach((s, i) => it.push(prim.text(T([6, 7 - i * 4]), 2.5 * z, s, 'TEXT', 0, 2, 0)));
    }
    return it;
  }

  // ---------- spec entities -> model primitives at scale S ----------
  function layerOf(e, def) { const L = String(e.layer || def).toUpperCase(); return L; }

  function buildModel(spec, S) {
    const out = []; const warn = [];
    (spec.entities || []).forEach((e, idx) => {
      const start = out.length;
      try {
        const t = (e.type || '').toLowerCase();
        if (t === 'line') out.push(prim.line(P(e.p1 || [e.x1, e.y1]), P(e.p2 || [e.x2, e.y2]), layerOf(e, 'OUTLINE')));
        else if (t === 'circle') out.push(prim.circle(P(e.c || [e.cx, e.cy]), Number(e.r), layerOf(e, 'OUTLINE')));
        else if (t === 'arc') out.push(prim.arc(P(e.c || [e.cx, e.cy]), Number(e.r), Number(e.start), Number(e.end), layerOf(e, 'OUTLINE')));
        else if (t === 'polyline') out.push(prim.pline((e.points || []).map(p => [Number(p[0]), Number(p[1]), Number(p[2] || 0)]), e.closed, layerOf(e, 'OUTLINE')));
        else if (t === 'rect') {
          const x = Number(e.x), y = Number(e.y), w = Number(e.w), h = Number(e.h), r = Math.min(Number(e.r || 0), w / 2, h / 2);
          const b = r > 0 ? Math.tan(Math.PI / 8) : 0;
          const pts = r > 0 ? [[x + r, y, 0], [x + w - r, y, b], [x + w, y + r, 0], [x + w, y + h - r, b], [x + w - r, y + h, 0], [x + r, y + h, b], [x, y + h - r, 0], [x, y + r, b]]
            : [[x, y, 0], [x + w, y, 0], [x + w, y + h, 0], [x, y + h, 0]];
          out.push(prim.pline(pts, true, layerOf(e, 'OUTLINE')));
        } else if (t === 'centermark') {
          const c = P(e.c || [e.cx, e.cy]); const ext = Number(e.r || 0) + (e.ext ?? 3) * S; const L = layerOf(e, 'CENTER');
          const a = rad(e.angle || 0); const u = [Math.cos(a), Math.sin(a)], v = perp(u);
          out.push(prim.line(sub(c, mul(u, ext)), add(c, mul(u, ext)), L));
          if (!e.single) out.push(prim.line(sub(c, mul(v, ext)), add(c, mul(v, ext)), L));
        } else if (t === 'hatch') out.push(hatch(e, S));
        else if (t === 'text') out.push(prim.text(P(e.p || [e.x, e.y]), (e.height ?? 3.5) * S, e.text ?? '', layerOf(e, 'TEXT'), { left: 0, center: 1, right: 2 }[e.align] ?? 0, 0, Number(e.angle || 0)));
        else if (t === 'view') {
          const p = P(e.p || [e.x, e.y]);
          out.push(prim.text(p, 5 * S, e.label ?? e.text ?? '', 'TEXT', 1, 0, 0));
          if (e.scale) out.push(prim.text(add(p, [0, -5 * S]), 3.5 * S, '(' + e.scale + ')', 'TEXT', 1, 0, 0));
        } else if (t === 'dim') {
          const kind = (e.kind || 'h').toLowerCase();
          if (kind === 'angular') out.push(dimAngular(e, S));
          else if (kind === 'radius') out.push(dimRadial(e, S, false));
          else if (kind === 'diameter') out.push(dimRadial(e, S, true));
          else out.push(dimLinear({ ...e, kind }, S));
        } else if (t === 'section') {
          const p1 = P(e.p1), p2 = P(e.p2); const u = unit(sub(p2, p1)); const L = 'CUT';
          let d = e.dir; if (typeof d === 'string') d = { up: [0, 1], down: [0, -1], left: [-1, 0], right: [1, 0] }[d] || [0, 1];
          d = unit(P(d || perp(u)));
          out.push(prim.line(p1, p2, L));
          const th = 0.7 * S, tl = 8 * S;
          out.push(prim.pline([[...p1, 0], [...add(p1, mul(u, tl)), 0]], false, 'OUTLINE', th));
          out.push(prim.pline([[...sub(p2, mul(u, tl)), 0], [...p2, 0]], false, 'OUTLINE', th));
          for (const end of [p1, p2]) {
            const tip = add(end, mul(d, 8 * S));
            out.push(prim.line(end, tip, 'OUTLINE'));
            out.push({ k: 'solid', L: 'OUTLINE', pts: [tip, add(sub(tip, mul(d, 4 * S)), mul(perp(d), 1.2 * S)), add(sub(tip, mul(d, 4 * S)), mul(perp(d), -1.2 * S))] });
            const lp = add(add(end, mul(d, 4 * S)), mul(end === p1 ? u : mul(u, -1), -6 * S));
            out.push(prim.text(lp, 5 * S, e.label || 'A', 'TEXT', 1, 2, 0));
          }
        } else if (t === 'balloon') {
          const c = P([e.x, e.y]), tgt = P([e.tx, e.ty]); const r = 5 * S;
          const u = unit(sub(tgt, c));
          out.push(prim.circle(c, r, 'DIM'));
          out.push(prim.text(c, 4 * S, e.n ?? e.text ?? '', 'DIM', 1, 2, 0));
          out.push(prim.line(add(c, mul(u, r)), tgt, 'DIM'));
          out.push(prim.circle(tgt, 0.6 * S, 'DIM'));
        } else if (t === 'symbol') out.push(...symbol(e, S));
        else if (t === 'leader') {
          const tgt = P([e.tx, e.ty]), p = P([e.x, e.y]); const h = 3.5 * S; const s = e.text || '';
          const right = p[0] >= tgt[0]; const shelf = tw(s, h) + 2 * S;
          const end = add(p, [right ? shelf : -shelf, 0]);
          out.push(prim.line(tgt, p, 'DIM'), prim.line(p, end, 'DIM'), arrow(tgt, unit(sub(p, tgt)), S, 'DIM'));
          out.push(prim.text(add(mul(add(p, end), 0.5), [0, A.gap * S]), h, s, 'DIM', 1, 0, 0));
        } else warn.push('알 수 없는 요소: ' + t);
      } catch (err) { warn.push('요소 처리 오류(' + (e.type || '?') + '): ' + err.message); }
      for (let k = start; k < out.length; k++) out[k].src = idx;
    });
    return { prims: out, warn };
  }

  // ---------- bbox ----------
  function bboxOf(prims) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const ext = p => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); };
    const walk = list => { for (const p of list) {
      if (p.k === 'line') { ext(p.a); ext(p.b); }
      else if (p.k === 'circle' || p.k === 'arc') { ext([p.c[0] - p.r, p.c[1] - p.r]); ext([p.c[0] + p.r, p.c[1] + p.r]); }
      else if (p.k === 'pline') tessBulge(p.pts, p.closed).forEach(ext);
      else if (p.k === 'solid') p.pts.forEach(ext);
      else if (p.k === 'text') { const w = tw(p.s, p.h); const x0 = p.al === 1 ? -w / 2 : p.al === 2 ? -w : 0; const y0 = p.va === 2 ? -p.h / 2 : 0;
        [[x0, y0], [x0 + w, y0], [x0, y0 + p.h], [x0 + w, y0 + p.h]].forEach(q => ext(add(p.p, rot(q, rad(p.r))))); }
      else if (p.items) walk(p.items);
    } };
    walk(prims); return b;
  }

  // ---------- sheet (paper coords) ----------
  function tableBlocks(spec) {
    const W = 140, rh = 7; const blocks = [];
    for (const t of spec.tables || []) {
      const cols = (t.columns || []).map(c => typeof c === 'string' ? { name: c } : c);
      const tot = cols.reduce((s, c) => s + (c.w || 1), 0);
      const widths = cols.map(c => (c.w || 1) / tot * W);
      blocks.push({ t, cols, widths, h: rh * ((t.rows || []).length + 1 + (t.title ? 1 : 0)) });
    }
    return blocks;
  }
  const TB_H = 34;

  function drawSheet(spec, sheetName, scaleLabel) {
    const [W, H] = SHEETS[sheetName]; const m = (sheetName === 'A0' || sheetName === 'A1') ? 20 : 10;
    const it = []; const B = 'BORDER', T = 'TITLE';
    it.push(prim.pline([[0, 0, 0], [W, 0, 0], [W, H, 0], [0, H, 0]], true, T));
    it.push(prim.pline([[m, m, 0], [W - m, m, 0], [W - m, H - m, 0], [m, H - m, 0]], true, B));
    // centering marks (KS)
    it.push(prim.line([W / 2, 0], [W / 2, m + 5], B), prim.line([W / 2, H], [W / 2, H - m - 5], B), prim.line([0, H / 2], [m + 5, H / 2], B), prim.line([W, H / 2], [W - m - 5, H / 2], B));
    // title block
    const x0 = W - m - 140, y0 = m; const tbw = 140;
    const rows = [10, 8, 8, 8]; const cw = [18, 52, 18, 52];
    it.push(prim.pline([[x0, y0, 0], [x0 + tbw, y0, 0], [x0 + tbw, y0 + TB_H, 0], [x0, y0 + TB_H, 0]], true, B));
    let y = y0 + TB_H; const ry = [];
    for (const h of rows) { ry.push([y - h, y]); y -= h; if (y > y0) it.push(prim.line([x0, y], [x0 + tbw, y], T)); }
    // vertical lines: row0: 18 | rest ; rows1-3: 18|52|18|52
    it.push(prim.line([x0 + 18, y0], [x0 + 18, y0 + TB_H], T));
    it.push(prim.line([x0 + 70, y0], [x0 + 70, y0 + 24], T), prim.line([x0 + 88, y0], [x0 + 88, y0 + 24], T));
    const lab = (cx, r, s) => it.push(prim.text([cx, (ry[r][0] + ry[r][1]) / 2], 2.5, s, T, 1, 2, 0));
    const val = (cx, r, s, h = 3.2) => it.push(prim.text([cx, (ry[r][0] + ry[r][1]) / 2], h, s, 'TEXT', 1, 2, 0));
    lab(x0 + 9, 0, '도 명'); val(x0 + 18 + 61, 0, spec.title || '제목 없음', 5);
    lab(x0 + 9, 1, '도 번'); val(x0 + 44, 1, spec.drawingNo || '-'); lab(x0 + 79, 1, '척 도'); val(x0 + 114, 1, scaleLabel);
    lab(x0 + 9, 2, '재 질'); val(x0 + 44, 2, spec.material || '-'); lab(x0 + 79, 2, '투상법');
    // third-angle symbol
    { const cx = x0 + 106, cy = (ry[2][0] + ry[2][1]) / 2;
      it.push(prim.pline([[cx - 7, cy - 2.5, 0], [cx - 1, cy - 1.5, 0], [cx - 1, cy + 1.5, 0], [cx - 7, cy + 2.5, 0]], true, T));
      it.push(prim.circle([cx + 6, cy], 2.5, T), prim.circle([cx + 6, cy], 1.5, T));
      it.push(prim.text([cx + 16, cy], 2.5, '3각법', T, 1, 2, 0)); }
    lab(x0 + 9, 3, '작 성'); val(x0 + 44, 3, spec.author || '-'); lab(x0 + 79, 3, '일 자'); val(x0 + 114, 3, spec.date || new Date().toISOString().slice(0, 10));
    // tables stacked above title block
    let ty = y0 + TB_H;
    for (const b of tableBlocks(spec)) {
      const rh = 7; const n = (b.t.rows || []).length; const top = ty + b.h;
      it.push(prim.pline([[x0, ty, 0], [x0 + tbw, ty, 0], [x0 + tbw, top, 0], [x0, top, 0]], true, B));
      let yy = top;
      if (b.t.title) { yy -= rh; it.push(prim.line([x0, yy], [x0 + tbw, yy], T)); it.push(prim.text([x0 + tbw / 2, yy + rh / 2], 3.2, b.t.title, 'TEXT', 1, 2, 0)); }
      const hdrTop = yy; yy -= rh; it.push(prim.line([x0, yy], [x0 + tbw, yy], T));
      let xx = x0; b.cols.forEach((c, i) => { it.push(prim.text([xx + b.widths[i] / 2, yy + rh / 2], 2.5, c.name, T, 1, 2, 0)); xx += b.widths[i]; if (i < b.cols.length - 1) it.push(prim.line([xx, ty], [xx, hdrTop], T)); });
      (b.t.rows || []).forEach((r, ri) => {
        const ybot = yy - rh; if (ri < n - 1) it.push(prim.line([x0, ybot], [x0 + tbw, ybot], T));
        let cx = x0; r.forEach((v, ci) => { if (ci < b.widths.length) { it.push(prim.text([cx + b.widths[ci] / 2, ybot + rh / 2], 2.5, v ?? '', 'TEXT', 1, 2, 0)); cx += b.widths[ci]; } });
        yy = ybot;
      });
      ty = top;
    }
    if (spec.notes && spec.notes.length) {
      const nx = m + 8; let ny = m + 6 + (spec.notes.length) * 5;
      it.push(prim.text([nx, ny + 2], 3.5, '주 기', 'TEXT', 0, 0, 0));
      spec.notes.forEach((s, i) => it.push(prim.text([nx, ny - 5 - i * 5 + 2], 3, (i + 1) + '. ' + s, 'TEXT', 0, 0, 0)));
    }
    return { items: it, W, H, m, tbTop: ty, x0 };
  }

  function sheetAvail(spec, sheetName) {
    const [W, H] = SHEETS[sheetName]; const m = (sheetName === 'A0' || sheetName === 'A1') ? 20 : 10; const pad = 12;
    const stack = TB_H + tableBlocks(spec).reduce((s, b) => s + b.h, 0);
    const notesH = spec.notes && spec.notes.length ? spec.notes.length * 5 + 12 : 0;
    const iw = W - 2 * m - 2 * pad, ih = H - 2 * m - 2 * pad;
    // option 1: content above title stack & notes; option 2: content left of the 140 column
    return [
      { x: m + pad, y: m + pad + Math.max(stack, notesH), w: iw, h: ih - Math.max(stack, notesH) },
      { x: m + pad, y: m + pad + notesH, w: iw - 140 - pad, h: ih - notesH },
    ].filter(r => r.w > 20 && r.h > 20);
  }

  const scaleLabelOf = s => s[0] + ':' + s[1];
  const factorOf = s => s[1] / s[0]; // model units per paper mm
  function parseScale(str) { const m = String(str).match(/^\s*(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)\s*$/); return m ? [Number(m[1]), Number(m[2])] : null; }

  const fin = b => b.every(Number.isFinite) ? b : [0, 0, 0, 0];
  // ---------- main build ----------
  function build(spec, opts = {}) {
    const fixedScale = spec.scale && spec.scale !== 'auto' ? parseScale(spec.scale) : null;
    const fixedSheet = spec.sheet && spec.sheet !== 'auto' && SHEETS[spec.sheet] ? spec.sheet : null;
    const maxSheet = SHEETS[spec.maxSheet] ? spec.maxSheet : (opts.maxSheet || 'A1');
    const scales = fixedScale ? [fixedScale] : SCALES;
    const sheets = fixedSheet ? [fixedSheet] : SHEET_ORDER.slice(0, SHEET_ORDER.indexOf(maxSheet) + 1);
    // geometry-only extent for enlargement decision
    const g = bboxOf(buildModel({ ...spec, entities: (spec.entities || []).filter(e => !['dim', 'text', 'view', 'balloon', 'leader'].includes((e.type || '').toLowerCase())) }, 1).prims);
    const gsize = Number.isFinite(g[0]) ? Math.max(g[2] - g[0], g[3] - g[1]) : 0;
    let pick = null;
    for (const sc of scales) {
      if (!fixedScale && sc[0] > 1 && gsize > 60) continue; // enlarge only small parts
      const S = factorOf(sc); const mdl = buildModel(spec, S); const bb = fin(bboxOf(mdl.prims));
      const cw = (bb[2] - bb[0]) / S, ch = (bb[3] - bb[1]) / S;
      for (const sh of sheets) {
        const rect = sheetAvail(spec, sh).find(r => cw <= r.w && ch <= r.h);
        if (rect) { pick = { sc, S, sh, rect, mdl, bb, cw, ch }; break; }
      }
      if (pick) break;
    }
    const warn = [];
    if (!pick) { // fallback: largest sheet, smallest scale
      const sc = fixedScale || SCALES[SCALES.length - 1]; const S = factorOf(sc); const sh = fixedSheet || maxSheet;
      const mdl = buildModel(spec, S); const bb = fin(bboxOf(mdl.prims));
      pick = { sc, S, sh, rect: sheetAvail(spec, sh)[0], mdl, bb, cw: (bb[2] - bb[0]) / S, ch: (bb[3] - bb[1]) / S };
      warn.push(`도면이 ${sh} 용지의 작도 영역에 들어가지 않습니다. 축척이나 용지를 바꿔 주세요.`);
    }
    const { sc, S, sh, rect, mdl, bb } = pick;
    // place sheet: content centre -> rect centre
    const ccx = (bb[0] + bb[2]) / 2, ccy = (bb[1] + bb[3]) / 2;
    const ox = ccx - (rect.x + rect.w / 2) * S, oy = ccy - (rect.y + rect.h / 2) * S;
    const sheet = drawSheet(spec, sh, scaleLabelOf(sc));
    const toModel = p => [ox + p[0] * S, oy + p[1] * S];
    const tr = q => {
      const c = { ...q };
      if (q.k === 'line') { c.a = toModel(q.a); c.b = toModel(q.b); }
      else if (q.k === 'circle' || q.k === 'arc') { c.c = toModel(q.c); c.r = q.r * S; }
      else if (q.k === 'pline') { c.pts = q.pts.map(p => [...toModel(p), p[2] || 0]); c.w = (q.w || 0) * S; }
      else if (q.k === 'text') { c.p = toModel(q.p); c.h = q.h * S; }
      else if (q.k === 'solid') c.pts = q.pts.map(toModel);
      return c;
    };
    const sheetPrims = sheet.items.map(tr);
    const all = [...mdl.prims, ...sheetPrims];
    const checks = manufacturingChecks(spec);
    return {
      prims: all, S, scale: sc, scaleLabel: scaleLabelOf(sc), sheet: sh,
      sheetRect: [ox, oy, ox + sheet.W * S, oy + sheet.H * S], warn: [...mdl.warn, ...warn], checks,
    };
  }

  // ---------- manufacturability checks (mechanical, plate-type) ----------
  function manufacturingChecks(spec) {
    const out = []; const ents = spec.entities || [];
    const outl = ents.filter(e => (e.type === 'rect') && (e.layer || 'OUTLINE').toUpperCase() === 'OUTLINE');
    const holes = ents.filter(e => e.type === 'circle' && (e.layer || 'OUTLINE').toUpperCase() === 'OUTLINE');
    const t = Number(spec.thickness || 0);
    for (const h of holes) {
      const c = P(h.c || [h.cx, h.cy]); const r = Number(h.r);
      for (const R of outl) {
        const x = Number(R.x), y = Number(R.y), w = Number(R.w), hh = Number(R.h);
        if (c[0] < x || c[0] > x + w || c[1] < y || c[1] > y + hh) continue;
        const edge = Math.min(c[0] - x, x + w - c[0], c[1] - y, y + hh - c[1]) - r;
        if (edge < Math.max(r * 2 * 0.5, t || 0) - 1e-6) out.push({ lvl: 'warn', msg: `Ø${fmt(2 * r)} 구멍(${fmt(c[0])}, ${fmt(c[1])})의 가장자리 거리 ${fmt(edge)}mm: 구멍 지름의 0.5배 또는 판 두께 이상을 권장합니다.` });
      }
      if (t && 2 * r < t * 0.8) out.push({ lvl: 'info', msg: `Ø${fmt(2 * r)} 구멍은 판 두께 ${t}mm보다 작습니다. 펀칭은 어렵고 드릴 가공이 필요합니다.` });
    }
    for (let i = 0; i < holes.length; i++) for (let j = i + 1; j < holes.length; j++) {
      const a = holes[i], b = holes[j]; const d = len(sub(P(a.c || [a.cx, a.cy]), P(b.c || [b.cx, b.cy]))) - a.r - b.r;
      if (d >= 0 && d < Math.max(2, t || 0)) out.push({ lvl: 'warn', msg: `구멍 사이 살두께 ${fmt(d)}mm가 얇습니다(권장: 판 두께 이상, 최소 2mm).` });
    }
    for (const R of outl) if (R.r != null && Number(R.r) > 0 && Number(R.r) < 0.5) out.push({ lvl: 'info', msg: `모서리 R${R.r}는 공구 반경보다 작을 수 있습니다.` });
    return out;
  }

  // ---------- SVG renderer ----------
  let ACI = { 1: '#d22b2b', 2: '#a07a00', 3: '#1f8a3b', 4: '#0b84a0', 5: '#2453c7', 6: '#a3309a', 7: 'currentColor', 8: '#7c7f86', 30: '#cc6a00' };
  const ACI_LIGHT = ACI, ACI_DARK = { 1: '#ff4d4d', 2: '#ffe14d', 3: '#4dff6a', 4: '#4de6ff', 5: '#5c8cff', 6: '#ff5cf0', 7: 'currentColor', 8: '#9aa0a6', 30: '#ff9f40' };
  function palette(dark) { ACI = dark ? ACI_DARK : ACI_LIGHT; }
  function aciHex(c, dark) { return (dark ? ACI_DARK : ACI_LIGHT)[c]; }
  function toSVG(model, o = {}) {
    const S = model.S; const r = model.sheetRect; const hidden = o.hidden || {}; const mono = !!o.mono;
    const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
    const col = L => o.color ? o.color : mono ? (o.ink || '#111') : ((ACI[(LAYERS[L] || LAYERS.OUTLINE).color] || 'currentColor'));
    const wmul = o.wmul || 1;
    const sty = (L, extraW) => { const d = LAYERS[L] || LAYERS.OUTLINE; const w = (extraW || d.lw * S) * wmul; const pat = LTYPES[d.lt] || [];
      return `stroke="${col(L)}" stroke-width="${w.toFixed(4)}" fill="none"${pat.length ? ` stroke-dasharray="${pat.map(v => Math.max(Math.abs(v) * S, 0.05 * S).toFixed(3)).join(' ')}"` : ''} stroke-linecap="round"`; };
    const parts = [];
    const emit = (p, L) => {
      L = L || p.L; if (hidden[L]) return;
      if (o.textOnly && p.k !== 'text' && !p.items) return; if (o.noText && p.k === 'text') return;
      if (p.k === 'line') parts.push(`<line x1="${p.a[0]}" y1="${p.a[1]}" x2="${p.b[0]}" y2="${p.b[1]}" ${sty(L)}/>`);
      else if (p.k === 'circle') parts.push(`<circle cx="${p.c[0]}" cy="${p.c[1]}" r="${p.r}" ${sty(L)}/>`);
      else if (p.k === 'arc') { const s = rad(p.s), e = rad(p.e); let sw = e - s; while (sw <= 0) sw += 2 * Math.PI;
        const a = [p.c[0] + p.r * Math.cos(s), p.c[1] + p.r * Math.sin(s)], b = [p.c[0] + p.r * Math.cos(e), p.c[1] + p.r * Math.sin(e)];
        parts.push(`<path d="M${a[0]} ${a[1]}A${p.r} ${p.r} 0 ${sw > Math.PI ? 1 : 0} 1 ${b[0]} ${b[1]}" ${sty(L)}/>`); }
      else if (p.k === 'pline') { const pts = tessBulge(p.pts, p.closed); parts.push(`<path d="M${pts.map(q => q[0].toFixed(4) + ' ' + q[1].toFixed(4)).join('L')}${p.closed ? 'Z' : ''}" ${sty(L, p.w || 0)}${p.w ? ' stroke-linecap="butt"' : ''}/>`); }
      else if (p.k === 'solid') parts.push(`<path d="M${p.pts.map(q => q[0] + ' ' + q[1]).join('L')}Z" fill="${col(L)}"/>`);
      else if (p.k === 'text') {
        const anchor = ['start', 'middle', 'end'][p.al] || 'start'; const base = p.va === 2 ? 'central' : 'alphabetic';
        parts.push(`<text transform="translate(${p.p[0]} ${p.p[1]}) scale(1 -1) rotate(${-p.r})" font-size="${p.h * 1.0}" text-anchor="${anchor}" dominant-baseline="${base}" fill="${col(L)}" font-family="'IBM Plex Sans KR','Malgun Gothic',sans-serif">${esc(p.s)}</text>`); }
      else if (p.items) p.items.forEach(q => emit(q, p.L));
    };
    const only = o.only; const over = o.color;
    
    model.prims.forEach(p => { if (only && !only.has(p.src)) return; emit(p); });
    if (o.partsOnly) return parts.join('');
    const w = r[2] - r[0], h = r[3] - r[1];
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${r[0]} ${-r[3]} ${w} ${h}" width="${o.pxW || w / S}mm" height="${o.pxH || h / S}mm">` +
      `${o.bg ? `<rect x="${r[0]}" y="${-r[3]}" width="${w}" height="${h}" fill="${o.bg}"/>` : ''}<g transform="scale(1 -1)" style="color:${o.ink || '#111'}">${parts.join('')}</g></svg>`;
  }

  // ---------- DXF R12 writer ----------
  function dxfText(s) {
    return String(s).replace(/Ø|⌀/g, '%%c').replace(/°/g, '%%d').replace(/±/g, '%%p')
      .replace(/[^\x20-\x7e]/g, ch => '\\U+' + ch.charCodeAt(0).toString(16).padStart(4, '0'));
  }
  const n6 = v => { const s = (Math.round(v * 1e6) / 1e6).toString(); return s === '-0' ? '0' : s; };
  function toDXF(model, spec) {
    const S = model.S; const o = []; const g = (c, v) => { o.push(String(c).padStart(3, ' ')); o.push(String(v)); };
    const xy = (c, p) => { g(10 + c, n6(p[0])); g(20 + c, n6(p[1])); g(30 + c, 0); };
    const r = model.sheetRect;
    // header
    g(0, 'SECTION'); g(2, 'HEADER');
    const hv = (name, code, v) => { g(9, name); g(code, v); };
    hv('$ACADVER', 1, 'AC1009'); g(9, '$INSBASE'); g(10, 0); g(20, 0); g(30, 0);
    g(9, '$EXTMIN'); g(10, n6(r[0])); g(20, n6(r[1])); g(30, 0); g(9, '$EXTMAX'); g(10, n6(r[2])); g(20, n6(r[3])); g(30, 0);
    g(9, '$LIMMIN'); g(10, n6(r[0])); g(20, n6(r[1])); g(9, '$LIMMAX'); g(10, n6(r[2])); g(20, n6(r[3]));
    hv('$LTSCALE', 40, n6(S)); hv('$DIMSCALE', 40, n6(S)); hv('$DIMASZ', 40, A.asz); hv('$DIMEXO', 40, A.exo); hv('$DIMEXE', 40, A.exe);
    hv('$DIMTXT', 40, A.txt); hv('$DIMGAP', 40, A.gap); hv('$DIMTAD', 70, 1); hv('$DIMTIH', 70, 0); hv('$DIMTOH', 70, 0); hv('$DIMZIN', 70, 8);
    hv('$DIMSTYLE', 2, 'JD-ISO'); hv('$TEXTSTYLE', 7, 'JD'); hv('$CLAYER', 8, '0'); hv('$HANDLING', 70, 0); hv('$DWGCODEPAGE', 3, 'ANSI_1252');
    g(0, 'ENDSEC');
    // tables
    g(0, 'SECTION'); g(2, 'TABLES');
    const cx = (r[0] + r[2]) / 2, cy = (r[1] + r[3]) / 2, vh = (r[3] - r[1]) * 1.05;
    g(0, 'TABLE'); g(2, 'VPORT'); g(70, 1);
    g(0, 'VPORT'); g(2, '*ACTIVE'); g(70, 0); g(10, 0); g(20, 0); g(11, 1); g(21, 1); g(12, n6(cx)); g(22, n6(cy)); g(13, 0); g(23, 0); g(14, 10); g(24, 10); g(15, 10); g(25, 10);
    g(16, 0); g(26, 0); g(36, 1); g(17, 0); g(27, 0); g(37, 0); g(40, n6(vh)); g(41, 1.6); g(42, 50); g(43, 0); g(44, 0); g(50, 0); g(51, 0);
    g(71, 0); g(72, 100); g(73, 1); g(74, 3); g(75, 0); g(76, 0); g(77, 0); g(78, 0);
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LTYPE'); g(70, Object.keys(LTYPES).length);
    for (const [name, pat] of Object.entries(LTYPES)) {
      g(0, 'LTYPE'); g(2, name); g(70, 0); g(3, name === 'CONTINUOUS' ? 'Solid line' : name + ' (ISO, mm)'); g(72, 65); g(73, pat.length); g(40, n6(pat.reduce((s, v) => s + Math.abs(v), 0)));
      pat.forEach(v => g(49, n6(v)));
    }
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'LAYER'); g(70, Object.keys(LAYERS).length + 1);
    g(0, 'LAYER'); g(2, '0'); g(70, 0); g(62, 7); g(6, 'CONTINUOUS');
    for (const [name, d] of Object.entries(LAYERS)) { g(0, 'LAYER'); g(2, name); g(70, 0); g(62, d.color); g(6, d.lt); }
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'STYLE'); g(70, 2);
    g(0, 'STYLE'); g(2, 'STANDARD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'txt'); g(4, '');
    g(0, 'STYLE'); g(2, 'JD'); g(70, 0); g(40, 0); g(41, 1); g(50, 0); g(71, 0); g(42, 2.5); g(3, 'malgun.ttf'); g(4, '');
    g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'VIEW'); g(70, 0); g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'UCS'); g(70, 0); g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'APPID'); g(70, 1); g(0, 'APPID'); g(2, 'ACAD'); g(70, 0); g(0, 'ENDTAB');
    g(0, 'TABLE'); g(2, 'DIMSTYLE'); g(70, 1);
    g(0, 'DIMSTYLE'); g(2, 'JD-ISO'); g(70, 0); ['3', '4', '5', '6', '7'].forEach(c => g(c, ''));
    g(40, n6(S)); g(41, A.asz); g(42, A.exo); g(43, 7); g(44, A.exe); g(45, 0); g(46, 0); g(47, 0); g(48, 0);
    g(140, A.txt); g(141, 0); g(142, 0); g(143, 25.4); g(144, 1); g(145, 0); g(146, 1); g(147, A.gap);
    g(71, 0); g(72, 0); g(73, 0); g(74, 0); g(75, 0); g(76, 0); g(77, 1); g(78, 8); g(170, 0); g(171, 2); g(172, 1); g(173, 0); g(174, 0); g(175, 0); g(176, 0); g(177, 0); g(178, 0);
    g(0, 'ENDTAB');
    g(0, 'ENDSEC');
    // entity writer
    const ent = (p, L, inBlock) => {
      const lay = inBlock ? '0' : L; const byblock = () => { if (inBlock) g(62, 0); };
      if (p.k === 'line') { g(0, 'LINE'); g(8, lay); byblock(); xy(0, p.a); xy(1, p.b); }
      else if (p.k === 'circle') { g(0, 'CIRCLE'); g(8, lay); byblock(); xy(0, p.c); g(40, n6(p.r)); }
      else if (p.k === 'arc') { g(0, 'ARC'); g(8, lay); byblock(); xy(0, p.c); g(40, n6(p.r)); g(50, n6(p.s)); g(51, n6(p.e)); }
      else if (p.k === 'solid') { g(0, 'SOLID'); g(8, lay); byblock(); const q = p.pts; xy(0, q[0]); xy(1, q[1]); xy(2, q[2]); xy(3, q[3] || q[2]); }
      else if (p.k === 'pline') {
        g(0, 'POLYLINE'); g(8, lay); byblock(); g(66, 1); g(10, 0); g(20, 0); g(30, 0); g(70, p.closed ? 1 : 0); if (p.w) { g(40, n6(p.w)); g(41, n6(p.w)); }
        for (const v of p.pts) { g(0, 'VERTEX'); g(8, lay); byblock(); xy(0, v); if (v[2]) g(42, n6(v[2])); }
        g(0, 'SEQEND'); g(8, lay);
      } else if (p.k === 'text') {
        g(0, 'TEXT'); g(8, lay); byblock(); xy(0, p.p); g(40, n6(p.h)); g(1, dxfText(p.s)); if (p.r) g(50, n6(p.r)); g(7, 'JD');
        if (p.al || p.va) { g(72, p.al); xy(1, p.p); g(73, p.va); }
      }
    };
    // blocks
    g(0, 'SECTION'); g(2, 'BLOCKS');
    let dn = 0, xn = 0; const blockNames = new Map();
    for (const p of model.prims) if (p.k === 'dim' || p.k === 'block') {
      const name = p.k === 'dim' ? '*D' + (++dn) : '*X' + (++xn); blockNames.set(p, name);
      g(0, 'BLOCK'); g(8, '0'); g(2, name); g(70, 1); g(10, 0); g(20, 0); g(30, 0); g(3, name);
      p.items.forEach(q => ent(q, p.L, true));
      g(0, 'ENDBLK'); g(8, '0');
    }
    g(0, 'ENDSEC');
    // entities
    g(0, 'SECTION'); g(2, 'ENTITIES');
    for (const p of model.prims) {
      if (p.k === 'block') { g(0, 'INSERT'); g(8, p.L); g(2, blockNames.get(p)); g(10, 0); g(20, 0); g(30, 0); }
      else if (p.k === 'dim') {
        const d = p.dxf; g(0, 'DIMENSION'); g(8, p.L); g(2, blockNames.get(p)); g(3, 'JD-ISO');
        xy(0, d.def); xy(1, d.mid); g(70, d.type | 32); g(1, d.text ? dxfText(d.text) : '');
        if (d.type <= 1) { xy(3, d.p1); xy(4, d.p2); if (d.type === 0) g(50, n6(d.ang)); }
        else if (d.type === 5) { xy(3, d.p13); xy(4, d.p14); xy(5, d.p15); }
        else { xy(5, d.p15); g(40, 0); }
      } else ent(p, p.L, false);
    }
    g(0, 'ENDSEC'); g(0, 'EOF');
    return o.join('\r\n') + '\r\n';
  }

  function snapPoints(prims) {
    const out = [];
    const walk = (list, src) => { for (const p of list) {
      const s = p.src ?? src; if (s == null) continue;
      if (p.k === 'line') { out.push({ p: p.a, t: 'end', s }, { p: p.b, t: 'end', s }, { p: mul(add(p.a, p.b), .5), t: 'mid', s }); }
      else if (p.k === 'circle') { out.push({ p: p.c, t: 'cen', s }); [0, 90, 180, 270].forEach(a => out.push({ p: add(p.c, [p.r * Math.cos(rad(a)), p.r * Math.sin(rad(a))]), t: 'qua', s })); }
      else if (p.k === 'arc') { out.push({ p: p.c, t: 'cen', s }, { p: add(p.c, [p.r * Math.cos(rad(p.s)), p.r * Math.sin(rad(p.s))]), t: 'end', s }, { p: add(p.c, [p.r * Math.cos(rad(p.e)), p.r * Math.sin(rad(p.e))]), t: 'end', s }); }
      else if (p.k === 'pline') { const n = p.pts.length; p.pts.forEach((v, i) => { out.push({ p: [v[0], v[1]], t: 'end', s }); if ((i < n - 1 || p.closed) && !v[2]) { const q = p.pts[(i + 1) % n]; out.push({ p: [(v[0] + q[0]) / 2, (v[1] + q[1]) / 2], t: 'mid', s }); } if (v[2]) { const q = p.pts[(i + 1) % n]; const a = bulgeArc(v, q, v[2]); out.push({ p: a.c, t: 'cen', s }); } }); }
    } };
    walk(prims, null); return out;
  }
  function segDist(p, a, b) { const ab = sub(b, a); const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * ab[0] + (p[1] - a[1]) * ab[1]) / ((ab[0] ** 2 + ab[1] ** 2) || 1))); return len(sub(p, add(a, mul(ab, t)))); }
  function primDist(q, p) {
    if (q.k === 'line') return segDist(p, q.a, q.b);
    if (q.k === 'circle') return Math.abs(len(sub(p, q.c)) - q.r);
    if (q.k === 'arc') { const a = (deg(Math.atan2(p[1] - q.c[1], p[0] - q.c[0])) + 360) % 360; const s = (q.s + 360) % 360, e = (q.e + 360) % 360; const inA = s <= e ? a >= s && a <= e : a >= s || a <= e; return inA ? Math.abs(len(sub(p, q.c)) - q.r) : Infinity; }
    if (q.k === 'pline') { const pts = tessBulge(q.pts, q.closed); let d = Infinity; for (let i = 0; i < pts.length - (q.closed ? 0 : 1); i++) d = Math.min(d, segDist(p, pts[i], pts[(i + 1) % pts.length])); return d; }
    if (q.k === 'solid') return segDist(p, q.pts[0], q.pts[1]);
    if (q.k === 'text') { const b = bboxOf([q]); return (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) ? 0 : Infinity; }
    if (q.items) return Math.min(...q.items.map(i => primDist(i, p)));
    return Infinity;
  }
  function hit(prims, p, tol) { let best = null, bd = tol; for (const q of prims) { if (q.src == null) continue; const d = primDist(q, p); if (d <= bd) { bd = d; best = q.src; } } return best; }
  function srcBoxes(prims) { const m = new Map(); for (const q of prims) { if (q.src == null) continue; const b = bboxOf([q]); const c = m.get(q.src); m.set(q.src, c ? [Math.min(c[0], b[0]), Math.min(c[1], b[1]), Math.max(c[2], b[2]), Math.max(c[3], b[3])] : b); } return m; }
  return { build, toSVG, toDXF, LAYERS, LTYPES, SHEETS, SCALES, parseScale, snapPoints, hit, srcBoxes, bboxOf, tessBulge, bulgeArc, palette, aciHex, fmt, tw };
})();
if (typeof module !== 'undefined') module.exports = JD;
