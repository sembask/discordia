// Servidor de sinalização do Discordia.
//
// Ele NÃO carrega áudio nem vídeo: a mídia vai direto de um amigo pro outro
// (WebRTC ponto a ponto). O servidor só faz três coisas:
//   1. mantém as salas (quem está em qual sala, com qual nome e estado);
//   2. repassa as mensagens de negociação WebRTC (ofertas, respostas, ICE);
//   3. distribui o chat de texto da sala (com um histórico curto em memória);
//   4. guarda por pouco tempo (30 min) os arquivos mandados no chat.
//
// Opcionalmente serve a versão WEB do app (pasta WEB_DIR), pra quem quiser
// entrar pelo navegador sem baixar nada.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { createMusic, fetchMeta, searchYouTube } from './music.js';
import { createFileStore, FileError } from './files.js';

export const PROTOCOL = 1;

const MAX_PEERS_PER_ROOM = 12;
const MAX_NAME = 32;
const MAX_ROOM = 32;
const MAX_CHAT = 2000;
const HISTORY = 100;
// Cabe uma imagem do chat (já comprimida pelo app) com folga.
const MAX_MESSAGE_BYTES = 5 * 1024 * 1024;
const MAX_IMAGE_CHARS = 4_000_000; // ~3 MB de imagem em base64
const MAX_AVATAR_CHARS = 200_000; // ~150 KB (o app manda 256×256)
/** Só as N imagens mais recentes ficam no histórico (memória e banda de quem entra). */
const HISTORY_IMAGES = 20;
const IMAGE_RE = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/;
const HEARTBEAT_MS = 15_000;
// Balde de fichas por conexão: rajada curta passa, enxurrada não.
const RATE_BURST = 400;
const RATE_PER_SEC = 120;
const IMAGE_BURST = 4;
const IMAGE_PER_SEC = 0.25;
const MUSIC_BURST = 30;
const MUSIC_PER_SEC = 5;
const MAX_MUSIC_ADD = 200;
const CHAT_BURST = 8;
const CHAT_PER_SEC = 1;
const UPLOAD_BURST = 10;
const UPLOAD_PER_SEC = 0.2;
const FILE_ROUTE = /^\/files\/([A-Za-z0-9_-]{16,64})$/;
const UPLOAD_ROUTE = /^\/files\/upload\/([A-Za-z0-9_-]{16,64})$/;

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, PUT, GET, DELETE, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

/** Só os campos que os amigos precisam ver de um arquivo do chat. */
function publicFile(meta) {
  return { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, expiresAt: meta.expiresAt, url: `/files/${meta.id}` };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webp': 'image/webp',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
};

/** Normaliza o código da sala: minúsculas, letras/números/hífen. */
export function normalizeRoom(raw) {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .slice(0, MAX_ROOM);
}

export function normalizeName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .trim()
    .slice(0, MAX_NAME);
  return name || 'Anônimo';
}

/** Lê a configuração de ICE (STUN/TURN) das variáveis de ambiente. */
export function iceServersFor(peerId, env = process.env) {
  if (env.ICE_SERVERS) {
    try {
      return JSON.parse(env.ICE_SERVERS);
    } catch {
      console.warn('[ice] ICE_SERVERS não é JSON válido; usando o padrão');
    }
  }
  const servers = [
    { urls: (env.STUN_URLS || 'stun:stun.l.google.com:19302,stun:stun.cloudflare.com:3478').split(',') },
  ];
  const turnUrls = env.TURN_URLS ? env.TURN_URLS.split(',').map((u) => u.trim()).filter(Boolean) : [];
  if (turnUrls.length) {
    if (env.TURN_SECRET) {
      // Credencial temporária no padrão do coturn (use-auth-secret): ninguém
      // precisa de senha fixa e a credencial vence sozinha.
      const expires = Math.floor(Date.now() / 1000) + 12 * 3600;
      const username = `${expires}:${peerId}`;
      const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      servers.push({ urls: turnUrls, username, credential });
    } else if (env.TURN_USERNAME) {
      servers.push({ urls: turnUrls, username: env.TURN_USERNAME, credential: env.TURN_CREDENTIAL || '' });
    }
  }
  return servers;
}

