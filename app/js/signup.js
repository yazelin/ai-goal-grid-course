// 步驟五:email 留資(Task 2.5)
// 漏斗示範重點:免費價值先給(PNG 不設牆),留資換加值(30 天行動追蹤模板),
// 註冊成功當場顯示 gift 連結 —— 承諾即時兌現,不依賴寄信。
// honeypot:表單藏一個 name=company 的欄位(CSS 移出視野),真人不會填;
// 有值就照常送出,Worker 端假裝成功但不寫入。

import * as api from './api.js';

// 純函式:把 /signup 的成功回應轉成顯示內容;非成功 body 回全空(錯誤走 describeError)
export function describeSignupResult(body) {
  if (!body || typeof body !== 'object' || body.ok !== true) {
    return { already: false, gift: '', message: '' };
  }
  const already = body.already === true;
  return {
    already,
    gift: typeof body.gift === 'string' ? body.gift : '',
    message: already
      ? '你已經在名單上了 —— 模板連結照樣再給你一次:'
      : '完成,Email 已登記。這是你的 30 天行動追蹤模板:',
  };
}

// DOM 接線:把步驟五的表單接上 api.signup()
// els:{form, emailInput, companyInput, submitBtn, msgEl, giftEl, giftLink}
// hooks:{onError(el, err)} —— 沿用 main.js 的 showApiError(含 BYO 引導)
export function initSignup(els, hooks = {}, deps = {}) {
  const { form, emailInput, companyInput, submitBtn, msgEl, giftEl, giftLink } = els;

  const showMsg = (text, kind = 'err') => {
    msgEl.textContent = text || '';
    msgEl.hidden = !text;
    msgEl.classList.toggle('is-ok', kind === 'ok');
  };

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = emailInput.value.trim();
    if (!email) {
      showMsg('先填上 Email,模板馬上給你。');
      emailInput.focus();
      return;
    }
    showMsg('');
    giftEl.hidden = true;
    const label = submitBtn.textContent;
    submitBtn.textContent = '送出中…';
    submitBtn.disabled = true;
    try {
      const body = await api.signup(email, '', companyInput.value.trim(), deps);
      const r = describeSignupResult(body);
      showMsg(r.message, 'ok');
      if (r.gift) {
        giftLink.href = r.gift;
        giftEl.hidden = false;
      }
      form.hidden = true; // 已兌現,收起表單避免重複送出
    } catch (err) {
      if (hooks.onError) hooks.onError(msgEl, err);
      else showMsg(api.describeError(err).message);
    } finally {
      submitBtn.textContent = label;
      submitBtn.disabled = false;
    }
  });
}
