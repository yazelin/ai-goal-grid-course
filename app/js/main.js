// 目標九宮格 — 五步 wizard 主控
// 步驟三:AI 補完(api.js fillCore / expandSub);步驟四:桌布合成(wallpaper.js)+ AI 背景
// (submitWallpaper / pollWallpaper);步驟五:PNG 下載 + email 留資(signup.js)。

import { loadState, saveState, setCell, setAction, idbPut, idbAll, idbDelete } from './state.js';
import { renderGrid3, renderGrid9, renderAiGrid3, syncGrid9Mirrors, posOfSubIndex } from './grid.js';
import { STYLE_PRESETS, presetById } from './styles-presets.js';
import * as api from './api.js';
import { renderWallpaper, downloadCanvasPng, resizeImageBlob, blobToBase64 } from './wallpaper.js';
import { exportablePrompt } from './export-prompt.js';
import { initSignup } from './signup.js';

const state = loadState();
let step = 1;
let maxStep = 1; // 已到過的最遠步驟:rail 只開放回得去的地方

// 桌布執行期狀態(不進 localStorage;背景圖與參考圖在 IndexedDB)
let wallpaperMode = '3x3';
let bgBitmap = null; // ImageBitmap | null:null 時用 preset 漸層
let bgRecord = null; // 最近一筆 'wallpapers' 紀錄(AI 修改背景時當參考圖)
let refRecords = []; // 'refs' 參考圖紀錄

const sections = [...document.querySelectorAll('section[data-step]')];
const railSteps = [...document.querySelectorAll('.rail-step')];

const grid3El = document.getElementById('grid3');
const aiGridEl = document.getElementById('aigrid');
const grid9El = document.getElementById('grid9');
const grid9Wrap = document.getElementById('grid9-wrap');
const grid9Toggle = document.getElementById('grid9-toggle');

const aiFillBtn = document.getElementById('ai-fill');
const aiExpandBtn = document.getElementById('ai-expand');
const aiProgressEl = document.getElementById('ai-progress');
const aiMsgEl = document.getElementById('ai-msg');

const wallCanvas = document.getElementById('wallpaper-canvas');
const wallPreviewEl = document.getElementById('wall-preview');
const wmodeBtns = [...document.querySelectorAll('[data-wmode]')];
const wmodeNote = document.getElementById('wmode-note');
const refsListEl = document.getElementById('refs-list');
const refsAddLabel = document.getElementById('refs-add');
const refsInput = document.getElementById('refs-input');
const bgGenerateBtn = document.getElementById('bg-generate');
const genbarEl = document.getElementById('genbar');
const pbarFill = document.getElementById('pbar-fill');
const genStageEl = document.getElementById('gen-stage');
const bgEditRow = document.getElementById('bg-edit-row');
const bgEditInput = document.getElementById('bg-edit-input');
const bgEditBtn = document.getElementById('bg-edit');
const bgMsgEl = document.getElementById('bg-msg');

// R8:prompt 外帶降級區塊
const exportPanel = document.getElementById('export-panel');
const copyPromptBtn = document.getElementById('copy-prompt');
const importBgInput = document.getElementById('import-bg-input');
const exportPromptText = document.getElementById('export-prompt-text');
const exportMsgEl = document.getElementById('export-msg');

const downloadBtn = document.getElementById('download-png');
const downloadNote = document.getElementById('download-note');

let grid9Rendered = false;

const palette = () => presetById(state.wallpaper.styleId).palette;
const persist = () => saveState(state);

// ---- 共用:訊息顯示與按鈕忙碌狀態 ----

function showMsg(el, text, kind = 'err') {
  el.textContent = text || '';
  el.hidden = !text;
  el.classList.toggle('is-ok', kind === 'ok');
}

function showApiError(el, err) {
  const { message, action, fallback } = api.describeError(err);
  showMsg(el, message);
  if (action === 'byo') {
    const link = document.createElement('button');
    link.type = 'button';
    link.className = 'msg-link';
    link.textContent = '開啟進階設定';
    link.addEventListener('click', openByoPanel);
    el.append(' ', link);
  }
  if (fallback === 'export') exportPanel.open = true; // R8:錯誤時自動展開降級區塊
  console.warn('[goal-grid]', err);
}

