import { spawn } from "node:child_process";
import fs from "node:fs";

async function main() {
  const merchantId = "9972daab-2c86-459f-9d78-3fe1be4e3280";
  const email = "owner@alpharetail.example";
  const password = "FilsPaySeed!2026";

  console.log("Step 1: Logging in...");
  const loginRes = await fetch("http://localhost:8173/v1/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ merchantId, email, password }),
  });

  const cookieHeader = loginRes.headers.get("set-cookie") || "";
  const sidMatch = cookieHeader.match(/fp_sid=([^;]+)/);
  if (!sidMatch) {
    throw new Error("No fp_sid in login response: " + cookieHeader);
  }
  const pendingSid = sidMatch[1];
  const loginBody = await loginRes.json();
  const otpCode = loginBody.devOtpCode;
  console.log("Got OTP code:", otpCode);

  const verifyRes = await fetch("http://localhost:8173/v1/auth/otp/verify", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: `fp_sid=${pendingSid}`,
    },
    body: JSON.stringify({ code: otpCode }),
  });

  const authCookieHeader = verifyRes.headers.get("set-cookie") || cookieHeader;
  const authSidMatch = authCookieHeader.match(/fp_sid=([^;]+)/);
  const authSid = authSidMatch ? authSidMatch[1] : pendingSid;
  console.log("Authenticated SID:", authSid);

  // Launch headless Chrome
  console.log("Step 2: Launching Chrome CDP...");
  const chrome = spawn(
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    [
      "--headless",
      "--disable-gpu",
      "--remote-debugging-port=9222",
      "--window-size=1200,900",
      "--user-data-dir=/tmp/chrome-dashboard-profile",
    ],
    { stdio: "ignore" }
  );

  await new Promise((r) => setTimeout(r, 2000));

  // Get WebSocket debugger URL
  const versionRes = await fetch("http://localhost:9222/json/version");
  const versionData = await versionRes.json();
  const wsUrl = versionData.webSocketDebuggerUrl;

  const ws = new WebSocket(wsUrl);
  await new Promise((resolve) => (ws.onopen = resolve));

  let reqId = 1;
  const send = (method, params = {}) =>
    new Promise((resolve) => {
      const id = reqId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          ws.removeEventListener("message", handler);
          resolve(msg.result);
        }
      };
      ws.addEventListener("message", handler);
      ws.send(JSON.stringify({ id, method, params }));
    });

  console.log("Step 3: Creating target page...");
  const { targetId } = await send("Target.createTarget", { url: "about:blank" });
  const pageWs = new WebSocket(`ws://localhost:9222/devtools/page/${targetId}`);
  await new Promise((resolve) => (pageWs.onopen = resolve));

  const pageSend = (method, params = {}) =>
    new Promise((resolve) => {
      const id = reqId++;
      const handler = (event) => {
        const msg = JSON.parse(event.data);
        if (msg.id === id) {
          pageWs.removeEventListener("message", handler);
          resolve(msg.result);
        }
      };
      pageWs.addEventListener("message", handler);
      pageWs.send(JSON.stringify({ id, method, params }));
    });

  await pageSend("Network.enable");
  await pageSend("Page.enable");

  console.log("Step 4: Setting authentication cookie...");
  await pageSend("Network.setCookie", {
    name: "fp_sid",
    value: authSid,
    domain: "localhost",
    path: "/",
    httpOnly: true,
  });

  console.log("Step 5: Navigating to transactions dashboard...");
  await pageSend("Page.navigate", { url: "http://localhost:8173/dashboard/transactions" });

  // Wait 3 seconds for React to fetch and render the table
  await new Promise((r) => setTimeout(r, 3000));

  console.log("Step 6: Capturing screenshot...");
  const { data } = await pageSend("Page.captureScreenshot", { format: "png" });
  fs.writeFileSync("docs/screenshots/banking-dashboard-after.png", Buffer.from(data, "base64"));
  console.log("Saved docs/screenshots/banking-dashboard-after.png!");

  ws.close();
  pageWs.close();
  chrome.kill();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
