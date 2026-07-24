const Day7ProgressElementId = "day7Progress";
const Hour5ProgressElementId = "hour5Progress";

const DialogSectionsPATH = '[role="dialog"] > div:nth-child(2) > div:last-child > div:last-child';
// 使用量行 = 2番目の子にメーター(div>div>div)を持つ行。告知バナー等が
// セクション先頭に挿入されても位置がずれないよう nth-child ではなく :has で特定する
const UsageRowFilter = ":has(> div:nth-child(2) > div > div > div)";
const Hour5ElementPATH = DialogSectionsPATH + " > section:nth-child(1) > div:nth-child(2) > div > div" + UsageRowFilter;
const Hour5ElementBarPATH = Hour5ElementPATH + " > div:nth-child(2) > div > div > div";
const Day7ElementPATH = DialogSectionsPATH + " > section:nth-child(2) > div:nth-child(2) > div > div" + UsageRowFilter;
const Day7ElementBarPATH = Day7ElementPATH + " > div:nth-child(2) > div > div > div";

var day7Elm = undefined;
var day7Obj = undefined;
var day7Danger = 10;
var day7Warning = 0;
var day7ColorEnabled = true;

var hour5Elm = undefined;
var hour5Obj = undefined;
var hour5Danger = 10;
var hour5Warning = 0;
var hour5ColorEnabled = true;

var locale = undefined;
var decimalPlaces = 2;
var durationStyle = 'short';
var showRemainDay7 = true;
var showRemainHour5 = false;
var percentFormat = '{}%';
var refreshInterval = 0;
var refreshTimer = null;
var utilizationWarning = 98;
var utilizationDanger  = 100;

// Desired color state — enforced against Claude's React re-renders
var day7BarColor = null;
var hour5BarColor = null;
var day7BarObserver = null;
var hour5BarObserver = null;
var day7ElapsedObserver = null;
var hour5ElapsedObserver = null;

function makeBarObserver(barPath, getColor) {
  const bar = document.querySelector(barPath);
  if (!bar) return null;
  const obs = new MutationObserver(() => {
    const desired = getColor();
    if (!desired) return;
    const b = document.querySelector(barPath);
    if (b && !b.classList.contains(desired)) {
      b.classList.remove("bg-fill-danger", "bg-fill-warning", "bg-fill-accent");
      b.classList.add(desired);
    }
  });
  obs.observe(bar, { attributes: true, attributeFilter: ["class"] });
  return obs;
}

function makeElapsedBarObserver(bar) {
  if (!bar) return null;
  const obs = new MutationObserver(() => {
    if (!bar.classList.contains("bg-fill-accent")) {
      bar.classList.remove("bg-fill-danger", "bg-fill-warning");
      bar.classList.add("bg-fill-accent");
    }
  });
  obs.observe(bar, { attributes: true, attributeFilter: ["class"] });
  return obs;
}

function waitForElement(selector) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      return resolve(element);
    }

    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });

    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

const _createElementInFlight = {};

async function createElement(id, path) {
  var prog = document.querySelector("#" + id);
  if (prog !== null) {
    return prog;
  }

  // 並走する呼び出しが既にあれば同じ Promise を返して重複挿入を防ぐ
  if (_createElementInFlight[id]) {
    return _createElementInFlight[id];
  }

  const promise = (async () => {
    var target = await waitForElement(path);

    // await 後に再確認（別の呼び出しが先に挿入済みの場合）
    var existing = document.querySelector("#" + id);
    if (existing !== null) {
      return existing;
    }

    var cp = target.cloneNode(true);

    var divs = cp.querySelectorAll(":scope > div");
    divs[0].removeChild(divs[0].children[0]);

    const meter = divs[1].children[0].children[0];
    let bar = meter.children[0];
    if (!bar) {
      bar = document.createElement("div");
      // Claude 現行メーターに合わせ w-full + transition-transform（塗りは translateX）
      bar.className = "h-full w-full rounded-full transition-transform duration-base ease-out motion-reduce:transition-none";
      meter.appendChild(bar);
    }
    bar.classList.remove("bg-fill-danger", "bg-fill-warning");
    bar.classList.add("bg-fill-accent");

    cp.id = id;
    target.after(cp);
    return cp;
  })();

  _createElementInFlight[id] = promise;
  promise.finally(() => { delete _createElementInFlight[id]; });
  return promise;
}

const patterns = [
  /^\/api\/organizations\/[^/]+\/usage$/,
  /^\/api\/account_profile$/
];

function isTargetAPI(r) {
  var m = false;
  patterns.forEach((p) => {
    if (p.test(r)) {
      m = true;
    }
  });
  return m;
}

