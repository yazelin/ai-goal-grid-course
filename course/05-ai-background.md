# 第 5 章 — AI 桌布背景:長任務的正確姿勢(job + 輪詢 + 等待 UX)

## 學完能做什麼

- 接一個要跑 1-3 分鐘的 AI 生圖任務,而且手機收訊閃一下、使用者重新整理頁面,結果都不會丟。
- 把「同步等待」改造成「掛號-叫號」:送單拿單號,之後每幾秒問一次好了沒。
- 看懂上線版的三層生圖架構:主路 OpenAI 同步、備援自架 job + 輪詢、降級 prompt 外帶——以及為什麼「夠快夠穩」的主路可以同步。
- 設計一條誠實的進度條與階段文案,讓使用者願意等三分鐘。

## 核心觀念:快任務和慢任務是兩種工程

到上一章為止,所有 API 呼叫都在幾秒內回來,HTTP 的預設假設——「問了馬上答」——都成立。AI 生圖打破了這個假設:一張桌布背景快則幾十秒、慢則 70-180 秒。讓一條 HTTP 連線開著等三分鐘,等於在賭三件事同時不出錯:中間的代理不逾時(Cloudflare Worker 的子請求,社群實測約 90-100 秒就可能被切)、使用者的手機網路三分鐘不抖一下、使用者三分鐘內不切換頁面。在行動網路上,這個賭局幾乎必輸——而且最慘的是,連線斷掉時圖其實已經快生好了,只是你再也拿不回來。

正解是把一次「長對話」拆成多次「短對話」:送出任務立刻拿到一個單號(job id),連線馬上結束;之後每隔幾秒拿單號去問「好了嗎」。每次請求都在一秒內完成,逾時風險整類消失,而且單號可以存起來——重新整理頁面、甚至換個瀏覽器分頁,拿著單號就能接著等。這個模式叫**非同步 job + 輪詢(polling)**,所有「AI 慢任務」(生圖、生影片、批次處理)都是這一套。

### 那為什麼上線版的主路是同步的?

先說一個會讓你疑惑的事實:上線版 Worker 的生圖主路其實是同步的。完整的生圖路徑是三層:

1. **主路 = OpenAI Images API(gpt-image-1)**:官方付費 API,夠快也夠穩,多數圖在 90 秒內回得來。Worker 同步呼叫、用 `AbortSignal.timeout(90000)` 在 90 秒截斷(正好卡在代理層被切線的臨界值之前),拿到圖直接回 `{mode:'sync', images}`。
2. **備援 = 自架 codex-image-service**:Worker 沒設 `OPENAI_API_KEY` 時才走。自架服務一張 70-180 秒、實質併發只有一到二張,「同步硬等」的三重賭局全部成立——所以這條路必須用 job + 輪詢。
3. **降級 = prompt 外帶**:兩條後端路都不通時,複製生圖 prompt 自己去 ChatGPT/Gemini 生、再匯回來,零後端依賴(第 07 章的教材)。

「同步」不是打臉前面講的原則,是有條件的例外:上游夠快夠穩、又有明確截斷時,同步是最簡單正確的做法;上游慢或不穩,job + 輪詢才是正解。本章接下來教的就是第二層——它既是這個產品備援路徑的實作,也是所有 AI 慢任務的通用骨架,換掉哪個上游都用得上。

## 步驟

### 0. 主路:OpenAI Images API,同步 90 秒截斷

`worker-deploy/src/lib/openaiimage.js` 把官方 API 包成一個函式:文生圖打 `/v1/images/generations`,帶參考圖時改打 `/v1/images/edits`(multipart,把 base64 還原成 PNG 附件),品質由 `OPENAI_IMAGE_QUALITY` 環境變數控制(預設 medium)。`handleImage` 的主路分支(節錄,有簡化):

```js
// 主路:OpenAI Images API(同步,90s 截斷)
if (env.OPENAI_API_KEY) {
  const oa = await generateOpenAI(env, { prompt, size: payload.size, refsBase64: refs });
  if (oa.timeout) return fail({ error: "sync_fallback_timeout" }, 504); // 退額度 + 解鎖
  if (oa.status === 200) {
    await releaseLock(env.DB, ip);            // 成功:解鎖但不退款
    return json({ mode: "sync", images: oa.images }, 200, cors);
  }
  return fail({ error: "upstream_failed" }, 502);
}
// 沒設 OPENAI_API_KEY → 往下走自架備援(本章其餘步驟的主角)
```

注意它沒有「OpenAI 失敗就改打自架備援」——失敗就是退款、回錯誤,讓前端引導使用者重試或走降級。兩條路用金鑰擇一決定,行為單純可預測(debug 的時候你會感謝這個決定)。

### 1. 備援的前置工程:先讓自架上游支援 job

