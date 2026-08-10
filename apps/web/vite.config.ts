import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const packageVersion = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'))
  .version as string;

export default defineConfig({
  plugins: [react()],
  define: {
    __DDNS_APP_VERSION__: JSON.stringify(process.env.APP_VERSION || packageVersion)
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: 'http://localhost:8090', changeOrigin: true } }
  }
});
