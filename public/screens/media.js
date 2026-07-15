// screens/media.js — Mídia: envia vídeos/fotos/arquivos do iPad para o Mac
// (inbox <dados>/media/inbox via POST /media/upload) e lista o que já chegou.
// Alcançada via BISA.go('media') (botão no hub). Upload em XHR sequencial com
// barra de progresso (fetch não expõe progresso de upload no Safari); Wake Lock
// enquanto envia — vídeo grande não pode morrer com a tela apagando.
(function () {
  if (!document.getElementById('media-style')) {
    const s = document.createElement('style');
    s.id = 'media-style';
    s.textContent = `
      .media-bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .media-bar .title { font-weight:600; }
      .media-bar .spacer { flex:1; }
      .media-pick { display:block; width:100%; min-height:64px; font-size:1.05rem; }
      .media-row { display:flex; align-items:center; gap:10px; padding:10px 4px;
        border-bottom:1px solid var(--line); }
      .media-row:last-child { border-bottom:0; }
      .media-row .nm { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis;
        white-space:nowrap; }
      .media-row .meta { font-size:.82rem; }
      .media-row button { min-height:40px; min-width:44px; }
      .media-prog { height:6px; border-radius:3px; background:var(--line);
        overflow:hidden; margin-top:6px; }
      .media-prog > div { height:100%; width:0%; background:var(--accent, #4a7); }
      .media-preview { width:100%; max-height:52vh; border-radius:var(--radius);
        background:#000; margin:8px 0 4px; display:block; }
      img.media-preview { background:transparent; object-fit:contain; }
      .media-md { background:var(--surface); color:inherit; padding:14px 16px;
        overflow:auto; font-size:.92rem; max-height:60vh; }
    `;
    document.head.appendChild(s);
  }

  const elx = (t, c, txt) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };
  const fmtSize = (b) => b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB'
    : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB'
    : b >= 1e3 ? Math.round(b / 1e3) + ' KB' : b + ' B';
  const fmtWhen = (ms) => new Date(ms).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const isVideo = (n) => /\.(mp4|m4v|mov|webm)$/i.test(n);
  const isImage = (n) => /\.(png|jpe?g|gif|webp|heic)$/i.test(n);
  const isDoc = (n) => /\.(md|txt)$/i.test(n);   // ex.: análises automáticas de vídeo
  const rawUrl = (n) => '/media/raw?name=' + encodeURIComponent(n)
    + '&token=' + encodeURIComponent(BISA.token);

  // Wake Lock best-effort durante a fila (iOS derruba upload com a tela apagada)
  let wakeLock = null;
  const holdAwake = async () => { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} };
  const releaseAwake = () => { try { wakeLock && wakeLock.release(); } catch {} wakeLock = null; };

  function uploadFile(file, row) {
    const bar = row.querySelector('.media-prog > div');
    const meta = row.querySelector('.meta');
    return new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', '/media/upload?name=' + encodeURIComponent(file.name));
      xhr.setRequestHeader('x-bisa-token', BISA.token);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.upload.onprogress = (e) => {
        if (!e.lengthComputable) return;
        bar.style.width = Math.round(100 * e.loaded / e.total) + '%';
        meta.textContent = `${fmtSize(e.loaded)} / ${fmtSize(e.total)}`;
      };
      const finish = (ok, msg) => {
        meta.textContent = msg;
        meta.className = 'meta ' + (ok ? 'muted' : 'empty');
        if (ok) bar.style.width = '100%';
        resolve(ok);
      };
      xhr.onload = () => {
        if (xhr.status === 200) return finish(true, '✓ no Mac');
        let msg = 'erro ' + xhr.status;
        try { msg = JSON.parse(xhr.responseText).error || msg; } catch {}
        finish(false, '✕ ' + msg);
      };
      xhr.onerror = () => finish(false, '✕ rede caiu — toque em ⟳ para reenviar');
      xhr.send(file);
    });
  }

  window.BISA.screens['media'] = {
    _offWs: null,
    mount(el) {
      el.innerHTML = '';

      const bar = elx('div', 'media-bar');
      const back = elx('button', 'btn ghost', '← Hoje');
      back.style.minHeight = '40px';
      back.onclick = () => BISA.go('hub');
      bar.append(back, elx('span', 'title', '🎞 Mídia'), elx('span', 'spacer'));
      el.appendChild(bar);

      /* envio */
      const sendCard = elx('div', 'card');
      sendCard.appendChild(elx('div', 'section-title', 'Enviar para o Mac'));
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.style.display = 'none';
      const pick = elx('button', 'btn media-pick', '＋ Escolher vídeos ou arquivos');
      pick.onclick = () => input.click();
      const hint = elx('p', 'muted', 'Fototeca ou app Arquivos → os arquivos caem no inbox de mídia do Mac. Mantenha a tela ligada durante o envio.');
      hint.style.cssText = 'font-size:.85rem;margin:8px 0 0;';
      const queue = elx('div');
      sendCard.append(pick, input, hint, queue);
      el.appendChild(sendCard);

      /* recebidos */
      const listCard = elx('div', 'card');
      listCard.style.marginTop = '12px';
      listCard.appendChild(elx('div', 'section-title', 'Recebidos no Mac'));
      const list = elx('div');
      list.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">Carregando…</p>';
      listCard.appendChild(list);
      el.appendChild(listCard);

      async function refresh() {
        try {
          const { files } = await BISA.api('/media/list');
          list.innerHTML = '';
          if (!files.length) {
            list.innerHTML = '<p class="muted" style="font-size:.88rem;margin:0;">Nada por aqui ainda.</p>';
            return;
          }
          for (const f of files) {
            const row = elx('div', 'media-row');
            const nm = elx('div', 'nm');
            nm.append(elx('div', null, f.name),
              elx('div', 'meta muted', `${fmtSize(f.size)} · ${fmtWhen(f.mtimeMs)}`));
            row.appendChild(nm);
            if (isVideo(f.name) || isImage(f.name) || isDoc(f.name)) {
              const play = elx('button', 'btn ghost', isVideo(f.name) ? '▶' : isDoc(f.name) ? '📄' : '👁');
              play.onclick = async () => {
                const open = row.nextElementSibling;
                if (open && open.classList.contains('media-preview')) { open.remove(); return; }
                document.querySelectorAll('.media-preview').forEach((p) => p.remove());
                let pv;
                if (isVideo(f.name)) {
                  pv = document.createElement('video');
                  pv.controls = true; pv.playsInline = true; pv.autoplay = true;
                  pv.src = rawUrl(f.name);
                } else if (isDoc(f.name)) {
                  pv = document.createElement('div');
                  pv.className = 'media-preview media-md';
                  try {
                    const t = await (await fetch(rawUrl(f.name))).text();
                    pv.innerHTML = BISA.renderMarkdown(t);
                  } catch { pv.textContent = 'Não consegui abrir.'; }
                  row.after(pv);
                  return;
                } else {
                  pv = document.createElement('img');
                  pv.src = rawUrl(f.name);
                }
                pv.className = pv.className || 'media-preview';
                pv.classList.add('media-preview');
                row.after(pv);
              };
              row.appendChild(play);
            }
            const del = elx('button', 'btn ghost', '🗑');
            del.onclick = async () => {
              if (!confirm(`Apagar "${f.name}"? (vai para a Lixeira do Mac)`)) return;
              try { await BISA.api('/media/delete', { method: 'POST', json: { name: f.name } }); refresh(); }
              catch (e) { BISA.toast('Não apagou: ' + e.message); }
            };
            row.appendChild(del);
            list.appendChild(row);
          }
        } catch (e) {
          list.innerHTML = `<p class="empty">Erro ao listar: ${e.message}</p>`;
        }
      }

      let sending = false;
      input.onchange = async () => {
        const files = Array.from(input.files || []);
        input.value = '';
        if (!files.length || sending) return;
        sending = true;
        pick.disabled = true;
        holdAwake();
        for (const file of files) {
          const row = elx('div', 'media-row');
          const nm = elx('div', 'nm');
          nm.append(elx('div', null, file.name), elx('div', 'meta muted', 'na fila…'));
          const prog = elx('div', 'media-prog');
          prog.appendChild(elx('div'));
          nm.appendChild(prog);
          row.appendChild(nm);
          queue.appendChild(row);
          const ok = await uploadFile(file, row);
          if (!ok) {
            const retry = elx('button', 'btn ghost', '⟳');
            retry.onclick = async () => { retry.remove(); await uploadFile(file, row) && refresh(); };
            row.appendChild(retry);
          }
        }
        releaseAwake();
        pick.disabled = false;
        sending = false;
        refresh();
      };

      this._offWs = BISA.onWs((m) => { if (m && m.type === 'media') refresh(); });
      refresh();
    },
    unmount() {
      releaseAwake();
      if (this._offWs) { this._offWs(); this._offWs = null; }
    },
  };
})();