function setBusy(btn, busy, label) {
  if (busy) {
    btn.dataset.label = btn.textContent;
    if (label) btn.textContent = label;
    btn.disabled = true;
  } else {
    if (btn.dataset.label) btn.textContent = btn.dataset.label;
    btn.disabled = false;
  }
}

// ---- 步驟二:3×3 編輯格 ----

function renderStep2() {
  renderGrid3(grid3El, state, (idx, value) => {
    setCell(state, idx, value);
    persist();
    if (grid9Rendered) syncGrid9Mirrors(grid9El, state); // 9×9 鏡像即時跟上
  });
}

// ---- 步驟三:AI 補完 + 81 格檢視 ----

const cellsAsStrings = () => state.cells.map((c) => (c ? c.text : null));

function renderAiGrid(revealIdx = []) {
  renderAiGrid3(
    aiGridEl,
    state,
    palette(),
    {
      onEdit: (idx, value) => {
        setCell(state, idx, value, 'user'); // 改字後 source 變 user
        persist();
        if (grid9Rendered) syncGrid9Mirrors(grid9El, state);
      },
      onRetry: async (idx) => {
        // R7:先快照原值,runFill 拒絕執行或失敗時還原(否則 429/僅此一格時文字永久遺失)
        const prev = state.cells[idx];
        setCell(state, idx, ''); // 設 null 再 fillCore
        persist();
        renderAiGrid();
        const outcome = await runFill();
        if (outcome !== 'done' && prev) {
          setCell(state, idx, prev.text, prev.source);
          persist();
          renderAiGrid();
          renderStep2();
          if (grid9Rendered) syncGrid9Mirrors(grid9El, state);
          if (outcome === 'refused') {
            showMsg(aiMsgEl, '重抽沒有執行(清掉這格後 AI 就沒有依據了),已把原本的文字還原;想換寫法可直接改字。');
          }
        }
      },
    },
    revealIdx,
  );
}

// 回傳 'done' | 'refused' | 'failed'(R7:重抽呼叫端要據此決定是否還原快照)
async function runFill() {
  const before = cellsAsStrings();
  if (!before.some(Boolean)) {
    showMsg(aiMsgEl, '至少先填一格(建議中央核心目標),AI 才有依據。');
    return 'refused';
  }
  if (before.every(Boolean)) {
    showMsg(aiMsgEl, '九個格子都填滿了。想讓 AI 重寫某格,把游標移到那格按「重抽」。', 'ok');
    return 'refused';
  }
  showMsg(aiMsgEl, '');
  setBusy(aiFillBtn, true, 'AI 思考中…');
  try {
    const cells = await api.fillCore(before);
    const revealed = [];
    cells.forEach((text, i) => {
      if (!before[i]) {
        setCell(state, i, text, 'ai');
        revealed.push(i);
      }
    });
    persist();
    renderAiGrid(revealed); // 逐格淡入
    renderStep2();
    if (grid9Rendered) syncGrid9Mirrors(grid9El, state);
    return 'done';
  } catch (err) {
    showApiError(aiMsgEl, err);
    return 'failed';
  } finally {
    setBusy(aiFillBtn, false);
  }
}

async function runExpand() {
  if (state.cells.some((c) => !c)) {
    showMsg(aiMsgEl, '九宮格還有空格 —— 先按「AI 補滿空格」(或自己填完),再展開 81 格。');
    return;
  }
  showMsg(aiMsgEl, '');
  setBusy(aiExpandBtn, true, '展開中…');
  aiProgressEl.hidden = false;
  try {
    const coreGoal = state.cells[4].text;
    for (let s = 0; s < 8; s++) {
      aiProgressEl.textContent = `展開中 ${s + 1}/8`;
      const existing = (state.actions[s] || Array(8).fill(null)).map((a) => (a ? a.text : null));
      if (existing.every(Boolean)) continue; // 這個子目標已滿,不重抽
      const subGoal = state.cells[posOfSubIndex(s)].text;
      const actions = await api.expandSub(coreGoal, subGoal, existing);
      actions.forEach((text, j) => {
        if (!existing[j]) setAction(state, s, j, text, 'ai');
      });
      persist();
    }
    aiProgressEl.textContent = '81 格已展開';
    grid9Wrap.hidden = false;
    grid9Toggle.textContent = '收合 81 格';
    renderG9();
    renderModeSeg(); // 9×9 桌布版型解鎖
  } catch (err) {
    aiProgressEl.hidden = true;
    showApiError(aiMsgEl, err);
  } finally {
    setBusy(aiExpandBtn, false);
  }
}

