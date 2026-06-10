# 第 09 章 — Email 收集與後台:留下名單,當場兌現承諾

## 學完能做什麼

- 在成品的最後一步加上 email 收集:honeypot 擋機器人、UNIQUE 去重不報錯、誘因當場兌現(不開空頭支票)。
- 做一個只有你進得去的後台 `admin.html`:Bearer token 驗證、名單表格、一鍵匯出 CSV 進任何 EDM 工具。
- 知道後台 token 為什麼存 sessionStorage 而不是 localStorage——共用 origin 的 XSS 爆炸半徑。

## 核心觀念:免費價值先給,留資換加值,承諾當場兌現

前課模組 9 講過:社群觸及是租來的,email 名單才是自己的資產。本章把那套「收集、儲存、後台」放進完整產品的漏斗位置,而位置決定成敗——桌布 PNG 直接給,**不設牆**;email 表單放在下載旁邊,用「留下 email,立即拿 30 天行動追蹤模板」交換。訪客已經拿到主要價值,留資是加值交易,不是門票,轉換才不會帶著怨氣。

「立即拿」三個字是設計,不是文案修辭。第一版產品最容易在「我之後會寄給你」這句話上失信:寄信要串 EDM 服務、會進垃圾桶、會晚到。所以這裡的誘因是一個靜態網頁(`tracker.html`),註冊成功的回應裡直接帶連結,當場點開、當場可印——承諾在同一個畫面裡兌現,不依賴任何寄信系統。名單先收著,真正的群發等你哪天要做再匯出去。

## 步驟

### 1. 表單與 honeypot

表單只收 email(欄位越少轉換越高),外加一個真人永遠看不到的「蜜罐」欄位:

```html
<!-- app/index.html 步驟五 -->
<form class="signup-form" id="signup-form" novalidate>
  <input type="email" name="email" id="signup-email" autocomplete="email"
         placeholder="you@example.com" aria-label="Email">
  <input type="text" name="company" id="signup-company" class="hp-field"
         tabindex="-1" autocomplete="off" aria-hidden="true">
  <button class="btn btn-primary" type="submit" id="signup-submit">送出拿模板</button>
</form>
```

```css
/* honeypot:移出視野但仍在 DOM(真人看不到,機器人照填) */
.signup-form .hp-field {
  position: absolute; left: -9999px; top: 0;
  width: 1px; height: 1px;
  opacity: 0; pointer-events: none;
}
```

笨的灌名單機器人會把頁面上每個欄位都填滿。`company` 有值,就當機器人——但 Worker 不回錯誤,而是**假裝成功、不寫入**,讓機器人以為得逞,不會回頭換手法。

### 2. Worker 端:/signup 的完整防線

```js
// worker-deploy/src/lib/signup.js(節錄)
export async function handleSignup({ db, env, ip, body }) {
  // 第一層:每 IP 每分鐘 5 次(記憶體 Map,best-effort —— 見第 08 章的提醒)
  if (limited(ip)) return { status: 429, body: { error: "rate_limited" } };

  // 第二層:Turnstile(有設 secret 才驗,與其他端點同一套)
  if (!(await verifyTurnstile(env, body.turnstileToken, ip))) {
    return { status: 403, body: { error: "turnstile_failed" } };
  }

  // honeypot:有值就當機器人,假裝成功不寫入
  if (body.company) {
    return { status: 200, body: { ok: true, gift: env.GIFT_URL } };
  }

  // 正規化:trim + 轉小寫,Abc@Mail.com 和 abc@mail.com 才會被當同一人
  const email = String(body.email || "").trim().toLowerCase();
  const name = String(body.name || "").trim().slice(0, 60);
  if (!EMAIL_RE.test(email) || email.length > 120) {
    return { status: 400, body: { error: "bad_email" } };
  }

  // 第三層:D1 每日配額 10 次/IP(原子扣額,第 08 章的同一個 takeQuota)
  const quota = await takeQuota(db, { kind: "signup", ip, limit: 10, day: taipeiDay() });
  if (!quota.ok) return { status: 429, body: { error: "rate_limited" } };

  try {
    await db.prepare("INSERT INTO signups (email, name, created_at, ip) VALUES (?, ?, ?, ?)")
      .bind(email, name || null, now, ip).run();
    return { status: 200, body: { ok: true, gift: env.GIFT_URL } };
  } catch (e) {
    if (String(e).includes("UNIQUE")) {
      return { status: 200, body: { ok: true, already: true, gift: env.GIFT_URL } };
    }
    return { status: 500, body: { error: "db_failed" } };
  }
}
```

留意分鐘限流和每日配額是兩層:記憶體 Map 擋連點(快、零成本,但 Worker 多實例或重啟就歸零),D1 配額才是繞不過的那層——這正是第 08 章的教訓在便宜端點上的應用。

### 3. 去重:重複送出不是錯誤

