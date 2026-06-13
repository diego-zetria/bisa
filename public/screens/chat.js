// screens/chat.js — tela Claude: chat com sessão LLM sobre os dados da usuária.
// Touch-first (iPad 11" + desktop). UI em português do Brasil.
// Protocolo WS: docs/API.md §lib/llm.

(function () {
  // ── Injetar estilos escopados (uma vez) ───────────────────────────────────
  if (!document.getElementById('chat-styles')) {
    const style = document.createElement('style');
    style.id = 'chat-styles';
    style.textContent = `
      /* Layout principal */
      .chat-root {
        display: flex; flex-direction: column;
        height: 100%; overflow: hidden;
        /* O .screen-pad padrão adiciona padding; zeramos para controle total */
      }
      /* Forçar o container pai a não ter padding lateral para o chat ocupar a largura toda */
      .chat-root ~ * { display: none; }

      /* Cabeçalho */
      .chat-header {
        display: flex; align-items: center; gap: 10px;
        padding: 12px 16px 10px;
        background: var(--surface);
        border-bottom: 1px solid var(--line);
        flex-shrink: 0;
        min-height: 56px;
      }
      .chat-header-title {
        font-weight: 700; font-size: 1.05rem; flex: 1;
      }
      .chat-state-line {
        font-size: .75rem; color: var(--ink-soft);
        margin-top: 1px; display: block;
      }
      .chat-new-btn {
        background: none; border: none;
        color: var(--ink-soft); font-size: .82rem;
        padding: 6px 10px; min-height: 36px;
        border-radius: var(--radius-sm);
        white-space: nowrap;
      }
      .chat-new-btn:hover { background: var(--surface-2); color: var(--ink); }

      /* Lista de mensagens */
      .chat-messages {
        flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch;
        padding: 16px 12px 8px;
        display: flex; flex-direction: column; gap: 10px;
      }
      @media (min-width: 600px) {
        .chat-messages { padding: 20px 24px 10px; }
      }

      /* Chips de ação rápida (conversa vazia) */
      .chat-quick-actions {
        display: flex; flex-wrap: wrap; gap: 8px;
        justify-content: center;
        padding: 20px 12px 4px;
      }
      .chat-quick-chip {
        background: var(--surface); border: 1px solid var(--line);
        border-radius: 999px; padding: 9px 16px;
        font-size: .88rem; color: var(--ink);
        cursor: pointer; min-height: var(--tap);
        transition: background .15s;
        display: flex; align-items: center;
      }
      .chat-quick-chip:hover, .chat-quick-chip:active {
        background: var(--accent-soft); border-color: var(--primary);
      }

      /* Bolhas */
      .chat-bubble-wrap {
        display: flex; flex-direction: column;
        max-width: min(82%, 640px);
      }
      .chat-bubble-wrap.user {
        align-self: flex-end; align-items: flex-end;
      }
      .chat-bubble-wrap.assistant {
        align-self: flex-start; align-items: flex-start;
      }
      .chat-bubble {
        border-radius: 18px; padding: 10px 14px;
        line-height: 1.55; font-size: .97rem;
        word-break: break-word;
      }
      .chat-bubble-wrap.user .chat-bubble {
        background: var(--primary); color: var(--primary-ink);
        border-bottom-right-radius: 4px;
      }
      .chat-bubble-wrap.assistant .chat-bubble {
        background: var(--surface); border: 1px solid var(--line);
        color: var(--ink); border-bottom-left-radius: 4px;
      }
      /* Markdown dentro de bolhas */
      .chat-bubble p { margin: 0 0 .5em; }
      .chat-bubble p:last-child { margin-bottom: 0; }
      .chat-bubble ul, .chat-bubble ol { margin: .3em 0 .3em 1.4em; padding: 0; }
      .chat-bubble li { margin-bottom: .15em; }
      .chat-bubble code {
        background: var(--surface-2); border-radius: 4px;
        padding: 1px 5px; font-size: .88em;
      }
      .chat-bubble pre {
        background: var(--surface-2); border-radius: 8px;
        padding: 10px 12px; overflow-x: auto; font-size: .84em;
      }
      .chat-bubble pre code { background: none; padding: 0; }
      .chat-bubble h1, .chat-bubble h2, .chat-bubble h3 {
        margin: .6em 0 .2em; font-size: 1rem;
      }
      .chat-bubble a { color: var(--primary); }
      /* dark mode bolha usuária: manter contraste */
      @media (prefers-color-scheme: dark) {
        .chat-bubble-wrap.user .chat-bubble { color: #fff; }
      }

      /* Chips de tool dentro de bolha assistente */
      .chat-tool-chip {
        display: inline-flex; align-items: center; gap: 5px;
        background: var(--surface-2); border: 1px solid var(--line);
        border-radius: 999px; padding: 3px 10px;
        font-size: .78rem; color: var(--ink-soft);
        margin-top: 6px;
      }
      .chat-tool-chip.done { color: var(--positive); }
      .chat-tool-chip.running { color: var(--ink-soft); }

      /* Card de permissão */
      .chat-permission-card {
        background: var(--surface); border: 1px solid var(--line);
        border-radius: var(--radius); padding: 14px;
        max-width: min(82%, 480px); align-self: flex-start;
        box-shadow: var(--shadow);
      }
      .chat-permission-card p {
        margin: 0 0 12px; font-size: .93rem; line-height: 1.45;
      }
      .chat-permission-card .row { gap: 8px; }
      .chat-permission-card .btn {
        font-size: .88rem; padding: 0 14px; min-height: 38px;
      }
      .chat-permission-card .btn.ghost { font-size: .88rem; }

      /* Linha de erro */
      .chat-error-line {
        align-self: center;
        background: #fde8e8; color: var(--negative);
        border-radius: var(--radius-sm); padding: 6px 14px;
        font-size: .88rem;
      }
      @media (prefers-color-scheme: dark) {
        .chat-error-line { background: #3a1a1a; }
      }

      /* Chips de anexo acima do compositor */
      .chat-attachments-row {
        display: flex; flex-wrap: wrap; gap: 6px;
        padding: 6px 12px 0;
      }
      @media (min-width: 600px) {
        .chat-attachments-row { padding: 6px 20px 0; }
      }
      .chat-attach-chip {
        display: inline-flex; align-items: center; gap: 5px;
        background: var(--accent-soft); border-radius: 999px;
        padding: 4px 10px; font-size: .78rem; color: var(--ink-soft);
      }
      .chat-attach-chip button {
        background: none; border: none; color: var(--ink-soft);
        padding: 0; font-size: .85rem; line-height: 1; cursor: pointer;
        min-height: auto;
      }

      /* Compositor */
      .chat-composer {
        flex-shrink: 0;
        background: var(--surface);
        border-top: 1px solid var(--line);
        padding: 10px 12px calc(10px + env(safe-area-inset-bottom));
      }
      @media (min-width: 600px) {
        .chat-composer { padding: 12px 20px calc(12px + env(safe-area-inset-bottom)); }
      }
      .chat-composer-row {
        display: flex; align-items: flex-end; gap: 8px;
      }
      .chat-textarea {
        flex: 1; resize: none; min-height: var(--tap);
        max-height: 180px; overflow-y: auto;
        border-radius: 20px; padding: 10px 14px;
        font-size: .97rem; line-height: 1.45;
        border: 1px solid var(--line);
        background: var(--surface-2);
        width: auto; /* override style.css 100% */
        transition: border-color .15s;
      }
      .chat-textarea:focus { outline: none; border-color: var(--primary); }
      .chat-icon-btn {
        background: none; border: none;
        color: var(--ink-soft); font-size: 1.25rem;
        min-width: var(--tap); min-height: var(--tap);
        border-radius: 50%; display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background .15s;
      }
      .chat-icon-btn:hover { background: var(--surface-2); color: var(--ink); }
      .chat-icon-btn.active { color: var(--negative); }
      .chat-send-btn {
        background: var(--primary); color: var(--primary-ink);
        border: none; border-radius: 50%;
        min-width: var(--tap); min-height: var(--tap);
        font-size: 1.1rem;
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: opacity .15s;
      }
      .chat-send-btn:disabled { opacity: .45; cursor: not-allowed; }
      .chat-interrupt-btn {
        background: none; border: 1px solid var(--negative);
        color: var(--negative); border-radius: 999px;
        padding: 0 14px; min-height: 36px;
        font-size: .82rem; font-weight: 600;
        flex-shrink: 0;
      }
      .chat-interrupt-btn:hover { background: #fde8e8; }

      /* Spinner pulsante no fim da bolha streaming */
      .chat-cursor {
        display: inline-block; width: 2px; height: 1em;
        background: var(--primary); border-radius: 1px;
        margin-left: 2px; vertical-align: text-bottom;
        animation: chat-blink .75s step-end infinite;
      }
      @keyframes chat-blink { 50% { opacity: 0; } }
    `;
    document.head.appendChild(style);
  }

  // ── Estado local ──────────────────────────────────────────────────────────
  let messages = [];        // { id, role, html, text, tools:[], permCard }
  let currentAssistantId = null;
  let sessionState = 'idle'; // idle | starting | running | waiting_user
  let attachments = [];     // { name, rel }
  let unsub = null;
  let micActive = false;
  let recognition = null;

  // Elementos — preenchidos em mount()
  let elList, elComposer, elTextarea, elSendBtn, elInterruptBtn,
      elStateLine, elAttachRow, elQuickActions, elRoot;

  // ── Helpers ───────────────────────────────────────────────────────────────
  function uid() { return '_' + Math.random().toString(36).slice(2, 9); }

  function scrollBottom(smooth) {
    if (!elList) return;
    elList.scrollTo({ top: elList.scrollHeight, behavior: smooth ? 'smooth' : 'instant' });
  }

  function stateLabel(s) {
    return { idle: 'esperando você', starting: 'iniciando…', running: 'pensando…', waiting_user: 'aguardando resposta' }[s] || s;
  }

  function setStateUi(s) {
    sessionState = s;
    if (elStateLine) elStateLine.textContent = stateLabel(s);
    const running = s === 'running' || s === 'starting';
    if (elSendBtn) elSendBtn.disabled = running;
    if (elInterruptBtn) elInterruptBtn.style.display = running ? '' : 'none';
    // Esconder a área de anexos + textarea enquanto roda não é necessário — só desabilita send
  }

  // ── Renderização de mensagens ─────────────────────────────────────────────

  function renderToolChips(tools) {
    if (!tools || !tools.length) return '';
    return tools.map(t => {
      const cls = t.status === 'done' ? 'done' : 'running';
      const icon = t.status === 'done' ? '✓' : '🔧';
      return `<div class="chat-tool-chip ${cls}" data-tool-id="${t.id}">${icon} ${escHtml(t.summaryPt)}</div>`;
    }).join('');
  }

  function escHtml(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function buildBubbleEl(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'chat-bubble-wrap ' + msg.role;
    wrap.dataset.msgId = msg.id;

    if (msg.role === 'permission') {
      wrap.className = 'chat-bubble-wrap assistant';
      wrap.innerHTML = buildPermissionCard(msg);
      return wrap;
    }
    if (msg.role === 'error') {
      wrap.className = 'chat-bubble-wrap assistant';
      const div = document.createElement('div');
      div.className = 'chat-error-line';
      div.textContent = msg.text;
      wrap.appendChild(div);
      return wrap;
    }

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    if (msg.role === 'user') {
      bubble.textContent = msg.text;
    } else {
      bubble.innerHTML = msg.html || '';
    }
    wrap.appendChild(bubble);

    if (msg.role === 'assistant' && msg.tools && msg.tools.length) {
      const toolsDiv = document.createElement('div');
      toolsDiv.className = 'chat-tools';
      toolsDiv.innerHTML = renderToolChips(msg.tools);
      wrap.appendChild(toolsDiv);
    }

    return wrap;
  }

  function buildPermissionCard(msg) {
    return `<div class="chat-permission-card">
      <p>🔐 O Claude quer: <strong>${escHtml(msg.summaryPt)}</strong><br>
      <span class="muted" style="font-size:.82rem">Ferramenta: ${escHtml(msg.tool)}</span></p>
      <div class="row">
        <button class="btn" onclick="window._bisaChatPermit('${msg.requestId}', true)">Permitir</button>
        <button class="btn ghost" onclick="window._bisaChatPermit('${msg.requestId}', false)">Agora não</button>
      </div>
    </div>`;
  }

  // Adiciona ao array e ao DOM
  function addMessage(msg) {
    messages.push(msg);
    if (!elList) return;
    // Remover ações rápidas se houver mensagens
    if (elQuickActions) elQuickActions.style.display = 'none';
    const el = buildBubbleEl(msg);
    elList.appendChild(el);
    scrollBottom(true);
    return el;
  }

  // Obtém (ou cria) o elemento da bolha atual do assistente
  function getOrCreateAssistantBubble() {
    if (!currentAssistantId) {
      const id = uid();
      const msg = { id, role: 'assistant', html: '', text: '', tools: [] };
      currentAssistantId = id;
      addMessage(msg);
    }
    return document.querySelector(`[data-msg-id="${currentAssistantId}"] .chat-bubble`);
  }

  function getAssistantMsg() {
    return messages.find(m => m.id === currentAssistantId);
  }

  // Streaming: appenda delta e re-renderiza markdown na bolha viva
  function appendAssistantDelta(delta) {
    const msg = getAssistantMsg();
    if (!msg) return;
    msg.text = (msg.text || '') + delta;
    msg.html = BISA.renderMarkdown(msg.text);

    const bubbleEl = document.querySelector(`[data-msg-id="${msg.id}"] .chat-bubble`);
    if (bubbleEl) {
      // Cursor piscante durante streaming
      bubbleEl.innerHTML = msg.html + '<span class="chat-cursor"></span>';
    }
    scrollBottom(false);
  }

  function finalizeAssistantBubble() {
    const msg = getAssistantMsg();
    if (!msg) return;
    const bubbleEl = document.querySelector(`[data-msg-id="${msg.id}"] .chat-bubble`);
    if (bubbleEl) {
      bubbleEl.innerHTML = msg.html || '';
    }
    currentAssistantId = null;
  }

  // Atualiza chip de tool na bolha atual do assistente
  function upsertToolChip(toolEvent) {
    // Garante bolha existente
    getOrCreateAssistantBubble();
    const msg = getAssistantMsg();
    if (!msg) return;

    const existingIdx = msg.tools.findIndex(t => t.name === toolEvent.name && t.status === 'start');
    if (existingIdx >= 0) {
      msg.tools[existingIdx] = { ...msg.tools[existingIdx], ...toolEvent };
    } else {
      msg.tools.push({ id: uid(), ...toolEvent });
    }

    // Atualiza DOM — o div .chat-tools já existe ou precisa ser criado
    const wrap = document.querySelector(`[data-msg-id="${msg.id}"]`);
    if (!wrap) return;
    let toolsDiv = wrap.querySelector('.chat-tools');
    if (!toolsDiv) {
      toolsDiv = document.createElement('div');
      toolsDiv.className = 'chat-tools';
      wrap.appendChild(toolsDiv);
    }
    toolsDiv.innerHTML = renderToolChips(msg.tools);
  }

  // ── Eventos WS ────────────────────────────────────────────────────────────
  function handleWs(ev) {
    switch (ev.type) {
      case 'llm.state':
        setStateUi(ev.state);
        break;

      case 'llm.text':
        if (ev.delta) appendAssistantDelta(ev.delta);
        break;

      case 'llm.tool':
        upsertToolChip(ev);
        break;

      case 'llm.permission_request': {
        // Cria uma mensagem especial do tipo permissão
        const msg = {
          id: uid(), role: 'permission',
          requestId: ev.requestId, tool: ev.tool,
          summaryPt: ev.summaryPt, input: ev.input,
        };
        addMessage(msg);
        break;
      }

      case 'llm.done':
        finalizeAssistantBubble();
        setStateUi('idle');
        break;

      case 'llm.error':
        // Finaliza bolha se existir
        finalizeAssistantBubble();
        addMessage({ id: uid(), role: 'error', text: ev.message || 'Erro desconhecido.' });
        setStateUi('idle');
        break;
    }
  }

  // ── Permissão ─────────────────────────────────────────────────────────────
  window._bisaChatPermit = async function (requestId, allow) {
    // WS primeiro, REST como fallback
    BISA.wsSend({ type: 'llm.permission', requestId, allow });
    try { await BISA.api('/llm/permission', { method: 'POST', json: { requestId, allow } }); } catch {}
    // Remover o card da UI
    const card = document.querySelector(`.chat-permission-card`);
    if (card) {
      const wrap = card.closest('[data-msg-id]');
      if (wrap) wrap.remove();
    }
    messages = messages.filter(m => m.requestId !== requestId);
  };

  // ── Enviar mensagem ───────────────────────────────────────────────────────
  function sendMessage(text) {
    text = text.trim();
    if (!text && !attachments.length) return;

    // Bolha do usuário (otimista)
    addMessage({ id: uid(), role: 'user', text });

    // Limpar textarea
    if (elTextarea) { elTextarea.value = ''; elTextarea.style.height = ''; }

    // Criar nova bolha assistente (streaming começa no próximo llm.text)
    currentAssistantId = null;

    const payload = { type: 'llm.send', text };
    if (attachments.length) payload.attachments = attachments.map(a => a.rel);
    BISA.wsSend(payload);

    // Limpar anexos
    attachments = [];
    renderAttachmentChips();

    setStateUi('running');
  }

  // ── Anexos ────────────────────────────────────────────────────────────────
  function renderAttachmentChips() {
    if (!elAttachRow) return;
    elAttachRow.innerHTML = attachments.map((a, i) =>
      `<div class="chat-attach-chip">📎 ${escHtml(a.name)}<button onclick="window._bisaChatRemoveAttach(${i})" title="Remover">×</button></div>`
    ).join('');
    elAttachRow.style.display = attachments.length ? 'flex' : 'none';
  }

  window._bisaChatRemoveAttach = function (idx) {
    attachments.splice(idx, 1);
    renderAttachmentChips();
  };

  async function pickAndUploadFile() {
    const input = document.createElement('input');
    input.type = 'file'; input.multiple = true;
    input.onchange = async () => {
      for (const file of input.files) {
        try {
          const buf = await file.arrayBuffer();
          const res = await BISA.apiRaw(`/pkm/inbox?name=${encodeURIComponent(file.name)}`, buf, file.type || 'application/octet-stream');
          // /pkm/inbox retorna { rel } ou só texto
          const rel = (typeof res === 'object' && res.rel) ? res.rel : String(res).trim();
          attachments.push({ name: file.name, rel });
          renderAttachmentChips();
        } catch (e) {
          BISA.toast(`Erro ao enviar ${file.name}: ${e.message}`);
        }
      }
    };
    input.click();
  }

  // ── Voz ───────────────────────────────────────────────────────────────────
  function setupVoice(micBtn) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { micBtn.style.display = 'none'; return; }

    recognition = new SR();
    recognition.lang = 'pt-BR';
    recognition.continuous = false;
    recognition.interimResults = false;

    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript;
      if (elTextarea) {
        elTextarea.value = (elTextarea.value ? elTextarea.value + ' ' : '') + transcript;
        elTextarea.dispatchEvent(new Event('input'));
      }
    };
    recognition.onend = () => {
      micActive = false;
      micBtn.classList.remove('active');
      micBtn.title = 'Falar';
    };
    recognition.onerror = () => {
      micActive = false;
      micBtn.classList.remove('active');
    };

    micBtn.addEventListener('click', () => {
      if (micActive) {
        recognition.stop();
      } else {
        recognition.start();
        micActive = true;
        micBtn.classList.add('active');
        micBtn.title = 'Ouvindo… (clique para parar)';
      }
    });
  }

  // ── mount / unmount ───────────────────────────────────────────────────────
  window.BISA.screens['chat'] = {
    mount(el) {
      // Zeramos o padding do .screen-pad para o chat ter controle total
      el.style.cssText = 'padding:0; height:100%; display:flex; flex-direction:column; overflow:hidden; max-width:none; margin:0;';

      // Estrutura principal
      el.innerHTML = `
        <div class="chat-root" style="display:flex;flex-direction:column;height:100%;overflow:hidden;">
          <!-- Cabeçalho -->
          <div class="chat-header">
            <div style="flex:1">
              <div class="chat-header-title">Claude</div>
              <span class="chat-state-line muted">carregando…</span>
            </div>
            <button class="chat-new-btn" title="Novo assunto">✦ Novo assunto</button>
          </div>

          <!-- Lista de mensagens -->
          <div class="chat-messages">
            <!-- Chips de ação rápida (visíveis quando vazio) -->
            <div class="chat-quick-actions">
              <button class="chat-quick-chip" data-prompt="Organizar meu Inbox">📥 Organizar meu Inbox</button>
              <button class="chat-quick-chip" data-prompt="Resumir um documento que eu enviar">📄 Resumir um documento</button>
              <button class="chat-quick-chip" data-prompt="Como foi meu mês?">📅 Como foi meu mês?</button>
              <button class="chat-quick-chip" data-prompt="Anotar no meu diário">📓 Anotar no meu diário</button>
            </div>
          </div>

          <!-- Chips de anexos -->
          <div class="chat-attachments-row" style="display:none"></div>

          <!-- Compositor -->
          <div class="chat-composer">
            <div class="chat-composer-row">
              <button class="chat-icon-btn" id="chat-attach-btn" title="Anexar arquivo">📎</button>
              <textarea class="chat-textarea" rows="1" placeholder="Escreva para o Claude…"></textarea>
              <button class="chat-icon-btn" id="chat-mic-btn" title="Falar">🎤</button>
              <button class="chat-send-btn" title="Enviar">↑</button>
              <button class="chat-interrupt-btn" style="display:none">■ Interromper</button>
            </div>
          </div>
        </div>
      `;

      // Referências
      elRoot       = el.querySelector('.chat-root');
      elList       = el.querySelector('.chat-messages');
      elComposer   = el.querySelector('.chat-composer');
      elTextarea   = el.querySelector('.chat-textarea');
      elSendBtn    = el.querySelector('.chat-send-btn');
      elInterruptBtn = el.querySelector('.chat-interrupt-btn');
      elStateLine  = el.querySelector('.chat-state-line');
      elAttachRow  = el.querySelector('.chat-attachments-row');
      elQuickActions = el.querySelector('.chat-quick-actions');

      // Textarea auto-crescente
      elTextarea.addEventListener('input', () => {
        elTextarea.style.height = 'auto';
        elTextarea.style.height = Math.min(elTextarea.scrollHeight, 180) + 'px';
      });

      // Enter envia (Shift+Enter = nova linha)
      elTextarea.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          sendMessage(elTextarea.value);
        }
      });

      // Botão enviar
      elSendBtn.addEventListener('click', () => sendMessage(elTextarea.value));

      // Botão interromper
      elInterruptBtn.addEventListener('click', () => {
        BISA.wsSend({ type: 'llm.interrupt' });
      });

      // Botão novo assunto
      el.querySelector('.chat-new-btn').addEventListener('click', () => {
        messages = [];
        currentAssistantId = null;
        // Limpar lista mas manter ações rápidas
        elList.innerHTML = '';
        const qa = document.createElement('div');
        qa.className = 'chat-quick-actions';
        qa.innerHTML = `
          <button class="chat-quick-chip" data-prompt="Organizar meu Inbox">📥 Organizar meu Inbox</button>
          <button class="chat-quick-chip" data-prompt="Resumir um documento que eu enviar">📄 Resumir um documento</button>
          <button class="chat-quick-chip" data-prompt="Como foi meu mês?">📅 Como foi meu mês?</button>
          <button class="chat-quick-chip" data-prompt="Anotar no meu diário">📓 Anotar no meu diário</button>
        `;
        elList.appendChild(qa);
        elQuickActions = qa;
        bindQuickActions(qa);
        BISA.toast('Conversa limpa (sessão continua em segundo plano).');
      });

      // Chips de ação rápida
      bindQuickActions(elQuickActions);

      // Anexo
      el.querySelector('#chat-attach-btn').addEventListener('click', pickAndUploadFile);

      // Voz
      setupVoice(el.querySelector('#chat-mic-btn'));

      // Assinar WS
      unsub = BISA.onWs(handleWs);

      // Buscar estado inicial
      BISA.api('/llm/status').then(status => {
        setStateUi(status.session || 'idle');
      }).catch(() => {
        setStateUi('idle');
      });
    },

    unmount() {
      if (unsub) { unsub(); unsub = null; }
      if (recognition && micActive) { recognition.stop(); }
      // Limpar global poluído
      delete window._bisaChatPermit;
      delete window._bisaChatRemoveAttach;
      // Reset estado (a tela pode ser remontada)
      messages = [];
      currentAssistantId = null;
      attachments = [];
      micActive = false;
      elList = elComposer = elTextarea = elSendBtn = elInterruptBtn =
        elStateLine = elAttachRow = elQuickActions = elRoot = null;
    },
  };

  function bindQuickActions(container) {
    if (!container) return;
    container.querySelectorAll('.chat-quick-chip').forEach(btn => {
      btn.addEventListener('click', () => {
        const prompt = btn.dataset.prompt;
        if (elTextarea) elTextarea.value = prompt;
        sendMessage(prompt);
      });
    });
  }
})();
