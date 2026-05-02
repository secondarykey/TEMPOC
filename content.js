const Day7ProgressElementId = "day7Progress";
const Day7ElementPATH = "main > div > div > div > section:nth-child(2) > div:nth-child(2) > div > div:nth-child(2)";
var day7Elm = undefined;
var day7Obj = undefined

const Hour5ProgressElementId = "hour5Progress";
const Hour5ElementPATH = "main > div > div > div > section:nth-child(1) > div:nth-child(2) > div:nth-child(1) > div"
var hour5Elm = undefined;
var hour5Obj = undefined

var locale = undefined;

function waitForElement(selector) {
  return new Promise((resolve) => {
    // 既に存在する場合は即座に返す
    const element = document.querySelector(selector);
    if (element) {
      return resolve(element);
    }

    // 監視の開始
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect(); // 見つかったら監視を止める
        resolve(element);
      }
    });

    // body全体の変化（子要素や階層すべて）を監視
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  });
}

async function createElement(id,path) {

  var prog = document.querySelector("#" + id);
  if ( prog !== null ) {
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
    patterns.forEach( (p) => {
        if ( p.test(r) ) {
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
        //seconds: Math.floor((ms / 1000) % 60)
}

function redraw(elm,obj) {

    if ( elm === undefined ) {
        return false;
    }
    if ( obj === undefined ) {
        return false;
    }

    const val = obj.utilization;
    const now = new Date();
    const end = new Date(obj.resets_at)

    const start = new Date(end);
    if ( elm.id === Day7ProgressElementId ) {
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


    var suffix = "";
    if ( elm.id === Day7ProgressElementId ) {
      const df = new Intl.DurationFormat(locale, { style: 'short' });
      suffix = " (" + df.format(duration) + ")";
    }

    divs[0].children[0].textContent = end.toLocaleString(locale,{
        month: 'numeric',
        day: 'numeric',
        hour: 'numeric',
        minute: 'numeric',
        weekday: 'short'}) + suffix;

    const bar = divs[1].children[0].children[0].children[0];
    bar.style.width = percent + "%"
    bar.classList.remove("bg-fill-danger","bg-fill-warning","bg-fill-accent");

    if ( (val - percent) > 10 ) {
      bar.classList.add("bg-fill-danger");
    } else if ( (val - percent) > 0 ) {
      bar.classList.add("bg-fill-warning");
    } else {
      bar.classList.add("bg-fill-accent");
    }

    //bar.classList.add("bg-fill-warning");
    // bg-fill-danger (使用量が10% 超えてる場合)
    // bg-fill-warning (10% 未満)
    // bg-fill-accent (通常色)

    //divs[1].children[0].children[0].children[0].style.width = percent + "%"

    divs[1].children[1].textContent = percent.toFixed(2) + "%";

    return true;
}


const { fetch: originalFetch } = window;
// window.fetch を自作関数で上書き
window.fetch = async (...args) => {
  const [resource, config] = args;
  // 1. リクエストをそのまま実行
  const response = await originalFetch(resource, config);

  //console.debug(resource);

  if ( !isTargetAPI(resource) ) {
      return response;
  }

  // 2. レスポンスをコピーして中身を覗く
  // ※ response.json() などを直接呼ぶと、ページ側の処理でエラーになるため clone() する
  response.clone().json().then(data => {

    console.debug("API:", resource);

    if ( resource === "/api/account_profile" ) {
        locale = data.locale;
        redraw(day7Elm,day7Obj);
        redraw(hour5Elm,hour5Obj);
        return;
    }

    locale = document.documentElement.lang;

    //console.debug("5 hour:", data.five_hour.resets_at,data.five_hour.utilization);
    //console.debug("7 days:", data.seven_day.resets_at,data.seven_day.utilization);
    day7Obj = data.seven_day;
    redraw(day7Elm,day7Obj);

    hour5Obj = data.five_hour;
    redraw(hour5Elm,hour5Obj);

  }).catch(err => {
    // JSON ではない場合などは無視
  });
  // 3. ページ側の元の処理には、元のレスポンスをそのまま返す
  return response;
};

createElement(Day7ProgressElementId,Day7ElementPATH).then( (elm) => {
    console.debug("day7",elm)
    day7Elm = elm;
    redraw(day7Elm,day7Obj);
});

createElement(Hour5ProgressElementId,Hour5ElementPATH).then( (elm) => {
    console.debug("hour5",elm)
    hour5Elm = elm;
    redraw(hour5Elm,hour5Obj);
});

