import { defineConfig } from 'tsdown';

export default defineConfig({
  entry: ['src/index.ts'],
  format: 'esm',
  platform: 'node',
  target: 'node24.12',
  outDir: 'dist',
  fixedExtension: true,
  dts: false,
  sourcemap: true,
  clean: true,
  // Bundle everything except `dependencies` (native modules); see package.json.
  deps: { onlyBundle: false },
});
