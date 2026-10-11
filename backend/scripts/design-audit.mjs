import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
const account = JSON.parse(await readFile('.data/frontend-audit/account.json', 'utf8'));
if (!account.email.endsWith('@example.test')) throw new Error('Synthetic local account required');
const client = new Client({ name: 'intellmeet-design-audit', version: '1.0.0' });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    'node_modules/@playwright/mcp/cli.js',
    '--browser',
    'msedge',
    '--headless',
    '--isolated',
    '--output-dir',
    '.data/frontend-audit',
    '--allowed-origins',
    'http://localhost:5173',
  ],
  stderr: 'pipe',
});
try {
  await client.connect(transport);
  const call = async (name, args) => {
    const r = await client.callTool({ name, arguments: args });
    if (r.isError) throw new Error(`${name} failed`);
    return r;
  };
  await call('browser_navigate', { url: 'http://localhost:5173' });
  await call('browser_resize', { width: 1440, height: 1000 });
  await call('browser_evaluate', {
    function:
      '()=>{if(!document.querySelector(".landing-hero"))throw new Error("Landing missing");return true;}',
  });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/landing-desktop.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_resize', { width: 390, height: 844 });
  await call('browser_evaluate', {
    function:
      '()=>{if(document.documentElement.scrollWidth>innerWidth+1)throw new Error("Landing overflow");return true;}',
  });
  await call('browser_click', { target: '.faq details:first-child summary' });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/landing-mobile.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_click', { target: '.landing-account a[href="/register"]' });
  await call('browser_evaluate', {
    function:
      '()=>{if(!document.querySelector("input[autocomplete=name]"))throw new Error("Registration link failed");return true;}',
  });
  await call('browser_navigate', { url: 'http://localhost:5173/login' });
  await call('browser_resize', { width: 1440, height: 1000 });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/signature-auth.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_resize', { width: 390, height: 844 });
  await call('browser_evaluate', {
    function:
      '()=>{if(document.documentElement.scrollWidth>innerWidth+1)throw new Error("Sign-in overflow");return true;}',
  });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/signature-auth-mobile.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_resize', { width: 1440, height: 1000 });
  await call('browser_fill_form', {
    fields: [
      {
        target: 'input[autocomplete="email"]',
        name: 'Email',
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
  await call('browser_click', { target: 'button[aria-label="Show password"]' });
  await call('browser_evaluate', {
    function:
      '()=>{if(document.querySelector("input[autocomplete=current-password]").type!=="text")throw new Error("Password toggle failed");return true;}',
  });
  await call('browser_click', { target: 'button[aria-label="Hide password"]' });
  await call('browser_click', { target: '.mfa-disclosure summary' });
  await call('browser_evaluate', {
    function:
      '()=>{if(!document.querySelector(".mfa-disclosure").open)throw new Error("MFA disclosure failed");return true;}',
  });
  await call('browser_click', { target: '.mfa-disclosure summary' });
  await call('browser_click', { target: 'button:has-text("Sign in to your workspace")' });
  await call('browser_evaluate', {
    function:
      'async()=>{for(let i=0;i<40;i++){if(document.querySelector(".week-grid"))return true;await new Promise(r=>setTimeout(r,250));}throw new Error("Overview missing");}',
  });
  await call('browser_click', { target: 'button[aria-label="Search workspace"]' });
  await call('browser_fill_form', {
    fields: [
      {
        target: 'input[aria-label="Search workspace"]',
        name: 'Workspace search',
        type: 'textbox',
        value: 'Product direction',
      },
    ],
  });
  await call('browser_evaluate', {
    function:
      '()=>{if(!document.querySelector(".command-results button")?.textContent.includes("Product direction"))throw new Error("Search result missing");return "Workspace search passed";}',
  });
  await call('browser_click', { target: 'dialog button[aria-label="Close dialog"]' });
  await call('browser_click', { target: 'summary.setup-heading' });
  await call('browser_evaluate', {
    function:
      '()=>{if(!document.querySelector("details.setup-panel")?.open)throw new Error("Checklist did not open");return true;}',
  });
  await call('browser_click', { target: 'summary.setup-heading' });
  await call('browser_click', { target: 'button[aria-label="Next week"]' });
  await call('browser_click', { target: 'button:has-text("This week")' });
  await call('browser_resize', { width: 1440, height: 1000 });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/design-desktop.png'),
    fullPage: true,
    scale: 'css',
  });
  await call('browser_resize', { width: 390, height: 844 });
  await call('browser_evaluate', {
    function:
      '()=>{if(document.documentElement.scrollWidth>window.innerWidth+1)throw new Error("Horizontal page overflow");return "Mobile reflow passed";}',
  });
  await call('browser_click', { target: 'button[aria-label="Open navigation"]' });
  await call('browser_click', { target: 'nav button:has-text("Meetings")' });
  await call('browser_evaluate', {
    function:
      '()=>{if(document.querySelector(".sidebar.mobile-open"))throw new Error("Navigation stayed open");if(!document.querySelector(".list-toolbar"))throw new Error("Meetings missing");return "Mobile navigation passed";}',
  });
  await call('browser_take_screenshot', {
    filename: resolve('.data/frontend-audit/design-mobile.png'),
    fullPage: true,
    scale: 'css',
  });
  console.log(
    'PASS: responsive sign-in, password visibility, MFA disclosure, login, workspace search, checklist, weekly navigation, desktop layout, mobile reflow and navigation.',
  );
} finally {
  await client.close();
  await transport.close();
}
