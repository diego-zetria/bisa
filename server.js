// bisa — cockpit pessoal no browser (irmã do biso, alma do myPKA Cockpit).
// Server core: Express + WS + chokidar sobre a pasta de dados da usuária.
//
// Deliberadamente enxuto: os módulos de domínio vivem em lib/ como router
// factories com injeção de dependência (padrão herdado do biso R1-R7).
// Features biso-only (english coach, copilot, gain, recorder, rtk, echoes)
// NÃO são montadas aqui — ver docs/CRONOGRAMA.md §Desvios.

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const express = require('express');
const chokidar = require('chokidar');
const { WebSocketServer } = require('ws');

const bootstrap = require('./lib/bootstrap');
const {
  PORT, HOST, AUTH_TOKEN, CLAUDE_CMD, USER_SHELL,
  safeEq, parseCookies, extractToken, setTokenCookie,
  MAX_FILE_BYTES, WATCH_IGNORE,
  EXT_BINARY, EXT_IMAGE, MIME,
  makeResolveInsideCwd, makeMoveToTrash,
  copyRecursive,
  runShell,
} = bootstrap;

// Pasta de dados DELA. Fixa por instância — bisa não tem project switching.
const CWD = process.env.CWD || path.join(require('os').homedir(), 'bisa-data');
if (!fs.existsSync(CWD)) {
  console.error(`[bisa] FATAL: pasta de dados não existe: ${CWD}. Rode scripts/seed-data.sh primeiro.`);
  process.exit(1);
}

// Supervisor (Diego): segundo token com poderes extras (PTY, QR, custos).
const SUPERVISOR_TOKEN = process.env.SUPERVISOR_TOKEN || '';
const isSupervisor = (req) => !!SUPERVISOR_TOKEN && safeEq(extractToken(req), SUPERVISOR_TOKEN);
const isAuthed = (req) => safeEq(extractToken(req), AUTH_TOKEN) || isSupervisor(req);
// Dual-token: a usuária e o supervisor passam; routers recebem este.
const requireAuth = (req, res, next) => {
  if (!isAuthed(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
};
const requireSupervisor = (req, res, next) => {
  if (!isSupervisor(req)) return res.status(401).json({ error: 'unauthorized' });
  next();
};

const resolveInsideCwd = makeResolveInsideCwd(() => CWD);
const moveToTrash = makeMoveToTrash(() => CWD);

const app = express();

// WS broadcast — declared early (hoisted fn + const Set) because some modules
// (pkm indexer) broadcast synchronously during construction, before the WS
// server below exists. clients stays empty until connections arrive; that's
// fine — broadcasting to zero clients is a no-op.
const clients = new Set();
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  for (const ws of clients) { try { ws.send(msg); } catch {} }
}

const globalJson = express.json({ limit: '64kb' });
const bigJson = express.json({ limit: '5mb' });
app.use((req, res, next) => {
  if (req.path === '/fs/write' || req.path.startsWith('/pkm/inbox') || req.path === '/vault/raw-write' || req.path === '/media/upload' || req.path.startsWith('/sentinel') || req.path === '/biso' || req.path.startsWith('/biso/') || req.path === '/novela' || req.path.startsWith('/novela/')) return next();
  if (req.path.startsWith('/api/hook/') || req.path.startsWith('/feedback') || req.path === '/vault/write' || req.path === '/finance/onboarding') return bigJson(req, res, next);
  return globalJson(req, res, next);
});

// ?token=... válido → seta cookie (1 ano) antes do static, como no biso.
app.use((req, res, next) => {
  if (req.query && req.query.token
      && (safeEq(req.query.token, AUTH_TOKEN) || (SUPERVISOR_TOKEN && safeEq(req.query.token, SUPERVISOR_TOKEN)))) {
    setTokenCookie(res, req.query.token);
  }
  next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/healthz', (_req, res) => res.type('text').send('ok'));
app.get('/auth-check', (req, res) => {
  if (!isAuthed(req)) return res.status(401).json({ ok: false });
  res.json({ ok: true, role: isSupervisor(req) ? 'supervisor' : 'user' });
});

// Desbloqueio local — o "selo"/runa da tela inicial (public/gate.js). SEM auth
// por design: roda na rede local dela; o ritual é experiência, não barreira.
// Seta o cookie e devolve o token de usuária p/ o cliente usar (header + WS).
app.post('/unlock', (_req, res) => {
  setTokenCookie(res, AUTH_TOKEN);
  res.json({ ok: true, token: AUTH_TOKEN });
});

// === fs api (portado do biso R2) ===========================================
const makeFsRouter = require('./lib/fs-api');
app.use(makeFsRouter({
  requireAuth, resolveInsideCwd, getCwd: () => CWD,
  safeEq, extractToken, AUTH_TOKEN,
  MAX_FILE_BYTES, EXT_BINARY, EXT_IMAGE, MIME,
  copyRecursive, moveToTrash,
}));

// === codex (journal) — portado do biso R3/R4 ===============================
const codexStore = require('./lib/codex/store');
const {
  CODEX_DIR,
  todayCodex, nowHMCodex, weekdayFor, genId,
  ensureJournalExists, loadJournal, saveJournal,
  findOrCreateDay, autoCloseStaleWorkdaySessions,
} = codexStore;
ensureJournalExists();

const makeCodexApiRouter = require('./lib/codex/api');
app.use(makeCodexApiRouter({ requireAuth, codexStore }));

// === notificações (R6a) ====================================================
const makeNotify = require('./lib/notify');
const { router: notifyRouter, dispatchNotification, onNotification } = makeNotify({
  requireAuth,
  loadJournal, findOrCreateDay, saveJournal, genId, todayCodex, nowHMCodex,
  broadcast: (...a) => broadcast(...a),
});
app.use(notifyRouter);

// === rotinas/hábitos =======================================================
const routinesStore = require('./lib/routines/store');
const makeRoutinesRouter = require('./lib/routines/api');
app.use(makeRoutinesRouter({
  requireAuth, routinesStore,
  logCompletion: (text) => dispatchNotification({
    code: 9, text, log: true, tags: ['routine'], silent: true, source: 'routines',
  }),
}));
require('./lib/routines/reminders')({ routinesStore, dispatchNotification });

// === finanças ==============================================================
const financeStore = require('./lib/finance/store');
const makeFinanceRouter = require('./lib/finance/api');
app.use(makeFinanceRouter({
  requireAuth, financeStore,
  actual: require('./lib/finance/actual'),
  ghostfolio: require('./lib/finance/ghostfolio'),
  irpf: require('./lib/finance/irpf'),
  runHeadless: (...a) => llm.runHeadlessForJob('finance-insight', ...a),
  getCwd: () => CWD,
}));
const makeOnboardingRouter = require('./lib/finance/onboarding');
app.use(makeOnboardingRouter({ requireAuth, dispatchNotification, PORT }));

// === motor LLM (sessão chat + política + jobs) =============================
const makeHeadless = require('./lib/codex/headless');
const headless = makeHeadless({ CODEX_DIR, USER_SHELL, dispatchNotification });

const makeLlm = require('./lib/llm');
const llm = makeLlm({
  requireAuth, requireSupervisor, isSupervisor,
  CWD, CLAUDE_CMD, USER_SHELL, CODEX_DIR,
  headless, dispatchNotification,
  broadcast: (...a) => broadcast(...a),
});
app.use(llm.router);

// limpeza de ditado (fase 3): transcript bruto → texto escrito, via lib/llm
const makeDitado = require('./lib/ditado');
app.use(makeDitado({ requireAuth, llm }).router);

// Scheduler de jobs (briefing/reflexão/semanal) — loop do biso, com o runner
// roteado pela política da lib/llm (claude -p vs API, ver lib/llm/policy.js).
const makeLoop = require('./lib/codex/loop');
const loop = makeLoop({
  CODEX_DIR,
  todayCodex, weekdayFor,
  loadJournal, findOrCreateDay, saveJournal, autoCloseStaleWorkdaySessions,
  runClaudeHeadless: (...a) => llm.runHeadlessForJob('loop', ...a),
  dispatchNotification,
  runCorrectionsJob: () => {},            // biso-only — não existe no bisa
  loadCopilotConfig: () => null,          // biso-only
  buildCopilotBalanceContext: () => '',   // biso-only
  buildRoutinesContext: (date) => {
    try { return routinesStore.briefingContext(routinesStore.load(), date); }
    catch { return ''; }
  },
});
llm.attachLoop(loop);

// === planner (blocos do dia, highlight, metas da semana, ICS) ==============
const makePlanner = require('./lib/planner');
app.use(makePlanner({
  requireAuth, CWD,
  dispatchNotification,
  quickAddLlm: (text) => llm.microTask('quickadd', text),
}).router);

// === pkm (entidades, wikilinks, backlinks, grafo, busca, inbox) ============
const makePkm = require('./lib/pkm');
const pkm = makePkm({ requireAuth, CWD, broadcast: (...a) => broadcast(...a) });
app.use(pkm.router);

// === push (Web Push / PWA) =================================================
const makePush = require('./lib/push');
const push = makePush({ requireAuth, CWD });
app.use(push.router);
// lembretes/notificações relevantes também via push
push.bridgeNotifications(onNotification);

// === pareamento QR (supervisor) ============================================
const makePair = require('./lib/pair');
app.use(makePair({ requireSupervisor, AUTH_TOKEN, PORT }).router);

// === feedback (anotações iPad+Pencil → inbox que o dev lê no Mac) ===========
const makeFeedback = require('./lib/feedback');
app.use(makeFeedback({ requireAuth, getCwd: () => CWD, broadcast: (...a) => broadcast(...a) }));

// === mídia (inbox de vídeos/arquivos iPad → Mac, tela "Mídia") ==============
const makeMedia = require('./lib/media');
app.use(makeMedia({ requireAuth, getCwd: () => CWD, moveToTrash, broadcast: (...a) => broadcast(...a) }));

// === métricas de uso (loops de medição) =====================================
// Pares que antes evaporavam: transcript bruto→limpo aceito, rascunho→mensagem
// enviada, previsão mostrada→aceita. Ficam locais (<CWD>/metrics/eventos.jsonl)
// e alimentam o few-shot do /biso-predict. Best-effort, nunca bloqueia a UI.
const METRICS_FILE = path.join(CWD, 'metrics', 'eventos.jsonl');
app.post('/metrics/log', requireAuth, (req, res) => {
  const kind = String((req.body && req.body.kind) || '').slice(0, 40);
  if (!kind) return res.status(400).json({ error: 'kind obrigatório' });
  const data = (req.body && typeof req.body.data === 'object' && req.body.data) ? req.body.data : {};
  const row = { ts: new Date().toISOString(), kind };
  for (const [k, v] of Object.entries(data).slice(0, 12)) {
    row[k] = typeof v === 'string' ? v.slice(0, 600) : v;
  }
  try {
    fs.mkdirSync(path.dirname(METRICS_FILE), { recursive: true });
    fs.appendFileSync(METRICS_FILE, JSON.stringify(row) + '\n');
  } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true });
});
const readMetrics = (kind, n) => {
  try {
    return fs.readFileSync(METRICS_FILE, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } })
      .filter((r) => r && r.kind === kind).slice(-n);
  } catch { return []; }
};