function createDuration(ms) {
  if (ms < 0) ms = 0;
  return {
    days: Math.floor(ms / (1000 * 60 * 60 * 24)),
    hours: Math.floor((ms / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((ms / (1000 * 60)) % 60),
  };
}

function applyBarColor(barPath, colorClass) {
  const bar = document.querySelector(barPath);
  if (!bar) return;
  bar.classList.remove("bg-fill-danger", "bg-fill-warning", "bg-fill-accent");
  bar.classList.add(colorClass);
}

function redraw(elm, obj, dangerAt, warningAt, colorEnabled) {
  if (elm === undefined) return false;
  if (obj === undefined) return false;

  const val = obj.utilization;
  const now = new Date();

  const notStarted = obj.resets_at === null;
  const end = new Date(obj.resets_at);

  const start = new Date(end);

  if (elm.id === Day7ProgressElementId) {
    start.setDate(end.getDate() - 7);
  } else {
    start.setHours(end.getHours() - 5);
  }

  const total = end - start;
  const elapsed = now - start;
  const remain = end - now;
  const percent = (elapsed / total) * 100;

  const duration = createDuration(remain);
  const divs = elm.querySelectorAll(":scope > div");

  const showRemain = (elm.id === Day7ProgressElementId) ? showRemainDay7 : showRemainHour5;
  var suffix = "";
  if (showRemain) {
    const df = new Intl.DurationFormat(locale, { style: durationStyle });
    suffix = " (" + df.format(duration) + ")";
  }

  divs[0].children[0].textContent = notStarted ? "" : end.toLocaleString(locale, {
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    weekday: 'short'
  }) + suffix;

  // 経過時間バー（TEMPOC 注入）: 塗り量と色を更新し、Observerで保護。
  // Claude はメーターの塗りを width ではなく full幅 + translateX オフセットで
  // 表現する（fill は w-full のまま、左に translateX して見える部分を出す）。
  // width を書き替えるとクローン元の translateX が残って左にずれるため、
  // width は 100% 固定にし、Claude と同じ translateX 方式で塗り量を出す。
  const bar = divs[1].children[0]?.children[0]?.children[0];
  if (!bar) return false;
  const fill = notStarted ? 0 : Math.min(percent, 100);
  bar.style.width = "100%";
  bar.style.transform = "translateX(-" + (100 - fill) + "%)";
  bar.classList.remove("bg-fill-danger", "bg-fill-warning");
  bar.classList.add("bg-fill-accent");
  if (elm.id === Day7ProgressElementId) {
    if (!day7ElapsedObserver) day7ElapsedObserver = makeElapsedBarObserver(bar);
  } else {
    if (!hour5ElapsedObserver) hour5ElapsedObserver = makeElapsedBarObserver(bar);
  }

  divs[1].children[1].textContent =
    notStarted ? "" : percentFormat.replace('{}', percent.toFixed(decimalPlaces));

  // 使用率バー（Claude 本来のバー）: 閾値に応じて色付け
  const barPath = (elm.id === Day7ProgressElementId) ? Day7ElementBarPATH : Hour5ElementBarPATH;

  let colorClass;
  if (colorEnabled) {
    if (val >= utilizationDanger) {
      colorClass = "bg-fill-danger";
    } else {
      const diff = val - percent;
      if (diff > dangerAt) {
        colorClass = "bg-fill-danger";
      } else if (diff > warningAt || val >= utilizationWarning) {
        colorClass = "bg-fill-warning";
      } else {
        colorClass = "bg-fill-accent";
      }
    }
    console.debug("[TEMPOC] redraw", elm.id, {
      utilization: val,
      elapsedPercent: percent.toFixed(2),
      diff: (val - percent).toFixed(2),
      dangerAt, warningAt,
      color: colorClass,
      resets_at: obj.resets_at,
    });
  } else {
    colorClass = "bg-fill-accent";
  }

  // Store desired color and enforce via observer
  if (elm.id === Day7ProgressElementId) {
    day7BarColor = colorClass;
    if (!day7BarObserver) {
      day7BarObserver = makeBarObserver(barPath, () => day7BarColor);
    }
  } else {
    hour5BarColor = colorClass;
    if (!hour5BarObserver) {
      hour5BarObserver = makeBarObserver(barPath, () => hour5BarColor);
    }
  }
  applyBarColor(barPath, colorClass);

  return true;
}

function setupRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (refreshInterval > 0) {
    refreshTimer = setInterval(() => {
      redraw(day7Elm, day7Obj, day7Danger, day7Warning, day7ColorEnabled);
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning, hour5ColorEnabled);
    }, refreshInterval * 60 * 1000);
  }
}

