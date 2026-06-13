// lib/finance/onboarding.js
// Family-finance onboarding questionnaire (v2 — tap-to-select layout). A
// standalone PT-BR page served on the LAN so Gabriela can answer from her
// Windows notebook — she is the source of truth for bills/debts detail.
//
// v2 layout (Diego's feedback 2026-06-10): each question is a grid of
// pre-filled chips (common Brazilian household items/banks) — tap to select
// one or many; each selected item gets a select of typical values plus a
// "digitar valor" escape hatch. Free text remains only where it belongs
// (Excel paste + observations). Questions stay SIMPLE: no fees/technical
// detail, only what moves the monthly budget.
//
// Auth model: the page and its POST are NOT behind biso's AUTH_TOKEN (we are
// not handing the full biso token to another device). Instead a random
// one-per-install key lives in codex/finance/onboarding/key.txt (gitignored)
// and must match the ?k= query. GET /finance/onboarding-link (biso-auth'd)
// mints the key and returns the LAN URL to share.
//
// Answers land in codex/finance/onboarding/answers-<ts>.json (+ latest.json)
// and fire a biso notification. Multiple submissions are fine — newest wins.

const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const express = require('express');

const FINANCE_DIR = process.env.BISA_FINANCE_DIR
  || path.join(__dirname, '..', '..', 'codex', 'finance');
const OB_DIR = path.join(FINANCE_DIR, 'onboarding');
const KEY_FILE = path.join(OB_DIR, 'key.txt');

const lanIPv4 = () => {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) return i.address;
    }
  }
  return 'localhost';
};

const loadOrMintKey = () => {
  try {
    const k = fs.readFileSync(KEY_FILE, 'utf8').trim();
    if (/^[a-f0-9]{32}$/.test(k)) return k;
  } catch { /* mint below */ }
  const k = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(OB_DIR, { recursive: true });
  fs.writeFileSync(KEY_FILE, k + '\n', { mode: 0o600 });
  return k;
};

const keyOk = (req) => {
  const k = String(req.query.k || '');
  try {
    const want = fs.readFileSync(KEY_FILE, 'utf8').trim();
    return k.length === want.length && crypto.timingSafeEqual(Buffer.from(k), Buffer.from(want));
  } catch { return false; }
};

// --- v2 question schema --------------------------------------------------------
// type 'chips': tap items (multi unless single:true); each selected item shows a
// select of `values` (+ "digitar valor"). 'radio': pick one. 'textarea': free.
// `extra[item]` adds a second select to that item's picked row ({ph, options})
// — used for "how often does the bônus come" / "when does she plan to sell".
// Its value lands in the answer as `detalhe`.

const VAL_CONTA = ['~R$ 50', '~R$ 100', '~R$ 150', '~R$ 200', '~R$ 300', '~R$ 400', '~R$ 500', '~R$ 700', '~R$ 1.000', 'mais de R$ 1.000'];
const VAL_GASTO = ['~R$ 100', '~R$ 200', '~R$ 300', '~R$ 500', '~R$ 800', '~R$ 1.200', '~R$ 1.800', '~R$ 2.500', 'mais de R$ 3.000'];
const VAL_DIVIDA = ['pago parcela de ~R$ 100', 'pago parcela de ~R$ 200', 'pago parcela de ~R$ 300', 'pago parcela de ~R$ 500', 'pago parcela de ~R$ 800',
  'devo ~R$ 1.000', 'devo ~R$ 3.000', 'devo ~R$ 5.000', 'devo ~R$ 10.000', 'devo mais de R$ 15.000', 'não sei o valor'];
const VAL_FATURA = ['~R$ 300', '~R$ 600', '~R$ 1.000', '~R$ 1.500', '~R$ 2.000', '~R$ 3.000', 'mais de R$ 3.000'];
const VAL_RESERVA = ['~R$ 1.000', '~R$ 5.000', '~R$ 10.000', '~R$ 20.000', '~R$ 40.000', 'mais de R$ 50.000'];
const VAL_EXTRA = ['~R$ 300', '~R$ 500', '~R$ 1.000', '~R$ 2.000', 'mais de R$ 3.000', 'varia muito'];

const BANCOS = ['Nubank', 'Itaú', 'Bradesco', 'Santander', 'Banco do Brasil', 'Caixa', 'Inter', 'C6 Bank', 'PicPay', 'Mercado Pago'];

