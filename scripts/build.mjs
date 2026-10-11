import { build } from 'esbuild';
import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist', { recursive: true });
await build({ entryPoints: ['src/ui/app.jsx'], bundle: true, outfile: 'dist/app.js', platform: 'browser', sourcemap: false, define: { 'process.env.NODE_ENV': '"production"' } });
await copyFile('src/ui/index.html', 'dist/index.html');
