# 金鑰申請與自備額度 — 兩把鑰匙,和一條不用鑰匙的路

> 本課的 AI 功能用到兩種金鑰:Groq(文字補格,免費)與 OpenAI(桌布背景,計量付費)。這一頁一次講清楚:去哪申請、申請完貼到哪裡、各要花多少錢——以及完全不想申請 API 的人,怎麼用手上現成的 ChatGPT 訂閱走完全程。不用一開始就全辦齊:第 03 章才用到 Groq、第 05 章才碰生圖,到時候再回來查也行。

## 1. Groq API key(文字補格用,免費)

它負責什麼:第 03 章的「AI 補滿空格」與第 10 章的 9×9 展開——Worker 的 `/fill` 端點拿這把 key 呼叫 Groq 上的 LLM。

申請步驟(不用綁卡):

1. 開 https://console.groq.com/ ,用 Google 或 GitHub 帳號註冊登入。
2. 左側選單點 **API Keys** → **Create API Key**,取個名字(例如 `goal-grid`)。
3. 建立後立刻複製——key 只在這一刻完整顯示一次,長相是 `gsk_` 開頭的一長串。

免費額度:Groq 免費方案不收錢、不用信用卡,限制的是「請求頻率」(每分鐘/每日的次數上限,依模型而異)。本課的用量——補格一次只是一個請求——個人練習與小流量示範站綽綽有餘;真撞到上限,等幾分鐘就恢復。

申請完貼到哪裡?看你的角色:

| 角色 | 貼到哪 | 效果 |
|---|---|---|
| 站長(自部署 Worker) | 在 `worker-deploy/` 目錄執行 `npx wrangler secret put GROQ_API_KEY`,把 key 貼進去 | key 藏在 Worker Secret,訪客用你的額度,key 永不露出 |
| 學員自己玩 | app 頁尾「進階設定:自帶金鑰(BYO)」的 **Groq API Key** 欄位 | 只存你瀏覽器的 localStorage,補格改為前端直連 Groq、走你自己的額度 |

兩條路的差別第 03 章講過:BYO 直連只能自己玩(key 在前端,按 F12 看得到),要給別人用,key 必須進 Worker Secret——這是底線,不是建議。

## 2. OpenAI API key(AI 桌布背景用,計量付費)

它負責什麼:第 05-07 章的 AI 桌布背景。Worker 的 `/image` 端點主路走 OpenAI Images API(`gpt-image-1`),需要這把 key。

先講清楚一件最常被搞混的事:**API 跟 ChatGPT Plus 訂閱是兩回事**。Plus 的月費買的是「聊天介面的使用權」;API 是另一個錢包,按實際用量計費——就算你訂了 Plus,API 餘額仍然是零,要另外綁卡或儲值。反過來也成立:只用 API 不需要訂 Plus。

申請步驟:

1. 開 https://platform.openai.com/ 註冊(跟 chatgpt.com 是同一個帳號,但這裡是開發者後台)。
2. **Settings → Billing**:綁信用卡或先儲值一小筆(例如 5 美元)。沒做這步,key 建得出來也不能用。
3. **API keys** → **Create new secret key**,複製 `sk-` 開頭的 key——同樣只完整顯示一次。

要花多少錢:`gpt-image-1` 按生成量計費,一張 medium 品質的直式桌布(1024x1536)約 **0.06-0.07 美元**;本課 Worker 預設每 IP 每日 3 張,小流量示範站通常是每月幾美元的等級。品質檔位由 Worker 環境變數 `OPENAI_IMAGE_QUALITY` 控制(預設 medium,low 較省、high 較貴)。即便金額不大,仍強烈建議到 **Billing → Limits** 設用量上限(例如每月 10 美元),超過自動停——這是所有「綁了卡的服務」的基本安全帶。

貼到哪裡:只有一個地方——

```bash
cd worker-deploy
npx wrangler secret put OPENAI_API_KEY
```

注意:頁尾的 BYO 進階設定**沒有** OpenAI key 的欄位,這是刻意的——`sk-` key 連著你的信用卡,不該出現在任何網頁欄位裡。學員想用自己的 OpenAI 額度生圖,正路是照課程自部署一套 Worker(key 放進自己的 Secret),再到進階設定把「Worker 網址」指向它。

