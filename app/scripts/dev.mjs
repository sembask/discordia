// `npm run dev`: sobe o Vite (interface com recarga instantânea) e abre o
// Electron apontando pra ele.
import { spawn } from 'node:child_process';
import { createServer } from 'vite';
import electron from 'electron';

const vite = await createServer();
await vite.listen();
const url = vite.resolvedUrls.local[0];
console.log(`[dev] interface em ${url}`);

const child = spawn(electron, ['.'], {
  stdio: 'inherit',
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
});

child.on('close', async (code) => {
  await vite.close();
  process.exit(code ?? 0);
});
