import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  worker: { format: 'es' },
  build: { chunkSizeWarningLimit: 2500 },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
});
