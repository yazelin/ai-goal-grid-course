# 模組 7 — AI 編輯迴圈與降級設計:prompt 是可攜帶的資產

## 學完能做什麼

- 讓使用者用一句自然語言修改 AI 背景(「整體亮一點,天空加一點晚霞」),而不是整張重抽碰運氣。
- 善用上一章「背景與文字解耦」的紅利:改文字、換配色即時重繪,零等待、零成本。
- 設計一條零後端依賴的降級路徑:服務忙線或沒設金鑰時,「複製生圖 prompt」讓使用者自己去 ChatGPT/Gemini 生,「匯入背景圖」把成品帶回來繼續合成——行銷頁永遠走得完。

## 核心觀念:迭代有兩種,成本差一千倍

使用者拿到第一張桌布,幾乎一定會想改。這時要分清楚改的是哪一層:

- **改背景**:要重新生圖,快則數十秒(OpenAI 主路)、慢則兩三分鐘(自架備援),扣一次額度。
- **改文字、換風格配色**:只是 canvas 重繪,不到 0.1 秒,免費,可以改一百次。

上一章把「AI 畫背景、canvas 畫字」拆成兩層,紅利就在這裡兌現:貴的迭代與便宜的迭代被分開了,使用者可以放心玩文字,只有真的不滿意背景時才動用生圖額度。

至於「修改背景」是怎麼運作的——先打破一個錯覺:**生圖 API 沒有記憶**。你在 ChatGPT 裡說「再亮一點」它聽得懂,是因為對話介面幫你把上一張圖帶著;直接呼叫 API 時,所謂「編輯」其實是「把上一張圖當參考圖附上 + 在 prompt 裡加一句修改要求,整張重新生成」。理解這件事,後面的程式碼就都顯而易見了。

## 步驟

以下程式碼取自成品 `app/js/api.js` 與 `app/js/main.js`(有簡化,邏輯一致)。

### 1. edit 模式的請求長什麼樣

跟模組 5 的生成請求只差兩件事:prompt 多一行「修改要求」、參考圖欄位帶上一張背景。`app/js/api.js` 的 `submitWallpaper` 是這樣組的:

```js
// 原始 prompt 照舊用同一個模板組(風格詞、構圖約束、禁文字鐵律都還在)
let prompt = imagePrompt(req.goal, req.subGoals, presetById(req.styleId).words, req.orientation);

// 修改模式:把使用者那句話接在後面,明說「套用在上一版設計上」
if (req.editInstruction) {
  prompt += `\nRevision request from the user (apply it to the previous design): ${req.editInstruction}`;
}

const payload = {
  prompt,
  size: req.orientation === 'portrait' ? '1024x1536' : '1536x1024',
};
// 上一張背景圖放進參考圖欄位(純 base64,去掉 data: 前綴)
if (req.referenceImagesBase64 && req.referenceImagesBase64.length) {
  payload.reference_images_base64 = req.referenceImagesBase64;
}
```

注意:**原始 prompt 一個字都沒少**。如果只送「亮一點」三個字,模型就失去了風格與構圖的所有上下文,生出來的會是另一張不相干的圖。

### 2. 把上一張背景帶上(縮圖再上傳)

上一張背景在生成成功時已經存進 IndexedDB(模組 5),修改時撈出來、縮小、轉 base64:

```js
// main.js:editInstruction 有值 = 修改模式
if (editInstruction && bgRecord) {
  referenceImagesBase64.push(
    await blobToBase64(await resizeImageBlob(bgRecord.blob, 1280)),
  );
}
```

兩個工具函式都在上一章的 `wallpaper.js` 裡:`resizeImageBlob` 把長邊縮到 1280(原圖直接 base64 會把請求撐爆,伺服器有 20MB 上限),`blobToBase64` 轉完會把 `data:image/jpeg;base64,` 前綴去掉——上游 API 要的是純 base64。

送出之後走哪條路,跟模組 5 的三層一樣由 Worker 決定:主路(OpenAI)上,帶參考圖的請求會改打官方的 `/v1/images/edits` 端點(文生圖才是 `/v1/images/generations`),一樣同步回圖;自架備援路徑才是同一個 job 端點、同一套輪詢、同一條進度條。對 Worker 來說「生成」與「修改」是同一件事——差別只在有沒有參考圖。

### 3. 文字迭代零成本:只重繪,不重生

這層幾乎不用寫新程式碼——因為背景圖(`bgBitmap`)還在手上,任何文字或配色改動只要重跑一次上一章的 `renderWallpaper`:

