// 桌布合成(契約 C5):AI 背景(或 preset 漸層)+ canvas 文字疊加
// 純函式(版型幾何、CJK 斷行、fitText 二分字級)抽出供 node 測試;
// renderWallpaper 與圖片工具為瀏覽器端。
import { subIndexOf } from './grid.js';
import { presetById } from './styles-presets.js';

export const CANVAS = { portrait: { w: 1170, h: 2532 }, landscape: { w: 1920, h: 1080 } };

// 81 全圖內部比例:9 格 + 6 個格間距(0.12 cell)+ 2 個區塊間距(0.45 cell)= 總寬
const G81_CELL_GAP = 0.12;
const G81_BLOCK_GAP = 0.45;

export function hexA(hex, alpha) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

// 版型幾何(純函式):回 {canvas, grid3, grid81|null}
export function layoutWallpaper(orientation, mode) {
  const { w: W, h: H } = CANVAS[orientation];
  // 3×3:格寬 = min(0.86W, 0.52H)/3,gap = 格寬*0.06,圓角 = 格寬*0.08
  const cell = Math.min(0.86 * W, 0.52 * H) / 3;
  const gap = cell * 0.06;
  const radius = cell * 0.08;
  const size = 3 * cell + 2 * gap;
  let cx;
  let cy;
  if (mode === '9x9') {
    // 9×9:portrait 3×3 中心 0.30H;landscape 3×3 置左 0.27W
    if (orientation === 'portrait') {
      cx = 0.5 * W;
      cy = 0.3 * H;
    } else {
      cx = 0.27 * W;
      cy = 0.5 * H;
    }
  } else {
    // 3×3:portrait 置中 (0.5W, 0.44H);landscape 置中 (0.5W, 0.5H)
    cx = 0.5 * W;
    cy = orientation === 'portrait' ? 0.44 * H : 0.5 * H;
  }
  const grid3 = { x: cx - size / 2, y: cy - size / 2, size, cell, gap, radius };

  let grid81 = null;
  if (mode === '9x9') {
    // portrait:81 全圖寬 0.92W,中心 (0.5W, 0.74H);landscape:寬 0.5W,中心 (0.72W, 0.5H)
    const spec =
      orientation === 'portrait'
        ? { cx: 0.5 * W, cy: 0.74 * H, w: 0.92 * W }
        : { cx: 0.72 * W, cy: 0.5 * H, w: 0.5 * W };
    const cell81 = spec.w / (9 + 6 * G81_CELL_GAP + 2 * G81_BLOCK_GAP);
    grid81 = {
      x: spec.cx - spec.w / 2,
      y: spec.cy - spec.w / 2,
      size: spec.w,
      cell: cell81,
      cellGap: cell81 * G81_CELL_GAP,
      blockGap: cell81 * G81_BLOCK_GAP,
      radius: cell81 * 0.1,
    };
  }
  return { canvas: { w: W, h: H }, grid3, grid81 };
}

// 3×3 內格矩形(idx 0-8)
export function grid3CellRect(g, idx) {
  const col = idx % 3;
  const row = Math.floor(idx / 3);
  return {
    x: g.x + col * (g.cell + g.gap),
    y: g.y + row * (g.cell + g.gap),
    w: g.cell,
    h: g.cell,
  };
}

// 81 全圖內格矩形:block 0-8(3×3 區塊)、cellIdx 0-8(區塊內位置)
export function grid81CellRect(g, block, cellIdx) {
  const bCol = block % 3;
  const bRow = Math.floor(block / 3);
  const cCol = cellIdx % 3;
  const cRow = Math.floor(cellIdx / 3);
  const blockSpan = 3 * g.cell + 2 * g.cellGap;
  return {
    x: g.x + bCol * (blockSpan + g.blockGap) + cCol * (g.cell + g.cellGap),
    y: g.y + bRow * (blockSpan + g.blockGap) + cRow * (g.cell + g.cellGap),
    w: g.cell,
    h: g.cell,
  };
}

// CJK 逐字斷行(也尊重明確換行);measure(str) → 寬度
export function wrapCJK(text, maxWidth, measure) {
  const lines = [];
  let line = '';
  const push = (unit) => {
    const next = line + unit;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = unit;
    } else {
      line = next;
    }
  };
  // 英數連續段(如 160km)視為不可拆單位;其餘逐字。段本身超寬才退回逐字。
  const units = String(text).match(/[A-Za-z0-9]+|[\s\S]/gu) || [];
  for (const unit of units) {
    if (unit === '\n') {
      lines.push(line);
      line = '';
      continue;
    }
    if (unit.length > 1 && measure(unit) > maxWidth) {
      for (const ch of unit) push(ch);
    } else {
      push(unit);
    }
  }
  lines.push(line);
  return lines.length ? lines : [''];
}