const { fetch: originalFetch } = window;
window.fetch = async (...args) => {
  const [resource, config] = args;
  const response = await originalFetch(resource, config);

  if (!isTargetAPI(resource)) {
    return response;
  }

  response.clone().json().then(data => {
    console.debug("API:", resource);

    if (resource === "/api/account_profile") {
      locale = data.locale;
      window.dispatchEvent(new CustomEvent("tempoc:locale", { detail: locale }));
      redraw(day7Elm, day7Obj, day7Danger, day7Warning, day7ColorEnabled);
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning, hour5ColorEnabled);
      return;
    }

    locale = document.documentElement.lang;
    window.dispatchEvent(new CustomEvent("tempoc:locale", { detail: locale }));

    day7Obj = data.seven_day;
    console.debug(day7Obj);
    redraw(day7Elm, day7Obj, day7Danger, day7Warning, day7ColorEnabled);

    hour5Obj = data.five_hour;
    console.debug(hour5Obj);
    redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning, hour5ColorEnabled);

  }).catch(err => {
    // JSON ではない場合などは無視
  });
  return response;
};

function applySettings(settings) {
  const { showDay7, showHour5 } = settings;

  day7Danger        = settings.day7Danger        ?? 10;
  day7Warning       = settings.day7Warning       ?? 0;
  day7ColorEnabled  = settings.day7ColorEnabled  ?? true;
  if (!day7ColorEnabled) {
    day7BarColor = "bg-fill-accent";
    applyBarColor(Day7ElementBarPATH, "bg-fill-accent");
  }
  hour5Danger       = settings.hour5Danger       ?? 10;
  hour5Warning      = settings.hour5Warning      ?? 0;
  hour5ColorEnabled = settings.hour5ColorEnabled ?? true;
  if (!hour5ColorEnabled) {
    hour5BarColor = "bg-fill-accent";
    applyBarColor(Hour5ElementBarPATH, "bg-fill-accent");
  }
  showRemainDay7  = settings.showRemainDay7  ?? true;
  showRemainHour5 = settings.showRemainHour5 ?? false;
  decimalPlaces   = settings.decimalPlaces   ?? 2;
  durationStyle   = settings.durationStyle   ?? 'short';
  percentFormat   = settings.percentFormat   ?? '{}%';
  refreshInterval    = settings.refreshInterval    ?? 0;
  utilizationWarning = settings.utilizationWarning ?? 98;
  utilizationDanger  = settings.utilizationDanger  ?? 100;
  setupRefreshTimer();

  if (showDay7) {
    if (!day7Elm) {
      createElement(Day7ProgressElementId, Day7ElementPATH).then((elm) => {
        day7Elm = elm;
        redraw(day7Elm, day7Obj, day7Danger, day7Warning, day7ColorEnabled);
      });
    } else {
      day7Elm.style.display = "";
      redraw(day7Elm, day7Obj, day7Danger, day7Warning, day7ColorEnabled);
    }
  } else if (day7Elm) {
    day7Elm.style.display = "none";
  }

  if (showHour5) {
    if (!hour5Elm) {
      createElement(Hour5ProgressElementId, Hour5ElementPATH).then((elm) => {
        hour5Elm = elm;
        redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning, hour5ColorEnabled);
      });
    } else {
      hour5Elm.style.display = "";
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning, hour5ColorEnabled);
    }
  } else if (hour5Elm) {
    hour5Elm.style.display = "none";
  }
}

// bridge.js (ISOLATED world) から設定を受け取る（初期 + SPA 再ナビゲーション）
window.addEventListener("tempoc:settings", (e) => {
  applySettings(e.detail);
});

// オプション画面での変更を即時反映
window.addEventListener("tempoc:settings-changed", (e) => {
  applySettings(e.detail);
});

// リスナー登録完了を bridge.js に通知して設定を要求する
window.dispatchEvent(new CustomEvent("tempoc:ready"));

// SPA ナビゲーション検知: DOM 参照をリセットして bridge.js に再初期化を促す
function onNavigate() {
  day7Elm  = undefined;
  hour5Elm = undefined;
  if (day7BarObserver)      { day7BarObserver.disconnect();      day7BarObserver      = null; }
  if (hour5BarObserver)     { hour5BarObserver.disconnect();     hour5BarObserver     = null; }
  if (day7ElapsedObserver)  { day7ElapsedObserver.disconnect();  day7ElapsedObserver  = null; }
  if (hour5ElapsedObserver) { hour5ElapsedObserver.disconnect(); hour5ElapsedObserver = null; }
  day7BarColor  = null;
  hour5BarColor = null;
  window.dispatchEvent(new CustomEvent("tempoc:navigate"));
}

const origPush    = history.pushState.bind(history);
const origReplace = history.replaceState.bind(history);
history.pushState    = (...a) => { origPush(...a);    onNavigate(); };
history.replaceState = (...a) => { origReplace(...a); onNavigate(); };
window.addEventListener("popstate", onNavigate);
window.addEventListener("hashchange", onNavigate);
