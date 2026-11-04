const test = require('node:test');
const assert = require('node:assert/strict');
const { pluralPt } = require('../plural.js');

test('zero usa plural', () => {
  assert.equal(pluralPt(0, 'tarefa', 'tarefas'), 'tarefas');
  assert.equal(pluralPt(0, 'concluída', 'concluídas'), 'concluídas');
});

test('um usa singular', () => {
  assert.equal(pluralPt(1, 'tarefa', 'tarefas'), 'tarefa');
  assert.equal(pluralPt(1, 'concluída', 'concluídas'), 'concluída');
});

test('dois ou mais usa plural', () => {
  assert.equal(pluralPt(2, 'tarefa', 'tarefas'), 'tarefas');
  assert.equal(pluralPt(7, 'concluída', 'concluídas'), 'concluídas');
});
