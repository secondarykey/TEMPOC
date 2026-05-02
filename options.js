const status             = document.getElementById("status");
const showDay7Cb         = document.getElementById("showDay7");
const showHour5Cb        = document.getElementById("showHour5");
const showRemainDay7Cb   = document.getElementById("showRemainDay7");
const showRemainHour5Cb  = document.getElementById("showRemainHour5");
const decimalPlacesSel   = document.getElementById("decimalPlaces");
const durationStyleSel   = document.getElementById("durationStyle");
const percentFormatIn    = document.getElementById("percentFormat");
const enableRefreshCb    = document.getElementById("enableRefresh");
const refreshMinutesIn   = document.getElementById("refreshMinutes");

const defaults = {
  showDay7: true, showHour5: true,
  day7Danger: 10, day7Warning: 0,
  hour5Danger: 10, hour5Warning: 0,
  showRemainDay7: true, showRemainHour5: false,
  decimalPlaces: 2,
  durationStyle: 'short',
  percentFormat: '{}%',
  refreshInterval: 0,
};

const cs = getComputedStyle(document.documentElement);
const COLOR_ACCENT  = cs.getPropertyValue("--color-accent").trim();
const COLOR_WARNING = cs.getPropertyValue("--color-warning").trim();
const COLOR_DANGER  = cs.getPropertyValue("--color-danger").trim();

function getCurrentSettings() {
  return {
    showDay7:        showDay7Cb.checked,
    showHour5:       showHour5Cb.checked,
    showRemainDay7:  showRemainDay7Cb.checked,
    showRemainHour5: showRemainHour5Cb.checked,
    day7Warning:     day7Range.getWarning(),
    day7Danger:      day7Range.getDanger(),
    hour5Warning:    hour5Range.getWarning(),
    hour5Danger:     hour5Range.getDanger(),
    decimalPlaces:   Number(decimalPlacesSel.value),
    durationStyle:   durationStyleSel.value,
    percentFormat:   percentFormatIn.value || '{}%',
    refreshInterval: enableRefreshCb.checked ? Number(refreshMinutesIn.value) : 0,
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
    status.textContent = "Saved";
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

enableRefreshCb.addEventListener("change", () => {
  refreshMinutesIn.disabled = !enableRefreshCb.checked;
  broadcast();
  save();
});

[showDay7Cb, showHour5Cb, showRemainDay7Cb, showRemainHour5Cb].forEach(el => {
  el.addEventListener("change", () => { broadcast(); save(); });
});

[decimalPlacesSel, durationStyleSel].forEach(el => {
  el.addEventListener("change", () => { broadcast(); save(); });
});

percentFormatIn.addEventListener("change", save);
percentFormatIn.addEventListener("input",  broadcast);

refreshMinutesIn.addEventListener("change", save);
refreshMinutesIn.addEventListener("input", () => {
  if (enableRefreshCb.checked) broadcast();
});

chrome.storage.sync.get(defaults, (s) => {
  showDay7Cb.checked        = s.showDay7;
  showHour5Cb.checked       = s.showHour5;
  showRemainDay7Cb.checked  = s.showRemainDay7;
  showRemainHour5Cb.checked = s.showRemainHour5;
  day7Range.setValues(s.day7Warning,   s.day7Danger);
  hour5Range.setValues(s.hour5Warning, s.hour5Danger);
  decimalPlacesSel.value    = s.decimalPlaces;
  durationStyleSel.value    = s.durationStyle;
  percentFormatIn.value     = s.percentFormat;
  enableRefreshCb.checked   = s.refreshInterval > 0;
  refreshMinutesIn.value    = s.refreshInterval > 0 ? s.refreshInterval : 5;
  refreshMinutesIn.disabled = !enableRefreshCb.checked;
});
