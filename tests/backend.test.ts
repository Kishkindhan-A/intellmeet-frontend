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
  SupportTicket,
} from '../src/db.js';
import { HttpError } from '../src/lib.js';
import { processJob, housekeeping } from '../src/jobs.js';
import { attachRealtime } from '../src/realtime.js';
import { finishRecording } from '../src/webhooks.js';
import type { Runtime, SummaryResult } from '../src/ports.js';

let mongo: MongoMemoryReplSet;
const mails: { to: string; subject: string; text: string }[] = [];
const objects = new Map<string, { data: Buffer; type: string }>();
const queued: string[] = [];
const events: { event: string; payload: unknown }[] = [];
const locks = new Set<string>();
let summaryResult: SummaryResult | undefined;
let onTranscribe: (() => Promise<void>) | undefined;
let recordingCalls = 0;
const config = readConfig({
  NODE_ENV: 'test',
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
    async send(to, subject, text) {
      mails.push({ to, subject, text });
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
