# pachi-memo

自分用のパチンコ・スロット収支メモ。iPhoneのホーム画面に追加して使うPWA。GitHub Pagesで公開する。

## 最初に読むもの
- 仕様：`SPEC.md`（仕様の正。変更するときは先に SPEC.md を直し、利用者の了承を得てから実装する）
- 画面案：`docs/ui/`（PNGとHTML）

## 構成
- `index.html`：画面の土台とタブバー
- `css/style.css`：見た目（色はCSS変数。ダークモード対応）
- `js/calc.js`：計算ロジック（収支・状態・台番・回転率・入力候補・集計・バックアップ検証）。DOMや保存処理に依存させない
- `js/db.js`：IndexedDBへの保存
- `js/app.js`：画面描画とイベント
- `sw.js`：Service Worker（ネットワーク優先、オフライン時はキャッシュ）
- `manifest.webmanifest`、`icons/`：ホーム画面用
- `tests/calc.test.js`：calc.js の単体テスト

## ルール
- ビルドなし・フレームワークなし・外部ライブラリなし（素のHTML/CSS/JS、ES Modules）
- 計算ロジックは必ず `js/calc.js` に置き、テストを追加する
- テスト：`npm test`（= `node --test tests/*.test.js`）。プッシュ前に必ず通す
- 画面の文言は日本語。プラスは青（`--pos`）、マイナスは赤（`--neg`）
- iPhone対策：入力欄の文字は16px以上（自動ズーム防止）、タップ領域は44px以上、数字入力は `inputmode="numeric"`
- 保存データの形を変えるときは、`parseBackup` が古い書き出しファイルも読めるようにする
- `sw.js` の ASSETS にファイルを追加・削除したら、`CACHE` の番号を上げる
- シンプルさを最優先する。利用者の了承なしに機能や設定項目を増やさない
