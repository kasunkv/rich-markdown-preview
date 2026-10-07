const { test } = require('node:test');
const assert = require('node:assert/strict');
const { sortTableRows, tableCSV } = require('../dist/tables.cjs');

test('table sorting handles decimals, negatives, thousands, blanks and stable ties', () => {
  const rows = [['10'], ['2'], ['-3.5'], ['2'], [''], ['1,200'], ['1.5']];
  assert.deepEqual(sortTableRows(rows, 0, 'ascending'), [2,6,1,3,0,5,4]);
  assert.deepEqual(sortTableRows(rows, 0, 'descending'), [5,0,1,3,6,2,4]);
  assert.deepEqual(sortTableRows(rows, 0, 'none'), [0,1,2,3,4,5,6]);
  assert.deepEqual(rows[0], ['10']);
});

test('table sorting uses natural text order and treats missing cells as blank', () => {
  assert.deepEqual(sortTableRows([['Item 10'],['item 2'],['ITEM 1'],[]],0,'ascending'), [2,1,0,3]);
  assert.deepEqual(sortTableRows([['2026-10-07'],['2025-12-30'],['2026-01-01']],0,'ascending'), [1,2,0]);
});

test('CSV preserves commas, quotes, newlines, Unicode and empty cells', () => {
  assert.equal(tableCSV([['Name','Notes'],['日本語','a,b\n"quoted"'],['','සිංහල']]), '"Name","Notes"\r\n"日本語","a,b\n""quoted"""\r\n"","සිංහල"\r\n');
});

test('CSV exports formula-like text as literal cells while keeping signed numbers', () => {
  assert.equal(tableCSV([['=SUM(A1)', '+cmd', '-cmd', '@cmd', ' \t=1', '-3.5', '+12', '1,200']]), '"\'=SUM(A1)","\'+cmd","\'-cmd","\'@cmd","\' \t=1","-3.5","+12","1,200"\r\n');
});
