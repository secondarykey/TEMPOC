// Unit tests for inject.js's host bridge (sendToHost).
//
// inject.js is injected into claude.ai inside the interceptor window, where the
// available JS→Go transport depends on the platform's WebView:
//   Windows: WebView2  → window.chrome.webview.postMessage
//   macOS:   WKWebView → window.webkit.messageHandlers.external.postMessage
//   Linux:   WebKitGTK → same as macOS
// These tests pin that selection down — in particular that the Windows path is
// probed first and behaves exactly as before the macOS/Linux support was added.
//
// No test framework: plain `node --test`. Run from desktop/:
//   node --test
//
// The script is a self-executing IIFE that patches window.fetch and starts
// timers, so each test runs it in a fresh vm context with just enough stubs.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));

// Go string-replaces this placeholder at window-creation time (main.go). 0
// disables the auto-refresh interval, which keeps the tests free of timers.
const source = readFileSync(join(here, "inject.js"), "utf8").replaceAll(
  "__TEMPOC_REFRESH_MS__",
  "0",
);

function makePostSpy() {
  const calls = [];
  return { calls, postMessage: (payload) => calls.push(payload) };
}

// Builds a minimal browser-ish sandbox and runs inject.js in it.
// `bridges` decides which transports exist, mirroring each platform.
function runInject({ webview2 = null, webkitExternal = null, href, fetch, timers } = {}) {
  const url = href ?? "https://claude.ai/new#settings/usage";
  const window = {
    location: {
      href: url,
      pathname: new URL(url).pathname,
      hash: new URL(url).hash,
      hostname: new URL(url).hostname,
      replace() {},
    },
    // inject.js captures window.fetch as originalFetch, then replaces it.
    fetch: fetch ?? (() => new Promise(() => {})),
  };
  if (webview2) window.chrome = { webview: webview2 };
  if (webkitExternal) window.webkit = { messageHandlers: { external: webkitExternal } };

  const sandbox = {
    window,
    // body:null makes the address-bar overlay bail out early, so no DOM needed.
    document: { body: null, createElement: () => ({ style: {} }), querySelector: () => null, getElementById: () => null },
    console: { debug() {}, log() {}, warn() {}, error() {} },
    // Swallow the deferred __tempocRefetch and the 1s tick; we only assert on
    // what inject.js posts synchronously while initialising. Pass `timers` to
    // capture the scheduled callbacks instead and drive them by hand — that is
    // the only way to observe the retry schedule without waiting in real time.
    setTimeout: timers ? (fn, ms) => timers.push({ fn, ms }) : () => 0,
    setInterval: () => 0,
    URL,
  };
  sandbox.globalThis = sandbox;

  vm.runInNewContext(source, sandbox);
  return window;
}

// Every payload must be a string: WebView2 and the webkit handlers all take a
// string body, and Wails routes on its "wails:" prefix.
function assertAllStrings(calls) {
  for (const c of calls) assert.equal(typeof c, "string", `payload not a string: ${typeof c}`);
}

test("Windows (WebView2): posts through window.chrome.webview", () => {
  const spy = makePostSpy();
  runInject({ webview2: spy });

  assert.ok(spy.calls.length > 0, "expected messages on the WebView2 bridge");
  assertAllStrings(spy.calls);
  // The raw handshake unlocks Go→page ExecJS and must be the bare string,
  // not JSON, or Wails routes it to RawMessageHandler instead of HandleMessage.
  assert.ok(
    spy.calls.includes("wails:runtime:ready"),
    "the literal runtime-ready handshake must be sent verbatim",
  );
});

test("macOS/Linux (WKWebView/WebKitGTK): posts through webkit.messageHandlers.external", () => {
  const spy = makePostSpy();
  runInject({ webkitExternal: spy });

  assert.ok(spy.calls.length > 0, "expected messages on the webkit bridge");
  assertAllStrings(spy.calls);
  assert.ok(
    spy.calls.includes("wails:runtime:ready"),
    "the handshake is needed on every platform: the ExecJS gate is shared Wails code",
  );
});

