# 每日工作台

一個純靜態的每日工作頁面：任務看板（待辦／進行中／完成）、本週行程、快速筆記與飲水提醒。資料只存於瀏覽器 localStorage，無需登入或後端。介面為繁體中文（香港），時區 Asia/Hong_Kong。

## 使用方式

直接用任何靜態伺服器開啟本目錄即可，**不需 npm / 建置步驟**。

例如：

```bash
# Python
python3 -m http.server 8080
```

然後開啟 `http://localhost:8080/`。

亦可直接用瀏覽器開啟 `index.html`（部分瀏覽器對 `file://` 的 localStorage／Service Worker 行為可能不同，建議用靜態伺服器）。

## 本機 PowerShell 伺服器（自動讀寫 JSON）

喺**放 JSON 嘅資料夾**開 PowerShell，執行：

```powershell
powershell -ExecutionPolicy Bypass -File path\to\server.ps1
```

（或者把 `server.ps1` 同 `config.js`、靜態檔一齊放喺工作目錄，然後 `cd` 過去再執行。）

- 工作目錄（`Get-Location`）會用來讀寫 `daily-work.json`。
- 靜態頁面（`index.html`、`config.js`、`app.js` 等）由 **script 所在目錄**提供。
- 瀏覽器請開 **http://127.0.0.1:8787/** ，而**唔好**用 GitHub Pages 去打本機 API。
- 頂部「匯出 JSON／匯入 JSON」檔案功能仍然可用。
- 改 IP／port 只編輯 `config.js`，然後**重開** PowerShell server。

```js
window.DAILY_WORK_SERVER = {
  host: "127.0.0.1",
  port: 8787,
  path: "/api/data"
};
```

### 點解唔能夠用 GitHub Pages 打本機 API

GitHub Pages 係 **HTTPS**。瀏覽器會阻擋 HTTPS 頁面去呼叫 `http://127.0.0.1`（混合內容 / mixed content）。所以 `server.ps1` 必須一併提供靜態站，你要由 `http://127.0.0.1:8787/` 開啟工作台，先可以「從伺服器載入／儲存到伺服器」。

### 如果 Listen 失敗

HttpListener 有時需要 URL 預約。以**系統管理員**開 PowerShell：

```powershell
netsh http add urlacl url=http://127.0.0.1:8787/ user=Everyone
```

`server.ps1` 若 `127.0.0.1` 失敗會再試 `http://localhost:8787/`；localhost 都要預約就再加：

```powershell
netsh http add urlacl url=http://localhost:8787/ user=Everyone
```

（port 若已改過 `config.js`，urlacl 都要跟新 port。）Ctrl+C 停止伺服器。

## 啟用 GitHub Pages

1. 將此資料夾推送到 GitHub 倉庫（例如倉庫名 `daily-work`）。
2. 倉庫設定 → **Pages** → Source 選 **Deploy from a branch**。
3. Branch 選 **main**，資料夾選 **/ (root)**，儲存。
4. 數分鐘後網站會出現在：

**https://tommyt852.github.io/daily-work/**

（路徑需與倉庫名稱一致；本站使用相對路徑 `./styles.css`、`./config.js`、`./app.js`、`./sw.js`，適合 project Pages 的 `/daily-work/` 子路徑。）

## 功能摘要

### 模組分頁

頂部內頁分頁切換（非瀏覽器分頁、無整頁重新載入）：

- **任務** — Kanban 看板
- **行程** — 本週日曆
- **筆記** — 草稿與快速筆記
- **提醒** — 飲水提醒設定、本機伺服器載入／儲存

只顯示目前啟用的模組；上次選取的分頁會記在 localStorage。快捷鍵 `1`–`4`（未聚焦於輸入框時）可切換。

頁首保留日期與「匯出／匯入 JSON」「帶入昨日未完成」「清除示範資料」。

### 任務看板（Kanban）

欄位為工作流程狀態：

| 欄 | 說明 |
|----|------|
| **待辦** | 尚未開始 |
| **進行中** | 正在處理（軟性 WIP 提示：建議 ≤ 3） |
| **完成** | 已完成 |

- 拖曳卡片到其他欄會更新 `status`。
- 勾選卡片核取方塊可快速標為完成／移回待辦。
- 亦可刪除任務。

#### 重要／緊急（艾森豪旗標）

每項任務有兩個**獨立**旗標（與欄位無關）：

- **重要**
- **緊急**

新增時可勾選；卡片上亦可隨時切換。卡片會顯示「重要」「緊急」徽章。欄內會把「重要且緊急」排到較上方。可用「矩陣篩選」只顯示某一象限，但**不會**用象限當看板欄。

#### 完成欄可見度（香港日曆日）

移至「完成」時會記錄 `completedAt` 與 `completedDateKey`（Asia/Hong_Kong）。

- 完成當日、昨日、前日（即完成日距今少於 3 個香港日曆日）：留在「完成」欄可見。
- 滿 3 日（`今日 − completedDateKey ≥ 3`）：從看板**軟隱藏**（消失），但資料仍留在 localStorage，並會出現在 JSON 匯出／匯入。
- 拖回「待辦」或「進行中」會清除完成時間戳，重新成為可見的進行中卡片。

不會刪除舊完成紀錄；也不會把「今日剛完成」的卡片藏起。

#### 標籤

可選短標籤（逗號分隔），並可按標籤篩選今日看板。

### 行程／筆記／提醒

- **本週行程**：一週日曆條；新增／編輯／刪除定時行程。
- **快速筆記**：草稿自動儲存；可存成筆記；Enter 快速新增。
- **飲水提醒**（在「提醒」分頁）：Web Notifications；間隔 30／45／60／90 分鐘。無推播伺服器——關閉分頁或瀏覽器後不會再提醒。附小型 service worker 輔助通知。

### 資料匯出／匯入

- 匯出格式版本 **3**（`daily-work-YYYY-MM-DD.json`）。
- 舊版 JSON 仍可匯入：舊優先級對應為 high→重要+緊急、med→重要、low→皆否；`done` 對應 status；忽略舊的 `habits`。
- 飲水設定會一併匯出／匯入。
- 「提醒」分頁有「本機伺服器」：從 `config.js` 嘅位址 GET／POST 同一份匯出 envelope；載入前會確認取代（文案同檔案匯入）。

### 其他

- 首次開啟會載入示範內容；可用「清除示範資料」清空。
- 無習慣打卡功能。

## 檔案

| 檔案 | 說明 |
|------|------|
| `index.html` | 主頁面 |
| `styles.css` | 樣式 |
| `config.js` | 本機伺服器 host／port／API 路徑（瀏覽器同 `server.ps1` 共用） |
| `app.js` | 邏輯與 localStorage |
| `sw.js` | Service Worker（飲水提醒通知輔助） |
| `server.ps1` | 本機 HttpListener：靜態站 + `/api/data` 讀寫 `daily-work.json` |
| `README.md` | 本說明 |

無需 `package.json`、無需建置。
