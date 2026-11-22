import AppKit
import Foundation
import WebKit

struct Scenario {
  let name: String
  let url: String
  let captureScreenshot: Bool
}

struct CliOptions {
  let pluginPort: Int
  let sameOriginPort: Int
  let foreignPort: Int
  let outPath: String
  let screenshotPath: String
}

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data("macos-wkwebview-smoke: \(message)\n".utf8))
  Foundation.exit(1)
}

func parseCli(_ args: [String]) -> CliOptions {
  var values: [String: String] = [:]
  var i = 1
  while i < args.count {
    let key = args[i]
    guard key.hasPrefix("--") else {
      fail("unexpected argument: \(key)")
    }
    guard i + 1 < args.count else {
      fail("missing value for \(key)")
    }
    values[key] = args[i + 1]
    i += 2
  }
  guard
    let pluginStr = values["--plugin-port"], let pluginPort = Int(pluginStr), pluginPort > 0,
    let sameStr = values["--same-origin-port"], let sameOriginPort = Int(sameStr), sameOriginPort > 0,
    let foreignStr = values["--foreign-port"], let foreignPort = Int(foreignStr), foreignPort > 0,
    let outPath = values["--out"], !outPath.isEmpty,
    let screenshotPath = values["--screenshot"], !screenshotPath.isEmpty
  else {
    fail("usage: --plugin-port <n> --same-origin-port <n> --foreign-port <n> --out <path> --screenshot <path>")
  }
  return CliOptions(
    pluginPort: pluginPort,
    sameOriginPort: sameOriginPort,
    foreignPort: foreignPort,
    outPath: outPath,
    screenshotPath: screenshotPath
  )
}

final class WailsSchemeHandler: NSObject, WKURLSchemeHandler {
  let pluginPort: Int

  init(pluginPort: Int) {
    self.pluginPort = pluginPort
  }

  func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
    guard let url = urlSchemeTask.request.url else {
      urlSchemeTask.didFailWithError(NSError(domain: "WailsScheme", code: 1))
      return
    }
    let sandboxAttr = url.path == "/unsandboxed" ? "" : "sandbox=\"allow-scripts\" "
    let html = """
    <!doctype html>
    <html>
    <head><meta charset="utf-8"><title>Magpie Wails Host</title></head>
    <body style="margin:0;padding:0;width:100vw;height:100vh;overflow:hidden;">
    <iframe id="plugin" \(sandboxAttr)src="http://127.0.0.1:\(pluginPort)/?lang=en&theme=light" style="width:100%;height:100%;border:0;"></iframe>
    </body>
    </html>
    """
    let data = Data(html.utf8)
    let response = HTTPURLResponse(
      url: url,
      statusCode: 200,
      httpVersion: "HTTP/1.1",
      headerFields: [
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      ]
    ) ?? URLResponse(
      url: url,
      mimeType: "text/html",
      expectedContentLength: data.count,
      textEncodingName: "utf-8"
    )
    urlSchemeTask.didReceive(response)
    urlSchemeTask.didReceive(data)
    urlSchemeTask.didFinish()
  }

  func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}
}

