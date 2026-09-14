/**
 * 本機伺服器位址（UTF-8）。改 host / port / 路徑只編輯此檔。
 * GET：靜態 JSON（web.ps1 由 www/ 提供）預設 /data/daily-work.json
 * POST：controller 預設 /api/data（對應 controller/api/data.ps1）
 * 由 index.html 喺 app.js 之前載入。
 */
window.DAILY_WORK_SERVER = {
  host: "localhost",
  port: 8085,
  getPath: "/data/daily-work.json",
  postPath: "/api/data"
};
