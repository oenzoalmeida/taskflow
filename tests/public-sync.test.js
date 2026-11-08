// A interface servida pelo backend (backend/public) deve ser idêntica à da raiz.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const files = ['index.html', 'script.js', 'plural.js', 'style.css', 'privacidade.html', 'termos.html', '404.html', 'og-image.png', 'robots.txt'];
const root = path.join(__dirname, '..');

for (const f of files) {
  test(`backend/public/${f} está sincronizado com a raiz`, () => {
    assert.ok(fs.readFileSync(path.join(root, f)).equals(fs.readFileSync(path.join(root, 'backend', 'public', f))),
      'rode: node backend/scripts/sync-public.mjs');
  });
}

test('interface usa a mesma origem da API', () => {
  assert.match(fs.readFileSync(path.join(root, 'script.js'), 'utf8'), /^const API = '';/m);
});
