// R8 prompt 外帶降級方案 — 前端限定 helper(Worker 端沒有對應檔)
// imagePrompt 模板與 Worker 端逐字鎖定(test/prompts.test.mjs),這裡只在外面包:
// 既有 imagePrompt + 修改句(句式與 api.js BYO 直連完全一致)+ 一行長寬比提示。
// 使用者把這份 prompt 貼到 ChatGPT / Gemini 自己生圖,再用「匯入背景圖」帶回來 —
// 零後端依賴,Worker 全掛也能走完全程。
import { imagePrompt } from './prompts.js';
import { presetById } from './styles-presets.js';

export const ASPECT_LINES = {
  portrait: 'Aspect ratio 2:3 vertical.',
  landscape: 'Aspect ratio 3:2 horizontal.',
};

// {goal, subGoals, styleId, orientation, editInstruction?} → 可外帶的完整生圖 prompt
export function exportablePrompt({ goal, subGoals = [], styleId, orientation, editInstruction = null }) {
  const o = orientation === 'landscape' ? 'landscape' : 'portrait';
  let prompt = imagePrompt(goal, subGoals, presetById(styleId).words, o);
  const edit = typeof editInstruction === 'string' ? editInstruction.trim() : '';
  if (edit) {
    prompt += `\nRevision request from the user (apply it to the previous design): ${edit}`;
  }
  prompt += `\n${ASPECT_LINES[o]}`;
  return prompt;
}
