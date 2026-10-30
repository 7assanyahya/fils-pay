#!/usr/bin/env node
// Local-only same-origin proxy for the dashboard and admin console.
//
// The API sends no CORS headers (deliberately; nothing here changes that), so
// a browser on :5173/:5174 can't call :3000 directly. This proxy puts each
// frontend and the API behind one origin: /v1/* goes to the API, everything
// else (including Vite's HMR websocket) goes to the frontend's Vite server.
//
// Usage:
//   node scripts/dev/proxy.mjs <listenPort> <vitePort> [apiPort=3000]
//   node scripts/dev/proxy.mjs 8173 5173      # web   → http://localhost:8173
//   node scripts/dev/proxy.mjs 8174 5174      # admin → http://localhost:8174
// Then run the frontends with VITE_API_BASE_URL=http://localhost:8173 and
// VITE_ADMIN_API_BASE_URL=http://localhost:8174 (VITE_WEB_BASE_URL too).
//
// Upstreams are addressed as "localhost" because Vite binds IPv6 (::1) only.
import http from "node:http";
import net from "node:net";

const [listenPort, vitePort, apiPort = "3000"] = process.argv.slice(2).map(Number);
if (!listenPort || !vitePort) {
  console.error("usage: node scripts/dev/proxy.mjs <listenPort> <vitePort> [apiPort]");
  process.exit(2);
}

const upstreamFor = (url = "/") => (url.startsWith("/v1/") || url === "/v1" ? apiPort : vitePort);

const server = http.createServer((req, res) => {
  const upstream = http.request(
    { host: "localhost", port: upstreamFor(req.url), method: req.method, path: req.url, headers: req.headers },
    (up) => {
      res.writeHead(up.statusCode ?? 502, up.headers);
      up.pipe(res);
    },
  );
  upstream.on("error", (err) => {
    res.writeHead(502, { "content-type": "text/plain" });
    res.end(`proxy: upstream ${upstreamFor(req.url)} unavailable: ${err.message}`);
  });
  req.pipe(upstream);
});

// Websocket upgrades (Vite HMR) are tunnelled byte-for-byte.
server.on("upgrade", (req, socket, head) => {
  const up = net.connect(upstreamFor(req.url), "localhost", () => {
    const headers = Object.entries(req.headers).map(([k, v]) => `${k}: ${v}`).join("\r\n");
    up.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n\r\n`);
    up.write(head);
    socket.pipe(up).pipe(socket);
  });
  up.on("error", () => socket.destroy());
  socket.on("error", () => up.destroy());
});

server.listen(listenPort, "localhost", () => {
  console.log(`proxy: http://localhost:${listenPort}  /v1/* → :${apiPort}, else → :${vitePort}`);
});
