import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createDiscordiaServer } from './server.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || '0.0.0.0';
const webDir = process.env.WEB_DIR || path.join(here, 'public');

const server = createDiscordiaServer({ webDir });
const addr = await server.listen(port, host);
console.log(`[discordia] servidor escutando em ${addr.address}:${addr.port}`);
if (!process.env.TURN_URLS) {
  console.log('[discordia] sem TURN configurado: amigos atrás de NAT muito restrito podem não conectar (veja o README).');
}

for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => {
    await server.close();
    process.exit(0);
  });
}