aiFillBtn.addEventListener('click', runFill);
aiExpandBtn.addEventListener('click', runExpand);

function renderG9() {
  renderGrid9(grid9El, state, palette(), (sub, slot, value) => {
    setAction(state, sub, slot, value);
    persist();
  });
  grid9Rendered = true;
}

function refreshStep3() {
  renderAiGrid();
  if (!grid9Wrap.hidden) renderG9();
}

grid9Toggle.addEventListener('click', () => {
  const show = grid9Wrap.hidden;
  grid9Wrap.hidden = !show;
  grid9Toggle.textContent = show ? '收合 81 格' : '檢視完整 81 格';
  if (show) renderG9();
});

// ---- 步驟四:方向 / 格局 / 風格(寫回 state.wallpaper,預覽即時重繪)----

const styleListEl = document.getElementById('style-list');

function renderStylePicker() {
  styleListEl.textContent = '';
  for (const p of STYLE_PRESETS) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-card' + (p.id === state.wallpaper.styleId ? ' is-selected' : '');
    btn.setAttribute('aria-pressed', String(p.id === state.wallpaper.styleId));
    const name = document.createElement('span');
    name.className = 'style-name';
    name.textContent = p.name;
    const chips = document.createElement('span');
    chips.className = 'style-chips';
    for (const c of [p.palette.accent, ...p.palette.sub]) {
      const chip = document.createElement('i');
      chip.style.background = c;
      chips.appendChild(chip);
    }
    btn.append(name, chips);
    btn.addEventListener('click', () => {
      state.wallpaper.styleId = p.id;
      persist();
      renderStylePicker();
      rerenderWallpaper();
      renderAiGrid();
      if (grid9Rendered) renderG9(); // 區塊配色跟著風格換
    });
    styleListEl.appendChild(btn);
  }
}

const orientBtns = [...document.querySelectorAll('[data-orient]')];

function renderOrient() {
  for (const b of orientBtns) {
    const on = b.dataset.orient === state.wallpaper.orientation;
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-pressed', String(on));
  }
  wallPreviewEl.classList.toggle('is-landscape', state.wallpaper.orientation === 'landscape');
}

for (const b of orientBtns) {
  b.addEventListener('click', () => {
    state.wallpaper.orientation = b.dataset.orient;
    persist();
    renderOrient();
    rerenderWallpaper();
  });
}

// 9×9 版型:依 state.actions 是否已展開
const hasExpansion = () => state.actions.some((r) => Array.isArray(r) && r.some(Boolean));

function renderModeSeg() {
  const unlocked = hasExpansion();
  if (!unlocked && wallpaperMode === '9x9') wallpaperMode = '3x3';
  for (const b of wmodeBtns) {
    const on = b.dataset.wmode === wallpaperMode;
    b.classList.toggle('is-selected', on);
    b.setAttribute('aria-pressed', String(on));
    if (b.dataset.wmode === '9x9') b.disabled = !unlocked;
  }
  wmodeNote.hidden = unlocked;
}

for (const b of wmodeBtns) {
  b.addEventListener('click', () => {
    wallpaperMode = b.dataset.wmode;
    renderModeSeg();
    rerenderWallpaper();
  });
}

function rerenderWallpaper() {
  renderWallpaper(wallCanvas, {
    bgBitmap,
    cells: state.cells,
    actions: state.actions,
    styleId: state.wallpaper.styleId,
    orientation: state.wallpaper.orientation,
    mode: wallpaperMode,
  });
}

// ---- 步驟四:參考圖上傳(≤3 張,縮到長邊 1280,存 IndexedDB 'refs')----

async function loadRefs() {
  try {
    refRecords = await idbAll('refs');
  } catch {
    refRecords = [];
  }
  renderRefs();
}

