// lib/tts/index.js — voz das respostas do caderno (o "ouvir" robusto).
// POST /tts {texto} → gera o áudio NO MAC, converte p/ AAC e devolve { url };
// GET /tts/a/<hash>.m4a serve o arquivo (auth por cookie — é <audio src> no
// iPad, sem header). Cache por hash do texto: reouvir não regenera.
// Motores, em ordem: 1) Kokoro-82M (mlx-audio em 127.0.0.1:8103, LaunchAgent
// com.bisa.tts — voz neural, af_heart en / pf_dora pt); 2) say do macOS de
// reserva se o Kokoro estiver fora/falhar. O texto define o idioma/voz.
// Por que player de mídia e não speechSynthesis: toca em modo silencioso,
// sobrevive à tela bloqueada, pausa/velocidade/seek de graça.

const express = require('express');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const CACHE_DIR = path.join(os.tmpdir(), 'bisa-tts');
const MAX_CACHE = 120;     // arquivos; além disso, remove os mais antigos
const MAX_CHARS = 20000;
const KOKORO_URL = process.env.TTS_KOKORO_URL || 'http://127.0.0.1:8103';
const KOKORO_MODEL = 'mlx-community/Kokoro-82M-bf16';
const KOKORO_VOICE = { en: { voice: 'af_heart', lang_code: 'a' }, pt: { voice: 'pf_dora', lang_code: 'p' } };

module.exports = function makeTts({ requireAuth }) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  // O texto define a voz: resposta em inglês → voz en_US, em português → pt_BR
  // (o Claude responde nos dois; ler inglês com a Luciana sai "portuglês").
  const detectLang = (t) => {
    if (/[ãõçáéíóúâêôà]/i.test(t)) return 'pt';
    const en = (t.match(/\b(the|and|you|that|with|for|this|have|are|is)\b/gi) || []).length;
    const pt = (t.match(/\b(que|não|nao|para|com|uma|isso|você|voce|mais|como)\b/gi) || []).length;
    return en >= pt ? 'en' : 'pt';
  };
  let voicesPromise = null;
  const pickVoice = (lang) => {
    if (!voicesPromise) {
      voicesPromise = new Promise((resolve) => {
        execFile('say', ['-v', '?'], (_err, out) => {
          const all = String(out || '').split('\n');
          const best = (langRe, defRe, fallback) => {
            const lines = all.filter((l) => langRe.test(l));
            const pick = (re) => { const l = lines.find((x) => re.test(x)); return l ? l.split(/ {2,}/)[0].trim() : null; };
            return pick(/premium/i) || pick(/enhanced|aprimorada/i) || pick(defRe) || fallback;
          };
          const v = {
            pt: best(/pt[-_]BR/, /^Luciana/, 'Luciana'),
            en: best(/en[-_]US/, /^Samantha/, 'Samantha'),
          };
          console.log(`[tts] vozes: pt=${v.pt} · en=${v.en}`);
          resolve(v);
        });
      });
    }
    return voicesPromise.then((v) => v[lang] || v.pt);
  };

  const run = (cmd, args) => new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout: 120000 }, (err) => (err ? reject(err) : resolve()));
  });

  // Kokoro (mlx-audio): devolve WAV; quem chama converte p/ m4a como no say.
  // Timeout generoso: geração ~2,5× tempo real (resposta longa demora mesmo).
  const kokoroWav = async (texto, lang, wavPath) => {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), 180000);
    try {
      const r = await fetch(KOKORO_URL + '/v1/audio/speech', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(Object.assign({ model: KOKORO_MODEL, input: texto, response_format: 'wav', speed: 1.0 }, KOKORO_VOICE[lang])),
        signal: ac.signal,
      });
      if (!r.ok) throw new Error('kokoro http ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      if (buf.length < 1000) throw new Error('kokoro áudio vazio');
      fs.writeFileSync(wavPath, buf);
    } finally { clearTimeout(to); }
  };

  // aquecimento: o 1º pedido pós-boot carrega o modelo (~30s); dispara um
  // curto em background p/ o primeiro "ouvir" do dia não pagar essa conta
  setTimeout(() => {
    kokoroWav('Ready.', 'en', path.join(CACHE_DIR, 'warmup.wav'))
      .then(() => console.log('[tts] kokoro aquecido'))
      .catch((e) => console.warn('[tts] kokoro indisponível no boot:', e.message));
  }, 5000);

  const prune = () => {
    try {
      const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.m4a'))
        .map((f) => ({ f, t: fs.statSync(path.join(CACHE_DIR, f)).mtimeMs }))
        .sort((a, b) => b.t - a.t);
      files.slice(MAX_CACHE).forEach(({ f }) => { try { fs.unlinkSync(path.join(CACHE_DIR, f)); } catch {} });
    } catch {}
  };

  const router = express.Router();

  router.post('/tts', requireAuth, async (req, res) => {
    const texto = String((req.body || {}).texto || '').trim().slice(0, MAX_CHARS);
    if (!texto) return res.status(400).json({ error: 'texto vazio' });
    const id = crypto.createHash('sha1').update(texto).digest('hex');
    const m4a = path.join(CACHE_DIR, id + '.m4a');
    try {
      if (!fs.existsSync(m4a)) {
        const lang = detectLang(texto);
        const wav = path.join(CACHE_DIR, id + '.wav');
        try {
          await kokoroWav(texto, lang, wav);                       // motor 1: Kokoro
          await run('afconvert', ['-f', 'm4af', '-d', 'aac', wav, m4a]);
        } catch (e) {
          console.warn('[tts] kokoro falhou (' + e.message + ') — usando say');
          const voice = await pickVoice(lang);                     // motor 2: say
          // texto via arquivo (-f), nunca via shell — sem risco de injeção
          const txt = path.join(CACHE_DIR, id + '.txt');
          const aiff = path.join(CACHE_DIR, id + '.aiff');
          fs.writeFileSync(txt, texto, 'utf8');
          await run('say', ['-v', voice, '-f', txt, '-o', aiff]);
          // sem bitrate fixo: o say emite 22kHz mono e o AAC rejeita 96k aí
          // ('!dat'); o default (~35kbps) é ótimo p/ fala.
          await run('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, m4a]);
          try { fs.unlinkSync(txt); fs.unlinkSync(aiff); } catch {}
        }
        try { fs.unlinkSync(wav); } catch {}
        prune();
      }
      res.json({ url: '/tts/a/' + id + '.m4a' });
    } catch (e) {
      console.error('[tts]', e.message);
      res.status(500).json({ error: 'falha ao gerar áudio' });
    }
  });

  router.get('/tts/a/:file', requireAuth, (req, res) => {
    const f = String(req.params.file || '');
    if (!/^[a-f0-9]{40}\.m4a$/.test(f)) return res.status(400).end();
    const p = path.join(CACHE_DIR, f);
    if (!fs.existsSync(p)) return res.status(404).end();
    res.sendFile(p);   // sendFile fala Range → seek/scrub no player funciona
  });

  return { router };
};
