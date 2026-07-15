// tests/media-api.test.js
// Inbox de mídia (upload streaming iPad → Mac): grava atômico conferindo
// Content-Length, sanitiza nome (nunca escapa do inbox), dedupe de colisão,
// list/raw (com Range) e delete. Sobe o router num express real em porta
// efêmera, com getCwd num diretório temporário e moveToTrash stubado.

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

const makeMediaRouter = require('../lib/media');

process.env.BISA_MEDIA_ANALYZE = '0';   // sem watcher/análise automática nos testes

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'bisa-media-'));
const INBOX = path.join(TMP, 'media', 'inbox');
const trashed = [];
const events = [];

const app = express();
app.use((req, _res, next) => (req.path === '/media/upload' ? next() : express.json()(req, _res, next)));
app.use(makeMediaRouter({
  requireAuth: (_req, _res, next) => next(),
  getCwd: () => TMP,
  moveToTrash: (abs) => { trashed.push(abs); fs.unlinkSync(abs); },
  broadcast: (obj) => events.push(obj),
}));

let base;
const srv = app.listen(0, () => { base = `http://127.0.0.1:${srv.address().port}`; });
test.before(() => new Promise((ok) => srv.on('listening', ok)));
test.after(() => srv.close());

const upload = async (name, body) => {
  const r = await fetch(`${base}/media/upload?name=${encodeURIComponent(name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream' }, body,
  });
  return { status: r.status, body: await r.json() };
};
const inboxFiles = () => fs.readdirSync(INBOX).filter((f) => !f.startsWith('.'));

test('upload grava o arquivo no inbox e responde nome/tamanho', async () => {
  const { status, body } = await upload('video.mp4', Buffer.from('conteudo-do-video'));
  assert.equal(status, 200);
  assert.equal(body.file.name, 'video.mp4');
  assert.equal(body.file.size, 17);
  assert.equal(fs.readFileSync(path.join(INBOX, 'video.mp4'), 'utf8'), 'conteudo-do-video');
  assert.deepEqual(events.at(-1), { type: 'media', event: 'add', name: 'video.mp4' });
});

test('colisão de nome ganha sufixo -2', async () => {
  const { body } = await upload('video.mp4', Buffer.from('outro'));
  assert.equal(body.file.name, 'video-2.mp4');
});

test('nome com ../ é sanitizado — nunca escapa do inbox', async () => {
  const { status, body } = await upload('../../fora.txt', Buffer.from('x'));
  assert.equal(status, 200);
  assert.equal(body.file.name, 'fora.txt');
  assert.ok(fs.existsSync(path.join(INBOX, 'fora.txt')));
  assert.ok(!fs.existsSync(path.join(TMP, 'fora.txt')));
});

test('sem name → 400; sem Content-Length → 411', async () => {
  const r1 = await upload('', Buffer.from('x'));
  assert.equal(r1.status, 400);
  const r2 = await new Promise((resolve) => {
    const req = http.request(`${base}/media/upload?name=a.bin`, {
      method: 'POST', headers: { 'transfer-encoding': 'chunked' },
    }, (res) => resolve(res.statusCode));
    req.end('abc');
  });
  assert.equal(r2, 411);
});

test('upload truncado (conexão caiu) não deixa arquivo nem .tmp', async () => {
  await new Promise((resolve) => {
    const req = http.request(`${base}/media/upload?name=trunc.mp4`, {
      method: 'POST', headers: { 'content-length': '1000000' },
    });
    req.on('error', () => {});
    req.write(Buffer.alloc(10));
    setTimeout(() => { req.destroy(); resolve(); }, 100);
  });
  await new Promise((ok) => setTimeout(ok, 200));
  assert.ok(!inboxFiles().includes('trunc.mp4'));
  assert.equal(fs.readdirSync(INBOX).filter((f) => f.includes('trunc')).length, 0);
});

test('list devolve os arquivos, mais recentes primeiro', async () => {
  const r = await fetch(`${base}/media/list`);
  const { files } = await r.json();
  const names = files.map((f) => f.name);
  assert.ok(names.includes('video.mp4') && names.includes('fora.txt'));
});

test('raw devolve o conteúdo com mime; Range → 206 parcial', async () => {
  const full = await fetch(`${base}/media/raw?name=video.mp4`);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'video/mp4');
  assert.equal(await full.text(), 'conteudo-do-video');

  const part = await fetch(`${base}/media/raw?name=video.mp4`, { headers: { range: 'bytes=0-7' } });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 0-7/17');
  assert.equal(await part.text(), 'conteudo');

  const bad = await fetch(`${base}/media/raw?name=video.mp4`, { headers: { range: 'bytes=99-' } });
  assert.equal(bad.status, 416);
});

test('delete manda para a lixeira e some da lista', async () => {
  const r = await fetch(`${base}/media/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'fora.txt' }),
  });
  assert.equal((await r.json()).ok, true);
  assert.equal(trashed.length, 1);
  assert.ok(!inboxFiles().includes('fora.txt'));
  const r404 = await fetch(`${base}/media/delete`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name: 'fora.txt' }),
  });
  assert.equal(r404.status, 404);
});
