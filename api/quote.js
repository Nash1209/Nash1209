// Vercel Serverless Function: GET /api/quote?pair=USD/JPY
// 現在値（参考値・遅延あり）を返す。取得元の優先順:
//   1. Yahoo Finance chart API（分足、遅延あり）
//   2. open.er-api.com（日次レート）
//   3. Frankfurter / ECB（日次レート、平日のみ更新）
// レスポンス: { pair, price, time (ms), source, daily }

const PAIR_RE = /^[A-Z]{3}\/[A-Z]{3}$/;
const UA = 'Mozilla/5.0 (compatible; fx-lot-calculator/1.0)';

const withTimeout = (ms) => {
  const c = new AbortController();
  const t = setTimeout(() => c.abort(), ms);
  return { signal: c.signal, done: () => clearTimeout(t) };
};

async function getJson(url, ms = 6000) {
  const t = withTimeout(ms);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: t.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    t.done();
  }
}

async function fromYahoo(base, quote) {
  const symbol = `${base}${quote}=X`;
  for (const host of ['query1', 'query2']) {
    try {
      const j = await getJson(`https://${host}.finance.yahoo.com/v8/finance/chart/${symbol}?range=1d&interval=1m`);
      const meta = j?.chart?.result?.[0]?.meta;
      const price = Number(meta?.regularMarketPrice);
      if (price > 0) {
        return { price, time: (Number(meta.regularMarketTime) || Math.floor(Date.now() / 1000)) * 1000, source: 'Yahoo Finance', daily: false };
      }
    } catch { /* 次のホストへ */ }
  }
  return null;
}

async function fromErApi(base, quote) {
  try {
    const j = await getJson(`https://open.er-api.com/v6/latest/${base}`);
    const price = Number(j?.rates?.[quote]);
    if (j?.result === 'success' && price > 0) {
      return { price, time: (Number(j.time_last_update_unix) || 0) * 1000 || Date.now(), source: 'open.er-api.com', daily: true };
    }
  } catch { /* 次へ */ }
  return null;
}

async function fromFrankfurter(base, quote) {
  try {
    const j = await getJson(`https://api.frankfurter.dev/v1/latest?base=${base}&symbols=${quote}`);
    const price = Number(j?.rates?.[quote]);
    if (price > 0) {
      return { price, time: j.date ? Date.parse(`${j.date}T16:00:00+01:00`) : Date.now(), source: 'ECB (Frankfurter)', daily: true };
    }
  } catch { /* 諦める */ }
  return null;
}

export async function resolveQuote(pair, sources = [fromYahoo, fromErApi, fromFrankfurter]) {
  const [base, quote] = pair.split('/');
  for (const src of sources) {
    const q = await src(base, quote);
    if (q) return { pair, ...q };
  }
  return null;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=15, stale-while-revalidate=60');
  const pair = String(req.query?.pair || '').toUpperCase().trim();
  if (!PAIR_RE.test(pair)) {
    res.status(400).json({ error: 'pair must look like USD/JPY' });
    return;
  }
  const q = await resolveQuote(pair);
  if (!q) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'no price source available', pair });
    return;
  }
  res.status(200).json(q);
}
