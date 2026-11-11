import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { createMockApi } from './mock-server/api';

// Serves the mock backend at /api in `vite` and `vite preview`, unless VITE_API_BASE_URL
// points at a real one. MOCK_API_FILE / MOCK_API_SPEED let tests use their own store.
function mockApi(): Plugin {
  const handler = () => createMockApi({
    file: resolve(process.env.MOCK_API_FILE ?? '.data/songs.json'),
    speed: process.env.MOCK_API_SPEED ? Number(process.env.MOCK_API_SPEED) : 1,
  });
  return {
    name: 'rythm-mock-api',
    configureServer(server) {
      if (!process.env.VITE_API_BASE_URL) server.middlewares.use(handler());
    },
    configurePreviewServer(server) {
      if (!process.env.VITE_API_BASE_URL) server.middlewares.use(handler());
    },
  };
}

export default defineConfig(({ mode }) => {
  // The mock server's own secrets (not VITE_*, so they never reach the app): .env.local etc.
  const env = loadEnv(mode, process.cwd(), '');
  for (const k of ['YOUTUBE_API_KEY']) if (env[k] && !process.env[k]) process.env[k] = env[k];
  return config;
});

const config = {
  plugins: [react(), mockApi()],
  server: { port: 5173 },
  // Main chunk ≈ 1 MB (React, Tone.js, Rive, Motion; ~280 kB gzipped). three.js is split out and lazy.
  build: { chunkSizeWarningLimit: 1100 },
  // Workers as ES modules, so they can split: the stage worker loads its WebGPU materials
  // (src/stage/gpu.ts) only when /demo's version B asks for them.
  worker: { format: 'es' as const },
  // ONNX Runtime (the mapping worker's models: src/mapping/ort.ts) finds its WebAssembly relative
  // to itself; Vite's dependency pre-bundling would move it.
  optimizeDeps: { exclude: ['onnxruntime-web'] },
  preview: { port: 4173 },
};
