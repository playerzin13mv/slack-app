// Bundles the renderer (browser) and the server (Node) with esbuild.
// Usage: node scripts/build.mjs <renderer|server> [--watch]
import { build, context } from 'esbuild';
import { copyFileSync, mkdirSync } from 'node:fs';

const target = process.argv[2];
const watch = process.argv.includes('--watch');
const production = process.env.NODE_ENV === 'production';

const configs = {
  renderer: {
    entryPoints: ['src/renderer/main.ts'],
    outdir: 'dist/renderer',
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    sourcemap: true,
    minify: production,
    logLevel: 'info',
    plugins: [
      {
        name: 'copy-html',
        setup(b) {
          b.onEnd(() => {
            mkdirSync('dist/renderer', { recursive: true });
            copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
            copyFileSync('build/icon.svg', 'dist/renderer/logo.svg');
          });
        }
      }
    ]
  },
  server: {
    entryPoints: ['server/src/index.ts'],
    outfile: 'dist/server/index.js',
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node20',
    sourcemap: true,
    external: ['bufferutil', 'utf-8-validate'],
    logLevel: 'info'
  }
};

const config = configs[target];
if (!config) {
  console.error('Usage: node scripts/build.mjs <renderer|server> [--watch]');
  process.exit(1);
}

if (watch) {
  const ctx = await context(config);
  await ctx.watch();
} else {
  await build(config);
}
