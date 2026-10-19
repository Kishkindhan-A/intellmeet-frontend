import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import request from 'supertest';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { io as connectSocket, type Socket } from 'socket.io-client';
import pino from 'pino';
import { generate } from 'otplib';
import { createApp } from '../src/app.js';
import { readConfig } from '../src/config.js';
import {
  connectDatabase,
  ensureIndexes,
  mongoose,
  Membership,
  Meeting,
  Participant,
  Asset,
  JobRecord,
  Transcript,
  Summary,
  Session,
  Task,
  User,
  OneTimeToken,
  SupportTicket,
} from '../src/db.js';
import { hash, HttpError } from '../src/lib.js';
import { SignJWT } from 'jose';
import { processJob, housekeeping } from '../src/jobs.js';
import { attachRealtime } from '../src/realtime.js';
import { finishRecording } from '../src/webhooks.js';
import type { Runtime, SummaryResult } from '../src/ports.js';

let mongo: MongoMemoryReplSet;
const mails: { to: string; subject: string; text: string; html?: string }[] = [];
const objects = new Map<string, { data: Buffer; type: string }>();
const queued: string[] = [];
const events: { event: string; payload: unknown }[] = [];
const locks = new Set<string>();
let summaryResult: SummaryResult | undefined;
let onTranscribe: (() => Promise<void>) | undefined;
let recordingCalls = 0;
const config = readConfig({
  NODE_ENV: 'test',
  REQUIRE_EMAIL_VERIFICATION: 'true',
  JWT_SECRET: 'test-secret-'.repeat(5),
  ENCRYPTION_KEY: 'a'.repeat(64),
  LOG_LEVEL: 'silent',
  METRICS_TOKEN: 'metrics-test-token',
  LIVEKIT_URL: 'wss://media.example.test',
});
const rt: Runtime = {
  config,
  logger: pino({ level: 'silent' }),
  mail: {
    async send(to, subject, text, _purpose, html) {
      mails.push({ to, subject, text, html });
    },
  },
  storage: {
    async uploadUrl(key) {
      return `https://storage.example.test/${key}`;
    },
    async downloadUrl(key) {
      return `https://storage.example.test/${key}?signed=true`;
    },
    async inspect(key) {
      const value = objects.get(key);
      if (!value) throw new Error('Missing object');
      return {
        size: value.data.length,
        contentType: value.type,
        prefix: value.data.subarray(0, 512),
        etag: 'etag',
      };
    },
    async seal(key, dest) {
      objects.set(dest, objects.get(key)!);
    },
    async read(key) {
      return objects.get(key)!.data;
    },
    async delete(key) {
      objects.delete(key);
    },
  },
  media: {
    configured: true,
    async issue(room, user) {
      return `media:${room}:${user}`;
    },
    async remove() {},
    async close() {},
    async publish() {},
    async startRecording() {
      recordingCalls++;
      return `egress-${recordingCalls}`;
    },
    async stopRecording() {},
    async recordings() {
      return [];
    },
    async verifyWebhook(raw, auth) {
      if (auth !== 'signed-test-webhook') throw new Error('Bad signature');
      return JSON.parse(raw);
    },
  },
  ai: {
    configured: true,
    async transcribe() {
      await onTranscribe?.();
      return 'Alice will prepare the launch plan.';
    },
    async summarize(segments, people) {
      return (
        summaryResult ?? {
          overview: 'The team agreed on a launch plan.',
          decisions: ['Prepare a launch plan'],
          actions: [
            {
              title: 'Prepare launch plan',
              assigneeId: people[0]!.id,
              dueDate: null,
              evidence: [segments[0]!.id],
            },
          ],
        }
      );
    },
  },
  coordinator: {
    async consume() {
      return true;
    },
    async lock(key, action) {
      if (locks.has(key)) throw new HttpError(409, 'BUSY', 'Busy');
      locks.add(key);
      try {
        return await action();
      } finally {
        locks.delete(key);
      }
    },
    async enqueue(id) {
      queued.push(id);
    },
    async healthy() {
      return true;
    },
  },
  events: {
    emit(_room, event, payload) {
      events.push({ event, payload });
    },
    async revokeUser() {},
    async revokeWorkspace() {},
    async revokeMeeting() {},
  },
};
const app = createApp(rt);
type Actor = { id: string; access: string; csrf: string; cookies: string[]; email: string };
let alice: Actor;
let bob: Actor;
let outsider: Actor;
let workspaceId: string;
let meetingId: string;
const auth = (actor: Actor) => ({ Authorization: `Bearer ${actor.access}` });
async function signup(name: string): Promise<Actor> {
  const email = `${name.toLowerCase()}@example.test`;
  await request(app)
    .post('/api/auth/register')
    .send({ name, email, password: 'correct horse battery staple' })
    .expect(202);
  const raw = mails
    .findLast((m) => m.to === email && m.subject.includes('Verify'))!
    .text.match(/#token=([^\s]+)/)![1];
  await request(app).post('/api/auth/verify-email').send({ token: raw }).expect(200);
  const result = await request(app)
    .post('/api/auth/login')
    .send({ email, password: 'correct horse battery staple' })
    .expect(200);
  return {
    id: result.body.user.id,
    access: result.body.accessToken,
    csrf: result.body.csrfToken,
    cookies: result.headers['set-cookie'] as unknown as string[],
    email,
  };
}
async function liveMeeting(title = 'Team sync', mode = 'standard') {
  const created = await request(app)
    .post(`/api/workspaces/${workspaceId}/meetings`)
    .set(auth(alice))
    .send({ title, startsAt: new Date().toISOString(), processingMode: mode })
    .expect(201);
  const id = created.body.meeting._id;
  await request(app).post(`/api/meetings/${id}/start`).set(auth(alice)).expect(200);
  await request(app)
    .post(`/api/meetings/${id}/join`)
    .set(auth(alice))
    .send({ aiConsent: true, recordingConsent: true })
    .expect(200);
  return id as string;
}
async function audio(meeting = meetingId) {
  const data = Buffer.from('RIFF1234WAVE-audio-sample');
  const result = await request(app)
    .post(`/api/meetings/${meeting}/audio-uploads`)
    .set(auth(alice))
    .send({ contentType: 'audio/wav', size: data.length, startSeconds: 0, durationSeconds: 10 })
    .expect(201);
  const asset = await Asset.findById(result.body.assetId);
  objects.set(asset!.key, { data, type: 'audio/wav' });
  return { assetId: asset!._id, pendingKey: asset!.key };
}
beforeAll(async () => {
  mongo = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
    binary: { version: '8.2.6' },
  });
  await connectDatabase(mongo.getUri());
  await ensureIndexes();
  alice = await signup('Alice');
  bob = await signup('Bob');
  outsider = await signup('Outsider');
  const created = await request(app)
    .post('/api/workspaces')
    .set(auth(alice))
    .send({ name: 'Engineering' })
    .expect(201);
  workspaceId = created.body.workspace._id;
});
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});

