'use strict';
/* Ishikawa — utilitários, ícones e armazenamento local (IndexedDB) */

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

const LOGO = '<svg viewBox="0 0 512 512"><rect width="512" height="512" rx="116" fill="#0e7490"/><g fill="none" stroke="#fff" stroke-width="26" stroke-linecap="round" stroke-linejoin="round"><path d="M84 256h268"/><path d="M130 136l56 120M130 376l56-120M222 136l56 120M222 376l56-120"/></g><path d="M352 190l96 66-96 66z" fill="#fff"/></svg>';

const IC = {
  plus: 'M12 5v14M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  trash: 'M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  menu: 'M4 6h16M4 12h16M4 18h16',
  gear: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M16 4v4M10 10v4M18 16v4',
  x: 'M6 6l12 12M18 6L6 18',
  undo: 'M8 5L4 9l4 4M4 9h10a6 6 0 0 1 0 12h-3',
  redo: 'M16 5l4 4-4 4M20 9H10a6 6 0 0 0 0 12h3',
  dl: 'M12 4v11M7 11l5 5 5-5M5 20h14',
  up: 'M12 16V5M7 9l5-5 5 5M5 20h14',
  copy: 'M8 8h11v12H8zM5 16V4h10',
  pdf: 'M6 3h9l4 4v14H6zM14 3v5h5M9 13h6M9 17h6',
  img: 'M4 5h16v14H4zM4 16l5-5 4 4 3-3 4 4M9 9h.01',
  code: 'M8 7l-5 5 5 5M16 7l5 5-5 5',
  panel: 'M4 5h16v14H4zM15 5v14',
  fit: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z',
  arrowu: 'M12 19V5M6 11l6-6 6 6',
  arrowd: 'M12 5v14M6 13l6 6 6-6',
  sync: 'M4 12a8 8 0 0 1 14-5l2 2M20 12a8 8 0 0 1-14 5l-2-2M20 4v5h-5M4 20v-5h5',
  back: 'M15 5l-7 7 7 7',
  fish: 'M3 12h14M7 6l3 6M7 18l3-6M13 6l3 6M13 18l3-6M17 8l5 4-5 4z',
  list: 'M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01',
  check: 'M4 12l5 5L20 6',
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24"><path d="${IC[n] || ''}"/></svg>`;

const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const fmtDate = ts => new Date(ts).toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' });
function fmtRel(ts) {
  const diff = Date.now() - ts, min = 60000, d = new Date(ts);
  if (diff < min) return 'agora';
  if (diff < 60 * min) return `há ${Math.floor(diff / min)} min`;
  if (dayKey(ts) === dayKey(Date.now())) return `há ${Math.floor(diff / (60 * min))} h`;
  if (dayKey(ts) === dayKey(Date.now() - 864e5)) return 'ontem';
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: d.getFullYear() === new Date().getFullYear() ? undefined : 'numeric' });
}