## 3. 不想申請 API?用 ChatGPT 介面手動生圖

完全不申請任何 key,也能拿到 AI 桌布——這就是第 07 章教的「prompt 是可攜帶的資產」降級路線,在 app 的步驟四就能走:

1. 展開「**服務忙線或想自己生?**」面板,點「**複製生圖 prompt**」——app 把組好的完整 prompt(風格詞、構圖約束、長寬比提示都在裡面)放進剪貼簿。
2. 貼到 https://chatgpt.com (或 Gemini)送出,等它生成。
3. 有上傳參考圖的話,記得自己把圖一併附給 ChatGPT——這條路不經過任何後端,參考圖本來就在你手上。
4. 生成後下載圖片,回到 app 點「**匯入背景圖**」放回來,後面的文字合成、下載 PNG 完全相同。

成本:用你現有的 ChatGPT 訂閱額度(免費帳號也能生圖,次數較少)。免 API key、免綁卡、站方後端全掛也走得通——對「只想拿到自己那張桌布」的使用者,這條常常反而是最快的路。

## 4. 三層架構一覽

Worker 的 `/image` 端點按這個順序決定走哪條路:有 `OPENAI_API_KEY` 就走 OpenAI;沒設但有 `CODEX_IMAGE_KEY` 就走自架的 codex-image-service;兩把都沒有,回 503 `not_configured`,前端把「複製 prompt 自己生」列為主要出路。

| 層 | 走哪裡 | 誰適合 | 成本 | 穩定度 |
|---|---|---|---|---|
| 主路 | OpenAI Images API(gpt-image-1,同步 90 秒) | 要正式給訪客用的站長 | 約 0.06-0.07 美元/張(medium 直式),計量付費 | 高:官方雲端服務 |
| 備援 | 自架 codex-image-service( https://github.com/yazelin/codex-image-service ) | 玩家級自架:家裡有機器、想燒 ChatGPT 訂閱額度而不是 API 帳單的人 | 沒有 API 帳單(走 ChatGPT 訂閱額度),但機器要自己養 | 中:homelab 等級,斷電斷網就停 |
| 降級 | prompt 外帶(複製 → ChatGPT/Gemini 手動生 → 匯回) | 任何人,包括一把 key 都沒有的訪客 | 用使用者自己現有的訂閱 | 不依賴本站任何後端,永遠走得通(代價是手動) |

設計觀:三層不是疊床架屋,而是讓每一種「壞掉」都有出路——站長還沒填 key、自架服務睡著了、今天額度用完了,訪客都不會被一句「請稍後再試」送客。三層在程式裡的長相,分別在第 05 章(主路與備援的呼叫)、第 07 章(prompt 外帶)、第 08 章(額度與錯誤文案)。

## 常見坑

1. **key 貼錯地方**:`gsk_`(Groq)兩個地方都能貼——站長進 Worker Secret、自己玩貼頁尾 BYO;`sk-`(OpenAI)只能進 Worker Secret,前端進階設定刻意沒有它的欄位。分辨法只要記一句:**會連到信用卡的 key,永遠不進瀏覽器**。
2. **OpenAI 沒綁卡就呼叫**:免費註冊的帳號沒有 API 額度,key 建得出來,一呼叫就是 429(insufficient_quota)。先到 Billing 綁卡或儲值,再測一次。
3. **key 外洩了**:截圖貼社群、commit 進 git、貼進聊天記錄,都算外洩。處理只有一招:立刻回對應後台 revoke(刪除)那把 key、重發一把新的,Worker 端 `wrangler secret put` 重新貼一次。兩家的 key 都可以無痛重發,猶豫才是最貴的。
4. **`secret put` 吃進多餘字元**:複製貼上時 key 尾端多帶一個換行或空白,Worker 就拿著「錯的 key」去呼叫、得到 401。這是本專案部署時真實踩過的雷——貼完多看一眼,懷疑時直接重 put 一次最快。