final class SmokeRunner: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
  let options: CliOptions
  let scenarios: [Scenario]
  var window: NSWindow!
  var currentWebView: WKWebView?
  var currentSchemeHandler: WailsSchemeHandler?
  var currentController: WKUserContentController?
  var index = 0
  var scenarioTimer: Timer?
  var watchdogTimer: Timer?
  var results: [String: Any] = [:]
  var screenshotBytes: Int = 0
  var screenshotError: String?
  var settledCurrent = false

  private let cspMonitorSource = """
  (function () {
    if (window.__clCspMonitorInstalled) return;
    window.__clCspMonitorInstalled = true;
    window.__clCspViolations = window.__clCspViolations || [];
    function recordViolation(ev) {
      try {
        window.__clCspViolations.push({
          effectiveDirective: String(ev && ev.effectiveDirective || ""),
          violatedDirective: String(ev && ev.violatedDirective || ""),
          blockedURI: String(ev && ev.blockedURI || ""),
          documentURI: String(ev && ev.documentURI || "")
        });
      } catch (e) {}
    }
    document.addEventListener("securitypolicyviolation", recordViolation, true);
    window.addEventListener("securitypolicyviolation", recordViolation, true);
  })();
  """

  private let probeSource = """
  (function () {
    if (window.__clProbeStarted) return;
    if (!document.getElementById("embed-denied")) return;
    window.__clProbeStarted = true;
    var sent = false;
    var ticks = 0;
    function buildPayload(timedOut, errorDiagnostics) {
      var shell = document.querySelector(".shell");
      var denied = document.getElementById("embed-denied");
      var svc = document.getElementById("service-state");
      var svcLabel = document.getElementById("service-label");
      var ancestors = [];
      try {
        ancestors = Array.from(location.ancestorOrigins || []);
      } catch (e) {
        ancestors = [];
      }
      var payload = {
        href: String(location.href),
        origin: String(window.origin),
        pageOrigin: String(location.origin),
        ancestorOrigins: ancestors,
        topEqualsSelf: window.top === window,
        shellHidden: Boolean(shell && shell.hidden),
        deniedHidden: Boolean(!denied || denied.hidden),
        deniedText: denied ? String(denied.textContent || "").trim() : "",
        serviceState: svc ? String(svc.dataset.state || "") : "",
        serviceLabel: svcLabel ? String(svcLabel.textContent || "").trim() : "",
        theme: String(document.documentElement.dataset.theme || ""),
        cspViolations: Array.isArray(window.__clCspViolations) ? window.__clCspViolations.slice(0, 10) : [],
        timedOut: Boolean(timedOut)
      };
      if (errorDiagnostics !== undefined) {
        payload.errorDiagnostics = errorDiagnostics;
      }
      return payload;
    }
    function postPayload(payload) {
      try {
        window.webkit.messageHandlers.probe.postMessage(payload);
      } catch (e) {}
    }
    function probeFetch(label, url, init, timeoutMs) {
      return new Promise(function (resolve) {
        var settled = false;
        var controller = typeof AbortController === "function" ? new AbortController() : null;
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          if (controller) {
            try { controller.abort(); } catch (e) {}
          }
          resolve([label, { error: "probe_timeout_" + timeoutMs + "ms" }]);
        }, timeoutMs);
        var opts = Object.assign({}, init || {});
        if (controller) opts.signal = controller.signal;
        fetch(url, opts).then(
          function (resp) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve([label, { status: resp.status, ok: Boolean(resp.ok) }]);
          },
          function (err) {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve([label, { error: String(err) }]);
          }
        );
      });
    }
    function runErrorDiagnostics(done) {
      var tokenMeta = document.querySelector('meta[name="clean-login-token"]');
      var metaToken = tokenMeta ? String(tokenMeta.getAttribute("content") || "") : "";
      var finished = false;
      var deadline = setTimeout(function () {
        if (finished) return;
        finished = true;
        done({ timedOut: true, hasMetaToken: metaToken.length > 0 });
      }, 3000);
      Promise.all([
        probeFetch("healthSimple", "api/health", { cache: "no-store" }, 2500),
        probeFetch("bootstrapNoStore", "api/bootstrap", { headers: { "x-clean-login-token": metaToken }, cache: "no-store" }, 2500),
        probeFetch("bootstrapDefaultCache", "api/bootstrap", { headers: { "x-clean-login-token": metaToken } }, 2500)
      ]).then(function (entries) {
        if (finished) return;
        setTimeout(function () {
          if (finished) return;
          finished = true;
          clearTimeout(deadline);
          var out = { hasMetaToken: metaToken.length > 0 };
          for (var i = 0; i < entries.length; i += 1) {
            out[entries[i][0]] = entries[i][1];
          }
          done(out);
        }, 100);
      });
    }
    function send(timedOut) {
      if (sent) return;
      sent = true;
      var denied = document.getElementById("embed-denied");
      var svc = document.getElementById("service-state");
      var deniedReady = Boolean(denied && !denied.hidden && String(denied.textContent || "").trim().length > 0);
      if (!deniedReady && svc && svc.dataset.state === "error") {
        runErrorDiagnostics(function (diag) {
          postPayload(buildPayload(timedOut, diag));
        });
        return;
      }
      postPayload(buildPayload(timedOut, undefined));
    }
    function check() {
      if (sent) return;
      ticks += 1;
      var denied = document.getElementById("embed-denied");
      var svc = document.getElementById("service-state");
      var deniedReady = Boolean(denied && !denied.hidden && String(denied.textContent || "").trim().length > 0);
      var serviceDone = Boolean(svc && (svc.dataset.state === "ready" || svc.dataset.state === "error"));
      if (deniedReady || serviceDone) {
        send(false);
        return;
      }
      if (ticks >= 100) {
        send(true);
        return;
      }
      setTimeout(check, 100);
    }
    check();
  })();
  """

  init(options: CliOptions) {
    self.options = options
    self.scenarios = [
      Scenario(name: "wails-sandbox-allow", url: "wails://wails/", captureScreenshot: true),
      Scenario(name: "same-origin-web-allow", url: "http://127.0.0.1:\(options.sameOriginPort)/__magpie_host__", captureScreenshot: false),
      Scenario(name: "foreign-http-deny", url: "http://127.0.0.1:\(options.foreignPort)/", captureScreenshot: false),
      Scenario(name: "top-level-deny", url: "http://127.0.0.1:\(options.pluginPort)/?lang=en&theme=light", captureScreenshot: false),
      Scenario(name: "unsandboxed-frame-deny", url: "wails://wails/unsandboxed", captureScreenshot: false),
    ]
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    let rect = NSRect(x: 0, y: 0, width: 1200, height: 800)
    window = NSWindow(
      contentRect: rect,
      styleMask: [.titled, .closable, .resizable],
      backing: .buffered,
      defer: false
    )
    window.title = "Clean Login WKWebView Smoke"
    window.orderBack(nil)

    watchdogTimer = Timer.scheduledTimer(withTimeInterval: 90.0, repeats: false) { [weak self] _ in
      self?.finishAndExit(timedOutGlobally: true)
    }
    runNext()
  }

  func runNext() {
    guard index < scenarios.count else {
      finishAndExit(timedOutGlobally: false)
      return
    }
    let scenario = scenarios[index]
    settledCurrent = false
    scenarioTimer?.invalidate()

    if let oldController = currentController {
      oldController.removeScriptMessageHandler(forName: "probe", contentWorld: .defaultClient)
    }
    currentWebView?.navigationDelegate = nil
    currentWebView?.removeFromSuperview()
    currentWebView = nil
    currentController = nil
    currentSchemeHandler = nil

    let config = WKWebViewConfiguration()
    let schemeHandler = WailsSchemeHandler(pluginPort: options.pluginPort)
    config.setURLSchemeHandler(schemeHandler, forURLScheme: "wails")

    let controller = WKUserContentController()
    controller.add(self, contentWorld: .defaultClient, name: "probe")
    let cspUserScript = WKUserScript(
      source: cspMonitorSource,
      injectionTime: .atDocumentStart,
      forMainFrameOnly: false,
      in: .defaultClient
    )
    controller.addUserScript(cspUserScript)
    let userScript = WKUserScript(
      source: probeSource,
      injectionTime: .atDocumentEnd,
      forMainFrameOnly: false,
      in: .defaultClient
    )
    controller.addUserScript(userScript)
    config.userContentController = controller

    let frame = window.contentView?.bounds ?? NSRect(x: 0, y: 0, width: 1200, height: 800)
    let webView = WKWebView(frame: frame, configuration: config)
    webView.autoresizingMask = [.width, .height]
    webView.navigationDelegate = self
    window.contentView?.addSubview(webView)

    currentSchemeHandler = schemeHandler
    currentController = controller
    currentWebView = webView

    scenarioTimer = Timer.scheduledTimer(withTimeInterval: 15.0, repeats: false) { [weak self] _ in
      guard let self = self, !self.settledCurrent else { return }
      self.settledCurrent = true
      self.results[scenario.name] = [
        "timedOut": true,
        "reason": "swift scenario deadline elapsed without probe payload",
      ]
      self.index += 1
      self.runNext()
    }

    guard let targetURL = URL(string: scenario.url) else {
      settledCurrent = true
      scenarioTimer?.invalidate()
      results[scenario.name] = [
        "timedOut": false,
        "navError": "invalid scenario URL: \(scenario.url)",
      ]
      index += 1
      runNext()
      return
    }
    webView.load(URLRequest(url: targetURL))
  }

  func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
    guard index < scenarios.count, !settledCurrent else { return }
    let scenario = scenarios[index]
    settledCurrent = true
    scenarioTimer?.invalidate()

    if let dict = message.body as? [String: Any] {
      results[scenario.name] = dict
    } else {
      results[scenario.name] = [
        "timedOut": false,
        "navError": "unexpected non-dictionary probe payload",
      ]
    }

    if scenario.captureScreenshot, let webView = currentWebView {
      DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
        guard let self = self else { return }
        webView.takeSnapshot(with: nil) { image, error in
          if let error = error {
            self.screenshotError = error.localizedDescription
          } else if let image = image,
                    let tiff = image.tiffRepresentation,
                    let rep = NSBitmapImageRep(data: tiff),
                    let png = rep.representation(using: .png, properties: [:]) {
            do {
              try png.write(to: URL(fileURLWithPath: self.options.screenshotPath))
              self.screenshotBytes = png.count
            } catch {
              self.screenshotError = error.localizedDescription
            }
          } else {
            self.screenshotError = "failed to encode PNG snapshot"
          }
          self.index += 1
          self.runNext()
        }
      }
      return
    }

    index += 1
    runNext()
  }

  func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
    recordNavError(error)
  }

  func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
    recordNavError(error)
  }

  private func recordNavError(_ error: Error) {
    guard index < scenarios.count, !settledCurrent else { return }
    let scenario = scenarios[index]
    settledCurrent = true
    scenarioTimer?.invalidate()
    results[scenario.name] = [
      "timedOut": false,
      "navError": error.localizedDescription,
    ]
    index += 1
    runNext()
  }

  func finishAndExit(timedOutGlobally: Bool) {
    watchdogTimer?.invalidate()
    scenarioTimer?.invalidate()
    if let oldController = currentController {
      oldController.removeScriptMessageHandler(forName: "probe", contentWorld: .defaultClient)
    }

    var payload: [String: Any] = [
      "scenarios": results,
      "screenshotPath": options.screenshotPath,
      "screenshotBytes": screenshotBytes,
      "timedOutGlobally": timedOutGlobally,
    ]
    if let screenshotError = screenshotError {
      payload["screenshotError"] = screenshotError
    }

    do {
      let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
      let outURL = URL(fileURLWithPath: options.outPath)
      try FileManager.default.createDirectory(at: outURL.deletingLastPathComponent(), withIntermediateDirectories: true)
      try data.write(to: outURL)
      if let text = String(data: data, encoding: .utf8) {
        print(text)
      }
      Foundation.exit(timedOutGlobally ? 1 : 0)
    } catch {
      fail("failed writing output JSON: \(error.localizedDescription)")
    }
  }
}

let options = parseCli(CommandLine.arguments)
let app = NSApplication.shared
app.setActivationPolicy(.accessory)
let runner = SmokeRunner(options: options)
app.delegate = runner
app.run()