```js
function rerenderWallpaper() {
  renderWallpaper(wallCanvas, {
    bgBitmap,                      // 背景不變,不重新生圖
    cells: state.cells,
    actions: state.actions,
    styleId: state.wallpaper.styleId,
    orientation: state.wallpaper.orientation,
    mode: wallpaperMode,
  });
}
```

成品在背景生成完成時,直接把這條規則講給使用者聽:

> 背景完成。不滿意可以輸入修改指示重生背景;改文字或換風格則即時重繪、不用重生。

這句話就是本章的 UX 核心:把「貴的路」和「免費的路」明白地標出來,使用者自然會把額度花在刀口上。

## prompt 是可攜帶的資產:降級設計

接下來這節是本章真正想教的行銷頁設計觀。

想一個問題:生圖服務在排隊(`queue_full`)、站方金鑰沒設(`not_configured`)、或今天額度用完了——使用者walk away,漏斗就斷在這裡。大多數網站的答案是一句「請稍後再試」,等於送客。

但回頭看第 1 步:我們手上其實握著一份完整的、品質很好的生圖 prompt——風格詞、構圖約束、主題意象,全是現成的。這份 prompt 不是只有自家後端能用,**貼到 ChatGPT 或 Gemini 一樣能生**,而使用者多半本來就有這些帳號。

所以降級路徑是兩個純前端按鈕,零後端依賴。成品把它們收在步驟四一個「服務忙線或想自己生?」的摺疊面板(`<details>`)裡,生圖出錯時自動展開:

### (a) 複製生圖 prompt

用前端那份相同的 `imagePrompt` 模板(`app/js/prompts.js` 與 Worker 端逐字同步,BYO 直連時走的就是它)組出完整 prompt,補一句長寬比提示(外面的工具不吃 `size: '1024x1536'` 這種 API 參數,要用人話講),一鍵複製:

```js
import { imagePrompt } from './prompts.js';
import { presetById } from './styles-presets.js';

function buildPortablePrompt(goal, subGoals, styleId, orientation, editInstruction) {
  let p = imagePrompt(goal, subGoals, presetById(styleId).words, orientation);
  if (editInstruction) {
    p += `\nRevision request from the user (apply it to the previous design): ${editInstruction}`;
  }
  // API 參數換成人話:長寬比提示
  p += orientation === 'portrait'
    ? '\nAspect ratio 2:3, vertical phone wallpaper.'
    : '\nAspect ratio 3:2, horizontal desktop wallpaper.';
  return p;
}

copyBtn.addEventListener('click', async () => {
  await navigator.clipboard.writeText(buildPortablePrompt(
    core.text, subGoals, state.wallpaper.styleId, state.wallpaper.orientation, null,
  ));
  showMsg(bgMsgEl, '已複製。貼到 ChatGPT 或 Gemini 生成,參考圖自己附上,生好的圖用下方「匯入背景圖」帶回來。', 'ok');
});
```

引導文案要把三步講完:貼過去生 → 下載圖 → 帶回來。使用者上傳過的參考照片在他自己手上,叫他直接附給 ChatGPT 即可——這條路上連參考圖都不用經過我們。

### (b) 匯入背景圖

一個檔案上傳框,把使用者自己生好的圖收回來當背景:

```js
importInput.addEventListener('change', async () => {
  const file = importInput.files[0];
  if (!file) return;
  try {
    bgBitmap = await createImageBitmap(file);
    // 跟 AI 生成的背景同等對待:存進 IndexedDB,標記來源是手動匯入
    bgRecord = {
      blob: file,
      meta: { source: 'manual', styleId: state.wallpaper.styleId,
              orientation: state.wallpaper.orientation },
      createdAt: new Date().toISOString(),
    };
    bgRecord.id = await idbPut('wallpapers', bgRecord);
    rerenderWallpaper(); // cover 裁切吃任何比例,直接重繪
  } catch {
    showMsg(bgMsgEl, '這張圖讀不進來,請換一張(支援一般圖片格式)。');
  }
});
```

不用檢查圖的長寬比——上一章的 `coverRect` 本來就吃任何比例,置中裁滿。匯入後的圖跟 AI 生的背景走完全相同的後續流程:文字合成、即時重繪、下載 PNG,連「修改背景」都能接著用(它會被當成下一輪的參考圖)。

最後一塊拼圖:**錯誤訊息要把這條路標成主要出路**。`not_configured`、`queue_full`、額度用完、生成逾時——這些錯誤面板上,第一順位的建議不是「稍後再試」,而是「複製生圖 prompt 自己生,生好匯入回來」。服務掛掉的瞬間,頁面從「壞掉的產品」變成「換一條路的產品」。

