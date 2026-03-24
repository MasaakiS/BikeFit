# Bicycle Geometry Fit Tester

自転車のジオメトリ情報と自身の身体情報を入力し、最適なサイズかどうかを診断するWebアプリケーションです。

👉 **[デモ・サンプルをWebで試す](https://masaakis.github.io/BikeFit/)**


## 特徴
- 身長、股下、腕の長さから理想的なジオメトリ（スタック、リーチ、シートチューブ、トップチューブ）を自動計算します。
- 選択した自転車のジオメトリと比較し、許容誤差範囲（Tolerance）内かどうかを診断します。
- どのパーツが長すぎる／短すぎるのかを詳細にフィードバックします。
- モダンなダークテーマとグラスモーフィズムを取り入れたUIデザインです。

## 構成ファイル
- `index.html`: アプリの基本構造と入力フォーム
- `style.css`: カスタムCSSによるリッチなスタイリング
- `script.js`: サイジングの診断ロジックおよび画面の動きを制御するプログラム
- `README.md`: 本ドキュメント

## GitHub Pages へのデプロイ方法
このアプリケーションはピュアなHTML/CSS/JSで構成されているため、特別なビルド環境なしにGitHub Pagesで直接公開できます。

### 手順
1. GitHubで新しいリポジトリを作成します。
2. ターミナルを開き、このプロジェクトのディレクトリ内で以下のコマンドを実行して、ソースコードをGitHubにプッシュします。
   ```bash
   git init
   git add .
   git commit -m "Initial commit for Bike Fit Tester"
   git branch -M main
   # 以下は自分のGitHubリポジトリのURLに置き換えてください
   git remote add origin https://github.com/あなたのユーザー名/リポジトリ名.git
   git push -u origin main
   ```
3. GitHubリポジトリの設定（Settings）を開きます。
4. 左サイドバーから **Pages** を選択します。
5. **Build and deployment** セクションの **Source** で `Deploy from a branch` を選択します。
6. **Branch** で `main` を選択し、フォルダは `/ (root)` を選択して **Save** をクリックします。
7. 数分待つと、ページ上部に公開されたURLが表示されます。そのURLにアクセスすればアプリが利用可能です。

## カスタマイズについて
- フィッティングの計算ロジックや許容誤差（tolerance）は `script.js` 内の `BikeFitAnalyzer` クラスで定義されています。ロードバイク専用、マウンテンバイク専用など、用途に応じて係数を調整できます。
- カラーテーマやアニメーションは `style.css` で変更可能です。
# BikeFit
