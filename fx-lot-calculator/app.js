/* ==========================================================
   FX Lot Calculator — MVP
   すべての状態は localStorage に保存（サーバー送信なし）
   ========================================================== */
(() => {
  'use strict';

  // ---------- 定数 ----------
  const PAIRS = [
    'USD/JPY', 'EUR/JPY', 'GBP/JPY', 'AUD/JPY', 'NZD/JPY', 'CAD/JPY', 'CHF/JPY',
    'EUR/USD', 'GBP/USD', 'AUD/USD', 'NZD/USD', 'USD/CAD', 'USD/CHF',
    'EUR/GBP', 'EUR/AUD', 'GBP/AUD',
  ];
  const KEYS = {
    settings: 'fxlot.settings.v1',
    calc: 'fxlot.calc.v1',
    rates: 'fxlot.rates.v1',
    positions: 'fxlot.positions.v1',
    log: 'fxlot.log.v1',
  };
  const DEFAULT_SETTINGS = {
    capital: 1000000,
    riskPct: 1,
    dailyPct: 3,
    lotUnit: 10000,
    step: 0.01,
    copyTarget: 'lots',
    dailyAdjust: true,
  };
  const DEFAULT_CALC = { pair: 'USD/JPY', mode: 'price', side: 'buy', entry: '', stop: '', pips: '' };

  // ---------- ストレージ ----------
  const load = (key, fallback) => {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      const v = JSON.parse(raw);
      return (v && typeof v === 'object' && !Array.isArray(fallback)) ? { ...fallback, ...v } : v;
    } catch { return fallback; }
  };
  const save = (key, value) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode 等は無視 */ }
  };

  let settings = load(KEYS.settings, DEFAULT_SETTINGS);
  let calc = load(KEYS.calc, DEFAULT_CALC);
  let rates = load(KEYS.rates, {});          // { USD: 150.2, GBP: 190.1 ... }
  let positions = load(KEYS.positions, []);  // 保有
  let log = load(KEYS.log, []);              // 決済記録

  // ---------- ユーティリティ ----------
  const $ = (id) => document.getElementById(id);
  const num = (v) => {
    if (v == null) return NaN;
    const s = String(v).replace(/[,\s¥円]/g, '').replace(/[０-９．－]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
    if (s === '' || s === '-' || s === '.') return NaN;
    return Number(s);
  };
  const yen = (v, { sign = false } = {}) => {
    if (!isFinite(v)) return '¥—';
    const r = Math.round(v);
    const s = '¥' + Math.abs(r).toLocaleString('ja-JP');
    if (r < 0) return '−' + s;
    return (sign && r > 0 ? '+' : '') + s;
  };
  const fmtLots = (lots, step) => {
    const dec = Math.max(0, Math.min(4, -Math.floor(Math.log10(step))));
    return lots.toLocaleString('ja-JP', { minimumFractionDigits: dec, maximumFractionDigits: dec });
  };
  const isBlank = (v) => String(v ?? '').trim() === '';
  const fmtInt = (v) => Math.round(v).toLocaleString('ja-JP');
  const todayKey = (d = new Date()) => {
    const p = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  };
  const fmtDay = (key) => {
    const [y, m, d] = key.split('-').map(Number);
    const w = ['日', '月', '火', '水', '木', '金', '土'][new Date(y, m - 1, d).getDay()];
    return `${y}/${m}/${d}（${w}）`;
  };
  const fmtTime = (iso) => {
    const d = new Date(iso);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const quoteOf = (pair) => pair.split('/')[1];
  const pipSizeOf = (pair) => (quoteOf(pair) === 'JPY' ? 0.01 : 0.0001);
  const priceDecimals = (pair) => (quoteOf(pair) === 'JPY' ? 3 : 5);

  let toastTimer = null;
  const toast = (msg) => {
    const el = $('toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 1600);
  };

  // ---------- 損失枠の計算 ----------
  const budget = () => {
    const capital = num(settings.capital) || 0;
    const perTrade = capital * (num(settings.riskPct) || 0) / 100;
    const dailyLimit = capital * (num(settings.dailyPct) || 0) / 100;
    const tk = todayKey();
    const realized = log.filter((e) => e.day === tk).reduce((s, e) => s + (Number(e.pnl) || 0), 0);
    const todayLoss = Math.max(0, -realized);
    const openLoss = positions.reduce((s, p) => s + (Number(p.expectedLoss) || 0), 0);
    const remaining = Math.max(0, dailyLimit - todayLoss - openLoss);
    const adopted = settings.dailyAdjust ? Math.min(perTrade, remaining) : perTrade;
    return { capital, perTrade, dailyLimit, realized, todayLoss, openLoss, remaining, adopted };
  };

  // ---------- ロット計算 ----------
  const compute = () => {
    const b = budget();
    const pair = calc.pair;
    const pipSize = pipSizeOf(pair);
    const quote = quoteOf(pair);
    const entry = num(calc.entry);
    const stop = num(calc.stop);
    const pipsIn = num(calc.pips);
    const rate = quote === 'JPY' ? 1 : num(rates[quote]);

    let distance = NaN;
    let warn = '';
    let empty = false;          // まだ入力していない（エラーではない）
    const invalid = { entry: false, stop: false, pips: false };
    if (calc.mode === 'price') {
      if (!isBlank(calc.entry) && !isFinite(entry)) invalid.entry = true;
      if (!isBlank(calc.stop) && !isFinite(stop)) invalid.stop = true;
      if (invalid.entry || invalid.stop) warn = '数字で入力してください';
      else if (isBlank(calc.entry) || isBlank(calc.stop)) { empty = true; warn = 'エントリーと損切りの価格を入力'; }
      else {
        distance = Math.abs(entry - stop);
        if (calc.side === 'buy' && stop > entry) { warn = '買いの損切りはエントリーより下に'; invalid.stop = true; }
        if (calc.side === 'sell' && stop < entry) { warn = '売りの損切りはエントリーより上に'; invalid.stop = true; }
      }
    } else {
      if (!isBlank(calc.pips) && !isFinite(pipsIn)) { invalid.pips = true; warn = '数字で入力してください'; }
      else if (isBlank(calc.pips)) { empty = true; warn = '損切り幅（pips）を入力'; }
      else distance = Math.abs(pipsIn) * pipSize;
      if (!isBlank(calc.entry) && !isFinite(entry)) { invalid.entry = true; warn = '数字で入力してください'; }
    }
    if (!warn && quote !== 'JPY' && !(rate > 0)) warn = `${quote} → 円 のレートを入力`;
    if (!warn && !(distance > 0)) { warn = '損切り幅が 0 です'; if (calc.mode === 'price') invalid.stop = true; else invalid.pips = true; }
    if (!warn && !(b.capital > 0)) warn = '設定で口座資金を入力';

    const pips = distance / pipSize;
    const lossPerUnit = distance * rate; // 1通貨あたりの損失（円）
    const lotUnit = Number(settings.lotUnit) || 10000;
    const step = Number(settings.step) || 0.01;
    const stepUnits = lotUnit * step;

    let lots = 0, units = 0, loss = 0;
    if (!warn) {
      const maxUnits = b.adopted / lossPerUnit;
      const n = Math.floor(maxUnits / stepUnits + 1e-9);
      lots = n * step;
      units = Math.round(lots * lotUnit);
      loss = units * lossPerUnit;
      if (n <= 0) warn = b.adopted <= 0 && settings.dailyAdjust
        ? '残り枠がありません。今日はここまで'
        : `許容損失内では最小刻み ${step} lot に届きません`;
    }
    const zeroBudget = settings.dailyAdjust && b.adopted <= 0 && b.capital > 0;
    return { ...b, pair, pips, distance, lossPerUnit, lots, units, loss, step, lotUnit, warn, empty, invalid, zeroBudget, quote, rate };
  };

  // ---------- 描画：計算画面 ----------
  const pct = (v) => (Number(v) || 0).toLocaleString('ja-JP', { minimumFractionDigits: 1, maximumFractionDigits: 2 }) + ' %';

  const renderCalc = () => {
    const r = compute();
    const hasResult = r.units > 0;

    // 口座ピル
    $('account-text').textContent = r.capital > 0 ? `円口座・${yen(r.capital)}` : '口座資金を設定してください';

    // ヒーロー
    const lotsEl = $('res-lots');
    const lotsText = hasResult ? fmtLots(r.lots, r.step) : (r.zeroBudget ? '0' : fmtLots(0, r.step));
    lotsEl.textContent = lotsText;
    lotsEl.classList.toggle('is-empty', !hasResult);
    lotsEl.classList.toggle('is-long', lotsText.length > 6 && lotsText.length <= 8);
    lotsEl.classList.toggle('is-xlong', lotsText.length > 8);
    const unitsLine = $('res-units-line');
    unitsLine.classList.toggle('is-empty', !hasResult);
    if (hasResult) unitsLine.innerHTML = `<strong id="res-units">${fmtInt(r.units)}</strong> 通貨`;
    else if (r.empty) unitsLine.textContent = '価格を入力すると計算します';
    else unitsLine.innerHTML = `<strong id="res-units">0</strong> 通貨`;

    const chip = $('res-chip');
    if (hasResult) {
      chip.dataset.tone = 'ok';
      chip.innerHTML = `<span class="calc-chip-k">想定損失</span><span class="calc-chip-v" id="res-loss">${yen(r.loss)}</span>`;
    } else if (r.empty) {
      chip.dataset.tone = 'muted';
      chip.innerHTML = `<span class="calc-chip-k">${r.warn}</span>`;
    } else {
      chip.dataset.tone = 'warn';
      chip.innerHTML = `<span class="calc-chip-k">${r.warn}</span>`;
    }

    // 入力
    document.querySelectorAll('[data-mode-only]').forEach((el) => { el.hidden = el.dataset.modeOnly !== calc.mode; });
    document.querySelectorAll('#seg-mode button').forEach((b) => {
      const on = b.dataset.mode === calc.mode;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    document.querySelectorAll('#seg-side button').forEach((b) => {
      const on = b.dataset.side === calc.side;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
    });
    $('field-entry').classList.toggle('is-invalid', r.invalid.entry);
    $('field-stop').classList.toggle('is-invalid', r.invalid.stop);
    $('field-pips').classList.toggle('is-invalid', r.invalid.pips);
    const helper = $('calc-helper');
    const fieldError = r.invalid.entry || r.invalid.stop || r.invalid.pips;
    helper.classList.toggle('is-error', fieldError);
    if (fieldError) helper.textContent = r.warn;
    else if (isFinite(r.pips) && r.pips > 0) helper.textContent = `損切り幅 ${(Math.round(r.pips * 10) / 10).toLocaleString('ja-JP', { minimumFractionDigits: 1 })} pips`;
    else helper.textContent = r.quote === 'JPY' ? '損切り幅 — pips（1 pip = 0.01）' : '損切り幅 — pips（1 pip = 0.0001）';
    $('field-entry').querySelector('label').textContent = calc.mode === 'pips' ? 'エントリー（任意）' : 'エントリー';

    const rowRate = $('row-rate');
    rowRate.hidden = r.quote === 'JPY';
    $('rate-label').textContent = r.quote;
    $('in-entry').placeholder = r.quote === 'JPY' ? '150.000' : '1.08500';
    $('in-stop').placeholder = r.quote === 'JPY' ? '149.700' : '1.08200';

    // 許容損失・残り枠
    $('bd-risk-pct').textContent = pct(settings.riskPct);
    $('bd-per-trade').textContent = yen(r.perTrade);
    $('bd-remaining').textContent = yen(r.remaining);
    $('bd-daily-limit').textContent = yen(r.dailyLimit);
    $('bd-today-loss').textContent = '− ' + yen(r.todayLoss);
    $('bd-open-loss').textContent = '− ' + yen(r.openLoss);
    $('bd-adopted').textContent = yen(r.adopted);
    $('budget').classList.toggle('is-zero', r.capital > 0 && r.remaining <= 0);
    $('hint-step').textContent = `${r.step} lot`;
    $('hint-lot').textContent = fmtInt(r.lotUnit);

    // 主操作
    const copyBtn = $('btn-copy');
    if (!copyBtn.classList.contains('is-done')) {
      $('btn-copy-label').textContent = hasResult
        ? (settings.copyTarget === 'units' ? `${fmtInt(r.units)} 通貨をコピー` : `${fmtLots(r.lots, r.step)} lot をコピー`)
        : '数量をコピー';
    }
    copyBtn.disabled = !hasResult;
    $('btn-add-pos').disabled = !hasResult;
  };

  // ---------- 描画：保有・記録 ----------
  const svgTrash = '<svg viewBox="0 0 24 24"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>';

  const renderPositions = () => {
    const b = budget();
    $('pos-date').textContent = fmtDay(todayKey());
    const stR = $('st-realized');
    stR.textContent = yen(b.realized, { sign: true });
    stR.className = 'stat-v ' + (b.realized < 0 ? 'neg' : b.realized > 0 ? 'pos' : '');
    $('st-open').textContent = yen(b.openLoss);
    const stRem = $('st-remaining');
    stRem.textContent = yen(b.remaining);
    stRem.className = 'stat-v ' + (b.remaining <= 0 ? 'neg' : 'green');

    const badge = $('tab-badge');
    badge.hidden = positions.length === 0;
    badge.textContent = positions.length;

    // 保有
    const posList = $('pos-list');
    posList.innerHTML = '';
    if (positions.length === 0) {
      posList.innerHTML = '<div class="empty">保有中のポジションはありません</div>';
    } else {
      positions.forEach((p) => {
        const el = document.createElement('div');
        el.className = 'item';
        el.innerHTML = `
          <div class="item-main">
            <div class="item-title"><span>${p.pair}</span><span class="lots">${fmtLots(p.lots, p.step)} lot</span>${p.side ? `<span class="side ${p.side}">${p.side === 'sell' ? '売り' : '買い'}</span>` : ''}</div>
            <div class="item-sub">${fmtInt(p.units)} 通貨 ・ ${p.entry != null ? p.entry + ' → ' + p.stop : (Math.round(p.pips * 10) / 10) + ' pips'} ・ 想定損失 ${yen(p.expectedLoss)}</div>
          </div>
          <button class="pill-btn" type="button" data-close="${p.id}">決済</button>
          <button class="icon-btn" type="button" data-del-pos="${p.id}" aria-label="削除">${svgTrash}</button>`;
        posList.appendChild(el);
      });
    }

    // 本日の記録
    const tk = todayKey();
    const today = log.filter((e) => e.day === tk).sort((a, b2) => b2.at.localeCompare(a.at));
    const logList = $('log-list');
    logList.innerHTML = '';
    if (today.length === 0) {
      logList.innerHTML = '<div class="empty">まだ記録がありません</div>';
    } else {
      today.forEach((e) => logList.appendChild(logItem(e)));
    }

    // 過去
    const past = log.filter((e) => e.day !== tk);
    const pastEl = $('log-past');
    pastEl.innerHTML = '';
    if (past.length === 0) {
      pastEl.innerHTML = '<div class="empty">過去の記録はありません</div>';
    } else {
      const byDay = {};
      past.forEach((e) => { (byDay[e.day] = byDay[e.day] || []).push(e); });
      Object.keys(byDay).sort().reverse().slice(0, 14).forEach((day) => {
        const sum = byDay[day].reduce((s, e) => s + (Number(e.pnl) || 0), 0);
        const head = document.createElement('div');
        head.className = 'day-head';
        head.innerHTML = `<span>${fmtDay(day)}</span><span class="v">${yen(sum, { sign: true })}</span>`;
        pastEl.appendChild(head);
        byDay[day].sort((a, b2) => b2.at.localeCompare(a.at)).forEach((e) => pastEl.appendChild(logItem(e)));
      });
    }
  };

  const logItem = (e) => {
    const el = document.createElement('div');
    el.className = 'item';
    const pnl = Number(e.pnl) || 0;
    el.innerHTML = `
      <div class="item-main">
        <div class="item-title"><span>${e.pair}</span>${e.lots != null ? `<span class="lots">${fmtLots(e.lots, e.step || 0.01)} lot</span>` : ''}</div>
        <div class="item-sub">${fmtTime(e.at)}${e.manual ? ' ・ 手入力' : ''}</div>
      </div>
      <div class="item-amt ${pnl < 0 ? 'neg' : pnl > 0 ? 'pos' : 'muted'}">${yen(pnl, { sign: true })}</div>
      <button class="icon-btn" type="button" data-del-log="${e.id}" aria-label="削除">${svgTrash}</button>`;
    return el;
  };

  // ---------- 描画：設定 ----------
  const renderSettings = () => {
    $('set-capital').value = settings.capital ? fmtInt(settings.capital) : '';
    $('set-risk').value = settings.riskPct ?? '';
    $('set-daily').value = settings.dailyPct ?? '';
    $('set-lot').value = String(settings.lotUnit);
    $('set-step').value = String(settings.step);
    $('set-copy').value = settings.copyTarget;
    $('sw-daily').checked = !!settings.dailyAdjust;
  };

  const renderAll = () => { renderCalc(); renderPositions(); renderSettings(); };

  // ---------- 画面切替 ----------
  const showScreen = (name) => {
    document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-active', s.id === `screen-${name}`));
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.screen === name));
    window.scrollTo({ top: 0 });
  };
  document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showScreen(t.dataset.screen)));

  // ---------- 計算画面のイベント ----------
  const pairSel = $('in-pair');
  const sheetPairSel = $('sheet-pair');
  PAIRS.forEach((p) => {
    pairSel.appendChild(new Option(p, p));
    sheetPairSel.appendChild(new Option(p, p));
  });
  pairSel.value = calc.pair;
  $('in-entry').value = calc.entry;
  $('in-stop').value = calc.stop;
  $('in-pips').value = calc.pips;

  const persistCalc = () => { save(KEYS.calc, calc); renderCalc(); };

  pairSel.addEventListener('change', () => {
    calc.pair = pairSel.value;
    $('in-rate').value = rates[quoteOf(calc.pair)] ?? '';
    persistCalc();
  });
  $('seg-mode').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-mode]');
    if (!b) return;
    calc.mode = b.dataset.mode;
    persistCalc();
    const target = calc.mode === 'pips' ? $('in-pips') : $('in-stop');
    if (isBlank(target.value)) target.focus();
  });
  $('seg-side').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-side]');
    if (!b) return;
    calc.side = b.dataset.side;
    persistCalc();
  });
  $('btn-go-settings').addEventListener('click', () => showScreen('settings'));
  $('account-pill').addEventListener('click', () => { showScreen('settings'); setTimeout(() => $('set-capital').focus(), 200); });
  $('row-risk').addEventListener('click', () => { showScreen('settings'); setTimeout(() => $('set-risk').focus(), 200); });
  $('in-entry').addEventListener('input', (ev) => { calc.entry = ev.target.value; persistCalc(); });
  $('in-stop').addEventListener('input', (ev) => { calc.stop = ev.target.value; persistCalc(); });
  $('in-pips').addEventListener('input', (ev) => { calc.pips = ev.target.value; persistCalc(); });
  $('in-rate').value = rates[quoteOf(calc.pair)] ?? '';
  $('in-rate').addEventListener('input', (ev) => {
    const q = quoteOf(calc.pair);
    const v = num(ev.target.value);
    if (isFinite(v) && v > 0) rates[q] = v; else delete rates[q];
    save(KEYS.rates, rates);
    renderCalc();
  });
  $('sw-daily').addEventListener('change', (ev) => {
    settings.dailyAdjust = ev.target.checked;
    save(KEYS.settings, settings);
    renderCalc();
  });

  // コピー
  const copyText = async (text) => {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(text);
      } else {
        const ta = document.createElement('textarea');
        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
        document.body.appendChild(ta); ta.select(); document.execCommand('copy'); ta.remove();
      }
      return true;
    } catch { return false; }
  };
  let copyDoneTimer = null;
  $('btn-copy').addEventListener('click', async () => {
    const r = compute();
    if (!(r.units > 0)) return;
    // クリップボードには桁区切りなしの素の数値を入れる（発注画面に貼るため）
    const text = settings.copyTarget === 'units' ? String(r.units) : r.lots.toFixed(Math.max(0, -Math.floor(Math.log10(r.step))));
    const ok = await copyText(text);
    const btn = $('btn-copy');
    clearTimeout(copyDoneTimer);
    if (ok) {
      btn.classList.add('is-done');
      $('btn-copy-label').textContent = `${text} をコピーしました`;
      copyDoneTimer = setTimeout(() => { btn.classList.remove('is-done'); renderCalc(); }, 1600);
    } else {
      toast('コピーできませんでした');
    }
  });

  // 保有に追加
  $('btn-add-pos').addEventListener('click', () => {
    const r = compute();
    if (!(r.units > 0)) return;
    const dec = priceDecimals(r.pair);
    positions.push({
      id: uid(),
      pair: r.pair,
      side: calc.side,
      lots: r.lots,
      units: r.units,
      step: r.step,
      entry: calc.mode === 'price' ? num(calc.entry).toFixed(dec) : null,
      stop: calc.mode === 'price' ? num(calc.stop).toFixed(dec) : null,
      pips: r.pips,
      expectedLoss: r.loss,
      openedAt: new Date().toISOString(),
    });
    save(KEYS.positions, positions);
    renderCalc();
    renderPositions();
    toast(`${r.pair} ${fmtLots(r.lots, r.step)} lot を保有に追加`);
  });

  // ---------- 保有・記録のイベント ----------
  let sheetCtx = null; // { type: 'close', position } | { type: 'manual' }
  let sheetSign = -1;

  const openSheet = (ctx) => {
    sheetCtx = ctx;
    sheetSign = -1;
    $('sheet-pnl').value = '';
    document.querySelectorAll('#sheet-sign button').forEach((b) => b.classList.toggle('is-active', b.dataset.sign === '-1'));
    if (ctx.type === 'close') {
      const p = ctx.position;
      $('sheet-title').textContent = '決済を記録';
      $('sheet-sub').textContent = `${p.pair} ${fmtLots(p.lots, p.step)} lot（${fmtInt(p.units)} 通貨）・想定損失 ${yen(p.expectedLoss)}`;
      $('sheet-row-pair').hidden = true;
    } else {
      $('sheet-title').textContent = '記録を手入力';
      $('sheet-sub').textContent = '保有に入れていない取引の確定損益を追加します';
      $('sheet-row-pair').hidden = false;
      sheetPairSel.value = calc.pair;
    }
    $('toast').hidden = true;
    $('sheet').hidden = false;
    setTimeout(() => $('sheet-pnl').focus(), 50);
  };
  const closeSheet = () => { $('sheet').hidden = true; sheetCtx = null; };

  $('sheet-sign').addEventListener('click', (ev) => {
    const b = ev.target.closest('button[data-sign]');
    if (!b) return;
    sheetSign = Number(b.dataset.sign);
    document.querySelectorAll('#sheet-sign button').forEach((x) => x.classList.toggle('is-active', x === b));
  });
  $('sheet-cancel').addEventListener('click', closeSheet);
  $('sheet').addEventListener('click', (ev) => { if (ev.target === $('sheet')) closeSheet(); });
  $('sheet-ok').addEventListener('click', () => {
    const raw = num($('sheet-pnl').value);
    if (!isFinite(raw)) { toast('損益を入力してください'); return; }
    // 入力にマイナスが含まれていればそれを優先、なければセグメントの符号
    const pnl = String($('sheet-pnl').value).includes('-') || String($('sheet-pnl').value).includes('－')
      ? -Math.abs(raw) : sheetSign * Math.abs(raw);
    const now = new Date();
    const entry = { id: uid(), day: todayKey(now), at: now.toISOString(), pnl };
    if (sheetCtx?.type === 'close') {
      const p = sheetCtx.position;
      Object.assign(entry, { pair: p.pair, lots: p.lots, units: p.units, step: p.step });
      positions = positions.filter((x) => x.id !== p.id);
      save(KEYS.positions, positions);
    } else {
      Object.assign(entry, { pair: sheetPairSel.value, manual: true });
    }
    log.push(entry);
    save(KEYS.log, log);
    closeSheet();
    renderCalc();
    renderPositions();
    toast(`${yen(pnl, { sign: true })} を記録しました`);
  });
  $('sheet-pnl').addEventListener('keydown', (ev) => { if (ev.key === 'Enter') $('sheet-ok').click(); });

  $('btn-manual-log').addEventListener('click', () => openSheet({ type: 'manual' }));

  $('screen-pos').addEventListener('click', (ev) => {
    const closeBtn = ev.target.closest('[data-close]');
    if (closeBtn) {
      const p = positions.find((x) => x.id === closeBtn.dataset.close);
      if (p) openSheet({ type: 'close', position: p });
      return;
    }
    const delPos = ev.target.closest('[data-del-pos]');
    if (delPos) {
      if (!confirm('このポジションを記録せずに削除しますか？')) return;
      positions = positions.filter((x) => x.id !== delPos.dataset.delPos);
      save(KEYS.positions, positions);
      renderCalc(); renderPositions();
      return;
    }
    const delLog = ev.target.closest('[data-del-log]');
    if (delLog) {
      if (!confirm('この記録を削除しますか？')) return;
      log = log.filter((x) => x.id !== delLog.dataset.delLog);
      save(KEYS.log, log);
      renderCalc(); renderPositions();
    }
  });

  // ---------- 設定のイベント ----------
  const bindSetting = (id, key, parse, format) => {
    const el = $(id);
    el.addEventListener('input', () => {
      const v = parse(el.value);
      settings[key] = v;
      save(KEYS.settings, settings);
      renderCalc(); renderPositions();
    });
    if (format) el.addEventListener('blur', () => { el.value = format(settings[key]); });
  };
  bindSetting('set-capital', 'capital', (v) => Math.max(0, Math.round(num(v) || 0)), (v) => (v ? fmtInt(v) : ''));
  bindSetting('set-risk', 'riskPct', (v) => Math.max(0, num(v) || 0));
  bindSetting('set-daily', 'dailyPct', (v) => Math.max(0, num(v) || 0));
  $('set-lot').addEventListener('change', (ev) => { settings.lotUnit = Number(ev.target.value); save(KEYS.settings, settings); renderCalc(); });
  $('set-step').addEventListener('change', (ev) => { settings.step = Number(ev.target.value); save(KEYS.settings, settings); renderCalc(); });
  $('set-copy').addEventListener('change', (ev) => { settings.copyTarget = ev.target.value; save(KEYS.settings, settings); });

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('設定・保有・記録をすべて削除します。よろしいですか？')) return;
    Object.values(KEYS).forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    settings = { ...DEFAULT_SETTINGS };
    calc = { ...DEFAULT_CALC };
    rates = {}; positions = []; log = [];
    pairSel.value = calc.pair;
    $('in-entry').value = ''; $('in-stop').value = ''; $('in-pips').value = ''; $('in-rate').value = '';
    renderAll();
    toast('削除しました');
  });

  // 日付が変わったら本日集計を更新
  let lastDay = todayKey();
  setInterval(() => {
    const now = todayKey();
    if (now !== lastDay) { lastDay = now; renderCalc(); renderPositions(); }
  }, 60 * 1000);

  // ---------- 初期描画 ----------
  renderAll();
})();