這就是「prompt 是可攜帶的資產」的意思:你花心思調出來的 prompt 模板,價值不綁死在自家後端上。後端是加速器(免操作、有額度管理),不是必經之路;漏斗的最後一步——下載桌布、留 email——永遠走得到。

## 給 AI 的 prompt 範本

在模組 6 成品的基礎上加功能,貼給 ChatGPT 或 Claude:

```text
我有一個九宮格桌布合成頁(canvas 把文字疊在背景圖上),請加三個功能:

【修改背景】背景生成成功後,顯示一個輸入框加「修改背景」按鈕。按下時:
1. 沿用原本那份完整的生圖 prompt,在最後面加一行:
   "Revision request from the user (apply it to the previous design): " +
   使用者輸入的修改句
2. 把目前這張背景圖縮到長邊 1280 的 JPEG、轉 base64(去掉 data: 前綴),
   放進請求的 reference_images_base64 陣列
3. 之後走跟初次生成完全相同的送出與輪詢流程
另外:改九宮格文字或換風格時只重繪 canvas,絕不重新生圖。

【複製生圖 prompt】一顆按鈕,把完整生圖 prompt(含風格描述與構圖約束)
組出來,結尾補一行長寬比提示(直式 "Aspect ratio 2:3, vertical phone
wallpaper." / 橫式 "Aspect ratio 3:2, horizontal desktop wallpaper."),
用 navigator.clipboard.writeText 複製;若 clipboard 不可用(非 https 或
file:// 開啟),退而把 prompt 顯示在一個唯讀 textarea 讓使用者自己全選
複製。按鈕旁附引導文案:「貼到 ChatGPT 或 Gemini 生成,參考圖自己附,
生好的圖用『匯入背景圖』帶回來」。

【匯入背景圖】一個檔案上傳框,選圖後 createImageBitmap 當作背景,
cover 置中裁切鋪滿畫布重繪(任何長寬比都收),後續文字合成、下載 PNG
照常運作。

【錯誤處理】生圖服務回傳「未配置」「排隊滿」「額度用完」「逾時」時,
錯誤訊息的第一建議是「複製生圖 prompt 自己生成,再匯入回來」,
而不是只說稍後再試。

【驗收】
1. 修改背景後,新圖看得出保留原構圖氛圍且套用了修改句。
2. 改文字後畫面瞬間更新,Network 面板沒有任何生圖請求。
3. 完全離線:複製 prompt(或 textarea 後備)、匯入圖、改字重繪、
   下載 PNG 全部可用。
4. 匯入一張正方形的圖配直式畫布:鋪滿、置中裁切、不變形。
```

## 常見坑

1. **以為 AI 記得上一張圖**:對話式工具寵壞了我們。API 是無狀態的——不附參考圖的「修改」等於完全重抽,跟上一張一點關係都沒有。
2. **只送修改句、丟掉原 prompt**:風格詞與構圖約束(含「不准畫字」鐵律)全在原 prompt 裡,修改句是追加,不是取代。
3. **參考圖沒縮就上傳**:手機原圖好幾 MB,三張 base64 直接撐爆請求(伺服器 20MB 上限)。先縮長邊 1280 再轉。
4. **base64 忘了去前綴**:`reference_images_base64` 要的是純 base64,`data:image/jpeg;base64,` 開頭的字串會被上游拒絕。
5. **clipboard API 默默失敗**:`navigator.clipboard` 在非 https 頁面或拿檔案直接開(file://)時可能不可用。降級路徑自己也要有降級:備一個唯讀 textarea。
6. **降級路徑藏太深**:做了複製與匯入,卻只放在頁面角落,錯誤訊息照樣只說「稍後再試」——使用者看不到出口等於沒有出口。出錯的當下就要把路指出來。
7. **匯入的圖比例不合就拒收**:不必。cover 裁切吃任何比例;頂多在引導文案提醒「跟 ChatGPT 要 2:3 直式,裁掉的部分會少一點」。

## 對照成品

- `app/`:步驟四的完整體驗——「AI 修改背景」輸入框、「複製生圖 prompt」與「匯入背景圖」都在,試著故意不設金鑰走一次降級路徑,看錯誤面板怎麼引導你。
- `demos/03-wallpaper/`:本章的合成底盤(模組 6 的成品),匯入背景圖後接著玩文字重繪,就能體會「貴的迭代」與「免費的迭代」差在哪。
