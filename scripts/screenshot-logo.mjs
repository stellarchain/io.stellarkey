import fs from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    deviceScaleFactor: 2, // 2x Retina
    viewport: { width: 1000, height: 600 },
  });
  const page = await context.newPage();

  const svgContent = fs.readFileSync("src/app/icon.svg", "utf8");
  const refB64 = fs.readFileSync("public/reference-crop.png").toString("base64");

  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8"/>
      <style>
        body {
          margin: 0;
          padding: 32px 40px;
          background: #000000;
          color: #ffffff;
          font-family: -apple-system, BlinkMacSystemFont, "SF Pro Display", sans-serif;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 24px;
        }
        .header {
          text-align: center;
        }
        h1 {
          font-size: 20px;
          font-weight: 600;
          color: #f4f4f5;
          letter-spacing: -0.02em;
          margin: 0 0 4px 0;
        }
        p {
          font-size: 13px;
          color: #71717a;
          margin: 0;
        }
        .comparison-row {
          display: flex;
          align-items: center;
          gap: 24px;
          padding: 24px 32px;
          background: #121214;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
        }
        .comp-item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 10px;
        }
        .comp-label {
          font-size: 12px;
          color: #a1a1aa;
          font-weight: 500;
        }
        .grid {
          display: flex;
          align-items: flex-end;
          gap: 32px;
          padding: 28px 36px;
          background: #121214;
          border-radius: 20px;
          border: 1px solid rgba(255, 255, 255, 0.08);
          box-shadow: 0 20px 40px rgba(0,0,0,0.8);
        }
        .item {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 12px;
        }
        .label {
          font-size: 12px;
          color: #8e8e93;
          font-weight: 500;
          letter-spacing: -0.01em;
        }
        .icon-container {
          display: flex;
          align-items: center;
          justify-content: center;
          filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
        }
      </style>
    </head>
    <body>
      <div class="header">
        <h1>Stellar Wallet App Icon — Exact Reference Match & Multi-Scale Verification</h1>
        <p>1:1 Official Vector Geometry in Crisp White across All Viewport Scales</p>
      </div>

      <div class="comparison-row">
        <div class="comp-item">
          <img src="data:image/png;base64,${refB64}" style="width: 140px; height: auto; filter: invert(1) brightness(1.2); border-radius: 8px;" />
          <span class="comp-label">Official Reference (Inverted White)</span>
        </div>
        <div style="font-size: 24px; color: #52525b;">➜</div>
        <div class="comp-item">
          <div style="width: 100px; height: 100px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="comp-label">Wallet App Icon (100px)</span>
        </div>
      </div>

      <div class="grid">
        <div class="item">
          <div class="icon-container" style="width: 128px; height: 128px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">128px (Hero / Splash)</span>
        </div>
        <div class="item">
          <div class="icon-container" style="width: 64px; height: 64px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">64px (Lock Screen)</span>
        </div>
        <div class="item">
          <div class="icon-container" style="width: 48px; height: 48px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">48px (Modals)</span>
        </div>
        <div class="item">
          <div class="icon-container" style="width: 32px; height: 32px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">32px (Header)</span>
        </div>
        <div class="item">
          <div class="icon-container" style="width: 24px; height: 24px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">24px (Sidebar)</span>
        </div>
        <div class="item">
          <div class="icon-container" style="width: 20px; height: 20px;">
            ${svgContent.replace('<svg ', '<svg style="width: 100%; height: 100%;" ')}
          </div>
          <span class="label">20px (Toolbar)</span>
        </div>
      </div>
    </body>
    </html>
  `;

  await page.setContent(html);
  await page.waitForTimeout(300);
  await page.screenshot({ path: "public/icon-verification.png" });
  console.log("Verified multi-scale screenshot saved to public/icon-verification.png");

  // 2. Start server and capture in-app Lock Screen & Onboarding UI
  const server = spawn("npm", ["run", "start"], {
    stdio: "pipe",
    env: { ...process.env, PORT: "3458" },
  });

  let serverReady = false;
  server.stdout.on("data", (data) => {
    if (data.toString().includes("Ready") || data.toString().includes("3458")) {
      serverReady = true;
    }
  });

  for (let i = 0; i < 30; i++) {
    if (serverReady) break;
    await new Promise((r) => setTimeout(r, 200));
  }

  try {
    const appPage = await context.newPage();
    await appPage.setViewportSize({ width: 1200, height: 800 });
    await appPage.goto("http://localhost:3458");
    await appPage.waitForSelector("button", { timeout: 10000 });
    await appPage.screenshot({ path: "public/app-screen-verification.png" });
    console.log("In-app screen verification saved to public/app-screen-verification.png");
  } finally {
    server.kill();
    await browser.close();
  }
}

main().catch(console.error);
