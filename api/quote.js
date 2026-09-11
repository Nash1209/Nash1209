// Vercel Serverless Function: GET /api/quote?pair=USD/JPY
// 現在値（参考値・遅延あり）を返す。取得元の優先順:
//   1. Twelve Data（環境変数 TWELVEDATA_API_KEY がある場合のみ、分足）
//   2. Yahoo Finance chart API（分足、遅延あり）
//   3. Stooq（遅延あり、CSV）
//   4. open.er-api.com（日次レート）
//   5. Frankfurter / ECB（日次レート、平日のみ更新）
// レスポンス: { pair, price, time (ms), source, daily, tried: [{source, error}] }

const PAIR_RE = /^[A-Z]{3}\/[A-Z]{3}$/;
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

async function getText(url, ms = 6000, headers = {}) {
  const t = withTimeout(ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers }, signal: t.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    t.done();
  }
}
const getJson = async (url, ms, headers) => JSON.parse(await getText(url, ms, headers));

const ok = (price, time, source, daily) => ({ price, time, source, daily });

async function fromTwelveData(base, quote) {
  const key = process.env.TWELVEDATA_API_KEY;
  if (!key) throw new Error('no TWELVEDATA_API_KEY');
  const j = await getJson(`https://api.twelvedata.com/price?symbol=${base}/${quote}&apikey=${encodeURIComponent(key)}`);
  const price = Number(j?.price);
  if (!(price > 0)) throw new Error(j?.message || 'no price');
  return ok(price, Date.now(), 'Twelve Data', false);
}
fromTwelveData.id = 'Twelve Data';

async function fromYahoo(base, quote) {
  const symbol = `${base}${quote}=X`;
  let lastErr = null;
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`);
      const meta = j?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (price > 0) return ok(price, (Number(meta.regularMarketTime) || Math.floor(Date.now() / 1000)) * 1000, 'Yahoo Finance', false);
      lastErr = new Error(j?.chart?.error?.description || 'no price in response');
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('unavailable');
}
fromYahoo.id = 'Yahoo Finance';

// Stooq: CSV "Symbol,Date,Time,Open,High,Low,Close,Volume"
async function fromStooq(base, quote) {
  const symbol = `${base}${quote}`.toLowerCase();
  const csv = await getText(`https://stooq.com/q/l/?s=${symbol}&f=sd2t2ohlcv&h&e=csv`);
  const lines = csv.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('empty csv');
  const cols = lines[1].split(',');
  const price = Number(cols[6]);
  if (!(price > 0)) throw new Error(`no data (${cols.slice(0, 3).join(',')})`);
  const time = cols[1] && cols[2] ? Date.parse(`${cols[1]}T${cols[2]}Z`) : Date.now();
  return ok(price, isFinite(time) ? time : Date.now(), 'Stooq', false);
}
fromStooq.id = 'Stooq';

async function fromErApi(base, quote) {
  const j = await getJson(`https://open.er-api.com/v6/latest/${base}`);
  const price = Number(j?.rates?.[quote]);
  if (j?.result !== 'success' || !(price > 0)) throw new Error(j?.['error-type'] || 'no rate');
  return ok(price, (Number(j.time_last_update_unix) || 0) * 1000 || Date.now(), 'open.er-api.com', true);
}
fromErApi.id = 'open.er-api.com';

async function fromFrankfurter(base, quote) {
  const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
  const price = Number(j?.rates?.[quote]);
  if (!(price > 0)) throw new Error(j?.message || 'no rate');
  return ok(price, j.date ? Date.parse(`${j.date}T16:00:00+01:00`) : Date.now(), 'ECB (Frankfurter)', true);
}
fromFrankfurter.id = 'ECB (Frankfurter)';

export const SOURCES = [fromTwelveData, fromYahoo, fromStooq, fromErApi, fromFrankfurter];

export async function resolveQuote(pair, sources = null) {
  const [base, quote] = pair.split('/');
  if (!sources) sources = SOURCES.filter((s) => s !== fromTwelveData || process.env.TWELVEDATA_API_KEY);
  const tried = [];
  for (const src of sources) {
    try {
      const q = await src(base, quote);
      return { pair, ...q, tried };
    } catch (e) {
      tried.push({ source: src.id || src.name, error: String(e?.message || e).slice(0, 120) });
    }
  }
  return { pair, price: null, tried };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  const pair = String(req.query?.pair || '').toUpperCase().trim();
  if (!PAIR_RE.test(pair)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(400).json({ error: 'pair must look like USD/JPY' });
    return;
  }
  const q = await resolveQuote(pair);
  if (!(q.price > 0)) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'no price source available', pair, tried: q.tried });
    return;
  }
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  res.status(200).json(q);
}
