// Actual Playwright MCP calls against a running local backend (no mocked APIs).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

const output = '.data/browser';
await mkdir(output, { recursive: true });
const socketScript = await readFile('node_modules/socket.io-client/dist/socket.io.min.js');
const harness = createServer((req, res) => {
  if (req.url === '/socket.io-client.js') {
    res.setHeader('Content-Type', 'application/javascript');
    res.end(socketScript);
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end(
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>IntellMeet backend browser audit</title><link rel="icon" href="data:,"></head><body><h1>IntellMeet backend browser audit</h1><p>This temporary test page exercises the running API. It is not the product frontend.</p><pre id="results">Tests running...</pre></body></html>',
  );
});
await new Promise((done, reject) => {
  harness.once('error', reject);
  harness.listen(5173, '127.0.0.1', done);
});
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [
    'node_modules/@playwright/mcp/cli.js',
    '--browser',
    'msedge',
    '--headless',
    '--isolated',
    '--output-dir',
    output,
    '--allowed-origins',
    'http://localhost:5173;http://localhost:4000;http://localhost:8026',
  ],
  stderr: 'pipe',
});
const client = new Client({ name: 'intellmeet-browser-audit', version: '1.0.0' });
const evidence = [];
async function call(name, args) {
  const result = await client.callTool({ name, arguments: args });
  const text =
    result.content
      ?.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ?? '';
  if (result.isError || text.startsWith('### Error')) throw new Error(`${name}: ${text}`);
  // Do not persist MCP's echoed executable code: synthetic login inputs appear in it.
  return text.split('### Ran Playwright code')[0];
}
async function evaluate(name, fn) {
  const result = await call('browser_evaluate', { function: fn });
  evidence.push({ name, result });
  console.log(`PASS ${name}`);
  return result;
}
const email = `browser-${randomUUID()}@example.test`;
const password = `Local-test-${randomUUID()}`;
async function verificationToken() {
  for (let attempt = 0; attempt < 20; attempt++) {
    const list = await (await fetch('http://localhost:8026/api/v1/messages')).json();
    const mail = list.messages.find((m) => m.To?.some((to) => to.Address === email));
    if (mail) {
      const body = await (await fetch(`http://localhost:8026/api/v1/message/${mail.ID}`)).json();
      const token = body.Text?.match(/#token=([^\s]+)/)?.[1];
      if (token) return token;
    }
    await delay(250);
  }
  throw new Error('Verification email did not reach local SMTP');
}
let failed;
try {
  await client.connect(transport);
  await call('browser_navigate', { url: 'http://localhost:5173' });
  await evaluate(
    'browser CORS readiness and registration',
    `async () => {
    window.auditResults = [];
    window.check = (condition, message) => { if (!condition) throw new Error(message); };
    window.api = async (path, method='GET', body, expected=200, csrf=true) => {
      const response = await fetch('http://localhost:4000' + path, { method, credentials: 'include', headers: { ...(body !== undefined ? {'Content-Type':'application/json'} : {}), ...(csrf && window.csrf ? {'X-CSRF-Token':window.csrf} : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
      const result = response.status === 204 ? null : await response.json();
      check(response.status === expected, method + ' ' + path + ': expected ' + expected + ', received ' + response.status + ' ' + JSON.stringify(result));
      auditResults.push(method + ' ' + path + ': ' + response.status);
      return result;
    };
    await api('/health/ready');
    await api('/api/auth/register','POST',${JSON.stringify({ email, password, name: 'Browser audit user' })},202);
    return 'Ready and registration accepted from browser origin';
  }`,
  );
  const token = await verificationToken();
  await evaluate(
    'SMTP verification and HttpOnly cookie login',
    `async () => {
    await api('/api/auth/verify-email','POST',${JSON.stringify({ token })});
    const login = await api('/api/auth/login','POST',${JSON.stringify({ email, password })});
    window.csrf = login.csrfToken; window.access = login.accessToken;
    const profile = await api('/api/auth/me');
    check(profile.user.email === ${JSON.stringify(email)}, 'Cookie authentication failed');
    check(!document.cookie.includes('im_access') && !document.cookie.includes('im_refresh'), 'HttpOnly cookie exposed to script');
    return 'Email received through real SMTP, account verified and cookie authentication passed';
  }`,
  );
  await evaluate(
    'CSRF denial, preferences and workspace onboarding',
    `async () => {
    const denied = await api('/api/account/preferences','PATCH',{analyticsConsent:true},403,false);
    check(denied.error.code === 'CSRF_INVALID','Wrong CSRF response');
    await api('/api/account/preferences','PATCH',{timezone:'Asia/Kolkata',analyticsConsent:false});
    await api('/api/account/preferences','PATCH',{timezone:'Invalid/Zone'},400);
    const workspace = await api('/api/workspaces','POST',{name:'Playwright browser audit'},201);
    window.workspaceId = workspace.workspace._id;
    await api('/api/account/onboarding/complete','POST',{},204);
    const progress = await api('/api/account/onboarding');
    check(Boolean(progress.completedAt), 'Onboarding was not persisted');
    return 'Browser CSRF, validation, workspace and onboarding passed';
  }`,
  );
  await evaluate(
    'meeting lifecycle, chat idempotency and optimistic note edits',
    `async () => {
    const created = await api('/api/workspaces/'+workspaceId+'/meetings','POST',{title:'Browser meeting',startsAt:new Date().toISOString()},201);
    window.meetingId = created.meeting._id;
    await api('/api/meetings/'+meetingId+'/start','POST',{});
    await api('/api/meetings/'+meetingId+'/join','POST',{aiConsent:true,recordingConsent:true});
    const message = {clientId:crypto.randomUUID(),text:'Browser chat',mentions:[]};
    const first = await api('/api/meetings/'+meetingId+'/messages','POST',message,201);
    const second = await api('/api/meetings/'+meetingId+'/messages','POST',message,201);
    check(first.message._id === second.message._id,'Duplicate chat message');
    await api('/api/meetings/'+meetingId+'/notes','PUT',{text:'Browser notes',revision:0});
    await api('/api/meetings/'+meetingId+'/notes','PUT',{text:'Stale notes',revision:0},409);
    const notes = await api('/api/meetings/'+meetingId+'/notes');
    check(notes.note.text === 'Browser notes','Stale edit overwrote notes');
    return 'Meeting, Redis locking, chat deduplication and note conflict passed';
  }`,
  );
  await evaluate(
    'browser WebSocket authorization and subscription',
    `async () => {
    await new Promise((resolve,reject) => { const script = document.createElement('script'); script.src='/socket.io-client.js'; script.onload=resolve; script.onerror=reject; document.head.appendChild(script); });
    window.auditSocket = io('http://localhost:4000',{transports:['websocket'],auth:{token:access},reconnection:false});
    await new Promise((resolve,reject) => { auditSocket.once('connect',resolve); auditSocket.once('connect_error',reject); setTimeout(()=>reject(new Error('Socket connection timeout')),5000); });
    const result = await auditSocket.timeout(5000).emitWithAck('meeting.subscribe',{meetingId});
    check(result.ok,'Authorized meeting subscription rejected');
    return 'Actual browser WebSocket connected through Redis adapter';
  }`,
  );
  await evaluate(
    'support workflow and explicit unavailable integrations',
    `async () => {
    const created = await api('/api/account/support','POST',{workspaceId,subject:'Browser test',message:'Synthetic support request'},201);
    await api('/api/account/support/'+created.ticket._id,'PATCH',{status:'resolved',response:'Synthetic response'});
    const list = await api('/api/account/support?workspaceId='+workspaceId);
    check(list.tickets[0].status === 'resolved','Support response missing');
    const media = await api('/api/meetings/'+meetingId+'/media-token','POST',{},503);
    check(media.error.code === 'MEDIA_UNAVAILABLE','Wrong media configuration error');
    const ai = await api('/api/meetings/'+meetingId+'/audio-uploads','POST',{contentType:'audio/wav',size:24,startSeconds:0,durationSeconds:10},503);
    check(ai.error.code === 'AI_UNAVAILABLE','Wrong AI configuration error');
    return 'Support persisted; unavailable providers return explicit 503';
  }`,
  );
  await evaluate(
    'refresh rotation and CSRF recovery',
    `async () => {
    const refreshed = await api('/api/auth/refresh','POST',{});
    window.csrf = refreshed.csrfToken;
    const recovered = await api('/api/auth/csrf');
    check(recovered.csrfToken === csrf,'CSRF recovery mismatch');
    await api('/api/auth/me');
    return 'Refresh cookie rotation and CSRF recovery passed';
  }`,
  );
  await evaluate(
    'end meeting and real BullMQ purge processing',
    `async () => {
    await api('/api/meetings/'+meetingId+'/end','POST',{},204);
    const deletion = await api('/api/meetings/'+meetingId,'DELETE',undefined,202);
    window.purgeJobId = deletion.job._id;
    for(let i=0;i<30;i++) {
      const {job} = await api('/api/jobs/'+purgeJobId);
      if(job.status === 'completed') return 'Purge completed through actual Redis/BullMQ worker';
      if(job.status === 'failed') throw new Error('Purge failed: '+job.error);
      await new Promise(resolve=>setTimeout(resolve,300));
    }
    throw new Error('Worker did not complete purge');
  }`,
  );
  await evaluate(
    'logout revokes browser cookies and socket session',
    String.raw`async () => {
    await api('/api/auth/logout','POST',{},204);
    await api('/api/auth/me','GET',undefined,401);
    await new Promise(resolve=>setTimeout(resolve,200));
    check(!auditSocket.connected,'Logged-out socket remained connected');
    document.querySelector('#results').textContent = auditResults.join('\n')+'\n\nAll browser audit phases passed.';
    return {requests:auditResults.length,logout:'passed',socketRevocation:'passed'};
  }`,
  );
  await call('browser_take_screenshot', {
    filename: `${output}/passed.png`,
    fullPage: true,
    scale: 'css',
  });
} catch (err) {
  failed = err;
  console.error(err.message);
} finally {
  try {
    evidence.push({
      name: 'console',
      result: await call('browser_console_messages', { level: 'error', all: true }),
    });
    evidence.push({
      name: 'network',
      result: await call('browser_network_requests', { static: false }),
    });
  } catch {
    /* startup may have failed */
  }
  await writeFile(
    `${output}/report.json`,
    JSON.stringify(
      {
        date: new Date().toISOString(),
        passed: !failed,
        phases: evidence,
        failure: failed?.message,
      },
      null,
      2,
    ),
  );
  await client.close();
  await new Promise((done) => harness.close(done));
}
if (failed) process.exitCode = 1;
