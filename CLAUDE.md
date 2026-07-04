# CLAUDE.md

This file guides Claude Code (and other AI assistants) when working in this repository.

## プロジェクト概要

FBC（フィヨルドブートキャンプ）の「バズ」を登録・確認するための Chrome 拡張機能（Manifest V3, ビルド不要）。

- `extension/` … 拡張機能本体（`manifest.json` / `background.js` / `popup/` / `content/`）
- API 通信は `background.js`（service worker）が担当し、`config.js` の `BASE_URL` で接続先を切り替える
- `content/buzz-marker.js` … X・はてなブックマーク・Google 検索で登録済みリンクに「✓ 登録済み」バッジを付ける content script

## バージョン番号の更新ルール（重要 / AI が更新する）

**`extension/` 配下のコードを変更したら、AI（Claude）が必ずバージョン番号を上げること。** 人手や git フックには任せない。ユーザーが `chrome://extensions` の表示バージョンで「最新が読み込まれているか」を判別できるようにするため。

- **どこを更新するか**: `extension/manifest.json` の `version` と、`package.json` の `version` を**必ず両方**上げる（値を揃える）。
  - 例: `manifest.json` が `"1.7"` なら `package.json` は `"1.7.0"`。
- **上げ幅**: 原則 minor を +1（`1.7` → `1.8`）。新機能・対応サイト追加・不具合修正など、拡張の挙動が変わる変更はすべて対象。
- **タイミング**: その変更のコミットに、コード変更と一緒に含める（バージョンだけ後回しにしない）。
- ドキュメントや `README.md` のみの変更ではバージョンを上げなくてよい。

## 開発時のルール

- コミット前に `npm run lint`（prettier + eslint）が通ることを確認する。整形は `npm run fix`。
- `main` へ直接コミット・push しない。ブランチを切って PR を作る（このリポジトリは PR マージ運用）。
- content script のセレクタは対象サイトの DOM 変更で壊れやすい。サイト別の差分は `content/buzz-marker.js` の各アダプタ（`X_ADAPTER` / `HATENA_ADAPTER` / `GOOGLE_ADAPTER`）に閉じ込める。
