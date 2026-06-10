# 第 08 章 — 防刷與額度:你的金鑰背後是真鈔

## 學完能做什麼

- 給公開的 AI 端點裝上四層防線:Turnstile 無感驗證、每日配額、同 IP 同時只跑一張的 in-flight lock、先扣後跑加失敗退款。
- 看懂「併發繞過」這種抽象風險的具體長相,並用 D1 的一條原子 SQL(`ON CONFLICT ... RETURNING`)把計數做到繞不過。
- 分清楚哪些是真防線(配額層)、哪些不是(CORS),以及金鑰還沒備齊的部署過渡期怎麼設計 fail-open。

## 核心觀念:免費給人玩,不等於免費給腳本玩

這個產品對訪客全免費:AI 補格、AI 生桌布,點了就跑。但每一次點擊背後都是真實成本——`/fill` 燒 Groq 額度;`/image` 更貴:主路打 OpenAI Images API,每生一張就是一筆按張計費的 API 帳單;沒設 OpenAI 金鑰時退到作者自架的 codex-image-service,燒的是作者個人的 ChatGPT 訂閱額度、實質併發只有一到二張。不管走哪條路,每次點擊都是真錢——這套防線同時護著 OpenAI 帳單與自架服務的額度。你照本課自己部署一套時,燒的就是你的錢。而 Worker 端點是公開網址,任何人寫一個十行的迴圈就能整夜打它。防線的目標不是把門鎖死,是讓「正常人的一天」剛好夠用、讓「腳本的一秒鐘」必然碰壁。

本章還保留了一個誠實的工程教訓。第一版設計裡,配額計數打算用 Cloudflare KV——「讀出來、加一、寫回去」,看起來會動,單人測試也都過。但在上線前的對抗式 review 被抓出來:兩個請求同時讀到同一個數字,就會雙雙通過檢查,防線在併發下是擺設。修法不是加更多檢查,是把「檢查與加一」交給資料庫的一條原子 SQL。我們把這個發現原樣寫進教材,因為「看起來會動」和「攻擊下仍然正確」之間的差距,正是這一章要教的東西。

## 步驟

### 1. 先盤點你要保護的東西

| 端點 | 燒什麼 | 每日配額(每 IP) |
|---|---|---|
| `POST /fill`(AI 補格/展開) | Groq API 額度 | 12 次 |
| `POST /image`(AI 桌布背景) | OpenAI Images API(按張計費);備援自架服務燒 ChatGPT 訂閱 | 6 次 |
| `POST /signup`(email 留資) | D1 寫入(便宜,但會被灌垃圾) | 10 次 |

數字放在 `wrangler.toml` 的 `[vars]`(`IMG_PER_DAY`、`FILL_PER_DAY`),要調不用改程式。原則:最貴的資源配額壓最低。

### 2. 第一層:Turnstile 無感驗證

Turnstile 是 Cloudflare 的免費人機驗證,多數真人完全無感(不用點紅綠燈),但腳本拿不到 token。前端每次呼叫前在背景渲染一個隱形 widget 取得一次性 token,隨請求送出;Worker 拿 token 向 Cloudflare 驗證:

```js
// worker-deploy/src/lib/turnstile.js
const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export async function verifyTurnstile(env, token, ip) {
  if (!env.TURNSTILE_SECRET) {
    console.warn("TURNSTILE_SECRET 未設,跳過 Turnstile 驗證");
    return true; // fail-open:過渡期不擋人(見下方說明)
  }
  if (!token) return false;
  const form = new URLSearchParams();
  form.set("secret", env.TURNSTILE_SECRET);
  form.set("response", token);
  if (ip && ip !== "unknown") form.set("remoteip", ip);
  const res = await fetch(VERIFY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  return (await res.json()).success === true;
}
```

注意第一段:**secret 沒設就放行,只留警告**。這是刻意的部署過渡設計——Turnstile 要前端 sitekey 和 Worker secret 兩邊同時就位才能動,部署總有先後;如果 secret 未設就回 403,整個站會在過渡期全掛。fail-open 的代價是「還沒開驗證的期間少一層防線」,但後面還有三層,而且每一層都比 Turnstile 更硬。反過來的情境也要處理:站方已開驗證、自部署的前端卻沒填 sitekey,使用者會收到 403——本課前端的錯誤文案會明講「此頁缺 sitekey 設定」,而不是讓人對著「驗證失敗」發呆。