const FIELDS = [
  // The Excel paste comes FIRST: she dumps everything she already controls,
  // then the rest of the questions only fill the gaps (Diego, 2026-06-11).
  { id: 'planilha', sec: 'Sua planilha', label: 'Abra sua planilha do Excel, selecione as linhas do controle de contas (com o cabeçalho), copie (Ctrl+C) e cole aqui (Ctrl+V). Depois é só completar o resto com o que achar que falta.',
    type: 'textarea', ph: 'cole aqui as linhas da planilha…', mono: true },
  // (no 13º/férias — both incomes are PJ)
  { id: 'renda_extras', sec: 'Renda', label: 'Costuma entrar algum dinheiro além dos salários? Marca o que acontece e o valor típico.',
    type: 'chips', options: ['Freelas / bicos', 'Bônus do trabalho', 'Venda de coisas'], values: VAL_EXTRA, none: 'Não entra nada extra',
    extra: {
      'Bônus do trabalho': { ph: 'de quanto em quanto tempo?', options: ['todo mês', 'a cada 2 meses', 'a cada 3 meses', 'a cada 6 meses', '1x por ano', 'foi só uma vez'] },
      'Venda de coisas': { ph: 'quando pretende vender?', options: ['este mês', 'mês que vem', 'em 2–3 meses', 'até o fim do ano', 'ainda sem data'] },
    } },
  { id: 'contas_joinville', sec: 'Contas de casa', label: 'Apartamento de Joinville: marca as contas que existem e o valor de cada uma.',
    type: 'chips', options: ['Condomínio', 'Luz', 'Água', 'Internet', 'Gás', 'IPTU', 'Celular', 'Seguro', 'Faxina / diarista'], values: VAL_CONTA },
  { id: 'contas_bbs', sec: 'Contas de casa', label: 'Casa de Balneário Barra do Sul: mesmas coisas.',
    type: 'chips', options: ['Luz', 'Água', 'Internet', 'Gás', 'IPTU', 'Caseiro / manutenção', 'Jardim / grama', 'Alarme'], values: VAL_CONTA },
  { id: 'gastos_dia_a_dia', sec: 'Contas de casa', label: 'Gastos do dia a dia: marca o que a gente tem e quanto dá por mês, mais ou menos.',
    type: 'chips', options: ['Mercado', 'Farmácia', 'Gasolina / transporte', 'Delivery / restaurantes', 'Streaming / assinaturas', 'Academia', 'Cabelo / estética', 'Pets', 'Roupas', 'Lazer / passeios', 'Presentes', 'Cursos / educação'], values: VAL_GASTO },
  // (no question about the home-equity loan — Diego is the source of truth for
  // it: full contract data lives in codex/finance/profile.json `loans`.)
  { id: 'dividas_diego', sec: 'Dívidas nos bancos', label: 'Dívidas do Diego: marca os bancos e o que está acontecendo em cada um.',
    type: 'chips', options: BANCOS, values: VAL_DIVIDA, none: 'Não sei as do Diego' },
  { id: 'dividas_gabriela', sec: 'Dívidas nos bancos', label: 'E as suas: marca os bancos e o que está acontecendo em cada um.',
    type: 'chips', options: BANCOS, values: VAL_DIVIDA, none: 'Não tenho dívidas' },
  { id: 'cartoes', sec: 'Cartões de crédito', label: 'Quais cartões vocês usam? Marca e diz o valor médio da fatura.',
    type: 'chips', options: BANCOS, values: VAL_FATURA, none: 'Não usamos cartão' },
  // (no question about the fund's currency — Diego confirmed R$ 80.000, 2026-06-11)
  { id: 'reserva_onde', sec: 'Reserva de emergência', label: 'Já temos algo guardado? Marca onde e quanto.',
    type: 'chips', options: ['Poupança', 'CDB / renda fixa', 'Conta em dólar', 'Parado na conta corrente'], values: VAL_RESERVA, none: 'Ainda não temos nada guardado' },
  { id: 'observacoes', sec: 'Pra terminar', label: 'Quer contar mais alguma coisa? Contas que vão acabar ou começar, preocupações, prioridades…',
    type: 'textarea', ph: '…' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const renderPage = (key) => {
  let lastSec = '';
  const fieldsHtml = FIELDS.map((f) => {
    const secHtml = f.sec !== lastSec ? `<h2>${esc(f.sec)}</h2>` : '';
    lastSec = f.sec;
    let body;
    if (f.type === 'radio') {
      body = f.options.map((o, i) =>
        `<label class="radio"><input type="radio" name="${f.id}" value="${esc(o)}" ${i === f.options.length - 1 ? 'checked' : ''}/> ${esc(o)}</label>`).join('');
    } else if (f.type === 'textarea') {
      body = `<textarea name="${f.id}" class="big ${f.mono ? 'mono' : ''}" placeholder="${esc(f.ph || '')}"></textarea>`;
    } else { // chips
      const chips = f.options.map((o) => `<button type="button" class="chip" data-item="${esc(o)}">${esc(o)}</button>`).join('');
      const noneChip = f.none ? `<button type="button" class="chip chip-none" data-none="1">${esc(f.none)}</button>` : '';
      body = `
      <div class="chips" data-field="${f.id}" data-single="${f.single ? 1 : 0}" data-values='${esc(JSON.stringify(f.values || []))}' data-extra='${esc(JSON.stringify(f.extra || {}))}'>
        ${chips}${noneChip}
        <span class="other"><input type="text" class="other-in" placeholder="outro…" maxlength="40"/><button type="button" class="chip other-add">+</button></span>
      </div>
      <div class="picked" id="picked-${f.id}"></div>`;
    }
    return `${secHtml}<div class="q"><label class="ql">${esc(f.label)}</label>${body}</div>`;
  }).join('\n');

  return `<!doctype html>
<html lang="pt-BR"><head>
<meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>Finanças da Família — Questionário</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, sans-serif; background: #f4f6f4; color: #1c2b1c; margin: 0; }
  .wrap { max-width: 760px; margin: 0 auto; padding: 24px 16px 80px; }
  h1 { font-size: 24px; margin: 8px 0 4px; } .sub { color: #4a614a; margin: 0 0 24px; line-height: 1.5; }
  h2 { font-size: 15px; text-transform: uppercase; letter-spacing: 0.06em; color: #2e7d32; border-bottom: 2px solid #c8e6c9; padding-bottom: 4px; margin: 28px 0 12px; }
  .q { margin-bottom: 20px; }
  .ql { display: block; font-weight: 600; margin-bottom: 8px; line-height: 1.45; }
  .chips { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
  .chip { background: #fff; border: 1.5px solid #b9ccb9; border-radius: 18px; padding: 7px 14px; font: inherit; font-size: 14px; cursor: pointer; }
  .chip.on { background: #2e7d32; border-color: #2e7d32; color: #fff; }
  .chip-none { border-style: dashed; color: #4a614a; }
  .chip-none.on { background: #607d60; border-color: #607d60; color: #fff; }
  .other { display: inline-flex; gap: 6px; align-items: center; }
  .other-in { border: 1.5px dashed #b9ccb9; border-radius: 18px; padding: 7px 12px; font: inherit; font-size: 14px; width: 110px; background: #fff; }
  .picked { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
  .pick { display: flex; align-items: center; gap: 8px; background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 8px; padding: 6px 10px; flex-wrap: wrap; }
  .pick b { min-width: 130px; font-weight: 600; }
  .pick select, .pick input[type="text"] { font: inherit; font-size: 13.5px; padding: 5px 8px; border: 1px solid #a5d6a7; border-radius: 6px; background: #fff; }
  .pick .custom { display: none; width: 110px; }
  textarea { width: 100%; box-sizing: border-box; min-height: 64px; padding: 10px; border: 1px solid #b9ccb9; border-radius: 8px; font: inherit; font-size: 14px; background: #fff; }
  textarea.big { min-height: 120px; } textarea.mono { font-family: Consolas, Menlo, monospace; font-size: 12.5px; min-height: 200px; }
  textarea:focus, .other-in:focus { outline: 2px solid #66bb6a; border-color: transparent; }
  .radio { display: block; padding: 4px 0; }
  button[type=submit] { background: #2e7d32; color: #fff; border: 0; border-radius: 8px; padding: 14px 28px; font-size: 16px; font-weight: 600; cursor: pointer; width: 100%; margin-top: 20px; }
  button[type=submit]:disabled { opacity: 0.6; }
  .done { background: #e8f5e9; border: 1px solid #a5d6a7; border-radius: 8px; padding: 16px; margin-top: 20px; display: none; line-height: 1.5; }
  .err { color: #b71c1c; margin-top: 12px; display: none; }
</style></head><body><div class="wrap">
  <h1>Finanças da Família 💚</h1>
  <p class="sub">Oi Gabi! O Diego está montando o nosso controle financeiro no sistema dele.
  Começa colando sua planilha do Excel logo abaixo — depois é só ir tocando no que existe
  na nossa vida e escolhendo um valor aproximado. Nada precisa ser exato, e pode pular
  o que não souber ou o que já estiver na planilha.</p>
  <form id="f">
${fieldsHtml}
    <button type="submit" id="send">Enviar respostas</button>
    <div class="err" id="err"></div>
    <div class="done" id="done">✅ <b>Respostas enviadas!</b> O Diego já recebeu no sistema.
    Se lembrar de mais alguma coisa é só ajustar e enviar de novo. Obrigado! 💚</div>
  </form>
</div>
<script>
(function () {
  var CUSTOM = 'digitar valor…';

  function pickRow(item) {
    var row = document.createElement('div');
    row.className = 'pick';
    row.dataset.item = item;
    var b = document.createElement('b'); b.textContent = item; row.appendChild(b);
    return row;
  }

  document.querySelectorAll('.chips').forEach(function (grid) {
    var field = grid.dataset.field;
    var single = grid.dataset.single === '1';
    var values = JSON.parse(grid.dataset.values || '[]');
    var extras = JSON.parse(grid.dataset.extra || '{}');
    var picked = document.getElementById('picked-' + field);

    function addPicked(item) {
      var row = pickRow(item);
      if (values.length) {
        var sel = document.createElement('select');
        sel.className = 'val';
        var opt0 = document.createElement('option');
        opt0.value = ''; opt0.textContent = 'valor?'; sel.appendChild(opt0);
        values.concat([CUSTOM]).forEach(function (v) {
          var o = document.createElement('option'); o.value = v; o.textContent = v; sel.appendChild(o);
        });
        var inp = document.createElement('input');
        inp.type = 'text'; inp.className = 'custom'; inp.placeholder = 'R$…'; inp.maxLength = 30;
        sel.addEventListener('change', function () {
          inp.style.display = sel.value === CUSTOM ? 'inline-block' : 'none';
        });
        row.appendChild(sel); row.appendChild(inp);
      }
      var ex = extras[item];
      if (ex) {
        var sel2 = document.createElement('select');
        sel2.className = 'extra';
        var e0 = document.createElement('option');
        e0.value = ''; e0.textContent = ex.ph; sel2.appendChild(e0);
        ex.options.forEach(function (v) {
          var o = document.createElement('option'); o.value = v; o.textContent = v; sel2.appendChild(o);
        });
        row.appendChild(sel2);
      }
      picked.appendChild(row);
    }
    function removePicked(item) {
      picked.querySelectorAll('.pick').forEach(function (r) {
        if (r.dataset.item === item) r.remove();
      });
    }
    function clearAll() {
      grid.querySelectorAll('.chip.on').forEach(function (c) { c.classList.remove('on'); });
      picked.innerHTML = '';
    }

    grid.addEventListener('click', function (ev) {
      var chip = ev.target.closest('.chip');
      if (!chip || chip.classList.contains('other-add')) return;
      if (chip.dataset.none) {                 // "none of these" — exclusive
        var was = chip.classList.contains('on');
        clearAll();
        if (!was) chip.classList.add('on');
        return;
      }
      var noneChip = grid.querySelector('.chip-none.on');
      if (noneChip) noneChip.classList.remove('on');
      if (single && !chip.classList.contains('on')) clearAll();
      chip.classList.toggle('on');
      if (chip.classList.contains('on')) addPicked(chip.dataset.item);
      else removePicked(chip.dataset.item);
    });

    var otherIn = grid.querySelector('.other-in');
    grid.querySelector('.other-add').addEventListener('click', function () {
      var name = (otherIn.value || '').trim();
      if (!name) return;
      otherIn.value = '';
      var c = document.createElement('button');
      c.type = 'button'; c.className = 'chip on'; c.dataset.item = name; c.textContent = name;
      grid.insertBefore(c, grid.querySelector('.other'));
      if (single) { clearAll(); c.classList.add('on'); }
      addPicked(name);
    });
    otherIn.addEventListener('keydown', function (ev) {
      if (ev.key === 'Enter') { ev.preventDefault(); grid.querySelector('.other-add').click(); }
    });
  });

  var f = document.getElementById('f');
  f.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var data = {};
    document.querySelectorAll('.chips').forEach(function (grid) {
      var field = grid.dataset.field;
      var noneChip = grid.querySelector('.chip-none.on');
      if (noneChip) { data[field] = [{ item: noneChip.dataset.item || noneChip.textContent, valor: '' }]; return; }
      var items = [];
      document.getElementById('picked-' + field).querySelectorAll('.pick').forEach(function (r) {
        var sel = r.querySelector('select.val');
        var valor = '';
        if (sel) {
          valor = sel.value === CUSTOM ? (r.querySelector('.custom').value || '').trim() : sel.value;
        }
        var entry = { item: r.dataset.item, valor: valor };
        var ex = r.querySelector('select.extra');
        if (ex && ex.value) entry.detalhe = ex.value;
        items.push(entry);
      });
      if (items.length) data[field] = items;
    });
    f.querySelectorAll('input[type=radio]:checked').forEach(function (r) { data[r.name] = r.value; });
    f.querySelectorAll('textarea').forEach(function (t) { if (t.value.trim()) data[t.name] = t.value; });

    var btn = document.getElementById('send');
    btn.disabled = true; btn.textContent = 'Enviando…';
    fetch(location.pathname + '?k=${key}', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(data),
    }).then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      document.getElementById('done').style.display = 'block';
      document.getElementById('err').style.display = 'none';
      window.scrollTo(0, document.body.scrollHeight);
    }).catch(function (e) {
      var el = document.getElementById('err');
      el.textContent = 'Não consegui enviar (' + e.message + '). Chama o Diego 🙂';
      el.style.display = 'block';
    }).finally(function () {
      btn.disabled = false; btn.textContent = 'Enviar respostas';
    });
  });
})();
</script></body></html>`;
};

// Sanitize one submitted field: textarea/radio answers arrive as strings,
// chips answers as [{item, valor}].
const cleanAnswer = (v) => {
  if (typeof v === 'string') return v.trim() ? v.slice(0, 200000) : null;
  if (Array.isArray(v)) {
    const items = v.slice(0, 100)
      .filter((x) => x && typeof x.item === 'string' && x.item.trim())
      .map((x) => {
        const it = { item: x.item.slice(0, 60), valor: String(x.valor || '').slice(0, 60) };
        if (x.detalhe) it.detalhe = String(x.detalhe).slice(0, 60);
        return it;
      });
    return items.length ? items : null;
  }
  return null;
};

module.exports = function makeOnboardingRouter(deps) {
  const { requireAuth, dispatchNotification, PORT } = deps;
  const router = express.Router();

  // biso-auth'd: mint/read the key and return the shareable LAN URL.
  router.get('/finance/onboarding-link', requireAuth, (_req, res) => {
    try {
      const key = loadOrMintKey();
      const url = `http://${lanIPv4()}:${PORT}/finance/onboarding?k=${key}`;
      res.json({ url, key, answered: fs.existsSync(path.join(OB_DIR, 'latest.json')) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // biso-auth'd: read the latest answers (used in the personalization step).
  router.get('/finance/onboarding-answers', requireAuth, (_req, res) => {
    try {
      const raw = fs.readFileSync(path.join(OB_DIR, 'latest.json'), 'utf8');
      res.type('application/json').send(raw);
    } catch { res.status(404).json({ error: 'no answers yet' }); }
  });

  // key-auth'd (LAN): the questionnaire page itself.
  router.get('/finance/onboarding', (req, res) => {
    if (!keyOk(req)) return res.status(403).type('text').send('link inválido — confira a URL com o Diego');
    res.type('html').send(renderPage(String(req.query.k)));
  });

  // key-auth'd (LAN): receive answers.
  router.post('/finance/onboarding', (req, res) => {
    if (!keyOk(req)) return res.status(403).json({ error: 'invalid key' });
    const body = req.body || {};
    const answers = {};
    for (const f of FIELDS) {
      const v = cleanAnswer(body[f.id]);
      if (v != null) answers[f.id] = v;
    }
    const ts = new Date().toISOString();
    const rec = { ts, version: 2, answers, fields: FIELDS.map(({ id, sec, label }) => ({ id, sec, label })) };
    try {
      fs.mkdirSync(OB_DIR, { recursive: true });
      fs.writeFileSync(path.join(OB_DIR, `answers-${ts.replace(/[:.]/g, '-')}.json`), JSON.stringify(rec, null, 2) + '\n', 'utf8');
      fs.writeFileSync(path.join(OB_DIR, 'latest.json'), JSON.stringify(rec, null, 2) + '\n', 'utf8');
      try {
        dispatchNotification({
          code: 9, text: `Gabriela respondeu o questionário financeiro (${Object.keys(answers).length} campos)`,
          log: true, tags: ['finance'], source: 'finance-onboarding',
        });
      } catch { /* notification is best-effort */ }
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  return router;
};
