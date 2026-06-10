// API client(契約 C1/C4 + 修訂 R5/R6)
// 部署期常數集中在 config.js;localStorage 可 override:
//   'goal-grid-worker-url'          → 自部署 Worker base URL
//   'goal-grid-byo'                 → {codexUrl, codexKey, groqKey}:有 groqKey 時 /fill 直連 Groq,
//                                     有 codexKey 時 /image 直連 codex-image-service
//                                     (codexUrl 留空用 DEFAULT_CODEX_URL,不退回 Worker)
//   'goal-grid-turnstile-sitekey'   → override config.TURNSTILE_SITEKEY;兩者皆空不送 token
//   'goal-grid-pending-job'         → R6:未終局的生成 job,reload 後續傳
import { corePrompt, expandPrompt, imagePrompt } from './prompts.js';
import { presetById } from './styles-presets.js';
import { TURNSTILE_SITEKEY, DEFAULT_WORKER_URL, DEFAULT_CODEX_URL } from './config.js';

export { TURNSTILE_SITEKEY, DEFAULT_WORKER_URL, DEFAULT_CODEX_URL };
export const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-120b';
export const POLL_MAX_MS = 720000; // 輪詢總時限 720s(R2:Worker 660s 會逾時退款,前端多留緩衝)

const WORKER_URL_KEY = 'goal-grid-worker-url';
const BYO_KEY = 'goal-grid-byo';
const SITEKEY_KEY = 'goal-grid-turnstile-sitekey';
export const PENDING_JOB_KEY = 'goal-grid-pending-job';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.error) || `http_${status}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body || {};
  }
}

const safeStorage = () => {
  try {
    return globalThis.localStorage;
  } catch {
    return null;
  }
};

export function workerBase(storage = safeStorage()) {
  const v = storage && storage.getItem(WORKER_URL_KEY);
  const t = typeof v === 'string' ? v.trim().replace(/\/+$/, '') : '';
  return t || DEFAULT_WORKER_URL;
}

export function getByo(storage = safeStorage()) {
  let raw;
  try {
    raw = JSON.parse((storage && storage.getItem(BYO_KEY)) || 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  const pick = (k, trimSlash = false) => {
    let v = typeof raw[k] === 'string' ? raw[k].trim() : '';
    if (trimSlash) v = v.replace(/\/+$/, '');
    return v;
  };
  const byo = { codexUrl: pick('codexUrl', true), codexKey: pick('codexKey'), groqKey: pick('groqKey') };
  if (!byo.codexUrl && !byo.codexKey && !byo.groqKey) return null;
  // R5:只填 key 即可直連 codex-image-service(URL 留空用預設),不再靜默退回 Worker
  if (byo.codexKey && !byo.codexUrl) byo.codexUrl = DEFAULT_CODEX_URL;
  return byo;
}

// ---- pending job 持久化(R6)----
// 形狀:{jobId, createdAt(ISO), orientation, styleId, gridMode}

export function loadPendingJob(storage = safeStorage()) {
  let raw;
  try {
    raw = JSON.parse((storage && storage.getItem(PENDING_JOB_KEY)) || 'null');
  } catch {
    return null;
  }
  if (!raw || typeof raw !== 'object') return null;
  if (typeof raw.jobId !== 'string' || !raw.jobId) return null;
  if (Number.isNaN(Date.parse(raw.createdAt))) return null;
  return raw;
}

export function savePendingJob(job, storage = safeStorage()) {
  try {
    if (storage) storage.setItem(PENDING_JOB_KEY, JSON.stringify(job));
  } catch { /* quota 滿等:寧可丟續傳能力也不擋生成 */ }
}

export function clearPendingJob(storage = safeStorage()) {
  try {
    if (storage) storage.removeItem(PENDING_JOB_KEY);
  } catch { /* 同上 */ }
}

// 防禦性解析:先 JSON.parse,失敗再抓 ```json fenced block(與 Worker groq.js 同套路)
export function parseJSONLoose(text) {
  const s = String(text ?? '');
  try {
    return JSON.parse(s);
  } catch { /* 繼續 */ }
  const m = s.match(/```json\s*([\s\S]*?)```/i) || s.match(/```\s*([\s\S]*?)```/);
  if (m) {
    try {
      return JSON.parse(m[1]);
    } catch { /* 落空 */ }
  }
  return null;
}

