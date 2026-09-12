const Day7ProgressElementId = "day7Progress";
const Hour5ProgressElementId = "hour5Progress";

// claude.ai のダイアログは CDS コンポーネント化され、section の並びも
// ラッパ div の階層も頻繁に変わる。唯一安定している足掛かりが
// メーターの role="meter" なので、そこを起点に行を引き当てる。
const MeterSelector = '[role="dialog"] [role="meter"]';
// TEMPOC が挿入したクローン行の目印。行探索でクローンを除外するのに使う
const TempocAttr = "data-tempoc";
// メーターから行までの最大階層。現状は4段(メーター→w-full→flex-1→メーター欄→行)
const MaxRowDepth = 8;

// 使用量2行(5時間/7日)を返す。行そのものは
// 「2つのメーターの最近共通祖先(=行コンテナ)の直下の子」として求めるので、
// クラス名にも階層数にも依存しない。順序は DOM 順 = 5時間, 7日。
function findUsageRows() {
  const meters = Array.from(document.querySelectorAll(MeterSelector))
    .filter((m) => !m.closest("[" + TempocAttr + "]"));
  if (meters.length < 2) return null;

  const first = meters[0];
  const second = meters[1];

  const ancestors = new Set();
  for (let e = first; e; e = e.parentElement) ancestors.add(e);
  let container = second;
  while (container && !ancestors.has(container)) container = container.parentElement;
  if (!container) return null;

  const rowOf = (m) => {
    let e = m;
    let depth = 0;
    while (e && e.parentElement !== container) {
      e = e.parentElement;
      // 2行が別コンテナに分かれた場合、共通祖先はずっと上になり
      // 「行」としてセクション丸ごとを掴んでしまう。深すぎたら不成立扱いにして、
      // 巨大な複製を挿し込むより何も出さない方を選ぶ
      if (++depth > MaxRowDepth) return null;
    }
    return e;
  };
  const hour5 = rowOf(first);
  const day7 = rowOf(second);
  if (!hour5 || !day7 || hour5 === day7) return null;
  return { hour5: hour5, day7: day7 };
}

// 行の中の塗りバー。メーターの唯一の子が塗り
function fillBarOf(row) {
  const meter = row ? row.querySelector('[role="meter"]') : null;
  return meter ? meter.firstElementChild : null;
}

// Claude 本来の行(クローンではない側)を id から引く。React の再描画で
// ノードが差し替わるため、キャッシュせず都度引き直す
function originalRow(id) {
  const rows = findUsageRows();
  if (!rows) return null;
  return id === Day7ProgressElementId ? rows.day7 : rows.hour5;
}

function originalBar(id) {
  return fillBarOf(originalRow(id));
}

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

