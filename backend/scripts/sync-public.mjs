// Copia a interface (raiz do repositório) para backend/public, de onde o
// backend a serve na mesma origem da API. Rode após alterar a interface:
//   node backend/scripts/sync-public.mjs
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FRONTEND_FILES = ['index.html', 'script.js', 'plural.js', 'style.css', 'privacidade.html', 'termos.html', '404.html', 'og-image.png', 'robots.txt'];
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dest = join(root, 'backend', 'public');
if (import.meta.url === new URL(process.argv[1], 'file://').href || process.argv[1]?.endsWith('sync-public.mjs')) {
  mkdirSync(dest, { recursive: true });
  for (const f of FRONTEND_FILES) copyFileSync(join(root, f), join(dest, f));
  console.log(`Interface copiada para ${dest}`);
}
