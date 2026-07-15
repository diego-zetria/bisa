// lib/llm/session.js
// Interactive Claude CLI session via stream-json protocol.
//
// PROTOCOL NOTES (discovered 2026-06-12 via probe-claude.js against v2.1.174):
//
//   stdin:  one JSON line per turn: {"type":"user","message":{"role":"user","content":"..."}}
//           Close stdin (or send EOF) to signal no more turns — in -p mode the
//           CLI runs one turn and exits when stdin closes.
//
//   stdout: newline-delimited JSON events:
//     {"type":"system","subtype":"init", "session_id":"...", "tools":[...]}
//       — first event; carries session_id and tool list
//     {"type":"system","subtype":"hook_started"|"hook_response"|"model_fallback"|...}
//       — session lifecycle noise; we skip most of these
//     {"type":"assistant","message":{"content":[{type:"text",text:"..."},{type:"tool_use",...}],...}}
//       — one event per content block; a single API response may emit multiple events
//     {"type":"user","message":{"content":[{type:"tool_result",...}]}}
//       — tool result auto-fed back by the CLI in -p mode (not sent by us)
//     {"type":"rate_limit_event", ...}
//       — safe to ignore
//     {"type":"result","subtype":"success","total_cost_usd":..., "session_id":"..."}
//       — final event; signals end of turn
//
//   PERMISSION FLOW: In -p (print) mode, tools run automatically without
//   permission prompts. There is NO control_request / can_use_tool / control_response
//   handshake in -p mode. Permission UI is an interactive-mode concept only.
//   Therefore we do NOT implement a permission flow here. The API contract
//   specifies llm.permission_request WS events; we stub them as never emitted.
//
//   MULTI-TURN: the CLI exits after the first turn in -p mode (stdin EOF).
//   For multi-turn interactive chat we must restart the CLI with --resume <session_id>
//   on each turn. State (session_id) is persisted to .meta/llm-session.json.
//
//   ENV SCRUB: ANTHROPIC_API_KEY and ANTHROPIC_AUTH_TOKEN are stripped from
//   the child env to prevent accidental API billing override of Max subscription,
//   matching lib/codex/headless.js behaviour (R1a, $498-incident prevention).

'use strict';

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const { appendUsage } = require('./usage');
const llmErrors = require('./errors');

// pt-BR tool name translation map
const TOOL_SUMMARY_PT = {
  Write:    (input) => `Criando/editando ${path.basename(input.file_path || input.path || '?')}`,
  Edit:     (input) => `Criando/editando ${path.basename(input.file_path || input.path || '?')}`,
  MultiEdit:(input) => `Editando múltiplos arquivos`,
  Read:     (input) => `Lendo ${path.basename(input.file_path || input.path || '?')}`,
  Bash:     (input) => `Executando um comando`,
  Glob:     (input) => `Procurando arquivos`,
  Grep:     (input) => `Procurando arquivos`,
  Glob2:    (input) => `Procurando arquivos`,
  LS:       (input) => `Listando arquivos`,
  WebFetch: (input) => {
    try { return `Acessando ${new URL(input.url).hostname.replace(/^www\./, '')}`; }
    catch { return 'Acessando a internet'; }
  },
  WebSearch:(input) => input.query
    ? `Pesquisando: “${String(input.query).slice(0, 60)}”`
    : 'Pesquisando na internet',
  Task:     (input) => `Executando uma tarefa`,
};

const toolSummaryPt = (name, input) => {
  const fn = TOOL_SUMMARY_PT[name];
  if (fn) { try { return fn(input || {}); } catch { /* ignore */ } }
  return `Usando ${name}`;
};

// Scrub env vars that could override Max-subscription billing (R1a).
const scrubEnv = (env) => {
  const out = { ...env };
  if (process.env.BISA_HEADLESS_PRESERVE_API_KEY !== '1') {
    delete out.ANTHROPIC_API_KEY;
    delete out.ANTHROPIC_AUTH_TOKEN;
  }
  delete out.CLAUDECODE; // allow nested claude invocation
  return out;
};

