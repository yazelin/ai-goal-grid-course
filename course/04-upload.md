# 第 4 章 — 圖片上傳與前端縮圖:在瀏覽器裡先把圖變小

## 學完能做什麼

- 讓使用者從手機/電腦選照片當 AI 的參考圖,選完先在瀏覽器裡縮小,再送出。
- 把圖片轉成 API 要的 base64 格式,並知道那串 `data:image/...` 前綴為什麼要拿掉。
- 把圖片存進 IndexedDB,重新整理頁面照片還在——而且知道為什麼不能用 localStorage 存。

## 核心觀念:參考圖是給 AI 看的,不是要印海報

使用者上傳的照片是要給 AI 當風格與人物參考(第 7 章的 AI 編輯迴圈會用到),AI 看一張長邊 1280 像素的圖,跟看一張 4000×3000 的原圖,理解到的構圖、人物、氛圍幾乎沒有差別。但檔案大小差了十倍以上——傳原圖等於付費請 AI 看你自己都看不出差別的細節,還順便把上傳時間拉長十倍、把伺服器的請求大小上限撞爆。

所以原則是:**在瀏覽器裡先縮,再上傳**。現代瀏覽器本身就是一台夠用的影像處理器(讀檔、解碼、縮放、轉格式、轉編碼都有內建 API),這章就是把這條管線一步步接起來:選檔 → 縮圖 → 轉 base64 → 存起來。

## 步驟

### 1. 選檔:一個 input 就夠

```html
<input id="refs-input" type="file" accept="image/*" multiple>
```

`accept="image/*"` 讓手機直接開相簿,`multiple` 允許一次選多張。本專案限制最多 3 張(上游生圖服務的約定),超過就把 input 停用。

### 2. 縮圖:解碼 → 畫到 canvas → 輸出 JPEG

核心工具是 `app/js/wallpaper.js` 裡的 `resizeImageBlob`,整段如下:

```js
// 縮圖:長邊縮到 maxEdge,輸出 JPEG blob
export async function resizeImageBlob(blob, maxEdge = 1280, quality = 0.85) {
  const bitmap = await createImageBitmap(blob);   // 1. 解碼成點陣圖
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas');     // 2. 開一張縮小後尺寸的畫布
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h); // 3. 把圖畫上去 = 縮放
  bitmap.close();
  return new Promise((resolve, reject) => {
    c.toBlob((out) => {                            // 4. 畫布輸出成 JPEG 檔
      if (out) resolve(out);
      else reject(new Error('縮圖失敗'));
    }, 'image/jpeg', quality);
  });
}
```

逐行白話:

- `createImageBitmap(blob)`:把圖片檔解碼成記憶體裡的點陣圖,什麼常見格式進來都吃。
- `Math.min(1, ...)`:只縮小、不放大——圖本來就比 1280 小就原尺寸通過。
- `drawImage(...)` 畫到一張比較小的 canvas 上,縮放就完成了,瀏覽器自帶平滑演算法。
- `toBlob('image/jpeg', 0.85)`:輸出成 85% 品質的 JPEG。參考圖不需要無損,JPEG 比 PNG 小很多。

一張 8MB 的手機原圖,經過這條管線通常剩 150-400KB,肉眼看內容沒差。

### 3. 轉 base64,並把前綴拿掉

生圖 API 的約定是收「純 base64 字串」(欄位 `reference_images_base64`)。`FileReader.readAsDataURL` 讀出來的其實是「data URL」,長這樣:

```text
data:image/jpeg;base64,/9j/4AAQSkZJRg...
└────── 前綴 ──────────┘└── 真正的 base64 ──
```

所以轉完要把逗號前面那段切掉(`app/js/wallpaper.js`):

```js
// Blob → base64(去掉 data: 前綴,符合 upstream reference_images_base64 約定)
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
```

要不要去前綴沒有對錯,純看你呼叫的 API 怎麼約——文件說收 data URL 就留著,說收 raw base64 就切掉。撞到 400 錯誤時,這是第一個該檢查的地方。

### 4. 為什麼一定要前端先縮:算給你看

假設使用者選了 3 張手機原圖,每張 6MB:

- base64 編碼會讓體積再膨脹約 33%:6MB × 1.33 ≒ 8MB
- 3 張 = 24MB,整包 JSON 超過伺服器 nginx 的 20MB 請求上限(`client_max_body_size`),整個請求直接被擋,連 AI 的面都沒見到
- 就算過了,Worker 端還有一道驗證:每張 base64 超過 4MB 回 400(`worker-deploy/src/index.js` 的 `MAX_REF_B64`)

縮到長邊 1280 之後:每張約 300KB,base64 後約 400KB,3 張加起來 1.2MB——上傳幾秒內完成,離所有上限都遠。**體積問題在最靠近源頭的地方解決最便宜**,這裡的源頭就是使用者的瀏覽器。

### 5. 存進 IndexedDB:重新整理照片還在

文字狀態存 localStorage(第 2 章),但 localStorage 只能存字串、總量約 5-10MB,拿來存圖片很快就爆。瀏覽器專門存大塊資料的是 **IndexedDB**,可以直接存 Blob(二進位圖檔),空間以 GB 計。

開庫的樣板程式(`app/js/state.js`,寫一次之後到處用):

