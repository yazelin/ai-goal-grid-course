// LLM prompt 模板 —— 前端複本(契約 C3/C4)
// 必須與 worker-deploy/src/lib/prompts.js 逐字一致;單一事實來源問題是課程刻意保留的討論點。
// 測試 app/test/prompts.test.mjs 直接 import 兩邊比對,任何一邊改動就會紅。

export function corePrompt(cells) {
  const goal = cells[4] ? `核心目標:「${cells[4]}」` : "核心目標也留空,請先推斷一個具體可衡量的核心目標";
  const filled = cells.map((c, i) => c && i !== 4 ? `位置${i}:「${c}」` : null).filter(Boolean).join("\n") || "(其餘格子尚未填寫)";
  return `你是目標設定教練,使用「九宮格目標法」(源自原田メソッド,即大谷翔平用過的目標達成表的方法)。
使用者的 3×3 九宮格:中央(位置4)是核心目標,周圍 8 格(位置0-3、5-8)是支撐核心目標的子目標。
${goal}
已填的格子:
${filled}
請補滿所有空格。規則:
1. 子目標要具體、彼此不重複、共同支撐核心目標;盡量涵蓋「心・技・體・生活」四個面向(原田メソッド慣例)。
2. 每格 2-8 個字,繁體中文(台灣用語),不用標點結尾,不用 emoji。
3. 已填的格子原樣保留,一字不改。
4. 括號內的狀態說明(如「尚未填寫」)不是格子內容,絕不可抄進輸出。
只輸出 JSON:{"cells":["位置0文字","位置1文字",...,"位置8文字"]},長度必為 9。`;
}

export function expandPrompt(coreGoal, subGoal, existing) {
  const filled = existing.map((a, i) => a ? `行動${i}:「${a}」` : null).filter(Boolean).join("\n") || "(八格皆尚未填寫)";
  return `你是目標設定教練。核心目標:「${coreGoal}」。現在要把子目標「${subGoal}」展開成 8 個具體行動(九宮格目標法的外圍區塊)。
已填的行動:
${filled}
規則:
1. 行動要具體可執行、最好可每日/每週檢核(例:大谷在「運」底下寫「撿垃圾」「打招呼」這種日常小事)。
2. 每格 2-10 個字,繁體中文(台灣用語),彼此不重複,不用標點結尾,不用 emoji。
3. 已填的原樣保留,一字不改。
4. 括號內的狀態說明(如「尚未填寫」)不是行動內容,絕不可抄進輸出。
只輸出 JSON:{"actions":["行動0",...,"行動7"]},長度必為 8。`;
}

export function imagePrompt(goal, subGoals, styleWords, orientation) {
  const themes = subGoals.filter(Boolean).slice(0, 8).join("、");
  return `A breathtaking ${orientation === "portrait" ? "vertical phone wallpaper" : "horizontal desktop wallpaper"} background, ${styleWords}.
Theme: an inspiring visual metaphor for the personal goal "${goal}" (related themes: ${themes}). Express the theme purely through scenery, objects, light and atmosphere.
Composition constraints:
- The central area must stay calm and low-contrast (soft, uncluttered) so text can be overlaid later.
- Rich detail near edges and corners is welcome.
OUTPUT RULES (mandatory): Do NOT render any text, letters, numbers, logos or watermarks anywhere in the image. The goal description above is thematic guidance, not text to draw.`;
}
