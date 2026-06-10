# 第 10 章 — 進階 9×9 與發佈:展開 81 格,然後讓全世界(和 AI)看見

## 學完能做什麼

- 把 3×3 一鍵展開成大谷正宗的 81 格:AI 對八個子目標序列展開、有進度、失敗可從中斷點續跑。
- 做出 9×9 桌布版型:中央 3×3 放大當視覺主體、81 全圖縮小擺旁邊,手機上依然可讀。
- 用 publish.sh 把私有工作 repo 發佈成公開課程站,配齊 llms.txt、sitemap、JSON-LD、OG 圖——讓搜尋引擎和 AI 都讀得懂你。

## 核心觀念:81 格的勸退門檻,AI 把它變成一鍵

大谷翔平那張目標達成表流傳了十幾年,看過的人成千上萬,真正填完 81 格的人極少。不是方法不好,是門檻設計使然:中央 3×3 填完正有成就感,接著要為八個子目標**各想八個具體行動**——64 個空格瞪著你,多數人在這裡合上筆記本。這正是 AI 該站的位置:不是替你想得更好,是把「64 個空格」這個心理門檻變成一鍵,生出一版夠好的草稿,你只負責改與刪。改一個字的門檻,遠低於想一個詞。

本章的後半是發佈。做完的東西沒被看見等於沒做(前課模組 10 的開場白,在這裡依然成立),而這門課自己的發佈流程就是教材:**dev 私有 repo 是工作檯,公開 repo 是櫥窗**——設計文件、驗證截圖、Worker 原始碼、管理 token 全留在工作檯,一支 `publish.sh` 只把櫥窗該有的東西搬出去。分離的好處不只安全,還有自由:工作檯可以亂,櫥窗永遠乾淨。

## 步驟

### 1. 資料模型:actions 是 8×8

3×3 的九格存在 `state.cells`(第 02 章);展開後的 64 個行動存在 `state.actions`——八列,每列對應一個子目標的八個行動,沿用「null = 留給 AI、有物件 = 使用者鎖定」的同一套模型:

```js
// localStorage 'goal-grid-state-v1'
state.cells   = Array(9);  // null | {text, source:'user'|'ai'},index 4 = 核心目標
state.actions = Array(8);  // null | Array(8) of (null | {text, source})
```

### 2. AI 展開:每個子目標一次呼叫

Worker 的 `/fill` 端點第 03 章就建好了,展開只是它的第二種模式(`mode:'expand'`):送核心目標、一個子目標、該列已填的行動,拿回八個行動。prompt 把方法論直接寫進規則——行動要具體到能每日檢核,並拿大谷當示範:

```js
// worker-deploy/src/lib/prompts.js(節錄)
規則:
1. 行動要具體可執行、最好可每日/每週檢核
   (例:大谷在「運」底下寫「撿垃圾」「打招呼」這種日常小事)。
2. 每格 2-10 個字,繁體中文(台灣用語),彼此不重複,不用標點結尾,不用 emoji。
3. 已填的原樣保留,一字不改。
```

### 3. 序列展開:八次呼叫,一個迴圈

「展開 81 格」按下去是八次 API 呼叫。直覺會想用 `Promise.all` 八個一起發,這裡刻意用**序列**:

```js
// app/js/main.js — runExpand(節錄)
const coreGoal = state.cells[4].text;
for (let s = 0; s < 8; s++) {
  aiProgressEl.textContent = `展開中 ${s + 1}/8`;
  const existing = (state.actions[s] || Array(8).fill(null)).map((a) => (a ? a.text : null));
  if (existing.every(Boolean)) continue;          // 這個子目標已滿,不重抽
  const subGoal = state.cells[posOfSubIndex(s)].text;
  const actions = await api.expandSub(coreGoal, subGoal, existing);
  actions.forEach((text, j) => {
    if (!existing[j]) setAction(state, s, j, text, 'ai');
  });
  persist();                                       // 每完成一列就存檔
}
```

序列的三個理由,都跟長流程的體驗有關:

- **進度感**:「展開中 3/8」讓使用者知道沒當機;八個並發只能給一顆轉圈圈。
- **失敗只損一格**:第五列失敗,前四列已各自 `persist()` 進 localStorage;再按一次,`existing.every(Boolean)` 會跳過已完成的列,從斷點續跑,不重抽、不重複扣配額。
- **對上游友善**:八個請求同時打,容易撞 LLM 服務的速率限制,整批失敗。

