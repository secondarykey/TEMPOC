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

  // If Claude bounced us to the login page, ask Go to reveal the window so the
  // user can sign in.
  if (/^\/login\b/.test(window.location.pathname)) {
    post({ type: "auth-required" });
    console.debug("[TEMPOC] login page detected");
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
        handleUsageResponse(response);
      }
    } catch (e) {
      // ignore
    }

    return response;
  };

  // タイミング対策: パッチ前に既に使用量APIが呼ばれていた場合に備え、
  // 自分で使用量APIを叩いて取得を試みる。organization_id は
  // /api/organizations から取得する。
  window.__tempocRefetch = function () {
    originalFetch("/api/organizations", { credentials: "include" })
      .then(function (r) {
        return r.json();
      })
      .then(function (orgs) {
        if (!Array.isArray(orgs) || orgs.length === 0) {
          post({ type: "debug", msg: "refetch: no organizations" });
          return;
        }
        var orgId = orgs[0].uuid || orgs[0].id;
        console.debug("[TEMPOC] refetch usage for org", orgId);
        return originalFetch(
          "/api/organizations/" + orgId + "/usage",
          { credentials: "include" }
        ).then(handleUsageResponse);
      })
      .catch(function (e) {
        post({ type: "debug", msg: "refetch failed: " + e });
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
    var btn = document.getElementById("_r_bb_");
    if (btn) {
      post({ type: "debug", msg: "refresh: clicking usage button" });
      btn.click();
    } else {
      post({ type: "debug", msg: "refresh: button not found, refetching" });
      window.__tempocRefetch();
    }
  };

  // 初回注入後、少し待ってから能動取得を1回試みる（SPA描画完了を待つ）。
  // 初回はまだ更新ボタン（_r_bb_）が DOM に無い可能性が高いので、直叩きの
  // __tempocRefetch で確実に1回取得する。
  setTimeout(window.__tempocRefetch, 1500);

  // __TEMPOC_REFRESH_MS__ is string-replaced by Go (main.go) at window-creation
  // time with settings.RefreshInterval*60000 (0 = disabled). Because this
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