資料表給 email 上 UNIQUE 約束(`schema.sql`:`email TEXT NOT NULL UNIQUE`),同一人按三次也只會有一筆。重點在回應方式:UNIQUE 衝突**不回錯誤**,照樣回 `200` 加 gift 連結,只多一個 `already: true` 讓前端把文案換成更誠實的一句:

```js
// app/js/signup.js — 成功回應轉文案
message: already
  ? '你已經在名單上了 —— 模板連結照樣再給你一次:'
  : '完成,Email 已登記。這是你的 30 天行動追蹤模板:',
```

為什麼不報錯?第一,體驗:使用者換了台電腦回來再填,看到「此 email 已存在」只會困惑,他要的是模板,再給一次就好。第二,不從狀態碼洩漏:外人無法用「會不會報錯」來探測某個 email 在不在你的名單上。要誠實補一句:回應裡的 `already` 欄位本身還是可被探測的——這份名單只是「誰領了模板」,取捨偏向體驗;若你收的是敏感名單(客戶、病患、會員),連 `already` 都拿掉,讓兩種回應完全一致。

### 4. 誘因即時兌現:tracker.html

gift 連結指向一個純靜態頁 `app/assets/tracker.html`:30 天行動追蹤表,八個子目標乘三十天勾選格,A4 橫式列印 CSS,在瀏覽器按一鍵就變白底黑字的紙本。它還有個小巧思——和 App 同源,所以能直接讀 localStorage 把使用者自己的九宮格帶進表格:

```js
// app/assets/tracker.html — 從 localStorage 帶入八個子目標(沒有 state 就留空白手寫)
const STATE_KEY = 'goal-grid-state-v1';
const SUB_POSITIONS = [0, 1, 2, 3, 5, 6, 7, 8]; // 略過中央 4 = 核心目標
const state = readState();
const core = cellText(4);
if (core) coreEl.textContent = core;
```

領到的不是一張通用模板,是「印著你自己目標」的追蹤表。誘因的價值感就差在這裡。

### 5. 後台 admin.html:token gate

後台是一個獨立靜態頁:輸入管理密碼、向 Worker 的 `GET /list` 要名單、畫成表格。兩個前課就講過的鐵則,這裡照辦:密碼存在 Worker 的 Secret(`ADMIN_TOKEN`),永遠不出現在前端程式碼;傳輸走 `Authorization` 標頭,不放網址:

```js
// app/admin.html — token 走標頭,不放進網址(避免被瀏覽器歷史 / CDN log 記下)
const r = await fetch(apiBase() + '/list', { headers: { Authorization: 'Bearer ' + t } });
```

```js
// worker-deploy/src/lib/signup.js — Worker 端比對
export async function handleList({ db, env, bearer }) {
  if (!env.ADMIN_TOKEN || bearer !== env.ADMIN_TOKEN) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const { results } = await db
    .prepare("SELECT id, email, name, created_at, ip FROM signups ORDER BY id DESC").all();
  return { status: 200, body: { signups: results, count: results.length } };
}
```

### 6. token 存哪裡:sessionStorage,不是 localStorage

前課的後台把 token 記在 localStorage 圖個方便。本課改成 sessionStorage,原因值得搞懂:

這個站部署在 `yazelin.github.io`——GitHub Pages 上,**同一個帳號的所有專案頁共用同一個 origin**。瀏覽器的儲存以 origin 為界,意思是這個帳號下任何一個專案(包括多年前的舊 demo)只要有一個 XSS 漏洞,注入的腳本就能讀到「整個 origin」的 localStorage——包括你後台的 token。把長效憑證放 localStorage,等於讓爆炸半徑涵蓋你所有專案的歷史包袱。

sessionStorage 的差別:只活在這個分頁,分頁關了就消失。代價是每次開後台要重新輸一次密碼;換來的是被偷的窗口從「永久」縮成「這個分頁開著的期間」。後台一天開不了幾次,這筆交易很划算。同樣的理由,輸入框上方那行說明文字也直接告訴使用者「只記到這個分頁關閉為止」——安全設計講出來,就是信任感。

### 7. 匯出 CSV,接進 EDM 工具

名單的出口是 CSV——MailerLite、Mailchimp、Brevo 任何群發工具都吃。前端把 JSON 轉 CSV 有兩個容易踩的細節,這裡都處理了:

```js
// app/admin.html — CSV(RFC 4180):每個欄位都加雙引號、引號翻倍跳脫、列尾 CRLF
function buildCsv(items) {
  const q = (v) => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const rows = [['email', 'name', 'created_at', 'ip']]
    .concat(items.map((s) => [s.email, s.name || '', s.created_at, s.ip || '']));
  return rows.map((r) => r.map(q).join(',')).join('\r\n') + '\r\n';
}
// 開頭加 UTF-8 BOM:讓 Excel 直接開啟時正確識別中文
const blob = new Blob(['\uFEFF' + buildCsv(list)], { type: 'text/csv;charset=utf-8' });
```

欄位一律包雙引號並把引號翻倍,稱呼裡出現逗號或引號才不會把表撐破;開頭的 `\uFEFF`(UTF-8 BOM)讓 Excel 雙擊開啟時中文不變亂碼。匯出後丟進 EDM 工具的「匯入聯絡人」,你的第一波 email 行銷就有對象了。

