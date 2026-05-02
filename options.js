const status      = document.getElementById("status");
const showDay7Cb  = document.getElementById("showDay7");
const showHour5Cb = document.getElementById("showHour5");

const defaults = {
  showDay7: true, showHour5: true,
  day7Danger: 10, day7Warning: 0,
  hour5Danger: 10, hour5Warning: 0,
};

const cs = getComputedStyle(document.documentElement);
const COLOR_ACCENT  = cs.getPropertyValue("--color-accent").trim();
const COLOR_WARNING = cs.getPropertyValue("--color-warning").trim();
const COLOR_DANGER  = cs.getPropertyValue("--color-danger").trim();

function getCurrentSettings() {
  return {
    showDay7:     showDay7Cb.checked,
    showHour5:    showHour5Cb.checked,
    day7Warning:  day7Range.getWarning(),
    day7Danger:   day7Range.getDanger(),
    hour5Warning: hour5Range.getWarning(),
    hour5Danger:  hour5Range.getDanger(),
  };
}

function broadcast() {
  const settings = getCurrentSettings();
  chrome.tabs.query({ url: "https://claude.ai/settings/usage" }, (tabs) => {
    tabs.forEach(tab => chrome.tabs.sendMessage(tab.id, settings));
  });
}

function save() {
  chrome.storage.sync.set(getCurrentSettings(), () => {
    status.style.visibility = "visible";
    setTimeout(() => { status.style.visibility = "hidden"; }, 1500);
  });
}

function setupDualRange(containerId) {
  const container    = document.getElementById(containerId);
  const warningInput = container.querySelector(".warning-input");
  const dangerInput  = container.querySelector(".danger-input");
  const fill         = container.querySelector(".dual-range__fill");
  const warningBold  = container.querySelector(".warning-label b");
  const dangerBold   = container.querySelector(".danger-label b");

  function updateDisplay() {
    const w = Number(warningInput.value);
    const d = Number(dangerInput.value);
    warningBold.textContent = w;
    dangerBold.textContent  = d;
    const wPct = w + 50;
    const dPct = d + 50;
    fill.style.background =
      `linear-gradient(to right,` +
      ` ${COLOR_ACCENT} 0%, ${COLOR_ACCENT} ${wPct}%,` +
      ` ${COLOR_WARNING} ${wPct}%, ${COLOR_WARNING} ${dPct}%,` +
      ` ${COLOR_DANGER} ${dPct}%, ${COLOR_DANGER} 100%)`;
    warningInput.style.zIndex = (w >= d) ? 5 : "";
  }

  warningInput.addEventListener("input", () => {
    if (Number(warningInput.value) > Number(dangerInput.value)) {
      dangerInput.value = warningInput.value;
    }
    updateDisplay();
    broadcast();
  });

  dangerInput.addEventListener("input", () => {
    if (Number(dangerInput.value) < Number(warningInput.value)) {
      warningInput.value = dangerInput.value;
    }
    updateDisplay();
    broadcast();
  });

  warningInput.addEventListener("change", save);
  dangerInput.addEventListener("change", save);

  return {
    setValues(w, d) {
      warningInput.value = w;
      dangerInput.value  = d;
      updateDisplay();
    },
    getWarning: () => Number(warningInput.value),
    getDanger:  () => Number(dangerInput.value),
  };
}

const day7Range  = setupDualRange("day7Range");
const hour5Range = setupDualRange("hour5Range");

showDay7Cb.addEventListener("change",  () => { broadcast(); save(); });
showHour5Cb.addEventListener("change", () => { broadcast(); save(); });

chrome.storage.sync.get(defaults, (s) => {
  showDay7Cb.checked  = s.showDay7;
  showHour5Cb.checked = s.showHour5;
  day7Range.setValues(s.day7Warning,  s.day7Danger);
  hour5Range.setValues(s.hour5Warning, s.hour5Danger);
});
