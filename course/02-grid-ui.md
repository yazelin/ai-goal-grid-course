# 第 02 章 — 九宮格 UI 與資料模型

## 學完能做什麼

- 做出一個 3×3 九宮格填寫頁:中央是核心目標、周圍八格是子目標,每格都能打字。
- 設計一個讓 AI 之後接得上手的資料模型:「null = 留給 AI;有字 = 使用者的,不准動」。
- 讓填寫內容即時存進 localStorage:關頁、重新整理都不會丟。

## 核心觀念:畫面是畫面,資料是資料

這章開始動手蓋產品,但第一課不是「怎麼畫九宮格」,而是「資料跟畫面分開」。畫面是九個 textarea;資料是一個長度 9 的陣列,活在 JS 變數裡、備份在 localStorage。畫面隨時可以砍掉重畫,資料才是本體 —— 之後每一章(AI 補格、展開 81 格、桌布合成)都是對這個陣列做事,不是對畫面做事。

資料模型裡還藏著整個產品最重要的一條約定:每一格的值要嘛是 `null`,要嘛是 `{text, source}`。`null` 不是「沒資料」,是一個明確的指令 ——「這格留給 AI」。`source` 記錄這格是 `'user'` 還是 `'ai'` 填的;下一章 AI 補格的鐵律「使用者寫的一字不改」,就是靠這個欄位才執行得了。用行銷的話說:「尊重使用者輸入」這個產品承諾,直接寫進了資料結構。

## 步驟

### 1. 用 CSS Grid 排出 3×3

九宮格不需要任何畫布或框架,CSS Grid 一行就排好:

```css
.grid3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
.cell {
  border: 1px solid #2c3a52;
  border-radius: 12px;
  background: rgba(8, 12, 20, 0.62);
}
.cell-core { border-color: #c9a44e; }   /* 中央格用金色強調 */
.cell textarea {
  display: block; width: 100%; min-height: 96px;
  background: transparent; border: 0; outline: none; resize: none;
  color: #e8ecf4; font-size: 14px; line-height: 1.55; text-align: center;
  padding: 1.45rem 0.5rem 0.6rem;
}
```

`repeat(3, 1fr)` 的意思是「三欄、每欄等寬」。手機上不用寫任何 media query,3×3 天生就是窄螢幕友善的版型。HTML 端只需要一個空容器:

```html
<div class="grid3" id="grid3"></div>
```

### 2. 定義資料模型:null = 留給 AI

```js
const STATE_KEY = 'goal-grid-state-v1';

function defaultState() {
  return {
    version: 1,
    // 長度 9 的陣列,index 4 = 中央核心目標
    // 每格:null(留給 AI)或 {text, source:'user'|'ai'}
    cells: Array(9).fill(null),
    updatedAt: new Date().toISOString(),
  };
}
```

兩個設計眼:`version: 1` 讓你之後改格式時,認得出舊資料、不會被它弄壞;`index 4 = 核心目標` 是因為九格由左到右、由上到下編號 0 到 8,正中央剛好是 4。

### 3. 讀寫 localStorage

```js
function loadState() {
  try {
    const raw = JSON.parse(localStorage.getItem(STATE_KEY));
    if (raw && raw.version === 1 && Array.isArray(raw.cells)) return raw;
  } catch { /* 資料壞了就當沒存過 */ }
  return defaultState();
}

function saveState(state) {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function setCell(state, idx, text, source = 'user') {
  const t = String(text ?? '').trim();
  state.cells[idx] = t ? { text: t, source } : null;   // 清空 = 還給 AI
  state.updatedAt = new Date().toISOString();
  saveState(state);
}
```

`setCell` 是唯一的寫入口:trim 之後是空字串,就把該格寫回 `null` ——「把字刪光」等於「這格還給 AI」。所有寫入都走同一個函式,存檔就不會漏。

### 4. 畫出九宮格,用 dataset.idx 對位

```js
const state = loadState();
const grid = document.getElementById('grid3');

for (let i = 0; i < 9; i++) {
  const cell = document.createElement('div');
  cell.className = i === 4 ? 'cell cell-core' : 'cell';

  const ta = document.createElement('textarea');
  ta.dataset.idx = String(i);                 // 畫面第 i 格 ←→ state.cells[i]
  ta.placeholder = i === 4 ? '我的核心目標' : '留給 AI';
  ta.value = state.cells[i] ? state.cells[i].text : '';
  ta.addEventListener('input', () => {
    setCell(state, Number(ta.dataset.idx), ta.value);   // 即打即存
  });

  cell.appendChild(ta);
  grid.appendChild(cell);
}
```

