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
  const EXPORT_VERSION = 3;
  const DATA_VERSION = 3;
  const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];
  const WATER_INTERVALS = [30, 45, 60, 90];
  const WATER_MIN_GAP_MS = 25 * 1000;
  const STATUSES = ["todo", "doing", "done"];
  const STATUS_LABEL = { todo: "待辦", doing: "進行中", done: "完成" };
  const WIP_SOFT_LIMIT = 3;
  const DONE_VISIBLE_DAYS = 3; // hide when age >= 3 HK calendar days
  const TABS = ["tasks", "calendar", "notes", "reminders"];

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
    // 重要且緊急 float to top
    const score = (t) => (t.important && t.urgent ? 2 : t.important ? 1 : 0);
    const d = score(b) - score(a);
    if (d !== 0) return d;
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
    data.version = typeof data.version === "number" ? data.version : DATA_VERSION;
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
    filterTag: $("#filter-tag"),
    filterEisen: $("#filter-eisen"),
    btnClearFilters: $("#btn-clear-filters"),
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
    serverUrlHint: $("#server-url-hint"),
    btnServerImport: $("#btn-server-import"),
    btnServerExport: $("#btn-server-export"),
    toast: $("#toast"),
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

  function setTaskStatus(task, status) {
    status = normalizeStatus(status, false);
    task.status = status;
    if (status === "done") {
      task.done = true;
      task.completedAt = new Date().toISOString();
      task.completedDateKey = todayKey();
    } else {
      task.done = false;
      task.completedAt = null;
      task.completedDateKey = null;
    }
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
  }

  function createTaskCard(task) {
    const li = document.createElement("li");
    li.className =
      "task-card" +
      (task.important && task.urgent ? " task-card--priority-boost" : "");
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
      if (check.checked) {
        setTaskStatus(task, "done");
      } else {
        setTaskStatus(task, "todo");
      }
      persist();
      renderTasks();
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

    li.append(top, badges, flags, tagsInput, actions);

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
      setTaskStatus(task, status);
      persist();
      renderTasks();
      toast(`已移至「${STATUS_LABEL[status]}」`);
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
      createdAt: new Date().toISOString(),
      completedAt: null,
      completedDateKey: null,
    });
    els.taskImportant.checked = false;
    els.taskUrgent.checked = false;
    els.taskTags.value = "";
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

      actions.append(edit, del);
      li.append(time, body, actions);
      els.eventList.appendChild(li);
    });
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

  function isDateKey(s) {
    return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
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

    return {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: normalizedTasks,
      events,
      scratch,
      notes,
      waterReminder,
      _envelopeVersion: envelope && envelope.version != null ? envelope.version : null,
      _exportedAt: envelope && typeof envelope.exportedAt === "string" ? envelope.exportedAt : null,
    };
  }

  const IMPORT_REPLACE_CONFIRM =
    "匯入會「取代」目前本機所有工作台資料（任務、行程、筆記、草稿、飲水提醒）。\n確定繼續？";

  function confirmReplaceImport() {
    return confirm(IMPORT_REPLACE_CONFIRM);
  }

  function applyImportedState(normalized) {
    clearWaterTimer();
    state = {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: normalized.tasksByDate,
      events: normalized.events,
      scratch: normalized.scratch,
      notes: normalized.notes,
      waterReminder: normalized.waterReminder,
    };
    persist();
    selectedDate = todayKey();
    filterTag = "all";
    filterEisen = "all";
    els.filterEisen.value = "all";
    renderAll();
    if (state.waterReminder.enabled) {
      enableWaterReminder();
    } else {
      updateWaterUI();
    }
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
    localStorage.removeItem(STORAGE_KEY);
    state = {
      version: DATA_VERSION,
      seeded: false,
      tasksByDate: {},
      events: [],
      scratch: "",
      notes: [],
      waterReminder: defaultWater(),
    };
    persist();
    selectedDate = todayKey();
    filterTag = "all";
    filterEisen = "all";
    els.filterEisen.value = "all";
    renderAll();
    updateWaterUI();
    setWaterPermMsg("");
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
  });

  els.waterEnabled.addEventListener("change", () => onWaterToggle());
  els.waterInterval.addEventListener("change", onWaterIntervalChange);
  els.btnWaterTest.addEventListener("click", onWaterTest);

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
    }
  }, 60 * 1000);

  els.headerDate.dataset.day = todayKey();
  updateServerHint();
  renderAll();

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
  });
})();
