// Transferência de arquivos do chat.
//
// Quem envia sobe o arquivo UMA vez pro servidor; cada amigo baixa de lá.
//
// O envio é em PARTES pequenas (8 MB): o Cloudflare recusa requisições acima
// de 100 MB e corta as que passam de 100 s, então nenhuma parte chega perto
// disso. Se a internet cair no meio, o app pergunta onde parou e continua.
// Os arquivos são temporários: somem sozinhos depois de `ttlMs` (30 min por
// padrão), então o servidor nunca acumula nada.
//
// Segurança:
//   - o id do arquivo é aleatório (impossível de adivinhar);
//   - só tipos "inofensivos" (imagem, vídeo, áudio, PDF, texto puro) abrem no
//     navegador; o resto é sempre forçado a download — um .html enviado por
//     alguém nunca roda como página do site;
//   - cabeçalhos nosniff + CSP sandbox em toda resposta de arquivo.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const INLINE_TYPES = /^(image\/(png|jpeg|gif|webp|avif)|video\/(mp4|webm|ogg|quicktime)|audio\/[a-z0-9.+-]+|application\/pdf|text\/plain)$/i;
const MAX_NAME = 200;

export class FileError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

function formatMb(bytes) {
  const mb = bytes / 1024 / 1024;
  return mb >= 1024 ? `${(mb / 1024).toFixed(mb % 1024 ? 1 : 0).replace('.', ',')} GB` : `${Math.round(mb)} MB`;
}

export function cleanFileName(raw) {
  const name = String(raw ?? '')
    .replace(/[\u0000-\u001f\u007f/\\]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, MAX_NAME);
  return name || 'arquivo';
}

function cleanMime(raw) {
  const mime = String(raw ?? '').split(';')[0].trim().toLowerCase();
  return /^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mime) ? mime : 'application/octet-stream';
}

