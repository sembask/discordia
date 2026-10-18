import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusic } from '../music.js';

const vid = (n) => `video${String(n).padStart(6, '0')}`; // 11 caracteres

function setup() {
  let t = 1_000_000;
  const clock = { now: () => t, advance: (ms) => (t += ms) };
  const m = createMusic({ now: clock.now });
  return { m, clock, at: () => m.toJSON() };
}

const pos = (st, now) => (st.playing ? st.position + (now - st.refTime) / 1000 : st.position);

test('adicionar começa a tocar quando a fila está parada', () => {
  const { m, at } = setup();
  const added = m.add([{ videoId: vid(1) }, { videoId: vid(2) }, { videoId: 'inválido' }], 'Ana');
  assert.equal(added.length, 2);
  const st = at();
  assert.equal(st.index, 0);
  assert.equal(st.playing, true);
  assert.equal(st.queue[0].addedBy, 'Ana');
});

test('pausar, voltar a tocar e pular mantêm a posição certa', () => {
  const { m, clock, at } = setup();
  m.add([{ videoId: vid(1) }, { videoId: vid(2) }], 'Ana');
  clock.advance(10_000);
  m.pause();
  assert.equal(at().position, 10);
  clock.advance(5_000);
  assert.equal(pos(at(), clock.now()), 10); // pausado não anda
  m.play();
  clock.advance(2_000);
  assert.equal(pos(at(), clock.now()), 12);
  m.seek(100);
  assert.equal(pos(at(), clock.now()), 100);
  m.skip();
  assert.equal(at().index, 1);
  assert.equal(pos(at(), clock.now()), 0);
});

test('fim da música: avança, repete uma, repete tudo e para no fim', () => {
  const { m, clock, at } = setup();
  const [a, b] = m.add([{ videoId: vid(1) }, { videoId: vid(2) }], 'Ana');
  m.setDuration(a.id, 60);
  clock.advance(30_000);
  assert.equal(m.ended(a.id), false, 'aviso precoce é ignorado');
  clock.advance(30_000);
  assert.equal(m.ended(a.id), true);
  assert.equal(m.ended(a.id), false, 'segundo aviso da mesma música é ignorado');
  assert.equal(at().index, 1);

  m.setLoop('one');
  m.ended(b.id);
  assert.equal(at().index, 1, 'repetir uma: continua na mesma');

  m.setLoop('all');
  m.ended(b.id);
  assert.equal(at().index, 0, 'repetir tudo: volta pro começo');

  m.setLoop('off');
  m.skip();
  m.ended(b.id);
  assert.equal(at().ended, true);
  assert.equal(at().playing, false);
  m.add([{ videoId: vid(3) }], 'Bia');
  assert.equal(at().index, 2, 'fila parada no fim: adicionar toca o novo');
  assert.equal(at().playing, true);
});

test('tocar a seguir, tocar agora, mover, remover e embaralhar', () => {
  const { m, at } = setup();
  m.add([1, 2, 3].map((n) => ({ videoId: vid(n) })), 'Ana');
  m.add([{ videoId: vid(9) }], 'Bia', 'next');
  assert.equal(at().queue[1].videoId, vid(9));
  m.add([{ videoId: vid(8) }], 'Bia', 'now');
  assert.equal(at().queue[at().index].videoId, vid(8));

  const cur = at().queue[at().index];
  m.move(at().queue[0].id, 4);
  assert.equal(at().queue[at().index].id, cur.id, 'mover não troca a música atual');

  m.remove(cur.id);
  assert.notEqual(at().queue[at().index]?.id, cur.id);
  assert.equal(at().playing, true);

  const before = at().queue.slice(0, at().index + 1).map((q) => q.id);
  m.shuffle();
  assert.deepEqual(at().queue.slice(0, at().index + 1).map((q) => q.id), before, 'embaralhar não mexe no que já tocou');
});

test('vídeo indisponível é pulado', () => {
  const { m, at } = setup();
  const [a] = m.add([{ videoId: vid(1) }, { videoId: vid(2) }], 'Ana');
  m.failed(a.id);
  assert.equal(at().index, 1);
  assert.equal(at().queue[0].unavailable, true);
});

test('voltar: reinicia se já tocou mais de 3 s, senão vai pra anterior', () => {
  const { m, clock, at } = setup();
  m.add([{ videoId: vid(1) }, { videoId: vid(2) }], 'Ana');
  m.skip();
  clock.advance(10_000);
  m.prev();
  assert.equal(at().index, 1);
  assert.equal(pos(at(), clock.now()), 0);
  m.prev();
  assert.equal(at().index, 0);
});
