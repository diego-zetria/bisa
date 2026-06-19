// run-agent.js — agente do "Modo Anotar": aplica as anotações abertas editando
// o frontend (public/) via `claude -p`, com rede de segurança:
//   • só edita public/ (prompt) e só commita public/ (git)  → servidor protegido
//   • 1 commit git por mudança                              → reversível
//   • uma execução por vez (lock), drenando a fila          → sem edições simultâneas
//   • recarrega o iPad ao terminar                          → vê o resultado na hora
// Spawnado destacado pelo servidor (sobrevive a reinícios). Ligado por
// BISA_FEEDBACK_AGENT=1. Nunca é editado por si mesmo (vive em lib/).

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO = path.resolve(__dirname, '..', '..');
const CWD = process.env.CWD || path.join(require('os').homedir(), 'bisa-data');
const INBOX = path.join(CWD, 'feedback', 'inbox.jsonl');
const LOCK = path.join(CWD, 'feedback', '.agent.lock');
const PORT = parseInt(process.env.PORT || '7778', 10);
const TOKEN = process.env.AUTH_TOKEN || '';
const CLAUDE = process.env.CLAUDE_CMD || 'claude';
const SHELL = process.env.SHELL || '/bin/bash';
const LOCK_STALE_MS = 10 * 60 * 1000;
const RUN_TIMEOUT_MS = 5 * 60 * 1000;

const readAll = () => {
  try {
    return fs.readFileSync(INBOX, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
};
const writeAll = (items) =>
  fs.writeFileSync(INBOX, items.map((x) => JSON.stringify(x)).join('\n') + (items.length ? '\n' : ''));
const setStatus = (id, status, extra) => {
  const items = readAll();
  const it = items.find((x) => x.id === id);
  if (it) { it.status = status; Object.assign(it, extra || {}); writeAll(items); }
};

// Lock por arquivo (atômico via flag 'wx'); rouba se estiver velho (crash anterior).
const acquireLock = () => {
  try { fs.writeFileSync(LOCK, String(process.pid), { flag: 'wx' }); return true; }
  catch {
    try {
      if (Date.now() - fs.statSync(LOCK).mtimeMs > LOCK_STALE_MS) {
        fs.writeFileSync(LOCK, String(process.pid)); return true;
      }
    } catch {}
    return false;
  }
};
const releaseLock = () => { try { fs.unlinkSync(LOCK); } catch {} };

// Env do filho: remove chaves de API que sobrescreveriam o billing da assinatura
// (mesma defesa do headless do bisa — evita cobrança via API por engano).
const childEnv = () => {
  const e = { ...process.env };
  if (process.env.BISA_HEADLESS_PRESERVE_API_KEY !== '1') {
    delete e.ANTHROPIC_API_KEY; delete e.ANTHROPIC_AUTH_TOKEN;
  }
  return e;
};

const promptFor = (a) => `Você é o agente do "Modo Anotar" do app bisa (PWA pessoal, vanilla JS, sem build).
A usuária tocou num elemento da tela no iPad e pediu uma mudança. Aplique-a editando o frontend.

Tela: ${a.screen}  → arquivo: public/screens/${a.screen}.js
Estilos globais: public/style.css (tokens de tema em :root)
Elemento (seletor CSS): ${a.selector}
Texto do elemento: "${a.elementText || ''}"
Pedido da usuária: "${a.request}"

Regras:
- Faça a MENOR mudança que atenda o pedido, no estilo do código existente.
- Edite SOMENTE arquivos dentro de public/. NUNCA edite server.js, lib/, .env, nem rode comandos ou inicie o servidor.
- Use as variáveis de tema (ex: --positive, --warn, --negative, --primary), nunca cores cruas.
- Se o pedido for ambíguo a ponto de você ter que adivinhar (ex.: "mudar a cor" sem dizer qual cor), NÃO edite nada — é melhor deixar para revisão do que aplicar um chute.
- Não explique nada; apenas faça a edição e termine.`;

// claude -p com edição auto-aceita (acceptEdits); prompt via stdin; no repo.
const runClaude = (prompt) => {
  const r = spawnSync(SHELL, ['-lic', `${CLAUDE} --permission-mode acceptEdits -p`], {
    cwd: REPO, input: prompt, encoding: 'utf8', env: childEnv(), timeout: RUN_TIMEOUT_MS,
  });
  return r.status === 0;
};

const git = (args) => spawnSync('git', args, { cwd: REPO, encoding: 'utf8' });
// public/ tem mudanças não commitadas? (o dev está editando) — se sim, NÃO
// rodamos: o agente commitaria o trabalho do dev junto. Gate anti-colisão.
const publicDirty = () => {
  const r = git(['status', '--porcelain', '--', 'public']);
  return r.status === 0 && r.stdout.trim().length > 0;
};
const commitPublic = (a) => {
  git(['add', '--', 'public']);
  if (git(['diff', '--cached', '--quiet', '--', 'public']).status === 0) return false; // nada mudou
  git(['commit', '-m', `anota(${a.screen}): ${a.request}`.slice(0, 200), '--', 'public']);
  return true;
};

const post = async (route, body) => {
  try {
    await fetch(`http://127.0.0.1:${PORT}/feedback/${route}`, {
      method: 'POST', headers: { 'x-bisa-token': TOKEN, 'content-type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {}
};
const reload = () => post('reload');
const notify = (text) => post('notify', { text });

(async () => {
  if (!acquireLock()) process.exit(0); // outro agente já está drenando a fila
  try {
    for (let guard = 0; guard < 50; guard++) {
      const open = readAll().filter((x) => x.status === 'open');
      if (open.length === 0) break;
      const a = open[0];

      // Gate anti-colisão: se public/ está sujo (dev editando), não aplica —
      // commitaria o trabalho dele junto. Deixa OPEN (re-tenta na próxima
      // rodada, quando a árvore estiver limpa) e avisa o iPad.
      if (publicDirty()) {
        setStatus(a.id, 'open', { blockedReason: 'tela com mudanças não salvas (dev editando) — na fila', blockedAt: new Date().toISOString() });
        await notify('Anotação recebida — aplico assim que a tela estiver livre.');
        break;
      }

      setStatus(a.id, 'applying', { startedAt: new Date().toISOString() });
      if (runClaude(promptFor(a))) {
        if (commitPublic(a)) {
          setStatus(a.id, 'resolved', { resolvedAt: new Date().toISOString() });
          await reload();
        } else {
          // claude rodou mas não mudou nada → pedido provavelmente ambíguo
          setStatus(a.id, 'needs-review', { needsReviewAt: new Date().toISOString(), reason: 'nenhuma mudança aplicada — pedido pode estar ambíguo' });
          await notify('Não consegui aplicar a anotação (pedido ambíguo?). Pode detalhar?');
        }
      } else {
        setStatus(a.id, 'error', { erroredAt: new Date().toISOString() });
        await notify('Erro ao aplicar a anotação — vou revisar.');
      }
    }
  } finally { releaseLock(); }
})();
