/* Marks the links to the site with where the reader came from.
 *
 * The documentation is written once, with ?from=github. The npm package
 * carries the same files with ?from=npm: prepack writes that, postpack puts
 * ?from=github back, so the repository never keeps the npm form.
 *
 *   node scripts/npm-links.mjs npm       before packing
 *   node scripts/npm-links.mjs github    after packing
 * No dependency.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const to = process.argv[2];
if (to !== 'npm' && to !== 'github') {
  console.error('Usage: node scripts/npm-links.mjs npm|github');
  process.exit(1);
}
const from = to === 'npm' ? 'github' : 'npm';

const files = ['README.md', 'NOTICE.md'];
for (const entry of readdirSync(ROOT, { withFileTypes: true })) {
  if (entry.isDirectory() && existsSync(join(ROOT, entry.name, `${entry.name}.js`))) files.push(join(entry.name, 'README.md'));
}

let count = 0;
for (const file of files) {
  const path = join(ROOT, file);
  const text = readFileSync(path, 'utf8');
  const next = text.split(`?from=${from}`).join(`?from=${to}`);
  if (next !== text) {
    writeFileSync(path, next);
    count += text.split(`?from=${from}`).length - 1;
  }
}
console.log(`links: ${count} now say ?from=${to}`);