function renderRefs() {
  refsListEl.textContent = '';
  for (const r of refRecords) {
    const item = document.createElement('div');
    item.className = 'ref-thumb';
    const img = document.createElement('img');
    img.src = URL.createObjectURL(r.blob);
    img.alt = (r.meta && r.meta.name) || '參考圖';
    img.addEventListener('load', () => URL.revokeObjectURL(img.src), { once: true });
    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'ref-del';
    del.textContent = '移除';
    del.addEventListener('click', async () => {
      await idbDelete('refs', r.id);
      loadRefs();
    });
    item.append(img, del);
    refsListEl.appendChild(item);
  }
  refsAddLabel.classList.toggle('is-disabled', refRecords.length >= 3);
  refsInput.disabled = refRecords.length >= 3;
}

refsInput.addEventListener('change', async () => {
  const files = [...refsInput.files].slice(0, Math.max(0, 3 - refRecords.length));
  refsInput.value = '';
  for (const file of files) {
    try {
      const blob = await resizeImageBlob(file, 1280); // 長邊 1280,控制 body 體積
      await idbPut('refs', { blob, meta: { name: file.name }, createdAt: new Date().toISOString() });
    } catch (err) {
      console.warn('[goal-grid] 參考圖處理失敗', err);
      showMsg(bgMsgEl, '這張圖讀不進來,請換一張(支援一般圖片格式)。');
    }
  }
  loadRefs();
});

// ---- 步驟四:AI 背景生成(進度條 + 階段文案輪播)----

const GEN_STAGES = ['AI 構圖中', 'AI 正在打草稿', '上色中', '收尾修飾中'];
let genTimer = null;
let genInFlight = false; // R7:同步防重入旗標(double-click 只觸發一次)

// startedAt 可回填(R6 reload 續傳時,經過時間從 job 建立時刻起算)
function startGenUi(startedAt = Date.now()) {
  if (genTimer) return; // R7:genTimer 防覆寫(否則第二次呼叫會讓第一個 interval 漏停)
  genbarEl.hidden = false;
  bgGenerateBtn.disabled = true;
  bgEditBtn.disabled = true;
  pbarFill.style.width = '2%';
  const tick = () => {
    const elapsed = Date.now() - startedAt;
    const idx = Math.floor(elapsed / 9000) % GEN_STAGES.length;
    const mm = String(Math.floor(elapsed / 60000));
    const ss = String(Math.floor((elapsed % 60000) / 1000)).padStart(2, '0');
    genStageEl.textContent = `${GEN_STAGES[idx]}…(已 ${mm}:${ss},一般約 1-3 分鐘)`;
    pbarFill.style.width = `${Math.min(96, (elapsed / 180000) * 100).toFixed(1)}%`;
  };
  tick();
  genTimer = setInterval(tick, 1000);
}

function stopGenUi() {
  clearInterval(genTimer);
  genTimer = null;
  genbarEl.hidden = true;
  bgGenerateBtn.disabled = false;
  bgEditBtn.disabled = false;
}

// 終局成功:把生成圖抓回存 IndexedDB(生成圖 7 天過期,不依賴 upstream URL)+ 重繪
async function applyWallpaperImages(images, editInstruction = null) {
  const url = images && images[0] && images[0].url;
  if (!url) throw new api.ApiError(0, { error: 'upstream_failed' });
  const imgRes = await fetch(url);
  if (!imgRes.ok) throw new api.ApiError(0, { error: 'upstream_failed' });
  const blob = await imgRes.blob();
  const rec = {
    blob,
    meta: {
      goal: state.cells[4] ? state.cells[4].text : '',
      styleId: state.wallpaper.styleId,
      orientation: state.wallpaper.orientation,
      editInstruction: editInstruction || null,
    },
    createdAt: new Date().toISOString(),
  };
  rec.id = await idbPut('wallpapers', rec);
  bgRecord = rec;
  bgBitmap = await createImageBitmap(blob);
  rerenderWallpaper();
  bgEditRow.hidden = false;
  bgEditInput.value = '';
  showMsg(bgMsgEl, '背景完成。不滿意可以輸入修改指示重生背景;改文字或換風格則即時重繪、不用重生。', 'ok');
}

