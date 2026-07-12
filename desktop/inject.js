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

  function handleUsageResponse(response) {
    response
      .clone()
      .json()
      .then(function (data) {
        console.debug("[TEMPOC] usage intercepted", data);
        post({
          type: "usage",
          seven_day: data.seven_day,
          five_hour: data.five_hour,
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

  // 初回注入後、少し待ってから能動取得を1回試みる（SPA描画完了を待つ）。
  setTimeout(window.__tempocRefetch, 1500);

  // __TEMPOC_REFRESH_MS__ is string-replaced by Go (main.go) at window-creation
  // time with settings.RefreshInterval*60000 (0 = disabled). Because this
  // script is only pushed into the Claude window once, at startup, changing
  // the refresh interval in the Settings UI only takes effect on next app
  // launch.
  var refreshMs = __TEMPOC_REFRESH_MS__;
  if (refreshMs > 0) {
    setInterval(window.__tempocRefetch, refreshMs);
  }
})();
