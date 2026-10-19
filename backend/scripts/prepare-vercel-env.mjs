import { randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { parse } from 'dotenv';

const origin = new URL(process.argv[2] || 'https://intellmeet-frontend-rust.vercel.app');
if (
  origin.protocol !== 'https:' ||
  origin.username ||
  origin.password ||
  origin.pathname !== '/' ||
  origin.search ||
  origin.hash
)
  throw new Error(
    'Provide only the public HTTPS origin, without credentials, a path, query or fragment.',
  );

const destination = new URL('../.env.vercel.production.local', import.meta.url);
const values = {
  NODE_ENV: 'production',
  APP_URL: origin.origin,
  API_URL: origin.origin,
  CORS_ORIGINS: origin.origin,
  REQUIRE_EMAIL_VERIFICATION: 'true',
  REQUIRE_ADMIN_MFA: 'true',
  JWT_SECRET: randomBytes(48).toString('hex'),
  ENCRYPTION_KEY: randomBytes(32).toString('hex'),
  METRICS_TOKEN: randomBytes(32).toString('hex'),
  MONGODB_URI: '',
  REDIS_URL: '',
  SMTP_URL: '',
  EMAIL_FROM: '',
};
try {
  await writeFile(
    destination,
    '# PRIVATE: import into Vercel Production environment settings, never Git.\n' +
      '# Complete the empty provider values before importing and redeploying.\n' +
      '# Keep these secrets stable; regenerating ENCRYPTION_KEY breaks existing encrypted data.\n' +
      Object.entries(values)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n') +
      '\n',
    { flag: 'wx', mode: 0o600 },
  );
  console.log('Prepared new production secrets without displaying them.');
} catch (error) {
  if (error.code !== 'EEXIST') throw error;
  console.log('Preserved existing production secrets; nothing was overwritten.');
}
const prepared = parse(await readFile(destination));
const missing = Object.keys(values).filter((key) => !prepared[key]);
console.log(`Private environment file: ${fileURLToPath(destination)}`);
console.log(
  missing.length
    ? `Complete provider settings: ${missing.join(', ')}`
    : 'All listed settings have values; validate provider access before deployment.',
);
console.log(
  'No Vercel settings were changed. Import as Production variables (secrets as Secret), then redeploy.',
);
