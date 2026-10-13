// A headless Chrome (or Chromium, or Edge) of the story author's own: a temporary profile, driven over the DevTools
// protocol with Node's WebSocket. WebGL2 runs on SwiftShader unless `gpu` is set, so pictures come out the same on
// machines without a GPU. close() ends this browser only and removes its profile.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CANDIDATES = {
  win32: [
    ...["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"].filter((v) => process.env[v]).flatMap((v) => [
      path.join(process.env[v], "Google", "Chrome", "Application", "chrome.exe"),
      path.join(process.env[v], "Chromium", "Application", "chrome.exe"),
      path.join(process.env[v], "Microsoft", "Edge", "Application", "msedge.exe"),
    ]),
  ],
  darwin: ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", "/Applications/Chromium.app/Contents/MacOS/Chromium",
           "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge"],
  linux: ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"],
};

const onPath = (name) => {
  for (const d of (process.env.PATH || "").split(path.delimiter)) {
    const f = path.join(d, name);
    if (d && fs.existsSync(f)) return f;
  }
  return null;
};

// The browser executable: `given` (a path), else CHROME_PATH, else the first installed of CANDIDATES. Throws when
// none is found.
export const findBrowser = (given = process.env.CHROME_PATH) => {
  if (given) {
    if (!fs.existsSync(given)) throw new Error(`browser not found: ${given}`);
    return given;
  }
  for (const c of CANDIDATES[process.platform] || CANDIDATES.linux) {
    const f = path.isAbsolute(c) ? (fs.existsSync(c) ? c : null) : onPath(c);
    if (f) return f;
  }
  throw new Error("no Chrome, Chromium or Edge found: pass --chrome <path> or set CHROME_PATH");
};

const waitFor = async (what, test, ms) => {
  const t0 = Date.now();
  for (;;) {
    const v = test();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`the browser did not ${what} within ${ms / 1000} s`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

export class Browser {
  // opts: executable, gpu, width / height (window size), onConsole(type, text): the page's console and its uncaught
  // errors
  static async launch({ executable = findBrowser(), gpu = false, width = 1300, height = 600, onConsole = null } = {}) {
    const b = new Browser();
    b.profile = fs.mkdtempSync(path.join(os.tmpdir(), "story-author-"));
    const args = ["--headless=new", "--remote-debugging-port=0", `--user-data-dir=${b.profile}`, "--no-first-run",
                  "--no-default-browser-check", "--disable-extensions", "--mute-audio", "--hide-scrollbars",
                  `--window-size=${width},${height}`,
                  ...(gpu ? [] : ["--enable-unsafe-swiftshader", "--use-angle=swiftshader"]), "about:blank"];
    b.proc = spawn(executable, args, { stdio: "ignore" });
    b.exited = new Promise((r) => b.proc.once("exit", r));
    b.proc.once("error", () => {});
    try {
      const portFile = path.join(b.profile, "DevToolsActivePort");
      const port = await waitFor("start", () => {
        if (b.proc.exitCode !== null) throw new Error(`the browser exited (${b.proc.exitCode}): ${executable}`);
        if (!fs.existsSync(portFile)) return null;
        const p = fs.readFileSync(portFile, "utf8").split("\n")[0];
        return p ? Number(p) : null;
      }, 30000);
      const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
      const page = targets.find((t) => t.type === "page");
      if (!page) throw new Error("the browser has no page");
      await b._connect(page.webSocketDebuggerUrl, onConsole);
      b.browserUrl = (await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl;
    } catch (e) {
      await b.close();
      throw e;
    }
    return b;
  }

  async _connect(url, onConsole) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.waiters = [];
    await new Promise((resolve, reject) => {
      this.ws.addEventListener("open", resolve, { once: true });
      this.ws.addEventListener("error", () => reject(new Error("cannot connect to the browser")), { once: true });
    });
    this.ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id) {
        const p = this.pending.get(m.id);
        if (!p) return;
        this.pending.delete(m.id);
        if (m.error) p.reject(new Error(`${p.method}: ${m.error.message}`)); else p.resolve(m.result);
        return;
      }
      if (onConsole && m.method === "Runtime.consoleAPICalled")
        onConsole(m.params.type, m.params.args.map((a) => (a.value !== undefined ? String(a.value) : a.description || "")).join(" "));
      if (onConsole && m.method === "Runtime.exceptionThrown") {
        const d = m.params.exceptionDetails;
        onConsole("error", (d.exception && d.exception.description) || d.text);
      }
      for (const w of [...this.waiters]) if (w.method === m.method) { this.waiters.splice(this.waiters.indexOf(w), 1); w.resolve(m.params); }
    });
    this.ws.addEventListener("close", () => {
      for (const p of this.pending.values()) p.reject(new Error("the browser closed"));
      this.pending.clear();
    });
    await this.send("Runtime.enable");
    await this.send("Page.enable");
  }

  send(method, params = {}) {
    return new Promise((resolve, reject) => {
      const id = ++this.id;
      this.pending.set(id, { resolve, reject, method });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  event(method) { return new Promise((resolve) => this.waiters.push({ method, resolve })); }

  async navigate(url) {
    const loaded = this.event("Page.loadEventFired");
    const r = await this.send("Page.navigate", { url });
    if (r.errorText) throw new Error(`${url}: ${r.errorText}`);
    await loaded;
  }

  // the value of an expression (a promise is awaited); throws the page's exception, or after `timeout` seconds
  async evaluate(expression, timeout = 0) {
    let timer = null;
    const run = this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    const limit = timeout > 0 ? new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`the page did not finish within ${timeout} s`)), timeout * 1000);
    }) : null;
    try {
      const r = await (limit ? Promise.race([run, limit]) : run);
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error((d.exception && (d.exception.description || d.exception.value)) || d.text);
      }
      return r.result.value;
    } finally { clearTimeout(timer); }
  }

  // ends the browser (Browser.close, then the process if it is still running) and removes its profile
  async close() {
    if (this.closed) return;
    this.closed = true;
    try { if (this.ws) this.ws.close(); } catch (_) { /* already closed */ }
    if (this.proc && this.proc.exitCode === null) {
      if (this.browserUrl) {
        try {
          const ws = new WebSocket(this.browserUrl);
          await new Promise((r, j) => { ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
          ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
        } catch (_) { /* the process is ended below */ }
      }
      const done = await Promise.race([this.exited.then(() => true), new Promise((r) => setTimeout(() => r(false), 5000))]);
      if (!done) { this.proc.kill(); await this.exited; }
    }
    for (let i = 0; i < 20 && this.profile && fs.existsSync(this.profile); i++) {
      try { fs.rmSync(this.profile, { recursive: true, force: true }); } catch (_) { await new Promise((r) => setTimeout(r, 250)); }
    }
  }
}
