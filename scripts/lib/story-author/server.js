// The story author's local HTTP server (127.0.0.1 only): the package's files at the root, a site under /site/ with
// files held in memory over it (a composed story manifest and its assets), the page the browser renders in at
// /page.html, and, with an output directory, the pictures the page posts to /out/<name>.png.
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
export const CUBISM_CORE_URL = "https://cubism.live2d.com/sdk-web/cubismcore/live2dcubismcore.min.js";

const TYPES = { ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".html": "text/html",
                ".css": "text/css", ".png": "image/png", ".webp": "image/webp", ".glsl": "text/plain", ".m4a": "audio/mp4",
                ".flac": "audio/flac", ".map": "application/json" };
const typeOf = (p) => TYPES[path.extname(p).toLowerCase()] || "application/octet-stream";

// a URL path below a prefix as a file below `dir`, or null for a path that leaves it
const below = (dir, rel) => {
  const parts = decodeURIComponent(rel).split("/");
  if (parts.some((x) => x === ".." || x === "." || x.includes("\\"))) return null;
  return path.join(dir, ...parts.filter(Boolean));
};

// opts: site (directory), core (a URL, or a file served at /core.js; default Live2D's distribution), out (directory
// the page's pictures go to), files (Map: path below /site/ -> Buffer | string, served before the site's own files),
// port (default: any free one) -> {url, files, close()}
export const startServer = ({ site, core = CUBISM_CORE_URL, out = null, files = new Map(), port = 0 } = {}) => new Promise((resolve, reject) => {
  const coreFile = core && !/^https?:\/\//.test(core) ? path.resolve(core) : null;
  const page = "<!doctype html><html><head><meta charset=\"utf-8\"><title>story author</title>" +
    "<link rel=\"icon\" href=\"data:,\"></head><body style=\"margin:0;background:#000\">" +
    `<script src="${coreFile ? "/core.js" : core}"></script></body></html>`;
  const send = (res, code, body, type = "text/plain") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(body);
  };
  const sendFile = (res, f) => fs.stat(f, (e, st) => {
    if (e || !st.isFile()) return send(res, 404, "not found");
    res.writeHead(200, { "content-type": typeOf(f), "content-length": st.size, "cache-control": "no-store" });
    fs.createReadStream(f).pipe(res);
  });
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, "http://localhost");
    const p = u.pathname;
    if (req.method === "POST" && p.startsWith("/out/")) {
      const name = decodeURIComponent(p.slice(5));
      if (!out || !/^[\w.-]+\.png$/.test(name)) return send(res, 403, "no output here");
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => fs.writeFile(path.join(out, name), Buffer.concat(chunks), (e) => send(res, e ? 500 : 200, e ? e.message : "ok")));
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
    if (p === "/page.html") return send(res, 200, page, "text/html");
    if (p === "/core.js" && coreFile) return sendFile(res, coreFile);
    if (p.startsWith("/site/")) {
      const rel = decodeURIComponent(p.slice(6));
      if (files.has(rel)) return send(res, 200, files.get(rel), typeOf(rel));
      const f = site && below(site, p.slice(6));
      return f ? sendFile(res, f) : send(res, 403, "forbidden");
    }
    const f = below(PACKAGE_DIR, p.slice(1));
    return f ? sendFile(res, f) : send(res, 403, "forbidden");
  });
  server.on("error", reject);
  server.listen(port, "127.0.0.1", () => {
    resolve({ url: `http://127.0.0.1:${server.address().port}`, files, server,
              close: () => new Promise((r) => { server.closeAllConnections(); server.close(() => r()); }) });
  });
});
