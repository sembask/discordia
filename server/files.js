// Transferência de arquivos do chat.
//
// Quem envia sobe o arquivo UMA vez pro servidor; cada amigo baixa de lá.
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
  constructor(status, message) {
    super(message);
    this.status = status;
  }
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
  maxFileBytes = 1024 * 1024 * 1024,
  maxTotalBytes = 10 * 1024 * 1024 * 1024,
  onExpire = () => {},
  now = Date.now,
}) {
  /** @type {Map<string, {id, name, size, mime, path, expiresAt, timer}>} */
  const files = new Map();
  let reserved = 0; // bytes em uso + uploads em andamento

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

    /** Recebe o corpo da requisição e guarda no disco. */
    async accept(req, { name, mime }) {
      const declared = Number(req.headers['content-length']);
      if (!Number.isFinite(declared) || declared <= 0) throw new FileError(411, 'Tamanho do arquivo não informado.');
      if (declared > maxFileBytes) {
        throw new FileError(413, `Arquivo grande demais (máximo ${Math.round(maxFileBytes / 1024 / 1024)} MB).`);
      }
      if (reserved + declared > maxTotalBytes) throw new FileError(507, 'O servidor está cheio de arquivos agora. Tente daqui a pouco.');

      reserved += declared;
      const id = crypto.randomBytes(18).toString('base64url');
      const file = path.join(dir, id);
      let received = 0;
      try {
        await new Promise((resolve, reject) => {
          const out = fs.createWriteStream(file, { flags: 'wx' });
          req.on('data', (chunk) => {
            received += chunk.length;
            if (received > declared) {
              req.destroy();
              reject(new FileError(400, 'O arquivo veio maior que o anunciado.'));
            }
          });
          req.on('close', () => {
            if (!req.complete) reject(new FileError(499, 'Envio cancelado.'));
          });
          req.on('error', reject);
          out.on('error', reject);
          out.on('finish', resolve);
          req.pipe(out);
        });
        if (received !== declared) throw new FileError(400, 'O envio foi interrompido.');
      } catch (err) {
        reserved -= declared;
        await fsp.rm(file, { force: true }).catch(() => {});
        throw err;
      }

      const meta = {
        id,
        name: cleanFileName(name),
        size: received,
        mime: cleanMime(mime),
        path: file,
        expiresAt: now() + ttlMs,
        timer: null,
      };
      meta.timer = setTimeout(() => remove(id, true), ttlMs);
      meta.timer.unref?.();
      files.set(id, meta);
      return { id, name: meta.name, size: meta.size, mime: meta.mime, expiresAt: meta.expiresAt };
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

    close() {
      for (const id of [...files.keys()]) remove(id, false);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
