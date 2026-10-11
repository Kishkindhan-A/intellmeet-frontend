// Isolated Windows development run: real MongoDB, Redis and captured SMTP.
// Provider credentials from the user's .env are deliberately not used.
import { spawn } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, readdir, rm, access } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { Redis } from 'ioredis';
import { parse } from 'dotenv';

const root = resolve('.');
const services = process.argv.includes('--services');
const directory = join(root, '.data', 'local-run');
await mkdir(directory, { recursive: true });
const stopFile = join(directory, 'stop');
if (process.argv.includes('--stop')) {
  await writeFile(stopFile, 'stop');
  console.log('Local runtime stop requested.');
  process.exit(0);
}
if (process.platform !== 'win32') throw new Error('Use Docker Compose on Linux/macOS.');
try {
  const previous = JSON.parse(await readFile(join(directory, 'running.json'), 'utf8'));
  let active = false;
  try {
    process.kill(previous.pid, 0);
    active = true;
  } catch {
    /* previous process exited */
  }
  if (active) throw new Error('Local runtime is already running; use npm run local:stop first.');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}
await rm(stopFile, { force: true });
const credentialFile = join(directory, 'credentials.json');
let credentials;
try {
  credentials = JSON.parse(await readFile(credentialFile, 'utf8'));
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
  credentials = {
    jwt: randomBytes(48).toString('hex'),
    encryption: randomBytes(32).toString('hex'),
    redis: randomBytes(32).toString('hex'),
    metrics: randomBytes(32).toString('hex'),
  };
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600, flag: 'wx' });
}
if (services && !credentials.livekitKey) {
  credentials.livekitKey = `local${randomBytes(12).toString('hex')}`;
  credentials.livekitSecret = randomBytes(32).toString('hex');
  credentials.storageKey = `local${randomBytes(12).toString('hex')}`;
  credentials.storageSecret = randomBytes(32).toString('hex');
  await writeFile(credentialFile, JSON.stringify(credentials), { mode: 0o600 });
}
const redisDirectories = await readdir(join(root, '.data', 'tools', 'redis'));
const redisExe =
  process.env.INTELLMEET_REDIS_EXE ??
  join(
    root,
    '.data',
    'tools',
    'redis',
    redisDirectories.find((name) => name.startsWith('Redis-')),
    'redis-server.exe',
  );
const mailpitExe =
  process.env.INTELLMEET_MAILPIT_EXE ?? join(root, '.data', 'tools', 'mailpit', 'mailpit.exe');
