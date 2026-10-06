'use strict';
/* Ishikawa — interface: lista de diagramas, quadro, estrutura, plano de ação, exportações e sincronização */

let toast = () => {};

(() => {
  let sel = 'effect', dirty = false, showTrash = false, query = '', size = { w: 0, h: 0 };
  let auto = true; // o quadro se ajusta sozinho à tela até a pessoa mover ou ampliar
  const view = { x: 0, y: 0, k: 1 };
  const H = new Map(); // histórico de desfazer/refazer por diagrama

  const cur = () => S.diagrams.find(d => d.id === S.set.cur && !d.deleted);
  const live = () => S.diagrams.filter(d => !d.deleted);
  const theme = () => S.set.theme === 'auto' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : S.set.theme;
  const applyTheme = () => { document.documentElement.dataset.theme = theme(); };
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const today = () => dayKey(Date.now());

  /* ---------- Componentes básicos ---------- */
  let toastT;
  toast = (msg, action) => {
    const t = $('#toast');
    t.innerHTML = esc(msg) + (action ? ` <button class="link">${esc(action.label)}</button>` : '');
    if (action) $('button', t).onclick = () => { action.fn(); t.classList.remove('on'); };
    t.classList.add('on');
    clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('on'), action ? 8000 : 3200);
  };
  function modal({ title, body, wide }) {
    const el = document.createElement('div');
    el.className = 'modalwrap';
    el.innerHTML = `<div class="modal${wide ? ' wide' : ''}" role="dialog"><div class="mhead"><h2>${esc(title)}</h2><button class="icon" data-close title="Fechar">${ic('x')}</button></div><div class="mbody">${body}</div></div>`;
    const close = () => { el.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    el.addEventListener('mousedown', e => { if (e.target === el || e.target.closest('[data-close]')) close(); });
    document.addEventListener('keydown', onKey, true);
    document.body.append(el);
    const f = $('input,select,textarea,button.btn', $('.mbody', el));
    if (f) f.focus();
    return { el, close };
  }
  const confirmBox = (title, text, ok, danger) => new Promise(res => {
    const m = modal({ title, body: `<p>${esc(text)}</p><div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn${danger ? ' danger' : ''}" id="okbtn">${esc(ok)}</button></div>` });
    let done = false;
    $('#okbtn', m.el).onclick = () => { done = true; m.close(); res(true); };
    new MutationObserver(() => { if (!m.el.isConnected && !done) res(false); }).observe(document.body, { childList: true });
  });
  function popmenu(anchor, items) {
    $$('.pop').forEach(p => p.remove());
    const p = document.createElement('div');
    p.className = 'pop';
    p.innerHTML = items.map((it, i) => it === '-' ? '<hr>' : `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${ic(it.icon)}<span>${esc(it.label)}</span></button>`).join('');
    document.body.append(p);
    const r = anchor.getBoundingClientRect();
    p.style.left = Math.max(8, Math.min(r.left, innerWidth - p.offsetWidth - 8)) + 'px';
    p.style.top = (r.bottom + p.offsetHeight + 8 > innerHeight ? Math.max(8, r.top - p.offsetHeight - 4) : r.bottom + 4) + 'px';
    const off = e => { if (!e || !p.contains(e.target)) { p.remove(); document.removeEventListener('mousedown', off, true); } };
    p.onclick = e => { const b = e.target.closest('button'); if (b) { off(); items[b.dataset.i].fn(); } };
    setTimeout(() => document.addEventListener('mousedown', off, true));
  }
  function download(name, type, data) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(data instanceof Blob ? data : new Blob([data], { type }));
    a.download = name;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  const pickFiles = accept => new Promise(res => { const f = $('#filepick'); f.accept = accept; f.value = ''; f.onchange = () => res([...f.files]); f.click(); });

  /* ---------- Modelo: localizar, alterar, desfazer ---------- */
  function locate(d, id) {
    if (id === 'effect') return { kind: 'effect' };
    for (const cat of d.cats) {
      if (cat.id === id) return { kind: 'cat', node: cat, cat, list: d.cats, i: d.cats.indexOf(cat) };
      for (const cause of cat.causes) {
        if (cause.id === id) return { kind: 'cause', node: cause, cat, cause, list: cat.causes, i: cat.causes.indexOf(cause) };
        const si = cause.subs.findIndex(s => s.id === id);
        if (si >= 0) return { kind: 'sub', node: cause.subs[si], cat, cause, list: cause.subs, i: si };
      }
    }
    return null;
  }
  const saveSoon = debounce(() => commit(), 600);
  function commit() {
    const d = cur();
    if (dirty && d) { dirty = false; DB.put('diagrams', d); }
  }
  // key agrupa alterações seguidas do mesmo campo (digitação) em um único passo de desfazer
  function mutate(fn, key) {
    const d = cur();
    if (!d) return;
    let h = H.get(d.id);
    if (!h) H.set(d.id, h = { undo: [], redo: [], key: '', at: 0 });
    const now = Date.now();
    if (!(key && h.key === key && now - h.at < 1500)) { h.undo.push(JSON.stringify(d)); if (h.undo.length > 100) h.undo.shift(); h.redo = []; }
    h.key = key || ''; h.at = now;
    fn(d);
    d.updated = now; delete d.seed;
    dirty = true; saveSoon(); sideSoon();
  }
  function undo(redo) {
    const d = cur(), h = d && H.get(d.id);
    if (!h) return;
    const from = redo ? h.redo : h.undo, to = redo ? h.undo : h.redo;
    if (!from.length) return;
    to.push(JSON.stringify(d));
    const o = JSON.parse(from.pop());
    S.diagrams[S.diagrams.indexOf(d)] = o;
    o.updated = Date.now(); h.key = '';
    dirty = true; saveSoon();
    if (!locate(o, sel)) sel = 'effect';
    renderAll();
  }

  /* Operações de estrutura: devolvem o id do item que deve ficar selecionado. */
  function addSibling(id) {
    let nid;
    mutate(d => {
      const L = locate(d, id) || { kind: 'effect' }, n = L.kind === 'cause' ? newCause() : L.kind === 'sub' ? newSub() : newCat();
      if (L.kind === 'effect') d.cats.push(n); else L.list.splice(L.i + 1, 0, n);
      nid = n.id;
    });
    return nid;
  }
  function addChild(id) {
    let nid;
    mutate(d => {
      const L = locate(d, id) || { kind: 'effect' };
      let n;
      if (L.kind === 'effect') d.cats.push(n = newCat());
      else if (L.kind === 'cat') L.cat.causes.push(n = newCause());
      else if (L.kind === 'cause') L.cause.subs.push(n = newSub());
      else L.list.splice(L.i + 1, 0, n = newSub());
      nid = n.id;
    });
    return nid;
  }
  function removeNode(id) {
    let nid = 'effect';
    mutate(d => {
      const L = locate(d, id);
      if (!L || L.kind === 'effect') return;
      L.list.splice(L.i, 1);
      const near = L.list[L.i - 1] || L.list[L.i];
      nid = near ? near.id : L.kind === 'sub' ? L.cause.id : L.kind === 'cause' ? L.cat.id : 'effect';
    });
    return nid;
  }
  function moveNode(id, dir) {
    mutate(d => {
      const L = locate(d, id), j = L && L.list ? L.i + dir : -1;
      if (j < 0 || j >= L.list.length) return;
      L.list.splice(j, 0, L.list.splice(L.i, 1)[0]);
    });
  }
  function indent(id) {
    mutate(d => {
      const L = locate(d, id);
      if (!L || L.kind !== 'cause' || L.i === 0) return;
      const { subs, ...rest } = L.node;
      L.list.splice(L.i, 1);
      L.list[L.i - 1].subs.push(rest, ...subs);
    });
  }
  function outdent(id) {
    mutate(d => {
      const L = locate(d, id);
      if (!L || L.kind !== 'sub') return;
      L.list.splice(L.i, 1);
      L.cat.causes.splice(L.cat.causes.indexOf(L.cause) + 1, 0, { ...L.node, subs: [] });
    });
  }
  function moveToCat(id, catId) {
    mutate(d => {
      const L = locate(d, id), to = d.cats.find(c => c.id === catId);
      if (!L || L.kind !== 'cause' || !to || to === L.cat) return;
      L.list.splice(L.i, 1);
      to.causes.push(L.node);
    });
  }
  async function askRemove(id) {
    const d = cur(), L = d && locate(d, id);
    if (!L || L.kind === 'effect') return null;
    const kids = L.kind === 'cat' ? L.node.causes.length : L.kind === 'cause' ? L.node.subs.length : 0;
    if (kids && !await confirmBox('Excluir', L.kind === 'cat' ? `A categoria "${L.node.name || 'sem nome'}" tem ${count(kids, 'causa', 'causas')}. Excluir tudo?` : `Esta causa tem ${count(kids, 'subcausa', 'subcausas')}. Excluir tudo?`, 'Excluir', true)) return null;
    return removeNode(id);
  }

  /* ---------- Barra lateral: lista de diagramas ---------- */
  const Sync = { avail: false, on: false, folder: null, detected: null, drives: [], busy: false, again: false, last: 0, error: '' };
  function renderSide() {
    const list = S.diagrams.filter(d => !!d.deleted === showTrash && norm(d.title + ' ' + d.effect).includes(norm(query))).sort((a, b) => b.updated - a.updated);
    const trash = S.diagrams.filter(d => d.deleted).length;
    $('#sidebar').innerHTML = `
      <div class="brand">${LOGO}<b>Ishikawa</b><button class="icon mobile" data-act="closeSide" title="Fechar">${ic('x')}</button></div>
      <button class="btn block" data-act="newDiagram">${ic('plus')} Novo diagrama</button>
      <div class="qwrap">${ic('search')}<input id="q" type="search" placeholder="Pesquisar diagramas" value="${esc(query)}" autocomplete="off"></div>
      <div class="shead">${showTrash ? `<button class="link" data-act="toggleTrash">${ic('back')} Voltar aos diagramas</button>` : `<span>Diagramas</span><span>${live().length}</span>`}</div>
      <div id="dlist">${list.map(d => `<div class="ditem${d.id === S.set.cur && !showTrash ? ' on' : ''}" data-act="${showTrash ? 'trashMenu' : 'open'}" data-id="${d.id}">
        <div class="dt">${esc(d.title || 'Sem título')}</div><div class="ds">${count(Store.count(d), 'causa', 'causas')} · ${fmtRel(d.updated)}</div>
        <button class="icon sm" data-act="${showTrash ? 'trashMenu' : 'itemMenu'}" data-id="${d.id}" title="Mais ações">${ic('more')}</button></div>`).join('') || `<p class="muted pad">${showTrash ? 'A lixeira está vazia.' : query ? 'Nada encontrado.' : 'Nenhum diagrama ainda.'}</p>`}</div>
      <div class="sfoot">
        ${!showTrash && trash ? `<button class="link" data-act="toggleTrash">${ic('trash')} Lixeira (${trash})</button>` : ''}
        <button class="link" data-act="settings" title="Ajustes e sincronização">${ic(Sync.on ? 'sync' : 'gear')}<span>${Sync.on ? (Sync.error ? 'Falha na sincronização' : Sync.last ? 'Sincronizado ' + fmtRel(Sync.last) : 'Sincronizando…') : 'Ajustes'}</span></button>
      </div>`;
  }
  const sideSoon = debounce(() => { if (document.activeElement !== $('#q')) renderSide(); }, 400);
  function openDiagram(id) {
    commit();
    S.set.cur = id; Store.saveSet();
    sel = 'effect'; showTrash = false;
    document.body.classList.remove('side-open');
    renderAll(); fit();
  }
  function newDiagramModal() {
    const m = modal({ title: 'Novo diagrama', body: `
      <label>Nome do diagrama</label><input id="ndt" placeholder="Ex.: Atraso na entrega de pedidos" maxlength="120">
      <label>Efeito (o problema a analisar)</label><input id="nde" placeholder="Ex.: Pedidos entregues com atraso" maxlength="200">
      <label>Modelo de categorias</label>
      <div class="tpls">${TEMPLATES.map((t, i) => `<label class="tpl"><input type="radio" name="tpl" value="${i}"${i ? '' : ' checked'}><div><b>${esc(t[0])}</b><span>${esc(t[1])}</span><small>${esc(t[2].join(' · '))}</small></div></label>`).join('')}</div>
      <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="ndok">Criar diagrama</button></div>` });
    const go = () => {
      const effect = $('#nde', m.el).value.trim(), d = Store.create($('#ndt', m.el).value.trim() || effect || 'Novo diagrama', effect, +$('input[name=tpl]:checked', m.el).value);
      m.close(); openDiagram(d.id);
    };
    $('#ndok', m.el).onclick = go;
    m.el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') go(); });
  }
  function duplicate(d) {
    const o = normalize(JSON.parse(JSON.stringify(d)));
    const ids = {}, re = n => { ids[n.id] = uid() + Object.keys(ids).length; n.id = ids[n.id]; };
    o.cats.forEach(c => { re(c); c.causes.forEach(ca => { re(ca); ca.subs.forEach(re); }); });
    o.actions.forEach(a => { a.id = uid() + a.id.slice(-3); a.causeId = ids[a.causeId] || ''; });
    Object.assign(o, { id: uid(), title: d.title + ' (cópia)', created: Date.now(), updated: Date.now() });
    delete o.seed; delete o.mod;
    S.diagrams.push(o); DB.put('diagrams', o);
    openDiagram(o.id);
  }
  function toTrash(d) {
    commit();
    d.deleted = Date.now(); DB.put('diagrams', d);
    if (S.set.cur === d.id) { S.set.cur = (live().sort((a, b) => b.updated - a.updated)[0] || {}).id || null; Store.saveSet(); sel = 'effect'; }
    renderAll(); fit();
    toast('Diagrama movido para a lixeira', { label: 'Desfazer', fn: () => { d.deleted = null; DB.put('diagrams', d); openDiagram(d.id); } });
  }

  /* ---------- Barra superior e quadro ---------- */
  function renderTop() {
    const d = cur();
    $('#topbar').innerHTML = `<button class="icon mobile" data-act="openSide" title="Diagramas">${ic('menu')}</button>` + (d ? `
      <input id="title" value="${esc(d.title)}" placeholder="Nome do diagrama" maxlength="120" title="Nome do diagrama">
      <div class="tools">
        <button class="icon" data-act="undo" title="Desfazer (Ctrl+Z)">${ic('undo')}</button><button class="icon" data-act="redo" title="Refazer (Ctrl+Y)">${ic('redo')}</button>
        <span class="sep"></span>
        <button class="btn ghost sm" data-act="addCat" title="Nova categoria">${ic('plus')}<span>Categoria</span></button>
        <button class="btn ghost sm" data-act="addCause" title="Nova causa na categoria selecionada (Enter)">${ic('plus')}<span>Causa</span></button>
        <button class="btn ghost sm" data-act="addSub" title="Nova subcausa na causa selecionada (Tab)">${ic('plus')}<span>Subcausa</span></button>
        <span class="sep"></span>
        <button class="btn sm" data-act="exportMenu">${ic('dl')}<span>Exportar</span></button>
        <button class="icon" data-act="togglePanel" title="Mostrar ou ocultar o painel">${ic('panel')}</button>
      </div>` : '<span class="grow"></span>');
  }
  function draw() {
    const d = cur();
    $('#empty').hidden = !!d;
    $('#zoombar').hidden = !d;
    if (!d) { $('#world').innerHTML = ''; return; }
    const r = Fish.render(d, { theme: theme(), sel });
    $('#world').innerHTML = r.svg;
    size = r;
    if (auto) fit();
  }
  const drawSoon = debounce(draw, 120);
  function applyView() {
    $('#world').style.transform = `translate(${view.x}px,${view.y}px) scale(${view.k})`;
    $('#zoomv').textContent = Math.round(view.k * 100) + '%';
  }
  function fit() {
    const st = $('#stage');
    auto = true;
    if (!size.w || !st.clientWidth) return;
    view.k = Math.max(0.2, Math.min((st.clientWidth - 32) / size.w, (st.clientHeight - 32) / size.h, 1.4));
    view.x = (st.clientWidth - size.w * view.k) / 2; view.y = (st.clientHeight - size.h * view.k) / 2;
    applyView();
  }
  function zoom(f, cx, cy) {
    const st = $('#stage'), k = Math.max(0.2, Math.min(view.k * f, 3));
    cx = cx ?? st.clientWidth / 2; cy = cy ?? st.clientHeight / 2;
    view.x = cx - (cx - view.x) * k / view.k; view.y = cy - (cy - view.y) * k / view.k; view.k = k;
    auto = false;
    applyView();
  }
  function select(id, focusStage) {
    sel = id;
    $$('#outline .orow').forEach(r => r.classList.toggle('sel', r.dataset.id === id));
    renderDetails(); draw();
    if (focusStage) $('#stage').focus({ preventScroll: true });
  }
  /* Edição do texto sobre o próprio desenho. */
  function editInPlace(id) {
    const d = cur(), L = d && locate(d, id), hit = $(`#world [data-id="${id}"] .hit`);
    if (!L || !hit) return;
    const st = $('#stage').getBoundingClientRect();
    let r = hit.getBoundingClientRect();
    // traz o item para dentro da área visível
    const dx = r.left < st.left + 8 ? st.left + 8 - r.left : r.right > st.right - 8 ? st.right - 8 - r.right : 0, dy = r.top < st.top + 8 ? st.top + 8 - r.top : r.bottom > st.bottom - 8 ? st.bottom - 8 - r.bottom : 0;
    if (dx || dy) { view.x += dx; view.y += dy; applyView(); r = hit.getBoundingClientRect(); }
    const field = L.kind === 'cat' ? 'name' : L.kind === 'effect' ? 'effect' : 'text', target = L.kind === 'effect' ? d : L.node;
    const inp = document.createElement('input');
    inp.className = 'inplace'; inp.value = target[field]; inp.maxLength = 200;
    inp.placeholder = { effect: 'Efeito (problema)', cat: 'Categoria', cause: 'Causa', sub: 'Subcausa' }[L.kind];
    const w = Math.max(190, r.width + 30);
    inp.style.cssText = `left:${Math.max(st.left + 4, Math.min(L.kind === 'cause' || L.kind === 'sub' ? r.right - w : r.left + r.width / 2 - w / 2, st.right - w - 4))}px;top:${r.top + r.height / 2 - 16}px;width:${w}px`;
    document.body.append(inp);
    inp.focus(); inp.select();
    let done = false;
    const end = (save, then) => {
      if (done) return;
      done = true;
      const v = inp.value.trim();
      inp.remove();
      if (save && v !== target[field]) mutate(x => { const T = locate(x, id); (L.kind === 'effect' ? x : T.node)[field] = v; });
      renderOutline(); draw();
      $('#stage').focus({ preventScroll: true });
      if (then) then();
    };
    inp.onblur = () => end(true);
    inp.onkeydown = e => {
      e.stopPropagation();
      if (e.key === 'Enter') end(true, e.ctrlKey ? () => canvasAdd(addChild) : null);
      else if (e.key === 'Escape') end(false);
      else if (e.key === 'Tab') { e.preventDefault(); end(true, () => canvasAdd(addChild)); }
    };
  }
  function canvasAdd(fn, id) {
    const nid = fn(id || sel);
    if (!nid) return;
    sel = nid;
    renderOutline(); draw();
    editInPlace(nid);
  }
  function stageEvents() {
    const st = $('#stage');
    let drag = null, last = { id: null, t: 0 };
    st.addEventListener('pointerdown', e => {
      if (e.button || e.target.closest('#zoombar,#empty')) return;
      const g = e.target.closest('[data-id]');
      drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, id: g && g.dataset.id, moved: false };
      st.setPointerCapture(e.pointerId);
    });
    st.addEventListener('pointermove', e => {
      if (!drag) return;
      if (!drag.moved && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 5) return;
      drag.moved = true; auto = false; st.classList.add('panning');
      view.x = drag.vx + e.clientX - drag.x; view.y = drag.vy + e.clientY - drag.y;
      applyView();
    });
    const up = () => {
      const g = drag;
      drag = null; st.classList.remove('panning');
      if (!g || g.moved || !g.id) return;
      const now = Date.now(), twice = last.id === g.id && now - last.t < 450;
      last = { id: g.id, t: now };
      select(g.id, true);
      if (twice) { last.t = 0; editInPlace(g.id); }
    };
    st.addEventListener('pointerup', up);
    st.addEventListener('pointercancel', () => { drag = null; st.classList.remove('panning'); });
    st.addEventListener('wheel', e => {
      e.preventDefault();
      const r = st.getBoundingClientRect();
      zoom(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    st.addEventListener('keydown', async e => {
      if (e.target !== st || !cur()) return;
      const k = e.key;
      if (k === 'Enter') { e.preventDefault(); canvasAdd(e.ctrlKey ? addChild : addSibling); }
      else if (k === 'Tab') { e.preventDefault(); canvasAdd(addChild); }
      else if (k === 'F2' || k === ' ') { e.preventDefault(); editInPlace(sel); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); const n = await askRemove(sel); if (n) { sel = n; renderOutline(); draw(); st.focus(); } }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) editInPlace(sel); // começar a digitar já edita
    });
    new ResizeObserver(() => { if (auto) fit(); }).observe(st);
  }

  /* ---------- Painel: estrutura, detalhes e plano de ação ---------- */
  function renderPanel() {
    const d = cur(), p = $('#panel');
    document.body.classList.toggle('no-panel', !S.set.panel || !d);
    if (!d) { p.innerHTML = ''; return; }
    p.innerHTML = `<div class="tabs"><button class="${S.set.tab === 'outline' ? 'on' : ''}" data-act="tab" data-id="outline">${ic('list')} Estrutura</button><button class="${S.set.tab === 'actions' ? 'on' : ''}" data-act="tab" data-id="actions">${ic('check')} Plano de ação${d.actions.length ? ` (${d.actions.length})` : ''}</button><button class="icon mobile" data-act="togglePanel" title="Fechar">${ic('x')}</button></div>
      <div id="pbody" class="${S.set.tab === 'outline' ? 'split' : ''}">${S.set.tab === 'outline' ? '<div id="outline"></div><div id="details"></div>' : '<div id="actions"></div>'}</div>`;
    if (S.set.tab === 'outline') { renderOutline(); renderDetails(); } else renderActions();
  }
  function renderOutline() {
    const d = cur(), el = $('#outline');
    if (!d || !el) return;
    const row = (kind, id, value, ph, color, canAdd) => `<div class="orow ${kind}${sel === id ? ' sel' : ''}" data-id="${id}">${kind === 'effect' ? '<span class="otag">Efeito</span>' : `<i class="dot" style="background:${color}"></i>`}<input value="${esc(value)}" placeholder="${ph}" maxlength="200" spellcheck="false">${canAdd ? `<button class="icon sm" data-act="rowAdd" data-id="${id}" title="${canAdd}">${ic('plus')}</button>` : ''}${kind === 'effect' ? '' : `<button class="icon sm" data-act="rowDel" data-id="${id}" title="Excluir">${ic('x')}</button>`}</div>`;
    el.innerHTML = row('effect', 'effect', d.effect, 'Qual é o problema?') + d.cats.map((c, i) => {
      const color = c.color || Fish.PAL[i % Fish.PAL.length];
      return row('cat', c.id, c.name, 'Categoria', color, 'Nova causa') + c.causes.map(ca => row('cause', ca.id, ca.text, 'Causa', color, 'Nova subcausa') + ca.subs.map(s => row('sub', s.id, s.text, 'Subcausa', color)).join('')).join('');
    }).join('') + `<button class="link addrow" data-act="addCat">${ic('plus')} Categoria</button>
      <p class="hint"><b>Enter</b> novo item · <b>Ctrl+Enter</b> item dentro · <b>Tab</b> / <b>Shift+Tab</b> muda o nível · <b>Alt+↑↓</b> reordena</p>`;
  }
  const focusRow = id => { const i = $(`#outline .orow[data-id="${id}"] input`); if (i) { i.focus(); i.select(); i.scrollIntoView({ block: 'nearest' }); } };
  function refresh(focusId) {
    if (focusId) sel = focusId;
    if (S.set.tab !== 'outline') { S.set.tab = 'outline'; renderPanel(); } else { renderOutline(); renderDetails(); }
    draw();
    if (focusId) focusRow(focusId);
  }
  function renderDetails() {
    const d = cur(), el = $('#details');
    if (!d || !el) return;
    const L = locate(d, sel) || { kind: 'effect' };
    if (L.kind === 'effect') {
      const all = d.cats.flatMap(c => c.causes.flatMap(ca => [ca, ...ca.subs]));
      el.innerHTML = `<h3>Resumo</h3><div class="stats"><div><b>${d.cats.length}</b>categorias</div><div><b>${all.length}</b>causas</div><div><b>${all.filter(n => n.root).length}</b>causas raiz</div><div><b>${all.filter(n => n.status === 'ok').length}</b>confirmadas</div></div>
        <label>Observações do diagrama</label><textarea data-f="notes" rows="4" placeholder="Contexto, equipe, data da análise…">${esc(d.notes)}</textarea>`;
      return;
    }
    const n = L.node;
    if (L.kind === 'cat') {
      const color = n.color || Fish.PAL[L.i % Fish.PAL.length];
      el.innerHTML = `<h3>Categoria</h3><label>Cor</label><div class="swatches">${Fish.PAL.map(c => `<button data-act="color" data-id="${c}" style="background:${c}" class="${c === color ? 'on' : ''}" title="${c}"></button>`).join('')}</div>
        <div class="row"><button class="btn ghost sm" data-act="rowAdd" data-id="${n.id}">${ic('plus')} Causa</button><button class="btn ghost sm" data-act="moveUp" title="Mover para antes">${ic('arrowu')}</button><button class="btn ghost sm" data-act="moveDown" title="Mover para depois">${ic('arrowd')}</button><button class="btn ghost sm danger" data-act="rowDel" data-id="${n.id}">${ic('trash')} Excluir</button></div>`;
      return;
    }
    el.innerHTML = `<h3>${L.kind === 'cause' ? 'Causa' : 'Subcausa'}</h3>
      <label>Situação</label><div class="seg">${Object.entries(STATUS).map(([k, v]) => `<button data-act="status" data-id="${k}" class="${n.status === k ? 'on' : ''}">${v}</button>`).join('')}</div>
      <div class="row between"><button class="btn ghost sm${n.root ? ' rooton' : ''}" data-act="root">${ic('star')} ${n.root ? 'Causa raiz' : 'Marcar como causa raiz'}</button>
        <div class="votes" title="Votos da equipe para priorizar"><span>Votos</span><button class="icon sm" data-act="vote" data-id="-1">−</button><b>${n.votes}</b><button class="icon sm" data-act="vote" data-id="1">+</button></div></div>
      ${L.kind === 'cause' ? `<label>Categoria</label><select data-f="cat">${d.cats.map(c => `<option value="${c.id}"${c === L.cat ? ' selected' : ''}>${esc(c.name || 'Categoria')}</option>`).join('')}</select>` : ''}
      <label>Observação</label><textarea data-f="note" rows="3" placeholder="Evidências, 5 porquês, dados…">${esc(n.note)}</textarea>
      <div class="row">${L.kind === 'cause' ? `<button class="btn ghost sm" data-act="rowAdd" data-id="${n.id}">${ic('plus')} Subcausa</button>` : ''}<button class="btn ghost sm" data-act="moveUp" title="Mover para cima">${ic('arrowu')}</button><button class="btn ghost sm" data-act="moveDown" title="Mover para baixo">${ic('arrowd')}</button><button class="btn ghost sm" data-act="newAction" title="Criar ação para esta causa">${ic('check')} Ação</button><button class="btn ghost sm danger" data-act="rowDel" data-id="${n.id}">${ic('trash')}</button></div>`;
  }
  const causeOptions = d => d.cats.flatMap(c => c.causes.flatMap(ca => [[ca.id, `${c.name || 'Categoria'} › ${ca.text || 'Causa'}`], ...ca.subs.map(s => [s.id, `${c.name || 'Categoria'} › ${ca.text || 'Causa'} › ${s.text || 'Subcausa'}`])]));
  function renderActions() {
    const d = cur(), el = $('#actions');
    if (!d || !el) return;
    const opts = causeOptions(d), f = (a, k, ph, type) => `<input data-f="${k}" value="${esc(a[k])}" placeholder="${ph}"${type ? ` type="${type}"` : ''} maxlength="300">`;
    el.innerHTML = `<p class="hint">Plano de ação 5W2H: o que será feito para eliminar as causas encontradas.</p>` + d.actions.map((a, i) => `<div class="acard ${a.status}" data-id="${a.id}">
        <div class="row between"><b>Ação ${i + 1}</b><span class="row"><select data-f="status">${Object.entries(ASTATUS).map(([k, v]) => `<option value="${k}"${a.status === k ? ' selected' : ''}>${v}</option>`).join('')}</select><button class="icon sm" data-act="delAction" data-id="${a.id}" title="Excluir ação">${ic('trash')}</button></span></div>
        <label>O quê</label>${f(a, 'what', 'O que será feito')}
        <label>Causa relacionada</label><select data-f="causeId"><option value="">—</option>${opts.map(([id, t]) => `<option value="${id}"${a.causeId === id ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>
        <div class="grid2"><div><label>Quem</label>${f(a, 'who', 'Responsável')}</div><div><label>Quando</label>${f(a, 'when', '', 'date')}</div></div>
        <details${a.why || a.where || a.how || a.cost ? ' open' : ''}><summary>Por quê, onde, como, quanto</summary>
          <label>Por quê</label>${f(a, 'why', 'Justificativa')}<label>Onde</label>${f(a, 'where', 'Local ou área')}<label>Como</label>${f(a, 'how', 'Método, etapas')}<label>Quanto</label>${f(a, 'cost', 'Custo estimado')}</details>
      </div>`).join('') + `<button class="btn ghost block" data-act="newAction">${ic('plus')} Nova ação</button>`;
  }
  function panelEvents() {
    const p = $('#panel');
    p.addEventListener('focusin', e => { const r = e.target.closest('.orow'); if (r && r.dataset.id !== sel) select(r.dataset.id); });
    p.addEventListener('input', e => {
      const t = e.target, row = t.closest('.orow'), card = t.closest('.acard'), f = t.dataset.f;
      if (row) {
        const id = row.dataset.id;
        mutate(d => { const L = locate(d, id); if (!L) return; if (L.kind === 'effect') d.effect = t.value; else L.node[L.kind === 'cat' ? 'name' : 'text'] = t.value; }, 'text:' + id);
        drawSoon();
      } else if (card) {
        mutate(d => { const a = d.actions.find(a => a.id === card.dataset.id); if (a) a[f] = t.value; }, 'act:' + card.dataset.id + f);
        if (f === 'status') card.className = 'acard ' + t.value;
      } else if (f === 'notes') mutate(d => { d.notes = t.value; }, 'notes');
      else if (f === 'note') mutate(d => { const L = locate(d, sel); if (L && L.node) L.node.note = t.value; }, 'note:' + sel);
      else if (f === 'cat') { moveToCat(sel, t.value); refresh(); }
    });
    p.addEventListener('keydown', async e => {
      const row = e.target.closest('.orow');
      if (!row || e.target.tagName !== 'INPUT') return;
      const id = row.dataset.id, kind = row.classList[1], rows = $$('#outline .orow'), i = rows.indexOf(row), k = e.key;
      if (k === 'Enter') { e.preventDefault(); refresh((e.ctrlKey || kind === 'effect' ? addChild : addSibling)(id)); }
      else if (k === 'Tab' && (kind === 'cause' && !e.shiftKey || kind === 'sub' && e.shiftKey)) { e.preventDefault(); (e.shiftKey ? outdent : indent)(id); refresh(id); }
      else if (k === 'Backspace' && !e.target.value && kind !== 'effect') { e.preventDefault(); const n = await askRemove(id); if (n) refresh(n); }
      else if (e.altKey && (k === 'ArrowUp' || k === 'ArrowDown') && kind !== 'effect') { e.preventDefault(); moveNode(id, k === 'ArrowUp' ? -1 : 1); refresh(id); }
      else if (k === 'ArrowUp' && rows[i - 1]) { e.preventDefault(); focusRow(rows[i - 1].dataset.id); }
      else if (k === 'ArrowDown' && rows[i + 1]) { e.preventDefault(); focusRow(rows[i + 1].dataset.id); }
    });
  }

  /* ---------- Exportações ---------- */
  const fname = d => (d.title || 'ishikawa').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80) || 'ishikawa';
  const svgOf = d => '<?xml version="1.0" encoding="UTF-8"?>\n' + Fish.render(d, { theme: 'light', bg: true, title: d.title }).svg;
  function exportPNG(d) {
    const r = Fish.render(d, { theme: 'light', bg: true, title: d.title }), img = new Image(), url = URL.createObjectURL(new Blob([r.svg], { type: 'image/svg+xml' }));
    img.onload = () => {
      const c = document.createElement('canvas'), k = Math.min(3, 8000 / r.w);
      c.width = r.w * k; c.height = r.h * k;
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      c.toBlob(b => download(fname(d) + '.png', 'image/png', b), 'image/png');
    };
    img.onerror = () => toast('Não foi possível gerar a imagem');
    img.src = url;
  }
  /* Documento para impressão: página 1 com o diagrama; depois, lista de causas e plano de ação. */
  function pdfDoc(d, o) {
    const [pw, ph] = o.paper === 'A3' ? [420, 297] : [297, 210];
    const mark = n => (n.root ? '★ ' : '') + esc(n.text || '—'), td = v => `<td>${v}</td>`;
    const rows = d.cats.flatMap(c => c.causes.flatMap(ca => [[c, ca, null], ...ca.subs.map(s => [c, ca, s])]))
      .map(([c, ca, s]) => { const n = s || ca; return `<tr class="${n.root ? 'root' : ''} ${n.status}">${td(esc(c.name || 'Categoria'))}${td(s ? esc(ca.text || '—') : mark(ca))}${td(s ? mark(s) : '')}${td(STATUS[n.status])}${td(n.votes || '')}${td(esc(n.note))}</tr>`; }).join('');
    const names = Object.fromEntries(causeOptions(d)), dt = v => /^\d{4}-\d\d-\d\d$/.test(v) ? v.split('-').reverse().join('/') : esc(v);
    const acts = d.actions.map((a, i) => `<tr>${td(i + 1)}${td(esc(a.what))}${td(esc(a.why))}${td(esc(a.who))}${td(dt(a.when))}${td(esc(a.where))}${td(esc(a.how))}${td(esc(a.cost))}${td(esc((names[a.causeId] || '').split(' › ').slice(1).join(' › ')))}${td(ASTATUS[a.status])}</tr>`).join('');
    const head = sub => `<header><div><h1>${esc(d.title || 'Diagrama de Ishikawa')}</h1><div class="sub">${sub}</div></div><div class="meta">Diagrama de Ishikawa (causa e efeito)<br>${fmtDate(Date.now())}</div></header>`;
    return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>${esc(d.title)}</title><style>
@page{size:${pw}mm ${ph}mm;margin:10mm}
*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}
body{margin:0;font:10.5pt 'Segoe UI',system-ui,sans-serif;color:#1f2937}
.page{height:${ph - 21}mm;display:flex;flex-direction:column;break-after:page}
section{break-before:page}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:10mm;border-bottom:2px solid #0e7490;padding-bottom:3mm;margin-bottom:4mm}
h1{font-size:17pt;margin:0}.sub{color:#475569;margin-top:1mm}.meta{font-size:8.5pt;color:#64748b;text-align:right;white-space:nowrap}
.fig{flex:1;min-height:0}.fig svg{display:block;width:100%;height:100%}
.legend{font-size:8.5pt;color:#64748b;margin-top:2mm}.notes{font-size:9.5pt;margin-top:2mm;white-space:pre-wrap}
table{width:100%;border-collapse:collapse;font-size:9pt;margin-bottom:6mm}th{background:#e2e8f0;text-align:left}
th.cap{background:none;border:0;padding:0 0 2.5mm;font-size:12.5pt}th,td{border:1px solid #cbd5e1;padding:1.5mm 2mm;vertical-align:top}tr{break-inside:avoid}
tr.root td{background:#fef2f2}tr.no td{color:#9ca3af}tr.ok td:nth-child(4){color:#047857;font-weight:600}
</style></head><body>
<div class="page">${head(d.effect ? 'Efeito: ' + esc(d.effect) : '')}<div class="fig">${Fish.render(d, { theme: 'light', fluid: true }).svg}</div>
<div class="legend">★ causa raiz · ✓ causa confirmada · riscado: causa descartada · ▲ votos da equipe</div>${o.notes && d.notes.trim() ? `<div class="notes"><b>Observações:</b> ${esc(d.notes)}</div>` : ''}</div>
${(o.causes && rows) || (o.actions && acts) ? `<section>${head('Detalhamento')}
${o.causes && rows ? `<table><thead><tr><th class="cap" colspan="6">Causas levantadas</th></tr><tr><th>Categoria</th><th>Causa</th><th>Subcausa</th><th>Situação</th><th>Votos</th><th>Observação</th></tr></thead><tbody>${rows}</tbody></table>` : ''}
${o.actions && acts ? `<table><thead><tr><th class="cap" colspan="10">Plano de ação (5W2H)</th></tr><tr><th>#</th><th>O quê</th><th>Por quê</th><th>Quem</th><th>Quando</th><th>Onde</th><th>Como</th><th>Quanto</th><th>Causa</th><th>Status</th></tr></thead><tbody>${acts}</tbody></table>` : ''}</section>` : ''}
</body></html>`;
  }
  const api = (path, opt = {}) => fetch('api/' + path, Object.assign({ cache: 'no-store' }, opt, { headers: { 'X-Ishikawa': '1' } }));
  function pdfModal() {
    const d = cur(), p = S.set.pdf || { paper: 'A4', causes: true, actions: true, notes: true };
    const m = modal({ title: 'Exportar em PDF', body: `
      <label>Tamanho do papel (paisagem)</label><select id="pdfpaper"><option>A4</option><option>A3</option></select>
      <label class="check"><input type="checkbox" id="pdfcauses"${p.causes ? ' checked' : ''}> Incluir a lista de causas com situação, votos e observações</label>
      <label class="check"><input type="checkbox" id="pdfactions"${p.actions ? ' checked' : ''}> Incluir o plano de ação (5W2H)</label>
      <label class="check"><input type="checkbox" id="pdfnotes"${p.notes ? ' checked' : ''}> Incluir as observações do diagrama</label>
      <p class="muted">${Sync.avail ? 'O arquivo é gerado direto, sem passar pela tela de impressão.' : 'Na janela de impressão, escolha "Salvar como PDF" como destino.'}</p>
      <div class="mfoot"><button class="btn ghost" data-close>Cancelar</button><button class="btn" id="pdfok">${ic('pdf')} Gerar PDF</button></div>` });
    $('#pdfpaper', m.el).value = p.paper;
    $('#pdfok', m.el).onclick = async () => {
      const o = { paper: $('#pdfpaper', m.el).value, causes: $('#pdfcauses', m.el).checked, actions: $('#pdfactions', m.el).checked, notes: $('#pdfnotes', m.el).checked };
      S.set.pdf = o; Store.saveSet();
      const html = pdfDoc(d, o);
      m.close();
      if (!Sync.avail) return printDoc(html);
      toast('Escolha onde salvar o PDF na janela que abriu');
      try {
        const r = await api('pdf', { method: 'POST', body: fname(d) + '\n' + html });
        if (r.status === 204) return toast('Exportação cancelada');
        if (!r.ok) throw new Error();
        toast('PDF salvo em ' + (await r.json()).saved, { label: 'Abrir', fn: () => api('open', { method: 'POST' }) });
      } catch (e) { toast('Não foi possível gerar o arquivo; usando a impressão'); printDoc(html); }
    };
  }
  function printDoc(html) {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    f.onload = () => { f.contentWindow.focus(); f.contentWindow.print(); setTimeout(() => f.remove(), 120000); };
    f.srcdoc = html;
    document.body.append(f);
  }
  const backupData = list => JSON.stringify({ app: 'ishikawa', version: 1, exported: Date.now(), diagrams: list });
  async function importFiles() {
    let total = 0, lastId;
    for (const f of await pickFiles('.json')) {
      try {
        const j = JSON.parse(await f.text());
        if (j.app !== 'ishikawa' || !Array.isArray(j.diagrams)) throw new Error('não é um arquivo do Ishikawa');
        for (const o of j.diagrams) {
          if (!o || !o.id) continue;
          normalize(o);
          const i = S.diagrams.findIndex(x => x.id === o.id);
          if (i >= 0) S.diagrams[i] = o; else S.diagrams.push(o);
          DB.put('diagrams', o); H.delete(o.id);
          total++; if (!o.deleted) lastId = o.id;
        }
      } catch (e) { toast(`Falha ao importar "${f.name}": ${e.message}`); }
    }
    if (total) { toast(count(total, 'diagrama importado', 'diagramas importados')); dirty = false; if (lastId) openDiagram(lastId); else renderAll(); }
  }

  /* ---------- Sincronização com pasta do Google Drive (só no app de Windows) ---------- */
  async function syncInfo(r) {
    try {
      r = r || await api('sync/info');
      if (!r.ok) throw new Error('sem API');
      const j = await r.json();
      Object.assign(Sync, { avail: true, on: j.enabled, folder: j.folder, detected: j.detected, drives: j.drives || [] });
    } catch (e) { Sync.avail = Sync.on = false; }
  }
  const syncSig = d => (d.diagrams || []).map(o => o.id + ':' + (o.mod || 0)).sort().join(',') + '|' + Object.keys(d.tombstones || {}).sort().join(',');
  function mergeRemote(remote) {
    const tomb = DB.tomb();
    let n = 0;
    for (const [k, ts] of Object.entries(remote.tombstones || {})) {
      const id = k.split(':')[1], i = S.diagrams.findIndex(o => o.id === id);
      if (i >= 0 && (S.diagrams[i].mod || 0) <= ts) { S.diagrams.splice(i, 1); DB.del('diagrams', id, true); H.delete(id); n++; }
      if (!(tomb[k] >= ts)) tomb[k] = ts;
    }
    for (const o of remote.diagrams || []) {
      if (!o || !o.id || (tomb['diagrams:' + o.id] || 0) >= (o.mod || 0)) continue;
      const i = S.diagrams.findIndex(x => x.id === o.id);
      if (i >= 0 && (o.mod || 0) <= (S.diagrams[i].mod || 0)) continue;
      normalize(o);
      if (i < 0) S.diagrams.push(o); else S.diagrams[i] = o;
      DB.put('diagrams', o, true); H.delete(o.id); n++;
    }
    DB.saveTomb();
    return n;
  }
  /* Primeira sincronização num aparelho novo: troca o diagrama de exemplo pelo que já está no Drive. */
  function dropSeed() {
    S.diagrams.filter(o => o.seed).forEach(o => { S.diagrams = S.diagrams.filter(x => x !== o); DB.del('diagrams', o.id, true); });
  }
  async function syncNow(manual) {
    if (!Sync.on) return;
    if (Sync.busy) { Sync.again = true; return; }
    Sync.busy = true;
    try {
      commit();
      const r = await api('sync');
      if (!r.ok) throw new Error('não foi possível ler a pasta');
      const text = r.status === 200 ? await r.text() : '', remote = text.trim() ? JSON.parse(text) : null;
      let pulled = 0;
      if (remote && remote.app === 'ishikawa') {
        if (!S.set.syncedOnce && (remote.diagrams || []).length) dropSeed();
        commit(); // nada digitado durante a leitura pode ficar para trás
        pulled = mergeRemote(remote);
      }
      const local = { app: 'ishikawa', version: 1, exported: Date.now(), diagrams: S.diagrams, tombstones: DB.tomb() };
      if (!remote || syncSig(remote) !== syncSig(local)) {
        const w = await api('sync', { method: 'POST', body: JSON.stringify(local) });
        if (!w.ok) throw new Error('não foi possível gravar na pasta');
      }
      if (!S.set.syncedOnce) { S.set.syncedOnce = true; Store.saveSet(); }
      Sync.last = Date.now(); Sync.error = '';
      if (pulled) {
        const had = S.set.cur;
        if (!cur()) { S.set.cur = (live().sort((a, b) => b.updated - a.updated)[0] || {}).id || null; sel = 'effect'; }
        if (cur() && !locate(cur(), sel)) sel = 'effect';
        // não redesenha o painel por cima de quem está digitando
        if (document.activeElement && document.activeElement.closest('#panel,.inplace,#title') && had === S.set.cur) { renderSide(); draw(); } else renderAll();
      } else sideSoon();
      if (manual) toast(pulled ? `Sincronizado: ${count(pulled, 'diagrama atualizado', 'diagramas atualizados')}` : 'Sincronizado com o Google Drive');
    } catch (e) {
      console.error(e); Sync.error = e.message; sideSoon();
      if (manual) toast('Falha ao sincronizar: ' + e.message);
    }
    Sync.busy = false;
    if (Sync.again) { Sync.again = false; syncSoon(); }
  }
  const syncSoon = debounce(() => syncNow(), 4000);
  async function syncConfig(route, body) {
    await syncInfo(await api(route, { method: 'POST', body }));
    if (Sync.on) await syncNow(true); else renderSide();
  }

  function settingsModal() {
    const m = modal({ title: 'Ajustes', body: `
      <label>Tema</label><select id="settheme"><option value="auto">Automático (segue o sistema)</option><option value="light">Claro</option><option value="dark">Escuro</option></select>
      ${Sync.avail ? `<label>Sincronização com o Google Drive</label>
      <p style="margin:0 0 6px">${Sync.on ? `Ativa em <b>${esc(Sync.folder)}</b>${Sync.error ? ` · <span class="err">${esc(Sync.error)}</span>` : Sync.last ? ` · última vez ${fmtRel(Sync.last)}` : ''}` : Sync.detected ? 'Desativada. Google Drive encontrado neste computador.' : 'Desativada. Não encontrei o Google Drive; escolha uma pasta sincronizada.'}</p>
      <div class="row">${Sync.on ? `<button class="btn ghost sm" data-k="syncnow">Sincronizar agora</button><button class="btn ghost sm" data-k="syncoff">Desativar</button>` : Sync.detected ? `<button class="btn sm" data-k="syncauto">Ativar no Google Drive</button>` : ''}${Sync.drives.filter(d => d !== Sync.folder && (Sync.on || d !== Sync.detected)).map(d => `<button class="btn ghost sm" data-k="syncuse" data-path="${esc(d)}">Usar ${esc(d)}</button>`).join('')}<button class="btn ghost sm" data-k="syncpick">Escolher outra pasta…</button></div>
      ${Sync.drives.length > 1 ? '<p class="muted">Há mais de uma conta do Google Drive neste computador: cada unidade (G:, H:…) é uma conta.</p>' : ''}
      <p class="muted">O Ishikawa grava o arquivo ishikawa-sync.json nessa pasta a cada alteração e o Google Drive o envia para a sua conta. Outro computador com o Ishikawa e o mesmo Drive recebe os diagramas automaticamente.</p>` : '<label>Sincronização</label><p class="muted">A sincronização automática com o Google Drive funciona no aplicativo de Windows (Ishikawa.exe). Aqui, use o backup abaixo para levar os diagramas a outro aparelho.</p>'}
      <label>Backup e migração</label>
      <div class="row"><button class="btn ghost sm" data-k="backup">${ic('dl')} Exportar backup (.json)</button><button class="btn ghost sm" data-k="import">${ic('up')} Importar…</button></div>
      <p class="muted">${DB.persistent() ? 'Dados salvos neste dispositivo' : 'Atenção: armazenamento indisponível, os dados somem ao fechar'} · ${count(live().length, 'diagrama', 'diagramas')} · Ishikawa 1.0</p>
      <label>Zona de perigo</label><button class="btn danger sm" data-k="wipe">Apagar todos os dados deste dispositivo</button>` });
    $('#settheme', m.el).value = S.set.theme;
    $('#settheme', m.el).onchange = e => { S.set.theme = e.target.value; Store.saveSet(); applyTheme(); draw(); };
    m.el.addEventListener('click', async e => {
      const b = e.target.closest('[data-k]'), k = b && b.dataset.k, again = () => { m.close(); settingsModal(); };
      if (k === 'backup') { commit(); download(`ishikawa-backup-${today()}.json`, 'application/json', backupData(S.diagrams)); }
      if (k === 'import') { m.close(); importFiles(); }
      if (k === 'syncnow') { await syncNow(true); again(); }
      if (k === 'syncoff') { await syncConfig('sync/config', 'off'); again(); }
      if (k === 'syncauto') { await syncConfig('sync/config', 'auto'); again(); }
      if (k === 'syncuse') { await syncConfig('sync/config', b.dataset.path); again(); }
      if (k === 'syncpick') { toast('Escolha a pasta na janela que abriu'); await syncConfig('sync/choose', ''); again(); }
      if (k === 'wipe' && await confirmBox('Apagar tudo', 'Todos os diagramas deste dispositivo serão apagados. Isso não pode ser desfeito.' + (Sync.on ? ' A sincronização será desativada e a cópia no Google Drive continua lá.' : ''), 'Apagar tudo', true)) {
        if (Sync.on) await api('sync/config', { method: 'POST', body: 'off' });
        dirty = false;
        for (const s of DB.STORES) await DB.clear(s);
        location.reload();
      }
    });
  }

  /* ---------- Ações ---------- */
  const withSel = fn => { const d = cur(), L = d && locate(d, sel); if (L && L.node) { mutate(x => fn(locate(x, sel).node)); renderDetails(); draw(); } };
  const ACT = {
    openSide: () => document.body.classList.add('side-open'),
    closeSide: () => document.body.classList.remove('side-open'),
    newDiagram: newDiagramModal,
    open: id => openDiagram(id),
    toggleTrash() { showTrash = !showTrash; renderSide(); },
    settings: settingsModal,
    itemMenu(id, el) {
      const d = S.diagrams.find(x => x.id === id);
      popmenu(el, [{ label: 'Duplicar', icon: 'copy', fn: () => { commit(); duplicate(d); } }, { label: 'Exportar arquivo (.json)', icon: 'dl', fn: () => { commit(); download(fname(d) + '.json', 'application/json', backupData([d])); } }, '-', { label: 'Mover para a lixeira', icon: 'trash', danger: true, fn: () => toTrash(d) }]);
    },
    trashMenu(id, el) {
      const d = S.diagrams.find(x => x.id === id);
      popmenu(el, [{ label: 'Restaurar', icon: 'undo', fn: () => { d.deleted = null; DB.put('diagrams', d); openDiagram(d.id); } }, { label: 'Excluir para sempre', icon: 'trash', danger: true, fn: async () => {
        if (!await confirmBox('Excluir para sempre', `"${d.title}" não poderá ser recuperado.`, 'Excluir', true)) return;
        S.diagrams = S.diagrams.filter(x => x !== d); DB.del('diagrams', d.id); H.delete(d.id);
        if (!S.diagrams.some(x => x.deleted)) showTrash = false;
        renderSide();
      } }]);
    },
    undo: () => undo(false),
    redo: () => undo(true),
    addCat: () => refresh(addChild('effect')),
    addCause() {
      const d = cur(), L = locate(d, sel) || {};
      if (!d.cats.length) return ACT.addCat();
      refresh(L.kind === 'cause' ? addSibling(sel) : addChild((L.cat || d.cats[0]).id));
    },
    addSub() {
      const L = locate(cur(), sel) || {};
      if (!L.cause) return toast('Selecione uma causa para criar a subcausa');
      refresh(addChild(sel));
    },
    rowAdd: id => refresh(addChild(id)),
    async rowDel(id) { const n = await askRemove(id); if (n) { sel = n; refresh(); } },
    moveUp() { moveNode(sel, -1); refresh(); },
    moveDown() { moveNode(sel, 1); refresh(); },
    status: v => withSel(n => { n.status = v; }),
    root: () => withSel(n => { n.root = !n.root; }),
    vote: v => withSel(n => { n.votes = Math.max(0, (n.votes || 0) + +v); }),
    color(c) { withSel(n => { n.color = c; }); renderOutline(); },
    tab(id) { S.set.tab = id; Store.saveSet(); renderPanel(); },
    togglePanel() { S.set.panel = !S.set.panel; Store.saveSet(); renderPanel(); },
    newAction() {
      const L = locate(cur(), sel) || {};
      mutate(d => d.actions.push({ id: uid(), what: '', why: '', who: '', when: '', where: '', how: '', cost: '', causeId: L.kind === 'cause' || L.kind === 'sub' ? sel : '', status: 'todo' }));
      S.set.tab = 'actions'; S.set.panel = true; renderPanel();
      const last = $$('#actions .acard').pop();
      if (last) { last.scrollIntoView({ block: 'nearest' }); $('input', last).focus(); }
    },
    delAction(id) { mutate(d => { d.actions = d.actions.filter(a => a.id !== id); }); renderPanel(); },
    exportMenu(_, el) {
      const d = cur();
      commit();
      popmenu(el, [
        { label: 'PDF…', icon: 'pdf', fn: pdfModal },
        { label: 'Imagem PNG', icon: 'img', fn: () => exportPNG(d) },
        { label: 'Vetor SVG', icon: 'code', fn: () => download(fname(d) + '.svg', 'image/svg+xml', svgOf(d)) },
        '-',
        { label: 'Arquivo do Ishikawa (.json)', icon: 'dl', fn: () => download(fname(d) + '.json', 'application/json', backupData([d])) },
      ]);
    },
    zoomIn: () => zoom(1.2), zoomOut: () => zoom(1 / 1.2), fit,
  };

  function renderAll() { renderSide(); renderTop(); renderPanel(); draw(); }

  async function init() {
    await Store.load();
    applyTheme();
    if (!cur()) S.set.cur = (live().sort((a, b) => b.updated - a.updated)[0] || {}).id || null;
    $('#stage').insertAdjacentHTML('beforeend', `<div id="empty" hidden>${LOGO}<h2>Nenhum diagrama aberto</h2><p>Crie um diagrama de causa e efeito para começar a análise.</p><button class="btn" data-act="newDiagram">${ic('plus')} Novo diagrama</button></div>
      <div id="zoombar"><button class="icon sm" data-act="zoomOut" title="Diminuir">−</button><span id="zoomv">100%</span><button class="icon sm" data-act="zoomIn" title="Aumentar">+</button><button class="icon sm" data-act="fit" title="Ajustar à tela">${ic('fit')}</button></div>`);
    renderAll();
    stageEvents(); panelEvents();
    requestAnimationFrame(fit);

    document.addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || !ACT[b.dataset.act]) return;
      if (b.classList.contains('ditem') && e.target.closest('button')) return; // o botão ⋯ dentro do item tem ação própria
      ACT[b.dataset.act](b.dataset.id, b);
    });
    document.addEventListener('input', e => {
      if (e.target.id === 'q') { query = e.target.value; renderSide(); const q = $('#q'); q.focus(); q.setSelectionRange(query.length, query.length); }
      if (e.target.id === 'title') mutate(d => { d.title = e.target.value; }, 'title');
    });
    document.addEventListener('keydown', e => {
      if (!(e.ctrlKey || e.metaKey) || e.target.closest('.modal,.inplace,#q')) return;
      const k = e.key.toLowerCase();
      if (k === 'z' || k === 'y') { e.preventDefault(); undo(k === 'y' || e.shiftKey); }
      if (k === 'p') { e.preventDefault(); if (cur()) pdfModal(); }
    });
    $('#scrim').onclick = () => document.body.classList.remove('side-open');
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyTheme(); draw(); });
    addEventListener('beforeunload', commit);
    document.addEventListener('visibilitychange', () => { if (document.hidden) commit(); });
    setInterval(() => { if (!$('.modalwrap') && document.activeElement !== $('#q')) renderSide(); }, 60000);

    if (/^https?:$/.test(location.protocol)) await syncInfo();
    if (Sync.avail) {
      const first = Sync.on && !S.set.syncedOnce;
      DB.onChange = () => { if (Sync.on) syncSoon(); };
      await syncNow();
      if (first && !Sync.error) toast('Sincronizando com o Google Drive: ' + Sync.folder);
      setInterval(() => syncNow(), 60000);
      addEventListener('focus', () => syncNow());
      fit();
    }
  }
  init();
})();