const DB = (() => {
  const STORES = ['diagrams', 'kv'];
  const SYNCED = ['diagrams'];
  let db = null, mem = null, tomb = { id: 'tombstones', items: {} };
  const useMem = () => { mem = {}; STORES.forEach(s => mem[s] = new Map()); };
  const run = (store, mode, fn) => new Promise((res, rej) => {
    const t = db.transaction(store, mode), rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
  return {
    STORES, SYNCED,
    onChange: () => {},
    tomb: () => tomb.items,
    setTomb: t => { tomb = t; },
    saveTomb: () => DB.put('kv', tomb),
    persistent: () => !mem,
    open: () => new Promise(res => {
      try {
        const rq = indexedDB.open('ishikawa', 1);
        rq.onupgradeneeded = () => STORES.forEach(s => rq.result.objectStoreNames.contains(s) || rq.result.createObjectStore(s, { keyPath: 'id' }));
        rq.onsuccess = () => { db = rq.result; res(); };
        rq.onerror = rq.onblocked = () => { useMem(); res(); };
      } catch (e) { useMem(); res(); }
    }),
    all: s => mem ? Promise.resolve([...mem[s].values()]) : run(s, 'readonly', o => o.getAll()),
    // raw = gravação vinda da sincronização: não carimba a data de modificação nem dispara novo envio
    put(s, v, raw) {
      if (!raw && SYNCED.includes(s)) { v.mod = Date.now(); DB.onChange(); }
      return mem ? Promise.resolve(mem[s].set(v.id, v)) : run(s, 'readwrite', o => o.put(v)).catch(e => { console.error(e); toast('Não foi possível salvar: armazenamento cheio?'); });
    },
    del(s, id, raw) {
      if (!raw && SYNCED.includes(s)) { tomb.items[s + ':' + id] = Date.now(); DB.saveTomb(); DB.onChange(); }
      return mem ? Promise.resolve(mem[s].delete(id)) : run(s, 'readwrite', o => o.delete(id));
    },
    clear: s => mem ? Promise.resolve(mem[s].clear()) : run(s, 'readwrite', o => o.clear()),
  };
})();

/* Estado em memória */
const S = {
  diagrams: [],
  set: { id: 'settings', theme: 'auto', cur: null, tab: 'outline', panel: true },
};

const TEMPLATES = [
  ['6M', 'Indústria e produção', ['Método', 'Máquina', 'Mão de obra', 'Material', 'Medida', 'Meio ambiente']],
  ['Serviços', 'Escritórios e atendimento', ['Pessoas', 'Processos', 'Tecnologia', 'Informação', 'Cliente', 'Ambiente']],
  ['4P', 'Administração', ['Políticas', 'Procedimentos', 'Pessoal', 'Planta']],
  ['8P', 'Marketing de serviços', ['Produto', 'Preço', 'Praça', 'Promoção', 'Pessoas', 'Processos', 'Evidência física', 'Produtividade']],
  ['4S', 'Prestação de serviços', ['Arredores', 'Fornecedores', 'Sistemas', 'Habilidades']],
  ['Em branco', 'Comece do zero', ['Categoria 1', 'Categoria 2']],
];

const STATUS = { '': 'Hipótese', ok: 'Confirmada', no: 'Descartada' };
const ASTATUS = { todo: 'A fazer', doing: 'Em andamento', done: 'Concluída' };

const newCause = text => ({ id: uid(), text: text || '', status: '', root: false, votes: 0, note: '', subs: [] });
const newSub = text => ({ id: uid(), text: text || '', status: '', root: false, votes: 0, note: '' });
const newCat = name => ({ id: uid(), name: name || '', color: '', causes: [] });

/* Garante o formato de um diagrama vindo de fora (sincronização, backup). */
function normalize(d) {
  const str = v => typeof v === 'string' ? v : '', node = (n, f) => Object.assign(f(), n, { id: str(n.id) || uid(), text: str(n.text), note: str(n.note), votes: Math.max(0, parseInt(n.votes) || 0), status: STATUS[n.status] ? n.status : '', root: !!n.root });
  d.title = str(d.title); d.effect = str(d.effect); d.notes = str(d.notes);
  d.cats = (Array.isArray(d.cats) ? d.cats : []).filter(c => c && typeof c === 'object').map(c => ({
    id: str(c.id) || uid(), name: str(c.name), color: /^#[0-9a-f]{6}$/i.test(c.color) ? c.color : '',
    causes: (Array.isArray(c.causes) ? c.causes : []).filter(Boolean).map(ca => { const o = node(ca, newCause); o.subs = (Array.isArray(ca.subs) ? ca.subs : []).filter(Boolean).map(s => { const x = node(s, newSub); delete x.subs; return x; }); return o; }),
  }));
  d.actions = (Array.isArray(d.actions) ? d.actions : []).filter(a => a && typeof a === 'object').map(a => ({ id: str(a.id) || uid(), what: str(a.what), why: str(a.why), who: str(a.who), when: str(a.when), where: str(a.where), how: str(a.how), cost: str(a.cost), causeId: str(a.causeId), status: ASTATUS[a.status] ? a.status : 'todo' }));
  d.created = +d.created || Date.now(); d.updated = +d.updated || d.created; d.deleted = d.deleted || null;
  return d;
}

const Store = {
  async load() {
    await DB.open();
    S.diagrams = (await DB.all('diagrams')).map(normalize);
    const kv = await DB.all('kv');
    const st = kv.find(k => k.id === 'settings');
    if (st) Object.assign(S.set, st);
    const tb = kv.find(k => k.id === 'tombstones');
    if (tb) DB.setTomb(tb);
    if (!st && !S.diagrams.length) Store.seed();
  },
  // seed: true marca o diagrama de exemplo, descartado se a primeira sincronização já encontrar dados
  seed() {
    const d = Store.create('Exemplo: atraso na entrega de pedidos', 'Pedidos entregues com atraso', 0, true);
    const fill = (i, list) => d.cats[i].causes = list.map(([t, subs, extra]) => Object.assign(newCause(t), extra, { subs: (subs || []).map(s => newSub(s)) }));
    fill(0, [['Separação sem roteiro definido', ['Cada operador segue uma ordem'], { root: true, votes: 4 }], ['Conferência manual duplicada']]);
    fill(1, [['Esteira parada com frequência', ['Manutenção só corretiva', 'Peças sem reposição'], { status: 'ok', votes: 2 }]]);
    fill(2, [['Equipe reduzida no turno da tarde'], ['Treinamento insuficiente', ['Alta rotatividade']]]);
    fill(3, [['Falta de embalagens', ['Fornecedor único']], ['Etiquetas ilegíveis', [], { status: 'no' }]]);
    fill(4, [['Prazo prometido sem base em dados', [], { votes: 3 }]]);
    fill(5, [['Doca congestionada no fim do dia']]);
    d.actions = [{ id: uid(), what: 'Definir roteiro padrão de separação', why: 'Causa raiz mais votada', who: '', when: '', where: '', how: '', cost: '', causeId: d.cats[0].causes[0].id, status: 'todo' }];
    S.set.cur = d.id;
    DB.put('diagrams', d);
  },
  create(title, effect, tpl, seed) {
    const now = Date.now();
    const d = { id: uid(), title: title || 'Novo diagrama', effect: effect || '', notes: '', created: now, updated: now, deleted: null, cats: TEMPLATES[tpl][2].map(newCat), actions: [] };
    if (seed) d.seed = true;
    S.diagrams.push(d);
    DB.put('diagrams', d);
    return d;
  },
  saveSet: () => DB.put('kv', S.set),
  count: d => d.cats.reduce((n, c) => n + c.causes.reduce((m, ca) => m + 1 + ca.subs.length, 0), 0),
};
