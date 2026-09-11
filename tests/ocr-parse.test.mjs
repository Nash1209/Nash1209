// fx-lot-calculator/ocr.js の損益パーサー（Tesseract は使わない）
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

globalThis.window = {};
globalThis.document = { createElement: () => ({}), head: { appendChild() {} } };
new Function(readFileSync(new URL('../fx-lot-calculator/ocr.js', import.meta.url), 'utf8'))();
const { parse } = globalThis.window.FxOcr;

test('符号付き・桁区切り・全角・▲ を損益として拾い、価格や lot は無視する', () => {
  const items = parse(`取引履歴
USD/JPY 買い 0.5 lot
決済価格 150.123
損益 +12,345円
EURUSD 売り 1.20 lot  損益 ▲3,210
GOLD 0.10 lot -8,500
ＧＢＰＪＰＹ 利益 ２，５００円
合計 900`);
  assert.deepEqual(items.map((i) => [i.pair, i.pnl]), [['USD/JPY', 12345], ['EUR/USD', -3210], ['XAU/USD', -8500], ['GBP/JPY', 2500]]);
});
test('銘柄が無い行は直前の銘柄を引き継ぐ', () => {
  const items = parse('AUD/JPY\n+1,000\n-2,000');
  assert.deepEqual(items.map((i) => i.pair), ['AUD/JPY', 'AUD/JPY']);
});
