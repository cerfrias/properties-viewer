const esbuild = require('esbuild');

const production = process.argv.includes('--production');
const watch = process.argv.includes('--watch');

const watchPlugin = {
  name: 'watch-plugin',
  setup(build) {
    build.onStart(() => {
      console.log('[watch] build started');
    });
    build.onEnd((result) => {
      if (result.errors.length > 0) {
        console.error('[watch] build failed');
      } else {
        console.log('[watch] build finished');
      }
    });
  },
};

/** @type {import('esbuild').BuildOptions} */
const extensionConfig = {
  entryPoints: ['./src/extension.ts'],
  bundle: true,
  outfile: './dist/extension.js',
  external: ['vscode'],
  format: 'cjs',
  platform: 'node',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  loader: { '.html': 'text' },
  plugins: [watchPlugin],
};

/** @type {import('esbuild').BuildOptions} */
const webviewConfig = {
  entryPoints: ['./src/webview/main.ts'],
  bundle: true,
  outfile: './dist/webview.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2022',
  sourcemap: !production,
  minify: production,
  plugins: [watchPlugin],
};

async function build() {
  if (watch) {
    const extCtx = await esbuild.context(extensionConfig);
    const webviewCtx = await esbuild.context(webviewConfig);
    await Promise.all([extCtx.watch(), webviewCtx.watch()]);
  } else {
    await Promise.all([
      esbuild.build(extensionConfig),
      esbuild.build(webviewConfig)
    ]);
  }
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});