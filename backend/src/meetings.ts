import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import {
  Meeting,
  Participant,
  User,
  Asset,
  JobRecord,
  Transcript,
  Summary,
  Task,
  Project,
  Workspace,
  Note,
} from './db.js';
import { assert, audit, body, pagination, param, text, uuid } from './lib.js';
import {
  admitted,
  contentAccess,
  hostAccess,
  meetingAccess,
  membership,
  validateMembers,
} from './policy.js';
import { requireAuth } from './auth.js';
import type { Runtime } from './ports.js';
import { notify } from './workspaces.js';

export async function ensureProcessing(meetingId: string, type: 'ai' | 'recording') {
  const meeting = await Meeting.findOne({ _id: meetingId, deletedAt: null });
  assert(
    meeting && meeting.processingMode === 'standard',
    403,
    'PROCESSING_DISABLED',
    'This meeting does not allow server processing',
  );
  const workspace = await Workspace.findById(meeting.workspaceId);
  if (type === 'ai')
    assert(workspace?.aiEnabled, 403, 'AI_DISABLED', 'AI is disabled for this workspace');
  const people = await Participant.find({
    meetingId,
    $or: [{ admittedAt: { $ne: null } }, { status: { $in: ['admitted', 'left'] } }],
  });
  assert(
    people.length && people.every((p) => (type === 'ai' ? p.aiConsent : p.recordingConsent)),
    409,
    'CONSENT_REQUIRED',
    'Every admitted participant must consent before processing',
  );
  return meeting;
}
export async function requestJob(
  rt: Runtime,
  input: {
    workspaceId: string;
    meetingId: string;
    requestedBy: string;
    kind: 'transcribe' | 'summarize' | 'purge';
    assetId?: string;
    retryOf?: string;
  },
) {
  if (input.kind !== 'purge') {
    assert(rt.ai.configured, 503, 'AI_UNAVAILABLE', 'OpenAI is not configured');
    await ensureProcessing(input.meetingId, 'ai');
    assert(
      await rt.coordinator.consume(
        `ai:${input.workspaceId}`,
        rt.config.AI_JOBS_PER_WORKSPACE_DAY,
        86400,
      ),
      429,
      'AI_QUOTA',
      'Workspace daily AI processing limit reached',
    );
  }
  const job = await JobRecord.create(input);
  // The database record is the durable outbox. The worker dispatcher retries Redis failures.
  await rt.coordinator
    .enqueue(job._id)
    .catch(() => rt.logger.warn({ jobId: job._id }, 'Job awaiting outbox dispatch'));
  return job;
}
export function meetingRoutes(rt: Runtime) {
  const router = Router();
  router.use(requireAuth(rt));
  const inputSchema = z
    .object({
      title: text(200),
      description: z.string().max(5000).default(''),
      startsAt: z.iso.datetime(),
      durationMinutes: z.number().int().min(5).max(480).default(60),
      visibility: z.enum(['workspace', 'invite']).default('workspace'),
      invitees: z.array(uuid).max(200).default([]),
      lobbyEnabled: z.boolean().default(true),
      processingMode: z.enum(['standard', 'confidential']).default('standard'),
    })
    .strict();
  router.get('/workspaces/:workspaceId/meetings', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    const member = await membership(req.auth!.userId, workspaceId);
    const input = pagination
      .extend({
        status: z.enum(['scheduled', 'live', 'ended', 'cancelled']).optional(),
        q: z.string().max(100).optional(),
      })
      .parse(req.query);
    const query = {
      workspaceId,
      deletedAt: null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.before ? { startsAt: { $lt: new Date(input.before) } } : {}),
      ...(member.role === 'member'
        ? {
            $or: [
              { visibility: 'workspace' as const },
              { hostId: req.auth!.userId },
              { invitees: req.auth!.userId },
            ],
          }
        : {}),
      ...(input.q
        ? { title: { $regex: input.q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' } }
        : {}),
    };
    res.json({
      meetings: await Meeting.find(query).sort({ startsAt: -1, _id: -1 }).limit(input.limit),
    });
  });
  router.post('/workspaces/:workspaceId/meetings', async (req, res) => {
    const workspaceId = param(req, 'workspaceId');
    await membership(req.auth!.userId, workspaceId);
    const input = body(inputSchema, req);
    await validateMembers(workspaceId, input.invitees);
    assert(
      await rt.coordinator.consume(`meeting-create:${workspaceId}`, 200, 86400),
      429,
      'MEETING_QUOTA',
      'Daily meeting creation limit reached',
    );
    const meeting = await Meeting.create({ ...input, workspaceId, hostId: req.auth!.userId });
    for (const userId of input.invitees)
      await notify(
        rt,
        workspaceId,
        userId,
        'meeting.invited',
        'You have a new meeting invitation',
        meeting._id,
      );
    await audit(req, 'meeting.created', meeting._id, workspaceId);
    res.status(201).json({ meeting });
  });
  router.get('/meetings/:meetingId', async (req, res) => {
    const { meeting } = await meetingAccess(req.auth!.userId, param(req, 'meetingId'));
    res.json({ meeting });
  });
  router.patch('/meetings/:meetingId', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await hostAccess(rt, req.auth!, meetingId);
    const input = body(
      inputSchema.partial().extend({ locked: z.boolean().optional() }).strict(),
      req,
    );
    const meeting = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting } = await hostAccess(rt, req.auth!, meetingId);
      assert(
        meeting.status === 'scheduled' ||
          (meeting.status === 'live' &&
            Object.keys(input).every((k) => ['locked', 'title', 'description'].includes(k))),
        409,
        'MEETING_STATE',
        'Only title, description and lock can change during a live meeting',
      );
      if (input.invitees) await validateMembers(meeting.workspaceId, input.invitees);
      Object.assign(meeting, input);
      await meeting.save();
      return meeting;
    });
    rt.events.emit(`meeting:${meetingId}`, 'meeting.updated', meeting.toObject());
    await audit(req, 'meeting.updated', meetingId, meeting.workspaceId);
    res.json({ meeting });
  });
  router.post('/meetings/:meetingId/start', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    const updated = await Meeting.findOneAndUpdate(
      { _id: meetingId, status: 'scheduled', deletedAt: null },
      { $set: { status: 'live', startedAt: new Date() } },
      { returnDocument: 'after' },
    );
    assert(updated, 409, 'MEETING_STATE', 'Meeting must be scheduled');
    await audit(req, 'meeting.started', meetingId, meeting.workspaceId);
    res.json({ meeting: updated });
  });
  router.post('/meetings/:meetingId/join', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const input = body(
      z
        .object({
          recordingConsent: z.boolean().default(false),
          aiConsent: z.boolean().default(false),
        })
        .strict(),
      req,
    );
    const participant = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting, participant } = await meetingAccess(req.auth!.userId, meetingId);
      assert(meeting.status === 'live', 409, 'MEETING_STATE', 'Meeting is not live');
      assert(
        !meeting.locked || meeting.hostId === req.auth!.userId,
        403,
        'MEETING_LOCKED',
        'Meeting is locked',
      );
      if (meeting.recordingState !== 'idle')
        assert(
          input.recordingConsent,
          409,
          'CONSENT_REQUIRED',
          'Recording is active; consent is required to join',
        );
      if (participant?.status === 'admitted') return participant;
      const status =
        meeting.hostId === req.auth!.userId || !meeting.lobbyEnabled ? 'admitted' : 'waiting';
      if (status === 'admitted')
        assert(
          (await Participant.countDocuments({ meetingId, status: 'admitted' })) <
            rt.config.MAX_PARTICIPANTS,
          409,
          'MEETING_FULL',
          'Meeting participant limit reached',
        );
      return Participant.findOneAndUpdate(
        { meetingId, userId: req.auth!.userId },
        {
          $set: {
            workspaceId: meeting.workspaceId,
            status,
            ...input,
            joinedAt: new Date(),
            leftAt: null,
            ...(status === 'admitted' ? { admittedAt: new Date() } : {}),
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
    });
    rt.events.emit(`lobby:${meetingId}`, 'participant.updated', participant!.toObject());
    res.json({ participant });
  });
  router.get('/meetings/:meetingId/participants', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting, member } = await meetingAccess(req.auth!.userId, meetingId);
    const host = meeting.hostId === req.auth!.userId || member.role !== 'member';
    res.json({
      participants: await Participant.find({
        meetingId,
        ...(host ? {} : { status: { $in: ['admitted', 'left'] } }),
      }).select('-__v'),
    });
  });
  router.post('/meetings/:meetingId/participants/:userId/admit', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const userId = param(req, 'userId');
    const participant = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting } = await hostAccess(rt, req.auth!, meetingId);
      assert(meeting.status === 'live', 409, 'MEETING_STATE', 'Meeting is not live');
      await meetingAccess(userId, meetingId);
      const person = await Participant.findOne({ meetingId, userId, status: 'waiting' });
      assert(person, 404, 'NOT_FOUND', 'Waiting participant not found');
      assert(
        (await Participant.countDocuments({ meetingId, status: 'admitted' })) <
          rt.config.MAX_PARTICIPANTS,
        409,
        'MEETING_FULL',
        'Meeting participant limit reached',
      );
      if (meeting.recordingState !== 'idle')
        assert(
          person.recordingConsent,
          409,
          'CONSENT_REQUIRED',
          'Participant must consent to the active recording',
        );
      person.status = 'admitted';
      person.admittedAt = new Date();
      await person.save();
      return person;
    });
    rt.events.emit(`user:${userId}`, 'meeting.admitted', { meetingId });
    rt.events.emit(`meeting:${meetingId}`, 'participant.updated', participant.toObject());
    res.json({ participant });
  });
  router.post('/meetings/:meetingId/media-token', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const result = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting, participant } = await admitted(req.auth!.userId, meetingId);
      if (meeting.recordingState !== 'idle')
        assert(
          participant!.recordingConsent,
          409,
          'CONSENT_REQUIRED',
          'Recording consent required',
        );
      const user = await User.findById(req.auth!.userId);
      return {
        token: await rt.media.issue(meetingId, user!._id, user!.name, participant!.canPublish),
        url: rt.config.LIVEKIT_PUBLIC_URL ?? rt.config.LIVEKIT_URL,
        expiresIn: 60,
      };
    });
    res.setHeader('Cache-Control', 'no-store');
    res.json(result);
  });
  router.patch('/meetings/:meetingId/consent', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const input = body(
      z.object({ recordingConsent: z.boolean(), aiConsent: z.boolean() }).strict(),
      req,
    );
    const participant = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting, participant } = await meetingAccess(req.auth!.userId, meetingId);
      assert(participant, 404, 'NOT_FOUND', 'Participant not found');
      if (!input.recordingConsent && meeting.recordingState !== 'idle') {
        assert(
          meeting.egressId,
          409,
          'RECORDING_STARTING',
          'Recording is starting; retry consent withdrawal shortly',
        );
        await rt.media.stopRecording(meeting.egressId);
        await Meeting.updateOne(
          { _id: meetingId, egressId: meeting.egressId, recordingState: { $ne: 'idle' } },
          { $set: { recordingState: 'stopping' } },
        );
      }
      Object.assign(participant, input);
      await participant.save();
      if (!input.aiConsent) {
        await Transcript.deleteMany({ meetingId, speakerId: req.auth!.userId });
        await Summary.deleteOne({ meetingId });
      }
      return participant;
    });
    await audit(req, 'meeting.consent.changed', meetingId, participant.workspaceId);
    rt.events.emit(`meeting:${meetingId}`, 'consent.updated', {
      userId: req.auth!.userId,
      ...input,
    });
    res.json({ participant });
  });
  router.post('/meetings/:meetingId/participants/:userId/remove', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const userId = param(req, 'userId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    assert(userId !== meeting.hostId, 400, 'INVALID_PARTICIPANT', 'Cannot remove the meeting host');
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const person = await Participant.findOneAndUpdate(
        { meetingId, userId },
        { $set: { status: 'removed', leftAt: new Date() } },
      );
      assert(person, 404, 'NOT_FOUND', 'Participant not found');
      await rt.events.revokeMeeting(userId, meetingId);
      if (rt.media.configured) await rt.media.remove(meetingId, userId);
    });
    await audit(req, 'meeting.participant.removed', userId, meeting.workspaceId);
    res.status(204).end();
  });
  router.patch('/meetings/:meetingId/participants/:userId/media', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const userId = param(req, 'userId');
    await hostAccess(rt, req.auth!, meetingId);
    const input = body(z.object({ canPublish: z.boolean() }).strict(), req);
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const p = await Participant.findOneAndUpdate(
        { meetingId, userId, status: 'admitted' },
        { $set: input },
      );
      assert(p, 404, 'NOT_FOUND', 'Participant not found');
      if (rt.media.configured) await rt.media.publish(meetingId, userId, input.canPublish);
    });
    res.status(204).end();
  });
  router.post('/meetings/:meetingId/leave', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      await meetingAccess(req.auth!.userId, meetingId);
      await Participant.findOneAndUpdate(
        { meetingId, userId: req.auth!.userId },
        { $set: { status: 'left', leftAt: new Date() } },
      );
      await rt.events.revokeMeeting(req.auth!.userId, meetingId);
      if (rt.media.configured) await rt.media.remove(meetingId, req.auth!.userId);
    });
    res.status(204).end();
  });
  router.post('/meetings/:meetingId/end', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const current = await Meeting.findById(meetingId);
      assert(
        current && ['live', 'ended'].includes(current.status),
        409,
        'MEETING_STATE',
        'Meeting is not live or ended',
      );
      if (current.egressId && current.recordingState !== 'idle')
        await rt.media.stopRecording(current.egressId);
      current.status = 'ended';
      current.endedAt ??= new Date();
      current.mediaClosePending = true;
      await current.save();
      if (rt.media.configured) await rt.media.close(meetingId);
      await Meeting.updateOne({ _id: meetingId }, { $set: { mediaClosePending: false } });
      await Participant.updateMany(
        { meetingId, status: 'admitted' },
        { $set: { status: 'left', leftAt: new Date() } },
      );
    });
    rt.events.emit(`meeting:${meetingId}`, 'meeting.ended', { meetingId });
    await audit(req, 'meeting.ended', meetingId, meeting.workspaceId);
    res.status(204).end();
  });
  router.post('/meetings/:meetingId/cancel', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    const result = await Meeting.updateOne(
      { _id: meetingId, status: 'scheduled' },
      { $set: { status: 'cancelled' } },
    );
    assert(result.modifiedCount, 409, 'MEETING_STATE', 'Only scheduled meetings can be cancelled');
    await audit(req, 'meeting.cancelled', meetingId, meeting.workspaceId);
    res.status(204).end();
  });
  router.delete('/meetings/:meetingId', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    assert(
      meeting.status !== 'live' && meeting.recordingState === 'idle',
      409,
      'MEETING_ACTIVE',
      'End the meeting and wait for recording completion before deletion',
    );
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const current = await Meeting.findById(meetingId);
      assert(
        current && current.status !== 'live' && current.recordingState === 'idle',
        409,
        'MEETING_ACTIVE',
        'Meeting is active',
      );
      await Meeting.updateOne({ _id: meetingId }, { $set: { deletedAt: new Date() } });
    });
    const job = await requestJob(rt, {
      workspaceId: meeting.workspaceId,
      meetingId,
      requestedBy: req.auth!.userId,
      kind: 'purge',
    });
    await audit(req, 'meeting.deletion.requested', meetingId, meeting.workspaceId);
    res.status(202).json({ job });
  });
  router.post('/meetings/:meetingId/recordings/start', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await hostAccess(rt, req.auth!, meetingId);
    assert(rt.media.configured, 503, 'MEDIA_UNAVAILABLE', 'LiveKit is not configured');
    const result = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const meeting = await ensureProcessing(meetingId, 'recording');
      assert(
        meeting.status === 'live' && meeting.recordingState === 'idle',
        409,
        'RECORDING_STATE',
        'A live meeting with no active recording is required',
      );
      const assetId = randomUUID();
      const key = `${meeting.workspaceId}/${meetingId}/${assetId}.mp4`;
      await Asset.create({
        _id: assetId,
        workspaceId: meeting.workspaceId,
        meetingId,
        userId: req.auth!.userId,
        key,
        kind: 'recording',
        contentType: 'video/mp4',
        size: 0,
      });
      meeting.recordingState = 'starting';
      meeting.recordingAssetId = assetId;
      await meeting.save();
      // Keep 'starting' on an ambiguous network failure to avoid duplicate recording starts.
      const egressId = await rt.media.startRecording(meetingId, key);
      meeting.egressId = egressId;
      meeting.recordingState = 'recording';
      await meeting.save();
      return { assetId, egressId };
    });
    rt.events.emit(`meeting:${meetingId}`, 'recording.started', result);
    await audit(req, 'recording.started', result.assetId);
    res.status(201).json(result);
  });
  router.post('/meetings/:meetingId/recordings/stop', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await hostAccess(rt, req.auth!, meetingId);
    await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const m = await Meeting.findById(meetingId);
      assert(
        m?.egressId && m.recordingState !== 'idle',
        409,
        'RECORDING_STATE',
        'No active recording',
      );
      await rt.media.stopRecording(m.egressId);
      await Meeting.updateOne(
        { _id: meetingId, egressId: m.egressId, recordingState: { $ne: 'idle' } },
        { $set: { recordingState: 'stopping' } },
      );
    });
    res.status(202).json({ message: 'Recording is finalizing' });
  });
  router.get('/meetings/:meetingId/transcript', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await contentAccess(req.auth!.userId, meetingId);
    const input = z
      .object({
        afterSeconds: z.coerce.number().min(0).default(0),
        limit: z.coerce.number().int().min(1).max(500).default(100),
      })
      .parse(req.query);
    res.json({
      segments: await Transcript.find({ meetingId, startSeconds: { $gte: input.afterSeconds } })
        .sort({ startSeconds: 1 })
        .limit(input.limit),
    });
  });
  router.post('/meetings/:meetingId/summarize', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    assert(
      meeting.status === 'ended',
      409,
      'MEETING_STATE',
      'End the meeting before generating a summary',
    );
    const job = await rt.coordinator.lock(`summary:${meetingId}`, async () => {
      const existing = await JobRecord.findOne({
        meetingId,
        kind: 'summarize',
        status: { $in: ['queued', 'running'] },
      });
      return (
        existing ??
        requestJob(rt, {
          workspaceId: meeting.workspaceId,
          meetingId,
          requestedBy: req.auth!.userId,
          kind: 'summarize',
        })
      );
    });
    res.status(202).json({ job });
  });
  router.get('/meetings/:meetingId/summary', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await contentAccess(req.auth!.userId, meetingId);
    res.json({ summary: await Summary.findOne({ meetingId }) });
  });
  router.post('/meetings/:meetingId/actions/:actionId/accept', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const actionId = param(req, 'actionId');
    const { meeting } = await hostAccess(rt, req.auth!, meetingId);
    const input = body(
      z
        .object({
          projectId: uuid.optional(),
          assigneeId: uuid.nullable().optional(),
          dueAt: z.iso.datetime().optional(),
        })
        .strict(),
      req,
    );
    const task = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      await hostAccess(rt, req.auth!, meetingId);
      const summary = await Summary.findOne({ meetingId });
      const action = summary?.actions.find((a) => a.id === actionId);
      assert(action, 404, 'NOT_FOUND', 'Action item not found');
      const existing = await Task.findOne({ sourceActionId: actionId });
      if (existing) return existing;
      const assigneeId = input.assigneeId !== undefined ? input.assigneeId : action.assigneeId;
      if (assigneeId) await validateMembers(meeting.workspaceId, [assigneeId]);
      if (input.projectId)
        assert(
          await Project.exists({
            _id: input.projectId,
            workspaceId: meeting.workspaceId,
            archived: false,
          }),
          400,
          'INVALID_PROJECT',
          'Active project required',
        );
      const task = await Task.create({
        workspaceId: meeting.workspaceId,
        meetingId,
        title: action.title,
        assigneeId,
        projectId: input.projectId,
        dueAt: input.dueAt ?? (action.dueDate ? new Date(action.dueDate) : undefined),
        createdBy: req.auth!.userId,
        sourceActionId: actionId,
      });
      action.acceptedTaskId = task._id;
      await summary!.save();
      if (assigneeId)
        await notify(
          rt,
          meeting.workspaceId,
          assigneeId,
          'task.assigned',
          'A meeting action was assigned to you',
          task._id,
        );
      return task;
    });
    await audit(req, 'meeting.action.accepted', task._id, meeting.workspaceId);
    res.status(201).json({ task });
  });
  router.get('/jobs/:jobId', async (req, res) => {
    const job = await JobRecord.findById(param(req, 'jobId'));
    assert(job, 404, 'NOT_FOUND', 'Job not found');
    await membership(req.auth!.userId, job.workspaceId);
    if (job.kind !== 'purge') await meetingAccess(req.auth!.userId, job.meetingId);
    res.json({ job });
  });
  router.post('/jobs/:jobId/retry', async (req, res) => {
    const old = await JobRecord.findById(param(req, 'jobId'));
    assert(old, 404, 'NOT_FOUND', 'Job not found');
    if (old.kind === 'purge') {
      const member = await membership(req.auth!.userId, old.workspaceId);
      assert(
        member.role !== 'member' && (!rt.config.REQUIRE_ADMIN_MFA || req.auth!.mfa),
        403,
        'FORBIDDEN',
        'Administrator with MFA required',
      );
    } else await hostAccess(rt, req.auth!, old.meetingId);
    const job = await rt.coordinator.lock(`job:${old._id}`, async () => {
      const current = await JobRecord.findById(old._id);
      assert(current?.status === 'failed', 409, 'JOB_STATE', 'Only failed jobs can be retried');
      const existing = await JobRecord.findOne({ retryOf: old._id });
      if (existing) return existing;
      const replacement = await requestJob(rt, {
        workspaceId: old.workspaceId,
        meetingId: old.meetingId,
        requestedBy: req.auth!.userId,
        kind: old.kind,
        assetId: old.assetId ?? undefined,
        retryOf: old._id,
      });
      return replacement;
    });
    res.status(202).json({ job });
  });
  router.get('/meetings/:meetingId/export', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting } = await contentAccess(req.auth!.userId, meetingId);
    const input = z
      .object({ format: z.enum(['json', 'markdown', 'vtt']).default('json') })
      .parse(req.query);
    const [segments, summary, note, tasks] = await Promise.all([
      Transcript.find({ meetingId }).sort({ startSeconds: 1 }).lean(),
      Summary.findOne({ meetingId }).lean(),
      Note.findOne({ meetingId }).lean(),
      Task.find({ meetingId }).lean(),
    ]);
    res.setHeader('Cache-Control', 'no-store');
    res.attachment(`meeting-${meetingId}.${input.format === 'markdown' ? 'md' : input.format}`);
    if (input.format === 'json') {
      res.json({ meeting, segments, summary, note, tasks });
      return;
    }
    if (input.format === 'vtt') {
      const timestamp = (v: number) => {
        const ms = Math.round(v * 1000);
        return `${String(Math.floor(ms / 3600000)).padStart(2, '0')}:${String(Math.floor(ms / 60000) % 60).padStart(2, '0')}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}.${String(ms % 1000).padStart(3, '0')}`;
      };
      res.type('text/vtt').send(
        'WEBVTT\n\n' +
          segments
            .map(
              (s, i) =>
                `${i + 1}\n${timestamp(s.startSeconds)} --> ${timestamp(s.endSeconds)}\n${s.text
                  .replace(/&/g, '&amp;')
                  .replace(/</g, '&lt;')
                  .replace(/>/g, '&gt;')
                  .replace(/\r/g, '')
                  .replace(/\n\s*\n/g, '\n')}\n`,
            )
            .join('\n'),
      );
      return;
    }
    res
      .type('text/markdown')
      .send(
        `# ${meeting.title}\n\n${summary?.overview ?? 'Summary not generated.'}\n\n## Decisions\n${summary?.decisions.map((v) => `- ${v}`).join('\n') ?? ''}\n\n## Actions\n${tasks.map((v) => `- [${v.status === 'done' ? 'x' : ' '}] ${v.title}`).join('\n')}\n\n## Notes\n${note?.text ?? ''}\n\n## Transcript\n${segments.map((s) => `[${s.startSeconds}s] ${s.text}`).join('\n\n')}`,
      );
  });
  return router;
}
