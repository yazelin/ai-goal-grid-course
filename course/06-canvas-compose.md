# 模組 6 — canvas 文字合成:AI 畫背景、canvas 畫字

## 學完能做什麼

- 親手重現「叫 AI 連中文字一起畫」的翻車現場,並講得出為什麼不能這樣做。
- 用 canvas 把九宮格文字精準疊在任何背景圖上:cover 縮放鋪滿、暗化遮罩保字、字級自動縮放、中文斷行(英文單字不被攔腰折斷)。
- 套用「中央格最強色、八個子目標各配一色」的配色慣例,輸出一張可直接下載的 PNG 桌布。

## 先翻車給你看:叫 AI 連中文字一起畫

開始之前,先做一個五分鐘的對照實驗。打開任何一個生圖工具(ChatGPT、Gemini 都行),貼這段:

```text
畫一張 3×3 的目標九宮格表格圖,深藍色底、金色框線。
中央格寫「完成全馬 42.195km」,
周圍八格依序寫:「每週跑 40km」「核心訓練」「睡滿 7 小時」
「補給策略」「配速練習」「比賽報名」「飲食管理」「跑姿調整」。
要求:每一格的繁體中文都清晰可讀、一字不差。
```

表格與配色多半畫得有模有樣,但湊近看文字,你會看到三種典型災難:

1. **偽漢字**:筆畫黏成字典裡不存在的字,遠看像中文、近看是亂碼。
2. **缺字、漏字、多字**:「每週跑 40km」變成「每跑 40」或自己加了沒人說過的詞。
3. **簡繁混雜**:「週」變「周」、「練」變「练」,同一張圖裡兩種寫法都有。

更麻煩的是:同一個 prompt 重抽三次,**三次錯的地方都不一樣**。錯得不穩定,代表你無法驗收——這種東西不能放上行銷頁。這還只是 9 格;本課進階模式是 81 格,全交給 AI 畫字連試都不用試。

為什麼會這樣?生圖模型是「畫畫的」,不是「排版的」。它把文字當圖案學:英文只有 26 個字母,模型看過的樣本夠多,短英文常常畫得對;常用中文字就有四、五千個,每個字筆畫結構又複雜,模型只能畫出「長得像中文的紋理」。這不是換個更新的模型就會好的小毛病,是原理性的限制。

## 核心觀念:分工——AI 畫氛圍,程式畫文字

正路是把工作拆成兩層:

- **AI 負責它擅長的**:氛圍、光線、風格、構圖——生成一張沒有任何文字的背景圖(模組 5 的生圖 prompt 裡有一條鐵律:`Do NOT render any text`)。
- **程式負責機器擅長的**:精準、可驗收的文字排版——用瀏覽器內建的 canvas,把九宮格一格一格畫上去。

背景是一張圖,文字是一層程式畫的圖,兩層合成後輸出 PNG。這個「解耦」還有一個下一章才兌現的紅利:改文字不必重新生圖,迭代零成本。

## 步驟

以下程式碼取自成品 `app/js/wallpaper.js`(有簡化,邏輯一致)。

### 1. 開一張「輸出尺寸」的 canvas

桌布要的是實際畫素,不是網頁排版尺寸:

```js
const CANVAS = { portrait: { w: 1170, h: 2532 }, landscape: { w: 1920, h: 1080 } };

const { w: W, h: H } = CANVAS[orientation];
canvas.width = W;   // 這是輸出畫素,不是 CSS 樣式
canvas.height = H;
const ctx = canvas.getContext('2d');
```

直式 1170×2532 是 iPhone 等級的桌布解析度;預覽時用 CSS 把 canvas 縮小顯示即可,輸出尺寸不受影響。

### 2. 背景 cover 縮放鋪滿

AI 生的背景是 1024×1536(或 1536×1024),跟畫布比例不完全相同。處理方式跟 CSS 的 `background-size: cover` 同一個邏輯:放大到剛好蓋滿、超出的部分置中裁掉。

```js
// 算出來源圖要裁切的區域 {sx, sy, sw, sh}
function coverRect(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

const { sx, sy, sw, sh } = coverRect(bgBitmap.width, bgBitmap.height, W, H);
ctx.drawImage(bgBitmap, sx, sy, sw, sh, 0, 0, W, H);
```

好處是這個函式不挑圖:任何比例的圖丟進來都能鋪滿(下一章「匯入背景圖」靠的就是它)。

### 3. 暗化遮罩:字的可讀性不能賭 AI 聽話

生圖 prompt 雖然要求「中央區域保持低對比留白」,但模型不一定每次都聽話。可讀性要靠自己保證,雙保險:

