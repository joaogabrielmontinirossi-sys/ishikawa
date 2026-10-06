'use strict';
/* Ishikawa — cálculo do layout e desenho da espinha de peixe em SVG (usado na tela e nas exportações) */

const Fish = (() => {
  const PAL = ['#2563eb', '#d97706', '#059669', '#dc2626', '#7c3aed', '#0891b2', '#be185d', '#4d7c0f'];
  const FONT = "'Segoe UI', system-ui, -apple-system, Roboto, sans-serif";
  // [peso, tamanho, altura da linha]
  const F = { cause: [600, 13, 17], sub: [400, 12, 15], cat: [700, 14, 18], effect: [700, 16, 21], title: [700, 18, 24] };
  const TH = {
    light: { bg: '#ffffff', ink: '#1f2937', sub: '#475569', spine: '#334155', mute: '#9ca3af', head: '#0f172a', headInk: '#ffffff', sel: '#0e7490', root: '#dc2626', ok: '#047857' },
    dark: { bg: '#0f172a', ink: '#e5e7eb', sub: '#cbd5e1', spine: '#94a3b8', mute: '#64748b', head: '#e2e8f0', headInk: '#0f172a', sel: '#22d3ee', root: '#f87171', ok: '#34d399' },
  };
  const TAN = 0.45; // inclinação das espinhas
  const r = n => Math.round(n * 10) / 10;
  let ctx;
  function tw(t, f) {
    ctx = ctx || document.createElement('canvas').getContext('2d');
    ctx.font = `${f[0]} ${f[1]}px ${FONT}`;
    return ctx.measureText(t).width;
  }
  function wrap(text, f, max) {
    const lines = [];
    let line = '';
    for (let w of String(text).trim().split(/[ \t\r\n]+/)) {
      while (tw(w, f) > max) { // palavra maior que a linha: quebra no meio
        let i = w.length;
        while (i > 1 && tw(w.slice(0, i), f) > max) i--;
        if (line) { lines.push(line); line = ''; }
        lines.push(w.slice(0, i)); w = w.slice(i);
      }
      const t = line ? line + ' ' + w : w;
      if (line && tw(t, f) > max) { lines.push(line); line = w; } else line = t;
    }
    if (line || !lines.length) lines.push(line);
    return lines;
  }
  function block(text, f, max) {
    const lines = wrap(text, f, max);
    return { lines, w: Math.max(...lines.map(l => tw(l, f))), h: lines.length * f[2] };
  }
  function label(n, ph) {
    let t = (n.text || '').trim() || ph;
    // espaços inseparáveis: o símbolo nunca fica sozinho numa linha
    if (n.root) t = '★ ' + t; else if (n.status === 'ok') t = '✓ ' + t;
    if (n.votes) t += '  ▲' + n.votes;
    return t;
  }
  function text(b, f, x, yc, anchor, fill, extra) {
    const y0 = yc - b.h / 2 + f[2] * 0.76;
    return `<text x="${r(x)}" y="${r(y0)}" text-anchor="${anchor}" font-family="${FONT}" font-size="${f[1]}" font-weight="${f[0]}" fill="${fill}"${extra || ''}>` +
      b.lines.map((l, i) => `<tspan x="${r(x)}" dy="${i ? f[2] : 0}">${esc(l)}</tspan>`).join('') + '</text>';
  }
  const line = (x1, y1, x2, y2, color, w, op) => `<line x1="${r(x1)}" y1="${r(y1)}" x2="${r(x2)}" y2="${r(y2)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${op ? ` stroke-opacity="${op}"` : ''}/>`;

  function render(d, o = {}) {
    const T = TH[o.theme] || TH.light, out = [];
    const node = (id, kind, x, y, w, h, inner) => {
      const on = o.sel === id;
      return `<g data-id="${id}" data-kind="${kind}">${inner}<rect class="hit" x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" rx="5" fill="${T.sel}" fill-opacity="${on ? 0.14 : 0}" stroke="${on ? T.sel : 'none'}" stroke-width="1.5"/></g>`;
    };
    const ink = n => n.root ? T.root : n.status === 'no' ? T.mute : n.status === 'ok' ? T.ok : null;
    const deco = n => n.status === 'no' ? ' text-decoration="line-through"' : '';

    // 1) Mede cada categoria: as causas são empilhadas da espinha central para fora
    const M = d.cats.map((c, i) => {
      const top = i % 2 === 0, ord = a => top ? [...a].reverse() : a; // leitura sempre de cima para baixo
      let h = 34;
      const cs = ord(c.causes).map(ca => {
        const b = block(label(ca, 'Causa'), F.cause, 230);
        let edge = Math.max(b.h / 2, 6);
        const subs = ord(ca.subs).map(s => {
          const sb = block(label(s, 'Subcausa'), F.sub, 200), t = edge + 4 + sb.h / 2;
          edge = t + sb.h / 2;
          return { s, b: sb, t };
        });
        h += b.h / 2 + 5;
        const x = { ca, b, subs, hh: h, len: subs.length ? 32 + (subs.length - 1) * 18 : 26 };
        h += edge + 13;
        return x;
      });
      return { c, top, color: c.color || PAL[i % PAL.length], lab: block((c.name || '').trim() || 'Categoria', F.cat, 170), cs, used: h + 10 };
    });
    const side = t => M.filter(m => m.top === t);
    const Ht = Math.max(130, ...side(true).map(m => m.used)), Hb = Math.max(130, ...side(false).map(m => m.used));

    // 2) Distribui as causas ao longo da espinha e calcula a largura ocupada à esquerda do ponto de encaixe
    M.forEach(m => {
      m.H = m.top ? Ht : Hb;
      const e = (m.H - m.used) / (m.cs.length + 1);
      m.ext = m.H * TAN + m.lab.w / 2 + 14;
      m.cs.forEach((x, k) => {
        x.hh += e * (k + 1);
        const bx = -x.hh * TAN;
        m.ext = Math.max(m.ext, x.len + 6 + x.b.w - bx);
        x.subs.forEach((s, j) => {
          s.x = bx - 16 - (x.subs.length - 1 - j) * 18; // as mais altas ficam junto à espinha para os textos não se cruzarem
          m.ext = Math.max(m.ext, s.t * TAN + 5 + s.b.w - s.x);
        });
      });
      m.ext += 8;
    });

    // 3) Posição de cada par (cima/baixo) na espinha central
    const PAD = 24, A = [];
    let a = PAD;
    for (let k = 0; k * 2 < M.length; k++) {
      const t = M[2 * k], b = M[2 * k + 1];
      let na = (k ? a + 30 : PAD) + Math.max(t.ext, b ? b.ext : 0);
      if (k) for (const [p, q] of [[M[2 * k - 2], t], [M[2 * k - 1], b]]) if (p && q) na = Math.max(na, a + (p.lab.w + q.lab.w) / 2 + 40);
      A.push(a = na);
    }
    const eff = block((d.effect || '').trim() || 'Efeito (problema)', F.effect, 210);
    const hw = eff.w + 40, hh = eff.h + 32, hx = (M.length ? a : PAD + 180) + 56;
    const labH = t => Math.max(0, ...side(t).map(m => m.lab.h + 12));
    const tb = o.title ? block(o.title, F.title, Math.max(300, hx + hw - PAD)) : null;
    const up = Math.max(hh / 2, side(true).length ? Ht + labH(true) : 0) + PAD, down = Math.max(hh / 2, side(false).length ? Hb + labH(false) : 0) + PAD;
    const headRoom = tb ? tb.h + 20 : 0, W = hx + hw + PAD, H = up + down + headRoom;

    // 4) Desenho
    out.push(line(PAD, 0, hx, 0, T.spine, 4));
    M.forEach((m, i) => {
      const ax = A[i >> 1], sg = m.top ? -1 : 1, tipX = ax - m.H * TAN, tipY = sg * m.H;
      out.push(line(tipX, tipY, ax, 0, m.color, 2.6));
      const lw = m.lab.w + 24, lh = m.lab.h + 12, ly = m.top ? tipY - lh : tipY;
      out.push(node(m.c.id, 'cat', tipX - lw / 2, ly, lw, lh,
        `<rect x="${r(tipX - lw / 2)}" y="${r(ly)}" width="${r(lw)}" height="${r(lh)}" rx="7" fill="${m.color}"/>` + text(m.lab, F.cat, tipX, ly + lh / 2, 'middle', '#ffffff')));
      m.cs.forEach(x => {
        const y = sg * x.hh, bx = ax - x.hh * TAN, lx = bx - x.len;
        out.push(line(lx, y, bx, y, m.color, 1.7, 0.8));
        x.subs.forEach(s => {
          const sx = ax + s.x, tx = sx - s.t * TAN, ty = y + sg * s.t;
          out.push(line(tx, ty, sx, y, m.color, 1.2, 0.7));
          out.push(node(s.s.id, 'sub', tx - 9 - s.b.w, ty - s.b.h / 2 - 2, s.b.w + 8, s.b.h + 4, text(s.b, F.sub, tx - 5, ty, 'end', ink(s.s) || T.sub, deco(s.s))));
        });
        out.push(node(x.ca.id, 'cause', lx - 10 - x.b.w, y - x.b.h / 2 - 2, x.b.w + 8, x.b.h + 4, text(x.b, F.cause, lx - 6, y, 'end', ink(x.ca) || T.ink, deco(x.ca))));
      });
    });
    out.push(node('effect', 'effect', hx, -hh / 2, hw, hh,
      `<path d="M${r(hx - 14)} -9L${r(hx)} 0L${r(hx - 14)} 9z" fill="${T.spine}"/><rect x="${r(hx)}" y="${r(-hh / 2)}" width="${r(hw)}" height="${r(hh)}" rx="10" fill="${T.head}"/>` + text(eff, F.effect, hx + hw / 2, 0, 'middle', T.headInk)));

    const size = o.fluid ? '' : ` width="${r(W)}" height="${r(H)}"`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${r(W)} ${r(H)}"${size}>` +
      (o.bg ? `<rect width="100%" height="100%" fill="${T.bg}"/>` : '') +
      (tb ? text(tb, F.title, PAD, 16 + tb.h / 2, 'start', T.ink) : '') +
      `<g transform="translate(0 ${r(up + headRoom)})">${out.join('')}</g></svg>`;
    return { svg, w: W, h: H };
  }

  return { render, PAL };
})();