`dataset.idx` 是這章的關鍵小技巧:每個 textarea 自己「記得」自己是第幾格,事件發生時用它寫回陣列的正確位置。不要用 DOM 順序去猜對應關係 —— 之後版面一改(插了標籤、換了排序),用順序猜的程式碼就全錯位,而 `dataset.idx` 不動如山。

注意 placeholder 的文案:「留給 AI」。空格在這個產品裡不是未完成,是一種合法狀態 —— UI 文案跟資料模型講同一種語言。

### 5. 驗收

- 填三格(含中央),重新整理 → 內容都在。
- 把某一格的字全部刪掉,重新整理 → 該格回到 placeholder「留給 AI」。
- F12 → Application → Local Storage → 找到 `goal-grid-state-v1`,值是一串 JSON,手填的格子 `source` 是 `"user"`。
- 視窗縮到手機寬度,3×3 沒有破版、沒有橫向捲軸。

## 給 AI 的 prompt 範本

```text
做一個單檔 HTML 的「目標九宮格」填寫頁(所有 CSS/JS 內嵌在同一個檔案):

【版面】3×3 九宮格,用 CSS Grid(repeat(3,1fr)、gap 10px);每格一個 textarea;
中央格是「核心目標」,邊框用金色強調;其餘八格是子目標
【資料模型】一個長度 9 的陣列 cells,index 4 = 核心目標;每格的值:
null 代表「留給 AI」,有字則存 {text, source:'user'}(之後 AI 填的會用 source:'ai',
所以結構要先留好)
【儲存】每次輸入即存 localStorage(key 'goal-grid-state-v1',JSON 格式、含 version:1);
頁面載入時讀回;JSON 解析失敗或版本不對,就用全新空白狀態,不准報錯
【對位】每個 textarea 用 dataset.idx 記住自己是第幾格,事件裡用它寫回陣列;
清空格子時要把該格寫回 null(trim 後為空就算清空),不是存空字串
【風格】深夜藍底 #0e1420、金色 #c9a44e 點綴,繁體中文,手機優先;
空格的 placeholder 文字是「留給 AI」,中央格是「我的核心目標」
【驗收】1. 填三格 → 重新整理 → 內容都在
2. 把一格字刪光 → 重新整理 → 該格回到 placeholder
3. 開發者工具看 localStorage,手填格子的 source 是 "user"
4. 視窗縮到 375px 寬不破版
```

## 常見坑

1. **dataset 永遠是字串**:`ta.dataset.idx` 拿到的是 `"4"` 不是 `4`。當索引用要先 `Number()`,直接拿去 `=== 4` 比較會永遠 false。
2. **把字串直接存進陣列**:`cells[i] = "減重五公斤"` 看起來能動,但丟掉了 `source` —— 下一章 AI 補格就分不出哪些是使用者手填的,「一字不改」的承諾沒辦法落實。包成 `{text, source}` 是在替未來的功能留接口。
3. **JSON.parse 沒包 try/catch**:localStorage 裡可能躺著舊版格式或壞掉的字串,一 parse 就丟例外、整頁 JS 停擺。讀回來的資料永遠當「來路不明」處理(完整版 `app/js/state.js` 的 `normalizeState` 甚至逐格重新驗證)。
4. **清空格子沒有歸 null**:沒做 trim、直接存 `{text:""}` 或一串空白,AI 會以為這格已被使用者佔用而跳過它。`setCell` 裡「trim 後為空就寫回 null」那行,就是在防這個。
5. **用 innerHTML 塞使用者輸入**:重繪畫面時用 `innerHTML` 把使用者文字拼進 HTML,等於讓任何輸入(包括之後 AI 的輸出)注入任意標籤。一律用 `textarea.value` 或 `textContent`。
6. **忘了中央格的特殊性**:index 4 是核心目標,跑「八個子目標」的迴圈時要跳過它。完整版 `app/js/grid.js` 用 `subIndexOf(pos)` 做這個換算(0–3 不變、5–8 減一),之後的配色與 81 格展開都靠它。

## 對照成品

- `demos/01-grid-ui/index.html` —— 本章成品,單檔、雙擊能開;照步驟做完(或叫 AI 重現)後,你手上應該就是這個東西。
- 完整版的同一套邏輯在 `app/js/state.js`(資料模型 + localStorage,外加 IndexedDB helpers)與 `app/js/grid.js`(3×3 之外還有 9×9 檢視、AI 徽章格)—— 讀起來會發現骨架跟本章一模一樣,只是格子變多了。
- 線上版: https://yazelin.github.io/ai-goal-grid-course/app/ 的步驟二,就是這章的 UI 加上完整視覺。