describe('local login without email verification', () => {
  it('registers and authenticates without sending mail or falsely marking the address verified', async () => {
    const local = createApp({ ...rt, config: { ...config, REQUIRE_EMAIL_VERIFICATION: false } });
    const address = 'no-verification@example.test';
    const before = mails.length;
    const policy = await request(local).get('/api/auth/config').expect(200);
    expect(policy.body).toEqual({ emailVerificationRequired: false });
    await request(local)
      .post('/api/auth/register')
      .send({ email: address, name: 'Local User', password: 'correct horse battery staple' })
      .expect(202);
    expect(mails).toHaveLength(before);
    const user = await User.findOne({ email: address });
    expect(user!.verified).toBe(false);
    expect(await OneTimeToken.countDocuments({ userId: user!._id })).toBe(0);
    const login = await request(local)
      .post('/api/auth/login')
      .send({ email: address, password: 'correct horse battery staple' })
      .expect(200);
    expect(login.body.user.verified).toBe(false);
    await request(local)
      .get('/api/workspaces')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(200);
    await request(local)
      .post('/api/auth/login')
      .send({ email: address, password: 'incorrect password' })
      .expect(401);
    await request(local).post('/api/auth/resend-verification').send({ email: address }).expect(202);
    expect(mails).toHaveLength(before);
    await request(local)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(204);
    await request(local)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(401);
  });
  it('allows password sign-in configuration in production without SMTP', () => {
    const production = readConfig({
      NODE_ENV: 'production',
      REQUIRE_EMAIL_VERIFICATION: 'false',
      JWT_SECRET: 'production-secret-'.repeat(4),
      ENCRYPTION_KEY: '0123456789abcdef'.repeat(4),
      APP_URL: 'https://meet.example.test',
      API_URL: 'https://meet.example.test',
      CORS_ORIGINS: 'https://meet.example.test',
      METRICS_TOKEN: 'metrics-secret-'.repeat(4),
      REQUIRE_ADMIN_MFA: 'true',
    });
    expect(production.REQUIRE_EMAIL_VERIFICATION).toBe(false);
    expect(production.SMTP_URL).toBeUndefined();
  });
});

describe('email OTP verification', () => {
  const pending = async (name: string) => {
    const email = `${name.toLowerCase()}@example.test`;
    await request(app)
      .post('/api/auth/register')
      .send({ email, name, password: 'correct horse battery staple' })
      .expect(202);
    const code = mails
      .findLast((mail) => mail.to === email)!
      .text.match(/verification code: (\d{6})/)![1]!;
    const user = await User.findOne({ email });
    return { email, code, user: user! };
  };
  it('stores a keyed digest and verifies only the code owner, then consumes code and fallback links', async () => {
    const first = await pending('OtpFirst');
    const second = await pending('OtpSecond');
    const stored = await OneTimeToken.findOne({ userId: first.user._id, kind: 'verify-otp' });
    expect(stored!.hash).not.toBe(hash(first.code));
    expect(stored!.hash).toHaveLength(64);
    expect(stored!.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000);
    const wrong = first.code === '000000' ? '000001' : '000000';
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: first.email, code: wrong })
      .expect(400);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: 'unknown-otp@example.test', code: first.code })
      .expect(400);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: first.email, code: first.code })
      .expect(200);
    expect((await User.findById(first.user._id))!.verified).toBe(true);
    expect((await User.findById(second.user._id))!.verified).toBe(false);
    expect(
      await OneTimeToken.countDocuments({
        userId: first.user._id,
        kind: { $in: ['verify', 'verify-otp'] },
      }),
    ).toBe(0);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: first.email, code: first.code })
      .expect(400);
  });
  it('exhausts a challenge after five wrong attempts and replaces it on resend', async () => {
    const actor = await pending('OtpAttempts');
    const wrong = actor.code === '000000' ? '000001' : '000000';
    for (let attempt = 0; attempt < 5; attempt++)
      await request(app)
        .post('/api/auth/verify-email-otp')
        .send({ email: actor.email, code: wrong })
        .expect(400);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: actor.email, code: actor.code })
      .expect(400);
    await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: actor.email })
      .expect(202);
    const next = mails
      .findLast((mail) => mail.to === actor.email)!
      .text.match(/verification code: (\d{6})/)![1];
    expect(next).not.toBe(actor.code);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: actor.email, code: actor.code })
      .expect(400);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: actor.email, code: next })
      .expect(200);
  });
  it('rejects expired and malformed codes and keeps unverified users blocked', async () => {
    const actor = await pending('OtpExpired');
    await OneTimeToken.updateMany(
      { userId: actor.user._id, kind: 'verify-otp' },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: actor.email, code: actor.code })
      .expect(400);
    await request(app)
      .post('/api/auth/verify-email-otp')
      .send({ email: actor.email, code: '123' })
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple' })
      .expect(403);
  });
});

describe('automatic email verification', () => {
  const register = async (name: string) => {
    const email = `${name.toLowerCase()}@example.test`;
    const result = await request(app)
      .post('/api/auth/register')
      .send({ name, email, password: 'correct horse battery staple' })
      .expect(202);
    const user = await User.findOne({ email });
    const mail = mails.findLast((message) => message.to === email)!;
    const token = mail.text.match(/#token=([^\s]+)/)![1]!;
    expect(JSON.stringify(result.body)).not.toContain(token);
    return { user: user!, mail, token, email };
  };
  it('sends distinct HTML links to the two supplied addresses and verifies only the token owner', async () => {
    const first = await register('VerifyFirst');
    const second = await register('VerifySecond');
    expect(first.token).not.toBe(second.token);
    expect(first.token).toHaveLength(43);
    expect(first.user.verified).toBe(false);
    expect(second.user.verified).toBe(false);
    expect(first.mail.html).toContain('Verify Email Address');
    expect(first.mail.to).toBe(first.email);
    const stored = await OneTimeToken.findOne({ userId: first.user._id, kind: 'verify' });
    expect(stored!.hash).toBe(hash(first.token));
    expect(JSON.stringify(stored)).not.toContain(first.token);
    await request(app)
      .post('/api/auth/verify-email')
      .send({ token: first.token, userId: second.user._id })
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .send({ email: first.email, password: 'correct horse battery staple' })
      .expect(403);
    await request(app).post('/api/auth/verify-email').send({ token: first.token }).expect(200);
    expect((await User.findById(first.user._id))!.verified).toBe(true);
    expect((await User.findById(second.user._id))!.verified).toBe(false);
    await request(app).post('/api/auth/verify-email').send({ token: first.token }).expect(400);
    await request(app)
      .post('/api/auth/login')
      .send({ email: first.email, password: 'correct horse battery staple' })
      .expect(200);
  });
  it('replaces earlier links on successful resend and does not send to verified or unknown accounts', async () => {
    const actor = await register('VerifyResend');
    const response = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: actor.email })
      .expect(202);
    const replacement = mails
      .findLast((message) => message.to === actor.email)!
      .text.match(/#token=([^\s]+)/)![1]!;
    expect(replacement).not.toBe(actor.token);
    expect(await OneTimeToken.countDocuments({ userId: actor.user._id, kind: 'verify' })).toBe(1);
    await request(app).post('/api/auth/verify-email').send({ token: actor.token }).expect(400);
    await request(app).post('/api/auth/verify-email').send({ token: replacement }).expect(200);
    const before = mails.length;
    const verified = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: actor.email })
      .expect(202);
    const unknown = await request(app)
      .post('/api/auth/resend-verification')
      .send({ email: 'verification-unknown@example.test' })
      .expect(202);
    expect(verified.body).toEqual(response.body);
    expect(unknown.body).toEqual(response.body);
    expect(mails).toHaveLength(before);
  });
  it('preserves the old verification link if a resend fails and allows a retry', async () => {
    const actor = await register('VerifyDeliveryFailure');
    const failure = vi
      .spyOn(rt.mail, 'send')
      .mockRejectedValueOnce(new Error('private SMTP error'));
    try {
      await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: actor.email })
        .expect(503);
    } finally {
      failure.mockRestore();
    }
    expect(await OneTimeToken.countDocuments({ userId: actor.user._id, kind: 'verify' })).toBe(1);
    await request(app).post('/api/auth/verify-email').send({ token: actor.token }).expect(200);
  });
  it('applies the verification delivery quota without invalidating an earlier valid link', async () => {
    const actor = await register('VerifyQuota');
    const consume = vi.spyOn(rt.coordinator, 'consume');
    const before = mails.length;
    try {
      consume.mockImplementation(async (key) => !key.startsWith('email:verify:'));
      await request(app)
        .post('/api/auth/resend-verification')
        .send({ email: actor.email })
        .expect(202);
      expect(mails).toHaveLength(before);
    } finally {
      consume.mockRestore();
    }
    await request(app).post('/api/auth/verify-email').send({ token: actor.token }).expect(200);
  });
  it('serializes verification against a resend that is still delivering', async () => {
    const actor = await register('VerifyRace');
    let release!: () => void;
    let started!: () => void;
    const delivery = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    const send = vi
      .spyOn(rt.mail, 'send')
      .mockImplementationOnce(async (to, subject, text, _purpose, html) => {
        mails.push({ to, subject, text, html });
        started();
        await delivery;
      });
    const resend = request(app)
      .post('/api/auth/resend-verification')
      .send({ email: actor.email })
      .then((result) => result);
    try {
      await waiting;
      await request(app).post('/api/auth/verify-email').send({ token: actor.token }).expect(409);
    } finally {
      release();
      send.mockRestore();
    }
    expect((await resend).status).toBe(202);
    await request(app).post('/api/auth/verify-email').send({ token: actor.token }).expect(400);
    const replacement = mails
      .findLast((mail) => mail.to === actor.email)!
      .text.match(/#token=([^\s]+)/)![1];
    await request(app).post('/api/auth/verify-email').send({ token: replacement }).expect(200);
  });
});

