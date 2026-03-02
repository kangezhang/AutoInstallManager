import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/index.ts'],
  format: ['cjs'],
  dts: true,
  clean: true,
  external: ['electron'],
  platform: 'node',
  target: 'node18',
});