function bucket(burst, perSec) {
  return { tokens: burst, burst, perSec, last: Date.now() };
}

function take(b) {
  const now = Date.now();
  b.tokens = Math.min(b.burst, b.tokens + ((now - b.last) / 1000) * b.perSec);
  b.last = now;
  if (b.tokens < 1) return false;
  b.tokens -= 1;
  return true;
}

export function sanitizeImage(raw, maxChars) {
  return typeof raw === 'string' && raw.length <= maxChars && IMAGE_RE.test(raw) ? raw : null;
}

function sanitizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    muted: !!s.muted,
    deafened: !!s.deafened,
    screen: typeof s.screen === 'string' && s.screen.length <= 128 ? s.screen : null,
    screenAudio: !!s.screenAudio,
  };
}

/** Mantém só as imagens mais recentes; as antigas viram "imagem expirada". */
function trimHistoryImages(history) {
  let seen = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    if (!history[i].image) continue;
    seen += 1;
    if (seen > HISTORY_IMAGES) history[i] = { ...history[i], image: null, expired: true };
  }
}

function serveStatic(webDir, req, res) {
  const url = new URL(req.url, 'http://x');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(webDir, rel));
  if (!file.startsWith(path.normalize(webDir))) {
    res.writeHead(403).end();
    return;
  }
  fs.stat(file, (err, st) => {
    const target = !err && st.isFile() ? file : path.join(webDir, 'index.html');
    fs.readFile(target, (err2, data) => {
      if (err2) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
        return;
      }
      const ext = path.extname(target);
      const cache = target.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache';
      res.writeHead(200, { 'content-type': MIME[ext] || 'application/octet-stream', 'cache-control': cache });
      res.end(data);
    });
  });
}

/**
 * Cria o servidor (HTTP + WebSocket). Não começa a escutar sozinho:
 * chame `listen(port)`.
 */