// 二分搜尋最大可容納字級(min 14px);measureFactory(fontSize) → measure(str)
export function fitText(measureFactory, text, opts) {
  const { maxWidth, maxHeight, maxFontSize, minFontSize = 14, lineHeight = 1.32 } = opts;
  const tryFit = (fs) => {
    const measure = measureFactory(fs);
    const lines = wrapCJK(text, maxWidth, measure);
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
    if (lines) {
      best = { fontSize: mid, lines };
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (!best) {
    best = { fontSize: minFontSize, lines: wrapCJK(text, maxWidth, measureFactory(minFontSize)) };
  }
  return best;
}

// 背景 cover 縮放:回來源裁切區 {sx, sy, sw, sh}
export function coverRect(srcW, srcH, dstW, dstH) {
  const scale = Math.max(dstW / srcW, dstH / srcH);
  const sw = dstW / scale;
  const sh = dstH / scale;
  return { sx: (srcW - sw) / 2, sy: (srcH - sh) / 2, sw, sh };
}

// ---- 以下為瀏覽器端繪製 ----

const FONT_FAMILY = "'Noto Sans TC', 'PingFang TC', 'Microsoft JhengHei', sans-serif";
const CELL_BG = 'rgba(12, 16, 24, 0.58)'; // 格底
const MASK = 'rgba(8, 10, 16, 0.30)'; // 全幅遮罩
const FOOTER_TEXT = '目標九宮格 · yazelin.github.io/ai-goal-grid-course';

const cellText = (c) => (typeof c === 'string' ? c : (c && c.text) || '');

function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawCellText(ctx, text, rect, { color, weight, maxFont, pad, minFont = 14 }) {
  if (!text) return;
  const maxWidth = rect.w - pad * 2;
  const maxHeight = rect.h - pad * 2;
  const lineHeight = 1.32;
  const factory = (fs) => {
    ctx.font = `${weight} ${fs}px ${FONT_FAMILY}`;
    return (s) => ctx.measureText(s).width;
  };
  const { fontSize, lines } = fitText(factory, text, {
    maxWidth,
    maxHeight,
    maxFontSize: maxFont,
    minFontSize: minFont,
    lineHeight,
  });
  ctx.save();
  ctx.font = `${weight} ${fontSize}px ${FONT_FAMILY}`;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.4)';
  ctx.shadowBlur = fontSize * 0.18;
  const total = lines.length * fontSize * lineHeight;
  let y = rect.y + rect.h / 2 - total / 2 + (fontSize * lineHeight) / 2;
  for (const line of lines) {
    ctx.fillText(line, rect.x + rect.w / 2, y);
    y += fontSize * lineHeight;
  }
  ctx.restore();
}

// 單一格:格底 + 邊框/左邊條 + 文字
function drawCell(ctx, rect, radius, spec) {
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
  ctx.fillStyle = spec.fill;
  ctx.fill();
  if (spec.border) {
    ctx.strokeStyle = spec.border;
    ctx.lineWidth = spec.borderWidth || 1;
    ctx.stroke();
  }
  if (spec.leftBar) {
    ctx.save();
    roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.clip();
    ctx.fillStyle = spec.leftBar;
    ctx.fillRect(rect.x, rect.y, spec.leftBarWidth || 4, rect.h);
    ctx.restore();
  }
  drawCellText(ctx, spec.text, rect, spec);
}

// 中央 3×3(cells:9 × (null|{text}|string))
function drawGrid3(ctx, g, cells, palette) {
  for (let i = 0; i < 9; i++) {
    const rect = grid3CellRect(g, i);
    if (i === 4) {
      // 中央格:palette.accent @0.85,邊框 3px,白字
      drawCell(ctx, rect, g.radius, {
        fill: hexA(palette.accent, 0.85),
        border: palette.accent,
        borderWidth: 3,
        text: cellText(cells[i]),
        color: '#ffffff',
        weight: 700,
        maxFont: g.cell * 0.18,
        pad: g.cell * 0.11,
      });
    } else {
      // 子目標格 i:左邊框 4px palette.sub[i]
      drawCell(ctx, rect, g.radius, {
        fill: CELL_BG,
        border: 'rgba(233, 230, 218, 0.12)',
        borderWidth: 1,
        leftBar: palette.sub[subIndexOf(i)],
        leftBarWidth: 4,
        text: cellText(cells[i]),
        color: '#f1eee4',
        weight: 500,
        maxFont: g.cell * 0.15,
        pad: g.cell * 0.11,
      });
    }
  }
}

// 81 全圖:中央區塊 = 3×3 鏡像;外圍區塊中心格同色呼應對應子目標
function drawGrid81(ctx, g, cells, actions, palette) {
  for (let b = 0; b < 9; b++) {
    for (let j = 0; j < 9; j++) {
      const rect = grid81CellRect(g, b, j);
      const pad = g.cell * 0.08;
      if (b === 4) {
        if (j === 4) {
          drawCell(ctx, rect, g.radius, {
            fill: hexA(palette.accent, 0.85),
            border: palette.accent,
            borderWidth: 2,
            text: cellText(cells[4]),
            color: '#ffffff',
            weight: 700,
            maxFont: g.cell * 0.28,
            pad,
          });
        } else {
          drawCell(ctx, rect, g.radius, {
            fill: CELL_BG,
            border: 'rgba(233, 230, 218, 0.10)',
            borderWidth: 1,
            leftBar: palette.sub[subIndexOf(j)],
            leftBarWidth: 3,
            text: cellText(cells[j]),
            color: '#f1eee4',
            weight: 600,
            maxFont: g.cell * 0.24,
            pad,
          });
        }
        continue;
      }
      const s = subIndexOf(b);
      const subColor = palette.sub[s];
      if (j === 4) {
        // 外圍區塊中心格 = 子目標,同色呼應
        const subPos = s < 4 ? s : s + 1;
        drawCell(ctx, rect, g.radius, {
          fill: hexA(subColor, 0.32),
          border: hexA(subColor, 0.9),
          borderWidth: 2,
          text: cellText(cells[subPos]),
          color: '#ffffff',
          weight: 700,
          maxFont: g.cell * 0.26,
          pad,
        });
      } else {
        const row = actions && actions[s];
        drawCell(ctx, rect, g.radius, {
          fill: CELL_BG,
          border: 'rgba(233, 230, 218, 0.08)',
          borderWidth: 1,
          text: cellText(row && row[subIndexOf(j)]),
          color: '#e6e2d6',
          weight: 400,
          maxFont: g.cell * 0.22,
          pad,
        });
      }
    }
  }
}

// 無 AI 背景時:以 preset palette 畫 linearGradient 預設背景
function drawDefaultBackground(ctx, W, H, palette) {
  ctx.fillStyle = '#0a0f18';
  ctx.fillRect(0, 0, W, H);
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, hexA(palette.sub[0], 0.5));
  grad.addColorStop(0.45, hexA(palette.accent, 0.26));
  grad.addColorStop(1, hexA(palette.sub[4], 0.46));
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);
  // 角落柔光,讓漸層不死板
  const glow = ctx.createRadialGradient(W * 0.85, H * 0.1, 0, W * 0.85, H * 0.1, Math.max(W, H) * 0.7);
  glow.addColorStop(0, hexA(palette.sub[2], 0.30));
  glow.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);
}

