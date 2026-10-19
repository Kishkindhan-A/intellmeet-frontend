import 'dotenv/config';
import { z } from 'zod';

const optional = z.preprocess((v) => (v === '' ? undefined : v), z.string().optional());
export const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  BIND_ADDRESS: z.enum(['127.0.0.1', '0.0.0.0', '::1', '::']).default('0.0.0.0'),
  MONGODB_URI: z.string().default('mongodb://127.0.0.1:27017/intellmeet'),
  REDIS_URL: z.string().default('redis://127.0.0.1:6379'),
  APP_URL: z.url().default('http://localhost:5173'),
  API_URL: z.url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
  JWT_SECRET: z.string().min(32),
  ENCRYPTION_KEY: z.string().regex(/^[a-fA-F0-9]{64}$/),
  JWT_ISSUER: z.string().default('intellmeet'),
  JWT_AUDIENCE: z.string().default('intellmeet-api'),
  ACCESS_TOKEN_SECONDS: z.coerce.number().int().min(60).max(900).default(600),
  SESSION_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  REQUIRE_EMAIL_VERIFICATION: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
  MAINTENANCE_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  MAINTENANCE_RETRY_SECONDS: z.coerce.number().int().min(30).max(86400).default(300),
  SECURITY_CONTACT: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z
      .string()
      .max(500)
      .refine((v) => {
        if (/[\r\n]/.test(v)) return false;
        if (v.startsWith('mailto:')) return z.email().safeParse(v.slice(7)).success;
        try {
          const url = new URL(v);
          return url.protocol === 'https:' && !url.username && !url.password;
        } catch {
          return false;
        }
      }, 'Use a mailto email address or HTTPS URL')
      .optional(),
  ),
  SECURITY_CONTACT_EXPIRES: z.preprocess(
    (v) => (v === '' ? undefined : v),
    z.iso.datetime().optional(),
  ),
  METRICS_TOKEN: optional,
  SMTP_URL: optional,
  EMAIL_FROM: z.string().default('IntellMeet <no-reply@localhost>'),
  OPENAI_API_KEY: optional,
  OPENAI_SUMMARY_MODEL: z.string().default('gpt-4.1-mini'),
  OPENAI_TRANSCRIPTION_MODEL: z.string().default('gpt-4o-mini-transcribe'),
  LIVEKIT_URL: optional,
  LIVEKIT_PUBLIC_URL: optional,
  LIVEKIT_CLOUD: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LIVEKIT_API_KEY: optional,
  LIVEKIT_API_SECRET: optional,
  S3_ENDPOINT: optional,
  S3_PUBLIC_ENDPOINT: optional,
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('intellmeet'),
  S3_ACCESS_KEY_ID: optional,
  S3_SECRET_ACCESS_KEY: optional,
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  GOOGLE_CLIENT_ID: optional,
  GOOGLE_CLIENT_SECRET: optional,
  MAX_AUDIO_BYTES: z.coerce.number().int().min(1024).max(25000000).default(24000000),
  AI_JOBS_PER_WORKSPACE_DAY: z.coerce.number().int().min(1).default(100),
  MAX_PARTICIPANTS: z.coerce.number().int().min(2).max(500).default(100),
  REQUIRE_ADMIN_MFA: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'silent']).default('info'),
});
export type Config = z.infer<typeof configSchema>;
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const config = configSchema.parse(env);
  if (Boolean(config.SECURITY_CONTACT) !== Boolean(config.SECURITY_CONTACT_EXPIRES))
    throw new Error('Configure SECURITY_CONTACT and SECURITY_CONTACT_EXPIRES together');
  if (
    config.SECURITY_CONTACT_EXPIRES &&
    (Date.parse(config.SECURITY_CONTACT_EXPIRES) <= Date.now() ||
      Date.parse(config.SECURITY_CONTACT_EXPIRES) > Date.now() + 365 * 86400000)
  )
    throw new Error('Security contact expiry must be in the next year');
  if (config.NODE_ENV === 'production') {
    if (!config.APP_URL.startsWith('https://') || !config.API_URL.startsWith('https://'))
      throw new Error('Production requires HTTPS URLs');
    if (!config.METRICS_TOKEN || config.METRICS_TOKEN.length < 32)
      throw new Error('Production requires METRICS_TOKEN with 32+ characters');
    if (config.REQUIRE_EMAIL_VERIFICATION && !config.SMTP_URL)
      throw new Error('Email verification requires SMTP_URL in production');
    if (!config.REQUIRE_ADMIN_MFA) throw new Error('Production requires REQUIRE_ADMIN_MFA=true');
    if (config.CORS_ORIGINS.split(',').some((v) => !v.trim().startsWith('https://')))
      throw new Error('Production origins must use HTTPS');
    if (/change|example|development/i.test(config.JWT_SECRET))
      throw new Error('Replace example secrets');
    if (/^(.)\1+$/.test(config.ENCRYPTION_KEY))
      throw new Error('Replace low-entropy encryption key');
  }
  return config;
}
