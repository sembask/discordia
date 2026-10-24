import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';
import { createDiscordiaServer } from '../server.js';

function client(url) {
  const ws = new WebSocket(url);
  const queue = [];
  const waiters = [];
  ws.on('message', (raw) => {
    const msg = JSON.parse(raw.toString());
    const i = waiters.findIndex((w) => w.type === msg.t);
    if (i >= 0) waiters.splice(i, 1)[0].resolve(msg);
    else queue.push(msg);
  });
  return {
    open: () => new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    close: () => ws.close(),
    next(type, ms = 2000) {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`timeout esperando ${type}`)), ms);
      });
    },
  };
}

async function setup(env = {}) {
  const dir = path.join(os.tmpdir(), `discordia-test-${Math.random().toString(36).slice(2)}`);
  const srv = createDiscordiaServer({ log: () => {}, env: { MUSIC_META: 'off', FILES_DIR: dir, ...env }, resolveMeta: null });
  const { port } = await srv.listen(0, '127.0.0.1');
  const base = `http://127.0.0.1:${port}`;
  const join = async (name) => {
    const c = client(`ws://127.0.0.1:${port}`);
    await c.open();
    c.send({ t: 'join', room: 'arquivos', name });
    c.welcome = await c.next('welcome');
    return c;
  };
  const upload = (peerId, body, name = 'notas.txt', type = 'text/plain') =>
    fetch(`${base}/files?peer=${peerId}`, { method: 'POST', body, headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name) } });
  return { srv, base, join, upload };
}

test('arquivo: envia, anuncia no chat, baixa (com Range) e vale só pra sala', async () => {
  const { srv, base, join, upload } = await setup();
  try {
    const a = await join('Ana');
    const b = await join('Bia');
    assert.equal(a.welcome.features.files.ttlMs, 30 * 60_000);

    // Fora de sala (id inventado) não envia.
    assert.equal((await upload('inventado', 'x')).status, 403);

    const res = await upload(a.welcome.id, 'olá, mundo! 🌍', 'Relatório final.txt');
    assert.equal(res.status, 200);
    const meta = await res.json();
    assert.equal(meta.name, 'Relatório final.txt');
    assert.equal(meta.size, Buffer.byteLength('olá, mundo! 🌍'));

    // Outro peer não pode anunciar o arquivo de quem enviou.
    b.send({ t: 'chat', text: '', file: meta.id });
    assert.equal((await b.next('error')).code, 'bad-file');

    a.send({ t: 'chat', text: 'segue', file: meta.id });
    const msg = (await b.next('chat')).msg;
    assert.equal(msg.text, 'segue');
    assert.equal(msg.file.url, `/files/${meta.id}`);
    // Não dá pra anunciar duas vezes.
    a.send({ t: 'chat', text: '', file: meta.id });
    assert.equal((await a.next('error')).code, 'bad-file');

    const got = await fetch(base + msg.file.url);
    assert.equal(got.status, 200);
    assert.equal(await got.text(), 'olá, mundo! 🌍');
    assert.equal(got.headers.get('x-content-type-options'), 'nosniff');

    const part = await fetch(base + msg.file.url, { headers: { range: 'bytes=0-1' } });
    assert.equal(part.status, 206);
    assert.equal(await part.text(), 'ol');

    // HTML nunca abre como página: sempre download.
    const html = await (await upload(a.welcome.id, '<script>alert(1)</script>', 'x.html', 'text/html')).json();
    const page = await fetch(`${base}/files/${html.id}`);
    assert.equal(page.headers.get('content-type'), 'application/octet-stream');
    assert.match(page.headers.get('content-disposition'), /^attachment/);
    assert.equal(page.headers.get('content-security-policy').startsWith('sandbox'), true);

    // Novo membro recebe o arquivo no histórico.
    const c = await join('Caio');
    assert.equal(c.welcome.history.find((m) => m.file)?.file.id, meta.id);

    a.close();
    b.close();
    c.close();
  } finally {
    await srv.close();
  }
});

test('arquivo: some sozinho quando vence e respeita o tamanho máximo', async () => {
  const { srv, base, join, upload } = await setup({ FILE_TTL_MIN: String(0.4 / 60), MAX_FILE_MB: String(1 / 1024) });
  try {
    const a = await join('Ana');
    assert.equal((await upload(a.welcome.id, 'x'.repeat(2048))).status, 413);

    const meta = await (await upload(a.welcome.id, 'tchau')).json();
    a.send({ t: 'chat', text: '', file: meta.id });
    await a.next('chat');
    assert.equal((await fetch(`${base}/files/${meta.id}`)).status, 200);

    const gone = await a.next('file-expired', 3000);
    assert.equal(gone.id, meta.id);
    assert.equal((await fetch(`${base}/files/${meta.id}`)).status, 410);
    assert.equal(srv.files.files.size, 0);
    a.close();
  } finally {
    await srv.close();
  }
});
