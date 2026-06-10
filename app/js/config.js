// 前端部署設定(R5):站方部署時只改這個檔,不用翻 api.js。
// localStorage 的 override(進階設定面板)優先於這裡的常數。

// Turnstile sitekey:留空 = 不掛 widget、不送 token(Worker 未設 secret 時相容)。
// yazelin 申請好 sitekey 後填這裡,讓所有訪客直接生效(不必每人手動設定)。
export const TURNSTILE_SITEKEY = '';

// 站方 Cloudflare Worker(/fill /image /signup /list)
export const DEFAULT_WORKER_URL = 'https://goal-grid.yazelinj303.workers.dev';

// codex-image-service 預設位址:BYO 只填 codexKey 時直連這裡(不退回 Worker)
export const DEFAULT_CODEX_URL = 'https://ching-tech.ddns.net/codex-image';
