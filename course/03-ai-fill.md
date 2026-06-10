# 第 3 章 — AI 補格:Worker + LLM JSON 輸出 + prompt 設計

## 學完能做什麼

- 在九宮格頁面加一顆「AI 補滿空格」按鈕:留空的格子交給 AI,自己填的格子一字不動。
- 看懂並改寫一份「會回 JSON 的 prompt」——這是所有「AI 結果要進程式」的場景的共通技能。
- 知道為什麼 AI 失敗時要「退還額度」,以及這件事在程式裡長什麼樣子。

## 核心觀念:AI 補格不是 AI 代寫

第 2 章的資料模型已經埋好伏筆:每個格子要嘛是 `null`(留給 AI),要嘛是 `{text, source}`(使用者寫的)。這一章的所有設計都從這個約定長出來——**`null` 是授權,有字是主權**。AI 只能填 `null` 的格子;使用者寫過的字,連 AI 想「順手潤飾」都不行。這不只是禮貌,是產品立場:目標是使用者的,AI 是教練不是代筆。

第二個觀念是「跟 AI 約格式」。前課模組 6 的聊天小幫手,AI 愛怎麼回都行,反正人在讀;這一章不一樣——AI 的回答要直接塞回九個格子,**程式在讀**。所以我們要求 AI 只准輸出 JSON,而且程式收到後還要逐項驗收:長度對不對、有沒有偷改使用者的字。對 AI 的態度跟對廠商一樣:合約寫清楚,驗收不能省。

## 步驟

### 1. 複習:key 為什麼還是不能放前端

跟前課模組 6 完全同一個理由:網頁程式碼任何人按 F12 都看得到,Groq API key 放前端等於把信用卡貼在店門口。所以中間加一個 Cloudflare Worker,key 藏在 Worker 的 Secret 裡:

```text
訪客瀏覽器 ──POST /fill──> Cloudflare Worker(GROQ_API_KEY 藏在這)──> Groq API
  GitHub Pages                順便做:每日額度、失敗退款、結果驗收
```

差別在於:這次 Worker 不只是「代打電話」,它還負責驗證輸入、扣額度、驗收 AI 的輸出。一個 Worker、多個職責,後面幾章會繼續往裡面加東西。

### 2. 跟 AI 約好只回 JSON

呼叫 Groq 時帶 `response_format: { type: "json_object" }`,模型就會被強制只輸出 JSON(這是 OpenAI 相容 API 的標準參數)。Worker 端的呼叫長這樣(`worker-deploy/src/lib/groq.js`):

```js
const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
  method: "POST",
  headers: {
    Authorization: `Bearer ${env.GROQ_API_KEY}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    model: "openai/gpt-oss-120b",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }, // 跟 AI 約好:只准回 JSON
    max_tokens: 600,
    temperature: 0.8,
  }),
});
```

即使如此,程式仍要「防禦性解析」——模型偶爾會把 JSON 包在 ```` ```json ```` 程式碼框裡。先直接 `JSON.parse`,失敗再去框裡撈一次:

```js
export function parseJSONLoose(text) {
  const s = String(text ?? "");
  try { return JSON.parse(s); } catch { /* 繼續 */ }
  const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  if (m) {
    try { return JSON.parse(m[1]); } catch { /* 落空 */ }
  }
  return null;
}
```

### 3. 補格 prompt 逐段拆解

成品的 prompt 在 `worker-deploy/src/lib/prompts.js`,`corePrompt(cells)` 接一個長度 9 的陣列(空格是 `null`),組出這樣一段話:

```js
export function corePrompt(cells) {
  const goal = cells[4] ? `核心目標:「${cells[4]}」` : "核心目標也留空,請先推斷一個具體可衡量的核心目標";
  const filled = cells.map((c, i) => c && i !== 4 ? `位置${i}:「${c}」` : null).filter(Boolean).join("\n") || "(其餘全空)";
  return `你是目標設定教練,使用「九宮格目標法」(源自原田メソッド,即大谷翔平用過的目標達成表的方法)。
使用者的 3×3 九宮格:中央(位置4)是核心目標,周圍 8 格(位置0-3、5-8)是支撐核心目標的子目標。
${goal}
已填的格子:
${filled}
請補滿所有空格。規則:
1. 子目標要具體、彼此不重複、共同支撐核心目標;盡量涵蓋「心・技・體・生活」四個面向(原田メソッド慣例)。
2. 每格 2-8 個字,繁體中文(台灣用語),不用標點結尾,不用 emoji。
3. 已填的格子原樣保留,一字不改。
只輸出 JSON:{"cells":["位置0文字","位置1文字",...,"位置8文字"]},長度必為 9。`;
}
```

