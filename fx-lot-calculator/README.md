# FX Lot Calculator (MVP)

損切り幅と許容損失から発注ロットを即計算する、スマホ向けの単一ページWebアプリです。
ビルド不要（HTML / CSS / Vanilla JS）で、データはすべて端末の localStorage に保存されます。

## 機能

1. **価格から即計算** — エントリー価格と損切り価格を入力。pips 入力にも切替可能。
2. **残り損失枠で自動調整** — `日次上限 − 本日の確定損失 − 保有分の想定損失` を計算し、1回の許容損失（資金 × リスク率）と比較して小さい方を採用。スイッチでオフにもできます。
3. **発注単位の取り違え防止** — `2.5 lot = 25,000 通貨` のように併記。注文刻み（0.01 / 0.1 / 1 lot）で切り捨て。
4. **数量コピーと簡易記録** — 発注数量をワンタップでコピー。発注したら「保有に追加」、決済時に損益を記録。手入力の記録も可能。
5. **設定の端末保存** — 資金・リスク率・日次上限・1 lot の通貨数・注文刻み・入力値・換算レートを保存。

## 現在値の自動取得

通貨ペアを選ぶと現在値を取得してエントリー価格（と USD→円などの換算レート）に入れ、手入力するまで 60 秒ごとに追従します。入力欄の下のピルをタップすると、いつでも現在値に戻せます。設定画面の「現在値を自動取得」でオフにできます。

取得元は Vercel の Serverless Function `api/quote.js`（`GET /api/quote?pair=USD/JPY`）です。

1. Twelve Data（Vercel の環境変数 `TWELVEDATA_API_KEY` を設定した場合のみ。無料枠あり）
2. Yahoo Finance チャート API（分足、**参考値・遅延あり**）
3. Stooq（遅延あり）
4. open.er-api.com（日次レート）— 「日次」と表示
5. Frankfurter / ECB（日次レート）

`/api/quote?pair=USD/JPY` をブラウザで開くと、`source`（採用した取得元）と `tried`（失敗した取得元と理由）が見えるので、どこで止まっているか切り分けできます。

`/api/quote` が使えない環境（`file://` で開いた場合など）では、ブラウザから日次レート API を直接呼びます。表示される価格は発注数量の目安のためのもので、約定価格の保証はありません。

## 計算式

```
pip 幅        = JPY ペア: 0.01 / その他: 0.0001
損切り幅      = |エントリー − 損切り|（または pips × pip 幅）
1通貨の損失   = 損切り幅 × 決済通貨→円レート（JPY ペアは 1）
採用損失      = min(資金 × リスク率, 日次上限 − 本日確定損失 − 保有想定損失)
発注通貨数    = floor(採用損失 ÷ 1通貨の損失 ÷ 刻み通貨数) × 刻み通貨数
```

決済通貨が円以外（EUR/USD など）の場合は、決済通貨→円のレート（例: USD/JPY）を入力してください。

## 公開（Vercel）

リポジトリ直下の `vercel.json` が `outputDirectory: fx-lot-calculator` を指しているので、ビルドなしでこのディレクトリがそのまま配信されます。

1. https://vercel.com/new で GitHub の `Nash1209/Nash1209` を Import する
2. Framework Preset は **Other**、Build Command は空のまま。`vercel.json` が読まれない場合は **Root Directory** を `fx-lot-calculator` に設定する
3. Deploy を押すと `https://<project>.vercel.app/` で公開される。以降は `main` への push で自動更新

ワンクリック用リンク:
`https://vercel.com/new/clone?repository-url=https://github.com/Nash1209/Nash1209&project-name=fx-lot-calculator&root-directory=fx-lot-calculator`

## 使い方

`index.html` をブラウザで開くだけで動作します。GitHub Pages でも配信できます。
iPhone では Safari の「ホーム画面に追加」でアプリのように使えます。

## ファイル

```
fx-lot-calculator/
├── index.html   # 画面（計算 / 保有・記録 / 設定）
├── style.css    # iOS 風スタイル（オフホワイト・黒・深緑）
├── app.js       # 計算ロジック・現在値取得・localStorage 保存
└── DESIGN.md    # デザインルール
../api/quote.js  # 現在値 API（Vercel Serverless Function）
```