```js
// 保險一:全幅半透明暗化遮罩
ctx.fillStyle = 'rgba(8, 10, 16, 0.30)';
ctx.fillRect(0, 0, W, H);

// 保險二:每一格自己再墊一層更深的格底(畫格子時用)
const CELL_BG = 'rgba(12, 16, 24, 0.58)';
```

這樣不管背景多花,字底下永遠是深色,白字、淺色字一定讀得到。

### 4. fitText:二分搜尋找出塞得下的最大字級

九宮格每格的文字長度差異很大(「英文」兩個字 vs「睡前聽英文 podcast」九個字),固定字級必爆版。做法是用二分搜尋找「換行後仍塞得進格子的最大字級」:

```js
function fitText(measureFactory, text, opts) {
  const { maxWidth, maxHeight, maxFontSize, minFontSize = 14, lineHeight = 1.32 } = opts;
  const tryFit = (fs) => {
    const measure = measureFactory(fs);          // 該字級下的量寬函式
    const lines = wrapCJK(text, maxWidth, measure); // 先斷行(見下一步)
    const heightOk = lines.length * fs * lineHeight <= maxHeight;
    const widthOk = lines.every((l) => measure(l) <= maxWidth + 0.01);
    return heightOk && widthOk ? lines : null;
  };
  let lo = minFontSize;
  let hi = Math.max(minFontSize, Math.floor(maxFontSize));
  let best = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const lines = tryFit(mid);
    if (lines) { best = { fontSize: mid, lines }; lo = mid + 1; }
    else { hi = mid - 1; }
  }
  return best || { fontSize: minFontSize, lines: wrapCJK(text, maxWidth, measureFactory(minFontSize)) };
}
```

量字寬用 canvas 自己的 `measureText`,但**量之前一定要先把 `ctx.font` 設成要量的字級**,不然量出來的是上一次的字寬:

```js
const factory = (fs) => {
  ctx.font = `500 ${fs}px 'Noto Sans TC', 'Microsoft JhengHei', sans-serif`;
  return (s) => ctx.measureText(s).width;
};
const { fontSize, lines } = fitText(factory, '睡前聽英文 podcast', {
  maxWidth: cellW - pad * 2, maxHeight: cellH - pad * 2, maxFontSize: cellW * 0.15,
});
```

### 5. 中文斷行:逐字可斷,英數段不拆

中文沒有空格,canvas 也沒有自動換行,得自己斷。原則是:**中文字逐字都可以斷,但英數連續段(`160km`、`TOEIC`、`podcast`)是一個不可拆的單位**,放不下就整段移到下一行——拆成 `TOE` / `IC` 就不是人話了。

```js
function wrapCJK(text, maxWidth, measure) {
  const lines = [];
  let line = '';
  const push = (unit) => {
    const next = line + unit;
    if (line && measure(next) > maxWidth) { lines.push(line); line = unit; }
    else { line = next; }
  };
  // 英數連續段視為不可拆單位;其餘逐字
  const units = String(text).match(/[A-Za-z0-9]+|[\s\S]/gu) || [];
  for (const unit of units) {
    if (unit === '\n') { lines.push(line); line = ''; continue; }
    if (unit.length > 1 && measure(unit) > maxWidth) {
      for (const ch of unit) push(ch); // 整段比格子還寬才退回逐字硬拆
    } else {
      push(unit);
    }
  }
  lines.push(line);
  return lines.length ? lines : [''];
}
```

關鍵在那行正規表達式:`/[A-Za-z0-9]+|[\s\S]/gu` 把文字切成「英數段」與「單一字元」兩種單位,後面就用同一套邏輯排。

### 6. 配色慣例:中央格最強、八色各自呼應

網路上流傳的大谷翔平目標表轉載圖有一套大家看慣的配色語言,我們沿用它:

- **中央格(核心目標)**:整張圖最強的顏色——風格主色 85% 不透明度當底、3px 同色邊框、白色粗體字。
- **八個子目標格**:深色格底 + 各自一條 4px 彩色左邊條,八格八色。
- **9×9 模式**:外圍每個區塊的中心格,用對應子目標的同一個顏色(填色 32% 透明度 + 同色邊框)——一眼看出「這個區塊在展開哪個子目標」。

```js
// 顏色來自風格預設(styles-presets.js):每個風格帶 accent + sub[8]
const palette = presetById(styleId).palette;

// 位置 i(0-8,跳過中央 4)對應第幾個子目標
const subIndexOf = (pos) => (pos < 4 ? pos : pos - 1);

// hex 轉帶透明度的 rgba
function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 中央格:fill = hexA(palette.accent, 0.85),邊框 palette.accent 3px,白字 700
// 子目標格 i:fill = CELL_BG,左邊條 palette.sub[subIndexOf(i)] 4px,米白字 500
```