// R6:恢復一個還沒終局的 job — 還原當時的版面設定、接續輪詢(預算扣掉已經過時間)
async function resumePendingJob(pending) {
  const elapsedMs = Math.max(0, Date.now() - Date.parse(pending.createdAt));
  if (pending.gridMode === '3x3' || pending.gridMode === '9x9') wallpaperMode = pending.gridMode;
  if (pending.orientation === 'portrait' || pending.orientation === 'landscape') {
    state.wallpaper.orientation = pending.orientation;
  }
  if (typeof pending.styleId === 'string' && pending.styleId) state.wallpaper.styleId = pending.styleId;
  persist();
  renderOrient();
  renderStylePicker();
  renderModeSeg();
  startGenUi(Date.now() - elapsedMs);
  const byoCfg = api.getByo();
  const images = await api.pollWallpaper(pending.jobId, {
    byo: !!(byoCfg && byoCfg.codexKey),
    elapsedMs,
  });
  api.clearPendingJob();
  await applyWallpaperImages(images);
}

// 終局(成功/失敗/逾時)清 pending;網路錯不是 job 的終局 → 留著供下次續傳(R6)
function settlePendingJob(err) {
  if (err instanceof api.ApiError && err.body.error === 'network') return;
  api.clearPendingJob();
}

// editInstruction 有值 = 修改模式:把上一張背景縮圖當參考圖帶上,修改句一併送出
// (BYO 直連時修改句由前端併入 prompt;走 Worker 時帶 editInstruction 欄位,Worker 忽略未知欄位)
async function generateBackground(editInstruction = null) {
  if (genInFlight) return; // R7:第一行同步防重入
  genInFlight = true;
  startGenUi();
  try {
    showMsg(bgMsgEl, '');

    // R6:已有未終局 job → 恢復輪詢,不重送(重送只會撞 Worker 的 409 in_flight)
    const pending = api.loadPendingJob();
    if (pending) {
      await resumePendingJob(pending);
      return;
    }

    const core = state.cells[4];
    if (!core) {
      showMsg(bgMsgEl, '先回步驟二寫下核心目標,AI 才知道要畫什麼。');
      return;
    }
    const subGoals = state.cells.filter((c, i) => i !== 4 && c).map((c) => c.text);
    const referenceImagesBase64 = [];
    try {
      if (editInstruction && bgRecord) {
        referenceImagesBase64.push(await blobToBase64(await resizeImageBlob(bgRecord.blob, 1280)));
      } else {
        for (const r of refRecords.slice(0, 3)) {
          referenceImagesBase64.push(await blobToBase64(r.blob));
        }
      }
    } catch (err) {
      console.warn('[goal-grid] 參考圖編碼失敗', err);
    }

    const req = {
      goal: core.text,
      subGoals,
      styleId: state.wallpaper.styleId,
      orientation: state.wallpaper.orientation,
    };
    if (referenceImagesBase64.length) req.referenceImagesBase64 = referenceImagesBase64;
    if (editInstruction) req.editInstruction = editInstruction;

    const sub = await api.submitWallpaper(req);
    let images;
    if (sub.mode === 'sync') {
      images = sub.images;
    } else {
      // R6:job 模式立即持久化,reload 後可續傳;失敗由外層 catch 的 settlePendingJob 收尾
      api.savePendingJob({
        jobId: sub.jobId,
        createdAt: new Date().toISOString(),
        orientation: state.wallpaper.orientation,
        styleId: state.wallpaper.styleId,
        gridMode: wallpaperMode,
      });
      images = await api.pollWallpaper(sub.jobId, { byo: sub.byo });
      api.clearPendingJob();
    }
    await applyWallpaperImages(images, editInstruction);
  } catch (err) {
    settlePendingJob(err);
    showApiError(bgMsgEl, err);
  } finally {
    genInFlight = false;
    stopGenUi();
  }
}

bgGenerateBtn.addEventListener('click', () => generateBackground());
bgEditBtn.addEventListener('click', () => {
  const instruction = bgEditInput.value.trim();
  if (!instruction) {
    showMsg(bgMsgEl, '先描述想怎麼改,例:「整體亮一點,天空加一點晚霞」。');
    return;
  }
  generateBackground(instruction);
});

// ---- 步驟四:R8 prompt 外帶降級方案(複製生圖 prompt / 匯入背景圖,零後端依賴)----

// 與 generateBackground 同一套輸入組 prompt;修改框有字就一併帶上(修改句)
function buildExportPrompt() {
  const core = state.cells[4];
  if (!core) {
    showMsg(exportMsgEl, '先回步驟二寫下核心目標,才組得出生圖 prompt。');
    return null;
  }
  return exportablePrompt({
    goal: core.text,
    subGoals: state.cells.filter((c, i) => i !== 4 && c).map((c) => c.text),
    styleId: state.wallpaper.styleId,
    orientation: state.wallpaper.orientation,
    editInstruction: bgEditInput.value.trim() || null,
  });
}