備援層的生圖後端是 codex-image-service(自架服務)。它原本只有同步端點 `POST /v1/images/generate`——連線開著等 70-180 秒,而且它自己的文件就承認:504 之後那次的結果拿不回來。

所以這個專案動工前,第一件事不是寫前端,而是去上游 repo 開了一個 PR(codex-image-service PR #5),加上兩個 job 端點:

```text
POST /v1/images/jobs        → 202 {id, status:"queued"}   (參數跟原本的 generate 一樣)
GET  /v1/images/jobs/{id}   → {status: queued|running|succeeded|failed,
                               images: [{url, expires_at}], error}
```

既有的同步端點原樣保留(向下相容),只是多了一條「掛號」路徑。這裡有一個值得帶走的觀念:**當你依賴的服務缺一個能力,選項不是只有「忍耐」或「換一家」,還有「去把它修好」**——尤其當它是開源專案或自家服務的時候。

### 2. Worker 送單:鎖、扣額度、拿單號

`worker-deploy/src/index.js` 的 `handleImage` 是送單端。鎖與扣額度是主路、備援共用的(進來先做,走哪條路都一樣);`submitJob` 之後是備援限定——步驟 0 的主路分支沒攔截(`OPENAI_API_KEY` 未設)才會走到。流程節錄:

```js
// 同一個 IP 同時只能有一張在生(in-flight lock),搶不到鎖回 409
if (!(await acquireLock(env.DB, ip, "pending"))) {
  return json({ error: "in_flight" }, 409, cors);
}
// 先扣後跑(同第 3 章):每日生圖額度先 -1
const quota = await takeQuota(env.DB, { kind: "img", ip, limit: 3, day });
if (!quota.ok) {
  await releaseLock(env.DB, ip);
  return json({ error: "quota_exceeded", resetAt: taipeiResetAt() }, 429, cors);
}

const result = await submitJob(env, payload);   // POST 上游 /v1/images/jobs
if (result.mode === "job" && result.data?.id) {
  const jobId = result.data.id;
  await putJob(env.DB, jobId, { ip, day });     // 記下單號 + 建立時間(逾時判定用)
  await updateLock(env.DB, ip, jobId);
  return json({ jobId, mode: "job" }, 202, cors); // 202 = 已受理,還沒做完
}
```

`submitJob`(`worker-deploy/src/lib/imagejobs.js`)還藏了一手:先打 job 端點,如果上游回 404(代表 job API 還沒部署),自動退回同步端點、用 `AbortSignal.timeout(85000)` 在 85 秒截斷。這讓 Worker 和上游可以**分開部署、互不卡死**——協定升級永遠要留向下相容的路。

### 3. Worker 查單:終局處理與 660 秒自動退款

前端拿單號來問進度時,Worker 轉發給上游,並且在「終局」做該做的事(`handleImageStatus`):

```js
const st = res.data?.status;
if (st === "queued" || st === "running") {
  // job 建立超過 660 秒還沒好 → 主動判逾時:退額度 + 解鎖
  if (jobTimedOut(job)) {
    await refundJob(env.DB, jobId);
    return json({ status: "failed", error: "timeout", refunded: true }, 200, cors);
  }
  return json({ status: st }, 200, cors);        // 還在做,前端繼續等
}
if (st === "succeeded") {
  await releaseLock(env.DB, job.ip);             // 成功:解鎖(額度照扣)
  return json({ status: "succeeded", images: res.data.images || [] }, 200, cors);
}
await refundJob(env.DB, jobId);                  // 失敗:退額度 + 解鎖
return json({ status: "failed", error: String(res.data?.error || "failed") }, 200, cors);
```

兩個設計重點:

- **660 秒逾時自動退款**:上游卡死不能變成使用者的損失。退款動作是「冪等」的——`refundJob` 內部先檢查這筆 job 退過沒,退過就跳過,所以前端就算連問十次逾時,也只會退一次,額度不會被「退」成負的。
- **第 3 章的口訣在這裡重演**:先扣後跑、確定失敗才退。只是生圖的「確定失敗」可能發生在十分鐘後,所以 Worker 得把單號、IP、建立時間記在資料庫裡,事後才對得起帳。

### 4. 前端輪詢:5 秒一問,90 秒後放慢

前端的 `submitWallpaper` 先看 Worker 的回應決定路線:主路會直接給 `{mode:'sync', images}`——拿圖收工,根本不用輪詢;拿到 `{mode:'job', jobId}`(備援路徑)才進輪詢主迴圈。`app/js/api.js` 的輪詢節奏:

```js
export function pollDelay(attempt) {
  return attempt < 18 ? 5000 : 10000; // 5s × 18 次(90s)後改 10s
}
```

前 90 秒每 5 秒問一次(多數圖在這個區間完成,問太慢使用者白等),之後降到每 10 秒(已經等很久了,問密一點也不會更快,只是浪費流量)。輪詢主迴圈(`pollWallpaper`,節錄):

```js
while (true) {
  const delay = pollDelay(attempt);
  if (elapsed + delay > 720000) throw new ApiError(0, { error: 'poll_timeout' }); // 720s 放棄
  await sleep(delay);
  elapsed += delay;
  attempt += 1;

  try {
    res = await fetch(`${workerBase()}/image/${jobId}`);
    body = await res.json();
  } catch {
    consecutiveErrors += 1;                       // 網路抖一下不算失敗
    if (consecutiveErrors >= 4) throw new ApiError(0, { error: 'network' });
    continue;                                     // 連續錯 4 次才放棄
  }
  consecutiveErrors = 0;

  if (body.status === 'succeeded') return body.images;
  if (body.status === 'failed') throw new ApiError(200, { error: 'job_failed', detail: body.error });
  // queued / running → 繼續下一輪
}
```

注意兩個數字的關係:前端等到 720 秒才放棄,**比 Worker 的 660 秒寬**——這樣設計,使用者一定會先收到 Worker 那句「逾時、額度已退還」,而不是前端自己先放棄、留下「到底退了沒」的懸念。超時這種事,要讓「管帳的那一方」先開口。

### 5. pending job 持久化:重新整理也不丟單

單號拿到手的那一刻就立刻寫進 localStorage(`app/js/main.js`):

```js
api.savePendingJob({
  jobId: sub.jobId,
  createdAt: new Date().toISOString(),   // 續傳時用來換算「已經等了多久」
  orientation: state.wallpaper.orientation,
  styleId: state.wallpaper.styleId,
  gridMode: wallpaperMode,
});
images = await api.pollWallpaper(sub.jobId, { byo: sub.byo });
api.clearPendingJob();                   // 終局(成功)才清掉
```

頁面載入時檢查有沒有「未終局」的單:

```js
const pending = api.loadPendingJob();
if (pending) {
  goToStep(4); // 直接帶回步驟四
  showMsg(bgMsgEl, '偵測到上次離開時背景還在生成,已自動接續等待(不會重複扣額度)。', 'ok');
  const elapsedMs = Date.now() - Date.parse(pending.createdAt);
  startGenUi(Date.now() - elapsedMs);    // 進度條從「已經過的時間」接著走,不歸零
  const images = await api.pollWallpaper(pending.jobId, { elapsedMs });
  api.clearPendingJob();
  await applyWallpaperImages(images);
}
```

幾個細節讓續傳「像沒斷過」:進度條從實際經過時間接著走(不會重新從 0 開始騙人);輪詢節奏用 `elapsedMs` 換算回正確的位置(已經過了 90 秒就直接用 10 秒節奏);成功、失敗、逾時這些「終局」都會清掉 pending 單,但**純網路錯誤不清**——網路恢復或下次載入頁面時還能接著等。另外,使用者手癢再按一次「生成」時,程式發現有 pending 單會改成恢復輪詢而不是重送——重送只會撞上 Worker 的 409(同 IP 同時只能一張)。

### 6. 等待 UX:三分鐘等得下去的進度條

上游不會告訴你「畫到 73% 了」,所以進度條必然是「演的」——但可以演得誠實(`app/js/main.js`):

```js
const GEN_STAGES = ['AI 構圖中', 'AI 正在打草稿', '上色中', '收尾修飾中'];

const tick = () => {
  const elapsed = Date.now() - startedAt;
  const idx = Math.floor(elapsed / 9000) % GEN_STAGES.length;   // 階段文案每 9 秒輪播
  const mm = String(Math.floor(elapsed / 60000));
  const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
  genStageEl.textContent = `${GEN_STAGES[idx]}…(已 ${mm}:${ss},一般約 1-3 分鐘)`;
  pbarFill.style.width = `${Math.min(96, (elapsed / 180000) * 100).toFixed(1)}%`;
};
```

這短短幾行裡有四個行銷人秒懂的心理設計:

1. **預告時間**:「一般約 1-3 分鐘」先講,使用者的耐心是用預期管理出來的,不是用動畫拖出來的。
2. **顯示已經過時間**:`已 1:24` 證明系統活著,沒有什麼比一條不動的進度條更勸退。
3. **階段文案輪播**:構圖中 → 打草稿 → 上色中 → 收尾修飾——把黑盒子講成一個有進展的故事(文案是演的,但「還在跑」是真的)。
4. **進度條封頂 96%**:用預估 180 秒當分母,但永遠不走到 100%。走到 100% 卻還沒好,是等待 UX 的頭號災難;96% 的「快好了」可以體面地撐到真的好。

最後一哩:成功拿到圖之後,**立刻把圖抓回來存 IndexedDB**(`applyWallpaperImages`)。上游給的圖片網址 7 天就過期,自己的成品要放在自己手上——這也呼應本課一直講的資料自主。

## 給 AI 的 prompt 範本

這段貼給 ChatGPT/Claude,可以重現本章的「長任務輪詢」骨架(對著任何 job 式 API 都適用;搭配本課 Worker 時把網址換成你自己部署的——要走備援路徑、也就是不設 `OPENAI_API_KEY`,才會拿到 202 與 jobId;主路會直接同步回圖):

```text
請幫我做一個單檔網頁(所有 CSS/JS 內嵌),示範「AI 長任務的送單與輪詢」:

【送單】一顆「開始生成」按鈕,POST {WORKER_URL}/image,
body 是 {goal, subGoals, styleId, orientation} 的 JSON;
成功會拿到 202 和 {jobId}。送出的瞬間把
{jobId, createdAt: 現在時間 ISO 字串} 存進 localStorage(key 'pending-job')。

【輪詢】拿 jobId 每 5 秒 GET {WORKER_URL}/image/{jobId} 問一次,
問滿 18 次(90 秒)後改成每 10 秒一次;總共等超過 720 秒就放棄並顯示逾時訊息。
回應的 status 是 queued 或 running 就繼續等;
succeeded 就把 images[0].url 顯示成圖片並清掉 localStorage 的 pending-job;
failed 就顯示錯誤訊息(error 欄位)也清掉 pending-job。
fetch 本身丟錯(網路抖動)不算失敗:連續錯 4 次才放棄,而且不清 pending-job。

【續傳】頁面載入時檢查 localStorage 有沒有 pending-job:
有的話不要重送,直接用那個 jobId 接著輪詢,
並依 createdAt 算出已經過的時間,讓進度顯示從正確位置接著走。

【等待 UI】等待期間顯示:
1. 一條進度條,以 180 秒為分母推進,但最多走到 96%、不到 100%;
2. 階段文案每 9 秒輪播:「AI 構圖中」「AI 正在打草稿」「上色中」「收尾修飾中」,
   後面接已經過時間(分:秒)和「一般約 1-3 分鐘」;
3. 生成期間按鈕停用,結束(成功或失敗)後恢復。

【驗收】生成中重新整理頁面,要能自動接著等、進度不歸零、不重送請求。
深夜藍底(#0e1420)配金色(#c9a44e),繁體中文,不用 emoji。
```

## 常見坑

1. **同步硬等三分鐘**:代理層 90-100 秒就可能切線,手機網路更脆,而且 504 之後結果拿不回——錢花了、圖生了、人看不到。長任務一律 job + 輪詢;同步只留給「上游夠快夠穩、又有明確截斷」的場合(本課主路打 OpenAI、90 秒截斷,就是這種例外)。
2. **輪詢太密**:每秒問一次不會讓圖快一秒,只會把流量和伺服器額度燒掉。5 秒起步、90 秒後退到 10 秒,夠了。
3. **重新整理就重送**:沒存單號的頁面,reload 等於棄單重排,還會撞 Worker 的 409(同 IP 一次一張)。單號到手立刻進 localStorage,載入時先查再說。
4. **終局忘了清 pending 單**:成功/失敗/逾時都要清,否則使用者永遠卡在「偵測到上次的生成」;但網路錯誤不清——那不是 job 的終局,留著才能續傳。
5. **進度條走到 100% 卡住**:不知道真實進度就不要演到滿,封頂 96% 是誠實與體驗的平衡點。
6. **退款不冪等**:輪詢會對同一個失敗 job 問很多次,退款邏輯沒有「退過就跳過」的檢查,額度就會被多退。Worker 的 `refundJob` 先查 `refunded` 旗標就是在防這個。
7. **直接引用上游圖片網址**:那個網址 7 天過期。成功當下就把圖抓回存 IndexedDB,桌布才真正是使用者的。

## 對照成品

- `demos/03-wallpaper/` — 本章+第 6 章的練習版:漸層背景 + canvas 合成可離線玩,AI 背景為選配(自帶 key)。
- `app/` — 完整版:送單與查單在 `worker-deploy/src/index.js`(`handleImage`/`handleImageStatus`),主路 OpenAI 介接在 `worker-deploy/src/lib/openaiimage.js`,備援上游介接與同步 fallback 在 `worker-deploy/src/lib/imagejobs.js`,前端輪詢與續傳在 `app/js/api.js`(`submitWallpaper`/`pollWallpaper`/`savePendingJob`),等待 UI 在 `app/js/main.js`(搜尋 `GEN_STAGES`)。備援上游的 job API 出處:codex-image-service PR #5(https://github.com/yazelin/codex-image-service/pull/5 )。
