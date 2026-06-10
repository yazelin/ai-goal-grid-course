// 九宮格渲染與對位(Task 2.2)
// 3×3:位置 0-8,中央 4 = 核心目標;子目標索引 = 略過中央後的 0-7。
// 9×9:外圈 8 區塊對應 8 個子目標,區塊中心 = 子目標唯讀鏡像,
//      其餘 8 格 = 行動格(寫回 state.actions)。

// 3×3 位置(略過中央)→ 子目標索引 0-7;區塊內位置 → 行動索引同此映射
export function subIndexOf(pos) {
  if (!Number.isInteger(pos) || pos < 0 || pos > 8 || pos === 4) {
    throw new RangeError(`非子目標位置:${pos}`);
  }
  return pos < 4 ? pos : pos - 1;
}

// 子目標索引 0-7 → 3×3 位置
export function posOfSubIndex(sub) {
  if (!Number.isInteger(sub) || sub < 0 || sub > 7) {
    throw new RangeError(`子目標索引超界:${sub}`);
  }
  return sub < 4 ? sub : sub + 1;
}

// 3×3 編輯格:每格一個 textarea,dataset.idx 對位讀回
export function renderGrid3(container, state, onCellInput) {
  container.textContent = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = i === 4 ? 'cell cell-core' : 'cell';
    if (i === 4) {
      const tag = document.createElement('span');
      tag.className = 'cell-tag';
      tag.textContent = '核心目標';
      cell.appendChild(tag);
    }
    const ta = document.createElement('textarea');
    ta.dataset.idx = String(i);
    ta.name = `cell-${i}`;
    ta.rows = 2;
    ta.placeholder = '留給 AI';
    ta.setAttribute('aria-label', i === 4 ? '核心目標' : `子目標 ${subIndexOf(i) + 1}`);
    ta.value = state.cells[i] ? state.cells[i].text : '';
    ta.addEventListener('input', () => onCellInput(i, ta.value));
    cell.appendChild(ta);
    container.appendChild(cell);
  }
}

// 3×3 唯讀預覽(步驟三現況一覽,配色取目前風格 palette)
export function renderPreview3(container, state, palette) {
  container.textContent = '';
  for (let i = 0; i < 9; i++) {
    const cell = document.createElement('div');
    cell.className = i === 4 ? 'pcell pcell-core' : 'pcell';
    const filled = state.cells[i];
    cell.textContent = filled ? filled.text : '留給 AI';
    if (!filled) cell.classList.add('is-empty');
    if (i !== 4) cell.style.setProperty('--cell-c', palette.sub[subIndexOf(i)]);
    container.appendChild(cell);
  }
}

function setMirrorText(el, cell) {
  el.textContent = cell ? cell.text : '留給 AI';
  el.classList.toggle('is-empty', !cell);
}

// 9×9 檢視:中央區塊 = 3×3 唯讀鏡像;外圈 8 區塊 = 子目標鏡像 + 8 行動格
export function renderGrid9(container, state, palette, onActionInput) {
  container.textContent = '';
  for (let b = 0; b < 9; b++) {
    const block = document.createElement('div');
    block.className = b === 4 ? 'block block-core' : 'block';
    if (b !== 4) block.style.setProperty('--block-c', palette.sub[subIndexOf(b)]);
    for (let j = 0; j < 9; j++) {
      if (b === 4) {
        // 中央區塊:整張 3×3 的唯讀鏡像
        const m = document.createElement('div');
        m.className = j === 4 ? 'mcell mcell-core' : 'mcell';
        m.dataset.mirror = String(j);
        if (j !== 4) m.style.setProperty('--cell-c', palette.sub[subIndexOf(j)]);
        setMirrorText(m, state.cells[j]);
        block.appendChild(m);
      } else if (j === 4) {
        // 外圈區塊中心:對應子目標的唯讀鏡像
        const s = subIndexOf(b);
        const m = document.createElement('div');
        m.className = 'mcell mcell-sub';
        m.dataset.mirror = String(posOfSubIndex(s));
        setMirrorText(m, state.cells[posOfSubIndex(s)]);
        block.appendChild(m);
      } else {
        // 行動格:可編輯,寫回 state.actions[s][slot]
        const s = subIndexOf(b);
        const slot = subIndexOf(j);
        const ta = document.createElement('textarea');
        ta.className = 'acell';
        ta.dataset.sub = String(s);
        ta.dataset.slot = String(slot);
        ta.name = `action-${s}-${slot}`;
        ta.rows = 2;
        ta.placeholder = '留給 AI';
        ta.setAttribute('aria-label', `子目標 ${s + 1} 的行動 ${slot + 1}`);
        const row = state.actions[s];
        ta.value = row && row[slot] ? row[slot].text : '';
        ta.addEventListener('input', () => onActionInput(s, slot, ta.value));
        block.appendChild(ta);
      }
    }
    container.appendChild(block);
  }
}

// 子目標改動時,讓 9×9 的鏡像格即時跟上(不重繪整張)
export function syncGrid9Mirrors(container, state) {
  for (const el of container.querySelectorAll('[data-mirror]')) {
    setMirrorText(el, state.cells[Number(el.dataset.mirror)]);
  }
}

// 步驟三互動格(Task 2.3):可改字(改後 source 變 user)、
// AI 來源格標記淡金邊 + AI 徽章、單格重抽(設 null 再 fillCore)。
// revealIdx:這一輪剛被 AI 補上的位置,逐格淡入。
export function renderAiGrid3(container, state, palette, { onEdit, onRetry }, revealIdx = []) {
  container.textContent = '';
  for (let i = 0; i < 9; i++) {
    const filled = state.cells[i];
    const isAi = !!(filled && filled.source === 'ai');
    const cell = document.createElement('div');
    cell.className = 'cell' + (i === 4 ? ' cell-core' : '') + (isAi ? ' is-ai' : '');
    if (i !== 4) cell.style.setProperty('--cell-c', palette.sub[subIndexOf(i)]);
    if (i === 4) {
      const tag = document.createElement('span');
      tag.className = 'cell-tag';
      tag.textContent = '核心目標';
      cell.appendChild(tag);
    }
    const badge = document.createElement('span');
    badge.className = 'ai-badge';
    badge.textContent = 'AI';
    badge.hidden = !isAi;
    cell.appendChild(badge);

    const redo = document.createElement('button');
    redo.type = 'button';
    redo.className = 'ai-redo';
    redo.textContent = '重抽';
    redo.title = '清空這格,重新交給 AI';
    redo.hidden = !filled;
    redo.addEventListener('click', () => onRetry(i));
    cell.appendChild(redo);

    const ta = document.createElement('textarea');
    ta.dataset.idx = String(i);
    ta.name = `ai-cell-${i}`;
    ta.rows = 2;
    ta.placeholder = '留給 AI';
    ta.setAttribute('aria-label', i === 4 ? '核心目標' : `子目標 ${subIndexOf(i) + 1}`);
    ta.value = filled ? filled.text : '';
    ta.addEventListener('input', () => {
      onEdit(i, ta.value); // 改字後 source 變 user
      badge.hidden = true;
      cell.classList.remove('is-ai');
      redo.hidden = !ta.value.trim();
    });
    cell.appendChild(ta);

    const at = revealIdx.indexOf(i);
    if (at >= 0) {
      cell.classList.add('ai-pop');
      cell.style.animationDelay = `${at * 90}ms`;
    }
    container.appendChild(cell);
  }
}