function drawFooter(ctx, W, H) {
  const fs = Math.max(20, Math.round(Math.min(W, H) * 0.019));
  ctx.save();
  ctx.globalAlpha = 0.35; // footer alpha 0.35
  ctx.fillStyle = '#e9e6da';
  ctx.font = `500 ${fs}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(FOOTER_TEXT, W / 2, H - fs * 1.2);
  ctx.restore();
}

// 主入口:把九宮格畫到 canvas 上
// opts:{bgBitmap|null, cells, actions, styleId, orientation:'portrait'|'landscape', mode:'3x3'|'9x9'}
export function renderWallpaper(canvas, opts) {
  const { bgBitmap = null, cells, actions, styleId, orientation, mode = '3x3' } = opts;
  const layout = layoutWallpaper(orientation, mode);
  const { w: W, h: H } = layout.canvas;
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const palette = presetById(styleId).palette;

  // 背景:cover 鋪滿或 preset 漸層
  if (bgBitmap) {
    const { sx, sy, sw, sh } = coverRect(bgBitmap.width, bgBitmap.height, W, H);
    ctx.drawImage(bgBitmap, sx, sy, sw, sh, 0, 0, W, H);
  } else {
    drawDefaultBackground(ctx, W, H, palette);
  }
  // 全幅遮罩(保字)
  ctx.fillStyle = MASK;
  ctx.fillRect(0, 0, W, H);

  drawGrid3(ctx, layout.grid3, cells, palette);
  if (mode === '9x9' && layout.grid81) {
    drawGrid81(ctx, layout.grid81, cells, actions, palette);
  }
  drawFooter(ctx, W, H);
  return layout;
}

// ---- 圖片工具(瀏覽器端)----

export function canvasToPngBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('toBlob 失敗'));
    }, 'image/png');
  });
}

// 下載 canvas 為 PNG;回傳 Blob 供驗證
export async function downloadCanvasPng(canvas, filename) {
  const blob = await canvasToPngBlob(canvas);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return blob;
}

// 縮圖:長邊縮到 maxEdge,輸出 JPEG blob(參考圖上傳/修改背景用)
export async function resizeImageBlob(blob, maxEdge = 1280, quality = 0.85) {
  const bitmap = await createImageBitmap(blob);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  c.getContext('2d').drawImage(bitmap, 0, 0, w, h);
  bitmap.close();
  return new Promise((resolve, reject) => {
    c.toBlob((out) => {
      if (out) resolve(out);
      else reject(new Error('縮圖失敗'));
    }, 'image/jpeg', quality);
  });
}

// Blob → base64(去掉 data: 前綴,符合 upstream reference_images_base64 約定)
export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}