### 7. 輸出 PNG

合成完直接從 canvas 匯出檔案,全程不經過任何伺服器:

```js
canvas.toBlob((blob) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '目標九宮格.png';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}, 'image/png');
```

## 給 AI 的 prompt 範本

貼給 ChatGPT 或 Claude,可重現本章成品(單檔、雙擊能開):

```text
做一個單檔 HTML(CSS/JS 全內嵌)的「九宮格桌布合成器」:

【輸入】九個文字框(3×3 排列,中央是核心目標),加一個「上傳背景圖」
檔案選擇器(沒上傳就用深藍到金色的 linearGradient 漸層當背景)。

【畫布】直式 1170×2532 / 橫式 1920×1080,一組切換鈕。canvas 的
width/height 設成輸出畫素,預覽用 CSS 縮小顯示(max-width: 100%)。

【合成順序】
1. 背景圖 cover 縮放鋪滿(模仿 background-size: cover:取
   max(dstW/srcW, dstH/srcH) 的縮放比,置中裁切),用 drawImage 的
   九參數形式畫。
2. 疊一層 rgba(8,10,16,0.3) 全幅暗化遮罩。
3. 畫 3×3 九宮格:格子總寬 = min(0.86*畫布寬, 0.52*畫布高),格間距 =
   格寬*0.06,圓角 = 格寬*0.08,直式置中於 44% 高、橫式置中。
4. 底部置中一行半透明小字「目標九宮格」。

【格子配色】中央格:金色 #c9a44e 85% 透明度當底 + 3px 金色邊框 + 白色
粗體字;其餘八格:rgba(12,16,24,0.58) 格底 + 各自一條 4px 彩色左邊條
(八格八色,在深色底上要可讀)。

【文字排版】每格文字要自動縮放字級:用二分搜尋找「斷行後寬高都塞得進
格子」的最大字級,最小 14px,行高 1.32。斷行規則:中文逐字可斷,
連續英數段(如 160km、TOEIC)視為不可拆單位整段換行。量字寬用
ctx.measureText,量之前先設好 ctx.font。字型 'Noto Sans TC' 加系統
fallback。

【輸出】「下載 PNG」按鈕用 canvas.toBlob 下載。

【驗收】
1. 某格填「睡前聽英文 podcast 三十分鐘」:不溢出格子、podcast 沒被拆半。
2. 上傳一張直的照片配橫式畫布:鋪滿、置中裁切、不變形。
3. 上傳一張很亮的圖:每格文字仍清楚可讀。
4. 下載的 PNG 實際尺寸是 1170×2532(或 1920×1080)。
```

## 常見坑

1. **還是想叫 AI 畫字**:短英文偶爾成功,會讓人誤以為中文也行。記住判準:錯的位置每次不一樣 = 無法驗收 = 不能上線。
2. **用 CSS 思維設 canvas 尺寸**:`canvas.width` 是輸出畫素、CSS 的 `width` 只是顯示大小,兩者各管各的。只設 CSS 會得到一張 300×150 的糊圖。
3. **忘了遮罩,字看不清**:別依賴生圖 prompt 的「中央留白」約束,模型不一定聽話。全幅遮罩 + 格底是自己掌握的保證。
4. **英文單字被攔腰折斷**:純逐字斷行會把 `podcast` 拆成 `pod` / `cast`。英數連續段要當一個單位處理。
5. **measureText 量錯寬**:量之前沒先設 `ctx.font`,量到的是上一個字級的寬度,版面就會時好時壞。
6. **跨網域圖片污染 canvas**:直接 `drawImage` 一張外站圖,沒過 CORS 的話 `toBlob` 會丟 SecurityError。成品的做法是把生成圖先 `fetch` 回來變 Blob、存進 IndexedDB,再 `createImageBitmap` 來畫——順便解掉生成圖網址七天過期的問題。
7. **toBlob 是非同步的**:結果在 callback 裡,別寫成同步取值。

## 對照成品

- `demos/03-wallpaper/`:本章成品(漸層或上傳背景 + 文字合成 + 下載),雙擊能開。
- `app/js/wallpaper.js`:完整版,多了 9×9 全圖版型與風格預設;`app/` 走完五步就能體驗「AI 背景 + canvas 文字」的完整管線。
- 建議把開頭翻車實驗的圖跟本章成品擺在一起看一次——同樣的九格文字,一邊是賭運氣,一邊是一字不差。
