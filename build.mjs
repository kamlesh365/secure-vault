/**
 * Bundles index.html + css/styles.css + js/app.js into a single deployable HTML file.
 * Usage: node build.mjs
 * Output: dist/index.html
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const root = dirname(fileURLToPath(import.meta.url));
const html = readFileSync(join(root, 'index.html'), 'utf8');
const css = readFileSync(join(root, 'css', 'styles.css'), 'utf8');
const js = readFileSync(join(root, 'js', 'app.js'), 'utf8');

const bundled = html
  .replace(
    '<link rel="stylesheet" href="css/styles.css" />',
    `<style>\n${css}\n</style>`
  )
  .replace(
    '<script src="js/app.js"></script>',
    `<script>\n${js}\n</script>`
  );

const outDir = join(root, 'dist');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'index.html');
writeFileSync(outPath, bundled, 'utf8');

const sizeKb = (Buffer.byteLength(bundled) / 1024).toFixed(1);
console.log(`Built dist/index.html (${sizeKb} KB)`);
