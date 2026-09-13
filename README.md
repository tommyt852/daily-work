# 每日工作台

一個純靜態的每日工作頁面：今日任務、本週行程、快速筆記。資料只存於瀏覽器 localStorage，無需登入或後端。

## 使用方式

直接用任何靜態伺服器開啟本目錄即可，**不需 npm / 建置步驟**。

例如：

```bash
# Python
python3 -m http.server 8080

# 或 npx（可選）
npx serve .
```

然後開啟 `http://localhost:8080/`。

亦可直接用瀏覽器開啟 `index.html`（部分瀏覽器對 `file://` 的 localStorage 行為可能不同，建議用靜態伺服器）。

## 啟用 GitHub Pages

1. 將此資料夾推送到 GitHub 倉庫（例如倉庫名 `daily-work`）。
2. 倉庫設定 → **Pages** → Source 選 **Deploy from a branch**。
3. Branch 選 **main**，資料夾選 **/ (root)**，儲存。
4. 數分鐘後網站會出現在：

**https://tommyt852.github.io/daily-work/**

（路徑需與倉庫名稱一致；本站使用相對路徑 `./styles.css`、`./app.js`，適合 project Pages 的 `/daily-work/` 子路徑。）

## 功能摘要

- **今日任務**：新增、完成／取消完成、刪除、拖曳或按鈕排序；顯示尚餘數量；可帶入昨日未完成項目。
- **本週行程**：一週日曆條；新增／編輯／刪除定時行程。
- **快速筆記**：草稿自動儲存；可存成筆記；Enter 快速新增。
- **示範資料**：首次開啟會載入示範內容；可用「清除示範資料」一次清空本機資料。
- **匯出／匯入 JSON**：可下載完整備份（`daily-work-YYYY-MM-DD.json`），或以檔案還原；匯入前會確認並以新資料「取代」本機內容。格式錯誤會提示，不會令頁面崩潰。因資料只存 localStorage，此為可攜備份途徑。
- **時區**：Asia/Hong_Kong；介面為繁體中文（香港）。

## 檔案

| 檔案 | 說明 |
|------|------|
| `index.html` | 主頁面 |
| `styles.css` | 樣式 |
| `app.js` | 邏輯與 localStorage |
| `README.md` | 本說明 |

無需 `package.json`、無需建置。
