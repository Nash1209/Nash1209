// node --test tests/   … api/quote.js のフォールバック順をモックした fetch で検証する
import { test } from 'node:test';
import assert from 'node:assert/strict';
import handler from '../api/quote.js';

const yahoo = JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 150.123, regularMarketTime: 1700000000 } }], error: null } });
const stooq = 'Symbol,Date,Time,Open,High,Low,Close,Volume\nUSDJPY,2026-09-11,07:49:12,150.1,150.3,149.9,150.222,0\n';
const erapi = JSON.stringify({ result: 'success', time_last_update_unix: 1700000000, rates: { JPY: 147.2 } });
const resp = (text, ok = true, status = 200) => ({ ok, status, text: async () => text });
const mkRes = () => ({ headers: {}, code: 0, body: null, setHeader(k, v) { this.headers[k] = v; }, status(c) { this.code = c; return this; }, json(b) { this.body = b; return this; } });
const call = async (fetchImpl, pair = 'USD/JPY') => { globalThis.fetch = fetchImpl; const res = mkRes(); await handler({ query: { pair } }, res); return res; };

test('Yahoo が返せば Yahoo を採用', async () => {
  delete process.env.TWELVEDATA_API_KEY;
  const res = await call(async (u) => resp(String(u).includes('yahoo') ? yahoo : erapi));
  assert.equal(res.code, 200); assert.equal(res.body.source, 'Yahoo Finance'); assert.equal(res.body.price, 150.123); assert.equal(res.body.daily, false);
});
test('Yahoo が 429 なら Stooq', async () => {
  const res = await call(async (u) => String(u).includes('yahoo') ? resp('', false, 429) : String(u).includes('stooq') ? resp(stooq) : resp(erapi));
  assert.equal(res.body.source, 'Stooq'); assert.equal(res.body.price, 150.222);
  assert.deepEqual(res.body.tried.map((t) => t.source), ['Yahoo Finance']);
});
test('Yahoo と Stooq が駄目なら日次レート', async () => {
  const res = await call(async (u) => String(u).includes('yahoo') ? resp('', false, 403) : String(u).includes('stooq') ? resp('Symbol,Date,Time,Open,High,Low,Close,Volume\nUSDJPY,N/D,N/D,N/D,N/D,N/D,N/D,N/D\n') : resp(erapi));
  assert.equal(res.body.source, 'open.er-api.com'); assert.equal(res.body.daily, true);
});
test('全滅なら 502 と tried', async () => {
  const res = await call(async () => { throw new Error('blocked'); });
  assert.equal(res.code, 502); assert.equal(res.body.tried.length, 4); assert.equal(res.headers['Cache-Control'], 'no-store');
});
test('不正なペアは 400', async () => {
  const res = await call(async () => resp(yahoo), 'USDJPY');
  assert.equal(res.code, 400);
});
test('TWELVEDATA_API_KEY があれば最優先', async () => {
  process.env.TWELVEDATA_API_KEY = 'k';
  const res = await call(async (u) => String(u).includes('twelvedata') ? resp(JSON.stringify({ price: '150.555' })) : resp(yahoo));
  assert.equal(res.body.source, 'Twelve Data'); assert.equal(res.body.price, 150.555);
  delete process.env.TWELVEDATA_API_KEY;
});