function makeBarObserver(getBar, getColor) {
  const bar = getBar();
  if (!bar) return null;
  const obs = new MutationObserver(() => {
    const desired = getColor();
    if (!desired) return;
    const b = getBar();
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

function waitForRows() {
  return new Promise((resolve) => {
    const rows = findUsageRows();
    if (rows) {
      return resolve(rows);
    }

    const observer = new MutationObserver((mutations, obs) => {
      const r = findUsageRows();
      if (r) {
        obs.disconnect();
        resolve(r);
      }
    });

    // document_start で走るため body はまだ存在しない場合がある。
    // documentElement を監視すれば body 生成後の挿入も拾える
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
  });
}

const _createElementInFlight = {};

async function createElement(id) {
  var prog = document.querySelector("#" + id);
  if (prog !== null) {
    return prog;
  }

  // 並走する呼び出しが既にあれば同じ Promise を返して重複挿入を防ぐ
  if (_createElementInFlight[id]) {
    return _createElementInFlight[id];
  }

  const promise = (async () => {
    const rows = await waitForRows();
    const target = (id === Day7ProgressElementId) ? rows.day7 : rows.hour5;

    // await 後に再確認（別の呼び出しが先に挿入済みの場合）
    var existing = document.querySelector("#" + id);
    if (existing !== null) {
      return existing;
    }

    var cp = target.cloneNode(true);

    // 行探索がクローンを本来の行と取り違えないよう、まず目印を付ける
    cp.id = id;
    cp.setAttribute(TempocAttr, "");

    var divs = cp.querySelectorAll(":scope > div");
    divs[0].removeChild(divs[0].children[0]);

    const meter = cp.querySelector('[role="meter"]');
    if (!meter) return null;
    // クローン元の使用率がスクリーンリーダーに残らないよう、aria 値は捨てる
    // (経過時間の値は redraw() が入れ直す)
    meter.removeAttribute("aria-valuenow");
    meter.removeAttribute("aria-valuetext");
    meter.removeAttribute("aria-labelledby");
    let bar = meter.firstElementChild;
    if (!bar) {
      bar = document.createElement("div");
      // Claude 現行メーターに合わせ w-full + transition-transform（塗りは translateX）
      bar.className = "h-full w-full rounded-full transition-transform duration-base ease-out motion-reduce:transition-none";
      meter.appendChild(bar);
    }
    bar.classList.remove("bg-fill-danger", "bg-fill-warning");
    bar.classList.add("bg-fill-accent");

    // クローン元(使用量行)の値をそのまま出さない。usage API 応答前に挿入されると
    // 使用量の日時・%・塗り量が経過時間バーの値として見えてしまうため、
    // redraw() が最初のデータで上書きするまで空・塗り 0 にしておく
    if (divs[0].children[0]) divs[0].children[0].textContent = "";
    if (divs[1].children[1]) divs[1].children[1].textContent = "";
    bar.style.width = "100%";
    bar.style.transform = "translateX(-100%)";

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

function applyBarColor(bar, colorClass) {
  if (!bar) return;
  bar.classList.remove("bg-fill-danger", "bg-fill-warning", "bg-fill-accent");
  bar.classList.add(colorClass);
}

function redraw(elm, obj, dangerAt, warningAt, colorEnabled) {
  if (!elm) return false;
  if (!obj) return false;

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
  const bar = fillBarOf(elm);
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

  const percentText = notStarted
    ? ""
    : percentFormat.replace('{}', percent.toFixed(decimalPlaces));
  divs[1].children[1].textContent = percentText;

  const meter = elm.querySelector('[role="meter"]');
  if (meter) {
    meter.setAttribute("aria-valuenow", String(Math.round(fill)));
    meter.setAttribute("aria-valuetext", percentText);
  }

  // 使用率バー（Claude 本来のバー）: 閾値に応じて色付け
  const getOriginalBar = () => originalBar(elm.id);

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
      day7BarObserver = makeBarObserver(getOriginalBar, () => day7BarColor);
    }
  } else {
    hour5BarColor = colorClass;
    if (!hour5BarObserver) {
      hour5BarObserver = makeBarObserver(getOriginalBar, () => hour5BarColor);
    }
  }
  applyBarColor(getOriginalBar(), colorClass);

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
    applyBarColor(originalBar(Day7ProgressElementId), "bg-fill-accent");
  }
  hour5Danger       = settings.hour5Danger       ?? 10;
  hour5Warning      = settings.hour5Warning      ?? 0;
  hour5ColorEnabled = settings.hour5ColorEnabled ?? true;
  if (!hour5ColorEnabled) {
    hour5BarColor = "bg-fill-accent";
    applyBarColor(originalBar(Hour5ProgressElementId), "bg-fill-accent");
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
      createElement(Day7ProgressElementId).then((elm) => {
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
      createElement(Hour5ProgressElementId).then((elm) => {
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

// リスナー登録完了を bridge.js に通知して設定を要求する。
// document_start では bridge.js の登録順に依存しないよう DOM 構築後にも再送する
// (applySettings は冪等なので二重送信しても問題ない)
window.dispatchEvent(new CustomEvent("tempoc:ready"));
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    window.dispatchEvent(new CustomEvent("tempoc:ready"));
  });
}

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