module.exports = function makeSession(deps) {
  const {
    CWD,
    getCwd,                    // opcional: resolve o CWD dinamicamente a cada turno (ponte biso → projeto ativo)
    getLang,                   // opcional: 'pt'|'en' por turno → --append-system-prompt fixa o idioma da resposta
    CLAUDE_CMD,
    USER_SHELL,
    broadcast,
    dispatchNotification,
    extraEnv,                  // opcional: envs extras mescladas no filho (ponte biso)
    permissionMode,            // opcional: --permission-mode (ex.: 'acceptEdits' p/ o Claude editar arquivos)
    appendUsage: _appendUsage, // may be overridden in tests
  } = deps;

  const usageFn = _appendUsage || appendUsage;

  // Session state file: persiste session_id p/ --resume, POR CWD (a ponte biso pode
  // apontar p/ projetos diferentes — cada um guarda seu próprio session_id).
  const sessionFileFor = (cwd) => path.join(cwd, '.meta', 'llm-session.json');
  // CWD efetivo de cada turno: getCwd() (dinâmico) ou o CWD fixo.
  const effectiveCwd = () => (typeof getCwd === 'function' && getCwd()) || CWD;

  let _state = 'idle'; // 'idle' | 'starting' | 'running'
  let _child = null;
  let _pendingText = '';  // buffer for in-progress text delta

  const setState = (s) => {
    _state = s;
    broadcast({ type: 'llm.state', state: s });
  };

  const readSessionId = (cwd) => {
    try {
      const s = JSON.parse(fs.readFileSync(sessionFileFor(cwd), 'utf8'));
      return s.sessionId || null;
    } catch { return null; }
  };

  const writeSessionId = (cwd, id) => {
    try {
      const f = sessionFileFor(cwd);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, JSON.stringify({ sessionId: id }, null, 2) + '\n', 'utf8');
    } catch (e) { console.warn('[llm/session] session file write failed:', e.message); }
  };

  // Build the CLI argv array for a -p (print) mode session.
  // Uses --resume if we have a prior session_id.
  const buildArgs = (sessionId) => {
    const args = [
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '-p',
    ];
    if (permissionMode) args.push('--permission-mode', permissionMode);
    if (getLang) {
      // por turno (não por sessão): trocar o idioma vale já na próxima mensagem,
      // e vence o histórico — regra por saudação era ignorada em sessão retomada
      const lang = getLang();
      if (lang === 'en') args.push('--append-system-prompt', 'Always respond in English, regardless of the language of the user message or of the earlier conversation history.');
      else if (lang === 'pt') args.push('--append-system-prompt', 'Responda sempre em português brasileiro, independentemente do idioma da mensagem do usuário ou do histórico anterior da conversa.');
    }
    if (sessionId) {
      args.push('--resume', sessionId);
    }
    return args;
  };

  // Spawn the CLI, send the user message, parse events.
  // Returns a Promise that resolves when the 'result' event arrives.
  const runTurn = (text, attachments) => new Promise((resolve, reject) => {
    if (_state !== 'idle') {
      // Queue not implemented — return a user-facing Portuguese error.
      broadcast({ type: 'llm.error', message: 'Uma conversa já está em andamento. Aguarde o término antes de enviar nova mensagem.' });
      return reject(new Error('session busy'));
    }

    // T6 — trava de limite/créditos: não gasta um spawn para receber o mesmo
    // erro de novo; responde com a mensagem amigável e o horário do reset.
    const lock = llmErrors.status();
    if (lock.locked) {
      broadcast({ type: 'llm.error', message: lock.friendly });
      return reject(new Error(`llm locked (${lock.kind})`));
    }

    setState('starting');

    const cwd = effectiveCwd();
    const sessionId = readSessionId(cwd);
    const args = buildArgs(sessionId);
    const env = Object.assign(scrubEnv(process.env), extraEnv || {});

    // Build content: text + optional attachment hints
    let content = text;
    if (attachments && attachments.length > 0) {
      const attList = attachments.map((p) => `- ${p}`).join('\n');
      content = `${text}\n\n[Arquivos anexados]\n${attList}`;
    }

    const child = spawn(CLAUDE_CMD, args, {
      cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // direct spawn — no shell quoting needed
    });
    _child = child;

    // Send user message
    const userMsg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content },
    });
    try {
      child.stdin.write(userMsg + '\n');
      child.stdin.end(); // signals end of this turn
    } catch (e) {
      console.warn('[llm/session] stdin write error:', e.message);
    }

    setState('running');

    let buf = '';
    let newSessionId = null;
    let resultReceived = false;
    let inTokens = 0;
    let outTokens = 0;
    let sentTextThisTurn = false;  // controla separador/sentinela entre blocos de texto
    let model = '';
    // HUD do caderno: correlaciona tool_use.id ↔ tool_result.tool_use_id para o
    // 'done' chegar com identidade/duração (antes chegava anônimo, name:null).
    const pendingTools = new Map();

    const processLine = (line) => {
      if (!line.trim()) return;
      let evt;
      try { evt = JSON.parse(line); }
      catch { return; }

      switch (evt.type) {
        case 'system': {
          if (evt.subtype === 'init' && evt.session_id) {
            newSessionId = evt.session_id;
            writeSessionId(cwd, newSessionId);
            // Capture model from init if available
            if (evt.model) model = evt.model;
          }
          // model_fallback: log but don't bother user
          if (evt.subtype === 'model_fallback' && evt.fallback_model) {
            model = evt.fallback_model;
            console.log(`[llm/session] model_fallback: ${evt.original_model} → ${evt.fallback_model}`);
          }
          // Other system subtypes (hook_started, hook_response, thinking_tokens) are ignored.
          break;
        }

        case 'assistant': {
          const msg = evt.message;
          if (!msg) break;

          // Accumulate token counts from usage on any assistant message that has them
          if (msg.usage) {
            inTokens = Math.max(inTokens, msg.usage.input_tokens || 0);
            outTokens += msg.usage.output_tokens || 0;
            if (!model && msg.model) model = msg.model;
            // ticker do HUD: progresso real (tokens/modelo) em vez de só cronômetro
            broadcast({ type: 'llm.usage', in: inTokens, out: outTokens, model });
          }

          const content = msg.content || [];
          for (const block of content) {
            if (block.type === 'text' && block.text) {
              // blocos de texto separados chegavam colados ("building now.Now the…")
              // — parágrafo entre blocos; sentinela marca fronteira pós-ferramenta
              // p/ o cliente recolher o "processo" e destacar só a resposta final.
              const sep = sentTextThisTurn ? '\n\n' : '';
              sentTextThisTurn = true;
              broadcast({ type: 'llm.text', delta: sep + block.text });
            } else if (block.type === 'tool_use') {
              if (sentTextThisTurn) { broadcast({ type: 'llm.text', delta: '\n\n<!--biso-seg-->\n\n' }); sentTextThisTurn = false; }
              const summaryPt = toolSummaryPt(block.name, block.input);
              if (block.id) pendingTools.set(block.id, { name: block.name, summaryPt, startedAt: Date.now() });
              // TodoWrite → checklist viva no HUD (feito/fazendo/próximo num relance)
              if (block.name === 'TodoWrite' && block.input && Array.isArray(block.input.todos)) {
                broadcast({
                  type: 'llm.todos',
                  todos: block.input.todos.slice(0, 20).map((t) => ({
                    content: String(t && t.content || '').slice(0, 140),
                    status: t && t.status || 'pending',
                  })),
                });
              }
              broadcast({
                type: 'llm.tool',
                id: block.id || null,
                name: block.name,
                summaryPt,
                status: 'start',
                detail: block.input,
              });
            } else if (block.type === 'thinking') {
              // HUD: pensamento visível (card colapsável no cliente)
              if (block.thinking) broadcast({ type: 'llm.thinking', delta: String(block.thinking).slice(0, 4000) });
            }
          }
          break;
        }

        case 'user': {
          // Tool results auto-fed back by CLI; broadcast tool completion.
          const msg = evt.message;
          if (!msg) break;
          const content = Array.isArray(msg.content) ? msg.content : [];
          for (const block of content) {
            if (block.type === 'tool_result') {
              // Correlaciona pelo tool_use_id → done com identidade e duração.
              const started = block.tool_use_id ? pendingTools.get(block.tool_use_id) : null;
              if (started) pendingTools.delete(block.tool_use_id);
              broadcast({
                type: 'llm.tool',
                id: block.tool_use_id || null,
                name: started ? started.name : null,
                summaryPt: started ? started.summaryPt : null,
                status: 'done',
                durationMs: started ? Date.now() - started.startedAt : undefined,
              });
            }
          }
          break;
        }

        case 'rate_limit_event': {
          // T6 — quando o evento indica limite atingido, arma a trava com o
          // horário de reset real do CLI (fallback: meia-noite).
          const noted = llmErrors.noteRateLimitEvent(evt);
          if (noted && noted.locked) broadcast({ type: 'llm.error', message: noted.friendly });
          break;
        }

        case 'result': {
          resultReceived = true;
          const costUsd = evt.total_cost_usd || 0;
          const usage = evt.usage || {};

          // Final token counts come from result.usage
          if (usage.input_tokens) inTokens = usage.input_tokens + (usage.cache_read_input_tokens || 0);
          if (usage.output_tokens) outTokens = usage.output_tokens;

          // Record usage
          try {
            usageFn(cwd, {
              kind: 'session',
              model: model || 'unknown',
              in_tokens: inTokens,
              out_tokens: outTokens,
              cost_usd: costUsd,
              via: 'cli',
            });
          } catch (e) { console.warn('[llm/session] usage record failed:', e.message); }

          broadcast({ type: 'llm.done', costUsd });
          setState('idle');
          _child = null;
          resolve({ costUsd, sessionId: newSessionId || sessionId });
          break;
        }

        default:
          // Unknown event types: log at debug level, don't crash
          break;
      }
    };

    // Buffer stdout — events may be split across chunks
    child.stdout.on('data', (d) => {
      buf += d.toString('utf8');
      const parts = buf.split('\n');
      buf = parts.pop(); // keep incomplete last line
      for (const line of parts) processLine(line);
    });

    let stderrTail = '';
    child.stderr.on('data', (d) => {
      // stderr from claude CLI: log but don't surface to user unless fatal
      const msg = d.toString('utf8');
      if (msg.trim()) console.warn('[llm/session] stderr:', msg.trimEnd());
      stderrTail = (stderrTail + msg).slice(-2000);
    });

    child.on('close', (code) => {
      // Flush any remaining buffered line
      if (buf.trim()) processLine(buf);
      buf = '';
      _child = null;

      if (!resultReceived) {
        // T6 — classifica o stderr antes de mostrar "código N": limite de uso
        // vira trava até o reset + mensagem calorosa; rate-limit vira "espera
        // um minutinho"; só o resto cai no erro genérico.
        const noted = llmErrors.noteError(stderrTail);
        const errMsg = noted.locked ? noted.friendly
          : code !== 0
            ? `Sessão encerrada com erro (código ${code})`
            : 'Sessão encerrada inesperadamente';
        broadcast({ type: 'llm.error', message: errMsg });
        setState('idle');
        reject(new Error(noted.locked ? `llm locked (${noted.kind})` : errMsg));
      }
    });

    child.on('error', (e) => {
      _child = null;
      broadcast({ type: 'llm.error', message: `Erro ao iniciar Claude: ${e.message}` });
      setState('idle');
      reject(e);
    });
  });

  // Send a user message to the session.
  const send = (text, attachments) => runTurn(text, attachments);

  // Interrupt the current turn via SIGINT.
  const interrupt = () => {
    if (_child) {
      try { _child.kill('SIGINT'); }
      catch (e) { console.warn('[llm/session] interrupt failed:', e.message); }
    }
  };

  return { send, interrupt, getState: () => _state };
};
