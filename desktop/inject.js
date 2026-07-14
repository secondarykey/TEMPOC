(function () {
  function post(obj) {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(JSON.stringify(obj));
      }
    } catch (e) {
      // ignore
    }
  }

  if (window.__tempocPatched) {
    // 既にパッチ済み。再注入時は使用量の再取得を試みる（下の tryRefetch を呼ぶ）。
    post({ type: "debug", msg: "inject: already patched, re-run" });
    if (typeof window.__tempocRefetch === "function") {
      window.__tempocRefetch();
    }
    return;
  }
  window.__tempocPatched = true;
  post({ type: "debug", msg: "inject: fetch patched" });
  console.debug("[TEMPOC] inject: fetch patched");

  // Announce the Wails runtime handshake so Go's WebviewWindow.ExecJS() will
  // actually run on this page. ExecJS is gated on runtimeLoaded, which normally
  // only flips true when @wailsio/runtime sends this message — claude.ai never
  // does. Sending the literal string ourselves flips the gate so the frontend's
  // refresh button can drive us via ExecJS (see main.go "tempoc:refresh").
  // Must be the raw string (not JSON) so Wails routes it to HandleMessage.
  try {
    if (window.chrome && window.chrome.webview) {
      window.chrome.webview.postMessage("wails:runtime:ready");
    }
  } catch (e) {
    // ignore
  }

  // アドレスバー: 現在の location.href をページ最下部に常時表示する
  // 読み取り専用オーバーレイ。アプリ内描画なので厳密な証明にはならない
  // （desktop/README.md の Trust 節を参照）が、どの URL に認証情報を
  // 入れているかを可視化する。pointer-events: none でページ操作は妨げない。
  // 最下部なのは claude.ai の上部ナビゲーションと視覚的に重ならないため
  // （クリックは透過するが、被ると下のボタンが狙いにくい）。
  var addressBarEl = null;
  function updateAddressBar() {
    if (!addressBarEl || !addressBarEl.isConnected) {
      if (!document.body) return; // document-start 直後は body がまだ無い
      addressBarEl = document.createElement("div");
      addressBarEl.id = "__tempoc-address-bar";
      addressBarEl.style.cssText =
        "position:fixed;bottom:0;left:0;right:0;height:22px;" +
        "z-index:2147483647;pointer-events:none;box-sizing:border-box;" +
        "padding:0 10px;background:rgba(6,7,15,0.88);color:#9aa6c0;" +
        "font:11px/22px Consolas,monospace;white-space:nowrap;" +
        "overflow:hidden;text-overflow:ellipsis;" +
        "border-top:1px solid rgba(255,255,255,0.15)";
      document.body.appendChild(addressBarEl);
    }
    if (addressBarEl.textContent !== window.location.href) {
      addressBarEl.textContent = window.location.href;
    }
  }

  // href（ハッシュ含む）の変化をネイティブのウィンドウタイトルにも反映する。
  // タイトルバーは OS が描画するため、ページ内オーバーレイより偽装耐性が
  // 一段高い表示になる（Go 側 "location" ハンドラが SetTitle する）。
  var lastHref = null;
  function reportLocation() {
    if (window.location.href === lastHref) return;
    lastHref = window.location.href;
    post({ type: "location", msg: lastHref });
  }

  // ログイン状態の遷移を常駐監視する。ログインの完了/失効は claude.ai 内の
  // SPA 遷移（新しいドキュメントを作らない）なので、document-start 注入の
  // このスクリプトは再実行されない。pathname をポーリングして /login への
  // 出入りを検知する:
  //   /login に入った → auth-required を Go へ（フロントがログインボタンを出す）
  //   /login から出た → ログイン成功なので使用量を能動取得（失敗に備えリトライ付き）
  // Google OAuth 等のフルページ遷移で戻るケースは新ドキュメントでスクリプト
  // 自体が再実行されるため、この監視がなくても初回取得が走る。
  var loginPath = /^\/login\b/;
  var lastPath = null; // null 始まり: 初回チェックでも「/login に入った」を検知する
  function watchAuthTransition() {
    var path = window.location.pathname;
    if (path === lastPath) return;
    var wasLogin = lastPath != null && loginPath.test(lastPath);
    var isLogin = loginPath.test(path);
    lastPath = path;
    if (isLogin && !wasLogin) {
      post({ type: "auth-required" });
      console.debug("[TEMPOC] login page detected");
    } else if (wasLogin && !isLogin) {
      // ログイン成功。SPA は /new に着地してハッシュ（#settings/usage）が
      // 失われるため、usage ページを開き直してモーダルを復元する。
      // リロード後は再注入スクリプトの初回取得がデータを届け、以後の
      // 自動更新はサイト自身の更新ボタンのクリックで行える（API 直叩きは
      // 極力使わない方針）。ハッシュが残っている稀なケースはモーダルが
      // 開いているので直接取得だけで足りる。
      if (window.location.hash === "#settings/usage") {
        post({ type: "debug", msg: "login completed, refetching" });
        window.__tempocRefetch();
      } else {
        post({ type: "debug", msg: "login completed, opening usage page" });
        window.location.replace("https://claude.ai/new#settings/usage");
      }
    }
  }

  var usagePattern = /^\/api\/organizations\/[^/]+\/usage$/;

  function resourceToPath(resource) {
    var url;
    if (typeof resource === "string") {
      url = resource;
    } else if (resource && typeof resource.url === "string") {
      url = resource.url;
    } else {
      return "";
    }
    try {
      return new URL(url, window.location.href).pathname;
    } catch (e) {
      return url;
    }
  }

  // Find a usage window by kind inside the `limits` array (the API's newer
  // shape). Returns the matching limit object (which carries utilization /
  // resets_at) or null.
  function findLimit(data, kind) {
    if (!data || !Array.isArray(data.limits)) return null;
    for (var i = 0; i < data.limits.length; i++) {
      if (data.limits[i] && data.limits[i].kind === kind) return data.limits[i];
    }
    return null;
  }

  // Normalize a window object to { utilization, resets_at }. The `limits`
  // entries carry the usage as `percent`, while the legacy top-level
  // seven_day/five_hour objects use `utilization` — accept either.
  function normalizeWindow(o) {
    if (!o) return undefined;
    var util = o.percent != null ? o.percent : o.utilization;
    return { utilization: util, resets_at: o.resets_at };
  }

  function handleUsageResponse(response) {
    response
      .clone()
      .json()
      .then(function (data) {
        console.debug("[TEMPOC] usage intercepted", data);
        // weekly_scoped lives as an entry in the `limits` array (its `kind`),
        // not as a top-level key. Fall back to a top-level key just in case.
        post({
          type: "usage",
          seven_day: normalizeWindow(data.seven_day || findLimit(data, "seven_day")),
          five_hour: normalizeWindow(data.five_hour || findLimit(data, "five_hour")),
          weekly_scoped: normalizeWindow(findLimit(data, "weekly_scoped") || data.weekly_scoped),
        });
      })
      .catch(function () {
        // non-JSON response, ignore
      });
  }

  var originalFetch = window.fetch;
  window.fetch = async function (...args) {
    var resource = args[0];
    var response = await originalFetch.apply(window, args);

    try {
      var path = resourceToPath(resource);
      // どのAPIが呼ばれているか可視化（デバッグ用・使用量以外も含む）
      if (path.indexOf("/api/") === 0) {
        console.debug("[TEMPOC] fetch:", path);
      }
      if (usagePattern.test(path)) {
        if (response.status === 401 || response.status === 403) {
          // サイト自身の使用量リクエストが認証エラー = ログアウトされた。
          post({ type: "debug", msg: "usage: unauthorized (" + response.status + ")" });
          post({ type: "auth-required" });
        } else {
          handleUsageResponse(response);
        }
      }
    } catch (e) {
      // ignore
    }

    return response;
  };

  // タイミング対策: パッチ前に既に使用量APIが呼ばれていた場合に備え、
  // 自分で使用量APIを叩いて取得を試みる。organization_id は
  // /api/organizations から取得する。成否の boolean で resolve する Promise を
  // 返す（refetchWithRetry がリトライ判定に使う）。
  window.__tempocRefetch = function () {
    return originalFetch("/api/organizations", { credentials: "include" })
      .then(function (r) {
        // 401/403 はログアウト（セッション失効）。ネットワークエラー等の
        // 一時障害（下の catch）とは区別し、認証エラーのときだけフロントを
        // ログイン前表示に戻す。
        if (r.status === 401 || r.status === 403) {
          post({ type: "debug", msg: "refetch: unauthorized (" + r.status + ")" });
          post({ type: "auth-required" });
          return false;
        }
        return r.json().then(function (orgs) {
          if (!Array.isArray(orgs) || orgs.length === 0) {
            // 実測ではログアウト状態でも 401 ではなく 200 + 空/非配列が
            // 返ることがある。正規アカウントに組織ゼロは無いので、これも
            // 未認証として扱う。
            post({ type: "debug", msg: "refetch: no organizations" });
            post({ type: "auth-required" });
            return false;
          }
          var orgId = orgs[0].uuid || orgs[0].id;
          console.debug("[TEMPOC] refetch usage for org", orgId);
          return originalFetch(
            "/api/organizations/" + orgId + "/usage",
            { credentials: "include" }
          ).then(function (r2) {
            if (r2.status === 401 || r2.status === 403) {
              post({ type: "auth-required" });
              return false;
            }
            handleUsageResponse(r2);
            return r2.ok;
          });
        });
      })
      .catch(function (e) {
        post({ type: "debug", msg: "refetch failed: " + e });
        return false;
      });
  };

  // Refresh by clicking claude.ai's own usage refresh button (id "_r_bb_"),
  // which re-requests the usage API — our patched fetch then intercepts the
  // fresh response. Preferred over calling the API directly so we exactly mirror
  // the site's own request (headers/CSRF/endpoint stay correct). Falls back to
  // __tempocRefetch if the button isn't present (e.g. Claude changed the id or
  // the modal isn't mounted). Used by both the manual refresh button (driven
  // from Go via ExecJS) and the auto-refresh interval below.
  window.__tempocClickRefresh = function () {
    // ログインページでは何もしない。特に下のモーダル復元リロードが走ると
    // ユーザーがメールアドレスや確認コードを入力している最中にページが
    // 消えてしまう。ログイン完了は watchAuthTransition が拾って usage
    // ページを開き直すので、ここで動く必要もない。
    if (loginPath.test(window.location.pathname)) {
      post({ type: "debug", msg: "refresh: on login page, skipped" });
      return;
    }
    var btn = document.getElementById("_r_bb_");
    if (btn) {
      post({ type: "debug", msg: "refresh: clicking usage button" });
      btn.click();
      return;
    }
    // ボタンが無い最有力の理由は usage モーダルが開いていないこと
    // （ログイン等の SPA 遷移でハッシュが失われる）。その場合は usage
    // ページを開き直してモーダルを復元する — リロード後の初回取得が
    // データを届け、次回以降はボタンが押せる。リロードループ防止:
    // 復元後（ハッシュが正しいのにボタンが無い = ID 変更等）は直叩きに
    // フォールバックし、二度と開き直さない。claude.ai 以外（OAuth 中の
    // 別サイト）では何もしない方が安全なので直叩き側に落とす。
    if (
      window.location.hostname === "claude.ai" &&
      window.location.hash !== "#settings/usage"
    ) {
      post({ type: "debug", msg: "refresh: modal lost, reopening usage page" });
      window.location.replace("https://claude.ai/new#settings/usage");
      return;
    }
    post({ type: "debug", msg: "refresh: button not found, refetching" });
    window.__tempocRefetch();
  };

  // 初回注入後、少し待ってから能動取得を1回試みる（SPA描画完了を待つ）。
  // 初回はまだ更新ボタン（_r_bb_）が DOM に無い可能性が高いので、直叩きの
  // __tempocRefetch で確実に1回取得する。未ログインでこのドキュメントが
  // /login のときは失敗するが、上の watchAuthTransition がログイン完了を
  // 検知して取り直す。
  setTimeout(window.__tempocRefetch, 1500);

  // 1秒ティック: ログイン遷移監視 + アドレスバー描画/更新 + タイトル用の
  // location 通知。即時1回実行で document-start 時点の /login も従来どおり
  // 遅延なく auth-required になる（バーは body 出現後のティックから描画）。
  function tick() {
    watchAuthTransition();
    updateAddressBar();
    reportLocation();
  }
  tick();
  setInterval(tick, 1000);

  // The refresh-interval placeholder below (do NOT spell it out in comments —
  // Go string-replaces every occurrence of the token) is filled in by main.go
  // at window-creation time with settings.RefreshInterval*60000 (0 = disabled).
  // Because this
  // script is only pushed into the Claude window once, at startup, changing
  // the refresh interval in the Settings UI only takes effect on next app
  // launch. Repeated auto-refreshes go through the site's own button
  // (__tempocClickRefresh) rather than hitting the API directly, so recurring
  // traffic mirrors normal usage; it falls back to __tempocRefetch if the
  // button isn't there.
  var refreshMs = __TEMPOC_REFRESH_MS__;
  if (refreshMs > 0) {
    setInterval(window.__tempocClickRefresh, refreshMs);
  }
})();
