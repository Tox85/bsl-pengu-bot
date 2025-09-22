import { defineConfig } from 'tsup'

export default defineConfig({
  entry: [
    'src/index.ts', 
    'src/cli/run.ts',
    'src/cli/bybit-withdraw-hub.ts',
    'src/cli/distribute-from-hub.ts',
    'src/cli/bridge-wallet.ts',
    'src/cli/run-wallet.ts',
    'src/cli/run-multi.ts',
    'src/cli/status.ts',
    'src/cli/reset-wallet.ts',
    'src/cli/generate-report.ts'
  ],
  format: ['esm'],
  dts: false,
  splitting: false,
  sourcemap: true,
  clean: true,
  minify: false,
  target: 'es2022',
  outDir: 'dist',
  external: ['sql.js']
})
