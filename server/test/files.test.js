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
  const start = (peerId, size, name = 'notas.txt', mime = 'text/plain') =>
    fetch(`${base}/files/start?peer=${peerId}`, { method: 'POST', body: JSON.stringify({ name, size, mime }) });
  const put = (peerId, upload, offset, body) =>
    fetch(`${base}/files/upload/${upload}?peer=${peerId}&offset=${offset}`, { method: 'PUT', body });
  /** Manda o arquivo inteiro em partes, como o app faz. Devolve a última resposta. */
  const upload = async (peerId, content, name, mime) => {
    const buf = Buffer.from(content);
    const r = await start(peerId, buf.length, name, mime);
    if (r.status !== 200) return { status: r.status, body: await r.json() };
    const { upload: id, chunkBytes } = await r.json();
    let last;
    for (let off = 0; off < buf.length; off += chunkBytes) {
      last = await put(peerId, id, off, buf.subarray(off, off + chunkBytes));
      if (last.status !== 200) return { status: last.status, body: await last.json() };
    }
    const body = await last.json();
    return { status: 200, body, file: body.file };
  };
  return { srv, base, join, upload, start, put };
}

test('arquivo: envia, anuncia no chat, baixa (com Range) e vale só pra sala', async () => {
  const { srv, base, join, upload } = await setup({ FILE_CHUNK_MB: String(4 / 1024 / 1024) });
  try {
    const a = await join('Ana');
    const b = await join('Bia');
    assert.equal(a.welcome.features.files.ttlMs, 30 * 60_000);

    // Fora de sala (id inventado) não envia.
    assert.equal((await upload('inventado', 'x')).status, 403);

    const res = await upload(a.welcome.id, 'olá, mundo! 🌍', 'Relatório final.txt');
    assert.equal(res.status, 200);
    const meta = res.file;
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
    const html = (await upload(a.welcome.id, '<script>alert(1)</script>', 'x.html', 'text/html')).file;
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

    const meta = (await upload(a.welcome.id, 'tchau')).file;
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

test('arquivo em partes: maior que uma parte, fora de ordem, retomada e cancelar', async () => {
  const { srv, base, join, upload, start, put } = await setup({ FILE_CHUNK_MB: String(1 / 1024) }); // partes de 1 KB
  try {
    const a = await join('Ana');
    const content = Buffer.alloc(10_000).map((_, i) => i % 256);

    // Vai em 10 partes e chega inteiro.
    const ok = await upload(a.welcome.id, content, 'dados.bin', 'application/octet-stream');
    assert.equal(ok.status, 200);
    const back = Buffer.from(await (await fetch(`${base}/files/${ok.file.id}`)).arrayBuffer());
    assert.ok(back.equals(content));

    // Parte fora de ordem é recusada dizendo onde parou; dá pra continuar dali.
    const { upload: id } = await (await start(a.welcome.id, 3000, 'x.bin')).json();
    assert.equal((await put(a.welcome.id, id, 0, content.subarray(0, 1024))).status, 200);
    const skip = await put(a.welcome.id, id, 2048, content.subarray(0, 1024));
    assert.equal(skip.status, 409);
    assert.equal((await skip.json()).received, 1024);
    assert.equal((await (await fetch(`${base}/files/upload/${id}`)).json()).received, 1024);
    // Parte maior que o permitido.
    assert.equal((await put(a.welcome.id, id, 1024, Buffer.alloc(2048))).status, 400);
    await put(a.welcome.id, id, 1024, content.subarray(1024, 2048));
    const fin = await (await put(a.welcome.id, id, 2048, content.subarray(2048, 3000))).json();
    assert.equal(fin.done, true);
    assert.equal(fin.file.size, 3000);

    // Cancelar no meio apaga o pedaço e libera o espaço.
    const { upload: id2 } = await (await start(a.welcome.id, 5000, 'y.bin')).json();
    await put(a.welcome.id, id2, 0, content.subarray(0, 1024));
    assert.equal(srv.files.uploads.size, 1);
    await fetch(`${base}/files/upload/${id2}`, { method: 'DELETE' });
    assert.equal(srv.files.uploads.size, 0);
    assert.equal((await put(a.welcome.id, id2, 1024, content.subarray(0, 1024))).status, 404);

    // Fora de sala não começa envio.
    assert.equal((await start('inventado', 10)).status, 403);
    a.close();
  } finally {
    await srv.close();
  }
});
