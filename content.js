const Day7ProgressElementId = "day7Progress";
const Day7ElementPATH = "main > div > div > div > section:nth-child(2) > div:nth-child(2) > div > div:nth-child(2)";
var day7Elm = undefined;
var day7Obj = undefined;
var day7Danger = 10;
var day7Warning = 0;

const Hour5ProgressElementId = "hour5Progress";
const Hour5ElementPATH = "main > div > div > div > section:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div"
var hour5Elm = undefined;
var hour5Obj = undefined;
var hour5Danger = 10;
var hour5Warning = 0;

var locale = undefined;
var decimalPlaces = 2;
var durationStyle = 'short';
var showRemainDay7 = true;
var showRemainHour5 = false;
var percentFormat = '{}%';
var refreshInterval = 0;
var refreshTimer = null;

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

async function createElement(id, path) {
  var prog = document.querySelector("#" + id);
  if (prog !== null) {
    return prog;
  }

  var target = await waitForElement(path);
  var cp = target.cloneNode(true);

  var divs = cp.querySelectorAll(":scope > div");
  divs[0].removeChild(divs[0].children[0])

  cp.id = id;
  target.after(cp);
  return cp;
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

function redraw(elm, obj, dangerAt, warningAt) {
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

  const bar = divs[1].children[0].children[0].children[0];
  bar.style.width = notStarted ? "0%" : percent + "%";
  bar.classList.remove("bg-fill-danger", "bg-fill-warning", "bg-fill-accent");

  const diff = val - percent;
  if (diff > dangerAt) {
    bar.classList.add("bg-fill-danger");
  } else if (diff > warningAt) {
    bar.classList.add("bg-fill-warning");
  } else {
    bar.classList.add("bg-fill-accent");
  }

  divs[1].children[1].textContent = 
        notStarted ? "" : percentFormat.replace('{}', percent.toFixed(decimalPlaces));

  return true;
}

function setupRefreshTimer() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (refreshInterval > 0) {
    refreshTimer = setInterval(() => {
      redraw(day7Elm, day7Obj, day7Danger, day7Warning);
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning);
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
      redraw(day7Elm, day7Obj, day7Danger, day7Warning);
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning);
      return;
    }

    locale = document.documentElement.lang;

    day7Obj = data.seven_day;
    console.debug(day7Obj);
    redraw(day7Elm, day7Obj, day7Danger, day7Warning);

    hour5Obj = data.five_hour;
    console.debug(hour5Obj);
    redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning);

  }).catch(err => {
    // JSON ではない場合などは無視
  });
  return response;
};

function applySettings(settings) {
  const { showDay7, showHour5 } = settings;

  day7Danger      = settings.day7Danger      ?? 10;
  day7Warning     = settings.day7Warning     ?? 0;
  hour5Danger     = settings.hour5Danger     ?? 10;
  hour5Warning    = settings.hour5Warning    ?? 0;
  showRemainDay7  = settings.showRemainDay7  ?? true;
  showRemainHour5 = settings.showRemainHour5 ?? false;
  decimalPlaces   = settings.decimalPlaces   ?? 2;
  durationStyle   = settings.durationStyle   ?? 'short';
  percentFormat   = settings.percentFormat   ?? '{}%';
  refreshInterval = settings.refreshInterval ?? 0;
  setupRefreshTimer();

  if (showDay7) {
    if (!day7Elm) {
      createElement(Day7ProgressElementId, Day7ElementPATH).then((elm) => {
        day7Elm = elm;
        redraw(day7Elm, day7Obj, day7Danger, day7Warning);
      });
    } else {
      day7Elm.style.display = "";
      redraw(day7Elm, day7Obj, day7Danger, day7Warning);
    }
  } else if (day7Elm) {
    day7Elm.style.display = "none";
  }

  if (showHour5) {
    if (!hour5Elm) {
      createElement(Hour5ProgressElementId, Hour5ElementPATH).then((elm) => {
        hour5Elm = elm;
        redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning);
      });
    } else {
      hour5Elm.style.display = "";
      redraw(hour5Elm, hour5Obj, hour5Danger, hour5Warning);
    }
  } else if (hour5Elm) {
    hour5Elm.style.display = "none";
  }
}

// bridge.js (ISOLATED world) から初期設定を受け取る
window.addEventListener("tempoc:settings", (e) => {
  applySettings(e.detail);
}, { once: true });

// オプション画面での変更を即時反映
window.addEventListener("tempoc:settings-changed", (e) => {
  applySettings(e.detail);
});