// ---- Turnstile(sitekey 未設 → 回 null,不送 token;Worker 端已相容)----
// R5:sitekey = localStorage override || config.TURNSTILE_SITEKEY

export function activeSitekey(storage = safeStorage()) {
  return ((storage && storage.getItem(SITEKEY_KEY)) || '').trim() || TURNSTILE_SITEKEY;
}

let tsScriptPromise = null;

function loadTurnstileScript() {
  if (globalThis.turnstile) return Promise.resolve();
  if (!tsScriptPromise) {
    tsScriptPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = resolve;
      s.onerror = () => {
        tsScriptPromise = null;
        reject(new Error('turnstile script load failed'));
      };
      document.head.appendChild(s);
    });
  }
  return tsScriptPromise;
}

export async function getTurnstileToken(storage = safeStorage()) {
  const sitekey = activeSitekey(storage);
  if (!sitekey || typeof document === 'undefined') return null;
  try {
    await loadTurnstileScript();
    return await new Promise((resolve) => {
      const holder = document.createElement('div');
      holder.style.cssText = 'position:fixed;left:-9999px;bottom:0;';
      document.body.appendChild(holder);
      let widgetId = null;
      let settled = false;
      const done = (token) => {
        if (settled) return;
        settled = true;
        try {
          if (widgetId !== null) globalThis.turnstile.remove(widgetId);
        } catch { /* 忽略 */ }
        holder.remove();
        resolve(token);
      };
      const timer = setTimeout(() => done(null), 20000);
      widgetId = globalThis.turnstile.render(holder, {
        sitekey,
        callback: (token) => {
          clearTimeout(timer);
          done(token);
        },
        'error-callback': () => {
          clearTimeout(timer);
          done(null);
        },
      });
    });
  } catch {
    return null;
  }
}

// ---- 錯誤文案(契約 C1 + spec §11)----

