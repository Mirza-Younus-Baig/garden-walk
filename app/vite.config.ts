import { defineConfig } from 'vite';
// 5173 is often taken by other dev servers on this machine; pin a free one.
export default defineConfig({ server: { port: 5188, strictPort: false, open: false } });