describe('complete authentication integration', () => {
  it('normalizes email and handles concurrent duplicate registration without changing the account', async () => {
    const email = 'auth-duplicate@example.test';
    const results = await Promise.all(
      [email, '  AUTH-DUPLICATE@example.test  '].map((value) =>
        request(app)
          .post('/api/auth/register')
          .send({ name: 'Original', email: value, password: 'correct horse battery staple' }),
      ),
    );
    expect(results.map((result) => result.status)).toEqual([202, 202]);
    expect(results[0]!.body).toEqual(results[1]!.body);
    expect(await User.countDocuments({ email })).toBe(1);
    const user = await User.findOne({ email });
    expect(user!.passwordHash).toMatch(/^\$argon2id\$/);
    expect(mails.filter((mail) => mail.to === email)).toHaveLength(1);
    await request(app)
      .post('/api/auth/register')
      .send({ name: 'Replacement', email, password: 'a different password altogether' })
      .expect(202);
    expect((await User.findOne({ email }))!.name).toBe('Original');
  });
  it('returns the same credential error for incorrect passwords and unknown accounts', async () => {
    const actor = await signup('AuthWrong');
    const known = await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'incorrect password' })
      .expect(401);
    const unknown = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown-auth@example.test', password: 'incorrect password' })
      .expect(401);
    expect(known.body.error).toEqual(unknown.body.error);
    expect(known.headers['set-cookie']).toBeUndefined();
  });
  it('requires CSRF for logout and invalidates access and refresh credentials', async () => {
    const actor = await signup('AuthLogout');
    await request(app).post('/api/auth/logout').set('Cookie', actor.cookies).send({}).expect(403);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(200);
    const logout = await request(app)
      .post('/api/auth/logout')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .send({})
      .expect(204);
    expect(
      (logout.headers['set-cookie'] as unknown as string[]).every((cookie) =>
        cookie.includes('Expires=Thu, 01 Jan 1970'),
      ),
    ).toBe(true);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .expect(401);
    await request(app).get('/api/workspaces').expect(401);
  });
  it('rejects expired verification/reset links and invalid reset tokens without changing a password', async () => {
    const actor = await signup('AuthExpiredLinks');
    for (const kind of ['verify', 'reset'] as const) {
      const token = `expired-${kind}-${randomUUID()}`;
      await OneTimeToken.create({
        userId: actor.id,
        kind,
        hash: hash(token),
        expiresAt: new Date(Date.now() - 1000),
      });
      await request(app)
        .post(`/api/auth/${kind === 'verify' ? 'verify-email' : 'reset-password'}`)
        .send({
          token,
          ...(kind === 'reset' ? { password: 'a changed password with length' } : {}),
        })
        .expect(400);
    }
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: 'invalid-token', password: 'a changed password with length' })
      .expect(400);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(200);
  });
  it('rejects JWT expiry and absolute session expiry even before TTL cleanup', async () => {
    const actor = await signup('AuthAbsoluteExpiry');
    const session = await Session.findOne({ userId: actor.id });
    const expired = await new SignJWT({ sid: session!._id })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(actor.id)
      .setIssuer(config.JWT_ISSUER)
      .setAudience(config.JWT_AUDIENCE)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 10)
      .sign(new TextEncoder().encode(config.JWT_SECRET));
    const rejected = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${expired}`)
      .expect(401);
    expect(rejected.body.error.code).toBe('SESSION_EXPIRED');
    await Session.updateOne(
      { _id: session!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .expect(401);
  });
  it('updates only permitted profile fields and isolates session revocation', async () => {
    const actor = await signup('AuthProfile');
    await request(app)
      .patch('/api/auth/me')
      .set(auth(actor))
      .send({ name: 'New name', verified: true })
      .expect(400);
    const result = await request(app)
      .patch('/api/auth/me')
      .set(auth(actor))
      .send({ name: '  New name  ' })
      .expect(200);
    expect(result.body.user.name).toBe('New name');
    const sessions = await request(app).get('/api/auth/sessions').set(auth(actor)).expect(200);
    expect(sessions.body.sessions).toHaveLength(1);
    expect(sessions.body.currentSessionId).toBe(sessions.body.sessions[0]._id);
    expect(JSON.stringify(sessions.body)).not.toMatch(/refreshHash|csrfHash|csrfCipher/);
    await request(app)
      .delete(`/api/auth/sessions/${sessions.body.currentSessionId}`)
      .set(auth(outsider))
      .expect(204);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(200);
    await request(app)
      .delete(`/api/auth/sessions/${sessions.body.currentSessionId}`)
      .set(auth(actor))
      .expect(204);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
  });
  it('reauthenticates password changes and revokes all existing sessions', async () => {
    const actor = await signup('AuthChange');
    await request(app)
      .post('/api/auth/change-password')
      .set(auth(actor))
      .send({ currentPassword: 'wrong', password: 'new correct horse battery staple' })
      .expect(401);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(200);
    await request(app)
      .post('/api/auth/change-password')
      .set(auth(actor))
      .send({
        currentPassword: 'correct horse battery staple',
        password: 'new correct horse battery staple',
      })
      .expect(200);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple' })
      .expect(401);
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'new correct horse battery staple' })
      .expect(200);
  });
  it('fails closed when login quota is exhausted and limits reset email sends', async () => {
    const actor = await signup('AuthQuota');
    const consume = vi.spyOn(rt.coordinator, 'consume');
    try {
      consume.mockImplementation(async (key) => !key.startsWith('login:'));
      await request(app)
        .post('/api/auth/login')
        .send({ email: actor.email, password: 'correct horse battery staple' })
        .expect(429);
      const before = mails.length;
      consume.mockImplementation(async (key) => !key.startsWith('email:reset:'));
      await request(app).post('/api/auth/forgot-password').send({ email: actor.email }).expect(202);
      expect(mails).toHaveLength(before);
    } finally {
      consume.mockRestore();
    }
  });
  it('reports email failure safely and removes undelivered one-time tokens', async () => {
    const actor = await signup('AuthMailFailure');
    const failure = vi
      .spyOn(rt.mail, 'send')
      .mockRejectedValueOnce(new Error('private provider failure'));
    try {
      const result = await request(app)
        .post('/api/auth/forgot-password')
        .send({ email: actor.email })
        .expect(503);
      expect(result.body.error.code).toBe('MAIL_UNAVAILABLE');
      expect(JSON.stringify(result.body)).not.toContain('private provider failure');
      expect(await OneTimeToken.countDocuments({ userId: actor.id, kind: 'reset' })).toBe(0);
    } finally {
      failure.mockRestore();
    }
  });
  it('sets HttpOnly, SameSite and production Secure cookies without using browser storage', async () => {
    const production = createApp({ ...rt, config: { ...config, NODE_ENV: 'production' } });
    const result = await request(production)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'correct horse battery staple' })
      .expect(200);
    for (const cookie of result.headers['set-cookie'] as unknown as string[]) {
      expect(cookie).toContain('HttpOnly');
      expect(cookie).toContain('Secure');
      expect(cookie).toContain('SameSite=Lax');
    }
    expect(result.headers['cache-control']).toBe('no-store');
  });
});

describe('identity and workspace boundaries', () => {
  it('never returns password, MFA secrets or refresh hashes', async () => {
    const me = await request(app).get('/api/auth/me').set(auth(alice)).expect(200);
    expect(Object.keys(me.body.user).sort()).toEqual([
      'email',
      'id',
      'mfaEnabled',
      'name',
      'verified',
    ]);
  });
  it('requires verified email and rejects unknown JSON properties', async () => {
    await request(app)
      .post('/api/auth/register')
      .send({
        name: 'Pending',
        email: 'pending@example.test',
        password: 'correct horse battery staple',
      })
      .expect(202);
    await request(app)
      .post('/api/auth/login')
      .send({ email: 'pending@example.test', password: 'correct horse battery staple' })
      .expect(403);
    await request(app)
      .post('/api/workspaces')
      .set(auth(alice))
      .send({ name: 'Bad', ownerId: bob.id })
      .expect(400);
  });
  it('hides workspaces from outsiders', async () => {
    await request(app).get(`/api/workspaces/${workspaceId}`).set(auth(outsider)).expect(404);
    await request(app).get(`/api/workspaces/${workspaceId}/tasks`).set(auth(outsider)).expect(404);
  });
  it('invites by verified email, rejects wrong recipient and consumes once', async () => {
    await request(app)
      .post(`/api/workspaces/${workspaceId}/invitations`)
      .set(auth(alice))
      .send({ email: bob.email })
      .expect(201);
    const raw = mails.findLast((m) => m.to === bob.email)!.text.match(/#token=([^\s]+)/)![1];
    await request(app)
      .post('/api/invitations/accept')
      .set(auth(outsider))
      .send({ token: raw })
      .expect(400);
    await request(app)
      .post('/api/invitations/accept')
      .set(auth(bob))
      .send({ token: raw })
      .expect(200);
    await request(app)
      .post('/api/invitations/accept')
      .set(auth(bob))
      .send({ token: raw })
      .expect(400);
  });
  it('prevents member escalation and owner deletion', async () => {
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/members/${bob.id}`)
      .set(auth(bob))
      .send({ role: 'admin' })
      .expect(403);
    await request(app)
      .delete(`/api/workspaces/${workspaceId}/members/${alice.id}`)
      .set(auth(alice))
      .expect(409);
  });
  it('requires CSRF for cookie mutations and denies unknown origins', async () => {
    await request(app)
      .post('/api/workspaces')
      .set('Cookie', alice.cookies)
      .send({ name: 'CSRF blocked' })
      .expect(403);
    await request(app)
      .post('/api/workspaces')
      .set('Cookie', alice.cookies)
      .set('X-CSRF-Token', alice.csrf)
      .send({ name: 'CSRF accepted' })
      .expect(201);
    await request(app)
      .get('/api/auth/me')
      .set(auth(alice))
      .set('Origin', 'https://evil.example')
      .expect(403);
  });
  it('rotates refresh tokens and revokes session on reuse', async () => {
    const actor = await signup('Refresh');
    const first = await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .expect(200);
    expect(first.body.accessToken).toBeTruthy();
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .expect(401);
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${first.body.accessToken}`)
      .expect(401);
  });
  it('resets password with a one-time email link and revokes sessions', async () => {
    const actor = await signup('Reset');
    await request(app).post('/api/auth/forgot-password').send({ email: actor.email }).expect(202);
    const raw = mails.findLast((m) => m.to === actor.email)!.text.match(/#token=([^\s]+)/)![1];
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: raw, password: 'another secure long password' })
      .expect(200);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token: raw, password: 'another secure long password' })
      .expect(400);
  });
  it('enrolls MFA, requires it at login and consumes recovery codes once', async () => {
    const actor = await signup('Mfa');
    const setup = await request(app)
      .post('/api/auth/mfa/setup')
      .set(auth(actor))
      .send({ password: 'correct horse battery staple' })
      .expect(200);
    const code = await generate({ secret: setup.body.secret });
    const confirmed = await request(app)
      .post('/api/auth/mfa/confirm')
      .set(auth(actor))
      .send({ code })
      .expect(200);
    expect(confirmed.body.recoveryCodes).toHaveLength(8);
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple' })
      .expect(401);
    const recovery = confirmed.body.recoveryCodes[0];
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple', code: recovery })
      .expect(200);
    await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple', code: recovery })
      .expect(401);
  });
});
describe('meeting and collaboration workflows', () => {
  it('lets an assigned host start their meeting while requiring MFA for administrator takeover', async () => {
    const secured = createApp({ ...rt, config: { ...config, REQUIRE_ADMIN_MFA: true } });
    const own = await request(app)
      .post(`/api/workspaces/${workspaceId}/meetings`)
      .set(auth(alice))
      .send({ title: 'Assigned host permissions', startsAt: new Date().toISOString() })
      .expect(201);
    await request(secured)
      .post(`/api/meetings/${own.body.meeting._id}/start`)
      .set(auth(alice))
      .expect(200);
    const delegated = await request(app)
      .post(`/api/workspaces/${workspaceId}/meetings`)
      .set(auth(bob))
      .send({ title: 'Other host permissions', startsAt: new Date().toISOString() })
      .expect(201);
    const denied = await request(secured)
      .post(`/api/meetings/${delegated.body.meeting._id}/start`)
      .set(auth(alice))
      .expect(403);
    expect(denied.body.error.code).toBe('MFA_REQUIRED');
    await request(secured)
      .post(`/api/meetings/${delegated.body.meeting._id}/start`)
      .set(auth(bob))
      .expect(200);
  });

  it('starts meeting and gates SFU tokens behind lobby admission', async () => {
    meetingId = await liveMeeting();
    await request(app)
      .post(`/api/meetings/${meetingId}/join`)
      .set(auth(bob))
      .send({ recordingConsent: false, aiConsent: false })
      .expect(200);
    await request(app).post(`/api/meetings/${meetingId}/media-token`).set(auth(bob)).expect(403);
    await request(app).get(`/api/meetings/${meetingId}/messages`).set(auth(bob)).expect(403);
    await request(app)
      .post(`/api/meetings/${meetingId}/participants/${bob.id}/admit`)
      .set(auth(alice))
      .expect(200);
    const media = await request(app)
      .post(`/api/meetings/${meetingId}/media-token`)
      .set(auth(bob))
      .expect(200);
    expect(media.body.expiresIn).toBe(60);
  });
  it('requires every admitted participant to consent before recording and AI', async () => {
    await request(app)
      .post(`/api/meetings/${meetingId}/recordings/start`)
      .set(auth(alice))
      .expect(409);
    expect(recordingCalls).toBe(0);
    await request(app)
      .post(`/api/meetings/${meetingId}/audio-uploads`)
      .set(auth(alice))
      .send({})
      .expect(409);
    await request(app)
      .patch(`/api/meetings/${meetingId}/consent`)
      .set(auth(bob))
      .send({ recordingConsent: true, aiConsent: true })
      .expect(200);
  });
  it('stores retry-safe chat and protects notes from lost edits', async () => {
    const payload = { clientId: randomUUID(), text: 'Hello team', mentions: [bob.id] };
    const first = await request(app)
      .post(`/api/meetings/${meetingId}/messages`)
      .set(auth(alice))
      .send(payload)
      .expect(201);
    const retry = await request(app)
      .post(`/api/meetings/${meetingId}/messages`)
      .set(auth(alice))
      .send(payload)
      .expect(201);
    expect(first.body.message._id).toBe(retry.body.message._id);
    await request(app)
      .put(`/api/meetings/${meetingId}/notes`)
      .set(auth(alice))
      .send({ text: 'First revision', revision: 0 })
      .expect(200);
    await request(app)
      .put(`/api/meetings/${meetingId}/notes`)
      .set(auth(bob))
      .send({ text: 'Stale overwrite', revision: 0 })
      .expect(409);
    const notes = await request(app)
      .get(`/api/meetings/${meetingId}/notes`)
      .set(auth(bob))
      .expect(200);
    expect(notes.body.note.text).toBe('First revision');
  });
  it('creates and version-controls Kanban tasks with member-scoped assignments', async () => {
    const created = await request(app)
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .set(auth(alice))
      .send({ title: 'Ship API', assigneeId: bob.id })
      .expect(201);
    const id = created.body.task._id;
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/tasks/${id}`)
      .set(auth(bob))
      .send({ status: 'done', version: 0 })
      .expect(200);
    await request(app)
      .patch(`/api/workspaces/${workspaceId}/tasks/${id}`)
      .set(auth(alice))
      .send({ title: 'Stale', version: 0 })
      .expect(409);
    await request(app)
      .post(`/api/workspaces/${workspaceId}/tasks`)
      .set(auth(alice))
      .send({ title: 'Leak', assigneeId: outsider.id })
      .expect(400);
  });
  it('denies cross-workspace meeting content, upload and export access', async () => {
    for (const endpoint of ['messages', 'notes', 'assets', 'transcript', 'summary', 'export'])
      await request(app)
        .get(`/api/meetings/${meetingId}/${endpoint}`)
        .set(auth(outsider))
        .expect(404);
    await request(app)
      .post(`/api/meetings/${meetingId}/join`)
      .set(auth(outsider))
      .send({})
      .expect(404);
  });
  it('hides invitation-only meetings from uninvited workspace members', async () => {
    const result = await request(app)
      .post(`/api/workspaces/${workspaceId}/meetings`)
      .set(auth(alice))
      .send({ title: 'Private', startsAt: new Date().toISOString(), visibility: 'invite' })
      .expect(201);
    await request(app).get(`/api/meetings/${result.body.meeting._id}`).set(auth(bob)).expect(404);
    const list = await request(app)
      .get(`/api/workspaces/${workspaceId}/meetings`)
      .set(auth(bob))
      .expect(200);
    expect(list.body.meetings.some((m: { _id: string }) => m._id === result.body.meeting._id)).toBe(
      false,
    );
  });
  it('disables server recording and AI for confidential meetings', async () => {
    const id = await liveMeeting('Confidential', 'confidential');
    await request(app).post(`/api/meetings/${id}/recordings/start`).set(auth(alice)).expect(403);
    await request(app)
      .post(`/api/meetings/${id}/audio-uploads`)
      .set(auth(alice))
      .send({})
      .expect(403);
  });
});
describe('audio, AI, recording, retention and provider boundaries', () => {
  it('validates file magic, seals uploads and deduplicates transcription', async () => {
    const a = await audio();
    const original = objects.get(a.pendingKey)!;
    objects.set(a.pendingKey, { ...original, data: Buffer.alloc(original.data.length) });
    await request(app).post(`/api/assets/${a.assetId}/complete`).set(auth(alice)).expect(400);
    objects.set(a.pendingKey, original);
    const result = await request(app)
      .post(`/api/assets/${a.assetId}/complete`)
      .set(auth(alice))
      .expect(202);
    const retry = await request(app)
      .post(`/api/assets/${a.assetId}/complete`)
      .set(auth(alice))
      .expect(202);
    expect(result.body.job._id).toBe(retry.body.job._id);
    expect(objects.has(a.pendingKey)).toBe(false);
    await processJob(rt, result.body.job._id);
    await processJob(rt, result.body.job._id);
    expect(await Transcript.countDocuments({ assetId: a.assetId })).toBe(1);
    await request(app).get(`/api/assets/${a.assetId}/download`).set(auth(outsider)).expect(404);
    const url = await request(app)
      .get(`/api/assets/${a.assetId}/download`)
      .set(auth(alice))
      .expect(200);
    expect(url.body.expiresIn).toBe(60);
  });
  it('does not persist AI results if consent is withdrawn while provider runs', async () => {
    const id = await liveMeeting('Privacy race');
    const a = await audio(id);
    const result = await request(app)
      .post(`/api/assets/${a.assetId}/complete`)
      .set(auth(alice))
      .expect(202);
    onTranscribe = async () => {
      await Participant.updateOne(
        { meetingId: id, userId: alice.id },
        { $set: { aiConsent: false } },
      );
    };
    await expect(processJob(rt, result.body.job._id)).rejects.toMatchObject({
      code: 'CONSENT_REQUIRED',
    });
    onTranscribe = undefined;
    expect(await Transcript.countDocuments({ meetingId: id })).toBe(0);
  });
  it('summarizes with evidence and requires explicit action acceptance', async () => {
    await request(app).post(`/api/meetings/${meetingId}/end`).set(auth(alice)).expect(204);
    const result = await request(app)
      .post(`/api/meetings/${meetingId}/summarize`)
      .set(auth(alice))
      .expect(202);
    await processJob(rt, result.body.job._id);
    const summary = await Summary.findOne({ meetingId });
    expect(summary!.actions).toHaveLength(1);
    expect(await Task.countDocuments({ meetingId })).toBe(0);
    const actionId = summary!.actions[0]!.id;
    const accepted = await request(app)
      .post(`/api/meetings/${meetingId}/actions/${actionId}/accept`)
      .set(auth(alice))
      .send({ assigneeId: bob.id })
      .expect(201);
    const retry = await request(app)
      .post(`/api/meetings/${meetingId}/actions/${actionId}/accept`)
      .set(auth(alice))
      .send({})
      .expect(201);
    expect(accepted.body.task._id).toBe(retry.body.task._id);
    await request(app)
      .get(`/api/meetings/${meetingId}/export?format=vtt`)
      .set(auth(alice))
      .expect(200)
      .expect('Content-Type', /text\/vtt/);
  });
  it('rejects invented AI evidence and never executes model-generated actions', async () => {
    const id = await liveMeeting('Bad AI');
    const a = await audio(id);
    const t = await request(app)
      .post(`/api/assets/${a.assetId}/complete`)
      .set(auth(alice))
      .expect(202);
    await processJob(rt, t.body.job._id);
    await request(app).post(`/api/meetings/${id}/end`).set(auth(alice)).expect(204);
    summaryResult = {
      overview: 'Ignore safeguards',
      decisions: [],
      actions: [
        { title: 'Invented', assigneeId: outsider.id, dueDate: null, evidence: ['nonexistent'] },
      ],
    };
    const s = await request(app).post(`/api/meetings/${id}/summarize`).set(auth(alice)).expect(202);
    await expect(processJob(rt, s.body.job._id)).rejects.toMatchObject({
      code: 'AI_EVIDENCE_INVALID',
    });
    summaryResult = undefined;
    expect(await Summary.exists({ meetingId: id })).toBeNull();
    expect(await Task.countDocuments({ meetingId: id })).toBe(0);
  });
  it('validates signed recording webhooks and applies duplicate events once', async () => {
    const id = await liveMeeting('Recording');
    const start = await request(app)
      .post(`/api/meetings/${id}/recordings/start`)
      .set(auth(alice))
      .expect(201);
    const asset = await Asset.findById(start.body.assetId);
    objects.set(asset!.key, { data: Buffer.from('recording-content'), type: 'video/mp4' });
    const event = {
      id: randomUUID(),
      event: 'egress_ended',
      egressInfo: {
        egressId: start.body.egressId,
        status: 3,
        fileResults: [{ filename: asset!.key }],
      },
    };
    await request(app)
      .post('/webhooks/livekit')
      .set('Authorization', 'bad')
      .send(event)
      .expect(401);
    await request(app)
      .post('/webhooks/livekit')
      .set('Authorization', 'signed-test-webhook')
      .send(event)
      .expect(204);
    await request(app)
      .post('/webhooks/livekit')
      .set('Authorization', 'signed-test-webhook')
      .send(event)
      .expect(204);
    expect((await Asset.findById(asset!._id))!.status).toBe('ready');
    expect((await Meeting.findById(id))!.recordingState).toBe('idle');
  });
  it('purges meeting artifacts and stored media through a durable job', async () => {
    const result = await request(app)
      .delete(`/api/meetings/${meetingId}`)
      .set(auth(alice))
      .expect(202);
    await processJob(rt, result.body.job._id);
    expect(await Transcript.countDocuments({ meetingId })).toBe(0);
    expect(await Asset.countDocuments({ meetingId })).toBe(0);
    expect(await Task.countDocuments({ meetingId })).toBe(0);
    await request(app).get(`/api/meetings/${meetingId}`).set(auth(alice)).expect(404);
  });
  it('requires metrics credentials and exposes readiness and OpenAPI', async () => {
    await request(app).get('/health/ready').expect(200);
    await request(app).get('/metrics').expect(401);
    await request(app)
      .get('/metrics')
      .set('Authorization', 'Bearer metrics-test-token')
      .expect(200);
    const result = await request(app).get('/openapi.json').expect(200);
    expect(Object.keys(result.body.paths).length).toBeGreaterThan(50);
  });
});
describe('real socket transport', () => {
  it('authenticates subscriptions and rechecks authorization after membership removal', async () => {
    const server = createServer(app);
    const previousEvents = rt.events;
    const realtime = await attachRealtime(server, rt);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address() as { port: number };
    const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
      transports: ['websocket'],
      auth: { token: bob.access },
      reconnection: false,
    });
    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', resolve);
        socket.once('connect_error', reject);
      });
      const emit = (name: string, payload: unknown) =>
        new Promise<any>((resolve) => socket.emit(name, payload, resolve));
      expect((await emit('workspace.subscribe', { workspaceId })).ok).toBe(true);
      const scheduled = await request(app)
        .post(`/api/workspaces/${workspaceId}/meetings`)
        .set(auth(alice))
        .send({ title: 'Pre-subscription isolation', startsAt: new Date().toISOString() })
        .expect(201);
      expect(
        (await emit('meeting.subscribe', { meetingId: scheduled.body.meeting._id })).error.code,
      ).toBe('MEETING_STATE');
      expect((await emit('workspace.subscribe', { workspaceId: randomUUID() })).ok).toBe(false);
      await Membership.deleteOne({ workspaceId, userId: bob.id });
      expect((await emit('workspace.subscribe', { workspaceId })).ok).toBe(false);
      await Membership.create({ workspaceId, userId: bob.id, role: 'member' });
      const session = await Session.findOne({ userId: bob.id, revokedAt: null });
      await Session.updateOne({ _id: session!._id }, { $set: { revokedAt: new Date() } });
      expect((await emit('workspace.subscribe', { workspaceId })).error.code).toBe(
        'SESSION_EXPIRED',
      );
    } finally {
      socket.disconnect();
      await realtime.close();
      rt.events = previousEvents;
    }
  });
});
describe('additional security regression cases', () => {
  it('rejects Mongo operator injection, malformed JSON and oversized bodies', async () => {
    await request(app)
      .post('/api/auth/login')
      .send({ email: { $ne: null }, password: 'irrelevant' })
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .set('Content-Type', 'application/json')
      .send('{broken')
      .expect(400);
    await request(app)
      .post('/api/auth/login')
      .send({ email: alice.email, password: 'x'.repeat(160000) })
      .expect(413);
  });
  it('rejects a modified JWT signature and unauthenticated reads', async () => {
    const parts = alice.access.split('.');
    parts[2] = `${parts[2]!.startsWith('a') ? 'b' : 'a'}${parts[2]!.slice(1)}`;
    await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${parts.join('.')}`)
      .expect(401);
    await request(app).get('/api/workspaces').expect(401);
  });
  it('recovers CSRF after reload without granting access to another origin', async () => {
    const result = await request(app)
      .get('/api/auth/csrf')
      .set('Cookie', alice.cookies)
      .expect(200);
    expect(result.body.csrfToken).toBe(alice.csrf);
    await request(app)
      .get('/api/auth/csrf')
      .set('Cookie', alice.cookies)
      .set('Origin', 'https://evil.example')
      .expect(403);
    await request(app).get('/api/auth/csrf').expect(401);
  });
  it('requires password reauthentication for MFA enrollment', async () => {
    await request(app).post('/api/auth/mfa/setup').set(auth(alice)).send({}).expect(401);
  });
  it('enforces quotas before executing mutations', async () => {
    const original = rt.coordinator.consume;
    rt.coordinator.consume = async () => false;
    try {
      await request(app)
        .post('/api/workspaces')
        .set(auth(alice))
        .send({ name: 'Blocked by quota' })
        .expect(429);
    } finally {
      rt.coordinator.consume = original;
    }
  });
  it('blocks all live artifacts for a waiting participant and permanently denies removed participants', async () => {
    const actor = await signup('Waiting');
    await Membership.create({ workspaceId, userId: actor.id, role: 'member' });
    const id = await liveMeeting('Lobby security');
    await request(app).post(`/api/meetings/${id}/join`).set(auth(actor)).send({}).expect(200);
    for (const endpoint of ['messages', 'notes', 'assets', 'transcript', 'summary', 'export'])
      await request(app).get(`/api/meetings/${id}/${endpoint}`).set(auth(actor)).expect(403);
    await request(app)
      .post(`/api/meetings/${id}/participants/${actor.id}/remove`)
      .set(auth(alice))
      .expect(204);
    await request(app).post(`/api/meetings/${id}/join`).set(auth(actor)).send({}).expect(403);
    await request(app).post(`/api/meetings/${id}/media-token`).set(auth(actor)).expect(403);
  });
  it('keeps equal-timestamp chat messages reachable through ID cursors', async () => {
    const id = await liveMeeting('Cursor test');
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const r = await request(app)
        .post(`/api/meetings/${id}/messages`)
        .set(auth(alice))
        .send({ clientId: randomUUID(), text: `Message ${i}` })
        .expect(201);
      ids.push(r.body.message._id);
    }
    const { Message } = await import('../src/db.js');
    await Message.updateMany(
      { meetingId: id },
      { $set: { createdAt: new Date('2026-10-10T00:00:00Z') } },
      { timestamps: false, overwriteImmutable: true },
    );
    const first = await request(app)
      .get(`/api/meetings/${id}/messages?limit=1`)
      .set(auth(alice))
      .expect(200);
    const rest = await request(app)
      .get(`/api/meetings/${id}/messages?beforeId=${first.body.nextCursor}`)
      .set(auth(alice))
      .expect(200);
    expect(
      new Set([
        first.body.messages[0]._id,
        ...rest.body.messages.map((m: { _id: string }) => m._id),
      ]).size,
    ).toBe(3);
  });
  it('rejects unsafe production configuration', () => {
    expect(() =>
      readConfig({
        NODE_ENV: 'production',
        JWT_SECRET: 'a'.repeat(64),
        ENCRYPTION_KEY: 'b'.repeat(64),
      }),
    ).toThrow();
  });
  it('recovers upload completion after a crash between storage copy and database update', async () => {
    const id = await liveMeeting('Upload recovery');
    const a = await audio(id);
    const original = rt.storage.seal;
    rt.storage.seal = async (source, destination, etag) => {
      await original(source, destination, etag);
      throw new Error('Simulated process interruption');
    };
    try {
      await request(app).post(`/api/assets/${a.assetId}/complete`).set(auth(alice)).expect(500);
    } finally {
      rt.storage.seal = original;
    }
    expect(objects.has(a.pendingKey)).toBe(true);
    await request(app).post(`/api/assets/${a.assetId}/complete`).set(auth(alice)).expect(202);
    expect((await Asset.findById(a.assetId))!.status).toBe('ready');
    expect(objects.has(a.pendingKey)).toBe(false);
  });
  it('cannot bypass missing AI consent by removing a previously admitted participant', async () => {
    const actor = await signup('Consent');
    await Membership.create({ workspaceId, userId: actor.id, role: 'member' });
    const id = await liveMeeting('Consent retention');
    await request(app)
      .post(`/api/meetings/${id}/join`)
      .set(auth(actor))
      .send({ aiConsent: false })
      .expect(200);
    await request(app)
      .post(`/api/meetings/${id}/participants/${actor.id}/admit`)
      .set(auth(alice))
      .expect(200);
    await request(app)
      .post(`/api/meetings/${id}/participants/${actor.id}/remove`)
      .set(auth(alice))
      .expect(204);
    await request(app)
      .post(`/api/meetings/${id}/audio-uploads`)
      .set(auth(alice))
      .send({})
      .expect(409);
  });
});

describe('launch audit regressions', () => {
  it('distinguishes expired sessions from missing credentials', async () => {
    const actor = await signup('ExpiredAudit');
    await Session.updateMany({ userId: actor.id }, { $set: { revokedAt: new Date() } });
    const response = await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
  });
  it('does not disguise an authentication database outage as invalid credentials', async () => {
    const failure = vi
      .spyOn(Session, 'findOne')
      .mockRejectedValueOnce(new Error('Database offline'));
    try {
      await request(app).get('/api/auth/me').set(auth(alice)).expect(500);
    } finally {
      failure.mockRestore();
    }
  });
  it('rejects reuse of the authenticator code consumed by enrollment', async () => {
    const actor = await signup('EnrollAudit');
    const setup = await request(app)
      .post('/api/auth/mfa/setup')
      .set(auth(actor))
      .send({ password: 'correct horse battery staple' })
      .expect(200);
    const code = await generate({ secret: setup.body.secret });
    await request(app).post('/api/auth/mfa/confirm').set(auth(actor)).send({ code }).expect(200);
    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: actor.email, password: 'correct horse battery staple', code })
      .expect(401);
    expect(response.body.error.code).toBe('MFA_REUSED');
  });
  it('keeps completed recording idle when completion arrives during the stop call', async () => {
    const id = await liveMeeting('Stop race audit');
    const started = await request(app)
      .post(`/api/meetings/${id}/recordings/start`)
      .set(auth(alice))
      .expect(201);
    const asset = await Asset.findById(started.body.assetId);
    objects.set(asset!.key, { data: Buffer.from('recording-content'), type: 'video/mp4' });
    const stop = vi.spyOn(rt.media, 'stopRecording').mockImplementationOnce(async (egressId) => {
      await finishRecording(rt, egressId, 3, asset!.key);
    });
    try {
      await request(app).post(`/api/meetings/${id}/recordings/stop`).set(auth(alice)).expect(202);
      expect((await Meeting.findById(id))!.recordingState).toBe('idle');
    } finally {
      stop.mockRestore();
    }
  });
  it('lets a host retry meeting closure after a transient media failure', async () => {
    const id = await liveMeeting('End retry audit');
    const close = vi
      .spyOn(rt.media, 'close')
      .mockRejectedValueOnce(new Error('Temporary SFU failure'));
    try {
      await request(app).post(`/api/meetings/${id}/end`).set(auth(alice)).expect(500);
      await request(app).post(`/api/meetings/${id}/end`).set(auth(alice)).expect(204);
      expect(close).toHaveBeenCalledTimes(2);
    } finally {
      close.mockRestore();
    }
  });
  it('refuses deletion of the object currently being recorded', async () => {
    const id = await liveMeeting('Recording deletion audit');
    const started = await request(app)
      .post(`/api/meetings/${id}/recordings/start`)
      .set(auth(alice))
      .expect(201);
    await request(app).delete(`/api/assets/${started.body.assetId}`).set(auth(alice)).expect(409);
    expect((await Asset.findById(started.body.assetId))!.status).toBe('pending');
  });
});

describe('PDF lifecycle and launch requirements', () => {
  it('excludes API responses from search indexing and exposes readable help', async () => {
    const result = await request(app).get('/health/live').expect(200);
    expect(result.headers['x-robots-tag']).toBe('noindex, nofollow, noarchive');
    expect(result.headers['cache-control']).toBe('no-store');
    await request(app)
      .get('/robots.txt')
      .expect(200)
      .expect(/Allow: \//);
    const help = await request(app).get('/help').expect(200);
    expect(help.body.articles.length).toBeGreaterThan(0);
    await request(app).get('/.well-known/security.txt').expect(404);
  });
  it('serves configured, unexpired disclosure contacts without inventing one', async () => {
    const configured = createApp({
      ...rt,
      config: {
        ...config,
        SECURITY_CONTACT: 'mailto:security@example.test',
        SECURITY_CONTACT_EXPIRES: new Date(Date.now() + 86400000).toISOString(),
      },
    });
    await request(configured)
      .get('/.well-known/security.txt')
      .expect(200)
      .expect(/Contact: mailto:security@example.test/);
    expect(() =>
      readConfig({
        NODE_ENV: 'test',
        JWT_SECRET: config.JWT_SECRET,
        ENCRYPTION_KEY: config.ENCRYPTION_KEY,
        SECURITY_CONTACT: 'mailto:security@example.test\nContact: injected',
      }),
    ).toThrow();
  });
  it('returns maintenance and retry headers while keeping probes and signed callbacks reachable', async () => {
    const maintenance = createApp({ ...rt, config: { ...config, MAINTENANCE_MODE: true } });
    const result = await request(maintenance).get('/api/auth/me').expect(503);
    expect(result.body.error.code).toBe('MAINTENANCE');
    expect(result.headers['retry-after']).toBe('300');
    await request(maintenance).get('/health/live').expect(200);
    await request(maintenance).get('/health/ready').expect(503);
    await request(maintenance)
      .post('/webhooks/livekit')
      .set('Authorization', 'bad-signature')
      .send({})
      .expect(401);
  });
  it('keeps nonessential preferences off by default, validates settings and protects cookie mutations', async () => {
    const actor = await signup('SettingsAudit');
    const initial = await request(app).get('/api/account/preferences').set(auth(actor)).expect(200);
    expect(initial.body.preferences.analyticsConsent).toBe(false);
    expect(initial.body.preferences.marketingConsent).toBe(false);
    await request(app)
      .patch('/api/account/preferences')
      .set('Cookie', actor.cookies)
      .send({ analyticsConsent: true })
      .expect(403);
    await request(app)
      .patch('/api/account/preferences')
      .set(auth(actor))
      .send({ timezone: 'Invalid/Zone' })
      .expect(400);
    await request(app)
      .patch('/api/account/preferences')
      .set(auth(actor))
      .send({ securityVersion: 1 })
      .expect(400);
    const updated = await request(app)
      .patch('/api/account/preferences')
      .set(auth(actor))
      .send({ timezone: 'Asia/Kolkata', locale: 'en-IN', analyticsConsent: true })
      .expect(200);
    expect(updated.body.preferences.timezone).toBe('Asia/Kolkata');
    expect(updated.body.preferences.analyticsConsent).toBe(true);
    await request(app)
      .patch('/api/account/preferences')
      .set(auth(actor))
      .send({ analyticsConsent: false })
      .expect(200);
    await request(app)
      .post('/api/account/onboarding/complete')
      .set(auth(actor))
      .send({})
      .expect(409);
    await Membership.create({ workspaceId, userId: actor.id, role: 'member' });
    await request(app)
      .post('/api/account/onboarding/complete')
      .set(auth(actor))
      .send({})
      .expect(204);
    const completed = await request(app)
      .get('/api/account/onboarding')
      .set(auth(actor))
      .expect(200);
    expect(completed.body.completedAt).toBeTruthy();
  });
  it('isolates support requests and restricts workspace responses to administrators', async () => {
    const actor = await signup('SupportAudit');
    await Membership.create({ workspaceId, userId: actor.id, role: 'member' });
    const created = await request(app)
      .post('/api/account/support')
      .set(auth(actor))
      .send({ workspaceId, subject: 'Meeting admission', message: 'Please help me join.' })
      .expect(201);
    const id = created.body.ticket._id;
    await request(app)
      .get(`/api/account/support?workspaceId=${workspaceId}&scope=workspace`)
      .set(auth(actor))
      .expect(403);
    await request(app)
      .get(`/api/account/support?workspaceId=${workspaceId}`)
      .set(auth(outsider))
      .expect(404);
    await request(app)
      .patch(`/api/account/support/${id}`)
      .set(auth(actor))
      .send({ status: 'resolved', response: 'Done' })
      .expect(403);
    const result = await request(app)
      .patch(`/api/account/support/${id}`)
      .set(auth(alice))
      .send({ status: 'resolved', response: 'Ask the meeting host to admit you.' })
      .expect(200);
    expect(result.body.ticket.status).toBe('resolved');
    const own = await request(app)
      .get(`/api/account/support?workspaceId=${workspaceId}`)
      .set(auth(actor))
      .expect(200);
    expect(own.body.tickets[0].response).toContain('host');
  });
  it('rejects a stale session even if its database record was inserted after a credential change', async () => {
    const actor = await signup('VersionAudit');
    await User.updateOne({ _id: actor.id }, { $inc: { securityVersion: 1 } });
    const response = await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
    expect(response.body.error.code).toBe('SESSION_EXPIRED');
    await request(app)
      .post('/api/auth/refresh')
      .set('Cookie', actor.cookies)
      .set('X-CSRF-Token', actor.csrf)
      .expect(401);
  });
  it('consumes password reset transactionally and keeps the link usable after rollback', async () => {
    const actor = await signup('RollbackAudit');
    await request(app).post('/api/auth/forgot-password').send({ email: actor.email }).expect(202);
    const token = mails.findLast((m) => m.to === actor.email)!.text.match(/#token=([^\s]+)/)![1];
    const failure = vi
      .spyOn(User, 'updateOne')
      .mockRejectedValueOnce(new Error('Simulated database write failure'));
    try {
      await request(app)
        .post('/api/auth/reset-password')
        .send({ token, password: 'another secure long password' })
        .expect(500);
    } finally {
      failure.mockRestore();
    }
    await request(app).get('/api/auth/me').set(auth(actor)).expect(200);
    await request(app)
      .post('/api/auth/reset-password')
      .send({ token, password: 'another secure long password' })
      .expect(200);
    await request(app).get('/api/auth/me').set(auth(actor)).expect(401);
  });
});

describe('concurrency and export audit', () => {
  it('returns only one usable set of MFA recovery codes for simultaneous confirmations', async () => {
    const actor = await signup('ConcurrentMfaAudit');
    const setup = await request(app)
      .post('/api/auth/mfa/setup')
      .set(auth(actor))
      .send({ password: 'correct horse battery staple' })
      .expect(200);
    const code = await generate({ secret: setup.body.secret });
    const results = await Promise.all(
      [1, 2].map(() => request(app).post('/api/auth/mfa/confirm').set(auth(actor)).send({ code })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const confirmed = results.find((r) => r.status === 200)!;
    await request(app)
      .post('/api/auth/login')
      .send({
        email: actor.email,
        password: 'correct horse battery staple',
        code: confirmed.body.recoveryCodes[0],
      })
      .expect(200);
  });
  it('does not create duplicate billable jobs when a failed-job retry request is repeated', async () => {
    const id = await liveMeeting('Retry dedup audit');
    const failed = await JobRecord.create({
      workspaceId,
      meetingId: id,
      requestedBy: alice.id,
      kind: 'summarize',
      status: 'failed',
    });
    const first = await request(app)
      .post(`/api/jobs/${failed._id}/retry`)
      .set(auth(alice))
      .expect(202);
    const second = await request(app)
      .post(`/api/jobs/${failed._id}/retry`)
      .set(auth(alice))
      .expect(202);
    expect(first.body.job._id).toBe(second.body.job._id);
    expect(await JobRecord.countDocuments({ retryOf: failed._id })).toBe(1);
  });
  it('preserves WebVTT times beyond 24 hours and escapes transcript markup', async () => {
    const id = await liveMeeting('VTT audit');
    await Transcript.create({
      workspaceId,
      meetingId: id,
      assetId: randomUUID(),
      speakerId: alice.id,
      startSeconds: 86400,
      endSeconds: 86401.25,
      text: '<b>literal</b> & text',
    });
    const result = await request(app)
      .get(`/api/meetings/${id}/export?format=vtt`)
      .set(auth(alice))
      .expect(200);
    expect(result.text).toContain('24:00:00.000 --> 24:00:01.250');
    expect(result.text).toContain('&lt;b&gt;literal&lt;/b&gt; &amp; text');
  });
  it('discards impossible calendar dates suggested by AI', async () => {
    const id = await liveMeeting('AI date audit');
    const segment = await Transcript.create({
      workspaceId,
      meetingId: id,
      assetId: randomUUID(),
      speakerId: alice.id,
      startSeconds: 0,
      endSeconds: 10,
      text: 'Prepare launch plan.',
    });
    await request(app).post(`/api/meetings/${id}/end`).set(auth(alice)).expect(204);
    summaryResult = {
      overview: 'Plan',
      decisions: [],
      actions: [
        { title: 'Prepare plan', assigneeId: null, dueDate: '2026-02-31', evidence: [segment._id] },
      ],
    };
    try {
      const result = await request(app)
        .post(`/api/meetings/${id}/summarize`)
        .set(auth(alice))
        .expect(202);
      await processJob(rt, result.body.job._id);
      expect((await Summary.findOne({ meetingId: id }))!.actions[0]!.dueDate).toBeNull();
    } finally {
      summaryResult = undefined;
    }
  });
});

it('paginates support requests with equal timestamps without losing records or leaking cursors', async () => {
  const actor = await signup('SupportCursorAudit');
  await Membership.create({ workspaceId, userId: actor.id, role: 'member' });
  const timestamp = new Date('2026-01-01T00:00:00Z');
  const tickets = await SupportTicket.create(
    [1, 2, 3].map((n) => ({
      workspaceId,
      userId: actor.id,
      subject: `Request ${n}`,
      message: 'Test message',
      createdAt: timestamp,
    })),
  );
  const first = await request(app)
    .get(`/api/account/support?workspaceId=${workspaceId}&limit=2`)
    .set(auth(actor))
    .expect(200);
  const next = await request(app)
    .get(
      `/api/account/support?workspaceId=${workspaceId}&limit=2&beforeId=${first.body.nextBeforeId}`,
    )
    .set(auth(actor))
    .expect(200);
  expect(new Set([...first.body.tickets, ...next.body.tickets].map((t) => t._id))).toEqual(
    new Set(tickets.map((t) => t._id)),
  );
  await request(app)
    .get(`/api/account/support?workspaceId=${workspaceId}&beforeId=${tickets[0]!._id}`)
    .set(auth(alice))
    .expect(404);
});
