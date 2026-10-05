// Write THIRD-PARTY-NOTICES.txt from the licenses of the production dependencies (the app bundle and the MCP Worker).
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Z]:)/, '$1');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const seen = new Map();
function visit(name) {
  if (seen.has(name)) return;
  const dir = join(root, 'node_modules', name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const meta = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const file = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.|$)/i.test(f));
  seen.set(name, {
    version: meta.version,
    license: meta.license ?? 'UNKNOWN',
    text: file ? readFileSync(join(dir, file), 'utf8').trim() : '',
  });
  for (const dep of Object.keys(meta.dependencies ?? {})) visit(dep);
}
for (const dep of Object.keys(pkg.dependencies)) visit(dep);
const body = [...seen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([name, x]) => `${name}@${x.version} (${x.license})\n\n${x.text || '(no license file shipped)'}\n`)
  .join('\n' + '-'.repeat(72) + '\n\n');
writeFileSync(
  join(root, 'THIRD-PARTY-NOTICES.txt'),
  `Attention Planner ships the following third-party packages.\n\n${body}`,
);
console.log(`${seen.size} packages`);
