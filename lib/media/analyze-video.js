// lib/media/analyze-video.js — análise automática de vídeo do inbox de mídia.
// Fluxo (o mesmo que o dev fazia à mão em 2026-07-13): ffprobe (duração) →
// ffmpeg extrai frames → claude -p headless LÊ os frames e escreve um relatório
// → <video>.analysis.md ao lado do vídeo + toast no iPad (/feedback/notify).
// Spawnado destacado pelo watcher do lib/media; nunca roda duas vezes para o
// mesmo vídeo (o .analysis.md é o marcador).

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawnSync } = require('child_process');

const FILE = process.argv[2];
const PORT = parseInt(process.env.PORT || '7778', 10);
const TOKEN = process.env.AUTH_TOKEN || '';
const CLAUDE = process.env.CLAUDE_CMD || 'claude';
const SHELL = process.env.SHELL || '/bin/zsh';
const MAX_DUR_S = 360;            // vídeo além disso = caro demais p/ auto
const RUN_TIMEOUT_MS = 4 * 60 * 1000;

const log = (...a) => {
  try { fs.appendFileSync(path.join(path.dirname(FILE), '.analyze.log'), `${new Date().toISOString()} ${a.join(' ')}\n`); } catch {}
};
const notify = async (text) => {
  try {
    await fetch(`http://127.0.0.1:${PORT}/feedback/notify`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-bisa-token': TOKEN },
      body: JSON.stringify({ text }),
    });
  } catch {}
};

(async () => {
  if (!FILE || !fs.existsSync(FILE)) return;
  const out = FILE + '.analysis.md';
  if (fs.existsSync(out)) return;
  const name = path.basename(FILE);

  const probe = spawnSync('ffprobe', ['-loglevel', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', FILE], { encoding: 'utf8' });
  const dur = parseFloat(probe.stdout) || 0;
  if (!dur || dur > MAX_DUR_S) { log(`skip ${name}: duração ${dur}s`); return; }

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-video-'));
  const step = dur > 120 ? 4 : 3;
  spawnSync('ffmpeg', ['-loglevel', 'error', '-i', FILE, '-vf', `fps=1/${step},scale=720:-1`, path.join(tmp, 'f%03d.png')], { timeout: 120000 });
  const frames = fs.readdirSync(tmp).filter((f) => f.endsWith('.png')).sort();
  if (!frames.length) { log(`sem frames: ${name}`); return; }

  const prompt = `Analise uma gravação de tela de iPad (${Math.round(dur)}s, provavelmente do app bisa). Os frames extraídos (1 a cada ${step}s, em ordem cronológica) estão no diretório atual: ${frames.join(', ')}.

Leia TODOS os frames com a tool Read, em ordem, e escreva em português um relatório markdown curto e específico (telas, botões e textos visíveis):

## O que acontece (linha do tempo)
## Problemas/atritos observados
## Sugestões (máx 3)

Responda APENAS o markdown do relatório.`;

  log(`analisando ${name}: ${frames.length} frames`);
  const r = spawnSync(SHELL, ['-lic', `${CLAUDE} --permission-mode bypassPermissions -p`], {
    cwd: tmp, input: prompt, encoding: 'utf8', timeout: RUN_TIMEOUT_MS,
    env: process.env, maxBuffer: 4 * 1024 * 1024,
  });
  const report = (r.stdout || '').trim();
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  if (r.status !== 0 || !report) {
    log(`falhou ${name}: status ${r.status} ${String(r.stderr || '').slice(0, 200)}`);
    return;
  }
  fs.writeFileSync(out, `# Análise automática — ${name}\n\n_${new Date().toISOString()} · ${Math.round(dur)}s · ${frames.length} frames_\n\n${report}\n`, 'utf8');
  log(`ok ${name} → ${path.basename(out)}`);
  enqueueFeedback(name, out, report);
  await notify(`🎞 Análise pronta: ${name} — veja em Mídia`);
})();

// Fecha o ciclo vídeo→backlog: as "Sugestões" do relatório viram uma entrada
// no feedback/inbox.jsonl (mesmo canal do Modo Anotar, que o dev/Claude já lê)
// com status 'review' — o agente automático só processa 'open', então nada
// roda sozinho; o item só fica esperando a próxima sessão de melhorias.
function enqueueFeedback(name, reportPath, report) {
  try {
    const m = /##\s*Sugest[õo]es[^\n]*\n([\s\S]*?)(?=\n##\s|$)/i.exec(report);
    const sugestoes = m ? m[1].trim() : '';
    if (!sugestoes) { log(`sem seção Sugestões: ${name}`); return; }
    const dataDir = process.env.CWD || path.join(os.homedir(), 'bisa-data');
    const inbox = path.join(dataDir, 'feedback', 'inbox.jsonl');
    fs.mkdirSync(path.dirname(inbox), { recursive: true });
    const item = {
      id: 'fb_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      ts: new Date().toISOString(),
      screen: 'media',
      kind: 'video-analysis',
      video: name,
      report: reportPath,
      request: sugestoes.slice(0, 2000),
      status: 'review',
    };
    fs.appendFileSync(inbox, JSON.stringify(item) + '\n', 'utf8');
    log(`backlog ${name} → feedback/inbox.jsonl (${item.id})`);
  } catch (e) { log(`backlog falhou ${name}: ${e.message}`); }
}