test("both platforms send an identical payload sequence", () => {
  const win = makePostSpy();
  const webkit = makePostSpy();
  runInject({ webview2: win });
  runInject({ webkitExternal: webkit });

  // The transport is the only platform difference; the protocol must not drift.
  assert.deepEqual(webkit.calls, win.calls);
});

test("WebView2 takes precedence when both bridges exist", () => {
  const win = makePostSpy();
  const webkit = makePostSpy();
  runInject({ webview2: win, webkitExternal: webkit });

  assert.ok(win.calls.length > 0, "WebView2 must win so Windows behaviour is unchanged");
  assert.equal(webkit.calls.length, 0, "webkit bridge must stay unused on Windows");
});

test("no bridge at all: initialises without throwing", () => {
  // A plain browser context (or the bootstrap page before Wails wires up) has
  // neither transport. inject.js must degrade quietly rather than break the page.
  assert.doesNotThrow(() => runInject({}));
});

test("usage payloads are JSON objects carrying a type", () => {
  const spy = makePostSpy();
  runInject({ webview2: spy });

  const typed = spy.calls
    .filter((c) => c !== "wails:runtime:ready")
    .map((c) => JSON.parse(c));
  assert.ok(typed.length > 0, "expected at least one JSON message");
  for (const m of typed) {
    assert.equal(typeof m.type, "string", "every JSON message needs a type discriminator");
  }
  // Go's RawMessageHandler reflects this one into the native window title.
  assert.ok(typed.some((m) => m.type === "location"), "expected a location report");
});

// Lets the promise chains inside __tempocRefetch settle between timer runs.
async function flush() {
  for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r));
}

function typesPosted(spy) {
  return spy.calls.filter((c) => c !== "wails:runtime:ready").map((c) => JSON.parse(c));
}

// The startup fetch used to be a single shot. When it missed — page not ready
// yet, a blip on the network — nothing else fetched until the 5-minute auto
// refresh, which itself only works if the usage modal happens to be open, so
// the UI could sit on "waiting for usage" indefinitely.
test("initial refetch retries a transient failure, with backoff", async () => {
  const spy = makePostSpy();
  const timers = [];
  let attempts = 0;
  runInject({
    webview2: spy,
    timers,
    fetch: () => {
      attempts++;
      return Promise.reject(new Error("network down"));
    },
  });

  assert.deepEqual(timers.map((t) => t.ms), [1500], "the first attempt waits for the SPA to render");
  timers.shift().fn();
  await flush();

  assert.equal(attempts, 1);
  assert.deepEqual(timers.map((t) => t.ms), [3000], "a transient failure must be retried, and not immediately");
});

test("initial refetch stops once the session is known to be gone", async () => {
  const spy = makePostSpy();
  const timers = [];
  runInject({ webview2: spy, timers, fetch: () => Promise.resolve({ status: 403 }) });

  timers.shift().fn();
  await flush();

  assert.ok(
    typesPosted(spy).some((m) => m.type === "auth-required"),
    "a 401/403 means logged out: the frontend needs its login button",
  );
  // Retrying would only re-post auth-required. Recovery is watchAuthTransition's
  // job — it notices the login completing and fetches again.
  assert.equal(timers.length, 0, "no retry may be scheduled after a confirmed logout");
});

test("initial refetch gives up rather than retrying forever", async () => {
  const spy = makePostSpy();
  const timers = [];
  let attempts = 0;
  runInject({
    webview2: spy,
    timers,
    fetch: () => {
      attempts++;
      return Promise.reject(new Error("network down"));
    },
  });

  const delays = [];
  while (timers.length) {
    const t = timers.shift();
    delays.push(t.ms);
    t.fn();
    await flush();
  }

  assert.deepEqual(delays, [1500, 3000, 6000, 12000], "backoff schedule");
  assert.equal(attempts, 4);
  assert.ok(
    typesPosted(spy).some((m) => m.type === "debug" && m.msg.includes("giving up")),
    "the log must say the app stopped trying, or a silent UI looks like a bug",
  );
});