### 3. 第二層:每日配額——以及那個 KV 教訓

先看會被繞過的版本(第一版設計,沒上線):

```js
// 反面教材:KV 讀-改-寫,併發下是擺設
const used = Number(await env.QUOTA.get(key)) || 0; // 請求 A、B 同時讀到 2
if (used >= limit) return tooMany();                 // 兩個都通過檢查
await env.QUOTA.put(key, String(used + 1));          // 兩個都寫 3:多跑一次,少算一次
```

「讀出來、檢查、寫回去」是三個動作,中間沒有任何機制阻止別人插隊。攻擊者只要同時發 20 個請求,大部分都會在「還沒寫回」的窗口通過檢查。何況 Cloudflare KV 是最終一致的全球儲存,連「寫完馬上讀」都不保證讀到新值——它本來就不是拿來做計數器的。

正解:換 D1(Cloudflare 的免費 SQLite),把「檢查+加一」壓進一條原子 SQL:

```sql
CREATE TABLE IF NOT EXISTS quota_counts (
  day TEXT NOT NULL, ip TEXT NOT NULL, kind TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, ip, kind));
```

```js
// worker-deploy/src/lib/quota.js — 先扣後跑:單條 upsert 原子扣額
export async function takeQuota(db, { kind, ip, limit, day }) {
  const row = await db.prepare(
    `INSERT INTO quota_counts (day, ip, kind, count) VALUES (?, ?, ?, 1)
     ON CONFLICT(day, ip, kind) DO UPDATE SET count = count + 1
     WHERE count < ? RETURNING count`,
  ).bind(day, ip, kind, limit).first();
  if (!row) return { ok: false };
  return { ok: true, count: row.count };
}
```

逐句讀:第一次見到這組(日期、IP、種類)就插入 `count=1`;已存在就走 `DO UPDATE` 加一,但 `WHERE count < ?` 擋住超限;`RETURNING` 的意思是「真的有插入或更新才回一列」——**沒有列回來,就是超限**。檢查與加一發生在同一條 SQL 裡,資料庫保證兩個併發請求必有先後,誰都插不了隊。超限時回 `429` 並附 `resetAt`(台北時間明日 00:00),前端能告訴使用者幾點回來,以及引導 BYO(自帶金鑰)出路。

### 4. 第三層:in-flight lock——同一時間只跑一張

生圖一張要跑幾十秒到三分鐘。就算每日配額是 3,有人同時送 3 張,主路是三筆同時開跑的 OpenAI 帳單、備援則直接塞滿自架服務的隊列,都在排擠其他訪客。所以同一個 IP 同時只能有一個生圖 job:

```js
// 先清過期鎖,再搶鎖;RETURNING 無列 = 沒搶到(回 409 in_flight)
export async function acquireLock(db, ip, jobId, now = Date.now()) {
  await db.prepare("DELETE FROM locks WHERE expires_at < ?").bind(now).run();
  const row = await db.prepare(
    `INSERT INTO locks (ip, job_id, expires_at) VALUES (?, ?, ?)
     ON CONFLICT(ip) DO NOTHING RETURNING ip`,
  ).bind(ip, jobId, now + 900_000).first();
  return !!row;
}
```

同一招式:用 `ON CONFLICT ... RETURNING` 把「檢查+佔位」做成原子。兩個細節:鎖一定要有期限(這裡 15 分鐘),不然使用者關掉網頁,他的 IP 就永遠被鎖死;前端收到 `409` 時文案要講人話——「另一個生成正在進行(可能是你稍早送出的請求),最多 15 分鐘後自動解鎖」。

### 5. 第四層:先扣後跑,失敗退款

扣額度和呼叫上游,哪個先?**一定先扣**。如果「跑完才扣」,那麼在跑的這幾十秒到幾分鐘裡,同 IP 的請求個個都是「還沒扣」狀態,配額形同虛設。`/image` 的完整順序:

