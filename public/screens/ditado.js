// ditado.js — motor de ditado da aba Biso (window.BISO_DITADO).
// Dois motores atrás do mesmo botão-toggle:
//   1. Whisper local (WhisperLiveKit no Mac, proxy /stt do bisa): mic →
//      AudioWorklet → PCM s16le 16kHz → WebSocket /stt/asr; volta JSON com
//      segmentos consolidados (lines) + cauda parcial (buffer_transcription).
//      Pontuação automática, números formatados, offline na tailnet.
//   2. Web Speech (Siri) de reserva quando o /stt não responde: contínuo com
//      auto-restart (o iOS encerra a cada pausa; instância NOVA a cada ciclo —
//      reusar lança InvalidStateError no Safari).
// Extras: Wake Lock enquanto dita; teardown no visibilitychange (mata o "mic
// zumbi" pós-lock do iOS); halo do botão no nível real do microfone; comandos
// falados de layout ("nova linha", "novo parágrafo"); anti-picote (funde
// segmentos curtos que o Whisper fecha a cada pausa) e filtro de lixo de
// silêncio (letras soltas/pontuação órfã).
// Uma sessão ativa por vez. Exige HTTPS (mic) — avisa em vez de falhar mudo.
(() => {
  const WS_READY_TIMEOUT = 2500;   // sem 'config' do servidor até aqui → Siri
  const STOP_GRACE = 2500;         // espera do ready_to_stop p/ consolidação final
  const SILENCE_STOP = 12000;      // silêncio contínuo até aqui → para sozinho
                                   // (mic aberto parado só acumula alucinação)
  const PAUSE_HINT = 3000;         // pausa de fala até aqui → onPause (prévia limpa)

  // cauda parcial "ainda ouvindo" (ver render)
  if (!document.getElementById('ditado-style')) {
    const st = document.createElement('style');
    st.id = 'ditado-style';
    st.textContent = '.dit-tail{opacity:.55;font-style:italic}';
    document.head.appendChild(st);
  }

  // Idioma do ditado (toggle 🌐 no modo Escrever): dois motores no Mac, um por
  // idioma — detecção automática em streaming é instável (testado: sopa pt/en).
  const LANG_KEY = 'biso.ditado.lang';
  const dLang = () => (localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'pt');

  let ses = null;                  // sessão ativa: {btn, getBox, engine, ...}

  // "nova linha" / "novo parágrafo" ditados viram quebras de verdade (só no
  // trecho ditado, nunca no texto que já estava na caixa).
  const LAYOUT = [
    [/\s*\b(novo parágrafo|new paragraph)\b[\s,.:;]*/gi, '\n\n'],
    [/\s*\b(nova linha|quebra de linha|new line)\b[\s,.:;]*/gi, '\n'],
  ];
  const applyLayout = (t) => LAYOUT.reduce((s, [re, sub]) => s.replace(re, sub), t);

  // Alucinação de silêncio do Whisper: taglines clássicas de legenda pt e
  // loops de repetição ("Como? Como? Como? …", "E... E... E..."). Colapsa 4+
  // repetições seguidas da mesma unidade curta em UMA (ênfase tripla real
  // sobrevive); some com as taglines conhecidas.
  const HALLUC = [
    /legendas pela comunidade amara\.org[.\s]*/gi,
    /\bamara\.org\b[.\s]*/gi,
  ];
  const stripHalluc = (t) => HALLUC.reduce((s, re) => s.replace(re, ''), t);
  const dedupRepeats = (t) =>
    t.replace(/(\S{1,24}(?:\s\S{1,24})?[.!?…]*\s+)(?:\1){2,}/g, '$1');

  // Lixo de silêncio (vídeos de 2026-07-13): pausa/ruído vira letra solta com
  // ponto ("H. R. R.") ou pontuação órfã (".") — some com ambos.
  const stripGarbage = (t) => t
    .replace(/(^|\s)\p{L}\.(?=\s|$)/gu, '$1')
    .replace(/(^|\s)[.,!?…:;]+(?=\s|$)/g, '$1')
    .replace(/[ \t]{2,}/g, ' ');

  // Picote por pausa (vídeos de 2026-07-13): falando devagar, cada pausa fecha
  // um segmento capitalizado com ponto ("Let's help me. To create. A new.
  // Note."). Funde de volta no fluxo: segmento de ≤3 palavras terminado em "."
  // perde o ponto e o seguinte perde a maiúscula ("I" fica). Não cruza linhas
  // (rodar DEPOIS do applyLayout) e respeita ! ? … — fim de frase de verdade.
  const decap = (s) => (/^I(?=[\s'.!?…]|$)/.test(s) ? s : s.charAt(0).toLowerCase() + s.slice(1));
  const mergeFragments = (t) => t.split('\n').map((line) => {
    const parts = line.split(/(?<=[.!?…])\s+/).filter(Boolean);
    let out = '';
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const body = p.replace(/\.+$/, '');
      const short = /\.$/.test(p) && body.trim().split(/\s+/).length <= 3;
      if (short && i < parts.length - 1) {
        out += (out ? ' ' : '') + body;
        parts[i + 1] = decap(parts[i + 1]);
      } else out += (out ? ' ' : '') + p;
    }
    return out;
  }).join('\n');

  // Comandos de voz de apagar — sem tocar na tela, pt e en (o usuário alterna
  // os idiomas ao ditar; no vídeo de teste saiu "Erase it. Remove it."):
  //   "apaga tudo" · "erase/delete everything|all"      → zera o ditado da sessão
  //   "apaga isso" / "apaga a última frase" ·
  //   "erase/delete/remove it|that|this" · "scratch that" → derruba a última frase
  // Transformação pura do transcript completo: o comando é consumido do texto
  // e o corte aplicado ao que veio antes — re-renders do streaming ficam
  // consistentes e o que vier depois continua entrando normalmente.
  const CMD = /\b(?:(?:apagar?|apague)\s+(tudo|isso|essa frase|a última frase|última frase)|(?:erase|delete|remove)\s+(everything|all|it|that|this)|scratch that)\b[\s.,!?…]*/i;
  const dropLastSentence = (t) => {
    const s = t.trimEnd();
    const end = s.length - 2;   // ignora o terminador da própria frase
    const cut = Math.max(s.lastIndexOf('.', end), s.lastIndexOf('!', end),
      s.lastIndexOf('?', end), s.lastIndexOf('\n', end));
    return cut === -1 ? '' : s.slice(0, cut + 1) + ' ';
  };
  const applyCommands = (t) => {
    let m;
    while ((m = t.match(CMD))) {
      const before = t.slice(0, m.index), after = t.slice(m.index + m[0].length);
      const alvo = (m[1] || m[2] || '').toLowerCase();
      const isAll = alvo === 'tudo' || alvo === 'everything' || alvo === 'all';
      t = (isAll ? '' : dropLastSentence(before)) + after;
    }
    return t;
  };

  const transform = (t) =>
    mergeFragments(applyLayout(applyCommands(dedupRepeats(stripGarbage(stripHalluc(t)))))).trim();

  // Idioma trocado (vídeo 2026-07-14: whisper·EN com fala pt mutilou "entranha"
  // por ~1min40): com ≥6 palavras, marcadores do OUTRO idioma dominando → avisa
  // o dono UMA vez por sessão (onLangHint) — a troca segue decisão do usuário.
  const PT_MARK = /[ãõçáéíóúâêô]|\b(não|você|vocês|para|uma|isso|então|fazer|nome|que|com|mas|também)\b/gi;
  const EN_MARK = /\b(the|and|would|like|don't|know|name|for|that|this|with|how|what|about)\b/gi;
  const langLooksLike = (t) => {
    if (t.trim().split(/\s+/).length < 6) return null;
    const pt = (t.match(PT_MARK) || []).length, en = (t.match(EN_MARK) || []).length;
    if (pt >= 3 && pt > en * 2) return 'pt';
    if (en >= 3 && en > pt * 2) return 'en';
    return null;
  };

  const boxOf = () => (ses && ses.getBox()) || null;
  // Consolidado em texto normal; a cauda parcial (buffer_transcription) em
  // itálico apagado — a revisão constante do Whisper lê como "ainda ouvindo",
  // não como glitch. Best-effort: se o transform fundir a fronteira (ponto
  // removido na emenda), cai para texto plano sem destaque.
  const esc = (t) => t.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const render = (lines, buffer) => {
    const box = boxOf(); if (!box || !ses) return;
    const full = transform(lines + ' ' + (buffer || ''));
    const head = ses.base + (ses.base && full ? ' ' : '');
    // silêncio re-manda o mesmo transcript — reescrever igual dispararia
    // 'input' à toa e mataria a prévia limpa do dock (onPause)
    if (head + full === ses.lastRender) return;
    ses.lastRender = head + full;
    const solid = transform(lines);
    if (buffer && solid && full.startsWith(solid) && full.length > solid.length) {
      box.innerHTML = esc(head + solid) + '<em class="dit-tail">' + esc(full.slice(solid.length)) + '</em>';
    } else {
      box.innerText = head + full;
    }
    box.dispatchEvent(new Event('input', { bubbles: true }));
  };

  const setHalo = (level) => {
    if (!ses) return;
    ses.btn.style.boxShadow = level == null ? ''
      : `0 0 ${Math.round(6 + level * 26)}px rgba(224,83,61,${(0.35 + level * 0.5).toFixed(2)})`;
  };

  async function grabWakeLock() {
    try { if (navigator.wakeLock && ses) ses.lock = await navigator.wakeLock.request('screen'); } catch {}
  }

  // ── teardown ──────────────────────────────────────────────────────────────
  // onStop (se o dono do botão passou) dispara DEPOIS da consolidação final do
  // Whisper — é quando o texto está pronto p/ limpeza automática/realce.
  function stopAll() {
    const s = ses; if (!s) return;
    ses = null;
    const notify = () => { try { s.onStop && s.onStop(); } catch {} };
    s.btn.classList.remove('active'); s.btn.style.boxShadow = '';
    if (s.lock) { try { s.lock.release(); } catch {} }
    if (s.rec) { try { s.rec.stop(); } catch {} }             // Web Speech
    if (s.stream) s.stream.getTracks().forEach((t) => t.stop());
    if (s.node) { try { s.node.disconnect(); } catch {} }
    if (s.ctx) { try { s.ctx.close(); } catch {} }
    if (s.ws) {
      const ws = s.ws;
      if (ws.readyState === WebSocket.OPEN && s.ready) {
        // frame vazio = fim do áudio; o servidor consolida e responde
        // ready_to_stop — a janela de graça ainda aplica refinamentos finais.
        const box = s.getBox(), base = s.base;
        try { ws.send(new ArrayBuffer(0)); } catch {}
        const kill = setTimeout(() => { try { ws.close(); } catch {} notify(); }, STOP_GRACE);
        ws.onmessage = (ev) => {
          let d; try { d = JSON.parse(ev.data); } catch { return; }
          if (d.type === 'ready_to_stop') { clearTimeout(kill); try { ws.close(); } catch {} notify(); return; }
          if (!d.lines || !box) return;
          const txt = d.lines.map((l) => l.text).join(' ') + ' ' + (d.buffer_transcription || '');
          const t = transform(txt);
          box.innerText = base + (base && t ? ' ' : '') + t;
          box.dispatchEvent(new Event('input', { bubbles: true }));
        };
      } else { try { ws.close(); } catch {} notify(); }
    } else notify();
  }

  // ── motor 1: Whisper local via /stt ──────────────────────────────────────
  async function startWhisper() {
    const s = ses;
    s.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    if (ses !== s) { s.stream.getTracks().forEach((t) => t.stop()); return; }

    const proto = location.protocol === 'https:' ? 'wss://' : 'ws://';
    const ws = new WebSocket(proto + location.host + '/stt/asr?lang=' + dLang());   // cookie de auth vai junto
    ws.binaryType = 'arraybuffer';
    s.ws = ws;

    await new Promise((resolve, reject) => {
      const to = setTimeout(() => reject(new Error('stt timeout')), WS_READY_TIMEOUT);
      ws.onerror = () => { clearTimeout(to); reject(new Error('stt error')); };
      ws.onclose = () => { clearTimeout(to); reject(new Error('stt closed')); };
      ws.onmessage = (ev) => {
        let d; try { d = JSON.parse(ev.data); } catch { return; }
        if (d.type === 'config') { clearTimeout(to); resolve(); }
      };
      if (ses !== s) { clearTimeout(to); reject(new Error('cancelled')); }
    });
    if (ses !== s) return;
    s.ready = true;

    ws.onerror = null;
    ws.onclose = () => { if (ses === s) { BISA.toast('Ditado local caiu.'); stopAll(); } };
    ws.onmessage = (ev) => {
      if (ses !== s) return;
      let d; try { d = JSON.parse(ev.data); } catch { return; }
      if (!d.lines) return;
      const lines = d.lines.map((l) => l.text).join(' ');
      // transcript mudou = tem voz chegando (segundo sinal além do RMS)
      const key = lines + '|' + (d.buffer_transcription || '');
      if (key !== s.lastText) { s.lastText = key; s.lastVoice = performance.now(); s.paused = false; }
      render(lines, d.buffer_transcription || '');
      if (!s.langHinted && s.onLangHint) {
        const looks = langLooksLike(transform(lines));
        if (looks && looks !== dLang()) { s.langHinted = true; try { s.onLangHint(looks); } catch {} }
      }
    };

    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    s.ctx = ctx;
    await ctx.resume();
    await ctx.audioWorklet.addModule('/screens/ditado-worklet.js');
    if (ses !== s) return;
    const src = ctx.createMediaStreamSource(s.stream);
    const node = new AudioWorkletNode(ctx, 'ditado-pcm', { numberOfInputs: 1, numberOfOutputs: 0, channelCount: 1 });
    s.node = node;
    src.connect(node);

    let lastHalo = 0;
    node.port.onmessage = (e) => {
      if (ses !== s || ws.readyState !== WebSocket.OPEN) return;
      ws.send(toPCM16(new Float32Array(e.data.buf), ctx.sampleRate));
      const now = performance.now();
      // silêncio longo → para sozinho (vídeos de 2026-07-13: mic aberto ~2min
      // parado só rendia alucinação). Voz = RMS acima do piso OU transcript
      // mudando (ver ws.onmessage) — dois sinais p/ não cortar fala baixa.
      if (e.data.rms > 0.012) { s.lastVoice = now; s.paused = false; }
      else if (now - s.lastVoice > SILENCE_STOP) {
        BISA.toast('Ditado pausado — silêncio. Toque em 🎤 para continuar.');
        stopAll();
        return;
      } else if (now - s.lastVoice > PAUSE_HINT && !s.paused) {
        // pausa de fala (não fim): dono pode antecipar a limpeza (prévia no dock)
        s.paused = true;
        if (s.onPause) { try { s.onPause(); } catch {} }
      }
      if (now - lastHalo > 90) { lastHalo = now; setHalo(Math.min(1, e.data.rms * 6)); }
    };
  }

  // Float32 @ ctxRate → Int16 s16le @ 16kHz (média por janela, como o
  // recorder_worker de referência do WhisperLiveKit).
  function toPCM16(buf, fromRate) {
    let f = buf;
    if (fromRate !== 16000) {
      const ratio = fromRate / 16000;
      const out = new Float32Array(Math.round(buf.length / ratio));
      let o = 0, i0 = 0;
      while (o < out.length) {
        const i1 = Math.round((o + 1) * ratio);
        let acc = 0, n = 0;
        for (let i = i0; i < i1 && i < buf.length; i++) { acc += buf[i]; n++; }
        out[o++] = n ? acc / n : 0; i0 = i1;
      }
      f = out;
    }
    const pcm = new ArrayBuffer(f.length * 2);
    const view = new DataView(pcm);
    for (let i = 0; i < f.length; i++) {
      const v = Math.max(-1, Math.min(1, f[i]));
      view.setInt16(i * 2, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    }
    return pcm;
  }

  // ── motor 2 (reserva): Web Speech / Siri ─────────────────────────────────
  function startWebSpeech() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { BISA.toast('Ditado indisponível neste navegador.'); stopAll(); return; }
    const s = ses;
    s.engine = 'siri';
    if (s.onState) { try { s.onState({ engine: 'siri', lang: dLang() }); } catch {} }
    let committed = s.base;
    const spin = () => {
      const rec = new SR(); s.rec = rec;
      rec.lang = dLang() === 'en' ? 'en-US' : 'pt-BR'; rec.continuous = true; rec.interimResults = true;
      rec.onresult = (e) => {
        if (ses !== s || s.rec !== rec) return;
        // iOS: tratar como string única crescente (não indexar como no Chrome)
        let heard = '';
        for (let i = 0; i < e.results.length; i++) heard += e.results[i][0].transcript;
        const box = s.getBox(); if (!box) return;
        const t = transform(heard);
        box.innerText = committed + (committed && t ? ' ' : '') + t;
        box.dispatchEvent(new Event('input', { bubbles: true }));
      };
      rec.onerror = (e) => {
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stopAll(); BISA.toast('Microfone negado — permita em Ajustes ▸ Safari ▸ Microfone.');
        } // no-speech/aborted: o onend religa
      };
      rec.onend = () => {
        if (ses !== s || s.rec !== rec) return;
        const box = s.getBox();
        committed = box ? box.innerText.trim() : committed;
        setTimeout(() => { if (ses === s && s.rec === rec) spin(); }, 250);
      };
      try { rec.start(); } catch { stopAll(); }
    };
    spin();
  }

  // ── API ───────────────────────────────────────────────────────────────────
  // opts.onState({engine, lang}) → motor resolvido (pílula de estado no dono);
  // opts.onStop() → sessão terminou de verdade (pós-consolidação);
  // opts.onPause() → pausa de fala ≥3s (prévia de limpeza no dono);
  // opts.onLangHint(lang) → transcript parece do OUTRO idioma (1× por sessão).
  function start(btn, getBox, opts = {}) {
    if (!window.isSecureContext) { BISA.toast('Ditado exige HTTPS — abra pelo endereço https:// da tailnet.'); return; }
    ses = {
      btn, getBox, engine: 'whisper', base: ((getBox() || {}).innerText || '').trim(),
      onStop: opts.onStop || null, onState: opts.onState || null,
      onPause: opts.onPause || null, onLangHint: opts.onLangHint || null,
      paused: false, langHinted: false,
      lastVoice: performance.now(), lastText: '',
      ws: null, ctx: null, node: null, stream: null, rec: null, lock: null, ready: false,
    };
    btn.classList.add('active');
    grabWakeLock();
    const s = ses;
    startWhisper().then(() => {
      if (ses === s && s.onState) { try { s.onState({ engine: 'whisper', lang: dLang() }); } catch {} }
    }).catch((err) => {
      if (ses !== s) return;
      if (err && err.name === 'NotAllowedError') {
        stopAll(); BISA.toast('Microfone negado — permita em Ajustes ▸ Safari ▸ Microfone.');
        return;
      }
      // /stt fora do ar → limpa o que abriu e cai para a Siri (mesma sessão)
      if (s.ws) { try { s.ws.onclose = null; s.ws.close(); } catch {} s.ws = null; }
      if (s.node) { try { s.node.disconnect(); } catch {} s.node = null; }
      if (s.ctx) { try { s.ctx.close(); } catch {} s.ctx = null; }
      if (s.stream) { s.stream.getTracks().forEach((t) => t.stop()); s.stream = null; }
      BISA.toast('Ditado local indisponível — usando a Siri.');
      startWebSpeech();
    });
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && ses) stopAll();   // iOS deixa o mic zumbi pós-lock
  });

  window.BISO_DITADO = {
    bind(btn, getBox, opts) {
      btn.addEventListener('click', () => {
        if (ses && ses.btn === btn) { stopAll(); return; }
        stopAll();                            // mic de outro alvo → assume daqui
        start(btn, getBox, opts);
      });
    },
    // Troca de idioma a quente: religa a MESMA sessão (novo WS já com o novo
    // ?lang=) sem disparar onStop — não é um fim de ditado de verdade.
    restart() {
      if (!ses) return;
      const { btn, getBox, onStop, onState, onPause, onLangHint } = ses;
      ses.onStop = null;
      stopAll();
      start(btn, getBox, { onStop, onState, onPause, onLangHint });
    },
    activeBtn: () => (ses ? ses.btn : null),
    stopAll,
  };
})();
