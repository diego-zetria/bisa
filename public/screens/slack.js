// screens/slack.js — tail do slack-watch do biso: screenshots do Slack do Mac
// corporativo + análise da IA, via o proxy /biso (token injetado no servidor).
// Alcançada via BISA.go('slack') (botão no hub). Imagens buscadas com fetch +
// blob URL porque o proxy autentica por header, não por ?token=.
(function () {
  if (!document.getElementById('slack-style')) {
    const s = document.createElement('style');
    s.id = 'slack-style';
    s.textContent = `
      .slack-bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .slack-bar .title { font-weight:600; }
      .slack-bar .spacer { flex:1; }
      .slack-run { margin-bottom:14px; }
      .slack-run .meta { display:flex; align-items:center; gap:8px; margin-bottom:6px; }
      .slack-run img { max-width:100%; border:1px solid var(--line);
        border-radius:var(--radius); margin-top:8px; }
    `;
    document.head.appendChild(s);
  }

  const elx = (t, c, txt) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };

  const bget = (p) => BISA.api('/biso' + p);
  const bpost = (p) => BISA.api('/biso' + p, { method: 'POST' });

  const STATUS_PT = {
    capturing: '📸 capturando…',
    analyzing: '🧠 analisando…',
    done: '✅ pronto',
    error: '⚠ erro',
  };

  let pollTimer = null;
  let blobUrls = [];

  async function imageUrl(id) {
    try {
      const r = await fetch(`/biso/codex/slackwatch/image/${id}`, {
        headers: { 'x-bisa-token': BISA.token },
      });
      if (!r.ok) return null;
      const url = URL.createObjectURL(await r.blob());
      blobUrls.push(url);
      return url;
    } catch { return null; }
  }

  window.BISA.screens['slack'] = {
    mount(el) {
      el.innerHTML = '';

      const bar = elx('div', 'slack-bar');
      const back = elx('button', 'btn ghost', '← Hoje');
      back.style.minHeight = '40px';
      back.onclick = () => BISA.go('hub');
      const capBtn = elx('button', 'btn', '📸 Capturar agora');
      capBtn.style.minHeight = '40px';
      bar.append(back, elx('span', 'title', '📡 Slack corp'), elx('span', 'spacer'), capBtn);
      el.appendChild(bar);

      const list = elx('div');
      el.appendChild(list);

      async function render() {
        let data;
        try {
          data = await bget('/codex/slackwatch/runs?limit=15');
        } catch (e) {
          list.innerHTML = '';
          list.appendChild(elx('p', 'muted', `⚠ Não consegui falar com o biso (${e.message}). Ele está rodando na porta 7777?`));
          return;
        }
        blobUrls.forEach((u) => URL.revokeObjectURL(u));
        blobUrls = [];
        list.innerHTML = '';
        capBtn.disabled = !!data.inFlight;

        if (!data.runs.length) {
          list.appendChild(elx('p', 'muted', 'Nenhuma captura ainda. Toque em “Capturar agora”.'));
        }
        for (const run of data.runs) {
          const card = elx('div', 'card slack-run');
          const meta = elx('div', 'meta');
          meta.append(
            elx('span', 'pill', STATUS_PT[run.status] || run.status),
            elx('span', 'muted', new Date(run.ts).toLocaleString('pt-BR')),
          );
          card.appendChild(meta);
          if (run.analysis) {
            const body = elx('div');
            body.innerHTML = BISA.renderMarkdown(run.analysis);
            card.appendChild(body);
          }
          if (run.error) card.appendChild(elx('p', 'muted', `⚠ ${run.error}`));
          if (run.image) {
            imageUrl(run.id).then((src) => {
              if (!src) return;
              const img = elx('img');
              img.src = src;
              img.alt = 'Screenshot do Slack';
              card.appendChild(img);
            });
          }
          list.appendChild(card);
        }

        // continua acompanhando enquanto houver captura em andamento
        const busy = data.inFlight || data.runs.some((r) => r.status === 'capturing' || r.status === 'analyzing');
        clearTimeout(pollTimer);
        if (busy) pollTimer = setTimeout(render, 3000);
      }

      capBtn.onclick = async () => {
        capBtn.disabled = true;
        try {
          await bpost('/codex/slackwatch/run');
          BISA.toast('Captura enviada para o Mac corporativo');
        } catch (e) {
          BISA.toast(`⚠ ${e.message}`);
        }
        render();
      };

      render();
    },
    unmount() {
      clearTimeout(pollTimer);
      pollTimer = null;
      blobUrls.forEach((u) => URL.revokeObjectURL(u));
      blobUrls = [];
    },
  };
})();
