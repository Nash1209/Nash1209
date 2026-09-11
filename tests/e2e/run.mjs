#!/usr/bin/env node
// ブラウザ E2E テスト（Playwright）。開発サーバーを起動してから各シナリオを実行する。
//   npm i            （devDependencies の playwright）
//   npx playwright install chromium
//   npm run test:e2e
// 既存の Chromium を使う場合: PW_CHROMIUM=/path/to/chrome npm run test:e2e
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { chromium } from 'playwright';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = join(here, '..', '..');
const PORT = Number(process.env.PORT) || 3456;
const OUT = join(here, 'out');
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [join(ROOT, 'scripts', 'dev.mjs')], { env: { ...process.env, PORT: String(PORT) }, stdio: 'ignore' });
await new Promise((r) => setTimeout(r, 600));

let failed = 0;
const check = (label, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${label}${detail ? ' — ' + detail : ''}`); if (!ok) failed++; };

const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined, args: ['--no-sandbox'] });
const newPage = async ({ width = 390, height = 844, configJs = null } = {}) => {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.route('**/api/quote**', (r) => {
    const pair = new URL(r.request().url()).searchParams.get('pair');
    const prices = { 'USD/JPY': 150.123, 'EUR/USD': 1.08512, 'GBP/JPY': 190.55, 'XAU/USD': 2400.5 };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ pair, price: prices[pair] || 1, time: Date.now(), source: 'mock', daily: false }) });
  });
  await ctx.route(/open\.er-api\.com|frankfurter|supabase\.co|jsdelivr|cdnjs/, (r) => r.abort());
  if (configJs) await ctx.route('**/config.js*', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: configJs }));
  const page = await ctx.newPage();
  page.errs = []; page.on('pageerror', (e) => page.errs.push(String(e)));
  await page.goto(`http://localhost:${PORT}/`); await page.evaluate(() => localStorage.clear()); await page.reload();
  return page;
};
const read = (p) => p.evaluate(() => ({
  lots: document.getElementById('res-lots').textContent, units: document.getElementById('res-units-line').textContent.trim(),
  entry: document.getElementById('in-entry').value, copy: document.getElementById('btn-copy-label').textContent,
  pill: document.getElementById('live-pill').dataset.state, remaining: document.getElementById('bd-remaining').textContent,
}));

