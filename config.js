/**
 * 本機伺服器位址（UTF-8）。改 host / port / path 只編輯此檔。
 * GET／POST 目標為 path 所指嘅 JSON（預設 /data/daily-work.json）。
 * 由 index.html 喺 app.js 之前載入。
 */
window.DAILY_WORK_SERVER = {
  host: "127.0.0.1",
  port: 8787,
  path: "/data/daily-work.json"
};