### 8. 驗收

- App 步驟五填一個 email 送出:畫面當場出現模板連結,點開 `tracker.html` 看到自己的子目標已帶入,按列印預覽是白底 A4。
- 同一個 email 再送一次:看到「你已經在名單上了」,連結照給,不報錯。
- 開 `admin.html` 輸入 `ADMIN_TOKEN`:剛剛那筆在表格最上面;故意輸錯密碼,要看到「密碼不對」而不是名單。
- 匯出 CSV 用 Excel 開:中文正常、欄位對齊。
- 關掉後台分頁重開:要求重新輸入密碼(sessionStorage 生效)。

## 給 AI 的 prompt 範本

```text
幫我做一套 email 名單收集:Cloudflare Worker 端點 + 前端表單 + 管理後台,規格如下。

【資料表】D1 一張表 signups:id 自增主鍵、email(NOT NULL UNIQUE)、name、created_at、ip

【POST /signup】收 {email, name?, company?, turnstileToken?}:
- company 是 honeypot:有值就當機器人,回假成功(200 {ok:true, gift})但不寫入
- email 先 trim 再轉小寫,正規驗證格式,超過 120 字回 400 {error:"bad_email"}
- 防線三層:每 IP 每分鐘 5 次(記憶體)、Turnstile(secret 未設則跳過)、
  D1 每日配額每 IP 10 次(原子 upsert,不可用先讀後寫)
- 寫入成功回 200 {ok:true, gift:<模板網址>}
- email 重複(UNIQUE 衝突)不報錯:回 200 {ok:true, already:true, gift:同上}

【GET /list】讀 Authorization: Bearer <token> 標頭,與 Secret ADMIN_TOKEN 比對,
不對回 401;對了回 {signups:[...], count}。token 絕不接受放在網址 query。

【前端表單】email 輸入框 + 送出鈕 + honeypot 欄位(position:absolute 移出視野、
tabindex=-1、aria-hidden);成功顯示「完成,這是你的模板:」加 gift 連結,
already 時顯示「你已經在名單上了,連結照樣再給你一次」;送出中要鎖按鈕。

【後台 admin.html】單檔靜態頁,meta robots noindex:
- 密碼輸入 → 帶 Bearer 標頭打 /list → 名單畫成表格(欄位要做 HTML 跳脫)
- token 存 sessionStorage 不是 localStorage(共用 origin 的 XSS 爆炸半徑),
  並在介面註明「只記到分頁關閉為止」
- 匯出 CSV 按鈕:RFC 4180(欄位全包雙引號、引號翻倍、CRLF 列尾),
  檔案開頭加 UTF-8 BOM 讓 Excel 認得中文

【驗收】用 curl 測五種情境:正常註冊、重複註冊、honeypot、爛 email、錯 token,
每種的狀態碼與 body 都符合上面規格才算完成。
```

## 常見坑

1. **裸表單沒擋機器人**:公開的收集端點一定被灌垃圾。本章疊了四道:honeypot、分鐘限流、Turnstile、D1 日配額——便宜端點也值得上原子配額(第 08 章)。
2. **把重複註冊當錯誤**:體驗中斷、還從狀態碼洩漏名單成員。UNIQUE 去重 + 照樣回成功;敏感名單連 `already` 欄位都別回。
3. **誘因開空頭支票**:「之後寄給你」依賴寄信系統,第一版最常在這失信。用靜態資產讓承諾在同一個畫面兌現。
4. **管理密碼放進網址**:`?token=xxx` 會被瀏覽器歷史、CDN 日誌、referer 記下。一律走 `Authorization` 標頭。
5. **token 存 localStorage**:在 `github.io` 這種共用 origin 上,任何一個舊專案的 XSS 都能撈走它。用 sessionStorage 縮小爆炸半徑;名單升級成真實客戶個資時,改用前課模組 9 的 Cloudflare Access 實名門禁。
6. **CSV 沒處理跳脫與 BOM**:稱呼裡一個逗號就讓整列錯位;沒有 BOM,Excel 開起來中文全是亂碼。
7. **個資責任**:收了 email 就有保管責任——頁面寫清楚用途、不需要的欄位不收、名單不外流;正式營運要補退訂機制(前課模組 9 講過,這裡同樣適用)。

## 對照成品

- 互動體驗:[demos/05-email/](../demos/05-email/index.html) ——表單 + honeypot 的單檔版本,可指向真 Worker 實際送一筆。
- 完整版:[App](../app/) 步驟五(送出後當場拿模板)、[admin.html](../app/admin.html)(輸入管理密碼看名單、匯 CSV)、[tracker.html](../app/assets/tracker.html)(30 天行動追蹤模板,會帶入你的九宮格)。
- Worker 端原始碼:`worker-deploy/src/lib/signup.js` 與 `schema.sql`(在 dev repo,不隨教材發佈;本章程式碼塊取自該處)。
