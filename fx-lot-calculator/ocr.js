/* ==========================================================
   スクショ OCR — 取引履歴のスクリーンショットから損益と銘柄を読み取る
   Tesseract.js（ブラウザ内OCR）を初回利用時にだけ読み込む。
   window.FxOcr = { parse(text), recognize(file, onProgress) }
   ========================================================== */
(() => {
  'use strict';

  const TESSERACT_SRC = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';

  // 銘柄の表記ゆれ → 正規化
  const PAIR_ALIASES = {
    GOLD: 'XAU/USD', XAUUSD: 'XAU/USD', ゴールド: 'XAU/USD', 金: 'XAU/USD',
  };
  const PAIR_RE = /\b([A-Z]{3})\s?[\/／]?\s?([A-Z]{3})\b/g;
  const KNOWN_CCY = new Set(['USD', 'JPY', 'EUR', 'GBP', 'AUD', 'NZD', 'CAD', 'CHF', 'XAU', 'MXN', 'ZAR', 'TRY', 'CNH', 'SGD', 'HKD']);

  const toHalf = (s) => s
    .replace(/[０-９Ａ-Ｚａ-ｚ．，－＋]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0))
    .replace(/[▲△]/g, '-').replace(/[−–—ー]/g, '-').replace(/[¥￥]/g, '')
    .replace(/円/g, '');

  const findPair = (line) => {
    const up = line.toUpperCase();
    for (const [alias, pair] of Object.entries(PAIR_ALIASES)) {
      if (up.includes(alias.toUpperCase())) return pair;
    }
    PAIR_RE.lastIndex = 0;
    let m;
    while ((m = PAIR_RE.exec(up))) {
      if (KNOWN_CCY.has(m[1]) && KNOWN_CCY.has(m[2]) && m[1] !== m[2]) return `${m[1]}/${m[2]}`;
    }
    return null;
  };

  // 損益らしい金額: 符号付き、または桁区切り付き（小数を含む価格・lot は除外）
  const AMOUNT_RE = /(?<![\d.])([-+])?\s?(\d{1,3}(?:,\d{3})+|\d{3,9})(?![\d.,]*\.\d)(?![\d])/g;

  const parse = (text) => {
    const lines = toHalf(String(text || '')).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const out = [];
    let lastPair = null;
    for (const line of lines) {
      const pair = findPair(line);
      if (pair) lastPair = pair;
      AMOUNT_RE.lastIndex = 0;
      let m; let best = null;
      while ((m = AMOUNT_RE.exec(line))) {
        const sign = m[1]; const digits = m[2];
        const value = Number(digits.replace(/,/g, ''));
        if (!(value > 0) || value > 100000000) continue;
        const hasComma = digits.includes(',');
        const looksLikePnl = !!sign || hasComma || /損益|利益|損失|profit|loss|p\/l|pnl/i.test(line);
        if (!looksLikePnl) continue;
        // 「損失」「loss」の語が近くにあれば負、明示的な符号があればそれを優先
        let signed = sign === '-' ? -value : sign === '+' ? value : value;
        if (!sign && /損失|loss|▲/i.test(line)) signed = -value;
        const score = (sign ? 2 : 0) + (hasComma ? 1 : 0);
        if (!best || score > best.score) best = { value: signed, score, raw: m[0].trim() };
      }
      if (best) out.push({ pair: pair || lastPair || null, pnl: best.value, line, raw: best.raw });
    }
    return out;
  };

  let tesseractPromise = null;
  const loadTesseract = () => {
    if (window.Tesseract) return Promise.resolve(window.Tesseract);
    if (tesseractPromise) return tesseractPromise;
    tesseractPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = TESSERACT_SRC;
      s.onload = () => resolve(window.Tesseract);
      s.onerror = () => { tesseractPromise = null; reject(new Error('OCRライブラリを読み込めません')); };
      document.head.appendChild(s);
    });
    return tesseractPromise;
  };

  let workerPromise = null;
  const getWorker = async (onProgress) => {
    const T = await loadTesseract();
    if (!workerPromise) {
      workerPromise = T.createWorker('jpn+eng', 1, {
        logger: (m) => { if (onProgress && m.status && typeof m.progress === 'number') onProgress(m); },
      }).catch((e) => { workerPromise = null; throw e; });
    }
    return workerPromise;
  };

  const recognize = async (file, onProgress) => {
    const worker = await getWorker(onProgress);
    const { data } = await worker.recognize(file);
    return { text: data.text || '', items: parse(data.text || '') };
  };

  window.FxOcr = { parse, recognize };
})();