copyPromptBtn.addEventListener('click', async () => {
  const prompt = buildExportPrompt();
  if (!prompt) return;
  exportPromptText.value = prompt;
  try {
    await navigator.clipboard.writeText(prompt);
    exportPromptText.hidden = true;
    showMsg(exportMsgEl, '已複製。貼到 ChatGPT 或 Gemini 生成;想用參考圖,把圖一併附給它;生成後下載圖片,用「匯入背景圖」放回來。', 'ok');
  } catch (err) {
    // clipboard 權限被擋(或非安全環境):退而求其次,攤開全文讓使用者手動複製
    console.warn('[goal-grid] 剪貼簿寫入失敗', err);
    exportPromptText.hidden = false;
    exportPromptText.focus();
    exportPromptText.select();
    showMsg(exportMsgEl, '瀏覽器擋下了自動複製;已把 prompt 全文攤開在下方,請手動全選複製。');
  }
});

importBgInput.addEventListener('change', async () => {
  const file = importBgInput.files && importBgInput.files[0];
  importBgInput.value = '';
  if (!file) return;
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
    showMsg(exportMsgEl, '這個檔案格式不支援,請選 PNG、JPG 或 WebP 圖檔。');
    return;
  }
  try {
    // 既有縮放工具,長邊 2560:鋪得滿 portrait 2532 高,又控制 IndexedDB 體積
    const blob = await resizeImageBlob(file, 2560);
    const rec = {
      blob,
      meta: { source: 'manual', name: file.name },
      createdAt: new Date().toISOString(),
    };
    rec.id = await idbPut('wallpapers', rec);
    bgRecord = rec; // 後續「AI 修改背景」以這張為參考圖,行為與 AI 生成的一致
    bgBitmap = await createImageBitmap(blob);
    rerenderWallpaper();
    bgEditRow.hidden = false;
    showMsg(exportMsgEl, '背景已套用。改文字或換風格會即時重繪;想換背景,再匯一張即可。', 'ok');
  } catch (err) {
    console.warn('[goal-grid] 匯入背景圖失敗', err);
    showMsg(exportMsgEl, '這張圖讀不進來,請換一張(支援 PNG/JPG/WebP)。');
  }
});

// ---- 步驟五:下載 PNG ----

downloadBtn.addEventListener('click', async () => {
  rerenderWallpaper(); // 確保拿到最新狀態
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  try {
    const blob = await downloadCanvasPng(wallCanvas, `目標九宮格-${stamp}.png`);
    showMsg(downloadNote, `已開始下載(${Math.round(blob.size / 1024)} KB)。`, 'ok');
  } catch (err) {
    console.warn('[goal-grid] 下載失敗', err);
    showMsg(downloadNote, '下載沒有成功,請再試一次。');
  }
});

// ---- 步驟五:email 留資(誘因 = 30 天行動追蹤模板,成功當場給 gift 連結)----

initSignup(
  {
    form: document.getElementById('signup-form'),
    emailInput: document.getElementById('signup-email'),
    companyInput: document.getElementById('signup-company'),
    submitBtn: document.getElementById('signup-submit'),
    msgEl: document.getElementById('signup-msg'),
    giftEl: document.getElementById('signup-gift'),
    giftLink: document.getElementById('signup-gift-link'),
  },
  { onError: showApiError }, // 429/網路錯等沿用統一錯誤文案(含 BYO 引導)
);

// ---- BYO 設定面板(localStorage override,契約 C4)----

const byoPanel = document.getElementById('byo-panel');
const byoWorker = document.getElementById('byo-worker');
const byoGroq = document.getElementById('byo-groq');
const byoCodexUrl = document.getElementById('byo-codex-url');
const byoCodexKey = document.getElementById('byo-codex-key');
const byoSitekey = document.getElementById('byo-sitekey');
const byoMsg = document.getElementById('byo-msg');