await access(redisExe);
await access(mailpitExe);
await mkdir(join(directory, 'mongo'), { recursive: true });
await mkdir(join(directory, 'redis'), { recursive: true });
const children = [];
const logs = [];
let mongo;
let stopping = false;
function start(name, command, args, env = process.env) {
  const log = createWriteStream(join(directory, `${name}.log`), { flags: 'a' });
  logs.push(log);
  const child = spawn(command, args, {
    cwd: root,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on('error', (err) => {
    console.error(`${name} could not start: ${err.message}`);
    void stop(1);
  });
  child.on('exit', (code) => {
    if (!stopping) {
      console.error(`${name} stopped (${code}); inspect .data/local-run/${name}.log`);
      void stop(1);
    }
  });
  children.push(child);
  return child;
}
async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  clearInterval(stopPoll);
  for (const child of children.reverse()) {
    if (child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([new Promise((done) => child.once('exit', done)), delay(5000)]);
    }
  }
  await mongo?.stop({ doCleanup: false });
  for (const log of logs) log.end();
  await rm(join(directory, 'running.json'), { force: true });
  console.log('Local runtime stopped; development data retained.');
  process.exit(code);
}
const stopPoll = setInterval(async () => {
  try {
    await access(stopFile);
    await stop();
  } catch {
    /* no stop requested */
  }
}, 1000);
process.on('SIGTERM', () => {
  void stop();
});
process.on('SIGINT', () => {
  void stop();
});
async function waitHttp(url) {
  for (let attempt = 0; attempt < 60; attempt++) {
    if (stopping) throw new Error('Runtime exited');
    try {
      if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
    } catch {
      /* starting */
    }
    await delay(500);
  }
  throw new Error(`Startup timed out: ${url}`);
}
try {
  const redisConfig = join(directory, 'redis.conf');
  await writeFile(
    redisConfig,
    `bind 127.0.0.1\nport 6380\nprotected-mode yes\nrequirepass ${credentials.redis}\nmaxmemory-policy noeviction\nappendonly yes\ndir "${join(directory, 'redis').replaceAll('\\', '/')}"\n`,
  );
  start('redis', redisExe, ['.data/local-run/redis.conf']);
  const redisUrl = `redis://:${credentials.redis}@127.0.0.1:6380`;
  const probe = new Redis(redisUrl, {
    maxRetriesPerRequest: 1,
    retryStrategy: (n) => (n < 60 ? 250 : null),
  });
  probe.on('error', () => {});
  let redisReady = false;
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      await probe.ping();
      redisReady = true;
      break;
    } catch {
      await delay(250);
    }
  }
  if (!redisReady) {
    probe.disconnect();
    throw new Error('Redis failed to start; inspect redis.log');
  }
  await probe.quit();
  start('mailpit', mailpitExe, [
    '--smtp',
    '127.0.0.1:1026',
    '--listen',
    '127.0.0.1:8026',
    '--database',
    join(directory, 'mailpit.db'),
  ]);
  await waitHttp('http://127.0.0.1:8026/readyz');
  mongo = await MongoMemoryReplSet.create({
    binary: { version: '8.2.6' },
    instanceOpts: [{ port: 27018, dbPath: join(directory, 'mongo') }],
    replSet: { count: 1, storageEngine: 'wiredTiger', ip: '127.0.0.1' },
  });
  let verificationEmail = {};
  try {
    verificationEmail = parse(await readFile(join(root, '.env.resend.local'), 'utf8'));
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }
  const env = {
    ...process.env,
    NODE_ENV: 'development',
    BIND_ADDRESS: '127.0.0.1',
    PORT: '4000',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:4000',
    // Browsers treat localhost and 127.0.0.1 as distinct origins. Both are
    // supported loopback entry points for the local frontend and API.
    CORS_ORIGINS:
      'http://localhost:5173,http://127.0.0.1:5173,http://localhost:4000,http://127.0.0.1:4000',
    MONGODB_URI: mongo.getUri('intellmeet_local'),
    REDIS_URL: redisUrl,
    SMTP_URL: 'smtp://127.0.0.1:1026',
    RESEND_VERIFICATION_API_KEY: verificationEmail.RESEND_VERIFICATION_API_KEY || '',
    RESEND_TEST_RECIPIENT: verificationEmail.RESEND_TEST_RECIPIENT || '',
    EMAIL_FROM: 'IntellMeet Local <no-reply@example.test>',
    JWT_SECRET: credentials.jwt,
    ENCRYPTION_KEY: credentials.encryption,
    METRICS_TOKEN: credentials.metrics,
    REQUIRE_ADMIN_MFA: 'false',
    MAINTENANCE_MODE: 'false',
    OPENAI_API_KEY: '',
    LIVEKIT_URL: '',
    LIVEKIT_PUBLIC_URL: '',
    LIVEKIT_API_KEY: '',
    LIVEKIT_API_SECRET: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    SECURITY_CONTACT: '',
    SECURITY_CONTACT_EXPIRES: '',
    S3_ENDPOINT: 'http://127.0.0.1:9000',
    S3_PUBLIC_ENDPOINT: 'http://127.0.0.1:9000',
    S3_ACCESS_KEY_ID: 'local-disabled',
    S3_SECRET_ACCESS_KEY: credentials.redis,
    LOG_LEVEL: 'info',
  };
  if (services) {
    const livekitConfig = join(directory, 'livekit.yaml');
    await writeFile(
      livekitConfig,
      `port: 7880\nbind_addresses: ["127.0.0.1"]\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  use_external_ip: false\n  node_ip: 127.0.0.1\n  enable_loopback_candidate: true\nredis:\n  address: 127.0.0.1:6380\n  password: ${credentials.redis}\nkeys:\n  ${credentials.livekitKey}: ${credentials.livekitSecret}\nwebhook:\n  api_key: ${credentials.livekitKey}\n  urls: ["http://127.0.0.1:4000/webhooks/livekit"]\n`,
      { mode: 0o600 },
    );
    start('livekit', join(root, '.data/tools/livekit/livekit-server.exe'), [
      '--config',
      livekitConfig,
    ]);
    await waitHttp('http://127.0.0.1:7880');
    await mkdir(join(directory, 'storage'), { recursive: true });
    start(
      'storage',
      join(root, '.data/tools/storage/weed.exe'),
      [
        'mini',
        '-dir=' + join(directory, 'storage'),
        '-ip=127.0.0.1',
        '-ip.bind=127.0.0.1',
        '-s3.port=9000',
      ],
      {
        ...process.env,
        AWS_ACCESS_KEY_ID: credentials.storageKey,
        AWS_SECRET_ACCESS_KEY: credentials.storageSecret,
        S3_BUCKET: 'intellmeet',
      },
    );
    // Authenticated S3 readiness is checked below, rather than relying on a public HTTP endpoint.
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3');
    const s3 = new S3Client({
      endpoint: 'http://127.0.0.1:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: {
        accessKeyId: credentials.storageKey,
        secretAccessKey: credentials.storageSecret,
      },
      maxAttempts: 1,
    });
    let ready = false;
    for (let attempt = 0; attempt < 60 && !stopping; attempt++) {
      try {
        await s3.send(new HeadBucketCommand({ Bucket: 'intellmeet' }), {
          abortSignal: AbortSignal.timeout(1000),
        });
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    s3.destroy();
    if (!ready) throw new Error('Local S3 startup failed; inspect storage.log');
    Object.assign(env, {
      LIVEKIT_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_PUBLIC_URL: 'ws://127.0.0.1:7880',
      LIVEKIT_API_KEY: credentials.livekitKey,
      LIVEKIT_API_SECRET: credentials.livekitSecret,
      LIVEKIT_CLOUD: 'false',
      S3_ACCESS_KEY_ID: credentials.storageKey,
      S3_SECRET_ACCESS_KEY: credentials.storageSecret,
      S3_REGION: 'us-east-1',
      S3_BUCKET: 'intellmeet',
      S3_FORCE_PATH_STYLE: 'true',
    });
  }
  start('api', process.execPath, ['dist/server.js'], env);
  start('worker', process.execPath, ['dist/worker.js'], env);
  await waitHttp('http://localhost:4000/health/ready');
  await writeFile(
    join(directory, 'running.json'),
    JSON.stringify(
      {
        pid: process.pid,
        api: 'http://localhost:4000',
        inbox: 'http://localhost:8026',
        services,
        startedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  console.log('Backend ready: http://localhost:4000/health/ready');
  console.log('Captured development email: http://localhost:8026');
  console.log(
    services
      ? 'Local MongoDB/Redis/SMTP/LiveKit/S3 active; OpenAI and Google login disabled. Recording requires an egress service.'
      : 'Real MongoDB/Redis/SMTP; LiveKit, OpenAI and Google login disabled in this isolated run.',
  );
  console.log('Stop with: npm run local:stop');
} catch (err) {
  console.error(err.message);
  await stop(1);
}
