/**
 * 本機伺服器位址。改 IP / port 只編輯此檔，然後重開 server.ps1。
 * 由 index.html 喺 app.js 之前載入；PowerShell 伺服器亦會讀同一份。
 */
window.DAILY_WORK_SERVER = {
  host: "127.0.0.1",
  port: 8787,
  path: "/api/data"
};
