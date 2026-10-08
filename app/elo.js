/* Elo: os vínculos do Pepsi Doidão Workspace dentro de cada app.
   1) Mostra, numa aba na lateral, os itens deste app ligados a itens de outros apps.
   2) Abre direto um item quando o endereço traz ?wsitem=loja:id (ou quando o Workspace pede).
   3) Recebe as cópias enviadas pelo Workspace (caixa de entrada) e cria o item pelo próprio app.
   4) Mantém as cópias espelhadas: título e data nos dois sentidos; o texto, do original para a cópia.
   Os itens 2 a 4 valem nos apps que têm adaptador abaixo (Frondosa, Alvorada, Capynote e Kanban). */
(function () {
  'use strict';
  var sc = document.currentScript, APP = sc && sc.dataset.app;
  if (!APP || window.EloLib) return;
  var ORIGIN = location.origin;
  var NAMES = { 'kanban': 'Kanban', 'blocos': 'Blocos', 'blocos2': 'Blocos 2', 'blocos3': 'Blocos 3', 'orbita': 'Órbita', 'frondosa': 'Frondosa', 'alvorada.jgmrossi': 'Alvorada', 'capynote': 'Capynote', 'folhear': 'Folhear', 'prisma': 'Prisma', 'lousa': 'Lousa', 'ishikawa': 'Ishikawa', 'blocos-sem-fim': 'Blocos Sem Fim' };
  var SRC = { 'kanban': { ls: 'kanban-v1' }, 'blocos': { ls: 'blocos-v1' }, 'blocos2': { ls: 'blocos2-v1' }, 'blocos3': { ls: 'blocos3-v1' }, 'orbita': { ls: 'orbita-v1' }, 'frondosa': { idb: 'frondosa' }, 'alvorada.jgmrossi': { idb: 'alvorada' }, 'capynote': { idb: 'capynote' }, 'folhear': { idb: 'folhear' }, 'prisma': { idb: 'prisma' }, 'lousa': { idb: 'lousa' }, 'ishikawa': { idb: 'ishikawa' } };
  var TKEYS = ['title', 'titulo', 'nome', 'name', 'acao', 'effect'], BKEYS = ['text', 'texto', 'note', 'notes', 'notas', 'desc', 'content', 'html'], DKEYS = ['due', 'prazo', 'date', 'dia', 'start'];

  function ls(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function plain(h) { return String(h || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ').trim(); }
  function esc(v) { return String(v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function pick(r, keys) { for (var i = 0; i < keys.length; i++) if (typeof r[keys[i]] === 'string' && r[keys[i]].trim()) return r[keys[i]]; return ''; }
  function parse(key) { var p = String(key).split(':'); return { key: key, app: p[0], store: p[1], id: p.slice(2).join(':') }; }
  function typing() { var a = document.activeElement; return !!(a && (a.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName))); }
  function tell(msg) { try { if (window.parent !== window) window.parent.postMessage(msg, ORIGIN); } catch (e) {} }
  /* o texto de uma cópia: o do original mais uma linha dizendo de onde veio (igual ao que o Workspace escreve) */
  function originLine(app, kind, title) { return 'Origem: ' + (NAMES[app] || app) + ' · ' + kind + ' “' + title + '”'; }
  function textOf(body, line) { return (body ? body + '\n\n' : '') + line; }
  function htmlOf(body, line) { return (body ? '<p>' + esc(body) + '</p>' : '') + '<p><i>' + esc(line) + '</i></p>'; }

  /* lê um registro de outro app direto do armazenamento dele, sem criar nem alterar nada */
  function readRaw(p) {
    var src = SRC[p.app];
    if (!src) return Promise.resolve(null);
    if (src.ls) { var d = ls(src.ls), list = d && d[p.store]; return Promise.resolve(Array.isArray(list) ? list.filter(function (r) { return r && String(r.id) === p.id; })[0] || null : null); }
    if (!window.indexedDB || !indexedDB.databases) return Promise.resolve(null);
    return indexedDB.databases().then(function (dbs) {
      if (!dbs.some(function (x) { return x.name === src.idb; })) return null;
      return new Promise(function (res) {
        var rq = indexedDB.open(src.idb);
        rq.onupgradeneeded = function () { try { rq.transaction.abort(); } catch (e) {} };
        rq.onerror = rq.onblocked = function () { res(null); };
        rq.onsuccess = function () {
          var db = rq.result;
          if (!db.objectStoreNames.contains(p.store)) { db.close(); return res(null); }
          var g = db.transaction(p.store, 'readonly').objectStore(p.store).get(p.id);
          g.onsuccess = function () { db.close(); res(g.result || null); }; g.onerror = function () { db.close(); res(null); };
        };
      });
    }).catch(function () { return null; });
  }
  /* uma rotina do Órbita não tem texto: o horário e os dias viram o texto (igual ao que o Workspace escreve) */
  function routineText(r) {
    if (!r || !/^\d{2}:\d{2}$/.test(r.start || '') || !Array.isArray(r.days)) return '';
    var D = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'], days = r.days.map(function (d) { return D[d] || ''; }).filter(Boolean).join(', ');
    return 'Rotina às ' + r.start + (r.dur ? ', ' + r.dur + ' min' : '') + (days ? ', ' + days : '');
  }
  function view(r) {
    var d = pick(r, DKEYS).slice(0, 10);
    return { t: plain(pick(r, TKEYS)).slice(0, 160), b: plain(pick(r, BKEYS)).slice(0, 4000) || routineText(r), d: /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : '', mod: +r.mod || +r.updated || 0 };
  }

  /* ---------- adaptadores: como cada app guarda, cria, abre e redesenha ---------- */
  function find(s, id) { var l = ad && ad.list ? ad.list(s) : (typeof S !== 'undefined' && S[s]) || []; for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i]; return null; }
  function ymd() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ord(a, b) { return (a.ordem || 0) - (b.ordem || 0); }
  var AD = {
    'frondosa': {
      sign: '#bar', f: { tasks: { t: 'title', d: 'due', b: 'note' }, events: { t: 'title', d: 'date' } },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { App.synced(true); },
      create: function (e) {
        if (e.store === 'events') Data.put('events', NORM.events({ id: e.id, title: e.title, date: e.date }));
        else Data.put('tasks', NORM.tasks({ id: e.id, title: e.title, note: e.text, due: e.date, order: S.tasks.reduce(function (m, t) { return Math.max(m, t.order || 0); }, 0) + 1 }));
      },
      done: function (s, r, on) { r.done = on ? Date.now() : 0; },
      open: function (s, r) { if (App.open) App.open(s === 'events' ? { type: 'cal', month: r.date.slice(0, 7), sel: r.date } : { type: 'task', id: r.id }); }
    },
    'capynote': {
      sign: '#sidebar', f: { notes: { t: 'title', b: 'content', html: 1 }, tasks: { t: 'title', d: 'due' } },
      save: function (s, r) { if (s === 'notes') { r.updated = Date.now(); r.text = plain(r.content); } DB.put(s, r); },
      refresh: function () { if (App.render) App.render(); else App.go(S.view); },
      create: function (e) {
        if (e.store === 'tasks') { var t = { id: e.id, title: e.title, done: false, due: e.date || '', flag: false, noteId: '', created: Date.now() }; S.tasks.push(t); DB.put('tasks', t); }
        else Store.newNote({ id: e.id, title: e.title, content: e.html });
      },
      done: function (s, r, on) { r.done = !!on; },
      open: function (s, r) { if (s === 'notes') App.openNote(r.id); else App.go({ type: 'tasks' }); }
    },
    'alvorada.jgmrossi': {
      sign: '#view', f: { items: { t: 'title', d: 'due', b: 'desc' }, notes: { t: 'title', b: 'html', html: 1 } },
      fields: function (s, r) { return s === 'notes' ? this.f.notes : r.type === 'task' ? this.f.items : { t: 'title', b: 'desc' }; },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { App.render(true); },
      create: function (e) {
        if (e.store === 'notes') Data.put('notes', NORM.notes({ id: e.id, title: e.title, html: e.html, page: true }));
        else Data.put('items', newItem('task', { id: e.id, title: e.title, desc: e.text, due: e.date || '' }));
      },
      done: function (s, r, on) { r.status = on ? 'done' : 'todo'; r.doneAt = on ? Date.now() : 0; },
      open: function (s, r) { if (s === 'notes') App.go('journal', null, r.id); else Editor.open(r); }
    },
    'kanban': {
      sign: '#side', f: { cartoes: { t: 'titulo', d: 'prazo', b: 'texto' } },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { R(); },
      create: function (e) {
        var now = Date.now(), q = S.quadros.filter(function (x) { return !x.arquivado; }).sort(ord)[0] || Data.put('quadros', { nome: 'Entrada do Workspace', ordem: 1, criado: now });
        var l = S.listas.filter(function (x) { return x.quadro === q.id && !x.arquivada; }).sort(ord)[0] || Data.put('listas', { quadro: q.id, nome: 'A fazer', ordem: 1 });
        var top = function (list, k) { return list.reduce(function (m, c) { return Math.max(m, c[k] || 0); }, 0) + 1; };
        Data.put('cartoes', { id: e.id, quadro: q.id, lista: l.id, titulo: e.title, texto: e.text, prazo: e.date || '', ordem: top(S.cartoes.filter(function (c) { return c.lista === l.id; }), 'ordem'), criado: now, entrou: now, num: top(S.cartoes.filter(function (c) { return c.quadro === q.id; }), 'num') });
      },
      done: function (s, r, on) { r.feito = on ? Date.now() : 0; },
      open: function (s, r) { abrirCartao(r); }
    },
    'blocos': {
      sign: '#main', f: { blocos: { t: 'acao', d: 'prazo', b: 'notas' } },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { draw(); },
      create: function (e) {
        var b = capturar('Item do Workspace', null, false); // nasce na Caixa de entrada, com tipo e tamanho padrão
        if (!b) throw new Error('sem onde criar');
        b.id = e.id; b.acao = String(e.title).slice(0, 120); b.saida = 'Feito: ' + String(e.title).slice(0, 100); b.notas = e.text; b.prazo = e.date || '';
        Data.put('blocos', b);
      },
      done: function (s, r, on) { r.feito = on ? Date.now() : 0; if (on) { r.inicio = 0; if (!r.dia) r.dia = ymd(); } },
      open: function (s, r) { sheetBloco(r.id); }
    },
    'blocos2': {
      sign: '#main', f: { blocos: { t: 'titulo', d: 'prazo', b: 'texto' } },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { draw(); },
      create: function (e) { novo({ id: e.id, titulo: e.title, texto: e.text, prazo: e.date || '' }); DB.changed(); },
      done: function (s, r, on) { r.feito = on ? Date.now() : 0; },
      open: function (s, r) { sheetBloco(r.id); }
    },
    'blocos3': {
      sign: '#main', f: { pecas: { t: 'titulo', d: 'prazo', b: 'notas' } },
      save: function (s, r) { Data.put(s, r); },
      refresh: function () { draw(); },
      create: function (e) {
        var o = S.obras.filter(function (x) { return !x.arquivada; }).sort(ord)[0];
        if (!o) throw new Error('crie uma obra no Blocos 3 primeiro');
        var p = novaTarefa(o.id, 'Item do Workspace', true); // ocupa a próxima peça livre da planta
        if (!p) throw new Error('sem peça livre');
        p.id = e.id; p.titulo = e.title; p.notas = e.text; p.prazo = e.date || '';
        Data.put('pecas', p);
      },
      done: function (s, r, on) { r.feito = on ? Date.now() : 0; },
      open: function (s, r) { abrir(r.obra, r.id); }
    },
    'orbita': {
      sign: '#panel', f: { tasks: { t: 'title', d: 'due', b: 'notes' }, routines: { t: 'title' } },
      ok: function () { return !!window.OrbitaAPI; },
      list: function (s) { return s === 'tasks' ? OrbitaAPI.tasks() : s === 'routines' && OrbitaAPI.routines ? OrbitaAPI.routines() : []; },
      save: function () { OrbitaAPI.save(); },
      refresh: function () {},
      create: function (e) { OrbitaAPI.add({ id: e.id, title: e.title, notes: e.text, due: e.date || '' }); OrbitaAPI.save(); },
      done: function (s, r, on) { r.done = !!on; r.doneAt = on ? Date.now() : 0; },
      open: function (s, r) { if (s === 'routines') { if (OrbitaAPI.openR) OrbitaAPI.openR(r.id); } else OrbitaAPI.open(r.id); }
    },
    /* apps de documentos: aqui só faz sentido abrir direto no item */
    'ishikawa': { loose: true, f: { diagrams: {} }, ok: function () { return !!window.EloOpen; }, open: function (s, r) { EloOpen(r.id); } },
    'prisma': { loose: true, f: { boards: {} }, ok: function () { return !!window.EloOpen; }, open: function (s, r) { EloOpen(r.id); } },
    'lousa': { loose: true, f: { screens: {} }, ok: function () { return !!window.EloOpen; }, open: function (s, r) { EloOpen(r.id); } },
    'folhear': { loose: true, f: { books: {} }, ok: function () { return typeof openBook === 'function'; }, open: function (s, r) { openBook(r.id); } }
  };
  /* onde existe a ideia de "concluído" */
  var DONE = { 'frondosa': { tasks: 1 }, 'capynote': { tasks: 1 }, 'alvorada.jgmrossi': { items: 1 }, 'kanban': { cartoes: 1 }, 'blocos': { blocos: 1 }, 'blocos2': { blocos: 1 }, 'blocos3': { pecas: 1 }, 'orbita': { tasks: 1 } };
  var ad = AD[APP] || null, isReady = false, running = false;
  /* todos os itens ligados a este, direta ou indiretamente */
  function group(key) {
    var P = ls('workspace-v1'), links = (P && P.links) || {}, seen = {}, q = [key]; seen[key] = 1;
    while (q.length) { var c = q.pop(); for (var k in links) { var L = links[k]; if (!L || !L.on) continue; var o = L.a === c ? L.b : L.b === c ? L.a : null; if (o && !seen[o]) { seen[o] = 1; q.push(o); } } }
    return Object.keys(seen);
  }
  function canDone(key) { return group(key).some(function (k) { var p = parse(k); return DONE[p.app] && DONE[p.app][p.store]; }); }
  /* conclui (ou reabre) o item e todos os ligados a ele: cada app recebe o pedido na sua caixa de entrada */
  function doneAll(key, on) {
    var apps = {};
    group(key).forEach(function (k) {
      var p = parse(k); if (!DONE[p.app] || !DONE[p.app][p.store]) return;
      var ik = 'ws-inbox:' + p.app, list = ls(ik); if (!Array.isArray(list)) list = [];
      list.push({ op: 'done', store: p.store, id: p.id, on: !!on, at: Date.now() });
      try { localStorage.setItem(ik, JSON.stringify(list)); } catch (e) {}
      apps[p.app] = 1;
    });
    consume();
    var others = Object.keys(apps).filter(function (a) { return a !== APP; });
    if (others.length) tell({ ws: 'deliver', apps: others });
  }
  function fieldsOf(s, r) { return ad.fields ? ad.fields(s, r) : ad.f[s]; }

  /* ---------- caixa de entrada: cópias enviadas pelo Workspace ---------- */
  function consume() {
    if (!ad || !isReady || ad.loose) return;
    var k = 'ws-inbox:' + APP, list = ls(k);
    if (!Array.isArray(list) || !list.length) return;
    try { localStorage.removeItem(k); } catch (e) {}
    var ids = [], failed = [];
    list.forEach(function (e) {
      try { if (e && e.op === 'done') { var r = find(e.store, e.id); if (r && ad.done && DONE[APP] && DONE[APP][e.store]) { ad.done(e.store, r, !!e.on); ad.save(e.store, r); } ids.push(e.id); } else if (e && e.id && ad.f[e.store]) { if (!find(e.store, e.id)) ad.create(e); ids.push(e.id); } } catch (err) { console.warn('Elo: não foi possível aplicar o pedido recebido', err); if (e && Date.now() - (e.at || 0) < 7 * 864e5) failed.push(e); }
    });
    // o que não deu para aplicar agora (por exemplo, falta uma obra no Blocos 3) volta para a fila
    if (failed.length) try { var again = ls(k); localStorage.setItem(k, JSON.stringify((Array.isArray(again) ? again : []).concat(failed))); } catch (e) {}
    try { ad.refresh(); } catch (e) {}
    tell({ ws: 'delivered', app: APP, ids: ids, failed: failed.length });
  }

  /* ---------- espelho: mantém cópia e original iguais ---------- */
  async function mirror() {
    if (!ad || !isReady || ad.loose || running || typing()) return;
    running = true;
    try {
      var P = ls('workspace-v1'), links = (P && P.links) || {}, base = ls('ws-mirror') || {}, dirty = false, changed = false;
      for (var k in links) {
        var L = links[k];
        if (!L || !L.on || !L.mirror) continue;
        var a = parse(L.a), b = parse(L.b), sides = [];
        if (a.app === APP) sides.push([a, b, L.lb]);
        if (b.app === APP) sides.push([b, a, L.la]);
        for (var i = 0; i < sides.length; i++) {
          var mine = sides[i][0], other = sides[i][1], rec = find(mine.store, mine.id);
          if (!rec || !ad.f[mine.store]) continue;
          var F = fieldsOf(mine.store, rec), raw = await readRaw(other);
          if (!raw || raw.deleted || raw.lixo) continue;
          if (typing()) return;
          var o = view(raw), bk = k + '>' + APP + ':' + mine.id, B = base[bk] || null, myMod = +rec.mod || +rec.updated || 0, upd = false, nb = { t: B ? B.t : null, d: B ? B.d : null, b: B ? B.b : null };
          ['t', 'd'].forEach(function (x) {
            if (!F[x]) return;
            var mv = String(rec[F[x]] || ''), ov = o[x];
            if (x === 'd') mv = mv.slice(0, 10);
            if (!ov) return; // título ou data vazios nunca apagam o que já existe
            if (mv !== ov) {
              var pull = B && B[x] !== null && B[x] !== undefined ? (mv === B[x] || (ov !== B[x] && o.mod > myMod)) : o.mod > myMod;
              if (!pull) return;
              rec[F[x]] = ov; upd = true;
            }
            if (nb[x] !== ov) { nb[x] = ov; dirty = true; }
          });
          if (F.b && L.mirror.to === mine.key) {
            var lab = sides[i][2] || {}, line = originLine(other.app, lab.k || 'Item', o.t), want = F.html ? htmlOf(o.b, line) : textOf(o.b, line), cur = String(rec[F.b] || '');
            if (B && B.b === cur && want !== cur) { rec[F.b] = want; upd = true; cur = want; }
            if (cur === want && nb.b !== want) { nb.b = want; dirty = true; }
          }
          if (upd) { ad.save(mine.store, rec); changed = true; }
          base[bk] = nb;
        }
      }
      if (dirty) try { localStorage.setItem('ws-mirror', JSON.stringify(base)); } catch (e) {}
      if (changed) try { ad.refresh(); } catch (e) {}
    } catch (e) { console.warn('Elo: espelho', e); }
    running = false;
  }

  /* ---------- dados vinculados: a mesma tarefa em todos os apps vinculados ----------
     Cada tarefa pertence a um grupo. O grupo nasce no app onde a tarefa foi criada (origem~id) e, nos outros,
     a tarefa usa um id previsível (ws-<código da origem>-<id>), então dois aparelhos nunca criam duplicatas.
     O estado combinado de cada grupo fica em ws-canon; cada app compara o que tem com o que viu por último
     (ws-base): se mudou aqui, publica; se mudou lá, puxa. Vale para título, data, texto e concluído. */
  var TASK = { 'frondosa': 'tasks', 'alvorada.jgmrossi': 'items', 'capynote': 'tasks', 'kanban': 'cartoes', 'blocos': 'blocos', 'blocos2': 'blocos', 'blocos3': 'pecas', 'orbita': 'tasks' };
  var CODE = { 'frondosa': 'fr', 'alvorada.jgmrossi': 'al', 'capynote': 'cn', 'kanban': 'kb', 'blocos': 'b1', 'blocos2': 'b2', 'blocos3': 'b3', 'orbita': 'or' }, UNCODE = {};
  Object.keys(CODE).forEach(function (a) { UNCODE[CODE[a]] = a; });
  var bRunning = false, warned = {};
  function pairId(a, b) { return a < b ? a + '|' + b : b + '|' + a; }
  function bridges() { var P = ls('workspace-v1') || {}; return { all: !!(P.bridgeAll && P.bridgeAll.on), pairs: (P.bridges && typeof P.bridges === 'object') ? P.bridges : {} }; }
  function bridged(a, b, B) { if (!TASK[a] || !TASK[b] || a === b) return false; if (B.all) return true; var p = B.pairs[pairId(a, b)]; return !!(p && p.on); }
  function hash(s) { var h = 5381; for (var i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36) + ':' + s.length; }
  function isDone(r) { return !!(r.done && typeof r.done !== 'object') || !!r.feito || r.status === 'done'; }
  function rawBody(r) { return pick(r, BKEYS); }
  function eligible(r, F) {
    if (!r || !r.id || r.deleted || r.lixo || r.arquivado || r.arquivada || r.pai || r.rrule) return false;
    if (APP === 'alvorada.jgmrossi' && r.type !== 'task') return false;
    if (APP === 'blocos2' && r.forma === 'nota') return false;
    return !!String(r[F.t] || '').trim();
  }
  function groupOf(store, id, to) {
    var k = APP + ':' + store + ':' + id;
    for (var n = 0; n < 4 && to[k]; n++) k = to[k]; // uma cópia espelhada pertence ao grupo do original
    var p = parse(k);
    if (TASK[p.app] !== p.store) p = parse(APP + ':' + store + ':' + id);
    var m = /^ws-([a-z0-9]{2})-(.+)$/.exec(p.id);
    return m && UNCODE[m[1]] ? UNCODE[m[1]] + '~' + m[2] : p.app + '~' + p.id;
  }
  function myIdFor(G) { var i = G.indexOf('~'), oa = G.slice(0, i), oid = G.slice(i + 1); return oa === APP ? oid : 'ws-' + CODE[oa] + '-' + oid; }
  async function bridge() {
    var out = { made: 0, pulled: 0, more: false };
    if (!ad || ad.loose || !isReady || bRunning || !TASK[APP] || typing()) return out;
    var B = bridges();
    if (!Object.keys(TASK).some(function (x) { return bridged(APP, x, B); })) return out;
    bRunning = true;
    try {
      var store = TASK[APP], P = ls('workspace-v1') || {}, links = P.links || {}, to = {};
      for (var lk in links) { var L = links[lk]; if (L && L.on && L.mirror && L.mirror.to) to[L.mirror.to] = L.mirror.from; }
      var canon = ls('ws-canon') || {}, base = ls('ws-base') || {}, seeds = ls('ws-seed') || {}, touched = {}, myBase = {}, mySeeds = {}, mine = {}, changed = false, now = Date.now();
      var list = ((ad.list ? ad.list(store) : S[store]) || []).slice(), canDone = !!(DONE[APP] && DONE[APP][store]);
      var exs = ls('ws-ex'), exg = (exs && exs.go && exs.g) || {};
      // 1) o que eu tenho: publica o que mudou aqui, puxa o que mudou nos outros
      for (var i = 0; i < list.length; i++) {
        var rec = list[i], sk = APP + ':' + rec.id;
        if (rec.seed || rec.ex) { if (!seeds[sk]) mySeeds[sk] = 1; continue; } // exemplos do app nunca entram
        if (seeds[sk]) continue;
        var F = fieldsOf(store, rec);
        if (!eligible(rec, F)) continue;
        var G = groupOf(store, rec.id, to);
        if (mine[G]) continue;
        mine[G] = rec;
        var C = canon[G] || (canon[G] = { m: {} }), Bs = base[sk] || {}, first = !base[sk], mod = +rec.mod || +rec.updated || 0, upd = false;
        if (!C.m) C.m = {};
        if (!C.m[APP]) { C.m[APP] = 1; touched[G] = 1; }
        if (C.gone && C.gone[APP]) { delete C.gone[APP]; touched[G] = 1; }
        var vals = { t: String(rec[F.t] || '') };
        if (F.d) vals.d = String(rec[F.d] || '').slice(0, 10);
        if (canDone) vals.done = isDone(rec) ? 1 : 0;
        if (F.b) vals.bh = hash(String(rec[F.b] || ''));
        for (var x in vals) {
          var ov = vals[x], cv = C[x], bv = Bs[x];
          if (cv === undefined || (first ? (ov !== cv && mod >= (C['m_' + x] || 0)) : (ov !== cv && ov !== bv))) { // novo no grupo, ou mudou aqui
            C[x] = ov; C['m_' + x] = cv === undefined ? (mod || now) : now; if (x === 'bh') C.bs = APP + ':' + store + ':' + rec.id;
            Bs[x] = ov; touched[G] = 1; myBase[sk] = Bs;
          } else if (ov === cv) { if (bv !== ov) { Bs[x] = ov; myBase[sk] = Bs; } }
          else { // mudou em outro app: puxa
            if (x === 't') { if (!cv) continue; rec[F.t] = cv; }
            else if (x === 'd') rec[F.d] = cv;
            else if (x === 'done') ad.done(store, rec, !!cv);
            else {
              var src = C.bs && parse(C.bs), raw = src && src.app !== APP ? await readRaw(src) : null;
              if (!raw) continue;
              var tb = rawBody(raw);
              if (hash(tb) !== cv) continue; // a origem mudou de novo: fica para a próxima volta
              rec[F.b] = tb;
            }
            Bs[x] = cv; myBase[sk] = Bs; upd = true;
          }
        }
        if (upd) { if (typing()) break; ad.save(store, rec); changed = true; out.pulled++; }
      }
      // 2) o que existe nos apps vinculados e ainda não existe aqui
      for (var G2 in canon) {
        if (mine[G2]) continue;
        var C2 = canon[G2], id = myIdFor(G2), bk = APP + ':' + id;
        if (!C2 || !C2.m) continue;
        if (base[bk] || myBase[bk]) { // já existiu aqui e foi apagado ou arquivado: não volta
          if (!C2.gone) C2.gone = {};
          if (!C2.gone[APP]) { C2.gone[APP] = 1; delete C2.m[APP]; touched[G2] = 1; }
          continue;
        }
        if ((C2.gone && C2.gone[APP]) || !C2.t || seeds[bk] || exg[G2]) continue; // exemplos já limpos não voltam
        if (!Object.keys(C2.m).some(function (a) { return a !== APP && bridged(APP, a, B); })) continue;
        if (find(store, id)) continue;
        if (out.made >= 40) { out.more = true; break; }
        var text = '';
        if (C2.bs) { var r2 = await readRaw(parse(C2.bs)); if (r2) text = rawBody(r2); }
        try {
          ad.create({ id: id, store: store, title: C2.t, text: text, html: '', date: C2.d || '' });
          var nr = find(store, id);
          if (!nr) continue;
          if (C2.done && canDone) { ad.done(store, nr, true); ad.save(store, nr); }
          var Fn = fieldsOf(store, nr), nb = { t: C2.t };
          if (Fn.d) nb.d = C2.d || ''; if (canDone) nb.done = C2.done ? 1 : 0; if (Fn.b) nb.bh = hash(text);
          myBase[bk] = nb; C2.m[APP] = 1; touched[G2] = 1; out.made++; changed = true;
        } catch (e) { if (!warned[e.message]) { warned[e.message] = 1; console.warn('Elo: não foi possível criar a tarefa vinculada', e); } }
      }
      // grava só o que é meu por cima do estado mais recente (outro app pode ter gravado enquanto eu lia)
      var fc = ls('ws-canon') || {}, fb = ls('ws-base') || {}, fs = ls('ws-seed') || {}, k;
      for (k in touched) fc[k] = canon[k];
      for (k in myBase) fb[k] = myBase[k];
      for (k in mySeeds) fs[k] = 1;
      try {
        if (Object.keys(touched).length) localStorage.setItem('ws-canon', JSON.stringify(fc));
        if (Object.keys(myBase).length) localStorage.setItem('ws-base', JSON.stringify(fb));
        if (Object.keys(mySeeds).length) localStorage.setItem('ws-seed', JSON.stringify(fs));
      } catch (e) { console.warn('Elo: armazenamento cheio', e); }
      if (changed) try { ad.refresh(); } catch (e) {}
    } catch (e) { console.warn('Elo: dados vinculados', e); }
    bRunning = false;
    return out;
  }
  function bridgeCycle() { return bridge().then(function (r) { tell({ ws: 'bridged', app: APP, made: r.made, pulled: r.pulled, more: r.more }); return r; }); }
  function setBridge(other, on) {
    var P = ls('workspace-v1');
    if (!P || typeof P !== 'object') P = {};
    if (!P.bridges || typeof P.bridges !== 'object') P.bridges = {};
    var others = [].concat(other);
    others.forEach(function (o) { P.bridges[pairId(APP, o)] = { on: !!on, mod: Date.now() }; });
    try { localStorage.setItem('workspace-v1', JSON.stringify(P)); } catch (e) {}
    tell({ ws: 'prefs' });
    bridgeCycle().then(function () { if (on) tell({ ws: 'bridge-run', apps: [APP].concat(others) }); });
  }

  /* ---------- limpar as tarefas de exemplo que vêm com os apps ----------
     O Workspace pede em duas etapas (ws-ex): "scan" (cada app aponta os grupos que são exemplo) e, depois que a
     pessoa confirma, "go" (cada app apaga o que tem desses grupos, inclusive as tarefas vinculadas vindas de outros apps). */
  var EXT = {
    'orbita': ['Enviar proposta ao cliente', 'Ligar para a contadora', 'Responder e-mails pendentes', 'Comprar ingredientes do jantar', 'Revisar apresentação de quinta', 'Agendar dentista', 'Pagar boleto do condomínio', 'Planejar treinos da semana', 'Ler capítulo 4', 'Organizar fotos da viagem', 'Pesquisar curso de inglês', 'Trocar lâmpada do corredor'],
    'frondosa': ['Organizar a casa', 'Projeto do trabalho', 'Cuidar da saúde', 'Viagem de fim de ano', 'Estudar inglês'],
    'alvorada.jgmrossi': ['Conhecer o Alvorada: clique para abrir', 'Depois: organizar etiquetas e listas', 'Planejamento da semana'],
    'capynote': ['Explorar o Capynote'],
    'kanban': ['Arraste este cartão para “Fazendo”', 'Abra um cartão e veja tudo o que cabe nele', 'Conheça os 120 power-ups', 'Captura rápida: digite “Pagar boleto sexta #urgente !!”', 'Troque a vista: Quadro, Tabela, Calendário, Painel…', 'Esta lista tem limite de 3 cartões (WIP)', 'Ligue a sincronização em Ajustes', 'Abrir o Kanban pela primeira vez']
  };
  function delById(s, r) { Data.del(s, r.id); }
  var DEL = {
    'frondosa': delById, 'alvorada.jgmrossi': delById, 'kanban': delById, 'blocos': delById, 'blocos2': delById, 'blocos3': delById,
    'capynote': function (s, r) { var i = S.tasks.indexOf(r); if (i >= 0) S.tasks.splice(i, 1); DB.del('tasks', r.id); },
    'orbita': function (s, r) { if (!OrbitaAPI.del) throw new Error('Órbita sem apagar'); OrbitaAPI.del(r.id); OrbitaAPI.save(); }
  };
  /* nos apps com quadros, caixas ou obras, o exemplo mora num recipiente chamado "... (exemplo)" */
  function inExampleBox(r) {
    try {
      var boxes = APP === 'kanban' ? S.quadros : APP === 'blocos2' ? S.caixas : (APP === 'blocos' || APP === 'blocos3') ? S.obras : null;
      if (!boxes) return false;
      var pid = APP === 'kanban' ? r.quadro : APP === 'blocos2' ? r.caixa : r.obra, o = boxes.filter(function (x) { return x.id === pid; })[0];
      return !!(o && /\(exemplo\)\s*$/i.test(o.nome || ''));
    } catch (e) { return false; }
  }
  function isExample(r, F, seeds) {
    if (r.seed || r.ex || seeds[APP + ':' + r.id] || inExampleBox(r)) return true;
    var list = EXT[APP] || [];
    if (APP === 'blocos2') { try { list = EXEMPLO.blocos.map(function (b) { return b.titulo; }); } catch (e) {} }
    return list.indexOf(String(r[F.t] || '')) >= 0;
  }
  function exStep() {
    try {
      if (!ad || ad.loose || !isReady || !TASK[APP] || !DEL[APP]) return;
      var X = ls('ws-ex');
      if (!X || typeof X !== 'object') return;
      var D = ls('ws-ex-done') || {}, store = TASK[APP], found = 0, removed = 0, did = false, seeds = ls('ws-seed') || {};
      var P = ls('workspace-v1') || {}, links = P.links || {}, to = {};
      for (var lk in links) { var L = links[lk]; if (L && L.on && L.mirror && L.mirror.to) to[L.mirror.to] = L.mirror.from; }
      var list = ((ad.list ? ad.list(store) : S[store]) || []).slice();
      if (X.scan && (D[APP + ':s'] || 0) < X.scan) {
        var add = {};
        list.forEach(function (r) {
          if (!r || !r.id || r.deleted || r.lixo) return;
          var F = fieldsOf(store, r);
          if (isExample(r, F, seeds)) { add[groupOf(store, r.id, to)] = String(r[F.t] || '').slice(0, 80) || '(sem título)'; found++; }
        });
        var fx = ls('ws-ex') || X; if (!fx.g || typeof fx.g !== 'object') fx.g = {};
        for (var k in add) fx.g[k] = add[k];
        try { localStorage.setItem('ws-ex', JSON.stringify(fx)); } catch (e) {}
        X = fx; D[APP + ':s'] = X.scan; did = true;
      }
      if (X.go && X.go >= (X.scan || 0) && (D[APP + ':g'] || 0) < X.go) {
        var g = X.g || {};
        list.forEach(function (r) {
          if (!r || !r.id || !g[groupOf(store, r.id, to)]) return;
          try { DEL[APP](store, r); removed++; } catch (e) { console.warn('Elo: não foi possível apagar o exemplo', e); }
        });
        D[APP + ':g'] = X.go; did = true;
        if (removed) try { ad.refresh(); } catch (e) {}
      }
      if (did) {
        var fd = ls('ws-ex-done') || {}; fd[APP + ':s'] = D[APP + ':s']; fd[APP + ':g'] = D[APP + ':g'];
        try { localStorage.setItem('ws-ex-done', JSON.stringify(fd)); } catch (e) {}
        tell({ ws: 'ex', app: APP, found: found, removed: removed });
      }
    } catch (e) { console.warn('Elo: limpar exemplos', e); }
  }

  /* ---------- abrir direto um item ---------- */
  function openItem(store, id) {
    if (!ad || !isReady || !ad.f[store]) return false;
    var r = ad.loose ? { id: id } : find(store, id);
    if (!r) return false;
    try { ad.open(store, r); return true; } catch (e) { console.warn('Elo: abrir', e); return false; }
  }
  function deep() {
    var m = /[?&]wsitem=([^&#]+)/.exec(location.search);
    if (!m) return;
    var v = decodeURIComponent(m[1]), i = v.indexOf(':');
    try { history.replaceState(history.state, '', location.pathname + location.hash); } catch (e) {}
    if (i > 0) openItem(v.slice(0, i), v.slice(i + 1));
  }
  function goTo(p) {
    if (p.app === APP) { openItem(p.store, p.id); return; }
    if (window.parent !== window) { tell({ ws: 'goto', key: p.key }); return; }
    location.href = ORIGIN + '/' + p.app + '/?wsitem=' + encodeURIComponent(p.store + ':' + p.id);
  }

  /* ---------- aba de vínculos ---------- */
  var host = null, root = null, openPanel = false;
  function myLinks() {
    var P = ls('workspace-v1'), links = (P && P.links) || {}, out = [];
    for (var k in links) {
      var L = links[k]; if (!L || !L.on) continue;
      var a = parse(L.a), b = parse(L.b);
      if (a.app === APP) out.push({ mine: a, other: b, lm: L.la || {}, lo: L.lb || {}, mirror: !!L.mirror, mod: L.mod || 0 });
      else if (b.app === APP) out.push({ mine: b, other: a, lm: L.lb || {}, lo: L.la || {}, mirror: !!L.mirror, mod: L.mod || 0 });
    }
    return out.sort(function (x, y) { return y.mod - x.mod; });
  }
  function panel() {
    var list = myLinks(), isTask = !!(TASK[APP] && ad && !ad.loose);
    if (!list.length && !isTask) { if (host) host.hidden = true; return; }
    if (!host) {
      host = document.createElement('div');
      host.style.cssText = 'position:fixed;right:0;top:38%;z-index:2147483000;font:14px/1.4 system-ui,sans-serif';
      root = host.attachShadow({ mode: 'open' });
      document.body.appendChild(host);
      root.addEventListener('click', function (e) {
        var b = e.target.closest && e.target.closest('button'); if (!b) return;
        if (b.dataset.k === 'tab') { openPanel = !openPanel; return panel(); }
        if (b.dataset.k === 'x') { openPanel = false; return panel(); }
        if (b.dataset.bridge) { setBridge(b.dataset.bridge, b.dataset.on !== '1'); return panel(); }
        if (b.dataset.k === 'all') { setBridge(Object.keys(TASK).filter(function (a) { return a !== APP; }), true); return panel(); }
        if (b.dataset.done) { doneAll(b.dataset.done, true); b.textContent = 'Concluído em todos'; b.disabled = true; return; }
        if (b.dataset.key) { openPanel = false; panel(); goTo(parse(b.dataset.key)); }
      });
    }
    host.hidden = false;
    var css = '<style>*{box-sizing:border-box}button{font:inherit;cursor:pointer}' +
      '.tab{border:1px solid #35e0ff;border-right:0;background:#0c0f1a;color:#eaffff;border-radius:10px 0 0 10px;padding:10px 7px;writing-mode:vertical-rl;letter-spacing:.06em;box-shadow:0 0 14px -4px #35e0ff}' +
      '.box{position:absolute;right:0;top:0;width:min(330px,calc(100vw - 16px));max-height:60vh;overflow:auto;background:#0c0f1a;color:#eef0ff;border:1px solid #35e0ff;border-right:0;border-radius:12px 0 0 12px;padding:12px;box-shadow:0 0 30px -10px #35e0ff}' +
      '.h{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:12px;color:#35e0ff}' +
      '.x{background:none;border:0;color:#959cbd;font-size:18px;line-height:1;padding:2px 6px}.row{border-top:1px solid #272c42;padding:8px 0;display:grid;gap:4px}' +
      '.it{display:block;width:100%;text-align:left;background:#10121b;border:1px solid #272c42;color:inherit;border-radius:8px;padding:7px 9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.it:hover{border-color:#35e0ff}' +
      '.it small{display:block;color:#959cbd;font-size:11px}.m{color:#b78cff;font-size:11px;padding-left:2px}.ok{justify-self:start;background:none;border:1px solid #4fe39a;color:#4fe39a;border-radius:8px;padding:5px 9px;font-size:12px}.ok:disabled{opacity:.6;cursor:default}.sec{margin:6px 0 4px;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#b78cff}.p{margin:4px 0 8px;color:#959cbd;font-size:12px}.brs{display:grid;grid-template-columns:1fr 1fr;gap:6px}.br{display:flex;justify-content:space-between;gap:6px;background:#10121b;border:1px solid #272c42;color:inherit;border-radius:8px;padding:6px 8px;font-size:12px}.br[data-on="1"]{border-color:#4fe39a;color:#4fe39a}.br.all{grid-column:1/-1;justify-content:center;border-color:#35e0ff;color:#35e0ff}@media print{:host{display:none}}</style>';
    if (!openPanel) { root.innerHTML = css + '<button class="tab" data-k="tab" title="Vínculos com outros apps">⟷' + (list.length ? ' ' + list.length : '') + '</button>'; return; }
    var bsec = '';
    if (isTask) {
      var B = bridges();
      bsec = '<div class="sec">Vincular todos os dados</div>' + (B.all
        ? '<p class="p">Todos os apps de tarefas estão vinculados entre si. Para mudar, use a página inicial do Workspace.</p>'
        : '<div class="brs">' + Object.keys(TASK).filter(function (a) { return a !== APP; }).map(function (a) { var on = bridged(APP, a, B); return '<button class="br" data-bridge="' + esc(a) + '" data-on="' + (on ? 1 : 0) + '">' + esc(NAMES[a]) + '<span>' + (on ? '✓' : '+') + '</span></button>'; }).join('') +
          '<button class="br all" data-k="all">Vincular com todos</button></div>' +
          '<p class="p">As tarefas deste app e do app vinculado passam a ser as mesmas nos dois: título, data, texto e concluído mudam juntos.</p>');
    }
    root.innerHTML = css + '<div class="box"><div class="h"><span>Vínculos</span><button class="x" data-k="x" aria-label="Fechar">×</button></div>' + bsec + (list.length && isTask ? '<div class="sec">Itens ligados</div>' : '') + list.map(function (l) {
      return '<div class="row"><button class="it" data-key="' + esc(l.mine.key) + '">' + esc(l.lm.t || 'Item') + '<small>aqui · ' + esc(l.lm.k || '') + '</small></button>' +
        '<span class="m">⟷ ' + (l.mirror ? 'cópia espelhada' : 'vinculado a') + '</span>' +
        '<button class="it" data-key="' + esc(l.other.key) + '">' + esc(l.lo.t || 'Item') + '<small>' + esc(NAMES[l.other.app] || l.other.app) + ' · ' + esc(l.lo.k || '') + '</small></button>' +
        (canDone(l.mine.key) ? '<button class="ok" data-done="' + esc(l.mine.key) + '">✓ Concluir em todos</button>' : '') + '</div>';
    }).join('') + '</div>';
  }

  /* ---------- partida ---------- */
  function cycle() { consume(); panel(); return mirror().then(exStep).then(bridgeCycle); }
  function boot() {
    panel();
    if (!ad) return;
    var tries = 0, t = setInterval(function () {
      var ok = false;
      try { var n = ad.sign && document.querySelector(ad.sign); ok = (ad.sign ? !!(n && n.children.length) : document.readyState === 'complete') && (ad.ok ? ad.ok() : typeof S !== 'undefined'); } catch (e) {}
      if (ok) { clearInterval(t); setTimeout(function () { isReady = true; panel(); consume(); deep(); mirror().then(exStep).then(bridgeCycle); }, ad.sign ? 400 : 1500); }
      else if (++tries > 240) clearInterval(t);
    }, 250);
  }
  var soon = null;
  addEventListener('storage', function (e) {
    if (!e.key) return;
    if (e.key === 'ws-inbox:' + APP) consume();
    else if (e.key === 'workspace-v1' || e.key === 'ws-canon' || /-v\d+$/.test(e.key)) { clearTimeout(soon); soon = setTimeout(function () { panel(); mirror().then(bridge); }, 600); }
  });
  addEventListener('message', function (e) {
    if (e.origin !== ORIGIN || !e.data || typeof e.data !== 'object') return;
    if (e.data.ws === 'open' && typeof e.data.store === 'string' && typeof e.data.id === 'string') openItem(e.data.store, e.data.id);
    if (e.data.ws === 'cycle') cycle();
  });
  addEventListener('focus', cycle);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) cycle(); });
  setInterval(cycle, 15000);
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  window.EloLib = { app: APP, open: openItem, cycle: cycle };
})();
