// screens/sentinel.js — Câmeras: embute a UI do Frigate (projeto sentinel) via
// o proxy /sentinel do bisa. Mesma origem → cookie do bisa autentica; funciona
// no iPad através do próprio bisa. Alcançada via BISA.go('sentinel') (ícone no hub).
(function () {
  if (!document.getElementById('sentinel-style')) {
    const s = document.createElement('style');
    s.id = 'sentinel-style';
    s.textContent = `
      .sentinel-bar { display:flex; align-items:center; gap:10px; margin-bottom:10px; }
      .sentinel-bar .title { font-weight:600; }
      .sentinel-bar .spacer { flex:1; }
      .sentinel-frame { width:100%; height:calc(100dvh - 150px); min-height:380px; display:block;
        border:1px solid var(--line); border-radius:var(--radius); background:var(--surface);
        box-shadow:var(--shadow); }
    `;
    document.head.appendChild(s);
  }

  const elx = (t, c, txt) => {
    const e = document.createElement(t);
    if (c) e.className = c;
    if (txt != null) e.textContent = txt;
    return e;
  };

  window.BISA.screens['sentinel'] = {
    mount(el) {
      el.innerHTML = '';

      const bar = elx('div', 'sentinel-bar');
      const back = elx('button', 'btn ghost', '← Hoje');
      back.style.minHeight = '40px';
      back.onclick = () => BISA.go('hub');
      const reload = elx('button', 'btn ghost', '⟳');
      reload.style.minHeight = '40px';
      reload.title = 'Recarregar câmeras';
      bar.append(back, elx('span', 'title', '📹 Câmeras'), elx('span', 'spacer'), reload);
      el.appendChild(bar);

      const frame = elx('iframe', 'sentinel-frame');
      frame.src = '/sentinel/';
      frame.setAttribute('title', 'Câmeras (Frigate)');
      frame.setAttribute('allow', 'fullscreen');
      reload.onclick = () => { frame.src = '/sentinel/'; };
      el.appendChild(frame);
    },
  };
})();
