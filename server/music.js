// Música da sala (estilo "ouvir juntos").
//
// O servidor é a fonte da verdade: fila, qual item está tocando, se está
// tocando, e em que segundo. Cada participante toca no PRÓPRIO player do
// YouTube e se corrige sozinho pra bater com este estado (o áudio não passa
// pelo servidor — e nada é baixado do YouTube).
//
// A posição atual é calculada, não guardada a cada segundo:
//   tocando → position + (agora − refTime) / 1000
//   pausado → position

export const VIDEO_ID_RE = /^[A-Za-z0-9_-]{11}$/;
const MAX_QUEUE = 500;
const MAX_TITLE = 200;
const PREV_RESTART_S = 3;

let nextId = 1;
const newId = () => `m${(nextId++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

export function createMusic({ now = Date.now } = {}) {
  const s = {
    queue: [],
    index: -1,
    playing: false,
    position: 0,
    refTime: now(),
    loop: 'off', // off | all | one
    ended: false,
  };

  const current = () => (s.index >= 0 && s.index < s.queue.length ? s.queue[s.index] : null);
  const elapsed = () => (s.playing ? s.position + (now() - s.refTime) / 1000 : s.position);

  function start(index) {
    s.index = index;
    s.position = 0;
    s.refTime = now();
    s.playing = true;
    s.ended = false;
  }

  function stopAtEnd() {
    s.playing = false;
    s.position = 0;
    s.refTime = now();
    s.ended = true;
  }

  function firstPlayable(from) {
    for (let i = from; i < s.queue.length; i++) if (!s.queue[i].unavailable) return i;
    return -1;
  }

  /** Vai pro próximo. `auto` = a música acabou sozinha (respeita "repetir uma"). */
  function advance(auto) {
    if (auto && s.loop === 'one' && current() && !current().unavailable) {
      start(s.index);
      return;
    }
    let next = firstPlayable(s.index + 1);
    if (next < 0 && s.loop === 'all') next = firstPlayable(0);
    if (next < 0) {
      stopAtEnd();
      return;
    }
    start(next);
  }

  return {
    current,

    toJSON() {
      return { ...s, queue: s.queue, serverNow: now() };
    },

    /** Adiciona itens. `mode`: 'end' (padrão), 'next' (tocar a seguir) ou 'now'. */
    add(items, addedBy, mode = 'end') {
      const clean = [];
      for (const it of items) {
        if (!it || !VIDEO_ID_RE.test(it.videoId)) continue;
        if (s.queue.length + clean.length >= MAX_QUEUE) break;
        clean.push({
          id: newId(),
          videoId: it.videoId,
          title: typeof it.title === 'string' ? it.title.slice(0, MAX_TITLE) : null,
          author: typeof it.author === 'string' ? it.author.slice(0, MAX_TITLE) : null,
          duration: null,
          addedBy,
          unavailable: false,
          /** Não deu pra descobrir o título (a interface mostra um nome genérico). */
          noMeta: false,
        });
      }
      if (!clean.length) return [];
      const idle = !current() || s.ended;
      if (idle) {
        // Nada tocando: entra no fim e já começa.
        const at = s.queue.length;
        s.queue.push(...clean);
        start(at);
      } else if (mode === 'end') {
        s.queue.push(...clean);
      } else {
        s.queue.splice(s.index + 1, 0, ...clean);
        if (mode === 'now') start(s.index + 1);
      }
      return clean;
    },

    play() {
      if (!current()) return false;
      if (s.ended) {
        start(s.index);
        return true;
      }
      if (s.playing) return false;
      s.refTime = now();
      s.playing = true;
      return true;
    },

    pause() {
      if (!s.playing) return false;
      s.position = elapsed();
      s.refTime = now();
      s.playing = false;
      return true;
    },

    seek(seconds) {
      const cur = current();
      if (!cur || !Number.isFinite(seconds)) return false;
      const max = cur.duration ?? Infinity;
      s.position = Math.max(0, Math.min(seconds, max));
      s.refTime = now();
      s.ended = false;
      return true;
    },

    skip() {
      if (!current()) return false;
      advance(false);
      return true;
    },

    prev() {
      if (!current()) return false;
      if (elapsed() > PREV_RESTART_S || s.index === 0) {
        s.position = 0;
        s.refTime = now();
        s.ended = false;
        return true;
      }
      start(s.index - 1);
      return true;
    },

    jump(id) {
      const i = s.queue.findIndex((q) => q.id === id);
      if (i < 0) return false;
      s.queue[i].unavailable = false;
      start(i);
      return true;
    },

    remove(id) {
      const i = s.queue.findIndex((q) => q.id === id);
      if (i < 0) return false;
      const wasCurrent = i === s.index;
      s.queue.splice(i, 1);
      if (i < s.index) s.index -= 1;
      if (wasCurrent) {
        if (s.index < s.queue.length && s.playing) start(s.index);
        else if (s.index < s.queue.length) {
          s.position = 0;
          s.refTime = now();
        } else if (s.queue.length) {
          s.index = s.queue.length - 1;
          stopAtEnd();
        } else {
          s.index = -1;
          s.playing = false;
          s.ended = false;
        }
      }
      return true;
    },

    move(id, to) {
      const from = s.queue.findIndex((q) => q.id === id);
      if (from < 0 || !Number.isInteger(to)) return false;
      const target = Math.max(0, Math.min(s.queue.length - 1, to));
      const cur = current();
      const [item] = s.queue.splice(from, 1);
      s.queue.splice(target, 0, item);
      if (cur) s.index = s.queue.indexOf(cur);
      return true;
    },

    /** Embaralha só o que ainda vai tocar (depois da atual). */
    shuffle() {
      const upcoming = s.queue.splice(s.index + 1);
      shuffleInPlace(upcoming);
      s.queue.push(...upcoming);
      return upcoming.length > 1;
    },

    clear() {
      s.queue = [];
      s.index = -1;
      s.playing = false;
      s.position = 0;
      s.ended = false;
      return true;
    },

    setLoop(mode) {
      if (!['off', 'all', 'one'].includes(mode)) return false;
      s.loop = mode;
      return true;
    },

    /** Um player avisou que a música acabou. Só vale pra música atual (vários avisam). */
    ended(id) {
      const cur = current();
      if (!cur || cur.id !== id || s.ended || !s.playing) return false;
      // Ignora aviso precoce de quem estava muito adiantado.
      if (cur.duration && elapsed() < cur.duration - 5) return false;
      advance(true);
      return true;
    },

    /** Vídeo não pode ser tocado (removido, bloqueado pra incorporar...). */
    failed(id) {
      const cur = current();
      const item = s.queue.find((q) => q.id === id);
      if (!item || item.unavailable) return false;
      item.unavailable = true;
      if (cur && cur.id === id) advance(false);
      return true;
    },

    setDuration(id, seconds) {
      const item = s.queue.find((q) => q.id === id);
      if (!item || item.duration || !Number.isFinite(seconds) || seconds <= 0 || seconds > 24 * 3600) return false;
      item.duration = Math.round(seconds);
      return true;
    },

    markNoMeta(videoId) {
      let changed = false;
      for (const item of s.queue) {
        if (item.videoId === videoId && !item.title && !item.noMeta) {
          item.noMeta = true;
          changed = true;
        }
      }
      return changed;
    },

    setMeta(videoId, meta) {
      let changed = false;
      for (const item of s.queue) {
        if (item.videoId !== videoId) continue;
        if (!item.title && meta.title) {
          item.title = String(meta.title).slice(0, MAX_TITLE);
          changed = true;
        }
        if (!item.author && meta.author) {
          item.author = String(meta.author).slice(0, MAX_TITLE);
          changed = true;
        }
      }
      return changed;
    },
  };
}

// ---------------------------------------------------------------- metadados

const metaCache = new Map();

/** Título e canal pelo oEmbed público do YouTube (sem chave de API). */
export async function fetchMeta(videoId) {
  if (metaCache.has(videoId)) return metaCache.get(videoId);
  const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(6000) });
  if (!res.ok) throw new Error(`oEmbed ${res.status}`);
  const data = await res.json();
  const meta = { title: data.title ?? null, author: data.author_name ?? null };
  metaCache.set(videoId, meta);
  if (metaCache.size > 5000) metaCache.delete(metaCache.keys().next().value);
  return meta;
}

/** Busca por nome (só se houver YOUTUBE_API_KEY). */
export async function searchYouTube(query, apiKey) {
  const params = new URLSearchParams({
    part: 'snippet',
    type: 'video',
    videoEmbeddable: 'true',
    maxResults: '10',
    q: query,
    key: apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/youtube/v3/search?${params}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`YouTube API ${res.status}`);
  const data = await res.json();
  return (data.items ?? [])
    .filter((it) => VIDEO_ID_RE.test(it.id?.videoId ?? ''))
    .map((it) => ({
      videoId: it.id.videoId,
      title: decodeEntities(it.snippet?.title ?? ''),
      author: decodeEntities(it.snippet?.channelTitle ?? ''),
    }));
}

function decodeEntities(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}