一段一段看它在做什麼:

1. **角色與方法論**(第一行):給 AI 一個立場——「目標設定教練」,並把方法淵源(原田メソッド、大谷案例)寫進去。這不是裝飾:模型知道這套方法的結構,補出來的子目標才會「支撐核心目標」而不是八個不相干的願望。
2. **格局說明**(第二行):模型「看」不到九宮格,它只看得到文字,所以位置對應要講到死——中央是位置 4、周圍是位置 0-3 和 5-8。所有「AI 結果要對回版面」的場景都要做這件事。
3. **動態組裝**(`${goal}` 和 `${filled}`):把使用者已填的內容連同位置編號餵回去。注意第一行的三元判斷——連核心目標都留空時,不是報錯,而是請 AI「先推斷一個具體可衡量的核心目標」。輸入不完整時優雅補位,而不是把問題丟回給使用者。
4. **規則 1 是品質規則**:具體、不重複、共同支撐,以及「心・技・體・生活」四面向——這是原田メソッド的慣例,寫進去之後 AI 補的格子明顯比較不會八格全是「努力練習」這種同義反覆。
5. **規則 2 是版面規則**:每格 2-8 個字、不用標點結尾。這些字最後要塞進桌布上的小格子,字數是版面問題,不是文采問題——在 prompt 層先控制,比事後裁切體面。
6. **規則 3 加最後一行是合約**:已填的一字不改、只輸出 JSON、長度必為 9。下一步你會看到,程式端對這三條每一條都有對應的驗收。

進階模式的 `expandPrompt`(把一個子目標展開成 8 個具體行動)套路相同,差異有兩個值得學:行動的品質標準改成「可每日/每週檢核」,而且直接舉大谷的實例——「大谷在『運』底下寫『撿垃圾』『打招呼』這種日常小事」。**給 AI 一個具體範例,比三行形容詞都有效**。

### 4. Worker 端:先扣後跑、失敗退款、驗收輸出

`worker-deploy/src/index.js` 的 `handleFill` 把整個流程串起來(節錄重點):

```js
// 先扣後跑:額度先 -1 再呼叫 AI(防止同時送兩發繞過上限)
const quota = await takeQuota(env.DB, { kind: "fill", ip, limit: 12, day });
if (!quota.ok) {
  return json({ error: "quota_exceeded", resetAt: taipeiResetAt() }, 429, cors);
}

let out = null;
try { out = await chatJSON(env, prompt, 600); } catch { out = null; }

// 驗收:必須是長度 9 的字串陣列,否則退款 + 回報 llm_failed
const arr = Array.isArray(out?.cells) ? out.cells : null;
if (!arr || arr.length !== 9 || arr.some((x) => typeof x !== "string" || !x.trim())) {
  await refundQuota(env.DB, { kind: "fill", ip, day }); // 確定失敗 → 把額度還給使用者
  return json({ error: "llm_failed" }, 502, cors);
}
const cells = arr.map((x) => x.trim());
normCells.forEach((c, i) => { if (c) cells[i] = c; }); // 已填格被 AI 改了?用原值蓋回去
return json({ cells }, 200, cors);
```

三件事值得停下來看:

- **先扣後跑**:額度先扣再呼叫 AI。如果反過來「先跑再扣」,有人同時送十發請求,每一發檢查額度時都還沒被扣,十發全過——上限形同虛設。
- **失敗退款**:AI 掛了、回了垃圾,都不是使用者的錯,額度退還(`refundQuota`),前端文案才能理直氣壯寫「失敗不會重複扣額度」。先扣是防濫用,退款是對人公平,兩件事不衝突。
- **雙保險**:prompt 規則 3 已經叫 AI「已填的一字不改」,程式還是再蓋一次原值。prompt 是請求,程式是保證——使用者的字不能靠 AI 的自覺來保護。

### 5. 模型選型:一個真實的雷

這個專案用 `openai/gpt-oss-120b` 而不是前課模組 6 的 `llama-3.3-70b-versatile`,是踩過雷的選擇:聊天場景 llama-3.3-70b 在 Groq 上好好的,但一旦要求**結構化輸出**(tool-call、嚴格 JSON),它在 Groq 上常常直接被退單或格式跑掉;換 `openai/gpt-oss-120b` 就穩了。

通則:「會聊天」和「會交格式正確的資料」是兩種能力,選模型要照你的場景測,不要照排行榜。換模型的成本很低——上面程式碼裡的一個字串而已,值得多試幾顆。

### 6. 接上前端

前端呼叫只是一個普通的 `fetch`(`app/js/api.js` 的 `fillCore`),拿回 `cells` 之後,只把原本是 `null` 的格子寫入 state、標記 `source: 'ai'`,UI 上給 AI 填的格子一個淡金邊框和「AI」徽章——讓使用者一眼分清哪些字是自己的、哪些是 AI 的,並且每一格都可以改寫或重抽。

