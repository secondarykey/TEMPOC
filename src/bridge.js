const defaults = {
  showDay7: true, showHour5: true,
  day7Danger: 10, day7Warning: 0, day7ColorEnabled: true,
  hour5Danger: 10, hour5Warning: 0, hour5ColorEnabled: true,
  showRemainDay7: true, showRemainHour5: false,
  decimalPlaces: 2,
  durationStyle: 'short',
  percentFormat: '{}%',
  refreshInterval: 0,
  utilizationWarning: 98, utilizationDanger: 100,
};

function isUsagePage() {
  if (location.pathname === "/settings/usage") return true;
  if (location.pathname === "/new" && location.hash === "#settings/usage") return true;
  return false;
}

function dispatchSettings() {
  if (!isUsagePage()) return;
  chrome.storage.sync.get(defaults, (settings) => {
    window.dispatchEvent(new CustomEvent("tempoc:settings", { detail: settings }));
  });
}

// content.js の準備完了を待ってから設定を送る
window.addEventListener("tempoc:ready", dispatchSettings);

// SPA ナビゲーションで usage ページに来たとき再初期化
window.addEventListener("tempoc:navigate", dispatchSettings);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  chrome.storage.sync.get(defaults, (settings) => {
    window.dispatchEvent(new CustomEvent("tempoc:settings-changed", { detail: settings }));
  });
});

chrome.runtime.onMessage.addListener((message) => {
  window.dispatchEvent(new CustomEvent("tempoc:settings-changed", { detail: message }));
});

window.addEventListener("tempoc:locale", (e) => {
  chrome.storage.local.set({ detectedLocale: e.detail });
});