注意展開的前提:3×3 必須先填滿(自己填或 AI 補),因為每一列展開都要拿「核心目標 + 該子目標」當脈絡。程式裡有守門,文案直接告訴使用者先做哪一步。

### 4. 9×9 桌布版型:主體與全圖分離

81 格直接鋪滿手機桌布,每格字只剩幾個像素——不可讀的桌布沒人會設。本課的版型把「情感主體」和「完整資訊」分開:中央 3×3 放大當視覺主角,81 全圖縮小放下方(直式)或右側(橫式),想細看時放大圖片看得到,平時鎖定畫面看到的是九個大字:

```js
// app/js/wallpaper.js — layoutWallpaper(節錄)
if (mode === '9x9') {
  // 直式:3×3 中心移到 0.30H(騰出下方);橫式:3×3 置左 0.27W
  if (orientation === 'portrait') { cx = 0.5 * W; cy = 0.3 * H; }
  else { cx = 0.27 * W; cy = 0.5 * H; }
}
// 81 全圖:直式寬 0.92W、中心 0.74H;橫式寬 0.5W、中心 0.72W
```

色彩上沿用大谷表轉載圖的慣例:八個子目標各有一色,81 全圖裡每個外圍區塊的中心格用同一色呼應,視線能立刻對上「這個區塊在展開哪個子目標」:

```js
// drawGrid81(節錄):外圍區塊中心格 = 子目標,同色呼應
drawCell(ctx, rect, g.radius, {
  fill: hexA(subColor, 0.32),
  border: hexA(subColor, 0.9),
  text: cellText(cells[subPos]),
  ...
});
```

文字縮放交給第 06 章寫好的 `fitText`(二分搜尋字級 + CJK 逐字斷行),81 格的字長差異再大也不會爆框。

### 5. 發佈:dev 私有 + 公開雙 repo,一支腳本同步

repo 有兩個:`ai-goal-grid-course-dev`(私有,日常工作都在這)和 `ai-goal-grid-course`(公開,GitHub Pages 從這裡服務)。同步靠一支三十行的腳本,值得整段讀懂:

```bash
#!/usr/bin/env bash
# scripts/publish.sh — 把教材從 dev repo 發佈到公開 repo
set -euo pipefail
cd "$(dirname "$0")/.."

PUB_REPO="https://github.com/yazelin/ai-goal-grid-course.git"
PUBLISH_PATHS=(index.html .nojekyll slides demos course app \
               assets sitemap.xml llms.txt robots.txt)

TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --depth 1 "$PUB_REPO" "$TMP/pub"

# 清空(留 .git)後重放發佈集
find "$TMP/pub" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
for p in "${PUBLISH_PATHS[@]}"; do
  [ -e "$p" ] && cp -r "$p" "$TMP/pub/"
done
# app 的 node 測試屬開發資產,不發佈
rm -rf "$TMP/pub/app/test"
cp README-public.md "$TMP/pub/README.md"

cd "$TMP/pub"
git add -A
if git diff --cached --quiet; then
  echo "publish: 沒有變更,跳過"
else
  git commit -q -m "publish: $(date +%Y-%m-%d) 教材更新"
  git push -q origin main
  echo "publish: 已推送 $(git rev-parse --short HEAD)"
fi
```

三個設計決定:

- **白名單,不是黑名單**:`PUBLISH_PATHS` 列出「要公開什麼」。黑名單(排除 docs/、worker-deploy/⋯)總有一天漏掉新增的私有資料夾,白名單預設安全——新東西不會被意外公開。
- **清空重放**:先把公開 repo 清空(留 `.git`)再複製,dev 這邊改名或刪除的檔案才會同步消失,不會在公開站留殭屍頁。
- **可重複執行**:沒變更就跳過 commit。跑十次和跑一次結果相同,你永遠不用怕「再跑一次會不會壞」。

公開 repo 的 README 也是發佈品(`README-public.md` 改名而成)——dev repo 的 README 寫給自己,公開的寫給訪客,兩份各司其職。

### 6. AEO:讓 AI 搜尋引擎讀懂你的課

越來越多人問 ChatGPT / Perplexity 而不是 Google,你的課要讓 AI 講得出來(完整原理在前課模組 10,這裡列本課的實際配備):

**llms.txt** ——放在站點根目錄、專門寫給 LLM 的純文字說明書:一句話講清楚你是誰,然後把重要連結攤開:

```text
# AI 互動行銷頁實戰 — 目標九宮格

> 教行銷人員把 AI 行銷頁零件整合成完整產品的實戰課程。
> 範例產品:訪客用 AI 填好「目標九宮格」⋯⋯生成專屬桌布下載,
> 並以 30 天行動追蹤模板為誘因留下 email。

## 成品
- [目標九宮格 App](https://yazelin.github.io/ai-goal-grid-course/app/)
## 課程章節(course/)
- 08 防刷與額度(Turnstile + D1 原子配額)
⋯⋯
```

**sitemap.xml** ——列出所有公開頁(首頁、app、slides、五個 demo),提交 Google Search Console。

**JSON-LD(Course schema)** ——課程首頁 `<head>` 裡給機器讀的身分證,AI 和 Google 都吃:

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Course",
  "name": "AI 互動行銷頁實戰 — 目標九宮格",
  "description": "教行銷人員把 AI 行銷頁零件組成完整產品的實戰課程。",
  "provider": { "@type": "Person", "name": "Yaze Lin", "url": "https://yazelin.github.io/" },
  "isAccessibleForFree": true,
  "inLanguage": "zh-Hant"
}
</script>
```

**robots.txt 的誠實註記** ——GitHub Pages 專案頁(`帳號.github.io/repo名/`)的 robots.txt 與 llms.txt 放在子路徑,爬蟲實際讀的是網域根。本課的 robots.txt 開頭就註明這件事,真正的站根檔案由 `yazelin.github.io` 主 repo 管理(在它的 llms.txt 列出所有子專案)。這是前課模組 10 用檢測工具實測過的坑:AEO 分數低,先確認工具掃的是哪個 URL。

另外兩個本課一直在做、容易忘記歸進 AEO 的事:後台與模板頁都加了 `<meta name="robots" content="noindex">`(admin.html、tracker.html 不該出現在搜尋結果);關鍵資訊全用文字寫在頁面上,不藏在圖裡。

### 7. OG 圖:分享出去的第一印象

課程連結被貼到 LINE / FB 時長什麼樣,由 OG tags 決定。本課的 `assets/og-course.jpg` 是 1200×630、壓在 200KB 內的 AI 生成圖(深夜藍加金的九宮格意象,不含文字——中文字交給 og:title 顯示,不讓 AI 畫)。鐵則跟前課一樣:`og:image` 必須是完整 https 網址,相對路徑抓不到;改圖後用 FB Sharing Debugger 強制重抓快取。

### 8. 驗收

- 3×3 填滿後按「展開完整 81 格」:進度從 1/8 走到 8/8;中途斷網再按一次,從斷掉的那列續跑,已展開的列不重抽。
- 桌布步驟切到 9×9:直式是「上 3×3、下全圖」,橫式是「左 3×3、右全圖」;手機鎖定畫面上中央九格清晰可讀。
- `bash scripts/publish.sh` 跑兩次:第一次推送,第二次顯示「沒有變更,跳過」。
- 公開 repo 檢查:沒有 docs/、scripts/、worker-deploy/,沒有 `app/test/`,README 是公開版。
- 把課程網址貼給 ChatGPT 或 Claude 問「這在講什麼」:答得出是一門做目標九宮格產品的行銷課,AEO 就生效了;再貼到 LINE 看 OG 預覽卡。

## 給 AI 的 prompt 範本

展開 81 格與 9×9 桌布(接在你既有的九宮格 App 上):

```text
我的九宮格 App 已有 3×3 填寫、AI 補格、桌布合成。幫我加「進階 9×9」:

【資料模型】localStorage state 加 actions:長度 8 的陣列,每項是 null 或
長度 8 的 (null | {text, source:'user'|'ai'});actions[i] = 子目標 i 的八個行動。

【AI 展開】「展開完整 81 格」按鈕:
- 前提:3×3 九格都有字,否則提示「先補滿空格再展開」
- 對八個子目標逐一(序列,不要並發)呼叫 AI:送核心目標、該子目標、
  該列已填的行動,要求回 JSON {"actions":[8 個字串]};已填的原樣保留
- 行動要具體可每日檢核、每格 2-10 個字、繁體中文(台灣用語)、不用 emoji
- 顯示進度「展開中 x/8」;每完成一列就存進 localStorage
- 已填滿的列跳過不重抽 —— 失敗後再按一次要能從斷點續跑

【9×9 檢視】巢狀 grid:外圈 8 區塊各 3×3,區塊中心 = 對應子目標的唯讀鏡像,
其餘 8 格可編輯寫回 actions;中央區塊 = 整張 3×3 的唯讀鏡像。
每個區塊用該子目標的代表色標示。

