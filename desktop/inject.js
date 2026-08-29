(function () {
  // Host bridge. The WebView — and therefore the JS API that reaches Go —
  // differs per platform:
  //   Windows: WebView2   → window.chrome.webview.postMessage
  //   macOS:   WKWebView  → window.webkit.messageHandlers.external.postMessage
  //   Linux:   WebKitGTK  → same as macOS
  // Wails registers the handler name "external" on both webkit backends
  // (pkg/application/webview_window_darwin.go, linux_cgo.go). All three accept a
  // string body and funnel into the same Go-side routing, where payloads
  // starting with "wails:" are handled internally by Wails and everything else
  // reaches Options.RawMessageHandler — so the payloads below are identical on
  // every platform. WebView2 is probed first, leaving Windows behaviour
  // unchanged. Returns whether a transport accepted the payload.
  function sendToHost(payload) {
    try {
      if (window.chrome && window.chrome.webview) {
        window.chrome.webview.postMessage(payload);
        return true;
      }
      var handlers = window.webkit && window.webkit.messageHandlers;
      if (handlers && handlers.external) {
        handlers.external.postMessage(payload);
        return true;
      }
    } catch (e) {
      // ignore
    }
    return false;
  }

  function post(obj) {
    sendToHost(JSON.stringify(obj));
  }

  // 未認証の通知は必ずここを通す。カウンタを見れば「取得に失敗した理由が
  // 未認証だったか（＝リトライしても無駄）」が分かり、refetchWithRetry が
  // 一時障害と区別できる。__tempocRefetch は成否の boolean しか返さないため
  // （その契約は Go 側・ExecJS 経路も前提にしている）、判定はこの側で持つ。
  var authSignals = 0;
  function postAuthRequired() {
    authSignals++;
    post({ type: "auth-required" });
  }

  // Claude が落ちている / 使用量が取れなかったことをフロントへ知らせる。
  // 「未認証」とは別物なので auth-required とは分ける — ログインし直しても
  // 直らないし、直前まで表示していた値は依然として最後に判っている真値だから、
  // フロントはこれを受けても値と更新時刻を消さずにエラー表示だけ足す。
  //
  // ⚠️ 取得に失敗したときは「空の usage を post する」ことだけは絶対にしない。
  // 空ペイロードはフロントで utilization 0 / resets_at 無しとして描かれ、
  // 全バーが 0% にリセットされたように見える（= 障害を成功として表示する）。
  function postFetchError(msg) {
    // claude.ai 以外のページ（Google OAuth 中の accounts.google.com など）でも
    // このスクリプトは動いており、そこで走った相対 URL の取得は当然失敗する。
    // それをユーザーに「Claude から取得できない」と見せるのは誤報なので黙る。
    // hostname が空なのはナビゲーション失敗時のエラーページ側（= claude.ai に
    // 到達できていない）で、これはまさに報告したいケースなので通す。
    var host = window.location.hostname;
    if (host !== "" && host !== "claude.ai" && !/\.claude\.ai$/.test(host)) {
      post({ type: "debug", msg: "fetch error off-site, suppressed: " + msg });
      return;
    }
    post({ type: "fetch-error", msg: msg });
  }

  // 2xx かどうか。Response.ok を直接見ないのは、fetch のスタブや
  // 一部の経路で ok が無い応答オブジェクトが来ても status で判断できるようにするため。
  function isOK(r) {
    return r && r.status >= 200 && r.status < 300;
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
  // The gate and this routing both live in Wails' shared code
  // (pkg/application/webview_window.go), so the handshake is needed on every
  // platform — only the transport underneath sendToHost differs.
  sendToHost("wails:runtime:ready");

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
      postAuthRequired();
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
        refetchWithRetry(0);
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

  // Normalize the top-level `extra_usage` object (claude.ai's "Usage credits":
  // pay-as-you-go spending once a plan limit is hit) down to the fields the app
  // renders. Amounts are integers in the currency's minor units — pair them with
  // decimal_places to get the real value (5000 + 2 => $50.00). Unlike every other
  // window this one carries NO reset timestamp; the cycle is the calendar month
  // (see App.tsx's 'credits' kind), so nothing here to normalize for time.
  function normalizeCredits(o) {
    if (!o) return undefined;
    return {
      is_enabled: o.is_enabled,
      monthly_limit: o.monthly_limit,
      used_credits: o.used_credits,
      utilization: o.utilization,
      currency: o.currency,
      decimal_places: o.decimal_places,
    };
  }

  function handleUsageResponse(response) {
    response
      .clone()
      .json()
      .then(function (data) {
        console.debug("[TEMPOC] usage intercepted", data);
        // weekly_scoped lives as an entry in the `limits` array (its `kind`),
        // not as a top-level key. Fall back to a top-level key just in case.
        var payload = {
          type: "usage",
          seven_day: normalizeWindow(data.seven_day || findLimit(data, "seven_day")),
          five_hour: normalizeWindow(data.five_hour || findLimit(data, "five_hour")),
          weekly_scoped: normalizeWindow(findLimit(data, "weekly_scoped") || data.weekly_scoped),
          extra_usage: normalizeCredits(data.extra_usage),
        };
        // 障害時にエラー JSON（{"error": ...} など）が 200 で返ることがある。
        // そのまま post すると全ウィンドウが undefined の「成功」として届き、
        // フロントは 0% のバーを描いてしまう。5時間・7日のどちらも無い応答は
        // 使用量ではないと判断してエラー扱いにする。
        if (!payload.seven_day && !payload.five_hour) {
          post({ type: "debug", msg: "usage: payload has no usage windows" });
          postFetchError("usage: unexpected response");
          return;
        }
        post(payload);
      })
      .catch(function () {
        // JSON ではない（障害時の HTML エラーページ・プロキシの応答など）。
        postFetchError("usage: response was not JSON");
      });
  }

  var originalFetch = window.fetch;
  window.fetch = async function (...args) {
    var resource = args[0];
    var response;
    try {
      response = await originalFetch.apply(window, args);
    } catch (e) {
      // fetch が reject する = 応答が返ってこない障害（回線断・DNS 失敗・
      // 接続タイムアウト）。HTTP 応答が返る障害（5xx / 429）は下の status
      // 判定で拾えるが、こちらは await が throw して判定に到達しないため、
      // ここで拾わないとフロントは何も知らないまま古い値を出し続ける
      // （自動更新はサイトの更新ボタン経由なので、失敗するのは常にこの
      // 経路の fetch。端末側のネットワーク障害はまさにこれに当たる）。
      try {
        if (usagePattern.test(resourceToPath(resource))) {
          post({ type: "debug", msg: "usage: fetch rejected: " + e });
          postFetchError("usage: fetch failed: " + e);
        }
      } catch (e2) {
        // ignore
      }
      // サイト側の挙動は変えない。握り潰すと claude.ai 自身のエラー処理が
      // 走らず、undefined を応答として扱わせてしまう。
      throw e;
    }

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
          postAuthRequired();
        } else if (!isOK(response)) {
          // Claude 側の障害（5xx）やレート制限（429）。サイト自身のリクエスト
          // なのでヘッダ等は正しく、失敗は claude.ai 側の問題と考えてよい。
          post({ type: "debug", msg: "usage: http " + response.status });
          postFetchError("usage: HTTP " + response.status);
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
          postAuthRequired();
          return false;
        }
        if (!isOK(r)) {
          // Claude 側の障害。未認証ではないのでログイン画面には戻さず、
          // 「取得できなかった」ことだけをフロントに伝える。
          post({ type: "debug", msg: "refetch: organizations http " + r.status });
          postFetchError("organizations: HTTP " + r.status);
          return false;
        }
        return r.json().then(function (orgs) {
          if (!Array.isArray(orgs) || orgs.length === 0) {
            // 実測ではログアウト状態でも 401 ではなく 200 + 空/非配列が
            // 返ることがある。正規アカウントに組織ゼロは無いので、これも
            // 未認証として扱う。
            post({ type: "debug", msg: "refetch: no organizations" });
            postAuthRequired();
            return false;
          }
          var orgId = orgs[0].uuid || orgs[0].id;
          console.debug("[TEMPOC] refetch usage for org", orgId);
          return originalFetch(
            "/api/organizations/" + orgId + "/usage",
            { credentials: "include" }
          ).then(function (r2) {
            if (r2.status === 401 || r2.status === 403) {
              postAuthRequired();
              return false;
            }
            if (!isOK(r2)) {
              // 障害応答の本文を使用量として解釈させない（空ペイロードを
              // post すると全バーが 0% になる）。エラーだけ伝えて失敗を返す。
              post({ type: "debug", msg: "refetch: usage http " + r2.status });
              postFetchError("usage: HTTP " + r2.status);
              return false;
            }
            handleUsageResponse(r2);
            return true;
          });
        });
      })
      .catch(function (e) {
        // ネットワーク断・DNS 障害・JSON でない応答など。リトライ対象だが、
        // 画面には「取れていない」ことを出す（黙って古い値を出し続けると
        // 更新されているのか止まっているのか区別が付かない）。
        post({ type: "debug", msg: "refetch failed: " + e });
        postFetchError("refetch failed: " + e);
        return false;
      });
  };

  // 能動取得を、成功するまで間隔を伸ばしながら数回試す。
  //
  // 1回きりだと、起動直後に取り逃したとき（ページがまだ出来ていない・一時的な
  // ネットワークエラー）にフロントが「使用量を待っています」のまま無反応になる。
  // 次に何かが動くのは自動更新（既定5分）で、しかもそれはモーダル内の更新ボタンを
  // 押す経路なので、モーダルが開いていなければ空振りする。
  //
  // 打ち切り条件は2つ:
  //   - 取得成功
  //   - 未認証が確定（authSignals が増える）… ログイン前なので何度叩いても同じ。
  //     ログイン完了の検知と再取得は watchAuthTransition の担当
  // それ以外（catch に落ちる一時障害）だけがリトライに値する。
  var refetchDelays = [1500, 3000, 6000, 12000];
  function refetchWithRetry(attempt) {
    var seen = authSignals;
    window.__tempocRefetch().then(function (ok) {
      if (ok || authSignals !== seen) return;
      var next = attempt + 1;
      if (next >= refetchDelays.length) {
        post({ type: "debug", msg: "refetch: giving up after " + refetchDelays.length + " attempts" });
        return;
      }
      post({ type: "debug", msg: "refetch: retrying in " + refetchDelays[next] + "ms" });
      setTimeout(function () {
        refetchWithRetry(next);
      }, refetchDelays[next]);
    });
  }

  // claude.ai の使用量更新ボタンを探す。以前は id "_r_bb_" を直接参照して
  // いたが、これは React の自動生成 ID でデプロイやマウント順によって変わる
  // （実際 "_r_h7_" に変わりボタンを見失った）。usage モーダル
  // （[role="dialog"]）内の aria-label="Refresh" ボタンを構造で特定する。
  // 日本語 UI の aria-label（「更新」）にも対応し、旧 ID は最後の保険。
  function findRefreshButton() {
    var dlg = document.querySelector('[role="dialog"]');
    if (dlg) {
      var btns = dlg.querySelectorAll("button[aria-label]");
      for (var i = 0; i < btns.length; i++) {
        var label = btns[i].getAttribute("aria-label") || "";
        if (/^refresh$/i.test(label) || label === "更新") return btns[i];
      }
    }
    return document.getElementById("_r_bb_");
  }

  // Refresh by clicking claude.ai's own usage refresh button, which
  // re-requests the usage API — our patched fetch then intercepts the
  // fresh response. Preferred over calling the API directly so we exactly mirror
  // the site's own request (headers/CSRF/endpoint stay correct). Falls back to
  // __tempocRefetch if the button isn't present (e.g. the modal isn't
  // mounted). Used by both the manual refresh button (driven from Go via
  // ExecJS) and the auto-refresh interval below.
  window.__tempocClickRefresh = function () {
    // ログインページでは何もしない。特に下のモーダル復元リロードが走ると
    // ユーザーがメールアドレスや確認コードを入力している最中にページが
    // 消えてしまう。ログイン完了は watchAuthTransition が拾って usage
    // ページを開き直すので、ここで動く必要もない。
    if (loginPath.test(window.location.pathname)) {
      post({ type: "debug", msg: "refresh: on login page, skipped" });
      return;
    }
    var btn = findRefreshButton();
    if (btn) {
      post({ type: "debug", msg: "refresh: clicking usage button (#" + (btn.id || "?") + ")" });
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

  // 初回注入後、少し待ってから能動取得を試みる（SPA描画完了を待つ）。
  // 初回はまだ更新ボタンが DOM に無い可能性が高いので、直叩きの
  // __tempocRefetch で取得する。未ログインでこのドキュメントが /login のときは
  // 1回で打ち切られ（未認証は確定なのでリトライしない）、上の
  // watchAuthTransition がログイン完了を検知して取り直す。
  setTimeout(function () {
    refetchWithRetry(0);
  }, refetchDelays[0]);

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
