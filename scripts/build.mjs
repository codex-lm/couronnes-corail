import { build } from 'esbuild';
import { readFile, writeFile } from 'node:fs/promises';

const result = await build({
  entryPoints: ['src/ui/app.js'],
  bundle: true,
  format: 'iife',
  target: 'es2022',
  minify: true,
  legalComments: 'none',
  write: false
});
const [template, styles, favicon] = await Promise.all([
  readFile('src/ui/index.template.html', 'utf8'),
  readFile('src/ui/styles.css', 'utf8'),
  readFile('art/favicon.png')
]);
const script = result.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const html = template
  .replace('<!-- INLINE_STYLES -->', () => `<style>${styles}</style>`)
  .replace('<!-- INLINE_SCRIPT -->', () => `<script>${script}</script>`)
  .replaceAll('__FAVICON_BASE64__', favicon.toString('base64'));
await writeFile('index.html', html);
console.log(`Built self-contained index.html (${Buffer.byteLength(html)} bytes)`);
