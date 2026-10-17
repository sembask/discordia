import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket } from 'ws';
import { createDiscordiaServer, normalizeRoom, iceServersFor } from '../server.js';

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
    ws,
    open: () => new Promise((r) => ws.once('open', r)),
    send: (m) => ws.send(JSON.stringify(m)),
    next(type) {
      const i = queue.findIndex((m) => m.t === type);
      if (i >= 0) return Promise.resolve(queue.splice(i, 1)[0]);
      return new Promise((resolve, reject) => {
        waiters.push({ type, resolve });
        setTimeout(() => reject(new Error(`timeout esperando ${type}`)), 2000);
      });
    },
  };
}

test('normaliza o código da sala', () => {
  assert.equal(normalizeRoom('  Minha Sala! '), 'minhasala');
  assert.equal(normalizeRoom('abc-123'), 'abc-123');
});

test('gera credencial TURN temporária com segredo', () => {
  const ice = iceServersFor('peer1', { TURN_URLS: 'turn:x:3478', TURN_SECRET: 's' });
  const turn = ice.find((s) => s.username);
  assert.ok(turn.username.endsWith(':peer1'));
  assert.ok(turn.credential.length > 10);
});

test('sala: entrar, sinalizar, estado, chat e sair', async () => {
  const srv = createDiscordiaServer({ log: () => {} });
  const { port } = await srv.listen(0, '127.0.0.1');
  const url = `ws://127.0.0.1:${port}`;
  try {
    const a = client(url);
    await a.open();
    a.send({ t: 'join', room: 'Teste', name: 'Ana' });
    const wa = await a.next('welcome');
    assert.equal(wa.room, 'teste');
    assert.equal(wa.peers.length, 0);
    assert.ok(wa.iceServers.length >= 1);

    const b = client(url);
    await b.open();
    b.send({ t: 'join', room: 'teste', name: 'Bia', state: { muted: true } });
    const wb = await b.next('welcome');
    assert.deepEqual(wb.peers.map((p) => p.name), ['Ana']);
    const joined = await a.next('peer-joined');
    assert.equal(joined.peer.name, 'Bia');
    assert.equal(joined.peer.state.muted, true);

    b.send({ t: 'signal', to: wa.id, data: { description: { type: 'offer', sdp: 'x' } } });
    const sig = await a.next('signal');
    assert.equal(sig.from, wb.id);
    assert.equal(sig.data.description.type, 'offer');

    a.send({ t: 'state', state: { screen: 'stream-1', muted: false } });
    const st = await b.next('state');
    assert.equal(st.state.screen, 'stream-1');

    b.send({ t: 'chat', text: '  oi!  ' });
    const ca = await a.next('chat');
    const cb = await b.next('chat');
    assert.equal(ca.msg.text, 'oi!');
    assert.equal(cb.msg.name, 'Bia');

    // Quem entra depois recebe o histórico.
    const c = client(url);
    await c.open();
    c.send({ t: 'join', room: 'teste', name: 'Caio' });
    const wc = await c.next('welcome');
    assert.equal(wc.history.length, 1);
    assert.equal(wc.peers.length, 2);

    b.ws.close();
    const left = await a.next('peer-left');
    assert.equal(left.id, wb.id);

    a.ws.close();
    c.ws.close();
  } finally {
    await srv.close();
  }
});
