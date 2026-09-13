/**
 * 每日工作台 — vanilla JS, localStorage
 * Timezone: Asia/Hong_Kong
 *
 * Future adapter hints (not implemented):
 *   - adapters/googleCalendar.js
 *   - adapters/notionNotes.js
 *   - adapters/githubIssues.js
 */

(function () {
  "use strict";

  const TZ = "Asia/Hong_Kong";
  const STORAGE_KEY = "daily-workbench:v1";
  const EXPORT_VERSION = 2;
  const DATA_VERSION = 2;
  const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];
  const DOW_MON_FIRST = ["一", "二", "三", "四", "五", "六", "日"];
  const PRIO_LABEL = { high: "高", med: "中", low: "低" };
  const WATER_INTERVALS = [30, 45, 60, 90];
  const WATER_MIN_GAP_MS = 25 * 1000; // anti-spam floor between toasts

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
    const probe = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    let key = hkParts(probe).dateKey;
    const today = todayKey();
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

  function normalizePriority(p) {
    if (p === "high" || p === "low" || p === "med") return p;
    return "med";
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

  function normalizeTask(t) {
    if (!t || typeof t !== "object") return null;
    if (typeof t.text !== "string" || !t.text.trim()) return null;
    return {
      id: typeof t.id === "string" && t.id ? t.id : uid(),
      text: t.text.trim().slice(0, 200),
      done: !!t.done,
      createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
      priority: normalizePriority(t.priority),
      tags: parseTags(t.tags),
      ...(t.pulledFrom ? { pulledFrom: t.pulledFrom } : {}),
    };
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

  function normalizeHabit(h) {
    if (!h || typeof h !== "object") return null;
    if (typeof h.name !== "string" || !h.name.trim()) return null;
    const checkins = {};
    if (h.checkins && typeof h.checkins === "object" && !Array.isArray(h.checkins)) {
      for (const [k, v] of Object.entries(h.checkins)) {
        if (/^\d{4}-\d{2}-\d{2}$/.test(k) && v) checkins[k] = true;
      }
    }
    return {
      id: typeof h.id === "string" && h.id ? h.id : uid(),
      name: h.name.trim().slice(0, 40),
      checkins,
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
    data.habits = Array.isArray(data.habits)
      ? data.habits.map(normalizeHabit).filter(Boolean)
      : [];
    data.waterReminder = normalizeWater(data.waterReminder);
    data.version = typeof data.version === "number" ? data.version : DATA_VERSION;
    return data;
  }

  // —— Seed data ——
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
            done: false,
            createdAt: new Date().toISOString(),
            priority: "high",
            tags: ["工作"],
          },
          {
            id: uid(),
            text: "回覆待辦電郵",
            done: false,
            createdAt: new Date().toISOString(),
            priority: "med",
            tags: ["工作"],
          },
          {
            id: uid(),
            text: "整理桌面與檔案",
            done: true,
            createdAt: new Date().toISOString(),
            priority: "low",
            tags: ["私人"],
          },
        ],
        [yest]: [
          {
            id: uid(),
            text: "完成每週報告草稿",
            done: false,
            createdAt: new Date().toISOString(),
            priority: "high",
            tags: ["工作"],
          },
          {
            id: uid(),
            text: "更新專案進度表",
            done: false,
            createdAt: new Date().toISOString(),
            priority: "med",
            tags: ["工作"],
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
      habits: [
        { id: uid(), name: "伸展", checkins: {} },
        { id: uid(), name: "閱讀 15 分鐘", checkins: {} },
      ],
      waterReminder: defaultWater(),
    };
  }

  // —— Persistence ——
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  // —— App state ——
  let state = loadState();
  let selectedDate = todayKey();
  let dragTaskId = null;
  let toastTimer = null;
  let filterPriority = "all";
  let filterTag = "all";
  let waterTimerId = null;
  let swRegistration = null;

  // —— DOM ——
  const $ = (sel) => document.querySelector(sel);

  const els = {
    headerDate: $("#header-date"),
    taskForm: $("#task-form"),
    taskInput: $("#task-input"),
    taskPriority: $("#task-priority"),
    taskTags: $("#task-tags"),
    filterPriority: $("#filter-priority"),
    filterTag: $("#filter-tag"),
    btnClearFilters: $("#btn-clear-filters"),
    taskList: $("#task-list"),
    tasksEmpty: $("#tasks-empty"),
    tasksFilteredEmpty: $("#tasks-filtered-empty"),
    tasksRemaining: $("#tasks-remaining"),
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
    habitForm: $("#habit-form"),
    habitInput: $("#habit-input"),
    habitList: $("#habit-list"),
    habitsEmpty: $("#habits-empty"),
    waterEnabled: $("#water-enabled"),
    waterInterval: $("#water-interval"),
    waterStatus: $("#water-status"),
    waterPermMsg: $("#water-perm-msg"),
    btnWaterTest: $("#btn-water-test"),
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

  // —— Tasks ——
  function getTodayTasks() {
    const key = todayKey();
    if (!state.tasksByDate[key]) state.tasksByDate[key] = [];
    return state.tasksByDate[key];
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

  function filteredTasks() {
    return getTodayTasks().filter((t) => {
      if (filterPriority !== "all" && normalizePriority(t.priority) !== filterPriority) {
        return false;
      }
      if (filterTag !== "all") {
        const tags = t.tags || [];
        if (!tags.includes(filterTag)) return false;
      }
      return true;
    });
  }

  function updateFilterClearBtn() {
    const active = filterPriority !== "all" || filterTag !== "all";
    els.btnClearFilters.hidden = !active;
  }

  function renderTasks() {
    const tasks = getTodayTasks();
    const shown = filteredTasks();
    const remaining = tasks.filter((t) => !t.done).length;
    els.tasksRemaining.textContent =
      remaining === 0 && tasks.length > 0
        ? "全部完成 🎉"
        : `尚餘 ${remaining} 項 · 共 ${tasks.length} 項`;

    updateFilterTagOptions();
    updateFilterClearBtn();

    els.taskList.innerHTML = "";
    els.tasksEmpty.hidden = true;
    els.tasksFilteredEmpty.hidden = true;

    if (tasks.length === 0) {
      els.tasksEmpty.hidden = false;
      return;
    }
    if (shown.length === 0) {
      els.tasksFilteredEmpty.hidden = false;
      return;
    }

    shown.forEach((task) => {
      const fullList = getTodayTasks();
      const index = fullList.findIndex((t) => t.id === task.id);
      const prio = normalizePriority(task.priority);

      const li = document.createElement("li");
      li.className =
        "task-item task-item--prio-" +
        prio +
        (task.done ? " task-item--done" : "");
      li.dataset.id = task.id;
      li.draggable = true;

      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = "task-item__handle";
      handle.title = "拖曳排序";
      handle.setAttribute("aria-label", "拖曳排序");
      handle.textContent = "⋮⋮";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "task-item__check";
      check.checked = !!task.done;
      check.title = task.done ? "標為未完成" : "標為完成";
      check.setAttribute("aria-label", task.done ? "標為未完成" : "標為完成");
      check.addEventListener("change", () => {
        task.done = check.checked;
        persist();
        renderTasks();
      });

      const main = document.createElement("div");
      main.className = "task-item__main";

      const text = document.createElement("span");
      text.className = "task-item__text";
      text.textContent = task.text;

      const meta = document.createElement("div");
      meta.className = "task-item__meta";

      const prioSelect = document.createElement("select");
      prioSelect.className = "task-item__prio-select";
      prioSelect.title = "優先級";
      prioSelect.setAttribute("aria-label", "優先級");
      ["high", "med", "low"].forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = PRIO_LABEL[v];
        if (v === prio) opt.selected = true;
        prioSelect.appendChild(opt);
      });
      prioSelect.addEventListener("change", () => {
        task.priority = normalizePriority(prioSelect.value);
        persist();
        renderTasks();
      });

      const tagsInput = document.createElement("input");
      tagsInput.type = "text";
      tagsInput.className = "task-item__tags-input";
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

      meta.append(prioSelect, tagsInput);

      main.append(text, meta);

      const actions = document.createElement("div");
      actions.className = "task-item__actions";

      const up = document.createElement("button");
      up.type = "button";
      up.className = "btn btn--tiny btn--ghost";
      up.textContent = "↑";
      up.title = "上移";
      up.disabled = index === 0;
      up.addEventListener("click", () => moveTask(task.id, -1));

      const down = document.createElement("button");
      down.type = "button";
      down.className = "btn btn--tiny btn--ghost";
      down.textContent = "↓";
      down.title = "下移";
      down.disabled = index === fullList.length - 1;
      down.addEventListener("click", () => moveTask(task.id, 1));

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

      actions.append(up, down, del);

      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "flex-start";
      left.style.gap = "0.45rem";
      left.append(handle, check);

      li.append(left, main, actions);

      li.addEventListener("dragstart", (e) => {
        dragTaskId = task.id;
        li.classList.add("dragging");
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", task.id);
      });
      li.addEventListener("dragend", () => {
        dragTaskId = null;
        li.classList.remove("dragging");
        document.querySelectorAll(".task-item.drag-over").forEach((el) =>
          el.classList.remove("drag-over")
        );
      });
      li.addEventListener("dragover", (e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        li.classList.add("drag-over");
      });
      li.addEventListener("dragleave", () => li.classList.remove("drag-over"));
      li.addEventListener("drop", (e) => {
        e.preventDefault();
        li.classList.remove("drag-over");
        const fromId = e.dataTransfer.getData("text/plain") || dragTaskId;
        if (!fromId || fromId === task.id) return;
        reorderTask(fromId, task.id);
      });

      els.taskList.appendChild(li);
    });
  }

  function moveTask(id, delta) {
    const list = getTodayTasks();
    const i = list.findIndex((t) => t.id === id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= list.length) return;
    const tmp = list[i];
    list[i] = list[j];
    list[j] = tmp;
    persist();
    renderTasks();
  }

  function reorderTask(fromId, toId) {
    const list = getTodayTasks();
    const from = list.findIndex((t) => t.id === fromId);
    const to = list.findIndex((t) => t.id === toId);
    if (from < 0 || to < 0) return;
    const [item] = list.splice(from, 1);
    list.splice(to, 0, item);
    persist();
    renderTasks();
  }

  function addTask(text) {
    const trimmed = text.trim();
    if (!trimmed) return;
    getTodayTasks().unshift({
      id: uid(),
      text: trimmed,
      done: false,
      createdAt: new Date().toISOString(),
      priority: normalizePriority(els.taskPriority.value),
      tags: parseTags(els.taskTags.value),
    });
    els.taskPriority.value = "med";
    els.taskTags.value = "";
    persist();
    renderTasks();
  }

  function pullForward() {
    const yKey = yesterdayKey();
    const tKey = todayKey();
    const yTasks = state.tasksByDate[yKey] || [];
    const unfinished = yTasks.filter((t) => !t.done);
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
        done: false,
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

  // —— Habits ——
  function renderHabits() {
    const today = todayKey();
    const week = weekKeysAround(today);
    els.habitList.innerHTML = "";

    if (!state.habits.length) {
      els.habitsEmpty.hidden = false;
      return;
    }
    els.habitsEmpty.hidden = true;

    state.habits.forEach((habit) => {
      const li = document.createElement("li");
      li.className = "habit-item";

      const check = document.createElement("input");
      check.type = "checkbox";
      check.className = "habit-item__check";
      check.checked = !!(habit.checkins && habit.checkins[today]);
      check.title = check.checked ? "取消今日打卡" : "今日打卡";
      check.setAttribute("aria-label", `${habit.name} 今日打卡`);
      check.addEventListener("change", () => {
        if (!habit.checkins) habit.checkins = {};
        if (check.checked) {
          habit.checkins[today] = true;
        } else {
          delete habit.checkins[today];
        }
        persist();
        renderHabits();
      });

      const body = document.createElement("div");
      body.className = "habit-item__body";

      const name = document.createElement("p");
      name.className = "habit-item__name";
      name.textContent = habit.name;

      const weekRow = document.createElement("div");
      weekRow.className = "habit-item__week";
      weekRow.setAttribute("aria-label", "本週打卡");

      week.forEach((key, i) => {
        const wrap = document.createElement("span");
        wrap.style.display = "inline-flex";
        wrap.style.flexDirection = "column";
        wrap.style.alignItems = "center";
        wrap.style.gap = "0.15rem";

        const label = document.createElement("span");
        label.className = "habit-dot__label";
        label.textContent = DOW_MON_FIRST[i];

        const dot = document.createElement("span");
        dot.className = "habit-dot";
        if (habit.checkins && habit.checkins[key]) {
          dot.classList.add("habit-dot--done");
        }
        if (key === today) {
          dot.classList.add("habit-dot--today");
        }
        dot.title = `${key} ${habit.checkins && habit.checkins[key] ? "已打卡" : "未打卡"}`;

        wrap.append(label, dot);
        weekRow.appendChild(wrap);
      });

      body.append(name, weekRow);

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--tiny btn--ghost habit-item__del";
      del.textContent = "刪";
      del.title = "刪除習慣";
      del.addEventListener("click", () => {
        if (!confirm(`刪除習慣「${habit.name}」？`)) return;
        state.habits = state.habits.filter((h) => h.id !== habit.id);
        persist();
        renderHabits();
        toast("已刪除習慣");
      });

      li.append(check, body, del);
      els.habitList.appendChild(li);
    });
  }

  function addHabit(name) {
    const trimmed = name.trim();
    if (!trimmed) return;
    if (state.habits.some((h) => h.name === trimmed)) {
      toast("此習慣已存在");
      return;
    }
    state.habits.push({ id: uid(), name: trimmed.slice(0, 40), checkins: {} });
    persist();
    renderHabits();
  }

  // —— Water reminder (Web Notifications + optional SW) ——
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
    if (!force && last && now - last < WATER_MIN_GAP_MS) {
      return false;
    }
    // Also respect interval unless forced (test button)
    if (!force && last) {
      const gap = (state.waterReminder.intervalMinutes || 60) * 60 * 1000;
      // Allow slight early fire within 5% for timer drift, but block if too soon
      if (now - last < gap * 0.9) {
        return false;
      }
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
        // Fallback: page Notification (works while tab is open)
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

    // Tell SW the interval (best-effort background while controlled)
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
    if (state.waterReminder.enabled) {
      scheduleWaterTimer();
    }
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

  // —— Calendar / events ——
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

  // —— Export / Import JSON ——
  function buildExportPayload() {
    return {
      version: EXPORT_VERSION,
      app: "daily-workbench",
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      data: {
        version: state.version || DATA_VERSION,
        seeded: !!state.seeded,
        tasksByDate: state.tasksByDate || {},
        events: Array.isArray(state.events) ? state.events : [],
        scratch: typeof state.scratch === "string" ? state.scratch : "",
        notes: Array.isArray(state.notes) ? state.notes : [],
        habits: Array.isArray(state.habits) ? state.habits : [],
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

    // habits: optional in v1 exports
    let habits = [];
    if (data.habits != null) {
      if (!Array.isArray(data.habits)) {
        throw new Error("檔案格式不正確：habits 必須為陣列。");
      }
      habits = data.habits.map(normalizeHabit).filter(Boolean);
    }

    const waterReminder = normalizeWater(data.waterReminder);

    return {
      version: typeof data.version === "number" ? data.version : DATA_VERSION,
      seeded: false,
      tasksByDate: normalizedTasks,
      events,
      scratch,
      notes,
      habits,
      waterReminder,
      _envelopeVersion: envelope && envelope.version != null ? envelope.version : null,
      _exportedAt: envelope && typeof envelope.exportedAt === "string" ? envelope.exportedAt : null,
    };
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
        const ok = confirm(
          "匯入會「取代」目前本機所有工作台資料（任務、行程、筆記、草稿、習慣、飲水提醒）。\n確定繼續？"
        );
        if (!ok) {
          toast("已取消匯入");
          return;
        }
        clearWaterTimer();
        state = {
          version: normalized.version,
          seeded: false,
          tasksByDate: normalized.tasksByDate,
          events: normalized.events,
          scratch: normalized.scratch,
          notes: normalized.notes,
          habits: normalized.habits,
          waterReminder: normalized.waterReminder,
        };
        persist();
        selectedDate = todayKey();
        filterPriority = "all";
        filterTag = "all";
        els.filterPriority.value = "all";
        renderAll();
        if (state.waterReminder.enabled) {
          enableWaterReminder();
        } else {
          updateWaterUI();
        }
        const when = normalized._exportedAt
          ? `（備份時間：${formatNoteTime(normalized._exportedAt)}）`
          : "";
        toast(`匯入成功${when}`);
      } catch (err) {
        console.error(err);
        toast(err && err.message ? err.message : "匯入失敗：檔案格式不正確");
      } finally {
        els.importFile.value = "";
      }
    };
    reader.readAsText(file, "UTF-8");
  }

  // —— Wipe seed ——
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
      habits: [],
      waterReminder: defaultWater(),
    };
    persist();
    selectedDate = todayKey();
    filterPriority = "all";
    filterTag = "all";
    els.filterPriority.value = "all";
    renderAll();
    updateWaterUI();
    setWaterPermMsg("");
    toast("已清除所有資料");
  }

  // —— Render all ——
  function renderAll() {
    els.headerDate.textContent = formatHeaderDate(todayKey());
    renderTasks();
    renderWeekStrip();
    renderEvents();
    renderNotes();
    renderHabits();
    updateWaterUI();
  }

  // —— Events wiring ——
  els.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(els.taskInput.value);
    els.taskInput.value = "";
    els.taskInput.focus();
  });

  els.filterPriority.addEventListener("change", () => {
    filterPriority = els.filterPriority.value;
    renderTasks();
  });

  els.filterTag.addEventListener("change", () => {
    filterTag = els.filterTag.value;
    renderTasks();
  });

  els.btnClearFilters.addEventListener("click", () => {
    filterPriority = "all";
    filterTag = "all";
    els.filterPriority.value = "all";
    els.filterTag.value = "all";
    renderTasks();
  });

  els.habitForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addHabit(els.habitInput.value);
    els.habitInput.value = "";
    els.habitInput.focus();
  });

  els.waterEnabled.addEventListener("change", () => {
    onWaterToggle();
  });
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

  // Listen for SW messages (e.g. notification shown)
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "water-notified" && data.at) {
        state.waterReminder.lastNotifiedAt = data.at;
        persist();
      }
    });
  }

  // Midnight rollover
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
  renderAll();

  // Resume water reminder if previously enabled
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
        // permission default — leave enabled flag but ask again via UI
        updateWaterUI();
        setWaterPermMsg("請再次開啟「啟用提醒」以授予通知權限。", "error");
      }
    }
  });
})();