export function formatResetAt(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '明日 00:00';
  return d.toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

// R8:這幾種錯誤把「複製 prompt 自己生成,再匯回來」列為主要出路 —
// 回傳多帶 fallback:'export',main.js 據此自動展開步驟四的降級區塊。
const EXPORT_FALLBACK_SENTENCE = '也可以複製 prompt 自己生成,再匯回來(見下方)。';

// 把任何錯誤轉成可顯示的 {message, action, fallback?};action:'byo' = 引導開啟 BYO 設定面板
// ctx(R5/R6,可省略,預設從 localStorage 推):
//   hasSitekey    → turnstile_failed 時分流「驗證沒過」vs「此頁缺 sitekey 設定」
//   hasPendingJob → in_flight 時分流「自己的任務」vs「別的請求佔住鎖」
export function describeError(err, ctx = {}) {
  const kind = err instanceof ApiError ? err.body.error : null;
  const storage = ctx.storage !== undefined ? ctx.storage : safeStorage();
  const hasSitekey = ctx.hasSitekey !== undefined ? ctx.hasSitekey : !!activeSitekey(storage);
  const hasPendingJob = ctx.hasPendingJob !== undefined ? ctx.hasPendingJob : !!loadPendingJob(storage);
  switch (kind) {
    case 'not_configured':
      return {
        message: `AI 服務尚未配置:站方還沒填入金鑰。可以在頁尾「進階設定」填入自己的金鑰(BYO),立即啟用。${EXPORT_FALLBACK_SENTENCE}`,
        action: 'byo',
        fallback: 'export',
      };
    case 'quota_exceeded':
      return {
        message: `今日 AI 額度已用完,將於 ${formatResetAt(err.body.resetAt)} 重置;也可以在頁尾「進階設定」填入自己的金鑰繼續使用。`,
        action: 'byo',
      };
    case 'queue_full':
      return {
        message: `現在排隊的人有點多,請稍等幾分鐘再試。${EXPORT_FALLBACK_SENTENCE}`,
        action: 'retry',
        fallback: 'export',
      };
    case 'llm_failed':
    case 'upstream_failed':
      return { message: '這次沒有生成成功,請點重試(失敗不會重複扣額度)。', action: 'retry' };
    case 'job_failed':
      if (err.body.detail === 'timeout') {
        // R2:Worker 在 job 超過 660s 時主動判逾時並退款
        return {
          message: `生成逾時,這次的額度已自動退還,請稍後再試。${EXPORT_FALLBACK_SENTENCE}`,
          action: 'retry',
          fallback: 'export',
        };
      }
      return { message: '這次沒有生成成功,請點重試(失敗不會重複扣額度)。', action: 'retry' };
    case 'sync_fallback_timeout':
      return { message: '生成逾時,這次的額度已退還,請稍後再試。', action: 'retry' };
    case 'poll_timeout':
      return {
        message: `等了超過 12 分鐘還沒有結果,先停止等待;站方服務會自動把這次額度退還,請稍後再試。${EXPORT_FALLBACK_SENTENCE}`,
        action: 'retry',
        fallback: 'export',
      };
    case 'turnstile_failed':
      if (!hasSitekey) {
        // R5:站方 Worker 已開驗證,但這份前端沒設 sitekey → 講清楚怎麼修
        return {
          message: '站方已開啟人機驗證,但此頁缺 sitekey 設定:請在頁尾「進階設定」填入 Turnstile sitekey(自部署版請同步設定 config.js)。',
          action: 'byo',
        };
      }
      return { message: '人機驗證沒有通過,請再送出一次。', action: 'retry' };
    case 'in_flight':
      if (!hasPendingJob) {
        // R6:本地沒有 pending job 卻撞 409 → 鎖是同 IP 較早的請求(或他人共用 IP)佔住的
        return {
          message: '另一個生成正在進行(可能是你稍早送出的請求),同一時間只能跑一張;最多 15 分鐘後自動解鎖,屆時再試。',
          action: null,
        };
      }
      return { message: '上一個生成任務還在進行中,請等它完成後再送出。', action: null };
    case 'rate_limited':
      return { message: '送出太頻繁,請稍等一分鐘再試。', action: null };
    case 'bad_email':
      return { message: 'Email 格式看起來不對,請再確認一次。', action: null };
    case 'bad_request':
      return { message: '送出的內容不完整,請檢查後再試一次。', action: null };
    case 'network':
      return { message: '連不上伺服器。離線時填寫與風格漸層桌布仍可使用。', action: 'retry' };
    default:
      return { message: '發生未預期的錯誤,請稍後再試。', action: 'retry' };
  }
}

// ---- 內部小工具 ----

const defaultFetch = (...args) => globalThis.fetch(...args);

async function fetchJson(fetchFn, url, init) {
  let res;
  try {
    res = await fetchFn(url, init);
  } catch (e) {
    if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
      throw new ApiError(0, { error: 'sync_fallback_timeout' });
    }
    throw new ApiError(0, { error: 'network' });
  }
  const body = await res.json().catch(() => null);
  return { res, body };
}

async function groqJSON(groqKey, prompt, maxTokens, fetchFn) {
  const { res, body } = await fetchJson(fetchFn, GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${groqKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: GROQ_MODEL,
      messages: [{ role: 'user', content: prompt }],
      response_format: { type: 'json_object' },
      max_tokens: maxTokens,
      temperature: 0.8,
    }),
  });
  if (!res.ok) throw new ApiError(res.status, body || { error: 'llm_failed' });
  const text = body?.choices?.[0]?.message?.content ?? '';
  return parseJSONLoose(text);
}