try {
  // ---- 計算画面 ----
  let page = await newPage({ configJs: 'window.FXLOT_CONFIG={supabaseUrl:"",supabaseAnonKey:""};' });
  await page.waitForFunction(() => document.getElementById('live-pill').dataset.state === 'ok');
  let r = await read(page);
  check('現在値がエントリーに自動入力される', r.entry === '150.123', r.entry);
  await page.fill('#in-stop', '149.823'); await page.waitForTimeout(150); r = await read(page);
  check('USD/JPY 30pips → 3.33 lot / 33,300 通貨', r.lots === '3.33' && r.units === '33,300 通貨', `${r.lots} ${r.units}`);
  await page.click('#btn-copy'); await page.waitForTimeout(200);
  check('コピー後にボタンが「コピーしました」になる', (await page.textContent('#btn-copy-label')).includes('コピーしました'));
  check('クリップボードに 3.33', (await page.evaluate(() => navigator.clipboard.readText())) === '3.33');
  await page.fill('#in-entry', '151.000'); await page.fill('#in-stop', '151.300'); await page.waitForTimeout(150);
  check('買いで損切りが上ならエラー', (await page.textContent('#calc-helper')).includes('エントリーより下'));
  await page.selectOption('#in-pair', 'XAU/USD'); await page.waitForFunction(() => document.getElementById('in-entry').value === '2400.50');
  await page.fill('#in-stop', '2390.50'); await page.fill('#in-rate', '150'); await page.waitForTimeout(150); r = await read(page);
  check('XAU/USD は oz 単位で計算', r.lots === '0.06' && r.units === '6 oz', `${r.lots} ${r.units}`);
  await page.screenshot({ path: join(OUT, 'calc-xau.png') });
  // 残り枠ゼロ
  await page.evaluate(() => localStorage.setItem('fxlot.settings.v1', JSON.stringify({ capital: 1000000, riskPct: 1, dailyPct: 0 })));
  await page.reload(); await page.selectOption('#in-pair', 'USD/JPY'); await page.waitForTimeout(400); await page.fill('#in-stop', '149.700'); await page.waitForTimeout(150); r = await read(page);
  check('残り枠ゼロで 0 lot・コピー無効', r.lots === '0' && (await page.evaluate(() => document.getElementById('btn-copy').disabled)), r.lots);
  check('計算画面に JS エラーなし', page.errs.length === 0, page.errs.join('; '));

  // ---- 記録・グラフ・OCR ----
  page = await newPage({ configJs: 'window.FXLOT_CONFIG={supabaseUrl:"",supabaseAnonKey:""};' });
  await page.evaluate(() => {
    const d = new Date(); const p = (n) => String(n).padStart(2, '0'); const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const mk = (pair, pnl, i) => ({ id: 'l' + i, day, at: new Date(Date.now() - i * 60000).toISOString(), pnl, pair, manual: true });
    localStorage.setItem('fxlot.log.v1', JSON.stringify([mk('USD/JPY', 12000, 1), mk('EUR/USD', -4500, 2), mk('XAU/USD', 8000, 3)]));
  });
  await page.reload(); await page.click('.tab[data-screen="pos"]'); await page.waitForTimeout(300);
  check('ドーナツ中央に純損益と勝率', (await page.textContent('.donut-net')) === '+¥15,500' && (await page.textContent('.donut-sub')).includes('勝率 67%'));
  await page.screenshot({ path: join(OUT, 'records-chart.png') });
  await page.evaluate(() => { window.FxOcr.recognize = async () => ({ text: '', items: window.FxOcr.parse('USD/JPY 損益 +12,345円\nEURUSD ▲3,210') }); });
  await page.click('#btn-manual-log'); await page.setInputFiles('#ocr-file', { name: 's.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a', 'hex') });
  await page.waitForSelector('#ocr-add'); await page.click('#ocr-add'); await page.waitForTimeout(300);
  check('OCR 候補を記録に追加', (await page.evaluate(() => JSON.parse(localStorage.getItem('fxlot.log.v1')).length)) === 5);

  // ---- ログイン（疑似 Supabase） ----
  const FAKE = `window.supabase={createClient(u,k,o){const st=o.auth.storage,L=[],K='sb-fake';const db=JSON.parse(localStorage.getItem('fake-db')||'{"users":{},"rows":{}}');const P=()=>localStorage.setItem('fake-db',JSON.stringify(db));const S=()=>{try{return JSON.parse(st.getItem(K))}catch{return null}};const set=(s)=>s?st.setItem(K,JSON.stringify(s)):st.removeItem(K);const c={__storage:st===localStorage?'local':'session',auth:{async getSession(){return{data:{session:S()}}},onAuthStateChange(cb){L.push(cb);return{data:{subscription:{unsubscribe(){}}}}},async signInWithPassword({email,password}){const u=db.users[email];if(!u||u.password!==password)return{data:{},error:{message:'Invalid login credentials'}};if(!u.confirmed)return{data:{},error:{message:'Email not confirmed'}};const s={user:{id:u.id,email}};set(s);return{data:s,error:null}},async signUp({email,password,options}){db.users[email]={id:'u_'+email,password,confirmed:true,meta:options?.data};P();return{data:{user:{id:'u_'+email,email},session:null},error:null}},async resetPasswordForEmail(){return{error:null}},async updateUser(){return{data:{user:S()?.user},error:null}},async signOut(){set(null);L.forEach(l=>l('SIGNED_OUT',null));return{error:null}}},from(){return{async upsert(row){db.rows[row.user_id+':'+row.key]=row;P();return{error:null}},select(){return{eq:async(c,v)=>({data:Object.values(db.rows).filter(r=>r.user_id===v),error:null})}}}}};window.__client=c;return c}};window.FXLOT_CONFIG={supabaseUrl:'https://fake.supabase.co',supabaseAnonKey:'anon'};`;
  page = await newPage({ configJs: FAKE });
  await page.waitForFunction(() => !document.getElementById('screen-auth').hidden);
  check('Supabase 設定時はログイン画面が出る', true);
  await page.screenshot({ path: join(OUT, 'auth-login.png') });
  await page.click('#seg-auth button[data-view="signup"]'); await page.fill('#signup-email', 'a@example.com'); await page.fill('#signup-password', 'pass1234');
  await page.click('label.check:has(#signup-newsletter)'); await page.click('#signup-submit'); await page.waitForTimeout(200);
  check('登録後に確認メールの案内', (await page.textContent('#auth-msg')).includes('確認メール'));
  await page.fill('#login-password', 'pass1234'); await page.click('#login-submit'); await page.waitForTimeout(400);
  check('ログイン後に画面が閉じる', await page.evaluate(() => document.getElementById('screen-auth').hidden));
  await page.click('.tab[data-screen="settings"]'); await page.fill('#set-risk', '2'); await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.setItem('fxlot.settings.v1', JSON.stringify({ capital: 5 })));
  await page.reload(); await page.waitForTimeout(600);
  check('リロード後も自動ログインし、クラウドの設定が復元される', (await page.inputValue('#set-risk')) === '2' && (await page.inputValue('#set-capital')) === '1,000,000');
  await page.click('.tab[data-screen="settings"]'); await page.click('#acct-logout'); await page.waitForTimeout(300);
  check('ログアウトでログイン画面に戻る', await page.evaluate(() => !document.getElementById('screen-auth').hidden));
  check('認証画面に JS エラーなし', page.errs.length === 0, page.errs.join('; '));
} catch (e) {
  failed++; console.error('E2E error:', e);
} finally {
  await browser.close(); server.kill();
}
console.log(failed ? `\n${failed} check(s) failed` : '\nall e2e checks passed');
process.exit(failed ? 1 : 0);
