// Servidor de sinalização do Discordia.
//
// Ele NÃO carrega áudio nem vídeo: a mídia vai direto de um amigo pro outro
// (WebRTC ponto a ponto). O servidor só faz três coisas:
//   1. mantém as salas (quem está em qual sala, com qual nome e estado);
//   2. repassa as mensagens de negociação WebRTC (ofertas, respostas, ICE);
//   3. distribui o chat de texto da sala (com um histórico curto em memória).
//
// Opcionalmente serve a versão WEB do app (pasta WEB_DIR), pra quem quiser
// entrar pelo navegador sem baixar nada.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';

export const PROTOCOL = 1;

const MAX_PEERS_PER_ROOM = 12;
const MAX_NAME = 32;
const MAX_ROOM = 32;
const MAX_CHAT = 2000;
const HISTORY = 100;
const MAX_MESSAGE_BYTES = 256 * 1024; // SDP com muitos codecs passa de 10 KB; folga larga.
const HEARTBEAT_MS = 15_000;
// Balde de fichas por conexão: rajada curta passa, enxurrada não.
const RATE_BURST = 400;
const RATE_PER_SEC = 120;
const CHAT_BURST = 8;
const CHAT_PER_SEC = 1;

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

function sanitizeState(raw) {
  const s = raw && typeof raw === 'object' ? raw : {};
  return {
    muted: !!s.muted,
    deafened: !!s.deafened,
    screen: typeof s.screen === 'string' && s.screen.length <= 128 ? s.screen : null,
    screenAudio: !!s.screenAudio,
  };
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
export function createDiscordiaServer({ webDir = null, env = process.env, log = console.log } = {}) {
  /** @type {Map<string, {id: string, history: object[], peers: Map<string, object>}>} */
  const rooms = new Map();

  const httpServer = http.createServer((req, res) => {
    if (req.url === '/health') {
      let peers = 0;
      for (const r of rooms.values()) peers += r.peers.size;
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, protocol: PROTOCOL, rooms: rooms.size, peers }));
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

  function publicPeer(p) {
    return { id: p.id, name: p.name, state: p.state };
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
      room: null,
      state: sanitizeState(null),
      alive: true,
      rate: bucket(RATE_BURST, RATE_PER_SEC),
      chatRate: bucket(CHAT_BURST, CHAT_PER_SEC),
    };

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
            room = { id: roomId, history: [], peers: new Map() };
            rooms.set(roomId, room);
          }
          peer.name = normalizeName(msg.name);
          peer.state = sanitizeState(msg.state);
          send(peer, {
            t: 'welcome',
            protocol: PROTOCOL,
            id: peer.id,
            room: roomId,
            peers: [...room.peers.values()].map(publicPeer),
            history: room.history,
            iceServers: iceServersFor(peer.id, env),
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
          if (!text) return;
          if (!take(peer.chatRate)) {
            send(peer, { t: 'error', code: 'slow-down', message: 'Calma! Você está mandando mensagens rápido demais.' });
            return;
          }
          const entry = { id: crypto.randomUUID(), from: peer.id, name: peer.name, text, ts: Date.now() };
          room.history.push(entry);
          if (room.history.length > HISTORY) room.history.shift();
          broadcast(room, { t: 'chat', msg: entry });
          return;
        }
        case 'leave':
          leaveRoom(peer);
          return;
        case 'ping':
          send(peer, { t: 'pong', ts: msg.ts });
          return;
        default:
          return;
      }
    });

    ws.on('close', () => leaveRoom(peer));
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
    listen(port, host) {
      return new Promise((resolve) => httpServer.listen(port, host, () => resolve(httpServer.address())));
    },
    close() {
      clearInterval(heartbeat);
      for (const ws of wss.clients) ws.terminate();
      wss.close();
      return new Promise((resolve) => httpServer.close(() => resolve()));
    },
  };
}