export function createFileStore({
  dir,
  ttlMs = 30 * 60_000,
  maxFileBytes = 2 * 1024 * 1024 * 1024,
  maxTotalBytes = 10 * 1024 * 1024 * 1024,
  chunkBytes = 8 * 1024 * 1024,
  /** Envio parado há mais que isso é jogado fora (quem mandou sumiu). */
  stallMs = 10 * 60_000,
  onExpire = () => {},
  now = Date.now,
}) {
  /** @type {Map<string, {id, name, size, mime, path, expiresAt, timer}>} */
  const files = new Map();
  /** Envios em andamento. */
  const uploads = new Map();
  let reserved = 0; // bytes em uso + uploads em andamento

  function touch(up) {
    clearTimeout(up.timer);
    up.timer = setTimeout(() => dropUpload(up.id), stallMs);
    up.timer.unref?.();
  }

  function dropUpload(id) {
    const up = uploads.get(id);
    if (!up) return;
    uploads.delete(id);
    clearTimeout(up.timer);
    reserved -= up.size;
    fsp.rm(up.path, { force: true }).catch(() => {});
  }

  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  function remove(id, expired) {
    const f = files.get(id);
    if (!f) return;
    files.delete(id);
    clearTimeout(f.timer);
    reserved -= f.size;
    fsp.rm(f.path, { force: true }).catch(() => {});
    if (expired) onExpire(id);
  }

  return {
    files,
    ttlMs,
    maxFileBytes,

    chunkBytes,

    /**
     * Começa um envio em partes. Reserva o espaço já, pra ninguém descobrir só
     * no fim que o servidor estava cheio.
     */
    begin({ name, size, mime }) {
      const total = Number(size);
      if (!Number.isSafeInteger(total) || total <= 0) throw new FileError(400, 'Tamanho do arquivo inválido.');
      if (total > maxFileBytes) {
        throw new FileError(413, `Arquivo grande demais (máximo ${formatMb(maxFileBytes)}).`);
      }
      if (reserved + total > maxTotalBytes) throw new FileError(507, 'O servidor está cheio de arquivos agora. Tente daqui a pouco.');
      reserved += total;
      const id = crypto.randomBytes(18).toString('base64url');
      const up = {
        id,
        name: cleanFileName(name),
        mime: cleanMime(mime),
        size: total,
        received: 0,
        path: path.join(dir, `${id}.part`),
        busy: false,
        timer: null,
      };
      fs.writeFileSync(up.path, '');
      uploads.set(id, up);
      touch(up);
      return { upload: id, chunkBytes };
    },

    /** Posição em que o envio parou (pra continuar depois de cair). */
    status(uploadId) {
      const up = uploads.get(uploadId);
      if (!up) throw new FileError(404, 'Esse envio não existe mais. Mande o arquivo de novo.');
      return { received: up.received, size: up.size };
    },

    /**
     * Recebe UMA parte, que tem que começar exatamente onde a anterior parou.
     * Devolve { received } ou, na última parte, { done: true, file }.
     */
    async part(req, uploadId, offset) {
      const up = uploads.get(uploadId);
      if (!up) throw new FileError(404, 'Esse envio não existe mais. Mande o arquivo de novo.');
      if (up.busy) throw new FileError(409, 'Essa parte já está sendo recebida.', { received: up.received });
      if (Number(offset) !== up.received) throw new FileError(409, 'Parte fora de ordem.', { received: up.received });
      const declared = Number(req.headers['content-length']);
      const left = up.size - up.received;
      if (!Number.isFinite(declared) || declared <= 0) throw new FileError(411, 'Tamanho da parte não informado.');
      if (declared > chunkBytes || declared > left) throw new FileError(400, 'Parte maior que o permitido.');

      up.busy = true;
      clearTimeout(up.timer);
      let got = 0;
      try {
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(up.path, { flags: 'r+', start: up.received });
          req.on('data', (chunk) => {
            got += chunk.length;
            if (got > declared) {
              req.destroy();
              reject(new FileError(400, 'A parte veio maior que o anunciado.'));
            }
          });
          req.on('close', () => {
            if (!req.complete) reject(new FileError(499, 'Envio interrompido.'));
          });
          req.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          req.pipe(out);
        });
        if (got !== declared) throw new FileError(400, 'A parte veio incompleta.');
        up.received += got;
      } catch (err) {
        // Volta pro último ponto bom: a parte inteira é reenviada.
        await fsp.truncate(up.path, up.received).catch(() => {});
        throw err;
      } finally {
        up.busy = false;
        if (uploads.has(up.id)) touch(up);
      }

      if (up.received < up.size) return { received: up.received };

      uploads.delete(up.id);
      clearTimeout(up.timer);
      const finalPath = path.join(dir, up.id);
      await fsp.rename(up.path, finalPath);
      const meta = {
        id: up.id,
        name: up.name,
        size: up.size,
        mime: up.mime,
        path: finalPath,
        expiresAt: now() + ttlMs,
        timer: null,
      };
      meta.timer = setTimeout(() => remove(meta.id, true), ttlMs);
      meta.timer.unref?.();
      files.set(meta.id, meta);
      return { done: true, received: up.size, file: { id: meta.id, name: meta.name, size: meta.size, mime: meta.mime, expiresAt: meta.expiresAt } };
    },

    /** Desiste de um envio no meio (botão cancelar). */
    abort(uploadId) {
      dropUpload(uploadId);
    },

    /** Entrega um arquivo (com suporte a Range, pra vídeo poder avançar). */
    serve(req, res, id) {
      const f = files.get(id);
      if (!f) {
        res.writeHead(410, { 'content-type': 'text/plain; charset=utf-8' }).end('Este arquivo expirou ou não existe.');
        return;
      }
      const inline = INLINE_TYPES.test(f.mime) && !('download' in Object.fromEntries(new URL(req.url, 'http://x').searchParams));
      const headers = {
        'content-type': inline ? f.mime : 'application/octet-stream',
        'content-disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        'x-content-type-options': 'nosniff',
        'content-security-policy': "sandbox; default-src 'none'; img-src 'self'; media-src 'self'",
        'cache-control': 'private, max-age=1800',
        'accept-ranges': 'bytes',
        'access-control-allow-origin': '*',
      };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? '');
      let start = 0;
      let end = f.size - 1;
      if (range && (range[1] || range[2])) {
        if (range[1]) start = Number(range[1]);
        if (range[2]) end = range[1] ? Math.min(Number(range[2]), end) : end;
        if (!range[1]) start = Math.max(0, f.size - Number(range[2]));
        if (start > end || start >= f.size) {
          res.writeHead(416, { 'content-range': `bytes */${f.size}` }).end();
          return;
        }
        res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${f.size}`, 'content-length': end - start + 1 });
      } else {
        res.writeHead(200, { ...headers, 'content-length': f.size });
      }
      if (req.method === 'HEAD') {
        res.end();
        return;
      }
      fs.createReadStream(f.path, { start, end }).on('error', () => res.destroy()).pipe(res);
    },

    uploads,

    close() {
      for (const id of [...uploads.keys()]) dropUpload(id);
      for (const id of [...files.keys()]) remove(id, false);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
