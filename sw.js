/* 每日工作台 — service worker for water reminder toasts
 * Helps show system notifications while the tab is open/minimized.
 * Closing the tab/browser stops reminders (no push server).
 */
const WATER_TAG = "daily-work-water";

let waterConfig = {
  enabled: false,
  intervalMinutes: 60,
  lastNotifiedAt: null,
};

let timerId = null;

self.addEventListener("install", (event) => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

function clearWaterTimer() {
  if (timerId != null) {
    clearInterval(timerId);
    timerId = null;
  }
}

async function fireWaterNotification(force) {
  if (!waterConfig.enabled && !force) return;

  const now = Date.now();
  const last = waterConfig.lastNotifiedAt
    ? Date.parse(waterConfig.lastNotifiedAt)
    : 0;
  const minGap = 25 * 1000;
  if (!force && last && now - last < minGap) return;

  if (!force && last) {
    const gap = (waterConfig.intervalMinutes || 60) * 60 * 1000;
    if (now - last < gap * 0.9) return;
  }

  try {
    await self.registration.showNotification("飲杯水", {
      body: "休息一下，喝杯水吧。",
      tag: WATER_TAG,
      renotify: true,
      icon: "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Crect width='64' height='64' rx='14' fill='%232d4a3e'/%3E%3Cpath d='M22 18h20l-2 30H24L22 18zm6 8v14m8-14v14' stroke='%23c8e6d8' stroke-width='3' fill='none' stroke-linecap='round'/%3E%3C/svg%3E",
    });
    waterConfig.lastNotifiedAt = new Date().toISOString();
    const clients = await self.clients.matchAll({ type: "window" });
    clients.forEach((c) => {
      c.postMessage({ type: "water-notified", at: waterConfig.lastNotifiedAt });
    });
  } catch (err) {
    // ignore
  }
}

function scheduleFromConfig() {
  clearWaterTimer();
  if (!waterConfig.enabled) return;
  const ms = (waterConfig.intervalMinutes || 60) * 60 * 1000;
  timerId = setInterval(() => {
    fireWaterNotification(false);
  }, ms);
}

self.addEventListener("message", (event) => {
  const data = event.data || {};
  if (data.type === "water-config") {
    waterConfig = {
      enabled: !!data.enabled,
      intervalMinutes: data.intervalMinutes || 60,
      lastNotifiedAt: data.lastNotifiedAt || waterConfig.lastNotifiedAt,
    };
    scheduleFromConfig();
  }
  if (data.type === "water-test") {
    fireWaterNotification(true);
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clients = await self.clients.matchAll({
        type: "window",
        includeUncontrolled: true,
      });
      for (const c of clients) {
        if ("focus" in c) {
          return c.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow("./");
      }
    })()
  );
});
