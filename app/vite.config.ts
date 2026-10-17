import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// A CSP vai só no build: em dev o React Refresh injeta um script inline.
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; " +
  "media-src 'self' blob: mediastream:; font-src 'self' data:; connect-src 'self' ws: wss: http: https:";

function cspInBuild() {
  return {
    name: 'discordia-csp',
    apply: 'build' as const,
    transformIndexHtml(html: string) {
      return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`);
    },
  };
}

// `base: './'` porque o Electron abre o build por file:// (caminho relativo).
export default defineConfig({
  base: './',
  plugins: [react(), tailwindcss(), cspInBuild()],
  server: {
    port: 5173,
    strictPort: true,
    // No navegador (npm run web) o app fala com o servidor local por /ws.
    proxy: {
      '/ws': { target: 'ws://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome130',
  },
});
