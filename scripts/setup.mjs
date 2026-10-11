import { randomBytes } from 'node:crypto';
import { readFile, writeFile, mkdir, access } from 'node:fs/promises';
import { parse } from 'dotenv';
const random = () => randomBytes(32).toString('hex');
let env;
try {
  await access('.env');
  env = parse(await readFile('.env'));
  console.log('Using existing .env; secrets were not changed.');
} catch {
  const values = {
    REDIS_PASSWORD: random(),
    JWT_SECRET: random(),
    ENCRYPTION_KEY: random(),
    METRICS_TOKEN: random(),
    LIVEKIT_API_KEY: `API${randomBytes(10).toString('hex')}`,
    LIVEKIT_API_SECRET: random(),
    S3_ACCESS_KEY_ID: randomBytes(12).toString('hex'),
    S3_SECRET_ACCESS_KEY: random(),
  };
  let template = await readFile('.env.example', 'utf8');
  for (const [key, value] of Object.entries(values))
    template = template.replaceAll(`REPLACE_${key}`, value);
  await writeFile('.env', template, { flag: 'wx', mode: 0o600 });
  env = parse(template);
  console.log('Created .env with random local credentials.');
}
await mkdir('.data', { recursive: true });
await writeFile(
  '.data/livekit.yaml',
  `port: 7880\nbind_addresses: ["0.0.0.0"]\nrtc:\n  tcp_port: 7881\n  udp_port: 7882\n  use_external_ip: false\nredis:\n  address: redis:6379\n  password: ${env.REDIS_PASSWORD}\nkeys:\n  ${env.LIVEKIT_API_KEY}: ${env.LIVEKIT_API_SECRET}\nwebhook:\n  api_key: ${env.LIVEKIT_API_KEY}\n  urls: ["http://api:4000/webhooks/livekit"]\n`,
  { mode: 0o600 },
);
await writeFile(
  '.data/egress.yaml',
  `api_key: ${env.LIVEKIT_API_KEY}\napi_secret: ${env.LIVEKIT_API_SECRET}\nws_url: ws://livekit:7880\ninsecure: true\nenable_chrome_sandbox: true\nhealth_port: 8080\nredis:\n  address: redis:6379\n  password: ${env.REDIS_PASSWORD}\n`,
  { mode: 0o600 },
);
console.log(
  'Generated local LiveKit configuration. Add OPENAI_API_KEY to .env to enable AI. No services were started.',
);