function loadByoForm() {
  byoWorker.value = localStorage.getItem('goal-grid-worker-url') || '';
  const byo = api.getByo() || {};
  byoGroq.value = byo.groqKey || '';
  byoCodexUrl.value = byo.codexUrl || '';
  byoCodexKey.value = byo.codexKey || '';
  byoSitekey.value = localStorage.getItem('goal-grid-turnstile-sitekey') || '';
}

function openByoPanel() {
  byoPanel.open = true;
  byoPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

document.getElementById('byo-save').addEventListener('click', () => {
  const worker = byoWorker.value.trim();
  if (worker) localStorage.setItem('goal-grid-worker-url', worker);
  else localStorage.removeItem('goal-grid-worker-url');

  const byo = {
    codexUrl: byoCodexUrl.value.trim(),
    codexKey: byoCodexKey.value.trim(),
    groqKey: byoGroq.value.trim(),
  };
  if (byo.codexUrl || byo.codexKey || byo.groqKey) {
    localStorage.setItem('goal-grid-byo', JSON.stringify(byo));
  } else {
    localStorage.removeItem('goal-grid-byo');
  }

  const sitekey = byoSitekey.value.trim();
  if (sitekey) localStorage.setItem('goal-grid-turnstile-sitekey', sitekey);
  else localStorage.removeItem('goal-grid-turnstile-sitekey');

  byoMsg.textContent = '已儲存,立即生效。';
});

document.getElementById('byo-clear').addEventListener('click', () => {
  localStorage.removeItem('goal-grid-worker-url');
  localStorage.removeItem('goal-grid-byo');
  localStorage.removeItem('goal-grid-turnstile-sitekey');
  loadByoForm();
  byoMsg.textContent = '已清除,改回站方服務。';
});

// ---- wizard 導航(可回退;rail 只能跳到到過的步驟)----

function goToStep(n) {
  if (n < 1 || n > 5) return;
  step = n;
  maxStep = Math.max(maxStep, n);
  for (const sec of sections) {
    const on = Number(sec.dataset.step) === n;
    if (on) {
      sec.hidden = false;
      sec.classList.remove('step-enter');
      void sec.offsetWidth; // 重新觸發進場動畫
      sec.classList.add('step-enter');
    } else {
      sec.hidden = true;
    }
  }
  for (const el of railSteps) {
    const s = Number(el.dataset.go);
    el.classList.toggle('is-current', s === step);
    el.classList.toggle('is-done', s < step);
    el.disabled = s > maxStep;
  }
  if (n === 2) renderStep2(); // AI 補完後回頭看,格子要是最新值
  if (n === 3) refreshStep3();
  if (n === 4) {
    renderModeSeg();
    rerenderWallpaper();
  }
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

for (const b of document.querySelectorAll('[data-next]')) {
  b.addEventListener('click', () => goToStep(step + 1));
}
for (const b of document.querySelectorAll('[data-back]')) {
  b.addEventListener('click', () => goToStep(step - 1));
}
for (const el of railSteps) {
  el.addEventListener('click', () => {
    const s = Number(el.dataset.go);
    if (s <= maxStep) goToStep(s);
  });
}

// ---- 啟動 ----

renderStep2();
renderStylePicker();
renderOrient();
renderModeSeg();
loadByoForm();
loadRefs();
goToStep(1);

// 把上次生成的背景找回來(IndexedDB),離線 reload 也不丟
(async () => {
  try {
    const wps = await idbAll('wallpapers');
    if (wps.length) {
      bgRecord = wps[wps.length - 1];
      bgBitmap = await createImageBitmap(bgRecord.blob);
      bgEditRow.hidden = false;
      if (step === 4) rerenderWallpaper();
    }
  } catch (err) {
    console.warn('[goal-grid] 讀取背景歷史失敗', err);
  }
})();

// R6:頁面載入發現未終局的生成 job → 回到步驟四,自動恢復生成中 UI 與輪詢
(async () => {
  const pending = api.loadPendingJob();
  if (!pending || genInFlight) return;
  genInFlight = true;
  try {
    goToStep(4);
    showMsg(bgMsgEl, '偵測到上次離開時背景還在生成,已自動接續等待(不會重複扣額度)。', 'ok');
    await resumePendingJob(pending);
  } catch (err) {
    settlePendingJob(err);
    showApiError(bgMsgEl, err);
  } finally {
    genInFlight = false;
    stopGenUi();
  }
})();
