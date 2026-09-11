# CLAUDE.md

このリポジトリは Nash のプロフィール README と、`fx-lot-calculator/` にある **FX ロット計算アプリ**（ビルド不要の静的 Web アプリ）を含む。アプリの本番は Vercel（`vercel.json` が `fx-lot-calculator/` を配信、`api/` が Serverless Functions）。

## 構成

```
fx-lot-calculator/   アプリ本体（index.html / style.css / app.js / ocr.js / config.js / DESIGN.md / README.md）
api/quote.js         現在値 API: Twelve Data → Yahoo → Stooq → open.er-api → ECB
api/config.js        Supabase の公開設定を環境変数から返す
supabase/schema.sql  profiles / user_state テーブル、RLS、登録トリガー
scripts/dev.mjs      ローカル開発サーバー（依存なし、.env.local を読む）
tests/               node --test のユニットテスト、tests/e2e/ に Playwright の E2E
.claude/skills/      Impeccable（デザイン）と taste-skill 群。hooks は .claude/settings.json
```

## コマンド

```bash
npm run dev          # http://localhost:3000 （静的 + /api/*）
npm test             # ユニットテスト（api/quote.js のフォールバック、OCR パーサー）
npm run test:e2e     # E2E（要: npm i && npx playwright install chromium）
npm run design:detect  # Impeccable の機械検出（0 件を維持する）
```

Vercel CLI があるなら `vercel dev` でも動く。環境変数は `.env.example` を `.env.local` にコピーして記入。

## 開発の約束

- **計算ロジック**（`compute` / `budget`）は挙動を変えない。変える場合はユニットテストを先に足す。
- デザインは `fx-lot-calculator/DESIGN.md` のルールに従う（色トークン、文字尺度、700 はヒーロー数字のみ、和文の負トラッキング禁止、部品ごとの状態）。UI を触ったら `npm run design:detect` を 0 件に保つ。
- 静的アセットは `index.html` の `?v=YYYYMMDDx` を上げてキャッシュを無効化する（`vercel.json` は CSS/JS を `max-age=0` にしている）。
- データは既定で localStorage。Supabase が設定されているときだけ `user_state` に同期する（`save()` が write-through）。
- 外部 API（Yahoo など）は本番でしか疎通確認できないことがある。`/api/quote?pair=USD/JPY` の `source` / `tried` で切り分ける。
- コミットは英語の要約 + 日本語でも可。PR はドラフトで作り、Vercel のプレビューで確認してからマージする。

## Impeccable について

`.claude/settings.json` の hooks が編集後に設計検出を走らせる。エンジン本体は `.claude/scripts/install-impeccable-engine.sh` が npm（`@impeccable/cli-<os>-<arch>`）から `~/.impeccable/bin/<version>/` に入れる（SessionStart hook で自動）。`/impeccable critique fx-lot-calculator` などで使える。
