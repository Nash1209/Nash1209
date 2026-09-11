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

## 対応銘柄

通貨ペア 16 種と **XAU/USD（ゴールド）**。ゴールドは 1 lot = 100 oz（設定で 10 / 1 oz に変更可）、1 pip = 0.1、価格は小数 2 桁で扱い、損失は USD→円レートで換算します。

## 損益の内訳

保有・記録画面に、利益と損失の割合を示すドーナツ（中央は純損益と件数・勝率）と、通貨ペア別の内訳を表示します。記録を追加・削除するたびに自動で更新され、今日／今月／全期間で切り替えられます。

## スクショから記録

「記録を追加」シートの「取引履歴のスクショから読み取る」で画像を選ぶと、ブラウザ内 OCR（Tesseract.js、日本語＋英語）で損益と銘柄を読み取り、候補を一覧にします。内容を確認・修正してから「選択した N 件を記録」で追加します。初回は辞書（約 15MB）の取得に時間がかかります。読み取り精度は画像次第なので、必ず確認してから記録してください。

## ログインとクラウド保存（Supabase）

ログイン機能は任意です。未設定のときは端末内保存のみで動きます。

1. [Supabase](https://supabase.com) でプロジェクトを作成し、SQL Editor で `supabase/schema.sql` を実行する
2. Authentication → Providers → Email で **Confirm email を ON**、**Minimum password length を 8** にする
3. Authentication → URL Configuration の Site URL / Redirect URLs に公開 URL（例 `https://nash1209.vercel.app`）を登録する
4. Vercel の Environment Variables に `SUPABASE_URL` と `SUPABASE_ANON_KEY`（Project Settings → API の URL と anon public key）を設定して再デプロイする（`config.js` に直接書いても可）

できること:

- メールアドレス＋パスワード（8 文字以上）での登録。確認メールのリンクを開くと有効化
- 登録時に「お知らせメールを受け取る」の許諾を取得し、`profiles.newsletter_opt_in` に保存
- 「次回から自動でログイン」にチェックすると端末に保持（外すとタブを閉じるまで）
- 「パスワードを忘れた場合」から再設定メールを送信。リンクを開くと新しいパスワードを設定
- 設定・保有・記録・換算レートを `user_state` テーブルに同期（RLS で本人のみ読み書き可）
- 「ログインせずに使う」でこれまでどおり端末内保存のみ

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
├── app.js       # 計算ロジック・現在値取得・損益グラフ・ログイン・同期
├── ocr.js       # スクショ OCR（Tesseract.js の読み込みと損益の抽出）
├── config.js    # Supabase の公開設定（任意）
└── DESIGN.md    # デザインルール
../api/quote.js   # 現在値 API（Vercel Serverless Function）
../api/config.js  # Supabase 設定を環境変数から渡す API
../supabase/schema.sql  # テーブル・RLS・トリガー
```
