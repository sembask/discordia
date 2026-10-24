// Prepara imagens antes de mandar: reduz e comprime no próprio PC, pra
// chegar rápido nos amigos sem perder qualidade visível.

/** Limite depois de comprimir (o servidor aceita até ~3 MB). */
export const MAX_IMAGE_CHARS = 2_800_000;
const MAX_SIDE = 2048;
const AVATAR_SIDE = 256;

function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

function canvasOf(width: number, height: number) {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

/** Imagem do chat: até 2048 px no maior lado, WebP. GIF animado vai como está. */
export async function prepareChatImage(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Isso não é uma imagem.');
  if (file.type === 'image/gif') {
    const url = await readAsDataUrl(file);
    if (url.length <= MAX_IMAGE_CHARS) return url;
  }
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const { canvas, ctx } = canvasOf(w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  for (const quality of [0.9, 0.82, 0.72, 0.6, 0.45]) {
    const url = canvas.toDataURL('image/webp', quality);
    if (url.length <= MAX_IMAGE_CHARS) return url;
  }
  throw new Error('Imagem grande demais, mesmo comprimida.');
}

/** Foto de perfil: recorte quadrado no centro, 256×256. */
export async function prepareAvatar(file: Blob): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('Isso não é uma imagem.');
  const bitmap = await createImageBitmap(file);
  const side = Math.min(bitmap.width, bitmap.height);
  const sx = (bitmap.width - side) / 2;
  const sy = (bitmap.height - side) / 2;
  const { canvas, ctx } = canvasOf(AVATAR_SIDE, AVATAR_SIDE);
  ctx.drawImage(bitmap, sx, sy, side, side, 0, 0, AVATAR_SIDE, AVATAR_SIDE);
  bitmap.close();
  return canvas.toDataURL('image/webp', 0.85);
}

/** Abre o seletor de arquivo do sistema e devolve a imagem escolhida. */
export function pickImageFile(): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/** Abre o seletor de arquivos (qualquer tipo, vários de uma vez). */
export function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.oncancel = () => resolve([]);
    input.click();
  });
}