```js
function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('goal-grid', 1);
    req.onupgradeneeded = () => {
      // 兩個櫃子:'refs' 放參考圖、'wallpapers' 放生成的背景
      for (const name of ['refs', 'wallpapers']) {
        if (!req.result.objectStoreNames.contains(name)) {
          req.result.createObjectStore(name, { keyPath: 'id', autoIncrement: true });
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
```

包成三個好用的小函式之後(完整版在 `app/js/state.js` 的 `idbPut`/`idbAll`/`idbDelete`),上傳流程就是把所有零件串起來(`app/js/main.js`):

```js
refsInput.addEventListener('change', async () => {
  const files = [...refsInput.files].slice(0, 3 - refRecords.length); // 最多 3 張
  refsInput.value = '';
  for (const file of files) {
    try {
      const blob = await resizeImageBlob(file, 1280); // 長邊 1280,控制 body 體積
      await idbPut('refs', { blob, meta: { name: file.name }, createdAt: new Date().toISOString() });
    } catch (err) {
      showMsg(bgMsgEl, '這張圖讀不進來,請換一張(支援一般圖片格式)。');
    }
  }
  loadRefs(); // 重新從 IndexedDB 讀出來畫縮圖列表
});
```

注意 `try/catch`:少數格式(例如某些 HEIC)瀏覽器解不開,`createImageBitmap` 會丟錯——接住、給一句人話、讓使用者換一張,不要讓整個頁面停擺。

### 6. 顯示縮圖:借用記憶體網址

從 IndexedDB 讀出來的 Blob 要顯示成 `<img>`,用 `URL.createObjectURL` 生一個臨時網址,圖載入完就釋放,不佔記憶體:

```js
const img = document.createElement('img');
img.src = URL.createObjectURL(r.blob);
img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
```

到這裡,參考圖管線完工:選檔 → 縮圖 → 存 IndexedDB → 顯示縮圖;要送 AI 時再 `blobToBase64` 轉格式。送出去的部分屬於第 5、7 章。

## 給 AI 的 prompt 範本

在第 3 章成品的基礎上加上傳功能,貼這段:

```text
請在我現有的九宮格網頁(單一 HTML 檔)加一個「參考圖上傳區」:

【選檔】一個 input type="file" accept="image/*" multiple,最多收 3 張;
已滿 3 張時停用選檔並提示。

【縮圖】每張選進來的圖先在前端縮小:用 createImageBitmap 解碼,
長邊超過 1280 就等比例縮到 1280(不放大),畫到 canvas 後以
canvas.toBlob 輸出 image/jpeg、品質 0.85。解碼失敗的檔案要 try/catch
接住,顯示「這張圖讀不進來,請換一張」,不能讓頁面壞掉。

【儲存】縮好的 JPEG Blob 存進 IndexedDB:資料庫名 'goal-grid',
object store 名 'refs',keyPath 'id' 自動編號,
每筆 {id, blob, meta:{name}, createdAt}。頁面載入時把 'refs' 全部讀出來。

【顯示】上傳區下方顯示縮圖列表:每張用 URL.createObjectURL(blob) 當
img src,載入完成後 revokeObjectURL;每張縮圖旁有「移除」按鈕,
按了從 IndexedDB 刪除並重畫列表。

【轉換工具】另外給我一個 blobToBase64(blob) 函式:用 FileReader
readAsDataURL 讀出後,把 "data:...;base64," 前綴切掉只留純 base64
(之後要送給生圖 API 用,先寫好備用)。

【驗收】重新整理頁面,已上傳的縮圖還在;選一張 5MB 以上的手機照片,
存進去的 Blob 要明顯小於 1MB(可在 console 印 blob.size 確認)。
風格沿用現有頁面(深夜藍 #0e1420 + 金 #c9a44e),繁體中文,不用 emoji。
```

## 常見坑

1. **原圖直接 base64 上傳**:三張手機照片就能撞破 20MB 請求上限,而且 base64 還會放大 33%。先縮再傳,沒有例外。
2. **忘記去掉 data URL 前綴**:API 約定收純 base64 時,帶著 `data:image/jpeg;base64,` 前綴送過去就是 400。`split(',')[1]` 一行的事。
3. **iPhone 的 HEIC 檔解不開**:部分瀏覽器的 `createImageBitmap` 不支援 HEIC,會直接丟錯。一定要 `try/catch` 包住並給出「請換一張」的人話提示(iPhone 使用者可以從相簿「分享為 JPEG」或截圖代替)。
4. **拿 localStorage 存圖**:它只能存字串(就得存 base64,又膨脹 33%),配額約 5-10MB,存兩三張就滿,然後整個 app 的狀態保存跟著一起壞。圖片一律 IndexedDB。
5. **createObjectURL 沒釋放**:每呼叫一次就佔一塊記憶體,列表重畫幾十次後頁面越來越肥。圖片 `load` 之後就 `revokeObjectURL`。
6. **放大小圖**:縮圖函式忘了 `Math.min(1, ...)`,800px 的小圖被放大到 1280,糊了還變大。只縮不放。

## 對照成品

`app/` 的步驟四就是本章管線的完整版:選檔與縮圖列表在 `app/js/main.js`(搜尋 `refsInput`),縮圖與 base64 工具在 `app/js/wallpaper.js`(`resizeImageBlob`、`blobToBase64`),IndexedDB 三件組在 `app/js/state.js`(`idbPut`/`idbAll`/`idbDelete`)。這些參考圖在第 5 章送給 AI 生背景、在第 7 章的編輯迴圈再次出場。
