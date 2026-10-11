// Local frontend smoke audit using the existing Playwright MCP installation.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const running = JSON.parse(await readFile('.data/local-run/running.json', 'utf8'));
if (!running.services) throw new Error('Use the isolated local service runtime');
const account = JSON.parse(await readFile('.data/frontend-audit/account.json', 'utf8'));
if (!account.email.endsWith('@example.test')) throw new Error('Synthetic accounts only');
const output = '.data/frontend-audit';
await mkdir(output, { recursive: true });
await writeFile(
  `${output}/browser-config.json`,
  JSON.stringify({
    browser: {
      launchOptions: {
        args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'],
      },
    },
  }),
);
const client = new Client({ name: 'intellmeet-frontend-audit', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    'node_modules/@playwright/mcp/cli.js',
    '--browser',
    'msedge',
    '--headless',
    '--isolated',
    '--config',
    `${output}/browser-config.json`,
    '--output-dir',
    output,
    '--allowed-origins',
    'http://localhost:5173;http://127.0.0.1:7880',
  ],
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  async function call(name, args) {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(JSON.stringify(r.content));
    return r;
  }
  await call('browser_navigate', { url: 'http://localhost:5173/login' });
  await call('browser_fill_form', {
    fields: [
      {
        target: 'input[autocomplete="email"]',
        name: 'Work email',
        type: 'textbox',
        value: account.email,
      },
      {
        target: 'input[autocomplete="current-password"]',
        name: 'Password',
        type: 'textbox',
        value: account.password,
      },
    ],
  });
  await call('browser_click', { target: 'button:has-text("Sign in to your workspace")' });
  await call('browser_evaluate', {
    function:
      'async()=>{for(let i=0;i<40;i++){if(document.querySelector(".meeting-card"))return "workspace ready";await new Promise(r=>setTimeout(r,250));}throw new Error("workspace not ready");}',
  });
  await call('browser_click', { target: '.meeting-card button:has-text("Join meeting")' });
  await call('browser_evaluate', {
    function:
      'async()=>{for(let i=0;i<40;i++){if(Array.from(document.querySelectorAll("button")).some(b=>b.textContent.includes("Connect video")))return "meeting ready";await new Promise(r=>setTimeout(r,250));}throw new Error("meeting not ready");}',
  });
  await call('browser_click', { target: 'button:has-text("Connect video")' });
  await call('browser_click', { target: '.lk-button[data-lk-source="camera"]' });
  const result = await call('browser_evaluate', {
    function:
      'async()=>{await new Promise(r=>setTimeout(r,18000));if(document.querySelector("[data-testid=media-connection]")?.textContent!=="connected")throw new Error("Media did not connect");return {roomVisible:!!document.querySelector(".lk-room-container"),alerts:Array.from(document.querySelectorAll("[role=alert]")).map(e=>e.textContent),roomText:document.querySelector(".lk-room-container")?.textContent};}',
  });
  await call('browser_take_screenshot', {
    filename: resolve(output, 'room.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_click', { target: 'button:has-text("Workspace")' });
  await call('browser_evaluate', {
    function:
      'async()=>{for(let i=0;i<40;i++){if(document.querySelector(".stats-grid"))return "overview ready";await new Promise(r=>setTimeout(r,250));}throw new Error("overview not ready");}',
  });
  await call('browser_take_screenshot', {
    filename: resolve(output, 'desktop.png'),
    fullPage: true,
    scale: 'css',
  });
  const safe = {
    isError: result.isError ?? false,
    content: result.content
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .map((t) =>
        t
          .replaceAll(account.password, '[test password]')
          .replace(/access_token=[^\s&]+/g, 'access_token=[redacted]'),
      ),
  };
  await writeFile(`${output}/report.json`, JSON.stringify(safe, null, 2));
  console.log(JSON.stringify(safe));
  if (safe.isError) process.exitCode = 1;
} finally {
  await client.close();
  await transport.close();
}
