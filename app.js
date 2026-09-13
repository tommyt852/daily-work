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
  const DOW_ZH = ["日", "一", "二", "三", "四", "五", "六"];

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
    // Walk back ~36h then re-resolve in HK to avoid DST edge cases
    const now = new Date();
    const probe = new Date(now.getTime() - 36 * 60 * 60 * 1000);
    let key = hkParts(probe).dateKey;
    const today = todayKey();
    // Fine-tune: find the calendar day immediately before today
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
    // Noon UTC-ish probe for weekday in HK
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
    // Week starts Monday (HK common office week)
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

  // —— Seed data ——
  function buildSeed() {
    const today = todayKey();
    const yest = yesterdayKey();
    const week = weekKeysAround(today);
    return {
      version: 1,
      seeded: true,
      tasksByDate: {
        [today]: [
          { id: uid(), text: "檢視本週優先事項", done: false, createdAt: new Date().toISOString() },
          { id: uid(), text: "回覆待辦電郵", done: false, createdAt: new Date().toISOString() },
          { id: uid(), text: "整理桌面與檔案", done: true, createdAt: new Date().toISOString() },
        ],
        [yest]: [
          { id: uid(), text: "完成每週報告草稿", done: false, createdAt: new Date().toISOString() },
          { id: uid(), text: "更新專案進度表", done: false, createdAt: new Date().toISOString() },
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
      data.tasksByDate = data.tasksByDate || {};
      data.events = Array.isArray(data.events) ? data.events : [];
      data.notes = Array.isArray(data.notes) ? data.notes : [];
      data.scratch = typeof data.scratch === "string" ? data.scratch : "";
      return data;
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

  // —— DOM ——
  const $ = (sel) => document.querySelector(sel);

  const els = {
    headerDate: $("#header-date"),
    taskForm: $("#task-form"),
    taskInput: $("#task-input"),
    taskList: $("#task-list"),
    tasksEmpty: $("#tasks-empty"),
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

  function renderTasks() {
    const tasks = getTodayTasks();
    const remaining = tasks.filter((t) => !t.done).length;
    els.tasksRemaining.textContent =
      remaining === 0 && tasks.length > 0
        ? "全部完成 🎉"
        : `尚餘 ${remaining} 項 · 共 ${tasks.length} 項`;

    els.taskList.innerHTML = "";
    if (tasks.length === 0) {
      els.tasksEmpty.hidden = false;
      return;
    }
    els.tasksEmpty.hidden = true;

    tasks.forEach((task, index) => {
      const li = document.createElement("li");
      li.className = "task-item" + (task.done ? " task-item--done" : "");
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

      const text = document.createElement("span");
      text.className = "task-item__text";
      text.textContent = task.text;

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
      down.disabled = index === tasks.length - 1;
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

      // Layout: handle | check+text | actions — restructure to match CSS grid
      li.innerHTML = "";
      const left = document.createElement("div");
      left.style.display = "flex";
      left.style.alignItems = "center";
      left.style.gap = "0.45rem";
      left.append(handle, check);

      li.append(left, text, actions);

      // Drag & drop
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
    });
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
      state.tasksByDate[tKey].push({
        id: uid(),
        text: t.text,
        done: false,
        createdAt: new Date().toISOString(),
        pulledFrom: yKey,
      });
      existingTexts.add(t.text);
      added++;
    });
    persist();
    renderTasks();
    toast(added === 0 ? "昨日未完成項目已存在於今日" : `已帶入 ${added} 項未完成任務`);
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
      version: 1,
      app: "daily-workbench",
      exportedAt: new Date().toISOString(),
      timezone: TZ,
      data: {
        version: state.version || 1,
        seeded: !!state.seeded,
        tasksByDate: state.tasksByDate || {},
        events: Array.isArray(state.events) ? state.events : [],
        scratch: typeof state.scratch === "string" ? state.scratch : "",
        notes: Array.isArray(state.notes) ? state.notes : [],
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
    // Accept either wrapped { version, exportedAt, data } or bare state object
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
        if (!t || typeof t !== "object") {
          throw new Error(`日期 ${dateKey} 第 ${i + 1} 項任務無效。`);
        }
        if (typeof t.text !== "string" || !t.text.trim()) {
          throw new Error(`日期 ${dateKey} 第 ${i + 1} 項任務缺少文字。`);
        }
        return {
          id: typeof t.id === "string" && t.id ? t.id : uid(),
          text: t.text.trim().slice(0, 200),
          done: !!t.done,
          createdAt: typeof t.createdAt === "string" ? t.createdAt : new Date().toISOString(),
          ...(t.pulledFrom ? { pulledFrom: t.pulledFrom } : {}),
        };
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

    // Soft-check envelope version if present
    if (envelope && envelope.version != null && Number(envelope.version) > 1) {
      // still allow if shape is valid; warn via toast after import
    }

    return {
      version: typeof data.version === "number" ? data.version : 1,
      seeded: false,
      tasksByDate: normalizedTasks,
      events,
      scratch,
      notes,
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
          "匯入會「取代」目前本機所有工作台資料（任務、行程、筆記、草稿）。\n確定繼續？"
        );
        if (!ok) {
          toast("已取消匯入");
          return;
        }
        state = {
          version: normalized.version,
          seeded: false,
          tasksByDate: normalized.tasksByDate,
          events: normalized.events,
          scratch: normalized.scratch,
          notes: normalized.notes,
        };
        persist();
        selectedDate = todayKey();
        renderAll();
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
    localStorage.removeItem(STORAGE_KEY);
    state = {
      version: 1,
      seeded: false,
      tasksByDate: {},
      events: [],
      scratch: "",
      notes: [],
    };
    persist();
    selectedDate = todayKey();
    renderAll();
    toast("已清除所有資料");
  }

  // —— Render all ——
  function renderAll() {
    els.headerDate.textContent = formatHeaderDate(todayKey());
    renderTasks();
    renderWeekStrip();
    renderEvents();
    renderNotes();
  }

  // —— Events wiring ——
  els.taskForm.addEventListener("submit", (e) => {
    e.preventDefault();
    addTask(els.taskInput.value);
    els.taskInput.value = "";
    els.taskInput.focus();
  });

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

  // Keyboard: Ctrl/Cmd+Enter in scratch saves as note
  els.scratchPad.addEventListener("keydown", (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      saveScratchAsNote();
    }
  });

  // Midnight rollover: refresh header/tasks if day changes while open
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
})();