async function workerPost(path, payload, { fetchFn, storage, getToken }) {
  const token = await getToken(storage);
  const body = token ? { ...payload, turnstileToken: token } : payload;
  const { res, body: out } = await fetchJson(fetchFn, `${workerBase(storage)}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { res, body: out };
}

function normDeps(deps = {}) {
  return {
    fetchFn: deps.fetchFn || defaultFetch,
    storage: deps.storage !== undefined ? deps.storage : safeStorage(),
    getToken: deps.getToken || getTurnstileToken,
  };
}

// ---- AI 補格 ----

// cells:長度 9 的 (string|null);回長度 9 的 string 陣列(已填格一字不改)
export async function fillCore(cells, deps = {}) {
  const d = normDeps(deps);
  const norm = cells.map((c) => (typeof c === 'string' && c.trim() ? c.trim() : null));
  const byo = getByo(d.storage);
  if (byo && byo.groqKey) {
    const out = await groqJSON(byo.groqKey, corePrompt(norm), 600, d.fetchFn);
    const arr = Array.isArray(out?.cells) ? out.cells : null;
    if (!arr || arr.length !== 9 || arr.some((x) => typeof x !== 'string' || !x.trim())) {
      throw new ApiError(502, { error: 'llm_failed' });
    }
    return arr.map((x, i) => norm[i] || x.trim()); // 已填格被改就用原值覆蓋回去
  }
  const { res, body } = await workerPost('/fill', { mode: 'core', cells: norm }, d);
  if (!res.ok) throw new ApiError(res.status, body);
  return body.cells;
}

// existingActions:長度 8 的 (string|null);回長度 8 的 string 陣列
export async function expandSub(coreGoal, subGoal, existingActions, deps = {}) {
  const d = normDeps(deps);
  const norm = existingActions.map((a) => (typeof a === 'string' && a.trim() ? a.trim() : null));
  const byo = getByo(d.storage);
  if (byo && byo.groqKey) {
    const out = await groqJSON(byo.groqKey, expandPrompt(coreGoal, subGoal, norm), 800, d.fetchFn);
    const arr = Array.isArray(out?.actions) ? out.actions : null;
    if (!arr || arr.length !== 8 || arr.some((x) => typeof x !== 'string' || !x.trim())) {
      throw new ApiError(502, { error: 'llm_failed' });
    }
    return arr.map((x, i) => norm[i] || x.trim());
  }
  const { res, body } = await workerPost(
    '/fill',
    { mode: 'expand', coreGoal, subGoal, existingActions: norm },
    d,
  );
  if (!res.ok) throw new ApiError(res.status, body);
  return body.actions;
}

// ---- 桌布背景 ----

// req:{goal, subGoals, styleId, orientation, referenceImagesBase64?, editInstruction?}
// 回 {mode:'job', jobId, byo} 或 {mode:'sync', images, byo}
export async function submitWallpaper(req, deps = {}) {
  const d = normDeps(deps);
  const byo = getByo(d.storage);

  if (byo && byo.codexUrl && byo.codexKey) {
    // BYO 直連:背景 prompt 由前端組(與 Worker 同模板),修改句直接併入 prompt
    let prompt = imagePrompt(req.goal, req.subGoals, presetById(req.styleId).words, req.orientation);
    if (req.editInstruction) {
      prompt += `\nRevision request from the user (apply it to the previous design): ${req.editInstruction}`;
    }
    const payload = {
      prompt,
      size: req.orientation === 'portrait' ? '1024x1536' : '1536x1024',
    };
    if (req.referenceImagesBase64 && req.referenceImagesBase64.length) {
      payload.reference_images_base64 = req.referenceImagesBase64;
    }
    const headers = {
      Authorization: `Bearer ${byo.codexKey}`,
      'Content-Type': 'application/json',
    };
    // 先試 job 端點
    const { res, body } = await fetchJson(d.fetchFn, `${byo.codexUrl}/v1/images/jobs`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (res.status !== 404) {
      if ((res.status === 202 || res.status === 200) && body?.id) {
        return { mode: 'job', jobId: body.id, byo: true };
      }
      throw new ApiError(res.status, body || { error: res.status === 503 ? 'queue_full' : 'upstream_failed' });
    }
    // upstream 尚無 job API → 同步端點,timeout 650s
    const { res: sres, body: sbody } = await fetchJson(d.fetchFn, `${byo.codexUrl}/v1/images/generate`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(650000),
    });
    if (sres.ok && Array.isArray(sbody?.images)) {
      return { mode: 'sync', images: sbody.images, byo: true };
    }
    throw new ApiError(sres.status, sbody || { error: sres.status === 503 ? 'queue_full' : 'upstream_failed' });
  }

  // Worker 代理:prompt 由 Worker 組;editInstruction 為前端附帶欄位(Worker 忽略未知欄位)
  const payload = {
    goal: req.goal,
    subGoals: req.subGoals,
    styleId: req.styleId,
    orientation: req.orientation,
  };
  if (req.referenceImagesBase64 && req.referenceImagesBase64.length) {
    payload.referenceImagesBase64 = req.referenceImagesBase64;
  }
  if (req.editInstruction) payload.editInstruction = req.editInstruction;
  const { res, body } = await workerPost('/image', payload, d);
  if (res.status === 202 && body?.jobId) return { mode: 'job', jobId: body.jobId, byo: false };
  if (res.ok && body?.mode === 'sync') return { mode: 'sync', images: body.images, byo: false };
  throw new ApiError(res.status, body);
}

export function pollDelay(attempt) {
  return attempt < 18 ? 5000 : 10000; // 5s × 18 次(90s)後改 10s
}

// R6 續傳:把「已經過的時間」換回輪詢節奏位置,reload 後接著原節奏跑
export function pollAttemptForElapsed(elapsedMs) {
  if (elapsedMs < 90000) return Math.floor(elapsedMs / 5000);
  return 18 + Math.floor((elapsedMs - 90000) / 10000);
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 輪詢直到 succeeded(回 images 陣列)/ failed(丟 job_failed)/ 720s 放棄(丟 poll_timeout)
// opts:{byo?:boolean, elapsedMs?:number(R6 續傳時扣掉已經過時間),
//        onTick?:({status, elapsed, attempt})=>void, fetchFn?, storage?, sleep?}
export async function pollWallpaper(jobId, opts = {}) {
  const d = normDeps(opts);
  const sleep = opts.sleep || defaultSleep;
  const byoCfg = opts.byo ? getByo(d.storage) : null;
  let elapsed = Math.max(0, opts.elapsedMs || 0);
  let attempt = pollAttemptForElapsed(elapsed);
  let consecutiveErrors = 0;

  while (true) {
    const delay = pollDelay(attempt);
    if (elapsed + delay > POLL_MAX_MS) throw new ApiError(0, { error: 'poll_timeout' });
    await sleep(delay);
    elapsed += delay;
    attempt += 1;

    let res;
    let body;
    try {
      res = byoCfg
        ? await d.fetchFn(`${byoCfg.codexUrl}/v1/images/jobs/${jobId}`, {
            headers: { Authorization: `Bearer ${byoCfg.codexKey}` },
          })
        : await d.fetchFn(`${workerBase(d.storage)}/image/${jobId}`);
      body = await res.json().catch(() => null);
    } catch {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 4) throw new ApiError(0, { error: 'network' });
      continue;
    }

    if (!res.ok) {
      if (res.status === 404) throw new ApiError(404, body || { error: 'not_found' });
      consecutiveErrors += 1; // 502 等暫時性錯誤:容忍,連續四次才放棄
      if (consecutiveErrors >= 4) throw new ApiError(res.status, body || { error: 'upstream_failed' });
      continue;
    }
    consecutiveErrors = 0;

    const st = body?.status;
    if (opts.onTick) opts.onTick({ status: st, elapsed, attempt });
    if (st === 'succeeded') return body.images || [];
    if (st === 'failed' || st === 'expired') {
      throw new ApiError(200, { error: 'job_failed', detail: String(body?.error || st) });
    }
    // queued / running → 繼續輪詢
  }
}

// ---- email 留資 ----

// company = honeypot 欄位:真人看不到也不會填;有值就原樣送出,由 Worker 回假成功擋機器人
export async function signup(email, name, company = '', deps = {}) {
  const d = normDeps(deps);
  const payload = { email, name };
  if (company) payload.company = company;
  const { res, body } = await workerPost('/signup', payload, d);
  if (!res.ok) throw new ApiError(res.status, body);
  return body;
}
