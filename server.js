// bisa — cockpit pessoal no browser (irmã do biso, alma do myPKA Cockpit).
// Server core: Express + WS + chokidar sobre a pasta de dados da usuária.
//
// Deliberadamente enxuto: os módulos de domínio vivem em lib/ como router
// factories com injeção de dependência (padrão herdado do biso R1-R7).
// Features biso-only (english coach, copilot, gain, recorder, rtk, echoes)
// NÃO são montadas aqui — ver docs/CRONOGRAMA.md §Desvios.

const path = require('path');
const fs = require('fs');
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
  if (req.path === '/fs/write' || req.path.startsWith('/pkm/inbox') || req.path.startsWith('/sentinel') || req.path === '/biso' || req.path.startsWith('/biso/')) return next();
  if (req.path.startsWith('/api/hook/') || req.path.startsWith('/feedback') || req.path === '/vault/write') return bigJson(req, res, next);
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
const { router: notifyRouter, dispatchNotification } = makeNotify({
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
push.bridgeNotifications(dispatchNotification);

// === pareamento QR (supervisor) ============================================
const makePair = require('./lib/pair');
app.use(makePair({ requireSupervisor, AUTH_TOKEN, PORT }).router);

// === feedback (anotações iPad+Pencil → inbox que o dev lê no Mac) ===========
const makeFeedback = require('./lib/feedback');
app.use(makeFeedback({ requireAuth, getCwd: () => CWD, broadcast: (...a) => broadcast(...a) }));

// === sentinel (proxy reverso → Frigate, câmeras/monitoramento) ==============
const makeSentinel = require('./lib/sentinel');
const sentinel = makeSentinel({ requireAuth });
app.use(sentinel.router);

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

// Chat "Biso": reusa a máquina de sessão stream-json do bisa, mas apontada p/ o
// projeto do biso e com as envs do biso injetadas. Os eventos llm.* dessa sessão
// são renomeados p/ biso.llm.* para não colidir com o chat do bisa (mesmo broadcast).
const makeBisoSession = require('./lib/llm/session');
const bisoBroadcast = (obj) => {
  if (obj && typeof obj.type === 'string' && obj.type.startsWith('llm')) {
    broadcast(Object.assign({}, obj, { type: 'biso.' + obj.type }));
  } else { broadcast(obj); }
};
// CWD do chat = projeto ATIVO do biso, lido de .meta/projects.json A CADA TURNO —
// então trocar de projeto no biso reflete no chat sem reiniciar o bisa. Override
// explícito: env BISO_CHAT_CWD. Fallback: CWD do .env do biso, depois o dir do biso.
const resolveBisoCwd = () => {
  if (process.env.BISO_CHAT_CWD) return BISO_CHAT_CWD;      // override explícito
  try {
    const pj = JSON.parse(fs.readFileSync(path.join(BISO_DIR, '.meta', 'projects.json'), 'utf8'));
    const cur = (pj.projects || []).find((p) => p.id === pj.current);
    if (cur && cur.path && fs.existsSync(cur.path)) return cur.path;
  } catch {}
  return BISO_CHAT_CWD;
};

const bisoSession = makeBisoSession({
  CWD: BISO_CHAT_CWD, getCwd: resolveBisoCwd, CLAUDE_CMD, USER_SHELL,
  broadcast: bisoBroadcast, dispatchNotification,
  extraEnv: { BISO_URL, BISO_TOKEN, BISO_JOURNAL },
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
// Chips de follow-up p/ o Caderno: um claude -p curto e barato propõe 2-3 próximas
// mensagens após cada resposta. Best-effort — falha vira lista vazia, sem erro.
// Fora do namespace /biso (logo tem o body parseado pelo express.json).
app.post('/biso-followups', requireAuth, async (req, res) => {
  const user = String((req.body && req.body.user) || '').slice(0, 2000);
  const assistant = String((req.body && req.body.assistant) || '').slice(0, 4000);
  if (!user && !assistant) return res.json({ suggestions: [] });
  const prompt = `Última troca de uma conversa com um agente de código (Claude Code):\n\n[Usuário]\n${user}\n\n[Assistente]\n${assistant}\n\nProponha de 2 a 3 mensagens CURTAS (máx ~6 palavras cada) que o usuário poderia enviar a seguir para avançar o trabalho. Devem ser DISTINTAS entre si (não redundantes) e acionáveis. Responda APENAS um array JSON de strings, nada mais.`;
  try {
    const out = await headless.runClaudeHeadless(prompt, resolveBisoCwd(), 25000, { feature: 'biso-followups' });
    let arr = [];
    const m = out && out.match(/\[[\s\S]*\]/);
    if (m) { try { arr = JSON.parse(m[0]); } catch {} }
    arr = Array.isArray(arr) ? arr.filter((s) => typeof s === 'string' && s.trim()).slice(0, 3) : [];
    res.json({ suggestions: arr });
  } catch { res.json({ suggestions: [] }); }
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
    res.json({ path: rel, content: fs.readFileSync(abs, 'utf8'), mtimeMs: fs.statSync(abs).mtimeMs });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/vault/write', requireAuth, (req, res) => {
  try {
    const rel = req.body && req.body.path;
    const content = req.body && req.body.content;
    if (!rel || typeof content !== 'string') return res.status(400).json({ error: 'path+content obrigatórios' });
    const abs = resolveInsideVault(rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, 'utf8');
    res.json({ ok: true, path: rel, mtimeMs: fs.statSync(abs).mtimeMs });
  } catch (e) { res.status(400).json({ error: e.message }); }
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

console.log(`[bisa] ponte biso → ${BISO_URL} (chat → projeto ativo: ${resolveBisoCwd()})${BISO_TOKEN ? '' : ' [SEM TOKEN — confira BISO_DIR/.env]'}`);
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

server.listen(PORT, HOST, () => {
  console.log(`[bisa] online em http://localhost:${PORT} — dados: ${CWD}`);
  const os = require('os');
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const i of ifaces || []) {
      if (i.family === 'IPv4' && !i.internal) console.log(`[bisa]        http://${i.address}:${PORT}`);
    }
  }
});
