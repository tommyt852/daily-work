/**
 * 每日工作台 — vanilla JS, localStorage
 * Timezone: Asia/Hong_Kong
 * Kanban: 待辦 / 進行中 / 完成 · flags: 重要 / 緊急
 */

(function () {
  "use strict";

  const TZ = "Asia/Hong_Kong";
  const STORAGE_KEY = "daily-workbench:v1";
  const TAB_KEY = "daily-workbench:active-tab";
  const THEME_KEY = "daily-workbench:theme";
  const EXPORT_VERSION = 5;
  const DATA_VERSION = 5;
  const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];
  const WATER_INTERVALS = [30, 45, 60, 90];
  const WATER_MIN_GAP_MS = 25 * 1000;
  const STATUSES = ["todo", "doing", "done"];
  const STATUS_LABEL = { todo: "待辦", doing: "進行中", done: "完成" };
  const WIP_SOFT_LIMIT = 3;
  const DONE_VISIBLE_DAYS = 3; // hide when age >= 3 HK calendar days
  const TABS = ["tasks", "calendar", "notes", "reminders", "weather"];
  const WEATHER_GRID_KEY = "daily-workbench:weather-grid";
  const WEATHER_SETTINGS_KEY = "daily-workbench:weather-settings";
  const CSDI_GRID_QUERY =
    "https://portal.csdi.gov.hk/server/rest/services/common/hko_rcd_1634958531320_87755/MapServer/0/query" +
    "?where=1%3D1&outFields=Latitude_degree_%2CLongitude_degree_%2COBJECTID&returnGeometry=true&f=json&resultRecordCount=2000";
  const HKO_RHRREAD =
    "https://data.weather.gov.hk/weatherAPI/opendata/weather.php?dataType=rhrread&lang=tc";
  const WEATHER_STALE_MS = 20 * 60 * 1000;
  const HK_DISTRICTS = [
    { place: "中西區", lat: 22.2819, lon: 114.1582 },
    { place: "灣仔", lat: 22.2770, lon: 114.1733 },
    { place: "東區", lat: 22.2841, lon: 114.2242 },
    { place: "南區", lat: 22.2470, lon: 114.1589 },
    { place: "油尖旺", lat: 22.3119, lon: 114.1709 },
    { place: "深水埗", lat: 22.3308, lon: 114.1628 },
    { place: "九龍城", lat: 22.3282, lon: 114.1915 },
    { place: "黃大仙", lat: 22.3429, lon: 114.1950 },
    { place: "觀塘", lat: 22.3125, lon: 114.2257 },
    { place: "荃灣", lat: 22.3714, lon: 114.1139 },
    { place: "屯門", lat: 22.3910, lon: 113.9770 },
    { place: "元朗", lat: 22.4445, lon: 114.0222 },
    { place: "北區", lat: 22.4947, lon: 114.1380 },
    { place: "大埔", lat: 22.4508, lon: 114.1644 },
    { place: "西貢", lat: 22.3819, lon: 114.2734 },
    { place: "沙田", lat: 22.3847, lon: 114.1877 },
    { place: "葵青", lat: 22.3578, lon: 114.1220 },
    { place: "離島區", lat: 22.2860, lon: 113.9430 },
  ];

  // —— Date helpers (Asia/Hong_Kong) ——
  function hkParts(date = new Date()) {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(date).map((p) => [p.type, p.value])
    );
    return {
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour === "24" ? "00" : parts.hour,
      minute: parts.minute,
      dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    };
  }

  function todayKey() {
    return hkParts().dateKey;
  }

  function yesterdayKey() {
    const now = new Date();
    const today = todayKey();
    let key = today;
    for (let i = 1; i <= 48; i++) {
      const d = new Date(now.getTime() - i * 60 * 60 * 1000);
      const k = hkParts(d).dateKey;
      if (k !== today) {
        key = k;
        break;
      }
    }
    return key;
  }

  function parseDateKey(key) {
    const [y, m, d] = key.split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d, 4, 0, 0));
  }

  function addDaysToKey(key, delta) {
    const [y, m, d] = key.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d + delta, 4, 0, 0));
    return hkParts(dt).dateKey;
  }

  /** Calendar-day difference laterKey - earlierKey (HK date keys). */
  function calendarDaysBetween(earlierKey, laterKey) {
    if (!earlierKey || !laterKey) return 0;
    const [y1, m1, d1] = earlierKey.split("-").map(Number);
    const [y2, m2, d2] = laterKey.split("-").map(Number);
    const t1 = Date.UTC(y1, m1 - 1, d1);
    const t2 = Date.UTC(y2, m2 - 1, d2);
    return Math.round((t2 - t1) / 86400000);
  }

  function weekdayIndex(key) {
    const dt = parseDateKey(key);
    const wd = new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      weekday: "short",
    }).format(dt);
    const map = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
    return map[wd] ?? 0;
  }

  function weekKeysAround(centerKey) {
    const wd = weekdayIndex(centerKey);
    const mondayOffset = wd === 0 ? -6 : 1 - wd;
    const monday = addDaysToKey(centerKey, mondayOffset);
    return Array.from({ length: 7 }, (_, i) => addDaysToKey(monday, i));
  }

  function formatHeaderDate(key) {
    const [y, m, d] = key.split("-");
    const wd = DOW_ZH[weekdayIndex(key)];
    return `${y}年${Number(m)}月${Number(d)}日（星期${wd}）· 香港時間`;
  }

  function formatNoteTime(iso) {
    try {
      return new Intl.DateTimeFormat("zh-HK", {
        timeZone: TZ,
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }).format(new Date(iso));
    } catch {
      return "";
    }
  }

  function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function parseTags(raw) {
    if (Array.isArray(raw)) {
      return raw
        .map((t) => String(t).trim())
        .filter(Boolean)
        .slice(0, 8)
        .map((t) => t.slice(0, 16));
    }
    if (typeof raw !== "string") return [];
    return raw
      .split(/[,，、]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8)
      .map((t) => t.slice(0, 16));
  }

  function isDateKey(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
  }

  function normalizeDueDate(raw) {
    if (raw == null || raw === "") return null;
    if (isDateKey(raw)) return raw;
    return null;
  }

  function isTaskOverdue(task, today = todayKey()) {
    if (!task || task.status === "done" || task.done) return false;
    const due = normalizeDueDate(task.dueDate);
    if (!due) return false;
    return due < today;
  }

  function isTaskDueToday(task, today = todayKey()) {
    if (!task || task.status === "done" || task.done) return false;
    return normalizeDueDate(task.dueDate) === today;
  }

  function formatDueLabel(due) {
    if (!due) return "";
    const today = todayKey();
    if (due === today) return "今日到期";
    if (due === addDaysToKey(today, 1)) return "明日到期";
    if (due === yesterdayKey()) return "昨日到期";
    const [, m, d] = due.split("-");
    return `到期 ${Number(m)}/${Number(d)}`;
  }

  function advanceDueDate(dueDate, recurrence) {
    const due = normalizeDueDate(dueDate);
    if (!due) return null;
    const r = normalizeRecurrence(recurrence);
    if (r.type === "none") return due;
    // weekly: +7 days per commit-2 note; others follow nextOccurrenceDateKey
    if (r.type === "weekly") return addDaysToKey(due, 7);
    return nextOccurrenceDateKey(due, r) || due;
  }

  const RECUR_TYPES = ["none", "daily", "weekdays", "weekly", "monthly"];
  const RECUR_LABEL = {
    none: "無",
    daily: "每日",
    weekdays: "每個工作日",
    weekly: "每週",
    monthly: "每月同一日",
  };

  function normalizeWeekdays(raw) {
    if (!Array.isArray(raw)) return [];
    const set = new Set();
    raw.forEach((n) => {
      const v = Number(n);
      if (Number.isInteger(v) && v >= 0 && v <= 6) set.add(v);
    });
    return Array.from(set).sort((a, b) => a - b);
  }

  function normalizeRecurrence(raw) {
    if (!raw || raw === "none" || raw === "null") {
      return { type: "none", weekdays: [] };
    }
    if (typeof raw === "string") {
      if (RECUR_TYPES.includes(raw)) {
        return { type: raw === "weekly" ? "weekly" : raw, weekdays: raw === "weekly" ? [1] : [] };
      }
      return { type: "none", weekdays: [] };
    }
    if (typeof raw !== "object") return { type: "none", weekdays: [] };
    let type = typeof raw.type === "string" ? raw.type : "none";
    if (!RECUR_TYPES.includes(type)) type = "none";
    const weekdays = type === "weekly" ? normalizeWeekdays(raw.weekdays) : [];
    if (type === "weekly" && weekdays.length === 0) {
      return { type: "weekly", weekdays: [1] };
    }
    return { type, weekdays };
  }

  function cloneRecurrence(r) {
    const n = normalizeRecurrence(r);
    return { type: n.type, weekdays: n.weekdays.slice() };
  }

  function isRecurring(task) {
    return task && task.recurrence && task.recurrence.type && task.recurrence.type !== "none";
  }

  function recurrenceSummary(rec) {
    const r = normalizeRecurrence(rec);
    if (r.type === "none") return "";
    if (r.type === "weekly") {
      const days = (r.weekdays || []).map((d) => DOW_ZH[d]).join("、");
      return days ? `每週（${days}）` : "每週";
    }
    return RECUR_LABEL[r.type] || "";
  }

  /** Next HK date key after baseKey for a recurrence rule. */
  function nextOccurrenceDateKey(baseKey, recurrence) {
    const r = normalizeRecurrence(recurrence);
    if (r.type === "none") return null;
    if (r.type === "daily") return addDaysToKey(baseKey, 1);
    if (r.type === "weekdays") {
      for (let i = 1; i <= 14; i++) {
        const k = addDaysToKey(baseKey, i);
        const wd = weekdayIndex(k);
        if (wd >= 1 && wd <= 5) return k;
      }
      return addDaysToKey(baseKey, 1);
    }
    if (r.type === "weekly") {
      const wanted = new Set(r.weekdays.length ? r.weekdays : [1]);
      for (let i = 1; i <= 14; i++) {
        const k = addDaysToKey(baseKey, i);
        if (wanted.has(weekdayIndex(k))) return k;
      }
      return addDaysToKey(baseKey, 7);
    }
    if (r.type === "monthly") {
      const [y, m, d] = baseKey.split("-").map(Number);
      let ny = y;
      let nm = m + 1;
      if (nm > 12) {
        nm = 1;
        ny += 1;
      }
      // Clamp to last day of target month
      const lastDay = new Date(Date.UTC(ny, nm, 0)).getUTCDate();
      const day = Math.min(d, lastDay);
      const mm = String(nm).padStart(2, "0");
      const dd = String(day).padStart(2, "0");
      return `${ny}-${mm}-${dd}`;
    }
    return null;
  }

  function readComposerRecurrence() {
    const type = (els.taskRecurrence && els.taskRecurrence.value) || "none";
    if (type === "weekly") {
      const picks = els.taskWeekdayPicks
        ? Array.from(els.taskWeekdayPicks.querySelectorAll('input[type="checkbox"]:checked')).map(
            (el) => Number(el.value)
          )
        : [];
      return normalizeRecurrence({ type: "weekly", weekdays: picks.length ? picks : [1] });
    }
    return normalizeRecurrence({ type });
  }

  function resetComposerRecurrence() {
    if (els.taskRecurrence) els.taskRecurrence.value = "none";
    if (els.taskWeekdayPicks) {
      els.taskWeekdayPicks.hidden = true;
      els.taskWeekdayPicks.querySelectorAll('input[type="checkbox"]').forEach((el) => {
        el.checked = false;
      });
    }
  }

  function syncComposerWeekdayVisibility() {
    if (!els.taskRecurrence || !els.taskWeekdayPicks) return;
    const weekly = els.taskRecurrence.value === "weekly";
    els.taskWeekdayPicks.hidden = !weekly;
  }

  function normalizeStatus(s, doneFlag) {
    if (s === "todo" || s === "doing" || s === "done") return s;
    if (doneFlag) return "done";
    return "todo";
  }

  /** Map legacy priority → important/urgent. */
  function flagsFromLegacy(t) {
    let important = false;
    let urgent = false;
    if (typeof t.important === "boolean" || typeof t.urgent === "boolean") {
      important = !!t.important;
      urgent = !!t.urgent;
    } else if (t.priority === "high") {
      important = true;
      urgent = true;
    } else if (t.priority === "med") {
      important = true;
      urgent = false;
    } else if (t.priority === "low") {
      important = false;
      urgent = false;
    }
    return { important, urgent };
  }

  function normalizeTask(t) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.text !== "string" || !t.text.trim()) return null;
    const flags = flagsFromLegacy(t);
    const status = normalizeStatus(t.status, t.done);
    const done = status === "done";
    let completedAt = null;
    let completedDateKey = null;
    if (done) {
      if (typeof t.completedAt === "string" && t.completedAt) {
        completedAt = t.completedAt;
      } else {
        completedAt = typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString();
      }
      if (typeof t.completedDateKey === "string" && /^\d{4}-\d{2}-\d{2}$/.test(t.completedDateKey)) {
        completedDateKey = t.completedDateKey;
      } else {
        try {
          completedDateKey = hkParts(new Date(completedAt)).dateKey;
        } catch {
          completedDateKey = todayKey();
        }
      }
    }
    return {
      id: typeof t.id === "string" && t.id ? t.id : uid(),
      text: t.text.trim().slice(0, 200),
      status,
      done,
      important: flags.important,
      urgent: flags.urgent,
      tags: parseTags(t.tags),
      recurrence: normalizeRecurrence(t.recurrence),
      dueDate: normalizeDueDate(t.dueDate),
      createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
      completedAt,
      completedDateKey,
      ...(t.pulledFrom ? { pulledFrom: t.pulledFrom } : {}),
    };
  }

  function isDoneVisibleOnBoard(task, today = todayKey()) {
    if (task.status !== "done") return true;
    const key = task.completedDateKey || today;
    const age = calendarDaysBetween(key, today);
    return age >= 0 && age < DONE_VISIBLE_DAYS;
  }

  function eisenBucket(task) {
    if (task.important && task.urgent) return "iu";
    if (task.important && !task.urgent) return "in";
    if (!task.important && task.urgent) return "nu";
    return "nn";
  }

  function sortTasksInColumn(a, b) {
    const over = (t) => (isTaskOverdue(t) ? 1 : 0);
    const od = over(b) - over(a);
    if (od !== 0) return od;
    // 重要且緊急 float to top
    const score = (t) => (t.important && t.urgent ? 2 : t.important ? 1 : 0);
    const d = score(b) - score(a);
    if (d !== 0) return d;
    // earlier dueDate first among dated tasks
    const da = normalizeDueDate(a.dueDate) || "9999-99-99";
    const db = normalizeDueDate(b.dueDate) || "9999-99-99";
    if (da !== db) return da.localeCompare(db);
    return (a.createdAt || "").localeCompare(b.createdAt || "");
  }

  function defaultWater() {
    return {
      enabled: false,
      intervalMinutes: 60,
      lastNotifiedAt: null,
    };
  }

  function normalizeWater(w) {
    const base = defaultWater();
    if (!w || typeof w !== "object") return base;
    const interval = Number(w.intervalMinutes);
    return {
      enabled: !!w.enabled,
      intervalMinutes: WATER_INTERVALS.includes(interval) ? interval : 60,
      lastNotifiedAt:
        typeof w.lastNotifiedAt === "string" || w.lastNotifiedAt == null
          ? w.lastNotifiedAt || null
          : null,
    };
  }

  function defaultAlerts() {
    return {
      tasksEnabled: false,
      eventsEnabled: false,
      eventLeadMinutes: 15,
      stamps: {},
    };
  }

  function normalizeAlerts(a) {
    const base = defaultAlerts();
    if (!a || typeof a !== "object") return base;
    const lead = Number(a.eventLeadMinutes);
    const stamps =
      a.stamps && typeof a.stamps === "object" && !Array.isArray(a.stamps)
        ? { ...a.stamps }
        : {};
    return {
      tasksEnabled: !!a.tasksEnabled,
      eventsEnabled: !!a.eventsEnabled,
      eventLeadMinutes: lead === 0 || lead === 15 ? lead : 15,
      stamps,
    };
  }

  function ensureStateShape(data) {
    data.tasksByDate = data.tasksByDate || {};
    for (const [dk, list] of Object.entries(data.tasksByDate)) {
      if (!Array.isArray(list)) {
        data.tasksByDate[dk] = [];
        continue;
      }
      data.tasksByDate[dk] = list.map((t) => normalizeTask(t)).filter(Boolean);
    }
    data.events = Array.isArray(data.events) ? data.events : [];
    data.notes = Array.isArray(data.notes) ? data.notes : [];
    data.scratch = typeof data.scratch === "string" ? data.scratch : "";
    // habits dropped — ignore leftover
    delete data.habits;
    data.waterReminder = normalizeWater(data.waterReminder);
    data.alerts = normalizeAlerts(data.alerts);
    data.version = DATA_VERSION;
    return data;
  }

  function buildSeed() {
    const today = todayKey();
    const yest = yesterdayKey();
    const week = weekKeysAround(today);
    return {
      version: DATA_VERSION,
      seeded: true,
      tasksByDate: {
        [today]: [
          {
            id: uid(),
            text: "檢視本週優先事項",
            status: "todo",
            done: false,
            important: true,
            urgent: true,
            tags: ["工作"],
            createdAt: new Date().toISOString(),
            completedAt: null,
            completedDateKey: null,
            recurrence: { type: "none", weekdays: [] },
            dueDate: today,
          },
          {
            id: uid(),
            text: "回覆待辦電郵",
            status: "doing",
            done: false,
            important: true,
            urgent: false,
            tags: ["工作"],
            createdAt: new Date().toISOString(),
            completedAt: null,
            completedDateKey: null,
            recurrence: { type: "none", weekdays: [] },
            dueDate: today,
          },
          {
            id: uid(),
            text: "整理桌面與檔案",
            status: "done",
            done: true,
            important: false,
            urgent: false,
            tags: ["私人"],
            createdAt: new Date().toISOString(),
            completedAt: new Date().toISOString(),
            completedDateKey: today,
            recurrence: { type: "none", weekdays: [] },
            dueDate: null,
          },
        ],
        [yest]: [
          {
            id: uid(),
            text: "完成每週報告草稿",
            status: "todo",
            done: false,
            important: true,
            urgent: true,
            tags: ["工作"],
            createdAt: new Date().toISOString(),
            completedAt: null,
            completedDateKey: null,
            recurrence: { type: "none", weekdays: [] },
            dueDate: yest,
          },
          {
            id: uid(),
            text: "更新專案進度表",
            status: "todo",
            done: false,
            important: true,
            urgent: false,
            tags: ["工作"],
            createdAt: new Date().toISOString(),
            completedAt: null,
            completedDateKey: null,
            recurrence: { type: "none", weekdays: [] },
            dueDate: null,
          },
        ],
      },
      events: [
        {
          id: uid(),
          title: "晨間 standup",
          date: today,
          start: "09:30",
          end: "09:45",
          notes: "線上會議",
        },
        {
          id: uid(),
          title: "專注時段：深度工作",
          date: today,
          start: "10:00",
          end: "12:00",
          notes: "",
        },
        {
          id: uid(),
          title: "一對一面談",
          date: week[Math.min(2, week.length - 1)],
          start: "15:00",
          end: "15:30",
          notes: "準備近況摘要",
        },
      ],
      scratch: "歡迎使用每日工作台。\n資料只存於本機瀏覽器，重新整理亦會保留。",
      notes: [
        {
          id: uid(),
          body: "記得下班前備份重要檔案。",
          createdAt: new Date().toISOString(),
        },
      ],
      waterReminder: defaultWater(),
      alerts: defaultAlerts(),
    };
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        const seed = buildSeed();
        saveState(seed);
        return seed;
      }
      const data = JSON.parse(raw);
      if (!data || typeof data !== "object") throw new Error("bad");
      return ensureStateShape(data);
    } catch {
      const seed = buildSeed();
      saveState(seed);
      return seed;
    }
  }

  function saveState(state) {
    // Never persist habits
    const copy = { ...state };
    delete copy.habits;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(copy));
  }

  let state = loadState();
  let selectedDate = todayKey();
  let dragTaskId = null;
  let toastTimer = null;
  let filterTag = "all";
  let filterEisen = "all";
  let searchFocusTaskId = null;
  let searchQuery = "";
  let waterTimerId = null;
  let swRegistration = null;
  let activeTab = loadActiveTab();

  function loadActiveTab() {
    try {
      const t = localStorage.getItem(TAB_KEY);
      if (TABS.includes(t)) return t;
    } catch {
      /* ignore */
    }
    return "tasks";
  }

  function persistActiveTab(tab) {
    try {
      localStorage.setItem(TAB_KEY, tab);
    } catch {
      /* ignore */
    }
  }

  const $ = (sel) => document.querySelector(sel);

  const els = {
    headerDate: $("#header-date"),
    taskForm: $("#task-form"),
    taskInput: $("#task-input"),
    taskImportant: $("#task-important"),
    taskUrgent: $("#task-urgent"),
    taskTags: $("#task-tags"),
    taskRecurrence: $("#task-recurrence"),
    taskWeekdayPicks: $("#task-weekday-picks"),
    taskDueDate: $("#task-due-date"),
    filterTag: $("#filter-tag"),
    filterEisen: $("#filter-eisen"),
    btnClearFilters: $("#btn-clear-filters"),
    btnClearSearchFocus: $("#btn-clear-search-focus"),
    globalSearch: $("#global-search"),
    searchResults: $("#search-results"),
    btnThemeToggle: $("#btn-theme-toggle"),
    themeToggleLabel: $("#theme-toggle-label"),
    kanban: $("#kanban"),
    tasksEmpty: $("#tasks-empty"),
    tasksFilteredEmpty: $("#tasks-filtered-empty"),
    tasksRemaining: $("#tasks-remaining"),
    wipHint: $("#wip-hint"),
    btnPullForward: $("#btn-pull-forward"),
    btnWipeSeed: $("#btn-wipe-seed"),
    btnExport: $("#btn-export"),
    btnImport: $("#btn-import"),
    importFile: $("#import-file"),
    weekStrip: $("#week-strip"),
    calRange: $("#cal-range"),
    eventList: $("#event-list"),
    eventsEmpty: $("#events-empty"),
    btnAddEvent: $("#btn-add-event"),
    eventModal: $("#event-modal"),
    eventForm: $("#event-form"),
    eventModalTitle: $("#event-modal-title"),
    eventId: $("#event-id"),
    eventTitle: $("#event-title"),
    eventDate: $("#event-date"),
    eventStart: $("#event-start"),
    eventEnd: $("#event-end"),
    eventNotes: $("#event-notes"),
    eventModalClose: $("#event-modal-close"),
    eventModalCancel: $("#event-modal-cancel"),
    scratchPad: $("#scratch-pad"),
    scratchHint: $("#scratch-hint"),
    btnSaveNote: $("#btn-save-note"),
    noteForm: $("#note-form"),
    noteInput: $("#note-input"),
    noteList: $("#note-list"),
    notesEmpty: $("#notes-empty"),
    waterEnabled: $("#water-enabled"),
    waterInterval: $("#water-interval"),
    waterStatus: $("#water-status"),
    waterPermMsg: $("#water-perm-msg"),
    btnWaterTest: $("#btn-water-test"),
    alertTasksEnabled: $("#alert-tasks-enabled"),
    alertEventsEnabled: $("#alert-events-enabled"),
    alertEventLead: $("#alert-event-lead"),
    alertStatus: $("#alert-status"),
    alertPermMsg: $("#alert-perm-msg"),
    serverUrlHint: $("#server-url-hint"),
    btnServerImport: $("#btn-server-import"),
    btnServerExport: $("#btn-server-export"),
    toast: $("#toast"),
    weatherImportStatus: $("#weather-import-status"),
    weatherImportMsg: $("#weather-import-msg"),
    weatherImportMeta: $("#weather-import-meta"),
    btnWeatherImport: $("#btn-weather-import"),
    weatherFile: $("#weather-file"),
    btnWeatherClear: $("#btn-weather-clear"),
    weatherMapHint: $("#weather-map-hint"),
    weatherMapEl: $("#weather-map"),
    weatherAlertEnabled: $("#weather-alert-enabled"),
    weatherThreshold: $("#weather-threshold"),
    weatherPinDistrict: $("#weather-pin-district"),
    weatherPinStatus: $("#weather-pin-status"),
    weatherPinMsg: $("#weather-pin-msg"),
    btnWeatherUnpin: $("#btn-weather-unpin"),
    btnWeatherExportPin: $("#btn-weather-export-pin"),
    weatherDistrict: $("#weather-district"),
    weatherRhrStatus: $("#weather-rhr-status"),
    weatherRhrValue: $("#weather-rhr-value"),
    btnWeatherRhrRefresh: $("#btn-weather-rhr-refresh"),
    weatherOmStatus: $("#weather-om-status"),
    weatherOmBanner: $("#weather-om-banner"),
    weatherOmValue: $("#weather-om-value"),
    btnWeatherOmRefresh: $("#btn-weather-om-refresh"),
  };

  function toast(msg) {
    els.toast.textContent = msg;
    els.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      els.toast.hidden = true;
    }, 2600);
  }

  function persist() {
    saveState(state);
  }

  // —— Tabs ——
  function setActiveTab(tab, opts) {
    if (!TABS.includes(tab)) tab = "tasks";
    activeTab = tab;
    persistActiveTab(tab);
    document.querySelectorAll(".mod-tabs__btn").forEach((btn) => {
      const on = btn.dataset.tab === tab;
      btn.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll(".panel--module").forEach((panel) => {
      const on = panel.dataset.module === tab;
      panel.hidden = !on;
    });
    if (!opts || !opts.silent) {
      // focus nothing special
    }
    if (tab === "weather") {
      setTimeout(() => {
        if (weatherMap) weatherMap.invalidateSize();
        ensureWeatherBootstrapped();
      }, 40);
    }
  }

  // —— Tasks ——
  function getTodayTasks() {
    const key = todayKey();
    if (!state.tasksByDate[key]) state.tasksByDate[key] = [];
    return state.tasksByDate[key];
  }

  function findTask(id) {
    return getTodayTasks().find((t) => t.id === id) || null;
  }

  function spawnNextOccurrence(completedTask) {
    if (!isRecurring(completedTask)) return null;
    const baseKey = completedTask.completedDateKey || todayKey();
    const nextKey = nextOccurrenceDateKey(baseKey, completedTask.recurrence);
    if (!nextKey) return null;
    if (!state.tasksByDate[nextKey]) state.tasksByDate[nextKey] = [];
    const next = {
      id: uid(),
      text: completedTask.text,
      status: "todo",
      done: false,
      important: !!completedTask.important,
      urgent: !!completedTask.urgent,
      tags: Array.isArray(completedTask.tags) ? completedTask.tags.slice() : [],
      recurrence: cloneRecurrence(completedTask.recurrence),
      dueDate: advanceDueDate(completedTask.dueDate, completedTask.recurrence),
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedDateKey: null,
    };
    state.tasksByDate[nextKey].unshift(next);
    return { next, nextKey };
  }

  function setTaskStatus(task, status) {
    const prev = task.status;
    status = normalizeStatus(status, false);
    task.status = status;
    if (status === "done") {
      task.done = true;
      task.completedAt = new Date().toISOString();
      task.completedDateKey = todayKey();
      if (prev !== "done" && isRecurring(task)) {
        return spawnNextOccurrence(task);
      }
      return null;
    }
    task.done = false;
    task.completedAt = null;
    task.completedDateKey = null;
    return null;
  }

  function toastStatusChange(status, spawned) {
    if (spawned) {
      const label = recurrenceSummary(spawned.next.recurrence);
      const when =
        spawned.nextKey === todayKey()
          ? "今日待辦"
          : spawned.nextKey === addDaysToKey(todayKey(), 1)
            ? "明日待辦"
            : spawned.nextKey;
      toast(`已完成並建立下次「${label}」→ ${when}`);
      return;
    }
    toast(`已移至「${STATUS_LABEL[status]}」`);
  }

  function collectAllTags() {
    const set = new Set();
    getTodayTasks().forEach((t) => (t.tags || []).forEach((tag) => set.add(tag)));
    return Array.from(set).sort((a, b) => a.localeCompare(b, "zh-HK"));
  }

  function updateFilterTagOptions() {
    const tags = collectAllTags();
    const current = filterTag;
    els.filterTag.innerHTML = "";
    const allOpt = document.createElement("option");
    allOpt.value = "all";
    allOpt.textContent = "全部";
    els.filterTag.appendChild(allOpt);
    tags.forEach((tag) => {
      const opt = document.createElement("option");
      opt.value = tag;
      opt.textContent = tag;
      els.filterTag.appendChild(opt);
    });
    if (current !== "all" && tags.includes(current)) {
      els.filterTag.value = current;
      filterTag = current;
    } else {
      els.filterTag.value = "all";
      filterTag = "all";
    }
  }

  function passesFilters(t) {
    if (searchFocusTaskId && t.id !== searchFocusTaskId) return false;
    if (filterTag !== "all") {
      const tags = t.tags || [];
      if (!tags.includes(filterTag)) return false;
    }
    if (filterEisen !== "all" && eisenBucket(t) !== filterEisen) return false;
    return true;
  }

  function updateFilterClearBtn() {
    const active = filterTag !== "all" || filterEisen !== "all";
    els.btnClearFilters.hidden = !active;
    if (els.btnClearSearchFocus) {
      els.btnClearSearchFocus.hidden = !searchFocusTaskId;
    }
  }

  function clearSearchFocus() {
    searchFocusTaskId = null;
    updateFilterClearBtn();
  }

  function createTaskCard(task) {
    const overdue = isTaskOverdue(task);
    const li = document.createElement("li");
    li.className =
      "task-card" +
      (task.important && task.urgent ? " task-card--priority-boost" : "") +
      (overdue ? " task-card--overdue" : "") +
      (isTaskDueToday(task) ? " task-card--due-today" : "") +
      (searchFocusTaskId && searchFocusTaskId === task.id ? " task-card--search-focus" : "");
    li.dataset.id = task.id;
    li.draggable = true;

    const top = document.createElement("div");
    top.className = "task-card__top";

    const check = document.createElement("input");
    check.type = "checkbox";
    check.className = "task-card__check";
    check.checked = task.status === "done";
    check.title = task.status === "done" ? "移回待辦" : "標為完成";
    check.setAttribute("aria-label", check.title);
    check.addEventListener("change", () => {
      let spawned = null;
      if (check.checked) {
        spawned = setTaskStatus(task, "done");
      } else {
        setTaskStatus(task, "todo");
      }
      persist();
      renderTasks();
      if (spawned) toastStatusChange("done", spawned);
    });

    const text = document.createElement("span");
    text.className = "task-card__text";
    text.textContent = task.text;

    top.append(check, text);

    const badges = document.createElement("div");
    badges.className = "task-card__badges";
    if (task.important) {
      const b = document.createElement("span");
      b.className = "eisen-badge eisen-badge--important";
      b.textContent = "重要";
      badges.appendChild(b);
    }
    if (task.urgent) {
      const b = document.createElement("span");
      b.className = "eisen-badge eisen-badge--urgent";
      b.textContent = "緊急";
      badges.appendChild(b);
    }
    (task.tags || []).forEach((tag) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = tag;
      badges.appendChild(chip);
    });
    if (isRecurring(task)) {
      const rb = document.createElement("span");
      rb.className = "recur-badge";
      rb.textContent = recurrenceSummary(task.recurrence);
      badges.appendChild(rb);
    }
    if (overdue) {
      const ob = document.createElement("span");
      ob.className = "due-badge due-badge--overdue";
      ob.textContent = "逾期";
      badges.appendChild(ob);
    } else if (task.dueDate) {
      const db = document.createElement("span");
      db.className =
        "due-badge" + (isTaskDueToday(task) ? " due-badge--today" : "");
      db.textContent = formatDueLabel(task.dueDate);
      badges.appendChild(db);
    }

    const flags = document.createElement("div");
    flags.className = "task-card__flags";

    const impLabel = document.createElement("label");
    impLabel.className = "flag-toggle";
    const impCb = document.createElement("input");
    impCb.type = "checkbox";
    impCb.dataset.flag = "important";
    impCb.checked = !!task.important;
    impCb.addEventListener("change", () => {
      task.important = impCb.checked;
      persist();
      renderTasks();
    });
    impLabel.append(impCb, document.createTextNode("重要"));

    const urgLabel = document.createElement("label");
    urgLabel.className = "flag-toggle";
    const urgCb = document.createElement("input");
    urgCb.type = "checkbox";
    urgCb.dataset.flag = "urgent";
    urgCb.checked = !!task.urgent;
    urgCb.addEventListener("change", () => {
      task.urgent = urgCb.checked;
      persist();
      renderTasks();
    });
    urgLabel.append(urgCb, document.createTextNode("緊急"));

    flags.append(impLabel, urgLabel);

    const tagsInput = document.createElement("input");
    tagsInput.type = "text";
    tagsInput.className = "task-card__tags-input";
    tagsInput.title = "標籤（逗號分隔）";
    tagsInput.placeholder = "標籤";
    tagsInput.value = (task.tags || []).join(", ");
    tagsInput.addEventListener("change", () => {
      task.tags = parseTags(tagsInput.value);
      persist();
      renderTasks();
    });
    tagsInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        tagsInput.blur();
      }
    });

    const dueWrap = document.createElement("div");
    dueWrap.className = "task-card__due";
    const dueLabel = document.createElement("span");
    dueLabel.className = "task-card__due-label";
    dueLabel.textContent = "到期";
    const dueInput = document.createElement("input");
    dueInput.type = "date";
    dueInput.className = "task-card__due-input";
    dueInput.title = "到期日（香港日曆日，可留空）";
    dueInput.value = normalizeDueDate(task.dueDate) || "";
    dueInput.addEventListener("change", () => {
      task.dueDate = normalizeDueDate(dueInput.value);
      persist();
      renderTasks();
    });
    const dueClear = document.createElement("button");
    dueClear.type = "button";
    dueClear.className = "btn btn--tiny btn--ghost";
    dueClear.textContent = "清除";
    dueClear.title = "清除到期日";
    dueClear.hidden = !task.dueDate;
    dueClear.addEventListener("click", () => {
      task.dueDate = null;
      persist();
      renderTasks();
    });
    dueWrap.append(dueLabel, dueInput, dueClear);

    const recurWrap = document.createElement("div");
    recurWrap.className = "task-card__recur";
    const recurLabel = document.createElement("span");
    recurLabel.className = "task-card__recur-label";
    recurLabel.textContent = "重複";
    const recurSelect = document.createElement("select");
    recurSelect.className = "task-card__recur-select";
    recurSelect.title = "重複規則";
    RECUR_TYPES.forEach((type) => {
      const opt = document.createElement("option");
      opt.value = type;
      opt.textContent = RECUR_LABEL[type];
      recurSelect.appendChild(opt);
    });
    const rec = normalizeRecurrence(task.recurrence);
    recurSelect.value = rec.type;

    const cardWeekdays = document.createElement("div");
    cardWeekdays.className = "weekday-picks";
    cardWeekdays.hidden = rec.type !== "weekly";
    [1, 2, 3, 4, 5, 6, 0].forEach((d) => {
      const lab = document.createElement("label");
      lab.className = "weekday-pick";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.value = String(d);
      cb.checked = rec.weekdays.includes(d);
      cb.addEventListener("change", () => {
        const picked = Array.from(
          cardWeekdays.querySelectorAll('input[type="checkbox"]:checked')
        ).map((el) => Number(el.value));
        task.recurrence = normalizeRecurrence({
          type: "weekly",
          weekdays: picked.length ? picked : [weekdayIndex(todayKey())],
        });
        persist();
        renderTasks();
      });
      lab.append(cb, document.createTextNode(DOW_ZH[d]));
      cardWeekdays.appendChild(lab);
    });

    recurSelect.addEventListener("change", () => {
      const type = recurSelect.value;
      if (type === "weekly") {
        const picked = Array.from(
          cardWeekdays.querySelectorAll('input[type="checkbox"]:checked')
        ).map((el) => Number(el.value));
        task.recurrence = normalizeRecurrence({
          type: "weekly",
          weekdays: picked.length ? picked : [weekdayIndex(todayKey())],
        });
        cardWeekdays.hidden = false;
      } else {
        task.recurrence = normalizeRecurrence({ type });
        cardWeekdays.hidden = true;
      }
      persist();
      renderTasks();
    });

    recurWrap.append(recurLabel, recurSelect, cardWeekdays);

    const actions = document.createElement("div");
    actions.className = "task-card__actions";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "btn btn--tiny btn--ghost";
    del.textContent = "刪";
    del.title = "刪除";
    del.addEventListener("click", () => {
      const list = getTodayTasks();
      state.tasksByDate[todayKey()] = list.filter((t) => t.id !== task.id);
      persist();
      renderTasks();
      toast("已刪除任務");
    });
    actions.appendChild(del);

    li.append(top, badges, flags, tagsInput, dueWrap, recurWrap, actions);

    li.addEventListener("dragstart", (e) => {
      if (e.target.closest("input, button, label, select, textarea, a")) {
        e.preventDefault();
        return;
      }
      dragTaskId = task.id;
      li.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", task.id);
    });
    li.addEventListener("dragend", () => {
      dragTaskId = null;
      li.classList.remove("dragging");
      document.querySelectorAll(".kanban__col.drag-over").forEach((el) =>
        el.classList.remove("drag-over")
      );
    });

    return li;
  }

  function bindColumnDrop(col) {
    const status = col.dataset.status;
    const list = col.querySelector("[data-list]");

    const onDragOver = (e) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      col.classList.add("drag-over");
    };
    const onDragLeave = (e) => {
      if (!col.contains(e.relatedTarget)) {
        col.classList.remove("drag-over");
      }
    };
    const onDrop = (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      const id = e.dataTransfer.getData("text/plain") || dragTaskId;
      if (!id) return;
      const task = findTask(id);
      if (!task) return;
      if (task.status === status) return;
      const spawned = setTaskStatus(task, status);
      persist();
      renderTasks();
      toastStatusChange(status, spawned);
    };

    col.addEventListener("dragover", onDragOver);
    col.addEventListener("dragleave", onDragLeave);
    col.addEventListener("drop", onDrop);
    if (list) {
      list.addEventListener("dragover", onDragOver);
      list.addEventListener("drop", onDrop);
    }
  }

  let columnsBound = false;
  function ensureColumnBindings() {
    if (columnsBound) return;
    els.kanban.querySelectorAll(".kanban__col").forEach(bindColumnDrop);
    columnsBound = true;
  }

  function renderTasks() {
    ensureColumnBindings();
    const tasks = getTodayTasks();
    const today = todayKey();
    const boardTasks = tasks.filter((t) => isDoneVisibleOnBoard(t, today));
    const filtered = boardTasks.filter(passesFilters);

    const openCount = tasks.filter((t) => t.status !== "done").length;
    const hiddenDone = tasks.filter(
      (t) => t.status === "done" && !isDoneVisibleOnBoard(t, today)
    ).length;

    let meta = `尚餘 ${openCount} 項 · 共 ${tasks.length} 項`;
    if (openCount === 0 && tasks.some((t) => t.status === "done")) {
      meta = "全部完成 🎉";
    }
    if (hiddenDone > 0) {
      meta += ` · ${hiddenDone} 項已完成逾 3 日（已隱藏）`;
    }
    els.tasksRemaining.textContent = meta;

    updateFilterTagOptions();
    updateFilterClearBtn();

    els.tasksEmpty.hidden = true;
    els.tasksFilteredEmpty.hidden = true;

    STATUSES.forEach((st) => {
      const col = els.kanban.querySelector(`.kanban__col[data-status="${st}"]`);
      const list = col.querySelector("[data-list]");
      const countEl = col.querySelector("[data-count]");
      list.innerHTML = "";
      const colTasks = filtered
        .filter((t) => t.status === st)
        .slice()
        .sort(sortTasksInColumn);
      countEl.textContent = String(colTasks.length);
      colTasks.forEach((task) => list.appendChild(createTaskCard(task)));
    });

    // WIP soft hint
    const doingCount = boardTasks.filter((t) => t.status === "doing").length;
    if (els.wipHint) {
      if (doingCount > WIP_SOFT_LIMIT) {
        els.wipHint.classList.add("kanban__wip--soft");
        els.wipHint.title = `目前進行中 ${doingCount} 項（建議 ≤ ${WIP_SOFT_LIMIT}）`;
      } else {
        els.wipHint.classList.remove("kanban__wip--soft");
        els.wipHint.title = "建議同時進行不多於 3 項";
      }
    }

    if (tasks.length === 0) {
      els.tasksEmpty.hidden = false;
      return;
    }
    if (filtered.length === 0 && boardTasks.length > 0) {
      els.tasksFilteredEmpty.hidden = false;
    }
  }

  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    getTodayTasks().unshift({
      id: uid(),
      text: trimmed,
      status: "todo",
      done: false,
      important: !!els.taskImportant.checked,
      urgent: !!els.taskUrgent.checked,
      tags: parseTags(els.taskTags.value),
      recurrence: readComposerRecurrence(),
      dueDate: normalizeDueDate(els.taskDueDate && els.taskDueDate.value),
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedDateKey: null,
    });
    els.taskImportant.checked = false;
    els.taskUrgent.checked = false;
    els.taskTags.value = "";
    if (els.taskDueDate) els.taskDueDate.value = "";
    resetComposerRecurrence();
    persist();
    renderTasks();
  }

  function pullForward() {
    const yKey = yesterdayKey();
    const tKey = todayKey();
    const yTasks = state.tasksByDate[yKey] || [];
    const unfinished = yTasks.filter((t) => t.status !== "done" && !t.done);
    if (unfinished.length === 0) {
      toast("昨日沒有未完成任務");
      return;
    }
    if (!state.tasksByDate[tKey]) state.tasksByDate[tKey] = [];
    const existingTexts = new Set(state.tasksByDate[tKey].map((t) => t.text));
    let added = 0;
    unfinished.forEach((t) => {
      if (existingTexts.has(t.text)) return;
      const nt = normalizeTask({
        ...t,
        id: uid(),
        status: t.status === "doing" ? "doing" : "todo",
        done: false,
        completedAt: null,
        completedDateKey: null,
        createdAt: new Date().toISOString(),
        pulledFrom: yKey,
      });
      if (!nt) return;
      state.tasksByDate[tKey].push(nt);
      existingTexts.add(t.text);
      added++;
    });
    persist();
    renderTasks();
    toast(added === 0 ? "昨日未完成項目已存在於今日" : `已帶入 ${added} 項未完成任務`);
  }

  // —— Water reminder ——
  function setWaterPermMsg(text, kind) {
    if (!text) {
      els.waterPermMsg.hidden = true;
      els.waterPermMsg.textContent = "";
      els.waterPermMsg.className = "water-block__note";
      return;
    }
    els.waterPermMsg.hidden = false;
    els.waterPermMsg.textContent = text;
    els.waterPermMsg.className =
      "water-block__note" +
      (kind === "error"
        ? " water-block__note--error"
        : kind === "ok"
          ? " water-block__note--ok"
          : "");
  }

  function updateWaterUI() {
    const w = state.waterReminder;
    els.waterEnabled.checked = !!w.enabled;
    els.waterInterval.value = String(w.intervalMinutes || 60);
    if (!("Notification" in window)) {
      els.waterStatus.textContent = "此瀏覽器不支援通知";
      setWaterPermMsg("目前瀏覽器不支援 Web Notifications，無法顯示系統提醒。", "error");
      return;
    }
    const perm = Notification.permission;
    if (!w.enabled) {
      els.waterStatus.textContent = "關閉中";
    } else if (perm === "denied") {
      els.waterStatus.textContent = "權限被拒";
    } else if (perm === "granted") {
      els.waterStatus.textContent = `每 ${w.intervalMinutes} 分鐘`;
    } else {
      els.waterStatus.textContent = "等待授權";
    }
  }

  async function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return null;
    try {
      const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
      swRegistration = reg;
      return reg;
    } catch (err) {
      console.warn("Service worker registration failed:", err);
      return null;
    }
  }

  async function showWaterNotification(force) {
    if (!("Notification" in window)) {
      setWaterPermMsg("此瀏覽器不支援通知。", "error");
      return false;
    }
    if (Notification.permission !== "granted") {
      setWaterPermMsg("尚未取得通知權限，無法顯示「飲杯水」提醒。", "error");
      return false;
    }

    const now = Date.now();
    const last = state.waterReminder.lastNotifiedAt
      ? Date.parse(state.waterReminder.lastNotifiedAt)
      : 0;
    if (!force && last && now - last < WATER_MIN_GAP_MS) return false;
    if (!force && last) {
      const gap = (state.waterReminder.intervalMinutes || 60) * 60 * 1000;
      if (now - last < gap * 0.9) return false;
    }

    const title = "飲杯水";
    const options = {
      body: "休息一下，喝杯水吧。",
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232d4a3e'/%3E%3Cpath d='M22 18h20l-2 30H24L22 18zm6 8v14m8-14v14' stroke='%23c8e6d8' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
      tag: "daily-work-water",
      renotify: true,
      silent: false,
    };

    try {
      if (swRegistration && swRegistration.showNotification) {
        await swRegistration.showNotification(title, options);
      } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, options);
      } else {
        // eslint-disable-next-line no-new
        new Notification(title, options);
      }
      state.waterReminder.lastNotifiedAt = new Date().toISOString();
      persist();
      return true;
    } catch (err) {
      console.error(err);
      try {
        // eslint-disable-next-line no-new
        new Notification(title, options);
        state.waterReminder.lastNotifiedAt = new Date().toISOString();
        persist();
        return true;
      } catch (err2) {
        console.error(err2);
        setWaterPermMsg("無法顯示通知，請檢查系統通知設定。", "error");
        return false;
      }
    }
  }

  function clearWaterTimer() {
    if (waterTimerId != null) {
      clearInterval(waterTimerId);
      waterTimerId = null;
    }
  }

  function scheduleWaterTimer() {
    clearWaterTimer();
    if (!state.waterReminder.enabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;

    const ms = (state.waterReminder.intervalMinutes || 60) * 60 * 1000;
    waterTimerId = setInterval(() => {
      if (!state.waterReminder.enabled) {
        clearWaterTimer();
        return;
      }
      showWaterNotification(false);
    }, ms);

    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "water-config",
        enabled: true,
        intervalMinutes: state.waterReminder.intervalMinutes,
        lastNotifiedAt: state.waterReminder.lastNotifiedAt,
      });
    }
  }

  async function enableWaterReminder() {
    if (!("Notification" in window)) {
      state.waterReminder.enabled = false;
      persist();
      updateWaterUI();
      setWaterPermMsg("此瀏覽器不支援 Web Notifications。", "error");
      return;
    }

    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }

    if (perm !== "granted") {
      state.waterReminder.enabled = false;
      persist();
      updateWaterUI();
      setWaterPermMsg(
        "通知權限被拒絕。請在瀏覽器網址列或系統設定中允許通知後再啟用。關閉分頁後亦不會再提醒。",
        "error"
      );
      els.waterEnabled.checked = false;
      clearWaterTimer();
      return;
    }

    state.waterReminder.enabled = true;
    persist();
    updateWaterUI();
    setWaterPermMsg(
      "已啟用。分頁開啟或縮到工作列時會依間隔提醒；關閉分頁／瀏覽器後就不會再通知（此站無推播伺服器）。",
      "ok"
    );
    await registerServiceWorker();
    scheduleWaterTimer();
  }

  function disableWaterReminder() {
    state.waterReminder.enabled = false;
    persist();
    clearWaterTimer();
    updateWaterUI();
    setWaterPermMsg("");
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "water-config",
        enabled: false,
      });
    }
  }

  async function onWaterToggle() {
    if (els.waterEnabled.checked) {
      await enableWaterReminder();
    } else {
      disableWaterReminder();
    }
  }

  function onWaterIntervalChange() {
    const val = Number(els.waterInterval.value);
    state.waterReminder.intervalMinutes = WATER_INTERVALS.includes(val) ? val : 60;
    persist();
    updateWaterUI();
    if (state.waterReminder.enabled) scheduleWaterTimer();
  }

  async function onWaterTest() {
    if (!("Notification" in window)) {
      setWaterPermMsg("此瀏覽器不支援通知。", "error");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      setWaterPermMsg("通知權限被拒絕，無法測試。", "error");
      return;
    }
    await registerServiceWorker();
    const ok = await showWaterNotification(true);
    if (ok) toast("已發送測試通知");
  }

  // —— Task / event alerts (Web Notification API; tab must stay open) ——
  let alertTimerId = null;

  function setAlertPermMsg(text, kind) {
    if (!els.alertPermMsg) return;
    if (!text) {
      els.alertPermMsg.hidden = true;
      els.alertPermMsg.textContent = "";
      els.alertPermMsg.className = "water-block__note";
      return;
    }
    els.alertPermMsg.hidden = false;
    els.alertPermMsg.textContent = text;
    els.alertPermMsg.className =
      "water-block__note" +
      (kind === "error"
        ? " water-block__note--error"
        : kind === "ok"
          ? " water-block__note--ok"
          : "");
  }

  function updateAlertsUI() {
    if (!state.alerts) state.alerts = defaultAlerts();
    const a = state.alerts;
    if (els.alertTasksEnabled) els.alertTasksEnabled.checked = !!a.tasksEnabled;
    if (els.alertEventsEnabled) els.alertEventsEnabled.checked = !!a.eventsEnabled;
    if (els.alertEventLead) els.alertEventLead.value = String(a.eventLeadMinutes ?? 15);
    if (!els.alertStatus) return;
    if (!("Notification" in window)) {
      els.alertStatus.textContent = "此瀏覽器不支援通知";
      return;
    }
    const parts = [];
    if (a.tasksEnabled) parts.push("任務");
    if (a.eventsEnabled) parts.push("行程");
    const perm = Notification.permission;
    if (parts.length === 0) {
      els.alertStatus.textContent = "關閉中";
    } else if (perm === "denied") {
      els.alertStatus.textContent = "權限被拒";
    } else if (perm === "granted") {
      els.alertStatus.textContent = `已啟用：${parts.join("、")}`;
    } else {
      els.alertStatus.textContent = "等待授權";
    }
  }

  async function showAppNotification(title, options) {
    if (!("Notification" in window)) return false;
    if (Notification.permission !== "granted") return false;
    const opts = options || {};
    try {
      if (swRegistration && swRegistration.showNotification) {
        await swRegistration.showNotification(title, opts);
      } else if (navigator.serviceWorker && navigator.serviceWorker.ready) {
        const reg = await navigator.serviceWorker.ready;
        await reg.showNotification(title, opts);
      } else {
        // eslint-disable-next-line no-new
        new Notification(title, opts);
      }
      return true;
    } catch (err) {
      console.error(err);
      try {
        // eslint-disable-next-line no-new
        new Notification(title, opts);
        return true;
      } catch (err2) {
        console.error(err2);
        return false;
      }
    }
  }

  function alertStampGet(key) {
    if (!state.alerts) state.alerts = defaultAlerts();
    if (!state.alerts.stamps) state.alerts.stamps = {};
    return state.alerts.stamps[key] || null;
  }

  function alertStampSet(key, value) {
    if (!state.alerts) state.alerts = defaultAlerts();
    if (!state.alerts.stamps) state.alerts.stamps = {};
    state.alerts.stamps[key] = value;
  }

  async function checkTaskAlerts() {
    if (!state.alerts || !state.alerts.tasksEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const today = todayKey();
    let changed = false;
    const icon =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%233d4a6b'/%3E%3Cpath d='M18 34h28M18 24h28M18 44h18' stroke='%23c8d4f0' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E";

    for (const list of Object.values(state.tasksByDate || {})) {
      if (!Array.isArray(list)) continue;
      for (const t of list) {
        if (!t || t.status === "done" || t.done) continue;
        const due = normalizeDueDate(t.dueDate);
        if (!due) continue;
        if (due === today) {
          const key = `task-due:${t.id}`;
          if (alertStampGet(key) === today) continue;
          const ok = await showAppNotification("任務今日到期", {
            body: t.text,
            tag: key,
            renotify: false,
            icon,
          });
          if (ok) {
            alertStampSet(key, today);
            changed = true;
          }
        } else if (due < today) {
          const key = `task-overdue:${t.id}`;
          if (alertStampGet(key) === today) continue;
          const ok = await showAppNotification("任務已逾期", {
            body: `${t.text}（到期 ${due}）`,
            tag: key,
            renotify: false,
            icon,
          });
          if (ok) {
            alertStampSet(key, today);
            changed = true;
          }
        }
      }
    }
    if (changed) persist();
  }

  function eventStartMinutes(ev) {
    if (!ev || !isTime(ev.start)) return null;
    const [h, m] = ev.start.split(":").map(Number);
    return h * 60 + m;
  }

  async function checkEventAlerts() {
    if (!state.alerts || !state.alerts.eventsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const parts = hkParts();
    const today = parts.dateKey;
    const nowMins = Number(parts.hour) * 60 + Number(parts.minute);
    const lead = Number(state.alerts.eventLeadMinutes) || 0;
    let changed = false;
    const icon =
      "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%236b4a3d'/%3E%3Cpath d='M20 22h24v28H20V22zm8-6h8v6h-8V16z' stroke='%23f0dcc8' stroke-width='3' fill='none' stroke-linejoin='round'/%3E%3C/svg%3E";

    for (const ev of state.events || []) {
      if (!ev || ev.date !== today) continue;
      const startMins = eventStartMinutes(ev);
      if (startMins == null) continue;

      if (lead > 0) {
        const leadAt = startMins - lead;
        if (nowMins >= leadAt && nowMins < startMins) {
          const key = `event-lead:${ev.id}:${today}`;
          if (!alertStampGet(key)) {
            const ok = await showAppNotification(`行程 ${lead} 分鐘後開始`, {
              body: `${ev.title}（${ev.start}）`,
              tag: key,
              renotify: false,
              icon,
            });
            if (ok) {
              alertStampSet(key, today);
              changed = true;
            }
          }
        }
      }

      // At start: within a 2-minute window so the minute poll can catch it
      if (nowMins >= startMins && nowMins < startMins + 2) {
        const key = `event-start:${ev.id}:${today}`;
        if (!alertStampGet(key)) {
          const ok = await showAppNotification("行程開始", {
            body: `${ev.title}（${ev.start}–${ev.end || ""}）`,
            tag: key,
            renotify: false,
            icon,
          });
          if (ok) {
            alertStampSet(key, today);
            changed = true;
          }
        }
      }
    }
    if (changed) persist();
  }

  async function runAlertChecks() {
    await checkTaskAlerts();
    await checkEventAlerts();
  }

  function clearAlertTimer() {
    if (alertTimerId != null) {
      clearInterval(alertTimerId);
      alertTimerId = null;
    }
  }

  function scheduleAlertTimer() {
    clearAlertTimer();
    const a = state.alerts || defaultAlerts();
    if (!a.tasksEnabled && !a.eventsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    alertTimerId = setInterval(() => {
      runAlertChecks();
    }, 30 * 1000);
    runAlertChecks();
  }

  async function ensureNotificationPermission() {
    if (!("Notification" in window)) {
      setAlertPermMsg("此瀏覽器不支援 Web Notifications。", "error");
      return false;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }
    if (perm !== "granted") {
      setAlertPermMsg(
        "通知權限被拒絕。請在瀏覽器網址列或系統設定中允許通知後再啟用。關閉分頁後亦不會再提醒。",
        "error"
      );
      return false;
    }
    await registerServiceWorker();
    return true;
  }

  async function onAlertTasksToggle() {
    if (!state.alerts) state.alerts = defaultAlerts();
    if (els.alertTasksEnabled && els.alertTasksEnabled.checked) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        state.alerts.tasksEnabled = false;
        if (els.alertTasksEnabled) els.alertTasksEnabled.checked = false;
        persist();
        updateAlertsUI();
        scheduleAlertTimer();
        return;
      }
      state.alerts.tasksEnabled = true;
      persist();
      updateAlertsUI();
      setAlertPermMsg(
        "已啟用任務提醒。分頁需保持開啟；關閉分頁／瀏覽器後就不會再通知。",
        "ok"
      );
      scheduleAlertTimer();
    } else {
      state.alerts.tasksEnabled = false;
      persist();
      updateAlertsUI();
      scheduleAlertTimer();
      if (!state.alerts.eventsEnabled) setAlertPermMsg("");
    }
  }

  async function onAlertEventsToggle() {
    if (!state.alerts) state.alerts = defaultAlerts();
    if (els.alertEventsEnabled && els.alertEventsEnabled.checked) {
      const ok = await ensureNotificationPermission();
      if (!ok) {
        state.alerts.eventsEnabled = false;
        if (els.alertEventsEnabled) els.alertEventsEnabled.checked = false;
        persist();
        updateAlertsUI();
        scheduleAlertTimer();
        return;
      }
      state.alerts.eventsEnabled = true;
      persist();
      updateAlertsUI();
      setAlertPermMsg(
        "已啟用行程提醒。分頁需保持開啟；關閉分頁／瀏覽器後就不會再通知。",
        "ok"
      );
      scheduleAlertTimer();
    } else {
      state.alerts.eventsEnabled = false;
      persist();
      updateAlertsUI();
      scheduleAlertTimer();
      if (!state.alerts.tasksEnabled) setAlertPermMsg("");
    }
  }

  function onAlertEventLeadChange() {
    if (!state.alerts) state.alerts = defaultAlerts();
    const val = Number(els.alertEventLead && els.alertEventLead.value);
    state.alerts.eventLeadMinutes = val === 0 || val === 15 ? val : 15;
    persist();
    updateAlertsUI();
  }

  // —— Calendar ——
  function renderWeekStrip() {
    const today = todayKey();
    const keys = weekKeysAround(today);
    const first = keys[0];
    const last = keys[6];
    const fmt = (k) => {
      const [, m, d] = k.split("-");
      return `${Number(m)}/${Number(d)}`;
    };
    els.calRange.textContent = `${fmt(first)} – ${fmt(last)}`;

    els.weekStrip.innerHTML = "";
    keys.forEach((key) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "day-chip";
      btn.setAttribute("role", "tab");
      btn.setAttribute("aria-selected", key === selectedDate ? "true" : "false");
      if (key === selectedDate) btn.classList.add("day-chip--selected");
      if (key === today) btn.classList.add("day-chip--today");

      const dow = document.createElement("span");
      dow.className = "day-chip__dow";
      dow.textContent = DOW_ZH[weekdayIndex(key)];

      const num = document.createElement("span");
      num.className = "day-chip__num";
      num.textContent = String(Number(key.split("-")[2]));

      const hasEvents = state.events.some((e) => e.date === key);
      const dot = document.createElement("span");
      dot.className = "day-chip__dot";
      dot.hidden = !hasEvents;
      dot.setAttribute("aria-hidden", "true");

      btn.append(dow, num, dot);
      btn.addEventListener("click", () => {
        selectedDate = key;
        renderWeekStrip();
        renderEvents();
      });
      els.weekStrip.appendChild(btn);
    });
  }

  function eventsForSelected() {
    return state.events
      .filter((e) => e.date === selectedDate)
      .sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  }

  function renderEvents() {
    const events = eventsForSelected();
    els.eventList.innerHTML = "";
    if (events.length === 0) {
      els.eventsEmpty.hidden = false;
      return;
    }
    els.eventsEmpty.hidden = true;

    events.forEach((ev) => {
      const li = document.createElement("li");
      li.className = "event-item";

      const time = document.createElement("div");
      time.className = "event-item__time";
      time.textContent = `${ev.start}\n${ev.end}`;

      const body = document.createElement("div");
      const title = document.createElement("p");
      title.className = "event-item__title";
      title.textContent = ev.title;
      body.appendChild(title);
      if (ev.notes) {
        const notes = document.createElement("p");
        notes.className = "event-item__notes";
        notes.textContent = ev.notes;
        body.appendChild(notes);
      }

      const actions = document.createElement("div");
      actions.className = "event-item__actions";

      const toTask = document.createElement("button");
      toTask.type = "button";
      toTask.className = "btn btn--tiny btn--ghost";
      toTask.textContent = "轉成任務";
      toTask.title = "建立待辦任務，到期日為行程日期";
      toTask.addEventListener("click", () => convertEventToTask(ev));

      const edit = document.createElement("button");
      edit.type = "button";
      edit.className = "btn btn--tiny btn--ghost";
      edit.textContent = "編輯";
      edit.addEventListener("click", () => openEventModal(ev));

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--tiny btn--ghost";
      del.textContent = "刪";
      del.addEventListener("click", () => {
        state.events = state.events.filter((e) => e.id !== ev.id);
        persist();
        renderWeekStrip();
        renderEvents();
        toast("已刪除行程");
      });

      actions.append(toTask, edit, del);
      li.append(time, body, actions);
      els.eventList.appendChild(li);
    });
  }

  function convertEventToTask(ev) {
    if (!ev || typeof ev.title !== "string" || !ev.title.trim()) return;
    const due = normalizeDueDate(ev.date) || selectedDate || todayKey();
    const task = {
      id: uid(),
      text: ev.title.trim().slice(0, 200),
      status: "todo",
      done: false,
      important: false,
      urgent: false,
      tags: [],
      recurrence: { type: "none", weekdays: [] },
      dueDate: due,
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedDateKey: null,
    };
    getTodayTasks().unshift(task);
    persist();
    renderTasks();
    const jump = confirm(
      `已建立待辦「${task.text}」（到期 ${due}）。\n要跳到「任務」分頁嗎？\n（取消則留在行程）`
    );
    if (jump) setActiveTab("tasks");
    else toast("已轉成任務（留在行程）");
  }

  function openEventModal(ev) {
    const isEdit = !!ev;
    els.eventModalTitle.textContent = isEdit ? "編輯行程" : "新增行程";
    els.eventId.value = isEdit ? ev.id : "";
    els.eventTitle.value = isEdit ? ev.title : "";
    els.eventDate.value = isEdit ? ev.date : selectedDate;
    els.eventStart.value = isEdit ? ev.start : "09:00";
    els.eventEnd.value = isEdit ? ev.end : "10:00";
    els.eventNotes.value = isEdit ? ev.notes || "" : "";
    if (typeof els.eventModal.showModal === "function") {
      els.eventModal.showModal();
    } else {
      els.eventModal.setAttribute("open", "");
    }
    setTimeout(() => els.eventTitle.focus(), 50);
  }

  function closeEventModal() {
    if (typeof els.eventModal.close === "function") {
      els.eventModal.close();
    } else {
      els.eventModal.removeAttribute("open");
    }
  }

  function saveEventFromForm(e) {
    e.preventDefault();
    const title = els.eventTitle.value.trim();
    const date = els.eventDate.value;
    const start = els.eventStart.value;
    const end = els.eventEnd.value;
    const notes = els.eventNotes.value.trim();
    if (!title || !date || !start || !end) return;
    if (end < start) {
      toast("結束時間不可早於開始時間");
      return;
    }
    const id = els.eventId.value;
    if (id) {
      const existing = state.events.find((ev) => ev.id === id);
      if (existing) {
        existing.title = title;
        existing.date = date;
        existing.start = start;
        existing.end = end;
        existing.notes = notes;
      }
      toast("已更新行程");
    } else {
      state.events.push({ id: uid(), title, date, start, end, notes });
      toast("已新增行程");
    }
    selectedDate = date;
    persist();
    closeEventModal();
    renderWeekStrip();
    renderEvents();
  }

  // —— Notes ——
  let scratchSaveTimer = null;

  function renderNotes() {
    els.scratchPad.value = state.scratch || "";
    els.noteList.innerHTML = "";
    const notes = state.notes.slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    if (notes.length === 0) {
      els.notesEmpty.hidden = false;
      return;
    }
    els.notesEmpty.hidden = true;
    notes.forEach((note) => {
      const li = document.createElement("li");
      li.className = "note-item";
      const main = document.createElement("div");
      const body = document.createElement("p");
      body.className = "note-item__body";
      body.textContent = note.body;
      const meta = document.createElement("p");
      meta.className = "note-item__meta";
      meta.textContent = formatNoteTime(note.createdAt);
      main.append(body, meta);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--tiny btn--ghost";
      del.textContent = "刪";
      del.addEventListener("click", () => {
        state.notes = state.notes.filter((n) => n.id !== note.id);
        persist();
        renderNotes();
        toast("已刪除筆記");
      });

      li.append(main, del);
      els.noteList.appendChild(li);
    });
  }

  function saveScratchSoon() {
    state.scratch = els.scratchPad.value;
    els.scratchHint.textContent = "儲存中…";
    clearTimeout(scratchSaveTimer);
    scratchSaveTimer = setTimeout(() => {
      persist();
      els.scratchHint.textContent = "已自動儲存";
    }, 400);
  }

  function saveScratchAsNote() {
    const body = (els.scratchPad.value || "").trim();
    if (!body) {
      toast("草稿是空的");
      return;
    }
    state.notes.unshift({
      id: uid(),
      body,
      createdAt: new Date().toISOString(),
    });
    state.scratch = "";
    els.scratchPad.value = "";
    persist();
    renderNotes();
    toast("已存成筆記");
  }

  function addQuickNote(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    state.notes.unshift({
      id: uid(),
      body: trimmed,
      createdAt: new Date().toISOString(),
    });
    persist();
    renderNotes();
  }


  // —— Theme (localStorage only; not in JSON export) ——
  function getStoredTheme() {
    try {
      const t = localStorage.getItem(THEME_KEY);
      if (t === "dark" || t === "light") return t;
    } catch {
      /* ignore */
    }
    return null;
  }

  function systemPrefersDark() {
    try {
      return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
      return false;
    }
  }

  function resolveTheme() {
    const stored = getStoredTheme();
    if (stored) return stored;
    return systemPrefersDark() ? "dark" : "light";
  }

  function applyTheme(theme) {
    const dark = theme === "dark";
    document.documentElement.classList.toggle("theme-dark", dark);
    if (els.btnThemeToggle) {
      els.btnThemeToggle.setAttribute("aria-pressed", dark ? "true" : "false");
      els.btnThemeToggle.title = dark ? "切換為淺色模式" : "切換為深色模式";
    }
    if (els.themeToggleLabel) {
      els.themeToggleLabel.textContent = dark ? "淺色" : "深色";
    }
  }

  function persistTheme(theme) {
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      /* ignore */
    }
  }

  function toggleTheme() {
    const next = resolveTheme() === "dark" ? "light" : "dark";
    persistTheme(next);
    applyTheme(next);
  }

  function initTheme() {
    applyTheme(resolveTheme());
    try {
      const mq = window.matchMedia("(prefers-color-scheme: dark)");
      const onChange = () => {
        if (getStoredTheme() == null) applyTheme(resolveTheme());
      };
      if (mq.addEventListener) mq.addEventListener("change", onChange);
      else if (mq.addListener) mq.addListener(onChange);
    } catch {
      /* ignore */
    }
  }

  // —— Global search (not persisted in export) ——
  function normalizeSearch(s) {
    return String(s || "").toLowerCase();
  }

  function includesQuery(hay, q) {
    if (!q) return false;
    return normalizeSearch(hay).includes(q);
  }

  function collectSearchResults(rawQuery) {
    const q = normalizeSearch(rawQuery.trim());
    if (!q) return [];
    const results = [];
    const today = todayKey();

    // Tasks: all dates (visible titles)
    const dateKeys = Object.keys(state.tasksByDate || {}).sort().reverse();
    for (const dk of dateKeys) {
      const list = state.tasksByDate[dk] || [];
      for (const t of list) {
        if (!t || !t.text) continue;
        if (!includesQuery(t.text, q)) continue;
        results.push({
          kind: "task",
          id: t.id,
          dateKey: dk,
          title: t.text,
          snippet: dk === today ? "今日任務" : `任務 · ${dk}`,
        });
        if (results.length >= 40) return results;
      }
    }

    for (const e of state.events || []) {
      if (!e) continue;
      const hitTitle = includesQuery(e.title, q);
      const hitNotes = includesQuery(e.notes, q);
      if (!hitTitle && !hitNotes) continue;
      results.push({
        kind: "event",
        id: e.id,
        dateKey: e.date,
        title: e.title,
        snippet: hitNotes && !hitTitle ? String(e.notes).slice(0, 80) : `${e.date} ${e.start || ""}`.trim(),
      });
      if (results.length >= 40) return results;
    }

    if (includesQuery(state.scratch, q)) {
      results.push({
        kind: "scratch",
        id: "scratch",
        title: "草稿",
        snippet: String(state.scratch).replace(/\s+/g, " ").trim().slice(0, 80),
      });
    }

    for (const n of state.notes || []) {
      if (!n || !n.body) continue;
      if (!includesQuery(n.body, q)) continue;
      results.push({
        kind: "note",
        id: n.id,
        title: String(n.body).replace(/\s+/g, " ").trim().slice(0, 60),
        snippet: formatNoteTime(n.createdAt) || "筆記",
      });
      if (results.length >= 40) return results;
    }

    return results;
  }

  function hideSearchResults() {
    if (!els.searchResults) return;
    els.searchResults.hidden = true;
    els.searchResults.innerHTML = "";
  }

  function renderSearchResults(rawQuery) {
    if (!els.searchResults) return;
    const q = rawQuery.trim();
    searchQuery = q;
    if (!q) {
      hideSearchResults();
      if (searchFocusTaskId) {
        clearSearchFocus();
        renderTasks();
      }
      return;
    }
    const results = collectSearchResults(q);
    els.searchResults.innerHTML = "";
    els.searchResults.hidden = false;
    if (results.length === 0) {
      const empty = document.createElement("div");
      empty.className = "search-results__empty";
      empty.textContent = "找不到相符項目";
      els.searchResults.appendChild(empty);
      return;
    }
    const kindLabel = { task: "任務", event: "行程", note: "筆記", scratch: "草稿" };
    results.forEach((r) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "search-results__item";
      btn.setAttribute("role", "option");
      const kind = document.createElement("span");
      kind.className = "search-results__kind";
      kind.textContent = kindLabel[r.kind] || "";
      const title = document.createElement("span");
      title.className = "search-results__title";
      title.textContent = r.title;
      btn.append(kind, title);
      if (r.snippet) {
        const sn = document.createElement("span");
        sn.className = "search-results__snippet";
        sn.textContent = r.snippet;
        btn.appendChild(sn);
      }
      btn.addEventListener("click", () => {
        applySearchJump(r);
      });
      els.searchResults.appendChild(btn);
    });
  }

  function applySearchJump(r) {
    hideSearchResults();
    if (r.kind === "task") {
      setActiveTab("tasks");
      // If task is on another day, still focus if present today; otherwise jump tab only
      const todayList = getTodayTasks();
      const onToday = todayList.some((t) => t.id === r.id);
      if (onToday) {
        searchFocusTaskId = r.id;
      } else if (r.dateKey && state.tasksByDate[r.dateKey]) {
        // Show toast for non-today tasks; pull focus only when on today board
        searchFocusTaskId = null;
        toast(`該任務在 ${r.dateKey}（看板只顯示今日）`);
      } else {
        searchFocusTaskId = r.id;
      }
      updateFilterClearBtn();
      renderTasks();
      const card =
        els.kanban &&
        Array.from(els.kanban.querySelectorAll(".task-card")).find((el) => el.dataset.id === r.id);
      if (card) card.scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    if (r.kind === "event") {
      clearSearchFocus();
      renderTasks();
      if (r.dateKey) selectedDate = r.dateKey;
      setActiveTab("calendar");
      renderWeekStrip();
      renderEvents();
      return;
    }
    if (r.kind === "note" || r.kind === "scratch") {
      clearSearchFocus();
      renderTasks();
      setActiveTab("notes");
      renderNotes();
      if (r.kind === "scratch" && els.scratchPad) {
        els.scratchPad.focus();
      }
      return;
    }
  }

  function onGlobalSearchInput() {
    const q = els.globalSearch ? els.globalSearch.value : "";
    if (!q.trim()) {
      searchQuery = "";
      hideSearchResults();
      if (searchFocusTaskId) {
        clearSearchFocus();
        renderTasks();
      }
      return;
    }
    renderSearchResults(q);
  }

  // —— Export / Import ——
  function buildExportPayload() {
    return {
      version: EXPORT_VERSION,
      app: "daily-workbench",
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      data: {
        version: DATA_VERSION,
        seeded: !!state.seeded,
        tasksByDate: state.tasksByDate || {},
        events: Array.isArray(state.events) ? state.events : [],
        scratch: typeof state.scratch === "string" ? state.scratch : "",
        notes: Array.isArray(state.notes) ? state.notes : [],
        waterReminder: normalizeWater(state.waterReminder),
        alerts: normalizeAlerts(state.alerts),
      },
    };
  }

  function exportJson() {
    try {
      const payload = buildExportPayload();
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-work-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("已匯出 JSON");
    } catch (err) {
      console.error(err);
      toast("匯出失敗，請稍後再試");
    }
  }

  function isTime(s) {
    return typeof s === "string" && /^\d{2}:\d{2}$/.test(s);
  }

  function normalizeImportedData(raw) {
    let envelope = raw;
    let data = raw;

    if (raw && typeof raw === "object" && raw.data && typeof raw.data === "object") {
      envelope = raw;
      data = raw.data;
    }

    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("檔案格式不正確：缺少工作台資料物件。");
    }

    const tasksByDate = data.tasksByDate;
    if (tasksByDate == null || typeof tasksByDate !== "object" || Array.isArray(tasksByDate)) {
      throw new Error("檔案格式不正確：tasksByDate 必須為物件。");
    }

    const normalizedTasks = {};
    for (const [dateKey, list] of Object.entries(tasksByDate)) {
      if (!isDateKey(dateKey)) {
        throw new Error(`任務日期鍵無效：${dateKey}`);
      }
      if (!Array.isArray(list)) {
        throw new Error(`日期 ${dateKey} 的任務必須為陣列。`);
      }
      normalizedTasks[dateKey] = list.map((t, i) => {
        const nt = normalizeTask(t);
        if (!nt) {
          throw new Error(`日期 ${dateKey} 第 ${i + 1} 項任務無效。`);
        }
        return nt;
      });
    }

    if (!Array.isArray(data.events)) {
      throw new Error("檔案格式不正確：events 必須為陣列。");
    }
    const events = data.events.map((e, i) => {
      if (!e || typeof e !== "object") {
        throw new Error(`第 ${i + 1} 項行程無效。`);
      }
      if (typeof e.title !== "string" || !e.title.trim()) {
        throw new Error(`第 ${i + 1} 項行程缺少標題。`);
      }
      if (!isDateKey(e.date)) {
        throw new Error(`第 ${i + 1} 項行程日期無效。`);
      }
      if (!isTime(e.start) || !isTime(e.end)) {
        throw new Error(`第 ${i + 1} 項行程時間格式應為 HH:MM。`);
      }
      return {
        id: typeof e.id === "string" && e.id ? e.id : uid(),
        title: e.title.trim().slice(0, 120),
        date: e.date,
        start: e.start,
        end: e.end,
        notes: typeof e.notes === "string" ? e.notes.slice(0, 300) : "",
      };
    });

    if (!Array.isArray(data.notes)) {
      throw new Error("檔案格式不正確：notes 必須為陣列。");
    }
    const notes = data.notes.map((n, i) => {
      if (!n || typeof n !== "object") {
        throw new Error(`第 ${i + 1} 則筆記無效。`);
      }
      if (typeof n.body !== "string" || !n.body.trim()) {
        throw new Error(`第 ${i + 1} 則筆記內容空白。`);
      }
      return {
        id: typeof n.id === "string" && n.id ? n.id : uid(),
        body: n.body.trim().slice(0, 5000),
        createdAt: typeof n.createdAt === "string" ? n.createdAt : new Date().toISOString(),
      };
    });

    const scratch = typeof data.scratch === "string" ? data.scratch : "";
    // Ignore leftover habits from old exports
    const waterReminder = normalizeWater(data.waterReminder);
    const alerts = normalizeAlerts(data.alerts);

    return {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: normalizedTasks,
      events,
      scratch,
      notes,
      waterReminder,
      alerts,
      _envelopeVersion: envelope && envelope.version != null ? envelope.version : null,
      _exportedAt: envelope && typeof envelope.exportedAt === "string" ? envelope.exportedAt : null,
    };
  }

  const IMPORT_REPLACE_CONFIRM =
    "匯入會「取代」目前本機所有工作台資料（任務、行程、筆記、草稿、飲水／任務／行程提醒設定）。\n確定繼續？";

  function confirmReplaceImport() {
    return confirm(IMPORT_REPLACE_CONFIRM);
  }

  function applyImportedState(normalized) {
    clearWaterTimer();
    clearAlertTimer();
    state = {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: normalized.tasksByDate,
      events: normalized.events,
      scratch: normalized.scratch,
      notes: normalized.notes,
      waterReminder: normalized.waterReminder,
      alerts: normalizeAlerts(normalized.alerts),
    };
    persist();
    selectedDate = todayKey();
    filterTag = "all";
    filterEisen = "all";
    searchFocusTaskId = null;
    searchQuery = "";
    if (els.globalSearch) els.globalSearch.value = "";
    hideSearchResults();
    els.filterEisen.value = "all";
    renderAll();
    if (state.waterReminder.enabled) {
      enableWaterReminder();
    } else {
      updateWaterUI();
    }
    updateAlertsUI();
    scheduleAlertTimer();
  }

  function toastImportSuccess(normalized) {
    const when = normalized._exportedAt
      ? `（備份時間：${formatNoteTime(normalized._exportedAt)}）`
      : "";
    toast(`匯入成功${when}`);
  }

  function getServerConfig() {
    const raw = (typeof window !== "undefined" && window.DAILY_WORK_SERVER) || {};
    const host = String(raw.host != null ? raw.host : "127.0.0.1").trim() || "127.0.0.1";
    const portNum = Number(raw.port);
    const port = Number.isFinite(portNum) && portNum > 0 ? portNum : 8787;
    let path = String(raw.path != null ? raw.path : "/api/data").trim() || "/api/data";
    if (!path.startsWith("/")) path = `/${path}`;
    path = path.replace(/\/+$/, "") || "/api/data";
    return { host, port, path };
  }

  function getServerOrigin() {
    const { host, port } = getServerConfig();
    return `http://${host}:${port}`;
  }

  function getServerApiUrl() {
    const { path } = getServerConfig();
    return `${getServerOrigin()}${path}`;
  }

  function statusLabel(res) {
    const text = (res && res.statusText ? String(res.statusText) : "").trim();
    return text ? `${res.status} ${text}` : String(res.status);
  }

  function toastNetworkFail() {
    const origin = getServerOrigin();
    toast(`連接失敗：本機伺服器未開或無法連上。請確認已執行 server.ps1，並用瀏覽器開啟 ${origin}/ 。`);
  }

  function warnMixedContent() {
    const origin = getServerOrigin();
    if (window.location.protocol === "https:" && origin.startsWith("http:")) {
      toast(`無法由 HTTPS 頁面連接本機 HTTP 伺服器（混合內容被阻擋）。請改用 ${origin}/ 開啟工作台。`);
      return true;
    }
    return false;
  }

  async function importFromServer() {
    if (warnMixedContent()) return;
    const url = getServerApiUrl();
    let res;
    try {
      res = await fetch(url, {
        method: "GET",
        mode: "cors",
        credentials: "omit",
        headers: { Accept: "application/json" },
      });
    } catch (err) {
      console.error(err);
      toastNetworkFail();
      return;
    }
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        if (errBody && errBody.error) detail = `：${errBody.error}`;
      } catch {
        /* ignore */
      }
      toast(`從伺服器載入失敗（${statusLabel(res)}）${detail}`);
      return;
    }
    let parsed;
    try {
      parsed = await res.json();
    } catch {
      toast(`從伺服器載入失敗（${statusLabel(res)}）：回傳不是有效的 JSON`);
      return;
    }
    try {
      const normalized = normalizeImportedData(parsed);
      if (!confirmReplaceImport()) {
        toast("已取消匯入");
        return;
      }
      applyImportedState(normalized);
      const when = normalized._exportedAt
        ? `（備份時間：${formatNoteTime(normalized._exportedAt)}）`
        : "";
      toast(`已從伺服器載入（${statusLabel(res)}）${when}`);
    } catch (err) {
      console.error(err);
      toast(err && err.message ? err.message : "匯入失敗：檔案格式不正確");
    }
  }

  async function exportToServer() {
    if (warnMixedContent()) return;
    const url = getServerApiUrl();
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildExportPayload()),
      });
    } catch (err) {
      console.error(err);
      toastNetworkFail();
      return;
    }
    if (!res.ok) {
      let detail = "";
      try {
        const errBody = await res.json();
        if (errBody && errBody.error) detail = `：${errBody.error}`;
      } catch {
        /* ignore */
      }
      toast(`儲存到伺服器失敗（${statusLabel(res)}）${detail}`);
      return;
    }
    toast(`已儲存到伺服器（${statusLabel(res)}）`);
  }

  function updateServerHint() {
    if (!els.serverUrlHint) return;
    els.serverUrlHint.textContent = getServerApiUrl();
  }

  function importJsonFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast("無法讀取檔案");
    reader.onload = () => {
      try {
        let parsed;
        try {
          parsed = JSON.parse(String(reader.result || ""));
        } catch {
          throw new Error("不是有效的 JSON 檔。");
        }
        const normalized = normalizeImportedData(parsed);
        if (!confirmReplaceImport()) {
          toast("已取消匯入");
          return;
        }
        applyImportedState(normalized);
        toastImportSuccess(normalized);
      } catch (err) {
        console.error(err);
        toast(err && err.message ? err.message : "匯入失敗：檔案格式不正確");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  }

  function wipeSeedData() {
    if (!confirm("確定清除所有本機資料（含示範內容）並重新開始？")) return;
    clearWaterTimer();
    clearAlertTimer();
    localStorage.removeItem(STORAGE_KEY);
    state = {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: {},
      events: [],
      scratch: "",
      notes: [],
      waterReminder: defaultWater(),
      alerts: defaultAlerts(),
    };
    persist();
    selectedDate = todayKey();
    filterTag = "all";
    filterEisen = "all";
    searchFocusTaskId = null;
    searchQuery = "";
    if (els.globalSearch) els.globalSearch.value = "";
    hideSearchResults();
    els.filterEisen.value = "all";
    renderAll();
    updateWaterUI();
    setWaterPermMsg("");
    updateAlertsUI();
    setAlertPermMsg("");
    toast("已清除所有資料");
  }

  function renderAll() {
    els.headerDate.textContent = formatHeaderDate(todayKey());
    setActiveTab(activeTab, { silent: true });
    renderTasks();
    renderWeekStrip();
    renderEvents();
    renderNotes();
    updateWaterUI();
    updateAlertsUI();
    updateWeatherImportUI();
    updateWeatherPinUI();
    updateWeatherFallbackVisibility();
  }


  // —— Weather (HKO nowcast CSV + CSDI map + pin alerts) ——
  let weatherGrid = loadWeatherGrid();
  let weatherSettings = loadWeatherSettings();
  let weatherMap = null;
  let weatherLayer = null;
  let weatherPinMarker = null;
  let csdiPoints = [];
  let weatherBootstrapped = false;
  let weatherAlertTimerId = null;
  let rhrCache = null;

  function defaultWeatherSettings() {
    return {
      pin: null,
      thresholdMm: 1,
      alertsEnabled: false,
      lastAlertKey: null,
      lastAlertAt: null,
      selectedDistrict: "沙田",
    };
  }

  function loadWeatherSettings() {
    try {
      const raw = localStorage.getItem(WEATHER_SETTINGS_KEY);
      if (!raw) return defaultWeatherSettings();
      const o = JSON.parse(raw);
      const base = defaultWeatherSettings();
      if (!o || typeof o !== "object") return base;
      const thr = Number(o.thresholdMm);
      base.thresholdMm = Number.isFinite(thr) && thr > 0 ? thr : 1;
      base.alertsEnabled = !!o.alertsEnabled;
      base.lastAlertKey = typeof o.lastAlertKey === "string" ? o.lastAlertKey : null;
      base.lastAlertAt = typeof o.lastAlertAt === "string" ? o.lastAlertAt : null;
      if (typeof o.selectedDistrict === "string" && o.selectedDistrict) {
        base.selectedDistrict = o.selectedDistrict;
      }
      if (o.pin && typeof o.pin === "object") {
        if (o.pin.type === "cell" && Number.isFinite(o.pin.lat) && Number.isFinite(o.pin.lon)) {
          base.pin = {
            type: "cell",
            lat: Number(o.pin.lat),
            lon: Number(o.pin.lon),
            objectId: o.pin.objectId != null ? o.pin.objectId : null,
          };
        } else if (o.pin.type === "district" && typeof o.pin.place === "string") {
          base.pin = { type: "district", place: o.pin.place };
        }
      }
      return base;
    } catch {
      return defaultWeatherSettings();
    }
  }

  function persistWeatherSettings() {
    try {
      localStorage.setItem(WEATHER_SETTINGS_KEY, JSON.stringify(weatherSettings));
    } catch (err) {
      console.error(err);
      toast("無法儲存天氣設定（localStorage 可能已滿）");
    }
  }

  function loadWeatherGrid() {
    try {
      const raw = localStorage.getItem(WEATHER_GRID_KEY);
      if (!raw) return null;
      const o = JSON.parse(raw);
      if (!o || typeof o !== "object" || !o.cells || typeof o.cells !== "object") return null;
      return o;
    } catch {
      return null;
    }
  }

  function persistWeatherGrid() {
    try {
      if (!weatherGrid) {
        localStorage.removeItem(WEATHER_GRID_KEY);
        return;
      }
      localStorage.setItem(WEATHER_GRID_KEY, JSON.stringify(weatherGrid));
    } catch (err) {
      console.error(err);
      toast("無法儲存降雨網格（檔案可能太大或空間不足）");
    }
  }

  function cellKey(lat, lon) {
    return `${Number(lat).toFixed(3)},${Number(lon).toFixed(3)}`;
  }

  function parseHkoDateTime(s) {
    if (typeof s !== "string" || !/^\d{12}$/.test(s)) return null;
    const y = Number(s.slice(0, 4));
    const m = Number(s.slice(4, 6));
    const d = Number(s.slice(6, 8));
    const hh = Number(s.slice(8, 10));
    const mm = Number(s.slice(10, 12));
    // Interpret as Hong Kong local wall time (UTC+8, no DST)
    return new Date(Date.UTC(y, m - 1, d, hh - 8, mm, 0));
  }

  function formatHkoDateTime(s) {
    const dt = parseHkoDateTime(s);
    if (!dt) return s || "—";
    return new Intl.DateTimeFormat("zh-HK", {
      timeZone: TZ,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(dt);
  }

  function rainColor(mm) {
    const v = Number(mm) || 0;
    if (v <= 0) return "#dce8e2";
    if (v < 1) return "#9fd4ff";
    if (v < 5) return "#4fc3f7";
    if (v < 10) return "#ffd54f";
    if (v < 20) return "#ff9800";
    if (v < 40) return "#e53935";
    return "#6a1b9a";
  }

  function setWeatherImportMsg(text, kind) {
    if (!els.weatherImportMsg) return;
    if (!text) {
      els.weatherImportMsg.hidden = true;
      els.weatherImportMsg.textContent = "";
      els.weatherImportMsg.className = "weather-block__note";
      return;
    }
    els.weatherImportMsg.hidden = false;
    els.weatherImportMsg.textContent = text;
    els.weatherImportMsg.className =
      "weather-block__note" +
      (kind === "error" ? " weather-block__note--error" : kind === "ok" ? " weather-block__note--ok" : "");
  }

  function setWeatherPinMsg(text, kind) {
    if (!els.weatherPinMsg) return;
    if (!text) {
      els.weatherPinMsg.hidden = true;
      els.weatherPinMsg.textContent = "";
      els.weatherPinMsg.className = "weather-block__note";
      return;
    }
    els.weatherPinMsg.hidden = false;
    els.weatherPinMsg.textContent = text;
    els.weatherPinMsg.className =
      "weather-block__note" +
      (kind === "error" ? " weather-block__note--error" : kind === "ok" ? " weather-block__note--ok" : "");
  }

  function updateWeatherImportUI() {
    if (!els.weatherImportStatus) return;
    if (!weatherGrid || !weatherGrid.updateTime) {
      els.weatherImportStatus.textContent = "尚未匯入";
      if (els.weatherImportMeta) {
        els.weatherImportMeta.textContent =
          "支援 HKO 五欄：更新時間、完結時間、緯度、經度、半小時臨近雨量 (mm)。匯入後只保留同 CSDI 網格點對應嘅資料，存於 localStorage。";
      }
      return;
    }
    const importedAt = weatherGrid.importedAt
      ? formatNoteTime(weatherGrid.importedAt)
      : "—";
    const n = weatherGrid.cells ? Object.keys(weatherGrid.cells).length : 0;
    els.weatherImportStatus.textContent = `已匯入 · ${n} 點`;
    if (els.weatherImportMeta) {
      els.weatherImportMeta.textContent =
        `資料更新：${formatHkoDateTime(weatherGrid.updateTime)}（香港時間）· 上次匯入：${importedAt}` +
        (weatherGrid.fileName ? ` · 檔案：${weatherGrid.fileName}` : "");
    }
    const upd = parseHkoDateTime(weatherGrid.updateTime);
    if (upd && Date.now() - upd.getTime() > WEATHER_STALE_MS) {
      setWeatherImportMsg(
        "匯入嘅臨近預報已超過約 20 分鐘，建議重新下載最新 CSV 再匯入。",
        "error"
      );
    }
  }

  function updateWeatherFallbackVisibility() {
    const noCsv = !weatherGrid || !weatherGrid.cells || !Object.keys(weatherGrid.cells).length;
    if (els.weatherOmBanner) els.weatherOmBanner.hidden = !noCsv;
    if (els.weatherOmStatus) {
      els.weatherOmStatus.textContent = noCsv
        ? "未匯入 CSV — 可選用粗略後備"
        : "已有 HKO CSV — 後備僅供參考，唔會當成臨近預報";
    }
  }

  function resolvePinLatLon() {
    const pin = weatherSettings.pin;
    if (!pin) return null;
    if (pin.type === "cell") return { lat: pin.lat, lon: pin.lon, label: `${pin.lat.toFixed(3)}, ${pin.lon.toFixed(3)}` };
    if (pin.type === "district") {
      const d = HK_DISTRICTS.find((x) => x.place === pin.place);
      if (!d) return null;
      return { lat: d.lat, lon: d.lon, label: pin.place };
    }
    return null;
  }

  function lookupRainAt(lat, lon) {
    if (!weatherGrid || !weatherGrid.cells) return null;
    const exact = weatherGrid.cells[cellKey(lat, lon)];
    if (exact) return exact;
    // nearest among stored cells
    let best = null;
    let bestD = Infinity;
    for (const c of Object.values(weatherGrid.cells)) {
      const d = (c.lat - lat) * (c.lat - lat) + (c.lon - lon) * (c.lon - lon);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best && Math.sqrt(bestD) <= 0.025) return best;
    return null;
  }

  function updateWeatherPinUI() {
    if (!els.weatherPinStatus) return;
    if (els.weatherAlertEnabled) els.weatherAlertEnabled.checked = !!weatherSettings.alertsEnabled;
    if (els.weatherThreshold) els.weatherThreshold.value = String(weatherSettings.thresholdMm);
    if (els.weatherPinDistrict) {
      const place =
        weatherSettings.pin && weatherSettings.pin.type === "district"
          ? weatherSettings.pin.place
          : "";
      els.weatherPinDistrict.value = place;
    }
    const resolved = resolvePinLatLon();
    if (!resolved) {
      els.weatherPinStatus.textContent = "未釘選";
      return;
    }
    const rain = lookupRainAt(resolved.lat, resolved.lon);
    const sum = rain ? rain.sum2h : null;
    const sumTxt = sum == null ? "無匯入資料" : `${sum.toFixed(1)} mm／2h`;
    els.weatherPinStatus.textContent = `釘選：${resolved.label} · ${sumTxt}`;
  }

  function parseNowcastCsvText(text) {
    const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
    if (lines.length < 2) throw new Error("CSV 空白或只有表頭。");
    const header = lines[0].split(",").map((h) => h.trim());
    // Accept positional 5 columns; also tolerate known English headers
    if (header.length < 5) throw new Error("CSV 欄位數不足（需要 5 欄）。");

    const byPoint = new Map();
    let updateTime = null;
    let rowCount = 0;
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",");
      if (cols.length < 5) continue;
      const upd = cols[0].trim();
      const end = cols[1].trim();
      const lat = Number(cols[2]);
      const lon = Number(cols[3]);
      const mm = Number(cols[4]);
      if (!/^\d{12}$/.test(upd) || !/^\d{12}$/.test(end)) continue;
      if (!Number.isFinite(lat) || !Number.isFinite(lon) || !Number.isFinite(mm)) continue;
      if (updateTime == null) updateTime = upd;
      else if (upd !== updateTime) {
        // keep first update batch; ignore mixed
      }
      if (upd !== updateTime) continue;
      rowCount++;
      const key = cellKey(lat, lon);
      let cell = byPoint.get(key);
      if (!cell) {
        cell = { lat: Number(lat.toFixed(3)), lon: Number(lon.toFixed(3)), slots: {}, sum2h: 0 };
        byPoint.set(key, cell);
      }
      cell.slots[end] = mm;
    }
    if (!updateTime || byPoint.size === 0) {
      throw new Error("無法解析有效資料列。請確認係天文台 Gridded_rainfall_nowcast CSV。");
    }
    // finalize sums
    for (const cell of byPoint.values()) {
      cell.sum2h = Object.values(cell.slots).reduce((a, b) => a + b, 0);
    }
    return { updateTime, byPoint, rowCount };
  }

  function matchCsdiToParsed(byPoint) {
    const cells = {};
    let matched = 0;
    const points = csdiPoints.length ? csdiPoints : [];
    const list = points.length
      ? points
      : Array.from(byPoint.values()).filter(
          (c) => c.lat >= 22.1 && c.lat <= 22.6 && c.lon >= 113.8 && c.lon <= 114.5
        );

    // Spatial buckets (~0.02°) for nearest-neighbour fallback
    const bucket = new Map();
    const bKey = (la, lo) => `${Math.round(la * 50)},${Math.round(lo * 50)}`;
    for (const c of byPoint.values()) {
      const k = bKey(c.lat, c.lon);
      if (!bucket.has(k)) bucket.set(k, []);
      bucket.get(k).push(c);
    }

    for (const p of list) {
      const lat = p.lat;
      const lon = p.lon;
      let hit = byPoint.get(cellKey(lat, lon));
      if (!hit) {
        let best = null;
        let bestD = Infinity;
        const br = Math.round(lat * 50);
        const bc = Math.round(lon * 50);
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const arr = bucket.get(`${br + dr},${bc + dc}`);
            if (!arr) continue;
            for (const c of arr) {
              const d = (c.lat - lat) * (c.lat - lat) + (c.lon - lon) * (c.lon - lon);
              if (d < bestD) {
                bestD = d;
                best = c;
              }
            }
          }
        }
        if (best && Math.sqrt(bestD) <= 0.015) hit = best;
      }
      if (!hit) continue;
      matched++;
      cells[cellKey(lat, lon)] = {
        lat,
        lon,
        sum2h: hit.sum2h,
        slots: hit.slots,
        objectId: p.objectId != null ? p.objectId : null,
      };
    }
    return { cells, matched };
  }

  async function extractCsvFromFile(file) {
    const name = (file.name || "").toLowerCase();
    if (name.endsWith(".csv") || file.type === "text/csv") {
      return { text: await file.text(), fileName: file.name };
    }
    if (name.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed") {
      if (typeof JSZip === "undefined") {
        throw new Error("無法解壓 ZIP（JSZip 未載入）。請先手動解壓，再匯入 CSV。");
      }
      const zip = await JSZip.loadAsync(file);
      const csvName = Object.keys(zip.files).find((n) => n.toLowerCase().endsWith(".csv") && !zip.files[n].dir);
      if (!csvName) throw new Error("ZIP 內找不到 CSV 檔。");
      const text = await zip.files[csvName].async("string");
      return { text, fileName: `${file.name} → ${csvName}` };
    }
    throw new Error("請選擇 .csv（或可解壓嘅 .zip）。");
  }

  async function importWeatherFile(file) {
    if (!file) return;
    try {
      if (!csdiPoints.length) {
        await loadCsdiPoints();
      }
      const { text, fileName } = await extractCsvFromFile(file);
      const parsed = parseNowcastCsvText(text);
      const { cells, matched } = matchCsdiToParsed(parsed.byPoint);
      if (matched === 0) {
        throw new Error("匯入成功解析，但冇對應到 CSDI 香港網格點。請確認檔案係最新臨近預報。");
      }
      weatherGrid = {
        updateTime: parsed.updateTime,
        importedAt: new Date().toISOString(),
        fileName,
        rowCount: parsed.rowCount,
        cells,
      };
      persistWeatherGrid();
      weatherSettings.lastAlertKey = null;
      persistWeatherSettings();
      updateWeatherImportUI();
      updateWeatherFallbackVisibility();
      renderWeatherMap();
      updateWeatherPinUI();
      checkWeatherPinAlert(true);
      const upd = parseHkoDateTime(parsed.updateTime);
      const stale = upd && Date.now() - upd.getTime() > WEATHER_STALE_MS;
      toast(`已匯入 ${matched} 個網格點`);
      setWeatherImportMsg(
        stale
          ? `已匯入 ${matched} 點，但資料更新時間已超過約 20 分鐘，建議重新下載。`
          : `已匯入 ${matched} 點（共解析 ${parsed.rowCount} 列）。`,
        stale ? "error" : "ok"
      );
    } catch (err) {
      console.error(err);
      const msg = err && err.message ? err.message : "匯入失敗";
      setWeatherImportMsg(msg, "error");
      toast(msg);
    } finally {
      if (els.weatherFile) els.weatherFile.value = "";
    }
  }

  function clearWeatherImport() {
    weatherGrid = null;
    persistWeatherGrid();
    setWeatherImportMsg("已清除匯入資料。", "ok");
    updateWeatherImportUI();
    updateWeatherFallbackVisibility();
    renderWeatherMap();
    updateWeatherPinUI();
    toast("已清除天氣匯入");
  }

  async function loadCsdiPoints() {
    if (els.weatherMapHint) els.weatherMapHint.textContent = "載入 CSDI 網格中…";
    const res = await fetch(CSDI_GRID_QUERY);
    if (!res.ok) throw new Error(`CSDI 查詢失敗（HTTP ${res.status}）`);
    const data = await res.json();
    const feats = Array.isArray(data.features) ? data.features : [];
    csdiPoints = feats
      .map((f) => {
        const a = f.attributes || {};
        const g = f.geometry || {};
        const lat = Number(a.Latitude_degree_ != null ? a.Latitude_degree_ : g.y);
        const lon = Number(a.Longitude_degree_ != null ? a.Longitude_degree_ : g.x);
        if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
        return {
          lat: Number(lat.toFixed(3)),
          lon: Number(lon.toFixed(3)),
          objectId: a.OBJECTID != null ? a.OBJECTID : null,
        };
      })
      .filter(Boolean);
    if (els.weatherMapHint) {
      els.weatherMapHint.textContent = `CSDI ${csdiPoints.length} 點` + (weatherGrid ? " · 已疊加匯入雨量" : " · 尚未匯入 CSV");
    }
    return csdiPoints;
  }

  function ensureWeatherMap() {
    if (weatherMap || !els.weatherMapEl || typeof L === "undefined") return;
    weatherMap = L.map(els.weatherMapEl, {
      center: [22.35, 114.15],
      zoom: 11,
      scrollWheelZoom: true,
    });
    L.tileLayer("https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png", {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a> &copy; <a href="https://carto.com/">CARTO</a> · 網格 CSDI / 雨量 HKO',
      maxZoom: 18,
    }).addTo(weatherMap);
  }

  function renderWeatherMap() {
    ensureWeatherMap();
    if (!weatherMap) return;
    if (weatherLayer) {
      weatherMap.removeLayer(weatherLayer);
      weatherLayer = null;
    }
    if (weatherPinMarker) {
      weatherMap.removeLayer(weatherPinMarker);
      weatherPinMarker = null;
    }
    const pts = csdiPoints.length ? csdiPoints : [];
    weatherLayer = L.layerGroup();
    for (const p of pts) {
      const rain = lookupRainAt(p.lat, p.lon);
      const sum = rain ? rain.sum2h : 0;
      const has = !!rain;
      const color = has ? rainColor(sum) : "#b0bec5";
      const circle = L.circleMarker([p.lat, p.lon], {
        radius: 5,
        color: "#333",
        weight: 0.6,
        fillColor: color,
        fillOpacity: has ? 0.85 : 0.35,
      });
      const sumTxt = has ? `${sum.toFixed(1)} mm／未來約 2h` : "未有匯入雨量";
      circle.bindPopup(
        `<strong>${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}</strong><br>${sumTxt}<br><em>點擊地圖標記可釘選</em>`
      );
      circle.on("click", () => {
        weatherSettings.pin = {
          type: "cell",
          lat: p.lat,
          lon: p.lon,
          objectId: p.objectId,
        };
        weatherSettings.lastAlertKey = null;
        persistWeatherSettings();
        updateWeatherPinUI();
        renderWeatherPinMarker();
        checkWeatherPinAlert(true);
        toast(`已釘選網格 ${p.lat.toFixed(3)}, ${p.lon.toFixed(3)}`);
      });
      weatherLayer.addLayer(circle);
    }
    weatherLayer.addTo(weatherMap);
    renderWeatherPinMarker();
    if (els.weatherMapHint) {
      els.weatherMapHint.textContent =
        `CSDI ${pts.length} 點` + (weatherGrid ? " · 已疊加匯入雨量" : " · 尚未匯入 CSV（灰點）");
    }
    setTimeout(() => weatherMap && weatherMap.invalidateSize(), 50);
  }

  function renderWeatherPinMarker() {
    if (!weatherMap) return;
    if (weatherPinMarker) {
      weatherMap.removeLayer(weatherPinMarker);
      weatherPinMarker = null;
    }
    const resolved = resolvePinLatLon();
    if (!resolved) return;
    weatherPinMarker = L.marker([resolved.lat, resolved.lon], { title: "釘選位置" }).addTo(weatherMap);
    weatherPinMarker.bindPopup(`釘選：${resolved.label}`).openPopup();
  }

  function pinAlertIdentity() {
    const resolved = resolvePinLatLon();
    if (!resolved || !weatherGrid) return null;
    return `${weatherGrid.updateTime}|${resolved.lat.toFixed(3)},${resolved.lon.toFixed(3)}|${weatherSettings.thresholdMm}`;
  }

  async function checkWeatherPinAlert(forceCheck) {
    if (!weatherSettings.alertsEnabled) return;
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const resolved = resolvePinLatLon();
    if (!resolved) return;
    const rain = lookupRainAt(resolved.lat, resolved.lon);
    if (!rain) return;
    const thr = Number(weatherSettings.thresholdMm) || 1;
    if (rain.sum2h < thr) return;
    const id = pinAlertIdentity();
    if (!forceCheck && id && id === weatherSettings.lastAlertKey) return;
    const ok = await showAppNotification("降雨臨近預報", {
      body: `${resolved.label} 未來約 2 小時合計 ${rain.sum2h.toFixed(1)} mm（門檻 ${thr} mm）`,
      tag: "daily-work-weather-pin",
    });
    if (ok) {
      weatherSettings.lastAlertKey = id;
      weatherSettings.lastAlertAt = new Date().toISOString();
      persistWeatherSettings();
    }
  }

  function scheduleWeatherAlertTimer() {
    if (weatherAlertTimerId) {
      clearInterval(weatherAlertTimerId);
      weatherAlertTimerId = null;
    }
    if (!weatherSettings.alertsEnabled) return;
    weatherAlertTimerId = setInterval(() => {
      checkWeatherPinAlert(false);
    }, 60 * 1000);
    checkWeatherPinAlert(false);
  }

  async function onWeatherAlertToggle() {
    if (els.weatherAlertEnabled && els.weatherAlertEnabled.checked) {
      if (!weatherSettings.pin) {
        if (els.weatherAlertEnabled) els.weatherAlertEnabled.checked = false;
        setWeatherPinMsg("請先喺地圖點選網格，或用十八區釘選。", "error");
        return;
      }
      const ok = await ensureNotificationPermission();
      if (!ok) {
        if (els.weatherAlertEnabled) els.weatherAlertEnabled.checked = false;
        weatherSettings.alertsEnabled = false;
        persistWeatherSettings();
        updateWeatherPinUI();
        return;
      }
      weatherSettings.alertsEnabled = true;
      persistWeatherSettings();
      scheduleWeatherAlertTimer();
      setWeatherPinMsg("已啟用图钉通知。分頁需保持開啟；關閉後不會再提醒。", "ok");
      checkWeatherPinAlert(true);
    } else {
      weatherSettings.alertsEnabled = false;
      persistWeatherSettings();
      scheduleWeatherAlertTimer();
      setWeatherPinMsg("已關閉图钉通知。", "ok");
    }
    updateWeatherPinUI();
  }

  function onWeatherThresholdChange() {
    const v = Number(els.weatherThreshold && els.weatherThreshold.value);
    weatherSettings.thresholdMm = Number.isFinite(v) && v > 0 ? v : 1;
    weatherSettings.lastAlertKey = null;
    persistWeatherSettings();
    updateWeatherPinUI();
    checkWeatherPinAlert(true);
  }

  function onWeatherPinDistrictChange() {
    const place = els.weatherPinDistrict && els.weatherPinDistrict.value;
    if (!place) return;
    weatherSettings.pin = { type: "district", place };
    weatherSettings.selectedDistrict = place;
    if (els.weatherDistrict) els.weatherDistrict.value = place;
    weatherSettings.lastAlertKey = null;
    persistWeatherSettings();
    updateWeatherPinUI();
    renderWeatherPinMarker();
    checkWeatherPinAlert(true);
    toast(`已釘選「${place}」中心附近網格`);
    loadRhrread();
  }

  function unpinWeather() {
    weatherSettings.pin = null;
    weatherSettings.lastAlertKey = null;
    persistWeatherSettings();
    updateWeatherPinUI();
    renderWeatherPinMarker();
    setWeatherPinMsg("已取消釘選。", "ok");
  }

  function exportWeatherPinSettings() {
    try {
      const payload = {
        app: "daily-workbench-weather",
        exportedAt: new Date().toISOString(),
        timezone: TZ,
        settings: weatherSettings,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json;charset=utf-8",
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `daily-work-weather-pin-${todayKey()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast("已匯出天氣钉選設定");
    } catch (err) {
      console.error(err);
      toast("匯出失敗");
    }
  }

  function fillDistrictSelects() {
    if (els.weatherDistrict) {
      els.weatherDistrict.innerHTML = "";
      for (const d of HK_DISTRICTS) {
        const opt = document.createElement("option");
        opt.value = d.place;
        opt.textContent = d.place;
        els.weatherDistrict.appendChild(opt);
      }
      els.weatherDistrict.value = weatherSettings.selectedDistrict || "沙田";
    }
    if (els.weatherPinDistrict) {
      const first = els.weatherPinDistrict.querySelector('option[value=""]');
      els.weatherPinDistrict.innerHTML = "";
      if (first) els.weatherPinDistrict.appendChild(first);
      else {
        const opt0 = document.createElement("option");
        opt0.value = "";
        opt0.textContent = "— 用地圖點選 —";
        els.weatherPinDistrict.appendChild(opt0);
      }
      for (const d of HK_DISTRICTS) {
        const opt = document.createElement("option");
        opt.value = d.place;
        opt.textContent = d.place;
        els.weatherPinDistrict.appendChild(opt);
      }
    }
  }

  async function loadRhrread() {
    if (!els.weatherRhrValue) return;
    try {
      if (els.weatherRhrStatus) els.weatherRhrStatus.textContent = "載入中…";
      const res = await fetch(HKO_RHRREAD);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      rhrCache = data;
      const place = (els.weatherDistrict && els.weatherDistrict.value) || weatherSettings.selectedDistrict;
      const list = (data.rainfall && Array.isArray(data.rainfall.data) && data.rainfall.data) || [];
      const row = list.find((x) => x.place === place);
      const start = data.rainfall && data.rainfall.startTime;
      const end = data.rainfall && data.rainfall.endTime;
      let range = "";
      try {
        if (start && end) {
          const fmt = new Intl.DateTimeFormat("zh-HK", {
            timeZone: TZ,
            hour: "2-digit",
            minute: "2-digit",
            hour12: false,
          });
          range = `${fmt.format(new Date(start))}–${fmt.format(new Date(end))}`;
        }
      } catch {
        /* ignore */
      }
      if (!row) {
        els.weatherRhrValue.textContent = `${place}：無資料`;
      } else {
        const mm = row.max != null ? row.max : row.value;
        els.weatherRhrValue.textContent = `${place}：${mm} ${row.unit || "mm"}（實況${range ? " · " + range : ""}）`;
      }
      if (els.weatherRhrStatus) {
        els.weatherRhrStatus.textContent = data.updateTime
          ? `更新 ${formatNoteTime(data.updateTime)}`
          : "已載入";
      }
    } catch (err) {
      console.error(err);
      if (els.weatherRhrStatus) els.weatherRhrStatus.textContent = "載入失敗";
      els.weatherRhrValue.textContent = "無法取得十八區雨量";
      toast("十八區雨量載入失敗");
    }
  }

  async function loadOpenMeteoFallback() {
    if (!els.weatherOmValue) return;
    const place = (els.weatherDistrict && els.weatherDistrict.value) || weatherSettings.selectedDistrict;
    const d = HK_DISTRICTS.find((x) => x.place === place) || HK_DISTRICTS[0];
    try {
      if (els.weatherOmBanner) els.weatherOmBanner.hidden = false;
      els.weatherOmValue.textContent = "載入 Open-Meteo 中…";
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${d.lat}&longitude=${d.lon}` +
        `&minutely_15=precipitation&forecast_days=1&timezone=Asia%2FHong_Kong`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      const times = (data.minutely_15 && data.minutely_15.time) || [];
      const precip = (data.minutely_15 && data.minutely_15.precipitation) || [];
      const now = Date.now();
      let sum2h = 0;
      let n = 0;
      for (let i = 0; i < times.length; i++) {
        const t = new Date(times[i]).getTime();
        if (t >= now && t <= now + 2 * 3600 * 1000) {
          sum2h += Number(precip[i]) || 0;
          n++;
        }
      }
      els.weatherOmValue.textContent =
        `${d.place} 中心粗略估計：未來約 2h 合計 ${sum2h.toFixed(1)} mm` +
        `（Open-Meteo，${n} 個 15 分鐘格 · 非 HKO 臨近預報）`;
      if (els.weatherOmStatus) els.weatherOmStatus.textContent = "已載入後備估計";
    } catch (err) {
      console.error(err);
      els.weatherOmValue.textContent = "Open-Meteo 載入失敗";
      toast("Open-Meteo 後備載入失敗");
    }
  }

  async function ensureWeatherBootstrapped() {
    if (weatherBootstrapped) {
      if (weatherMap) weatherMap.invalidateSize();
      return;
    }
    weatherBootstrapped = true;
    fillDistrictSelects();
    updateWeatherImportUI();
    updateWeatherPinUI();
    updateWeatherFallbackVisibility();
    try {
      await loadCsdiPoints();
      renderWeatherMap();
    } catch (err) {
      console.error(err);
      if (els.weatherMapHint) els.weatherMapHint.textContent = "CSDI 網格載入失敗";
      toast("CSDI 網格載入失敗");
    }
    loadRhrread();
    scheduleWeatherAlertTimer();
  }


  // —— Wiring ——
  els.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(els.taskInput.value);
    els.taskInput.value = "";
    els.taskInput.focus();
  });

  els.filterTag.addEventListener("change", () => {
    filterTag = els.filterTag.value;
    renderTasks();
  });
  els.filterEisen.addEventListener("change", () => {
    filterEisen = els.filterEisen.value;
    renderTasks();
  });
  els.btnClearFilters.addEventListener("click", () => {
    filterTag = "all";
    filterEisen = "all";
    els.filterTag.value = "all";
    els.filterEisen.value = "all";
    renderTasks();
  });
  if (els.btnClearSearchFocus) {
    els.btnClearSearchFocus.addEventListener("click", () => {
      clearSearchFocus();
      if (els.globalSearch) els.globalSearch.value = "";
      searchQuery = "";
      hideSearchResults();
      renderTasks();
    });
  }
  if (els.taskRecurrence) {
    els.taskRecurrence.addEventListener("change", syncComposerWeekdayVisibility);
    syncComposerWeekdayVisibility();
  }
  if (els.globalSearch) {
    els.globalSearch.addEventListener("input", onGlobalSearchInput);
    els.globalSearch.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        els.globalSearch.value = "";
        onGlobalSearchInput();
        els.globalSearch.blur();
      }
    });
  }
  document.addEventListener("click", (e) => {
    if (!els.searchResults || els.searchResults.hidden) return;
    const wrap = document.getElementById("topbar-search");
    if (wrap && !wrap.contains(e.target)) hideSearchResults();
  });
  if (els.btnThemeToggle) {
    els.btnThemeToggle.addEventListener("click", toggleTheme);
  }

  document.querySelectorAll(".mod-tabs__btn").forEach((btn) => {
    btn.addEventListener("click", () => setActiveTab(btn.dataset.tab));
  });

  document.addEventListener("keydown", (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const tag = (e.target && e.target.tagName) || "";
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (e.target && e.target.isContentEditable)) {
      return;
    }
    if (e.key === "1") setActiveTab("tasks");
    else if (e.key === "2") setActiveTab("calendar");
    else if (e.key === "3") setActiveTab("notes");
    else if (e.key === "4") setActiveTab("reminders");
    else if (e.key === "5") setActiveTab("weather");
  });

  els.waterEnabled.addEventListener("change", () => onWaterToggle());
  els.waterInterval.addEventListener("change", onWaterIntervalChange);
  els.btnWaterTest.addEventListener("click", onWaterTest);
  if (els.alertTasksEnabled) {
    els.alertTasksEnabled.addEventListener("change", () => onAlertTasksToggle());
  }
  if (els.alertEventsEnabled) {
    els.alertEventsEnabled.addEventListener("change", () => onAlertEventsToggle());
  }
  if (els.alertEventLead) {
    els.alertEventLead.addEventListener("change", onAlertEventLeadChange);
  }

  if (els.btnWeatherImport) {
    els.btnWeatherImport.addEventListener("click", () => els.weatherFile && els.weatherFile.click());
  }
  if (els.weatherFile) {
    els.weatherFile.addEventListener("change", () => {
      const file = els.weatherFile.files && els.weatherFile.files[0];
      importWeatherFile(file);
    });
  }
  if (els.btnWeatherClear) {
    els.btnWeatherClear.addEventListener("click", () => {
      if (confirm("清除已匯入嘅臨近預報網格？")) clearWeatherImport();
    });
  }
  if (els.weatherAlertEnabled) {
    els.weatherAlertEnabled.addEventListener("change", () => onWeatherAlertToggle());
  }
  if (els.weatherThreshold) {
    els.weatherThreshold.addEventListener("change", onWeatherThresholdChange);
  }
  if (els.weatherPinDistrict) {
    els.weatherPinDistrict.addEventListener("change", onWeatherPinDistrictChange);
  }
  if (els.btnWeatherUnpin) {
    els.btnWeatherUnpin.addEventListener("click", unpinWeather);
  }
  if (els.btnWeatherExportPin) {
    els.btnWeatherExportPin.addEventListener("click", exportWeatherPinSettings);
  }
  if (els.weatherDistrict) {
    els.weatherDistrict.addEventListener("change", () => {
      weatherSettings.selectedDistrict = els.weatherDistrict.value;
      persistWeatherSettings();
      loadRhrread();
      updateWeatherFallbackVisibility();
    });
  }
  if (els.btnWeatherRhrRefresh) {
    els.btnWeatherRhrRefresh.addEventListener("click", () => loadRhrread());
  }
  if (els.btnWeatherOmRefresh) {
    els.btnWeatherOmRefresh.addEventListener("click", () => loadOpenMeteoFallback());
  }

  els.noteForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addQuickNote(els.noteInput.value);
    els.noteInput.value = "";
    els.noteInput.focus();
  });

  els.btnPullForward.addEventListener("click", pullForward);
  els.btnExport.addEventListener("click", exportJson);
  els.btnImport.addEventListener("click", () => els.importFile.click());
  els.importFile.addEventListener("change", () => {
    const file = els.importFile.files && els.importFile.files[0];
    importJsonFile(file);
  });
  els.btnWipeSeed.addEventListener("click", wipeSeedData);
  if (els.btnServerImport) {
    els.btnServerImport.addEventListener("click", () => {
      importFromServer();
    });
  }
  if (els.btnServerExport) {
    els.btnServerExport.addEventListener("click", () => {
      exportToServer();
    });
  }
  els.btnAddEvent.addEventListener("click", () => openEventModal(null));
  els.eventForm.addEventListener("submit", saveEventFromForm);
  els.eventModalClose.addEventListener("click", closeEventModal);
  els.eventModalCancel.addEventListener("click", closeEventModal);
  els.scratchPad.addEventListener("input", saveScratchSoon);
  els.btnSaveNote.addEventListener("click", saveScratchAsNote);

  els.scratchPad.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveScratchAsNote();
    }
  });

  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "water-notified" && data.at) {
        state.waterReminder.lastNotifiedAt = data.at;
        persist();
      }
    });
  }

  setInterval(() => {
    const now = todayKey();
    if (els.headerDate.dataset.day !== now) {
      els.headerDate.dataset.day = now;
      if (!weekKeysAround(now).includes(selectedDate)) {
        selectedDate = now;
      }
      renderAll();
      runAlertChecks();
      checkWeatherPinAlert(false);
    }
  }, 60 * 1000);

  els.headerDate.dataset.day = todayKey();
  updateServerHint();
  initTheme();
  renderAll();
  if (activeTab === "weather") {
    ensureWeatherBootstrapped();
  } else if (weatherSettings.alertsEnabled) {
    // light init for background pin checks without forcing map
    scheduleWeatherAlertTimer();
  }

  registerServiceWorker().then(() => {
    if (state.waterReminder.enabled) {
      if ("Notification" in window && Notification.permission === "granted") {
        scheduleWaterTimer();
        setWaterPermMsg(
          "已啟用。關閉分頁／瀏覽器後就不會再通知（此站無推播伺服器）。",
          "ok"
        );
      } else if ("Notification" in window && Notification.permission === "denied") {
        state.waterReminder.enabled = false;
        persist();
        updateWaterUI();
        setWaterPermMsg("通知權限被拒絕，已自動關閉飲水提醒。", "error");
      } else {
        updateWaterUI();
        setWaterPermMsg("請再次開啟「啟用提醒」以授予通知權限。", "error");
      }
    }
    if (state.alerts && (state.alerts.tasksEnabled || state.alerts.eventsEnabled)) {
      if ("Notification" in window && Notification.permission === "granted") {
        scheduleAlertTimer();
        setAlertPermMsg(
          "任務／行程提醒已啟用。關閉分頁／瀏覽器後就不會再通知。",
          "ok"
        );
      } else if ("Notification" in window && Notification.permission === "denied") {
        state.alerts.tasksEnabled = false;
        state.alerts.eventsEnabled = false;
        persist();
        updateAlertsUI();
        setAlertPermMsg("通知權限被拒絕，已自動關閉任務／行程提醒。", "error");
      } else {
        updateAlertsUI();
        setAlertPermMsg("請再次開啟任務或行程提醒以授予通知權限。", "error");
      }
    }
  });
})();
