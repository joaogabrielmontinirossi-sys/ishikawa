/* Sincronização pela conta Google no site e no celular.
   Guarda o mesmo arquivo <app>-sync.json da sincronização por pasta, só que na área privada do app no Google Drive.
   A mescla continua sendo a do próprio app: aqui fica só o transporte (ler e gravar o arquivo) e a conexão.
   A conexão pode vir do Pepsi Doidão Workspace, que entrega o mesmo token a todos os apps. */
(function () {
  'use strict';
  var sc = document.currentScript, APP = sc && sc.dataset.app;
  if (!APP) return;
  var NAME = APP + '-sync.json', TOK = APP + '-g', SET = APP + '-gset';
  var GAPI = 'https://www.googleapis.com/', SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
  var web = location.protocol === 'https:' && !/^(localhost|127\.0\.0\.1)$/.test(location.hostname);
  var g = { token: '', exp: 0, file: null, error: '', last: 0 }, msg = '', gisP = null;
  var opt = { h: 'label', btn: 'btn ghost sm', pri: 'btn sm' };

  function ls(k) { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } }
  function set() { var s = ls(SET); return s && typeof s === 'object' ? s : {}; }
  function saveSet(s) { try { localStorage.setItem(SET, JSON.stringify(s)); } catch (e) {} }
  function loadTok() {
    var t = ls(TOK);
    if (t && t.token && t.exp > Date.now() + 60000) { if (t.token !== g.token) { g.token = t.token; g.exp = t.exp; g.file = null; } }
    else if (!t) { g.token = ''; g.exp = 0; }
  }
  function tokOk() { loadTok(); return !!(g.token && g.exp > Date.now()); }
  function on() { var s = set(); return !!(web && !s.off && s.gClient && tokOk()); }
  function esc(v) { return String(v).replace(/[&<>"']/g, function (c) { return '&#' + c.charCodeAt(0) + ';'; }); }
  function hm(t) { return new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }); }
  function fire() { if (api.onChange) try { api.onChange(); } catch (e) { console.warn(e); } }

  async function gfetch(path, o) {
    o = o || {};
    var r = await fetch(GAPI + path, Object.assign({}, o, { headers: Object.assign({ Authorization: 'Bearer ' + g.token }, o.headers) }));
    if (r.status === 401) { g.token = ''; g.exp = 0; try { localStorage.removeItem(TOK); } catch (e) {} throw new Error('a sessão do Google expirou; reconecte em Ajustes'); }
    if (!r.ok && r.status !== 404) { var m = 'o Google respondeu ' + r.status; try { m = (await r.json()).error.message || m; } catch (e) {} throw new Error(m); }
    return r;
  }
  function reply(status, text) { return { ok: true, status: status, text: function () { return Promise.resolve(text); }, json: function () { return Promise.resolve(text ? JSON.parse(text) : null); } }; }
  /* Mesma forma de api('sync'): sem argumento lê o arquivo; com { method: 'POST', body } grava. */
  async function io(o) {
    try {
      if (!g.file) {
        var j = await (await gfetch('drive/v3/files?spaces=appDataFolder&q=' + encodeURIComponent("name='" + NAME + "'") + '&fields=files(id)')).json();
        g.file = (j.files && j.files[0] && j.files[0].id) || null;
      }
      var out;
      if (o && o.method === 'POST') {
        if (g.file) {
          var p = await gfetch('upload/drive/v3/files/' + g.file + '?uploadType=media', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: o.body });
          if (p.status === 404) { g.file = null; return io(o); }
        } else {
          var form = new FormData();
          form.append('metadata', new Blob([JSON.stringify({ name: NAME, parents: ['appDataFolder'] })], { type: 'application/json' }));
          form.append('file', new Blob([o.body], { type: 'application/json' }));
          g.file = (await (await gfetch('upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST', body: form })).json()).id;
        }
        out = reply(200, '');
      } else if (!g.file) out = reply(204, '');
      else {
        var r = await gfetch('drive/v3/files/' + g.file + '?alt=media');
        if (r.status === 404) { g.file = null; out = reply(204, ''); } else out = reply(200, await r.text());
      }
      g.error = ''; g.last = Date.now(); refresh();
      return out;
    } catch (e) { g.error = e.message || 'falha ao falar com o Google'; refresh(); throw e; }
  }

  function gis() {
    return gisP || (gisP = new Promise(function (res, rej) {
      if (window.google && google.accounts) return res();
      var s = document.createElement('script'); s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res; s.onerror = function () { gisP = null; rej(new Error('Sem acesso ao Google. Verifique a internet.')); };
      document.head.appendChild(s);
    }));
  }
  /* Abre a janela do Google; precisa partir de um clique. */
  async function connect(client) {
    await gis();
    var s = set();
    var tok = await new Promise(function (res, rej) {
      google.accounts.oauth2.initTokenClient({
        client_id: client, scope: SCOPE,
        callback: function (r) { r.error ? rej(new Error(r.error_description || r.error)) : res(r); },
        error_callback: function (e) { rej(new Error(e.type === 'popup_closed' ? 'A janela do Google foi fechada.' : e.type === 'popup_failed_to_open' ? 'O navegador bloqueou a janela do Google.' : (e.message || 'Falha na autorização.'))); }
      }).requestAccessToken({ prompt: s.gWas ? '' : 'consent' });
    });
    g.token = tok.access_token; g.exp = Date.now() + (tok.expires_in - 90) * 1000; g.file = null; g.error = '';
    try { localStorage.setItem(TOK, JSON.stringify({ token: g.token, exp: g.exp })); } catch (e) {}
    s = set(); s.gClient = client; s.gWas = true; s.off = false; saveSet(s);
  }
  /* Desliga só neste app; o token é compartilhado com os outros, então não é revogado. */
  function off() { var s = set(); s.off = true; saveSet(s); g.error = ''; refresh(); }

  function row(h) { return '<div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">' + h + '</div>'; }
  function inner() {
    var s = set(), H = opt.h, t = tokOk(), out = '<' + H + '>Sincronização com o Google Drive</' + H + '>';
    if (on()) {
      out += '<p style="margin:0 0 6px">Ativa pela conta Google' + (g.error ? ' · <span class="err">' + esc(g.error) + '</span>' : g.last ? ' · última vez às ' + hm(g.last) : '') + '</p>';
      out += row('<button class="' + opt.btn + '" data-gs="now">Sincronizar agora</button><button class="' + opt.btn + '" data-gs="off">Desativar</button>');
    } else {
      out += '<p style="margin:0 0 6px">' + (s.off && t ? 'Desativada neste app.' : s.gWas ? 'A sessão do Google expirou. Reconecte para voltar a sincronizar.' : 'Conecte a conta Google para ter os mesmos dados no site e no celular.') + '</p>';
      out += row('<input data-gs="client" value="' + esc(s.gClient || '') + '" placeholder="ID do cliente OAuth (….apps.googleusercontent.com)" autocomplete="off" spellcheck="false" aria-label="ID do cliente OAuth do Google" style="flex:1 1 240px;min-width:0">' +
        '<button class="' + opt.pri + '" data-gs="on">' + (t && s.gClient ? 'Ativar' : s.gWas ? 'Reconectar' : 'Conectar conta Google') + '</button>');
      if (msg) out += '<p class="err" style="margin:6px 0 0">' + esc(msg) + '</p>';
    }
    return out + '<p class="muted">O arquivo ' + NAME + ' fica na área privada do app no seu Google Drive. Conectando pelo Pepsi Doidão Workspace, todos os apps recebem a mesma conexão.</p>';
  }
  function html(o) { if (o) opt = o; return '<div data-gsync>' + inner() + '</div>'; }
  function refresh() {
    var list = document.querySelectorAll('[data-gsync]');
    for (var i = 0; i < list.length; i++) { if (list[i].contains(document.activeElement) && document.activeElement.tagName === 'INPUT') continue; list[i].innerHTML = inner(); }
  }

  document.addEventListener('click', async function (e) {
    var b = e.target.closest && e.target.closest('button[data-gs]');
    if (!b) return;
    var k = b.dataset.gs, box = b.closest('[data-gsync]');
    if (k === 'off') return off();
    if (k === 'now') return fire();
    var inp = box && box.querySelector('[data-gs="client"]'), client = inp ? inp.value.trim() : '';
    msg = '';
    if (!client) { msg = 'Informe o ID do cliente OAuth (o mesmo dos outros apps).'; return refresh(); }
    b.disabled = true;
    try {
      var s = set();
      if (tokOk() && s.gClient === client) { s.off = false; saveSet(s); } else await connect(client);
      refresh(); fire();
    } catch (err) { msg = err.message || 'Falha na conexão.'; b.disabled = false; refresh(); }
  });
  /* O Workspace (ou outra aba) entregou ou retirou a conexão. */
  addEventListener('storage', function (e) {
    if (e.key !== TOK && e.key !== SET) return;
    var was = g.token; loadTok(); refresh();
    if (on() && g.token !== was) fire();
  });

  var api = window.GSyncLib = { web: web, on: on, io: io, html: html, off: off, onChange: null, name: NAME };
})();