export function createDiscordiaServer({
  webDir = null,
  env = process.env,
  log = console.log,
  resolveMeta = env.MUSIC_META === 'off' ? null : fetchMeta,
} = {}) {
  const youtubeKey = env.YOUTUBE_API_KEY || '';
  /** @type {Map<string, {id: string, history: object[], peers: Map<string, object>}>} */
  const rooms = new Map();
  /** Todo mundo conectado, pelo id (o id é secreto: só o dono e a sala dele conhecem). */
  const peersById = new Map();
  /** Dono e sala de cada arquivo enviado. */
  const fileOwners = new Map();

  const files = createFileStore({
    dir: env.FILES_DIR || path.join(os.tmpdir(), `discordia-files-${process.pid}`),
    ttlMs: Number(env.FILE_TTL_MIN || 30) * 60_000,
    // O envio vai em partes de 8 MB, então o limite de 100 MB do Cloudflare não pesa.
    maxFileBytes: Number(env.MAX_FILE_MB || 2048) * 1024 * 1024,
    maxTotalBytes: Number(env.MAX_FILES_TOTAL_MB || 10240) * 1024 * 1024,
    chunkBytes: Number(env.FILE_CHUNK_MB || 8) * 1024 * 1024,
    onExpire(id) {
      const owner = fileOwners.get(id);
      fileOwners.delete(id);
      const room = owner && rooms.get(owner.roomId);
      if (!room) return;
      let found = false;
      room.history = room.history.map((m) => {
        if (m.file?.id !== id) return m;
        found = true;
        return { ...m, file: { ...m.file, expired: true } };
      });
      if (found) broadcast(room, { t: 'file-expired', id });
    },
  });

  function jsonReply(res, status, body) {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', ...CORS });
    res.end(JSON.stringify(body));
  }

  function fail(res, err) {
    const status = err instanceof FileError ? err.status : 500;
    if (status === 500) log('[arquivos] envio falhou', err.message);
    if (!res.headersSent && !res.destroyed) {
      jsonReply(res, status, { error: err instanceof FileError ? err.message : 'O envio falhou.', ...(err.extra ?? {}) });
    }
  }

  function readJson(req, max = 8192) {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > max) {
          req.destroy();
          reject(new FileError(413, 'Pedido grande demais.'));
        }
      });
      req.on('end', () => {
        try {
          resolve(JSON.parse(body || '{}'));
        } catch {
          reject(new FileError(400, 'Pedido inválido.'));
        }
      });
      req.on('error', reject);
    });
  }

  /** Quem está enviando cada arquivo (o dono pode reconectar no meio e trocar de id). */
  const uploadOwners = new Map();

  function peerFrom(url) {
    const peer = peersById.get(String(url.searchParams.get('peer') ?? ''));
    return peer?.room ? peer : null;
  }

  async function handleFiles(req, res, pathname) {
    const url = new URL(req.url, 'http://x');
    try {
      if (pathname === '/files/start' && req.method === 'POST') {
        const peer = peerFrom(url);
        if (!peer) throw new FileError(403, 'Entre numa sala pra mandar arquivos.');
        if (!take(peer.uploadRate)) throw new FileError(429, 'Calma! Muitos arquivos em pouco tempo.');
        const info = await readJson(req);
        const started = files.begin({ name: info.name, size: info.size, mime: info.mime });
        uploadOwners.set(started.upload, { peerId: peer.id, roomId: peer.room.id });
        jsonReply(res, 200, started);
        return;
      }
      const m = UPLOAD_ROUTE.exec(pathname);
      if (!m) throw new FileError(404, 'Não encontrado.');
      const uploadId = m[1];
      if (req.method === 'GET') {
        jsonReply(res, 200, files.status(uploadId));
        return;
      }
      if (req.method === 'DELETE') {
        files.abort(uploadId);
        uploadOwners.delete(uploadId);
        jsonReply(res, 200, { ok: true });
        return;
      }
      if (req.method === 'PUT') {
        const owner = uploadOwners.get(uploadId);
        // Reconectou no meio do envio: o arquivo passa a ser do id novo.
        const peer = peerFrom(url);
        if (owner && peer) Object.assign(owner, { peerId: peer.id, roomId: peer.room.id });
        const result = await files.part(req, uploadId, url.searchParams.get('offset'));
        if (result.done) {
          uploadOwners.delete(uploadId);
          if (owner) fileOwners.set(result.file.id, { ...owner, posted: false });
          result.file.ttlMs = files.ttlMs;
        }
        jsonReply(res, 200, result);
        return;
      }
      throw new FileError(405, 'Método não suportado.');
    } catch (err) {
      req.resume();
      fail(res, err);
    }
  }

  const httpServer = http.createServer((req, res) => {
    const pathname = req.url.split('?')[0];
    if (pathname.startsWith('/files/') && req.method === 'OPTIONS') {
      res.writeHead(204, CORS).end();
      return;
    }
    if (pathname === '/files/start' || UPLOAD_ROUTE.test(pathname)) {
      void handleFiles(req, res, pathname);
      return;
    }
    const fileMatch = FILE_ROUTE.exec(pathname);
    if (fileMatch && (req.method === 'GET' || req.method === 'HEAD')) {
      files.serve(req, res, fileMatch[1]);
      return;
    }
    if (req.url === '/health') {
      let peers = 0;
      for (const r of rooms.values()) peers += r.peers.size;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size, peers, files: files.files.size }));
      return;
    }
    if (webDir && fs.existsSync(webDir)) {
      serveStatic(webDir, req, res);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('Servidor Discordia no ar. Conecte pelo app.\n');
  });

  const wss = new WebSocketServer({ server: httpServer, maxPayload: MAX_MESSAGE_BYTES });

  function send(peer, msg) {
    if (peer.ws.readyState === peer.ws.OPEN) peer.ws.send(JSON.stringify(msg));
  }

  function broadcast(room, msg, exceptId = null) {
    const data = JSON.stringify(msg);
    for (const p of room.peers.values()) {
      if (p.id !== exceptId && p.ws.readyState === p.ws.OPEN) p.ws.send(data);
    }
  }

  function pushSystem(room, text) {
    const entry = { id: crypto.randomUUID(), from: 'system', name: 'Discordia', system: true, text, image: null, ts: Date.now() };
    room.history.push(entry);
    if (room.history.length > HISTORY) room.history.shift();
    broadcast(room, { t: 'chat', msg: entry });
  }

  function broadcastMusic(room) {
    broadcast(room, { t: 'music', state: room.music.toJSON() });
  }

  /** Busca título/canal dos vídeos novos em segundo plano e avisa a sala. */
  function resolveTitles(room, items) {
    if (!resolveMeta) {
      for (const i of items) room.music.markNoMeta(i.videoId);
      return;
    }
    const pending = [...new Set(items.filter((i) => !i.title).map((i) => i.videoId))];
    let changed = false;
    const flush = () => {
      if (!changed || !rooms.has(room.id)) return;
      changed = false;
      broadcastMusic(room);
    };
    const worker = async () => {
      while (pending.length) {
        const videoId = pending.shift();
        try {
          if (room.music.setMeta(videoId, await resolveMeta(videoId))) changed = true;
        } catch {
          // Sem título: a interface mostra um nome genérico; não trava a fila.
          if (room.music.markNoMeta(videoId)) changed = true;
        }
        if (pending.length % 10 === 0) flush();
      }
      flush();
    };
    for (let k = 0; k < 4; k++) void worker();
  }

  async function handleMusic(room, peer, msg) {
    const m = room.music;
    let changed = false;
    switch (msg.op) {
      case 'add': {
        const items = Array.isArray(msg.items) ? msg.items.slice(0, MAX_MUSIC_ADD) : [];
        const mode = ['end', 'next', 'now'].includes(msg.mode) ? msg.mode : 'end';
        const added = m.add(items, peer.name, mode);
        if (!added.length) return;
        changed = true;
        // Uma música só: espera um instante pelo título pra o aviso sair bonito.
        if (added.length === 1 && !added[0].title && resolveMeta) {
          try {
            const meta = await Promise.race([resolveMeta(added[0].videoId), new Promise((_, no) => setTimeout(no, 2000))]);
            m.setMeta(added[0].videoId, meta);
          } catch {
            // Sem título por enquanto; a busca em segundo plano tenta de novo.
          }
        }
        const label = added.length === 1 ? `“${added[0].title ?? 'um vídeo'}”` : `${added.length} músicas`;
        pushSystem(room, `🎵 ${peer.name} adicionou ${label}${mode === 'next' ? ' pra tocar a seguir' : mode === 'now' ? ' e tocou agora' : ' à fila'}.`);
        resolveTitles(room, added);
        break;
      }
      case 'play':
        changed = m.play();
        break;
      case 'pause':
        changed = m.pause();
        break;
      case 'seek':
        changed = m.seek(Number(msg.position));
        break;
      case 'skip': {
        const before = m.current();
        changed = m.skip();
        if (changed && before) pushSystem(room, `⏭️ ${peer.name} pulou “${before.title ?? 'a música'}”.`);
        break;
      }
      case 'prev':
        changed = m.prev();
        break;
      case 'jump':
        changed = m.jump(String(msg.id));
        break;
      case 'remove':
        changed = m.remove(String(msg.id));
        break;
      case 'move':
        changed = m.move(String(msg.id), Number(msg.to));
        break;
      case 'shuffle':
        changed = m.shuffle();
        break;
      case 'clear':
        changed = m.clear();
        if (changed) pushSystem(room, `⏹️ ${peer.name} limpou a fila de música.`);
        break;
      case 'loop':
        changed = m.setLoop(msg.mode);
        break;
      case 'ended':
        changed = m.ended(String(msg.id));
        break;
      case 'error':
        changed = m.failed(String(msg.id));
        break;
      case 'duration':
        changed = m.setDuration(String(msg.id), Number(msg.seconds));
        break;
      case 'search': {
        const q = String(msg.q ?? '').trim().slice(0, 120);
        if (!q) return;
        if (!youtubeKey) {
          send(peer, { t: 'music-search', q, results: [], error: 'Busca por nome não configurada no servidor.' });
          return;
        }
        try {
          send(peer, { t: 'music-search', q, results: await searchYouTube(q, youtubeKey) });
        } catch (err) {
          log('[música] busca falhou', err.message);
          send(peer, { t: 'music-search', q, results: [], error: 'A busca falhou. Tente colar o link.' });
        }
        return;
      }
      default:
        return;
    }
    if (changed) broadcastMusic(room);
  }

  function publicPeer(p) {
    return { id: p.id, name: p.name, avatar: p.avatar, state: p.state };
  }

  function leaveRoom(peer) {
    const room = peer.room;
    if (!room) return;
    room.peers.delete(peer.id);
    peer.room = null;
    broadcast(room, { t: 'peer-left', id: peer.id });
    if (room.peers.size === 0) rooms.delete(room.id);
    log(`[sala ${room.id}] ${peer.name} saiu (${room.peers.size} na sala)`);
  }

  wss.on('connection', (ws) => {
    const peer = {
      id: crypto.randomUUID(),
      ws,
      name: 'Anônimo',
      avatar: null,
      room: null,
      state: sanitizeState(null),
      alive: true,
      rate: bucket(RATE_BURST, RATE_PER_SEC),
      chatRate: bucket(CHAT_BURST, CHAT_PER_SEC),
      musicRate: bucket(MUSIC_BURST, MUSIC_PER_SEC),
      imageRate: bucket(IMAGE_BURST, IMAGE_PER_SEC),
      uploadRate: bucket(UPLOAD_BURST, UPLOAD_PER_SEC),
    };
    peersById.set(peer.id, peer);

    ws.on('pong', () => {
      peer.alive = true;
    });

    ws.on('message', (raw) => {
      if (!take(peer.rate)) return;
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!msg || typeof msg !== 'object') return;

      switch (msg.t) {
        case 'join': {
          if (peer.room) leaveRoom(peer);
          const roomId = normalizeRoom(msg.room);
          if (!roomId) {
            send(peer, { t: 'error', code: 'bad-room', message: 'Código de sala inválido.' });
            return;
          }
          let room = rooms.get(roomId);
          if (room && room.peers.size >= MAX_PEERS_PER_ROOM) {
            send(peer, { t: 'error', code: 'room-full', message: `A sala está cheia (máximo ${MAX_PEERS_PER_ROOM}).` });
            return;
          }
          if (!room) {
            room = { id: roomId, history: [], peers: new Map(), music: createMusic(), musicTimer: null };
            rooms.set(roomId, room);
          }
          peer.name = normalizeName(msg.name);
          peer.avatar = sanitizeImage(msg.avatar, MAX_AVATAR_CHARS);
          peer.state = sanitizeState(msg.state);
          send(peer, {
            t: 'welcome',
            protocol: PROTOCOL,
            id: peer.id,
            room: roomId,
            peers: [...room.peers.values()].map(publicPeer),
            history: room.history,
            iceServers: iceServersFor(peer.id, env),
            serverNow: Date.now(),
            music: room.music.toJSON(),
            features: { search: !!youtubeKey, files: { maxBytes: files.maxFileBytes, ttlMs: files.ttlMs, chunkBytes: files.chunkBytes } },
          });
          room.peers.set(peer.id, peer);
          peer.room = room;
          broadcast(room, { t: 'peer-joined', peer: publicPeer(peer) }, peer.id);
          log(`[sala ${roomId}] ${peer.name} entrou (${room.peers.size} na sala)`);
          return;
        }
        case 'signal': {
          const room = peer.room;
          if (!room || typeof msg.to !== 'string') return;
          const target = room.peers.get(msg.to);
          if (target) send(target, { t: 'signal', from: peer.id, data: msg.data });
          return;
        }
        case 'state': {
          if (!peer.room) return;
          peer.state = sanitizeState(msg.state);
          broadcast(peer.room, { t: 'state', id: peer.id, state: peer.state }, peer.id);
          return;
        }
        case 'chat': {
          const room = peer.room;
          if (!room) return;
          const text = String(msg.text ?? '').trim().slice(0, MAX_CHAT);
          const image = msg.image == null ? null : sanitizeImage(msg.image, MAX_IMAGE_CHARS);
          if (msg.image != null && !image) {
            send(peer, { t: 'error', code: 'bad-image', message: 'Imagem inválida ou grande demais.' });
            return;
          }
          // Arquivo já enviado por HTTP: só o dono anuncia, uma vez, na própria sala.
          let file = null;
          if (msg.file != null) {
            const id = String(msg.file);
            const owner = fileOwners.get(id);
            const meta = files.files.get(id);
            if (!owner || !meta || owner.peerId !== peer.id || owner.roomId !== room.id || owner.posted) {
              send(peer, { t: 'error', code: 'bad-file', message: 'Esse arquivo não está mais disponível.' });
              return;
            }
            owner.posted = true;
            file = publicFile(meta);
          }
          if (!text && !image && !file) return;
          if ((!file && !take(peer.chatRate)) || (image && !take(peer.imageRate))) {
            send(peer, { t: 'error', code: 'slow-down', message: 'Calma! Você está mandando mensagens rápido demais.' });
            return;
          }
          const entry = { id: crypto.randomUUID(), from: peer.id, name: peer.name, text, image, file, ts: Date.now() };
          room.history.push(entry);
          if (room.history.length > HISTORY) room.history.shift();
          trimHistoryImages(room.history);
          broadcast(room, { t: 'chat', msg: entry });
          return;
        }
        case 'profile': {
          if (!peer.room) return;
          peer.name = normalizeName(msg.name ?? peer.name);
          if ('avatar' in msg) peer.avatar = sanitizeImage(msg.avatar, MAX_AVATAR_CHARS);
          broadcast(peer.room, { t: 'profile', id: peer.id, name: peer.name, avatar: peer.avatar }, peer.id);
          return;
        }
        case 'music': {
          const room = peer.room;
          if (!room || !take(peer.musicRate)) return;
          handleMusic(room, peer, msg);
          return;
        }
        case 'leave':
          leaveRoom(peer);
          return;
        case 'ping':
          send(peer, { t: 'pong', ts: msg.ts, now: Date.now() });
          return;
        default:
          return;
      }
    });

    ws.on('close', () => {
      leaveRoom(peer);
      peersById.delete(peer.id);
    });
    ws.on('error', () => {});
    ws.peer = peer;
  });

  // Conexão que caiu sem avisar (Wi-Fi sumiu, PC hibernou) sai da sala.
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const peer = ws.peer;
      if (!peer) continue;
      if (!peer.alive) {
        ws.terminate();
        continue;
      }
      peer.alive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);

  return {
    httpServer,
    rooms,
    files,
    listen(port, host) {
      return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address())));
    },
    close() {
      clearInterval(heartbeat);
      files.close();
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}