```js
// worker-deploy/src/index.js(節錄)
if (!(await verifyTurnstile(env, body.turnstileToken, ip)))   // 1. Turnstile
  return json({ error: "turnstile_failed" }, 403, cors);
if (!(await acquireLock(env.DB, ip, "pending")))               // 2. lock
  return json({ error: "in_flight" }, 409, cors);
const quota = await takeQuota(env.DB, { kind: "img", ip, limit, day }); // 3. 先扣
if (!quota.ok) {
  await releaseLock(env.DB, ip);
  return json({ error: "quota_exceeded", resetAt: taipeiResetAt() }, 429, cors);
}
// 4. 扣完才呼叫上游;送單失敗 → 退 1 + 解鎖
```

先扣後跑對使用者不公平的地方,用「失敗退款」補回來:主路 OpenAI 回錯或撞上 90 秒截斷、備援送單失敗、job 失敗、或 job 超過 660 秒還沒結果(視同逾時),Worker 都自動退還那 1 次額度並解鎖。「不退」只有一種情況——送出後使用者自己放棄或斷線,因為 Worker 無從分辨那和正常等待的差別。

退款有個陷阱:前端每 5 秒輪詢一次 job 狀態,失敗狀態會被讀到很多次,如果每次都退 1,等於失敗一次反而送額度。所以退款必須冪等:

```js
// 退款冪等:搶到 refunded 0→1 這個翻轉的那一次,才真的退
const marked = await db.prepare(
  "UPDATE jobs SET refunded = 1 WHERE id = ? AND refunded = 0 RETURNING id",
).bind(jobId).first();
if (!marked) return false; // 已退過,跳過
await refundQuota(db, { kind: "img", ip: job.ip, day: job.day }); // count-1,不低於 0
await releaseLock(db, job.ip);
```

又是 `RETURNING`:第一次呼叫翻轉 `refunded` 拿到列、執行退款;之後的呼叫條件不成立、拿不到列、直接跳過。三層原子操作,同一個句型。

### 6. CORS 不是濫用邊界

Worker 的 CORS 設定只允許 `yazelin.github.io` 和 localhost,你可能以為這就擋掉了別站盜用。要想清楚:**CORS 是瀏覽器的自律規範,只有瀏覽器會遵守**。用 curl 直打,根本沒有 Origin 這回事:

```bash
curl -s -X POST https://goal-grid.yazelinj303.workers.dev/fill \
  -H 'Content-Type: application/json' \
  -d '{"mode":"core","cells":[null,null,null,null,"學好英文",null,null,null,null]}'
# 不經瀏覽器、沒有 Origin,請求照樣進來 —— 接住它的是配額層,不是 CORS
```

CORS 的功能是保護「使用者在別的網站上不被偷偷代打」,不是保護你的額度。防濫用是配額層的事,這就是為什麼四層防線一層都不能省。

### 7. 驗收

- 開兩個分頁同時按「生成 AI 背景」:第二個要立刻收到「另一個生成正在進行」(409),而不是兩張都開跑。
- 同一天生圖 3 次後再按:要看到「今日 AI 額度已用完,將於(明日 00:00)重置」與 BYO 引導,而不是無聲失敗。
- 用上面的 curl 直打一次:確認回應來自 Worker 的配額/驗證邏輯(403 或正常回應),體會「CORS 擋不住它」。
- 自部署版還沒設 `TURNSTILE_SECRET` 時,功能照常可用,Worker log 出現跳過驗證的警告——fail-open 生效。

## 給 AI 的 prompt 範本

