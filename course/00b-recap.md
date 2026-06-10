# 前課銜接 — 四個會一直用到的零件

> 本課假設你上過「AI 互動行銷頁實作課」( https://yazelin.github.io/ai-marketing-pages-course/ )。這頁用半頁複習四個會一直用到的核心,每段附前課傳送門;四段都覺得「嗯,我知道」,就直接開工。

## 1. GitHub Pages:把資料夾變成網址

repo 裡放 `index.html` → Settings → Pages → Branch 選 `main`、`/ (root)` → 一兩分鐘後拿到 `https://你的帳號.github.io/repo名/` 。改版 = 重新 commit,稍等就生效。本課的成品 app 與所有 demo 都是這樣上線的。

複習:前課模組 5「上線:部署決策樹 + GitHub Pages」
https://yazelin.github.io/ai-marketing-pages-course/course/05-deployment.md

## 2. Cloudflare Worker:幫頁面藏 key 的免費代理

API key 等於信用卡,放進網頁任何人按 F12 都看得到。解法是中間加一個 Worker:網頁呼叫 Worker、Worker 拿著藏在 Secret 裡的 key 呼叫 AI、把答案傳回來。

```text
訪客瀏覽器 ──> Cloudflare Worker(key 藏在 Secret)──> AI API
 GitHub Pages          免費 10 萬次/天
```

前課一個 Worker 做一件事;本課升級成「一個 Worker 三個職責」:`/fill` AI 補格、`/image` 生圖代理、`/signup` 收名單,從第 03 章起逐章蓋出來。

複習:前課模組 6「頁面即時呼叫 AI」
https://yazelin.github.io/ai-marketing-pages-course/course/06-live-ai-on-page.md

## 3. AI prompt 範本的用法

本課每章都有「給 AI 的 prompt 範本」,用法跟前課完全一樣:用【】分節把 brief 寫清楚(要什麼、資料長怎樣、風格、驗收標準)→ 整段貼給 ChatGPT / Claude → 存檔開啟、逐項驗收 → 修改靠對話下指令,一次只改一兩件事。你是總監,AI 是工讀生,驗收清單就是你的武器。

複習:前課模組 1「第一個活動頁」與模組 8「Prompt 兵法」
https://yazelin.github.io/ai-marketing-pages-course/course/01-first-landing-page.md
https://yazelin.github.io/ai-marketing-pages-course/course/08-prompt-playbook.md

## 4. demo 09 的 email 收集模式

前課最後做過一條名單收集線:報名頁 POST email → Worker 驗證(email 格式、honeypot 隱形欄位、每 IP 限流)→ 寫進 D1 資料庫(UNIQUE 去重)→ admin 後台用 Authorization 標頭帶 token 看名單、匯出 CSV。本課第 09 章直接沿用這個模式,再加上 Turnstile 與「留 email 當場拿模板」的誘因設計。

複習:前課模組 9「收 email 名單」
https://yazelin.github.io/ai-marketing-pages-course/course/09-email-list.md

## 30 秒自我檢查

- 我能在十分鐘內把一個資料夾變成公開網址(不行 → 模組 5)
- 我說得出「為什麼 API key 不能放進網頁」(說不出 → 模組 6)
- 我貼過至少一次【】分節的 prompt,並照清單驗收過成品(沒有 → 模組 1、8)
- 我知道 honeypot 跟 admin token 各在防什麼(不知道 → 模組 9)

四項都打勾,就從第 01 章開始 —— 那章不寫程式,講一個行銷人必修的真實命名故事。
