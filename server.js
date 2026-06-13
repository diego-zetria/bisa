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
const globalJson = express.json({ limit: '64kb' });
const bigJson = express.json({ limit: '5mb' });
app.use((req, res, next) => {
  if (req.path === '/fs/write' || req.path.startsWith('/pkm/inbox')) return next();
  if (req.path.startsWith('/api/hook/')) return bigJson(req, res, next);
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
  if (pathName !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, (ws) => { ws._role = role; wss.emit('connection', ws, req); });
});

const clients = new Set();
const broadcast = (obj) => {
  const msg = JSON.stringify(obj);
  for (const ws of clients) { try { ws.send(msg); } catch {} }
};

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.on('close', () => clients.delete(ws));
  ws.on('message', (raw) => {
    let msg; try { msg = JSON.parse(raw); } catch { return; }
    if (msg && msg.type && msg.type.startsWith('llm')) llm.handleWsMessage(ws, msg);
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
