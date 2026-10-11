import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  Asset,
  Audit,
  JobRecord,
  Meeting,
  Membership,
  Message,
  Note,
  Notification,
  Participant,
  Summary,
  Task,
  Transcript,
  User,
  Workspace,
} from './db.js';
import { assert, hash, HttpError } from './lib.js';
import { contentAccess } from './policy.js';
import { ensureProcessing, requestJob } from './meetings.js';
import { aiSummarySchema } from './providers.js';
import type { Runtime, SummaryResult } from './ports.js';
import { EgressStatus } from 'livekit-server-sdk';
import { finishRecording } from './webhooks.js';

async function authorizeJob(job: { requestedBy: string; meetingId: string }) {
  await contentAccess(job.requestedBy, job.meetingId);
  await ensureProcessing(job.meetingId, 'ai');
}
export async function processJob(rt: Runtime, id: string) {
  return rt.coordinator.lock(`job:${id}`, async () => {
    const job = await JobRecord.findById(id);
    assert(job, 404, 'NOT_FOUND', 'Job not found');
    if (job.status === 'completed') return;
    job.status = 'running';
    job.attempts += 1;
    job.error = undefined;
    await job.save();
    try {
      if (job.kind === 'purge') await purgeMeeting(rt, job.meetingId);
      else {
        await authorizeJob(job);
        if (job.kind === 'transcribe') {
          const asset = await Asset.findOne({
            _id: job.assetId,
            meetingId: job.meetingId,
            workspaceId: job.workspaceId,
            status: 'ready',
            kind: 'audio',
          });
          assert(asset, 404, 'ASSET_UNAVAILABLE', 'Audio asset is unavailable');
          if (!(await Transcript.exists({ assetId: asset._id }))) {
            const audio = await rt.storage.read(asset.key, rt.config.MAX_AUDIO_BYTES);
            const text = await rt.ai.transcribe(audio, asset.contentType);
            assert(
              text.length <= 100000,
              502,
              'AI_OUTPUT_LIMIT',
              'Transcription output was too large',
            );
            await rt.coordinator.lock(`meeting:${job.meetingId}`, async () => {
              await authorizeJob(job);
              assert(
                await Asset.exists({ _id: asset._id, status: 'ready' }),
                409,
                'ASSET_UNAVAILABLE',
                'Audio was removed while processing',
              );
              if (text.trim()) {
                const segment = await Transcript.findOneAndUpdate(
                  { assetId: asset._id },
                  {
                    $setOnInsert: {
                      workspaceId: job.workspaceId,
                      meetingId: job.meetingId,
                      speakerId: asset.userId,
                      startSeconds: asset.startSeconds,
                      endSeconds: asset.startSeconds + asset.durationSeconds,
                      text: text.trim(),
                    },
                  },
                  { upsert: true, returnDocument: 'after' },
                );
                rt.events.emit(
                  `meeting:${job.meetingId}`,
                  'transcript.segment',
                  segment!.toObject(),
                );
              }
            });
          }
        } else {
          const pending = await JobRecord.exists({
            meetingId: job.meetingId,
            kind: 'transcribe',
            status: { $in: ['queued', 'running'] },
          });
          assert(!pending, 409, 'TRANSCRIPTION_PENDING', 'Transcriptions are still processing');
          const segments = await Transcript.find({ meetingId: job.meetingId })
            .sort({ startSeconds: 1, _id: 1 })
            .lean();
          assert(segments.length, 409, 'TRANSCRIPT_EMPTY', 'No transcript is available');
          const sourceHash = hash(JSON.stringify(segments.map((s) => [s._id, s.text])));
          if ((await Summary.findOne({ meetingId: job.meetingId }))?.sourceHash !== sourceHash) {
            assert(
              segments.reduce((n, s) => n + s.text.length, 0) <= 600000,
              413,
              'TRANSCRIPT_LIMIT',
              'Transcript exceeds the per-meeting summary limit',
            );
            const members = await Membership.find({ workspaceId: job.workspaceId });
            const users = await User.find({ _id: { $in: members.map((m) => m.userId) } }).select(
              '_id name',
            );
            const people = users.map((u) => ({ id: u._id, name: u.name }));
            const batches: (typeof segments)[] = [];
            let batch: typeof segments = [];
            let size = 0;
            for (const s of segments) {
              if (size + s.text.length > 50000 && batch.length) {
                batches.push(batch);
                batch = [];
                size = 0;
              }
              batch.push(s);
              size += s.text.length;
            }
            if (batch.length) batches.push(batch);
            const results: SummaryResult[] = [];
            for (const group of batches) {
              await authorizeJob(job);
              results.push(
                aiSummarySchema.parse(
                  await rt.ai.summarize(
                    group.map((s) => ({
                      id: s._id,
                      text: s.text,
                      speakerId: s.speakerId ?? undefined,
                    })),
                    people,
                  ),
                ),
              );
            }
            const evidenceIds = new Set(segments.map((s) => s._id));
            const personIds = new Set(people.map((p) => p.id));
            const actions = results
              .flatMap((r) => r.actions)
              .map((action) => {
                assert(
                  action.evidence.length > 0 && action.evidence.every((v) => evidenceIds.has(v)),
                  502,
                  'AI_EVIDENCE_INVALID',
                  'AI returned an unsupported action',
                );
                return {
                  ...action,
                  id: randomUUID(),
                  assigneeId:
                    action.assigneeId && personIds.has(action.assigneeId)
                      ? action.assigneeId
                      : null,
                  dueDate:
                    action.dueDate && z.iso.date().safeParse(action.dueDate).success
                      ? action.dueDate
                      : null,
                };
              });
            await rt.coordinator.lock(`meeting:${job.meetingId}`, async () => {
              await authorizeJob(job);
              const currentSegments = await Transcript.find({ meetingId: job.meetingId })
                .sort({ startSeconds: 1, _id: 1 })
                .lean();
              assert(
                hash(JSON.stringify(currentSegments.map((s) => [s._id, s.text]))) === sourceHash,
                409,
                'TRANSCRIPT_CHANGED',
                'Transcript changed during summarization',
              );
              const summary = await Summary.findOneAndUpdate(
                { meetingId: job.meetingId },
                {
                  $set: {
                    workspaceId: job.workspaceId,
                    overview: results.map((r) => r.overview).join('\n\n'),
                    decisions: [...new Set(results.flatMap((r) => r.decisions))],
                    actions,
                    sourceHash,
                    model: rt.config.OPENAI_SUMMARY_MODEL,
                  },
                },
                { upsert: true, returnDocument: 'after' },
              );
              rt.events.emit(`meeting:${job.meetingId}`, 'summary.ready', {
                meetingId: job.meetingId,
                summaryId: summary!._id,
              });
            });
          }
        }
      }
      job.status = 'completed';
      job.finishedAt = new Date();
      await job.save();
      rt.events.emit(`user:${job.requestedBy}`, 'job.updated', { id: job._id, status: job.status });
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof HttpError ? err.code : 'PROVIDER_ERROR';
      await job.save();
      rt.events.emit(`user:${job.requestedBy}`, 'job.updated', {
        id: job._id,
        status: job.status,
        error: job.error,
      });
      throw err;
    }
  });
}
export async function purgeMeeting(rt: Runtime, meetingId: string) {
  return rt.coordinator.lock(`meeting:${meetingId}`, () => purgeMeetingLocked(rt, meetingId));
}
async function purgeMeetingLocked(rt: Runtime, meetingId: string) {
  const meeting = await Meeting.findById(meetingId);
  assert(
    !meeting || meeting.deletedAt,
    409,
    'DELETE_NOT_REQUESTED',
    'Meeting deletion must be requested first',
  );
  const assets = await Asset.find({ meetingId, status: { $ne: 'deleted' } });
  for (const asset of assets) {
    await rt.storage.delete(asset.key);
    await rt.storage.delete(`pending/${asset.workspaceId}/${meetingId}/${asset._id}`);
    asset.status = 'deleted';
    await asset.save();
  }
  const tasks = await Task.find({ meetingId }).select('_id');
  await Promise.all([
    Transcript.deleteMany({ meetingId }),
    Summary.deleteMany({ meetingId }),
    Message.deleteMany({ meetingId }),
    Note.deleteMany({ meetingId }),
    Participant.deleteMany({ meetingId }),
    Task.deleteMany({ meetingId }),
    Asset.deleteMany({ meetingId }),
    Notification.deleteMany({ resourceId: { $in: [meetingId, ...tasks.map((t) => t._id)] } }),
  ]);
  await Audit.create({
    workspaceId: meeting?.workspaceId,
    action: 'meeting.purged',
    resourceId: meetingId,
  });
  // Retain only the tombstone and audit/job metadata for operational accountability.
  await Meeting.updateOne(
    { _id: meetingId },
    {
      $set: { title: '[deleted]', description: '', invitees: [] },
      $unset: { egressId: 1, recordingAssetId: 1 },
    },
  );
}
export async function housekeeping(rt: Runtime) {
  const queued = await JobRecord.find({ status: 'queued' }).sort({ createdAt: 1 }).limit(100);
  for (const job of queued) await rt.coordinator.enqueue(job._id);
  const expired = await Asset.find({
    $or: [{ status: 'pending', expiresAt: { $lt: new Date() } }, { status: 'deleting' }],
  }).limit(100);
  for (const candidate of expired) {
    await rt.coordinator.lock(`meeting:${candidate.meetingId}`, () =>
      rt.coordinator.lock(`asset:${candidate._id}`, async () => {
        const asset = await Asset.findById(candidate._id);
        if (
          !asset ||
          !(
            asset.status === 'deleting' ||
            (asset.status === 'pending' && asset.expiresAt && asset.expiresAt < new Date())
          )
        )
          return;
        await rt.storage.delete(asset.key);
        if (asset.kind === 'audio' && asset.status === 'pending')
          await rt.storage.delete(`${asset.workspaceId}/${asset.meetingId}/${asset._id}.audio`);
        asset.status = 'deleted';
        await asset.save();
      }),
    );
  }
  for (const workspace of await Workspace.find()) {
    const cutoff = new Date(Date.now() - workspace.retentionDays * 86400000);
    const meetings = await Meeting.find({
      workspaceId: workspace._id,
      deletedAt: null,
      status: { $in: ['ended', 'cancelled'] },
      recordingState: 'idle',
      startsAt: { $lt: cutoff },
    }).limit(100);
    for (const meeting of meetings) {
      await rt.coordinator.lock(`meeting:${meeting._id}`, async () => {
        const changed = await Meeting.updateOne(
          { _id: meeting._id, deletedAt: null },
          { $set: { deletedAt: new Date() } },
        );
        if (changed.modifiedCount)
          await requestJob(rt, {
            workspaceId: workspace._id,
            meetingId: meeting._id,
            requestedBy: workspace.ownerId,
            kind: 'purge',
          });
      });
    }
  }
  for (const meeting of await Meeting.find({
    deletedAt: { $ne: null },
    title: { $ne: '[deleted]' },
  }).limit(100)) {
    if (!(await JobRecord.exists({ meetingId: meeting._id, kind: 'purge' })))
      await requestJob(rt, {
        workspaceId: meeting.workspaceId,
        meetingId: meeting._id,
        requestedBy: meeting.hostId,
        kind: 'purge',
      });
  }
  // Retry removals after transient SFU failures. Short-lived join grants and verified webhooks also gate rejoining.
  if (rt.media.configured) {
    for (const meeting of await Meeting.find({ status: 'ended', mediaClosePending: true }).limit(
      100,
    )) {
      try {
        await rt.media.close(meeting._id);
        await Participant.updateMany(
          { meetingId: meeting._id, status: 'admitted' },
          { $set: { status: 'left', leftAt: new Date() } },
        );
        await Meeting.updateOne({ _id: meeting._id }, { $set: { mediaClosePending: false } });
      } catch {
        rt.logger.warn({ meetingId: meeting._id }, 'Room closure awaits retry');
      }
    }
    for (const meeting of await Meeting.find({ recordingState: { $ne: 'idle' } }).limit(100)) {
      const recordings = await rt.media.recordings(meeting._id);
      const asset = await Asset.findById(meeting.recordingAssetId);
      const recording =
        recordings.find((r) => r.id === meeting.egressId || (r.key && r.key === asset?.key)) ??
        (meeting.recordingState === 'starting' && recordings.length === 1
          ? recordings[0]
          : undefined);
      if (recording) {
        if (!meeting.egressId) {
          meeting.egressId = recording.id;
          meeting.recordingState = 'recording';
          await meeting.save();
        }
        if (
          [
            EgressStatus.EGRESS_COMPLETE,
            EgressStatus.EGRESS_FAILED,
            EgressStatus.EGRESS_ABORTED,
            EgressStatus.EGRESS_LIMIT_REACHED,
          ].includes(recording.status)
        )
          await finishRecording(rt, recording.id, recording.status, recording.key);
      }
    }
    const active = await Participant.find({ connected: true }).limit(1000);
    for (const person of active) {
      const meeting = await Meeting.findById(person.meetingId);
      const member = await Membership.exists({
        workspaceId: person.workspaceId,
        userId: person.userId,
      });
      if (
        !member ||
        person.status !== 'admitted' ||
        meeting?.status !== 'live' ||
        meeting.deletedAt
      )
        await rt.media
          .remove(person.meetingId, person.userId)
          .catch(() =>
            rt.logger.warn({ meetingId: person.meetingId }, 'Media revocation retry failed'),
          );
    }
  }
  if (rt.ai.configured) {
    for (const meeting of await Meeting.find({ status: 'ended', deletedAt: null })
      .sort({ endedAt: -1 })
      .limit(100)) {
      if (
        !(await JobRecord.exists({ meetingId: meeting._id, kind: 'summarize' })) &&
        (await Transcript.exists({ meetingId: meeting._id })) &&
        !(await JobRecord.exists({
          meetingId: meeting._id,
          kind: 'transcribe',
          status: { $in: ['queued', 'running'] },
        }))
      ) {
        try {
          await rt.coordinator.lock(`summary:${meeting._id}`, async () => {
            if (!(await JobRecord.exists({ meetingId: meeting._id, kind: 'summarize' })))
              await requestJob(rt, {
                workspaceId: meeting.workspaceId,
                meetingId: meeting._id,
                requestedBy: meeting.hostId,
                kind: 'summarize',
              });
          });
        } catch (err) {
          if (!(err instanceof HttpError)) throw err;
        }
      }
    }
  }
}