// === saúde & custos (card em Ajustes) =======================================
// Gasto de API do mês (llm-usage.jsonl, código de budget já existia sem tela)
// + status dos LaunchAgents da stack de voz.
const { monthlyApiSpend } = require('./lib/llm/usage');
app.get('/ajustes/health', requireAuth, (_req, res) => {
  const labels = ['com.bisa.server', 'com.bisa.stt', 'com.bisa.stt-en', 'com.bisa.tts'];
  let list = '';
  try { list = require('child_process').execSync('launchctl list', { encoding: 'utf8', timeout: 4000 }); } catch {}
  const agents = labels.map((label) => {
    const line = list.split('\n').find((l) => l.trim().endsWith(label));
    const pid = line ? line.trim().split(/\s+/)[0] : '';
    return { label, up: !!line && pid !== '-' };
  });
  let monthUsd = 0; try { monthUsd = monthlyApiSpend(CWD) || 0; } catch {}
  res.json({
    agents,
    api: {
      monthUsd: +monthUsd.toFixed(2),
      budgetUsd: parseFloat(process.env.API_BUDGET_MONTHLY_USD || '25') || 25,
      keyPresent: !!process.env.ANTHROPIC_API_KEY,
    },
  });
});

// === sentinel (proxy reverso → Frigate, câmeras/monitoramento) ==============
const makeSentinel = require('./lib/sentinel');
const sentinel = makeSentinel({ requireAuth });
app.use(sentinel.router);

// === stt (proxy reverso → WhisperLiveKit, ditado local) =====================
const makeStt = require('./lib/stt');
const stt = makeStt({ requireAuth });
app.use(stt.router);

// === tts (voz das respostas: say no Mac + cache, player no iPad) ============
const makeTts = require('./lib/tts');
app.use(makeTts({ requireAuth }).router);

