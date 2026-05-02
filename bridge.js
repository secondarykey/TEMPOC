const defaults = { showDay7: true, showHour5: true, day7Danger: 10, day7Warning: 0, hour5Danger: 10, hour5Warning: 0 };

chrome.storage.sync.get(defaults, (settings) => {
  window.dispatchEvent(new CustomEvent("tempoc:settings", { detail: settings }));
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  chrome.storage.sync.get(defaults, (settings) => {
    window.dispatchEvent(new CustomEvent("tempoc:settings-changed", { detail: settings }));
  });
});

chrome.runtime.onMessage.addListener((message) => {
  window.dispatchEvent(new CustomEvent("tempoc:settings-changed", { detail: message }));
});