```text
幫我的 Cloudflare Worker(已有 /fill 與 /image 兩個 AI 端點)加上四層防刷防線,
用 D1 做配額,不要用 KV 或記憶體變數計數。

【資料表】在 schema.sql 加三張表:
quota_counts(day, ip, kind, count,主鍵 day+ip+kind)
locks(ip 主鍵, job_id, expires_at)
jobs(id 主鍵, ip, day, refunded 預設 0, created_at)

【第一層 Turnstile】每個 POST 帶 turnstileToken,Worker 向
https://challenges.cloudflare.com/turnstile/v0/siteverify 驗證。
Secret 名稱 TURNSTILE_SECRET;未設定時跳過驗證並 console.warn(部署過渡期 fail-open)。

【第二層 每日配額】每 IP 每日 /image 6 次、/fill 60 次(數字放 env vars,依漏斗轉換需要調整 — 額度太緊,使用者連桌布都生不出來,就更不會留 email)。
扣額必須是一條原子 SQL:
INSERT INTO quota_counts (day, ip, kind, count) VALUES (?, ?, ?, 1)
ON CONFLICT(day, ip, kind) DO UPDATE SET count = count + 1
WHERE count < ? RETURNING count
沒有列回傳就是超限,回 429 加 resetAt(台北時間明日 00:00 的 ISO 字串)。
day 用台北時區的 YYYYMMDD。禁止「先 SELECT 再 UPDATE」的寫法。

【第三層 in-flight lock】同 IP 同時只能有一個 /image job:
先 DELETE 過期鎖,再 INSERT ... ON CONFLICT(ip) DO NOTHING RETURNING ip,
無列回 409 {error:"in_flight"};鎖的 expires_at = 現在 + 900 秒。

【第四層 先扣後跑+退款】順序固定:Turnstile → lock → 扣額 → 呼叫上游。
上游送單失敗、job 失敗、job 超過 660 秒未完成:退 1 次額度(不低於 0)並解鎖。
退款要冪等:UPDATE jobs SET refunded=1 WHERE id=? AND refunded=0 RETURNING id,
有列才執行退款,輪詢重複讀到失敗狀態不能重複退。

【驗收】寫一個用 Map 模擬 D1 的最小單元測試,證明:
1. 同 IP 連續扣到上限後被拒
2. 兩個併發扣額不會超過上限
3. 退款呼叫兩次只實際退一次
4. lock 互斥、過期後可重新取得
全部通過才算完成,並附 curl 指令讓我手動驗 429 與 409。
```

前端這側的配額體驗(429 顯示重置時間、409 講人話、退款後提示可重試),可以另外丟一句:

```text
幫我的前端把 API 錯誤翻成人話:429 顯示「今日額度已用完,將於 {resetAt 台北時間} 重置」
並附自帶金鑰的引導;409 顯示「另一個生成正在進行,最多 15 分鐘後自動解鎖」;
退款類錯誤(逾時、生成失敗)明說「額度已退還,請點重試」。不要只顯示錯誤代碼。
```

## 常見坑

1. **任何「讀-改-寫」三步的計數都有併發洞**:不只 KV,存在 Worker 記憶體裡的 Map 也一樣(而且 Worker 會多實例、會重啟歸零,記憶體限流只能當 best-effort 的第一層)。計數一律交給資料庫的原子操作。
2. **以為 CORS 能防盜用**:curl 和任何後端腳本都不理 CORS。CORS 只管瀏覽器,額度要靠配額層。
3. **退款不冪等**:輪詢會重複讀到失敗狀態,沒做 `refunded` 翻轉檢查就會重複退款,失敗反而變成送額度。
4. **lock 沒有期限**:使用者關頁斷線,IP 永遠被鎖。鎖要帶 `expires_at`,取鎖前先清過期的。
5. **「跑完才扣」**:長任務跑著的幾分鐘裡,後續請求全都在「還沒扣」的窗口通過。先扣後跑,失敗再退。
6. **配額日期沒帶時區**:用 UTC 切日,台北使用者會在早上 8 點看到「額度重置」,訊息全亂。本課用台北時區的 YYYYMMDD 當 key。
7. **Turnstile 上線順序想錯**:secret 與 sitekey 要兩邊就位;secret 未設就硬擋會讓過渡期全站 403。fail-open 過渡,上線後再補驗證。
8. **429 文案冷冰冰**:「額度用完」就結束,訪客流失。要給重置時間,並給出路(自帶金鑰、或第 07 章的「複製 prompt 自己去生」降級路徑)。

## 對照成品

- 互動體驗:[demos/04-quota/](../demos/04-quota/index.html) ——用前端模擬配額遞減、429、409 與退款重試的完整 UX,不用真的燒額度就能玩到每一種狀態。
- 真實實作:`worker-deploy/src/lib/quota.js` 與 `worker-deploy/src/index.js`(在 dev repo,不隨教材發佈;本章程式碼塊皆直接取自該處)。線上的 [完整版 App](../app/) 跑的就是這套四層防線。
