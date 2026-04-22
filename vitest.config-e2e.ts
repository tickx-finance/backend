import path from 'path';
import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['src/test/setup-e2e.ts'],
    fileParallelism: false,
    globals: true,
    alias: {
      src: path.resolve(__dirname, './src'),
    },
    root: '.',
  },
  resolve: {
    alias: {
      src: path.resolve(__dirname, './src'),
    },
  },
  plugins: [swc.vite()],
});