// === ponte biso (proxy REST do biso :7777 + chat nativo no projeto do biso) =
// Auto-configura lendo o .env do biso (porta, token, CWD). Tudo sob a auth do
// bisa: o iPad fala só com o bisa; o token do biso é injetado no servidor.
const BISO_DIR = process.env.BISO_DIR || path.resolve(__dirname, '..', 'biso');
const bisoEnv = (() => {
  const out = {};
  try {
    for (const line of fs.readFileSync(path.join(BISO_DIR, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].trim();
    }
  } catch {}
  return out;
})();
const BISO_URL = process.env.BISO_URL || `http://127.0.0.1:${bisoEnv.PORT || 7777}`;
const BISO_TOKEN = process.env.BISO_TOKEN || bisoEnv.AUTH_TOKEN || '';
const BISO_CHAT_CWD = process.env.BISO_CHAT_CWD || bisoEnv.CWD || BISO_DIR;
const BISO_JOURNAL = process.env.BISO_JOURNAL || path.join(BISO_DIR, 'codex', 'journal.md');

const makeBisoBridge = require('./lib/biso-bridge');
app.use(makeBisoBridge({ requireAuth, BISO_URL, BISO_TOKEN }).router);

// I6 — botão "algo está estranho 🛟": pacote de diagnóstico + aviso ao Diego.
const makeDiagnostico = require('./lib/diagnostico');
app.use(makeDiagnostico({ requireAuth, CWD, BISO_URL, BISO_TOKEN }));

// === ponte de eventos remotos (biso /api/events → Web Push + WS) ============
// Eventos do corp-watch (menções/DMs do Slack corp etc.) chegam ao biso; esta
// ponte faz poll com cursor e transforma push:true em notificação nativa no
// iPad. Ver biso/docs/remote-actions.md.
const makeEventsBridge = require('./lib/events-bridge');
makeEventsBridge({
  BISO_URL, BISO_TOKEN, push,
  broadcast: (...a) => broadcast(...a),
  META: process.env.BISA_META_DIR || path.join(CWD, '.meta'),
}).start();

// === ticker da Ziggy (alexa-claude-bridge :7788) ============================
// Digests da tradução contínua de reuniões, em texto ao vivo no iPad.
// Mesmo padrão das pontes: o iPad só fala com o bisa; a porta fica aqui.
app.get('/ziggy/digests', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/digests');
    res.json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Tradutor de reunião do iPad → bridge /howsay (feature exclusiva do Ziggy
// trazida pra dentro da bisa; a porta 7788 fica escondida).
app.post('/ziggy/howsay', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/howsay', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phrase: (req.body && req.body.phrase) || '' }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Fluxos McGraw da tela Ziggy (rituais diários de trabalho → claude -p no
// cwd do mcgraw, via bridge). Pode levar ~2 min — sem timeout no proxy.
app.post('/ziggy/mcgraw', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/mcgraw', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ flow: req.body && req.body.flow, text: (req.body && req.body.text) || '' }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Clipboard dos Macs (pessoal via pbpaste, corp via biso run) p/ preencher
// o campo do card McGraw com 1 toque. Corp pode levar ~10-30s (fila do biso).
app.get('/ziggy/clipboard', requireAuth, async (req, res) => {
  try {
    const src = req.query.src === 'corp' ? 'corp' : 'local';
    const r = await fetch(`http://127.0.0.1:7788/clipboard?src=${src}`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Caminho de volta: manda texto do iPad pro clipboard do corp (ou deste Mac).
app.post('/ziggy/clipboard', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/clipboard', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ src: (req.body && req.body.src) || 'local', text: (req.body && req.body.text) || '' }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Guia de comandos da Echo (COMANDOS.md do bridge) p/ consulta na tela Ziggy.
app.get('/ziggy/comandos', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/comandos');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Revisão semanal pré-agregada (padrão Houmann): GET junta a semana (via
// bridge), POST salva a revisão como nota no caderno + série de domínios.
app.get('/ziggy/weekly', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/weekly-review');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/ziggy/weekly', requireAuth, async (req, res) => {
  try {
    const { answers = {}, domains = {} } = req.body || {};
    const now = new Date();
    const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
    const week = `${local.getFullYear()}-W${String(Math.ceil((((local - new Date(local.getFullYear(), 0, 1)) / 864e5) + new Date(local.getFullYear(), 0, 1).getDay() + 1) / 7)).padStart(2, '0')}`;
    const dom = Object.entries(domains).map(([k, v]) => `- ${k}: ${'★'.repeat(Number(v) || 0)}${'☆'.repeat(5 - (Number(v) || 0))} (${v}/5)`).join('\n');
    const md = `# Revisão semanal — ${week}\n\n## O que foi feito\n${answers.done || '—'}\n\n## O que mudou\n${answers.changed || '—'}\n\n## Foco da próxima semana\n${answers.focus || '—'}\n\n## Domínios\n${dom}\n\n— revisão feita na aba ⚡ Ziggy, ${now.toISOString()}\n`;
    const inbox = path.join(CWD, 'pkm', 'Inbox');
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(path.join(inbox, `revisao-semanal-${week}.md`), md);
    // série temporal dos domínios (sparklines futuras + comentário do Claude)
    fs.appendFileSync(path.join(CWD, 'codex', 'weekly-domains.jsonl'),
      JSON.stringify({ ts: now.toISOString(), week, domains }) + '\n');
    res.json({ ok: true, note: `revisao-semanal-${week}.md` });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Recarga remota: o app.js já trata {type:'reload'} no WS — este endpoint
// emite. Uso: depois de deploy de tela, recarregar o iPad sem tocar nele.
app.post('/dev/reload', requireAuth, (_req, res) => {
  broadcast({ type: 'reload' });
  res.json({ ok: true });
});
// Nikin Match (placar do jogo do mês) — estado + toggle de meta.
app.get('/ziggy/match', requireAuth, async (_req, res) => {
  try { const r = await fetch('http://127.0.0.1:7788/match'); res.status(r.status).json(await r.json()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/ziggy/match/meta', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/match/meta', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ player: req.body && req.body.player, id: req.body && req.body.id }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Nikin (rotina com prêmios em dinheiro): saldo/extrato + resgate real.
app.get('/ziggy/nikin', requireAuth, async (_req, res) => {
  try { const r = await fetch('http://127.0.0.1:7788/nikin'); res.status(r.status).json(await r.json()); }
  catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/ziggy/nikin/redeem', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/nikin/redeem', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: req.body && req.body.amount, desc: req.body && req.body.desc }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Hábitos (engine no bridge: auto-detectados + manuais) p/ o heatmap da aba Ziggy.
app.get('/ziggy/habits', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/habits');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/ziggy/habits/check', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/habits/check', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: req.body && req.body.id, source: 'tap' }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});

// Contagem p/ o badge do ícone do PWA: inbox do caderno + envelopes em alerta.
app.get('/badge/count', requireAuth, async (_req, res) => {
  let count = 0;
  try {
    count += fs.readdirSync(path.join(CWD, 'pkm', 'Inbox')).filter((f) => f.endsWith('.md')).length;
  } catch {}
  try {
    const r = await fetch('http://127.0.0.1:7788/envelopes');
    const d = await r.json();
    count += (d.envelopes || []).filter((e) => e.flagged).length;
  } catch {}
  res.json({ count });
});

// Agente de finanças (conversa com acesso real aos dados do finance; escrita
// sandboxada no diretório + confirmação em conversa). ~30-90s por turno.
app.post('/ziggy/finagent', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/finagent', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: (req.body && req.body.text) || '' }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Memória (journal do biso) por texto no iPad — bridge /journal → /codex/ask.
app.get('/ziggy/journal', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:7788/journal?q=${encodeURIComponent(String(req.query.q || ''))}`);
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Fila de PRs (gh no corp via bridge): listar / analisar / aprovar (gate
// humano = o toque no iPad). Análise pode levar ~2 min — sem timeout aqui.
app.get('/ziggy/prs', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/prs');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.post('/ziggy/prs/:action(analyze|approve)', requireAuth, async (req, res) => {
  try {
    const r = await fetch(`http://127.0.0.1:7788/prs/${req.params.action}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ repo: req.body && req.body.repo, number: req.body && req.body.number }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Status do ecossistema (checks paralelos no bridge) p/ o card 🩺 da tela.
app.get('/ziggy/ecosystem', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/ecosystem');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Guia de fluxos/automações (FLUXOS.md do bridge) — mesmo padrão.
app.get('/ziggy/fluxos', requireAuth, async (_req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/fluxos');
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
// Liga/desliga a tradução contínua do Ziggy a partir do iPad.
app.post('/ziggy/translate', requireAuth, async (req, res) => {
  try {
    const r = await fetch('http://127.0.0.1:7788/translate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ on: !!(req.body && req.body.on) }),
    });
    res.status(r.status).json(await r.json());
  } catch (e) { res.status(502).json({ error: e.message }); }
});
app.get('/ziggy', requireAuth, (_req, res) => {
  res.type('html').send(`<!doctype html><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Ziggy — ticker</title>
<style>
  body{background:#101418;color:#d7dee6;font:17px/1.5 system-ui;-webkit-font-smoothing:antialiased;margin:0;padding:24px 16px 60px}
  .wrap{max-width:680px;margin:0 auto}
  h1{font-size:15px;letter-spacing:.16em;text-transform:uppercase;color:#8494a3;margin:0 0 4px}
  #st{font-size:13px;color:#5ad1c8;margin-bottom:18px}
  .d{border-left:3px solid #ffb454;background:#161c22;border-radius:0 8px 8px 0;padding:10px 14px;margin-bottom:10px}
  .d time{display:block;font-size:11.5px;color:#8494a3;margin-bottom:2px;font-variant-numeric:tabular-nums}
  .say{margin-top:8px;display:flex;flex-wrap:wrap;gap:6px}
  .chip{font-size:13.5px;color:#5ad1c8;background:#1d2833;border:1px solid #232c35;border-radius:14px;padding:3px 11px}
  .vazio{color:#8494a3;font-size:14px}
  .hs{background:#161c22;border:1px solid #232c35;border-radius:12px;padding:14px;margin-bottom:22px}
  .hs textarea{width:100%;box-sizing:border-box;background:#101418;color:#d7dee6;border:1px solid #232c35;border-radius:8px;padding:10px 12px;font:16px/1.4 system-ui;resize:vertical;min-height:56px}
  .hs .row{display:flex;gap:8px;margin-top:10px;align-items:center}
  .hs button{background:#5ad1c8;color:#08201e;border:none;border-radius:8px;padding:10px 18px;font:600 15px system-ui;min-height:44px}
  .hs button:disabled{opacity:.5}
  .hs .out{margin-top:12px;font-size:19px;line-height:1.45;color:#eaf5f3;background:#12211f;border-left:3px solid #5ad1c8;border-radius:0 8px 8px 0;padding:12px 14px;display:none}
  .hs .out.on{display:block}
  .hs .out b{font-size:11px;letter-spacing:.14em;text-transform:uppercase;color:#5ad1c8;display:block;margin-bottom:5px;font-weight:700}
  .hs .copy{background:none;color:#8494a3;border:1px solid #232c35;padding:6px 12px;font-size:13px;min-height:0}
</style>
<div class="wrap">
  <h1>Ziggy ▸ como falo em inglês?</h1>
  <div class="hs">
    <textarea id="hsIn" placeholder="Digite em português (ou inglês quebrado) o que você quer dizer na reunião…"></textarea>
    <div class="row"><button id="hsGo">Traduzir</button><span id="hsSt" style="font-size:13px;color:#8494a3"></span></div>
    <div class="out" id="hsOut"><b>diga assim</b><span id="hsTxt"></span><div class="row" style="margin-top:10px"><button class="copy" id="hsCopy">copiar</button></div></div>
  </div>
  <h1>Ziggy ▸ ticker da reunião</h1><div id="st">conectando…</div><div id="feed"></div>
</div>
<script>
const hsIn=document.getElementById('hsIn'),hsGo=document.getElementById('hsGo'),hsSt=document.getElementById('hsSt'),
      hsOut=document.getElementById('hsOut'),hsTxt=document.getElementById('hsTxt'),hsCopy=document.getElementById('hsCopy');
async function howsay(){
  const phrase=hsIn.value.trim(); if(!phrase) return;
  hsGo.disabled=true; hsSt.textContent='pensando…';
  try{
    const r=await fetch('/ziggy/howsay',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({phrase})});
    const d=await r.json();
    if(!r.ok) throw new Error(d.error||('erro '+r.status));
    hsTxt.textContent=d.english; hsOut.classList.add('on'); hsSt.textContent='';
  }catch(e){ hsSt.textContent='falhou: '+e.message; }
  finally{ hsGo.disabled=false; }
}
hsGo.onclick=howsay;
hsIn.addEventListener('keydown',e=>{ if((e.metaKey||e.ctrlKey)&&e.key==='Enter') howsay(); });
hsCopy.onclick=()=>{ navigator.clipboard&&navigator.clipboard.writeText(hsTxt.textContent); hsCopy.textContent='copiado ✓'; setTimeout(()=>hsCopy.textContent='copiar',1500); };
</script>
<script>
async function tick(){
  try{
    const r = await fetch('/ziggy/digests'); const d = await r.json();
    document.getElementById('st').textContent =
      (d.active ? '● digerindo a cada ~30s' : '○ parado — fale "Ziggy, ask B B S start digest"') + (d.radio ? ' · 📻 rádio ligada' : '');
    const feed = document.getElementById('feed');
    const esc = s => String(s).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
    feed.innerHTML = (d.digests||[]).slice().reverse().map(x =>
      '<div class="d"><time>'+new Date(x.ts).toLocaleTimeString('pt-BR')+'</time>'+esc(x.text)
      + ((x.say&&x.say.length) ? '<div class="say">'+x.say.map(s=>'<span class="chip">💬 '+esc(s)+'</span>').join('')+'</div>' : '')
      + '</div>'
    ).join('') || '<div class="vazio">nenhum digest ainda — os blocos aparecem aqui conforme a reunião rola.</div>';
  }catch(e){ document.getElementById('st').textContent = 'bridge fora do ar: '+e.message; }
}
tick(); setInterval(tick, 5000);
</script>`);
});

// === ponte novela-shorts (proxy REST + mídia da API :7779) ==================
// Mesmo padrão do biso: o iPad fala só com o bisa; a porta/token da API ficam
// no servidor. A API roda como LaunchAgent com.bisa.novela (KeepAlive) desde
// 2026-07-15; manual: python api.py no projeto novela-shorts.
const NOVELA_URL = process.env.NOVELA_URL || 'http://127.0.0.1:7779';
const NOVELA_TOKEN = process.env.NOVELA_TOKEN || '';
const makeNovelaBridge = require('./lib/novela-bridge');
app.use(makeNovelaBridge({ requireAuth, NOVELA_URL, NOVELA_TOKEN }).router);

// Chat "Biso": reusa a máquina de sessão stream-json do bisa, mas apontada p/ o
// projeto do biso e com as envs do biso injetadas. Os eventos llm.* dessa sessão
// são renomeados p/ biso.llm.* para não colidir com o chat do bisa (mesmo broadcast).
const makeBisoSession = require('./lib/llm/session');
// Push de turno longo do caderno (vídeo 2026-07-20): execuções de 1-2+ min
// deixavam o usuário só esperando olhando a tela. Quando um turno do caderno
// termina com mais de 45s, avisa os dispositivos inscritos via Web Push.
// Não há sinal pronto de "página visível/ativa" no WS (sem heartbeat), então
// enviamos sempre que passa do limiar. Falha de push é silenciosa.
const BISO_PUSH_MIN_MS = 45 * 1000;
let bisoTurn = { startedAt: 0, text: '' };
const bisoPushWatch = (obj) => {
  try {
    if (obj.type === 'llm.state' && obj.state === 'starting') {
      bisoTurn = { startedAt: Date.now(), text: '' };
    } else if (obj.type === 'llm.text' && obj.delta) {
      // guarda a CAUDA do texto — a resposta final vem depois do último
      // sentinela <!--biso-seg--> (fronteira pós-ferramenta do session.js)
      bisoTurn.text = (bisoTurn.text + obj.delta).slice(-16000);
    } else if (obj.type === 'llm.done' && bisoTurn.startedAt) {
      const ms = Date.now() - bisoTurn.startedAt;
      bisoTurn.startedAt = 0;
      if (ms < BISO_PUSH_MIN_MS) return;
      const seg = bisoTurn.text.split('<!--biso-seg-->').pop() || '';
      const plain = seg
        .replace(/```[\s\S]*?```/g, ' ')          // blocos de código
        .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // links → só o texto
        .replace(/[*_`#>|-]+/g, ' ')              // ênfase/headers/tabelas
        .replace(/\s+/g, ' ').trim();
      const dur = `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, '0')}`;
      const body = plain.slice(0, 90) + (plain.length > 90 ? '…' : '') + ` (${dur})`;
      push.notify('Biso ✅ resposta pronta no caderno', body, { tag: 'biso-caderno', url: '/' })
        .catch((e) => console.warn('[bisa/push] caderno:', e.message));
    }
  } catch (e) { console.warn('[bisa/push] caderno watch:', e.message); }
};
const bisoBroadcast = (obj) => {
  if (obj && typeof obj.type === 'string' && obj.type.startsWith('llm')) {
    bisoPushWatch(obj);
    broadcast(Object.assign({}, obj, { type: 'biso.' + obj.type }));
  } else { broadcast(obj); }
};
// FOCO do caderno: para onde a sessão de chat da aba Biso aponta. É INDEPENDENTE
// do projeto ativo do biso (decisão 2026-07-02): trocar o foco no caderno não mexe
// na workstation. 'geral' (padrão) = CWD neutro ~/bisa-data/caderno-geral, com
// CLAUDE.md próprio afinado p/ leitura manuscrita; qualquer outro id vem do
// .meta/projects.json do biso (lido do disco a cada turno — funciona com o biso
// desligado). Override explícito: env BISO_CHAT_CWD. A sessão --resume é por CWD,
// então cada foco mantém sua própria conversa.
const CHAT_FOCUS_FILE = path.join(CWD, '.meta', 'biso-chat.json');
const CADERNO_GERAL_DIR = path.join(CWD, 'caderno-geral');
try {   // seed do modo Geral (1ª execução)
  fs.mkdirSync(CADERNO_GERAL_DIR, { recursive: true });
  const cm = path.join(CADERNO_GERAL_DIR, 'CLAUDE.md');
  if (!fs.existsSync(cm)) fs.writeFileSync(cm, `# Caderno (bisa) — modo Geral

Você está conversando pelo CADERNO do bisa: o usuário escreve À MÃO (Apple Pencil)
num iPad e lê as respostas numa tela pequena.

- Responda curto e direto — leitura manuscrita, sem paredes de texto.
- ESPELHE O IDIOMA do usuário: mensagem em português → responda em português;
  mensagem em inglês (ex.: "Hello") → responda em inglês, e mantenha o idioma
  até ele trocar.
- Prefira listas curtas e passos numerados; evite blocos de código longos.
- Este modo é GERAL: não há projeto de código em foco. Para tarefas de um projeto
  específico, o usuário troca o foco no seletor do caderno.
- Você roda no Mac pessoal com permissões amplas — seja conservador com comandos
  destrutivos; confirme antes de apagar/mover qualquer coisa.

## Gráficos inline (fence \`\`\`chart)

Quando os dados forem "gráficáveis" (comparação, tendência, proporção, KPIs),
prefira um fence \`\`\`chart com JSON em vez de tabela — o caderno desenha SVG:

    \`\`\`chart
    {"type":"bar","title":"Gastos do mês","unit":"R$",
     "data":[["Mercado",1842.3],["Transporte",420]]}
    \`\`\`

- "type": "bar" (grandezas ≥0) · "line" (tendência) · "donut" (proporção,
  ≤6 fatias) · "stat" (KPIs; valor pode ser string).
- "data": SEMPRE pares [rótulo, valor]; "unit"/"title" opcionais.
- Faixa boa: 3–8 itens; muitos números → tabela normal (já ganha barras).
- NUNCA invente valores para caber num gráfico.
`, 'utf8');
} catch (e) { console.warn('[bisa] caderno-geral seed:', e.message); }
const readBisoProjects = () => {
  try { return JSON.parse(fs.readFileSync(path.join(BISO_DIR, '.meta', 'projects.json'), 'utf8')).projects || []; }
  catch { return []; }
};
const readChatFocus = () => {
  try { return JSON.parse(fs.readFileSync(CHAT_FOCUS_FILE, 'utf8')).project || 'geral'; }
  catch { return 'geral'; }
};
const readChatMeta = () => {
  try { return JSON.parse(fs.readFileSync(CHAT_FOCUS_FILE, 'utf8')); } catch { return {}; }
};
const writeChatMeta = (patch) => {
  const cur = Object.assign(readChatMeta(), patch);
  fs.mkdirSync(path.dirname(CHAT_FOCUS_FILE), { recursive: true });
  fs.writeFileSync(CHAT_FOCUS_FILE, JSON.stringify(cur, null, 2) + '\n', 'utf8');
};
const writeChatFocus = (id) => writeChatMeta({ project: id });
// Idioma do caderno (pt|en): injetado como system prompt em CADA turno do chat
// (a regra por saudação "Olá/Hello" do CLAUDE.md era ignorada com histórico).
const readChatLang = () => (readChatMeta().lang === 'en' ? 'en' : 'pt');
const writeChatLang = (lang) => writeChatMeta({ lang });
// Modo Estudo (📚 no caderno): sessão de pesquisa/aprendizado — o Claude mantém
// uma nota-guia viva no vault sem pedir permissão a cada turno (vídeos
// 2026-07-19: o usuário pediu "vá documentando" à mão e confirmou 4 ofertas
// "quer que eu salve?" por chip).
const readChatMode = () => (readChatMeta().mode === 'estudo' ? 'estudo' : '');
const writeChatMode = (mode) => writeChatMeta({ mode: mode === 'estudo' ? 'estudo' : '' });
// TL;DR primeiro (vídeo 2026-07-20): respostas longas chegavam com o veredito
// no FINAL — no iPad o usuário rola muito até a conclusão. Instrução PERMANENTE
// e SÓ do caderno (não vale p/ o chat do bisa nem p/ as Notas).
const TLDR_PROMPT = `Quando sua resposta for longa e estruturada (mais de ~300 palavras OU 3+ seções), comece com um bloco "**TL;DR:**" de 2-3 linhas contendo a conclusão/veredito e a ação recomendada, ANTES das seções — o leitor está num iPad e rola muito até chegar ao veredito. Respostas curtas ficam como estão, sem TL;DR.`;
const ESTUDO_PROMPT = `Modo Estudo ativo — o usuário está pesquisando/aprendendo um tema (não programando).
- Mantenha UMA nota-guia viva desta sessão no vault Obsidian: crie-a na primeira resposta (nome descritivo em kebab-case) e ATUALIZE a mesma nota a cada turno com o que foi consolidado.
- NÃO pergunte "quer que eu salve/adicione na nota?" — atualize direto e sinalize numa linha curta ("✅ nota atualizada: <o que entrou>").
- Termine cada resposta oferecendo 2-3 caminhos curtos de aprofundamento (a/b/c).`;
const resolveBisoCwd = () => {
  if (process.env.BISO_CHAT_CWD) return BISO_CHAT_CWD;      // override explícito
  const focus = readChatFocus();
  if (focus !== 'geral') {
    const p = readBisoProjects().find((x) => x.id === focus);
    if (p && p.path && fs.existsSync(p.path)) return p.path;
  }
  return CADERNO_GERAL_DIR;   // padrão e fallback (projeto removido/desconhecido)
};

const bisoSession = makeBisoSession({
  CWD: BISO_CHAT_CWD, getCwd: resolveBisoCwd, getLang: readChatLang, CLAUDE_CMD, USER_SHELL,
  getExtraSystemPrompt: () => TLDR_PROMPT + (readChatMode() === 'estudo' ? '\n\n' + ESTUDO_PROMPT : ''),
  broadcast: bisoBroadcast, dispatchNotification,
  extraEnv: { BISO_URL, BISO_TOKEN, BISO_JOURNAL },
  // O agente da aba Biso pode EXECUTAR ações no Mac pessoal (buscar arquivos,
  // rodar comandos/scripts) — modo headless não tem prompt de permissão, então
  // liberamos tudo. Escolha do usuário 2026-07-01. Mantenha SÓ na tailnet
  // (Tailscale) e com AUTH_TOKEN forte: é execução total de comando no Mac.
  permissionMode: 'bypassPermissions',
});
const handleBisoWsMessage = (ws, msg) => {
  switch (msg.type) {
    case 'biso.llm.send': {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) return;
      const attachments = Array.isArray(msg.attachments) ? msg.attachments : [];
      bisoSession.send(text, attachments).catch(() => {});
      break;
    }
    case 'biso.llm.interrupt': bisoSession.interrupt(); break;
    default: break;
  }
};
// Foco do caderno: lista os focos possíveis (Geral + projetos do biso, lidos do
// disco) e troca o CWD da sessão do chat. Fora do namespace /biso (body parseado).
app.get('/biso-chat/project', requireAuth, (_req, res) => {
  const projects = [{ id: 'geral', name: 'Geral', desc: 'sem projeto em foco' }]
    .concat(readBisoProjects().map((p) => ({ id: p.id, name: p.name, desc: p.desc || '' })));
  res.json({ current: readChatFocus(), cwd: resolveBisoCwd(), projects });
});
// Preview dos arquivos tocados pelo agente no turno (cards "📁 arquivos" do
// caderno). Caminho ABSOLUTO (vem do tool_use), confinado ao CWD do foco atual.
app.get('/biso-chat/file', requireAuth, (req, res) => {
  const q = String(req.query.path || '');
  // Canonicaliza ANTES de comparar: o projects.json do biso registra
  // "/Users/…/Projects/x" (P maiúsculo) e o cwd real é "…/projects/x" —
  // no APFS case-insensitive tudo funciona, menos um startsWith (403
  // indevido, teste 2026-07-15). realpath resolve caixa E symlinks.
  const canon = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
  const root = canon(resolveBisoCwd());
  // O agente grava tanto com caminho absoluto quanto relativo ao cwd do foco
  // (Write com "jira/tasks/…" → relativo resolve contra o foco, nunca contra
  // o cwd do processo da bisa).
  const abs = canon(path.isAbsolute(q) ? q : path.join(resolveBisoCwd(), q));
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    return res.status(403).json({ error: 'arquivo fora do foco atual do caderno' });
  }
  try {
    const st = fs.statSync(abs);
    if (!st.isFile()) return res.status(400).json({ error: 'não é um arquivo' });
    if (st.size > 300 * 1024) return res.status(413).json({ error: 'grande demais para preview (' + Math.round(st.size / 1024) + 'KB)' });
    res.json({ name: path.basename(abs), path: abs, content: fs.readFileSync(abs, 'utf8') });
  } catch { res.status(404).json({ error: 'arquivo não encontrado' }); }
});
app.get('/biso-chat/mode', requireAuth, (_req, res) => res.json({ mode: readChatMode() }));
app.post('/biso-chat/mode', requireAuth, (req, res) => {
  writeChatMode(String((req.body && req.body.mode) || ''));
  res.json({ ok: true, mode: readChatMode() });
});
app.get('/biso-chat/lang', requireAuth, (_req, res) => res.json({ lang: readChatLang() }));
app.post('/biso-chat/lang', requireAuth, (req, res) => {
  const lang = String((req.body && req.body.lang) || '');
  if (lang !== 'pt' && lang !== 'en') return res.status(400).json({ error: 'lang deve ser pt ou en' });
  try { writeChatLang(lang); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, lang });
});
app.post('/biso-chat/project', requireAuth, (req, res) => {
  const id = String((req.body && req.body.id) || '');
  const ok = id === 'geral' || readBisoProjects().some((p) => p.id === id);
  if (!ok) return res.status(400).json({ error: 'projeto desconhecido: ' + id });
  try { writeChatFocus(id); } catch (e) { return res.status(500).json({ error: e.message }); }
  res.json({ ok: true, current: id, cwd: resolveBisoCwd() });
});

// Chips de follow-up p/ o Caderno: um claude -p curto e barato propõe 2-3 próximas
// mensagens após cada resposta. Best-effort — falha vira lista vazia, sem erro.
// Fora do namespace /biso (logo tem o body parseado pelo express.json).
app.post('/biso-followups', requireAuth, async (req, res) => {
  const user = String((req.body && req.body.user) || '').slice(0, 2000);
  const assistant = String((req.body && req.body.assistant) || '').slice(0, 4000);
  if (!user && !assistant) return res.json({ suggestions: [] });
  const prompt = `Última troca de uma conversa com um agente de código (Claude Code):\n\n[Usuário]\n${user}\n\n[Assistente]\n${assistant}\n\nProponha de 2 a 3 mensagens CURTAS (máx ~6 palavras cada) que o usuário poderia enviar a seguir para avançar o trabalho. REGRA PRIORITÁRIA: se a resposta do assistente TERMINA oferecendo opções (a/b/c) ou perguntando "quer que eu …?", as sugestões devem ser exatamente essas ofertas, encurtadas em imperativo (ex.: "Adicione a seção na nota") — são as únicas que o usuário aceita. Senão, proponha próximos passos DISTINTOS entre si e acionáveis. Responda APENAS um array JSON de strings, nada mais.`;
  try {
    const out = await headless.runClaudeHeadless(prompt, resolveBisoCwd(), 25000, { feature: 'biso-followups' });
    let arr = [];
    const m = out && out.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch {} }
    arr = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
    res.json({ suggestions: arr });
  } catch { res.json({ suggestions: [] }); }
});

// Lançamento por VOZ no finance: fala ditada → Haiku extrai a transação AUVP.
// SÓ parseia — a criação usa o POST /finance/tx existente, depois que a usuária
// confirma o resumo na tela ("mercado sessenta e dois reais" → 62 · custo-fixo).
app.post('/finance/voz', requireAuth, async (req, res) => {
  const texto = String((req.body && req.body.texto) || '').trim().slice(0, 500);
  if (!texto) return res.status(400).json({ error: 'texto vazio' });
  // datas LOCAIS — toISOString é UTC e vira o dia às 21h BRT (bug real 2026-07-13)
  const localISO = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const hoje = localISO(new Date());
  const prompt = `Extraia UMA transação financeira da fala ditada abaixo (pt-BR).

[Fala]
${texto}

Regras:
- "kind": "expense" (gasto/aporte) ou "income" (recebimento). Padrão: expense.
- "amount": número em reais ("sessenta e dois reais" → 62). OBRIGATÓRIO.
- "category": 1-2 palavras minúsculas (mercado, ifood, farmácia, salário…).
- "bucket": UM de custo-fixo|conforto|liberdade|metas|prazeres|conhecimento — só p/ expense. Guia: mercado/aluguel/contas→custo-fixo · restaurante/lazer→prazeres · curso/livro→conhecimento · aporte/investimento→liberdade · upgrade não essencial→conforto · objetivo específico→metas. Omita se income.
- "desc": descrição curta (máx 8 palavras) com o contexto restante.
- "date": "AAAA-MM-DD" só se a fala citar dia; hoje é ${hoje}, ontem foi ${localISO(new Date(Date.now() - 864e5))}; "dia 5" = dia 5 do mês corrente.
- "pending": true só se indicar provisão/futuro ("vou pagar", "a receber").
Responda APENAS JSON: {"kind":"expense","amount":62,"category":"mercado","bucket":"custo-fixo","desc":"compras da semana"}`;
  try {
    const out = await llm.microTask('finance-voz', prompt, { maxTokens: 200 });
    let parsed = {}; const m = out && out.match(/\{[\s\S]*\}/);
    if (m) { try { parsed = JSON.parse(m[0]); } catch {} }
    if (!(Number(parsed.amount) > 0)) return res.status(422).json({ error: 'não entendi o valor — repita com o valor em reais', parsed });
    res.json({ ok: true, parsed });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// Previsão ao vivo do caderno: rascunho PARCIAL → % de certeza da intenção +
// complementos prováveis (chips no write pad). v1 = LLM via microTask (Haiku
// quando há chave; senão claude -p) condicionado nas últimas mensagens do
// usuário — RF/redes locais exigiriam corpus que ainda não existe. Best-effort:
// qualquer falha vira {confidence:0, completions:[]}, nunca erro na UI.
app.post('/biso-predict', requireAuth, async (req, res) => {
  const draft = String((req.body && req.body.draft) || '').slice(0, 2000);
  const topic = String((req.body && req.body.topic) || '').slice(0, 500);
  const history = (Array.isArray(req.body && req.body.history) ? req.body.history : [])
    .map((s) => String(s || '').slice(0, 300)).filter(Boolean).slice(-8);
  const nWords = draft.trim().split(/\s+/).filter(Boolean).length;
  if (nWords < 3) return res.json({ confidence: 0, completions: [] });
  // Rascunho curto (<8 palavras) NÃO recebe histórico nem few-shot: herdar
  // assunto de outra conversa gerava completions fora de contexto (vídeo
  // 2026-07-14: chips de GitHub, a 45%, numa pergunta de culinária). Com pouco
  // texto, o assunto tem que vir do próprio rascunho.
  const rich = nWords >= 8;
  const aceitas = rich ? readMetrics('previsao-aceita', 3) : [];
  const prompt = `Você observa alguém digitando uma mensagem AINDA INCOMPLETA para um assistente pessoal num caderno de iPad (o assunto pode ser QUALQUER coisa: pesquisa, estudo, finanças, código — o tema corrente é o que vale).
${topic ? `\n[Tema atual da conversa — a resposta mais recente do assistente terminava assim; as continuações devem ser coerentes com ESTE tema]\n${topic.replace(/\n+/g, ' ')}\n` : ''}${rich && history.length ? `\n[Mensagens recentes do mesmo usuário — só ESTILO; não herde o assunto delas]\n${history.map((h) => '- ' + h.replace(/\n+/g, ' ')).join('\n')}\n` : ''}${aceitas.length ? `\n[Complementos que este usuário aceitou antes]\n${aceitas.map((a) => `- "${a.draft || ''}" → "${a.completion || ''}"`).join('\n')}\n` : ''}
[Rascunho parcial]
${draft}

Estime:
1. "confidence": inteiro 0-100 — quão previsível já está a INTENÇÃO completa (0 = começo ambíguo, 100 = intenção óbvia). Se o rascunho ainda não revela o ASSUNTO, confidence ≤ 25.
2. "completions": 2 a 3 CONTINUAÇÕES prováveis do rascunho (apenas o texto que falta, máx ~10 palavras cada, no idioma do rascunho, distintas entre si). Devem seguir o assunto do PRÓPRIO rascunho lido à luz do tema atual — nunca inventar um domínio que não aparece em nenhum dos dois.

Responda APENAS o JSON, sem markdown: {"confidence": 62, "completions": ["...", "..."]}`;
  try {
    const out = await llm.microTask('biso-predict', prompt, { maxTokens: 300, timeoutMs: 20000 });
    let obj = {}; const m = out && out.match(/\{[\s\S]*\}/);
    if (m) { try { obj = JSON.parse(m[0]); } catch {} }
    const confidence = Math.max(0, Math.min(100, Math.round(Number(obj.confidence) || 0)));
    const completions = (Array.isArray(obj.completions) ? obj.completions : [])
      .filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 120)).slice(0, 3);
    res.json({ confidence, completions });
  } catch { res.json({ confidence: 0, completions: [] }); }
});

// === vault Obsidian (frontend de escrita "Notas") =========================
// Acesso de arquivos confinado ao vault, independente do projeto ativo do biso.
const obsidianDir = () => {
  if (process.env.OBSIDIAN_DIR) return process.env.OBSIDIAN_DIR;
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(BISO_DIR, '.meta', 'projects.json'), 'utf8'));
    const o = (pj.projects || []).find((p) => p.id === 'obsidian' || /obsidian/i.test(p.name || ''));
    if (o && o.path && fs.existsSync(o.path)) return o.path;
  } catch {}
  return path.join(require('os').homedir(), 'Projects', 'obsidian');
};
const OBSIDIAN_DIR = obsidianDir();
const resolveInsideVault = makeResolveInsideCwd(() => OBSIDIAN_DIR);
// Gravamos no mesmo vault que o Obsidian pode estar editando → tratamos como um 2º
// cliente de sync. hash = token de versão (OCC); escrita atômica = leitor concorrente
// nunca vê arquivo parcial. Ver memória vault-write-safety.
const sha256 = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex');
function atomicWrite(abs, content) {
  const dir = path.dirname(abs);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, '.' + path.basename(abs) + '.tmp-' + process.pid + '-' + Date.now());
  fs.writeFileSync(tmp, content, 'utf8');
  fs.renameSync(tmp, abs);   // rename intra-FS é atômico (truncate-then-write não é)
}
app.get('/vault/list', requireAuth, (req, res) => {
  try {
    const rel = req.query.path || '.';
    const abs = resolveInsideVault(rel);
    const entries = fs.readdirSync(abs, { withFileTypes: true })
      .filter((d) => !d.name.startsWith('.'))
      .map((d) => ({ name: d.name, dir: d.isDirectory(), rel: (rel === '.' ? '' : rel + '/') + d.name }))
      .sort((a, b) => (b.dir - a.dir) || a.name.localeCompare(b.name));
    res.json({ root: OBSIDIAN_DIR, rel, entries });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/vault/file', requireAuth, (req, res) => {
  try {
    const rel = req.query.path;
    if (!rel) return res.status(400).json({ error: 'path obrigatório' });
    const abs = resolveInsideVault(rel);
    const content = fs.readFileSync(abs, 'utf8');
    res.json({ path: rel, content, hash: sha256(content), mtimeMs: fs.statSync(abs).mtimeMs });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/vault/write', requireAuth, (req, res) => {
  try {
    const rel = req.body && req.body.path;
    const content = req.body && req.body.content;
    const baseHash = req.body && req.body.baseHash;   // OCC: hash que o cliente leu ao abrir
    if (!rel || typeof content !== 'string') return res.status(400).json({ error: 'path+content obrigatórios' });
    const abs = resolveInsideVault(rel);
    // concorrência otimista: se o conteúdo no disco difere do que o cliente leu
    // (ex.: o Obsidian gravou por baixo), não sobrescreve — 412, p/ não perder a
    // outra versão. baseHash ausente = escrita nova/forçada (sem checagem).
    if (baseHash && fs.existsSync(abs)) {
      const cur = sha256(fs.readFileSync(abs, 'utf8'));
      if (cur !== baseHash) return res.status(412).json({ error: 'O arquivo mudou no disco (Obsidian?). Reabra a nota para não perder a outra versão.' });
    }
    atomicWrite(abs, content);
    res.json({ ok: true, path: rel, hash: sha256(content), mtimeMs: fs.statSync(abs).mtimeMs });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
// Arquivo BRUTO do vault (binário) p/ embutir no Canvas: <img>/<iframe> de imagem/PDF.
// Auth por cookie ou ?token= (img/iframe não mandam header). Confinado ao vault.
const VAULT_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.pdf': 'application/pdf', '.mp4': 'video/mp4', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
app.get('/vault/raw', requireAuth, (req, res) => {
  try {
    const rel = req.query.path; if (!rel) return res.status(400).send('path obrigatório');
    const abs = resolveInsideVault(rel);
    res.setHeader('content-type', VAULT_MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
    res.setHeader('cache-control', 'private, max-age=60');
    fs.createReadStream(abs).on('error', () => { if (!res.headersSent) res.status(404).end(); }).pipe(res);
  } catch (e) { res.status(400).send(e.message); }
});
// Escreve um arquivo BINÁRIO no vault (ex.: recorte PNG do anotador de PDF → cartão no Canvas).
// Corpo bruto (não-JSON); confinado ao vault; escrita atômica. Só extensões de mídia conhecidas.
app.post('/vault/raw-write', requireAuth, express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
  try {
    const rel = req.query.path; if (!rel) return res.status(400).json({ error: 'path obrigatório' });
    const ext = path.extname(rel).toLowerCase();
    if (!['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) return res.status(400).json({ error: 'extensão não permitida' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'corpo vazio' });
    const abs = resolveInsideVault(rel);
    const dir = path.dirname(abs); fs.mkdirSync(dir, { recursive: true });
    const tmp = path.join(dir, '.' + path.basename(abs) + '.tmp-' + process.pid + '-' + Date.now());
    fs.writeFileSync(tmp, req.body); fs.renameSync(tmp, abs);
    res.json({ ok: true, path: rel });
  } catch (e) { res.status(400).json({ error: e.message }); }
});

// IA do Canvas: claude -p headless, best-effort, request/response simples.
// Modos que criam cartões: brainstorm (usa 'topic') · expand/summarize (usam
// 'context') → { cards:[...], links:[[i,j]] }. Modos que operam no QUADRO:
//   organize   { cards:[{i,text}] }        → { groups:[{label, cards:[i]}] }
//   synthesize { context: quadro textual } → { note: markdown }
//   tasks      { context }                 → { tasks:["..."] }
app.post('/canvas-ai', requireAuth, async (req, res) => {
  const mode = String((req.body && req.body.mode) || 'brainstorm');
  const topic = String((req.body && req.body.topic) || '').slice(0, 2000);
  const context = String((req.body && req.body.context) || '').slice(0, 12000);
  const run = (prompt, ms) => headless.runClaudeHeadless(prompt, OBSIDIAN_DIR, ms || 40000, { feature: 'canvas-ai' });
  const firstJson = (out) => { const m = out && out.match(/\{[\s\S]*\}/); if (m) { try { return JSON.parse(m[0]); } catch {} } return {}; };
  try {
    if (mode === 'organize') {
      const inCards = (Array.isArray(req.body.cards) ? req.body.cards : []).slice(0, 80)
        .map((c) => ({ i: c.i | 0, text: String(c.text || '').slice(0, 280) }));
      if (inCards.length < 3) return res.json({ groups: [] });
      const lista = inCards.map((c) => `${c.i}: ${c.text.replace(/\n+/g, ' ')}`).join('\n');
      const prompt = `Agrupe os cartões de um quadro de ideias em 2 a 6 TEMAS coerentes. Cada cartão pertence a no máximo um tema; rótulos curtos (1-3 palavras, português).\n\n[Cartões]\n${lista}\n\nResponda APENAS JSON, sem markdown: {"groups":[{"label":"Tema","cards":[0,3,5]}]} — números são os índices dos cartões.`;
      const obj = firstJson(await run(prompt));
      const valid = new Set(inCards.map((c) => c.i));
      const groups = (Array.isArray(obj.groups) ? obj.groups : [])
        .map((g) => ({ label: String(g.label || '').slice(0, 40) || 'Tema', cards: (Array.isArray(g.cards) ? g.cards : []).filter((n) => Number.isInteger(n) && valid.has(n)) }))
        .filter((g) => g.cards.length).slice(0, 6);
      return res.json({ groups });
    }
    if (mode === 'synthesize') {
      const prompt = `Transforme o quadro de ideias abaixo numa nota markdown BEM estruturada, em português: um título (# ), seções por tema, bullets concisos e, se fizer sentido, uma seção final "## Próximos passos". NÃO invente conteúdo que não esteja no quadro.\n\n[Quadro]\n${context}\n\nResponda APENAS o markdown da nota, sem cercas de código nem comentários.`;
      let out = String(await run(prompt, 60000) || '').trim();
      out = out.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      return res.json({ note: out });
    }
    if (mode === 'ask') {
      // ✦ Perguntar no cartão: 'chain' = corrente de cartões-ancestrais (histórico
      // da conversa espacial), 'card' = conteúdo do cartão, 'question' opcional.
      const chain = String((req.body && req.body.chain) || '').slice(0, 9000);
      const card = String((req.body && req.body.card) || '').slice(0, 3000);
      const question = String((req.body && req.body.question) || '').slice(0, 1000);
      const prompt = `Você responde DENTRO de um quadro de ideias (canvas): sua resposta vira um cartão ligado ao atual.${chain ? `\n\n[Corrente de cartões até aqui — do mais antigo ao mais recente]\n${chain}` : ''}\n\n[Cartão atual]\n${card}\n\n[Pergunta]\n${question || 'Desenvolva/responda o conteúdo do cartão atual.'}\n\nResponda em português, CONCISO (cabe num cartão: 3-8 frases ou bullets curtos), markdown simples, sem título e sem cercas de código.`;
      let out = String(await run(prompt, 60000) || '').trim();
      out = out.replace(/^```(?:markdown|md)?\s*\n?/i, '').replace(/\n?```\s*$/i, '').trim();
      return res.json({ answer: out });
    }
    if (mode === 'tasks') {
      const prompt = `Extraia do quadro de ideias abaixo as tarefas ACIONÁVEIS (frases imperativas curtas, máx ~10 palavras cada, português). Inclua SÓ o que é de fato uma ação a executar — ideias soltas não viram tarefa. Máximo 10.\n\n[Quadro]\n${context}\n\nResponda APENAS um array JSON de strings, nada mais.`;
      const out = await run(prompt);
      let arr = []; const m = out && out.match(/\[[\s\S]*\]/); if (m) { try { arr = JSON.parse(m[0]); } catch {} }
      arr = (Array.isArray(arr) ? arr : []).filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim().slice(0, 140)).slice(0, 10);
      return res.json({ tasks: arr });
    }
    // modos que criam cartões (brainstorm/expand/summarize)
    let instr;
    if (mode === 'expand') instr = `Expanda as ideias abaixo em 3 a 5 cartões curtos e conectados (cada um 1 frase objetiva).\n\n[Ideias]\n${context}`;
    else if (mode === 'summarize') instr = `Resuma o conteúdo abaixo em 1 a 3 cartões curtos (cada um 1 frase).\n\n[Conteúdo]\n${context}`;
    else instr = `Faça um brainstorm sobre "${topic}". Gere de 4 a 7 cartões curtos (cada um 1 frase) e proponha ligações entre eles.`;
    const prompt = `${instr}\n\nResponda APENAS um JSON, sem markdown nem comentários, no formato: {"cards":["texto1","texto2"],"links":[[0,1],[1,2]]} — links são pares de índices 0-based de cartões conectados.`;
    const obj = firstJson(await run(prompt));
    const cards = Array.isArray(obj.cards) ? obj.cards.filter((s) => typeof s === 'string' && s.trim()).slice(0, 8) : [];
    const links = Array.isArray(obj.links) ? obj.links.filter((l) => Array.isArray(l) && l.length === 2 && Number.isInteger(l[0]) && Number.isInteger(l[1])) : [];
    res.json({ cards, links });
  } catch (e) { res.status(500).json({ error: 'IA indisponível' }); }
});

// Claude-assist das Notas: sessão própria no CWD do vault → enxerga o CLAUDE.md/
// skills/memórias da pasta (sabe os padrões a seguir). Eventos llm.* → notas.llm.*
// (não colide com o chat do bisa nem com o do Biso). Reusa a máquina de sessão.
const vaultBroadcast = (obj) => {
  if (obj && typeof obj.type === 'string' && obj.type.startsWith('llm')) {
    broadcast(Object.assign({}, obj, { type: 'notas.' + obj.type }));
  } else { broadcast(obj); }
};
const vaultSession = makeBisoSession({
  CWD: OBSIDIAN_DIR, CLAUDE_CMD, USER_SHELL,
  broadcast: vaultBroadcast, dispatchNotification,
  permissionMode: 'acceptEdits',   // o Claude das Notas pode editar arquivos do vault
});
const handleVaultWsMessage = (ws, msg) => {
  switch (msg.type) {
    case 'notas.llm.send': {
      const text = typeof msg.text === 'string' ? msg.text.trim() : '';
      if (!text) return;
      vaultSession.send(text, []).catch(() => {});
      break;
    }
    case 'notas.llm.interrupt': vaultSession.interrupt(); break;
    default: break;
  }
};

console.log(`[bisa] ponte biso → ${BISO_URL} (caderno → foco '${readChatFocus()}': ${resolveBisoCwd()})${BISO_TOKEN ? '' : ' [SEM TOKEN — confira BISO_DIR/.env]'}`);
console.log(`[bisa] vault obsidian (Notas) → ${OBSIDIAN_DIR}`);

// === HTTP + WS =============================================================
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

const wsAuthed = (req) => {
  const cookies = parseCookies(req.headers.cookie);
  const url = new URL(req.url, 'http://x');
  const tok = url.searchParams.get('token') || cookies[bootstrap.COOKIE_NAME] || '';
  if (safeEq(tok, AUTH_TOKEN)) return 'user';
  if (SUPERVISOR_TOKEN && safeEq(tok, SUPERVISOR_TOKEN)) return 'supervisor';
  return null;
};

server.on('upgrade', (req, socket, head) => {
  const role = wsAuthed(req);
  if (!role) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
  const pathName = new URL(req.url, 'http://x').pathname;
  if (pathName.startsWith('/sentinel')) return sentinel.upgrade(req, socket, head); // live view do Frigate
  if (pathName.startsWith('/stt')) return stt.upgrade(req, socket, head);           // ditado (Whisper local)
  if (pathName !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws._role = role; wss.emit('connection', ws, req); });
});

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg && msg.type && msg.type.startsWith('notas.llm')) handleVaultWsMessage(ws, msg);
    else if (msg && msg.type && msg.type.startsWith('biso.llm')) handleBisoWsMessage(ws, msg);
    else if (msg && msg.type && msg.type.startsWith('llm')) llm.handleWsMessage(ws, msg);
  });
  ws.send(JSON.stringify({ type: 'hello', role: ws._role }));
});

// Watcher da pasta dela → eventos fs ao vivo (journal/pkm atualizam sozinhos).
const watcher = chokidar.watch(CWD, {
  ignored: WATCH_IGNORE, ignoreInitial: true, depth: 6,
  awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
});
for (const ev of ['add', 'change', 'unlink']) {
  watcher.on(ev, (abs) => broadcast({ type: 'fs', event: ev, path: path.relative(CWD, abs) }));
}
watcher.on('error', (e) => console.error('[bisa] watcher:', e.message));

// Uma segunda instância deve morrer com o pid do ocupante, não com stack
// de EADDRINUSE — processo velho servindo código antigo é falha silenciosa.
server.on('error', (err) => {
  if (err && err.code === 'EADDRINUSE') {
    let pid = '';
    try { pid = require('child_process').execSync(`lsof -nP -iTCP:${PORT} -sTCP:LISTEN -t | head -1`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch {}
    console.error(`[bisa] FATAL: porta ${PORT} já em uso${pid ? ` pelo pid ${pid}` : ''} — outra bisa rodando? launchctl kickstart -k gui/$UID/com.bisa.server`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`[bisa] online em http://localhost:${PORT} — dados: ${CWD}`);
  const os = require('os');
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`[bisa]        http://${i.address}:${PORT}`);
    }
  }
});