## 給 AI 的 prompt 範本

下面這段貼給 ChatGPT/Claude,可以重現本章的單檔練習版(自帶 Groq key 直連,適合自己玩;正式上線請照本章 Worker 架構把 key 藏起來):

```text
請幫我做一個單檔網頁(所有 CSS/JS 內嵌在同一個 HTML),功能是「AI 目標九宮格」:

【版面】3×3 九宮格,每格一個 textarea;中央格是核心目標(外觀強調);
空格的 placeholder 寫「留給 AI」。下方一顆「AI 補滿空格」按鈕和一個訊息區。
深夜藍底(#0e1420)配金色強調(#c9a44e),繁體中文,不用 emoji。

【資料模型】用一個長度 9 的陣列存格子,index 4 = 核心目標;
空格存 null,有字的格子存 {text, source:'user'|'ai'}。
每次輸入即存 localStorage,重新整理不丟。

【AI 呼叫】頁面最下方有一個輸入框讓我貼自己的 Groq API key(只存 localStorage)。
按「AI 補滿空格」時 POST https://api.groq.com/openai/v1/chat/completions ,
model 用 "openai/gpt-oss-120b",帶 response_format: {type:"json_object"},
temperature 0.8,max_tokens 600。

【prompt】程式組 prompt 時原樣使用下面這段(${} 處帶入資料):
你是目標設定教練,使用「九宮格目標法」(源自原田メソッド,即大谷翔平用過的目標達成表的方法)。
使用者的 3×3 九宮格:中央(位置4)是核心目標,周圍 8 格(位置0-3、5-8)是支撐核心目標的子目標。
${核心目標,留空時改寫成:核心目標也留空,請先推斷一個具體可衡量的核心目標}
已填的格子:
${每個已填格一行:位置i:「文字」;全空時寫(其餘全空)}
請補滿所有空格。規則:
1. 子目標要具體、彼此不重複、共同支撐核心目標;盡量涵蓋「心・技・體・生活」四個面向(原田メソッド慣例)。
2. 每格 2-8 個字,繁體中文(台灣用語),不用標點結尾,不用 emoji。
3. 已填的格子原樣保留,一字不改。
只輸出 JSON:{"cells":["位置0文字","位置1文字",...,"位置8文字"]},長度必為 9。

【驗收規則】收到回應後:先 JSON.parse,失敗再從 ```json 程式碼框裡撈;
cells 必須是長度 9 的字串陣列,否則顯示「這次沒有生成成功,請重試」;
只把原本是 null 的格子寫入(來源標 'ai',格子加淡金邊框和 AI 徽章),
原本有字的格子一律保留原值不覆蓋。
九格全空時按鈕要擋下並提示「至少先填一格」;九格全滿時提示不需要補。
```

## 常見坑

1. **key 貼進前端就上線**:練習版的「貼 key 直連」只能自己玩。要給別人用,key 必須照本章架構搬進 Worker Secret——這是底線,不是建議。
2. **相信 AI 會乖乖回 JSON**:`response_format` 大幅降低翻車率,但不是零。`parseJSONLoose` 加長度驗證那兩層不能省,省了就是某天頁面莫名其妙顯示 `undefined`。
3. **AI「好心」改了使用者的字**:prompt 叫它別改,它偶爾還是改。程式端用原值蓋回去那一行(`normCells.forEach`)才是真正的保護。
4. **失敗也扣額度**:忘了退款,使用者遇到 AI 故障還被扣次數,客訴文案都不知道怎麼寫。記住口訣:先扣後跑、確定失敗就退。
5. **拿聊天模型做結構化輸出**:llama-3.3-70b 在 Groq 上跑 tool-call/JSON 會被退是實戰雷。換場景要重測模型,別沿用上一個專案的選擇。
6. **prompt 沒寫字數限制**:AI 給你一格三十個字的「子目標」,桌布版面直接爆炸。版面約束要寫進 prompt(每格 2-8 個字),別等渲染時才處理。

## 對照成品

- `demos/02-ai-fill/` — 本章的單檔練習版:九宮格 + 貼自己的 Groq key 直連補格,不依賴 Worker,雙擊就能玩。
- `app/` — 完整版:同一套 prompt 放在 Worker(`worker-deploy/src/lib/prompts.js`),走 `/fill` 端點,key 藏在 Secret,加上額度與退款;前端在 `app/js/api.js` 的 `fillCore`/`expandSub`。先玩 demo 理解流程,再對照完整版看「上線版多了哪些防護」。