【9×9 桌布版型】直式(1170x2532):中央 3×3 放大置於上方(中心約 0.30 高),
81 全圖縮小置於下方(寬 0.92,中心約 0.74 高);橫式(1920x1080):3×3 置左、
81 全圖置右。81 全圖中,每個外圍區塊的中心格用對應子目標的顏色呼應。
文字用「二分搜尋字級 + 中文逐字斷行」塞進格子,最小 14px。

【驗收】展開到一半模擬失敗(斷網),再按一次能續跑;9×9 直式桌布輸出 PNG 後,
中央九格在手機螢幕上可讀。
```

發佈與 AEO 資產:

```text
幫我的課程 repo 做發佈系統與 SEO/AEO 資產:

【雙 repo】私有 dev repo 是工作檯;公開 repo 只放發佈品,GitHub Pages 從它服務。

【publish.sh】bash 腳本,set -euo pipefail:
- 白名單陣列 PUBLISH_PATHS 列出要公開的路徑(index.html、course、demos、app、
  assets、sitemap.xml、llms.txt、robots.txt⋯),絕不用「排除法」
- 流程:clone 公開 repo 到暫存資料夾 → 清空(保留 .git)→ 複製白名單路徑 →
  刪掉 app 裡的測試資料夾 → README-public.md 改名 README.md →
  有變更才 commit push,沒變更就印「跳過」
- 可重複執行,跑幾次結果都一樣

【AEO 資產】
- llms.txt:站點一句話定位 + 成品/章節/demo 連結清單(純文字、給 LLM 讀)
- sitemap.xml:列出所有公開頁
- 課程首頁 <head> 加 JSON-LD,@type 用 Course,內容必須與頁面一致
- 後台頁與贈品頁加 meta robots noindex
- robots.txt 註明:GitHub Pages 專案頁的 robots/llms 在子路徑,
  爬蟲讀的是網域根,真正站根檔案由主 repo 管理

【OG】og:title / og:description / og:image(1200x630、完整 https 網址、200KB 內)

【驗收】publish.sh 連跑兩次,第二次顯示無變更;公開 repo 裡 grep 不到
dev 專用資料夾;把首頁網址貼給 AI 問「這在講什麼」,要答得出課程主題。
```

## 常見坑

1. **八個展開請求一起發**:撞速率限制整批失敗、沒有進度感、失敗全毀。序列 + 逐列存檔 + 已滿跳過,才有「斷點續跑」。
2. **展開前沒守門**:3×3 還有空格就展開,AI 拿不到脈絡,生出來的行動空泛。先補滿再展開,程式擋 + 文案引導。
3. **81 格直接鋪滿桌布**:手機上每格字小到不可讀。主體(3×3 放大)與全圖(縮小)分離,是版型的核心決定。
4. **手動複製資料夾來「發佈」**:漏刪舊檔、誤帶私有檔案,遲早出事。白名單 + 清空重放 + 腳本化。
5. **直接改公開 repo 的檔案**:下次 publish 整個被覆蓋。公開 repo 是輸出物,所有修改回 dev repo 再發佈。
6. **og:image 用相對路徑**:LINE / FB 抓不到,分享變破圖卡。完整 https 網址,改圖後用 Sharing Debugger 重抓。
7. **JSON-LD 跟頁面內容對不上**:亂填會被搜尋引擎降權。schema 寫的必須是頁面上真的有的東西。
8. **以為子路徑的 robots/llms 全站生效**:爬蟲讀網域根。要嘛自訂網域,要嘛把根域站的 llms.txt 做好並列出子專案(前課模組 10 的實測教訓)。
9. **sitemap 忘了更新**:新增 demo 或頁面後,sitemap.xml 與 llms.txt 要跟著加,發佈前看一眼。

## 對照成品

- 完整版:[App](../app/) ——第三步「展開完整 81 格」、第四步切 9×9 版型,整條路徑可離線玩到輸出 PNG。
- 發佈系統:`scripts/publish.sh`(在 dev repo,不隨教材發佈;本章已全文引用)。
- AEO 資產就在你眼前:這個公開站的 [llms.txt](../llms.txt)、[sitemap.xml](../sitemap.xml)、[robots.txt](../robots.txt),以及課程首頁的 JSON-LD——把首頁網址貼給任何 AI 問「這在講什麼」,自己驗收一次。
