// Pluralização pt-BR para contadores da interface.
// Arquivo compartilhado: usado por script.js (browser, via global) e por
// tests/plural.test.js (node, via module.exports). Não acessa o DOM.
function pluralPt(quantidade, singular, plural) {
  return quantidade === 1 ? singular : plural;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { pluralPt };
}
