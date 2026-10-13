import { defineConfig } from 'vite';
// 5173 is often taken by other dev servers on this machine; pin a free one.
// Each mode is its own chunk (see src/main.ts). three.js alone is ~700 kB minified and is
// shared by both, so the warning limit sits just above it rather than at Vite's 500 kB.
export default defineConfig({
  server: { port: 5188, strictPort: false, open: false },
  build: { chunkSizeWarningLimit: 900 },
});
