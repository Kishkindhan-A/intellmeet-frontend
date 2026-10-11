import { Router, raw } from 'express';
import { EgressStatus } from 'livekit-server-sdk';
import { ParticipantInfo_Kind } from '@livekit/protocol';
import { Asset, Meeting, Participant, WebhookEvent } from './db.js';
import { admitted } from './policy.js';
import { assert, HttpError } from './lib.js';
import type { Runtime } from './ports.js';

export async function finishRecording(rt: Runtime, egressId: string, status: number, key?: string) {
  const meeting = await Meeting.findOne({ egressId });
  assert(meeting?.recordingAssetId, 409, 'EGRESS_PENDING', 'Recording state is not yet ready');
  const asset = await Asset.findById(meeting.recordingAssetId);
  if (asset && asset.status === 'pending') {
    if (status === EgressStatus.EGRESS_COMPLETE) {
      assert(
        key === asset.key,
        400,
        'EGRESS_OUTPUT_MISMATCH',
        'Recording output did not match its reserved object',
      );
      const meta = await rt.storage.inspect(asset.key);
      assert(meta.size > 0, 400, 'EMPTY_RECORDING', 'Recording is empty');
      asset.size = meta.size;
      asset.status = 'ready';
    } else {
      asset.status = 'failed';
    }
    await asset.save();
  }
  await Meeting.updateOne({ _id: meeting._id, egressId }, { $set: { recordingState: 'idle' } });
  rt.events.emit(`meeting:${meeting._id}`, 'recording.completed', {
    assetId: meeting.recordingAssetId,
    status: asset?.status,
  });
}

export function webhookRoutes(rt: Runtime) {
  const router = Router();
  router.post(
    '/livekit',
    raw({ type: ['application/webhook+json', 'application/json'], limit: '1mb' }),
    async (req, res) => {
      assert(
        await rt.coordinator.consume(`webhook:${req.ip}`, 600, 60),
        429,
        'RATE_LIMITED',
        'Webhook rate limit exceeded',
      );
      assert(
        Buffer.isBuffer(req.body) && req.headers.authorization,
        400,
        'INVALID_WEBHOOK',
        'Signed webhook body required',
      );
      let event;
      try {
        event = await rt.media.verifyWebhook(req.body.toString('utf8'), req.headers.authorization);
      } catch {
        throw new HttpError(401, 'WEBHOOK_SIGNATURE', 'Invalid webhook signature');
      }
      assert(event.id && event.id.length < 200, 400, 'INVALID_WEBHOOK', 'Webhook ID required');
      await rt.coordinator.lock(`webhook:${event.id}`, async () => {
        if ((await WebhookEvent.findById(event.id))?.processedAt) return;
        await WebhookEvent.updateOne(
          { _id: event.id },
          { $setOnInsert: { receivedAt: new Date() } },
          { upsert: true },
        );
        const meetingId = event.room?.name;
        const userId = event.participant?.identity;
        if (meetingId && userId && event.event === 'participant_joined') {
          if (event.participant?.kind === ParticipantInfo_Kind.EGRESS) {
            const recording = await Meeting.exists({
              _id: meetingId,
              deletedAt: null,
              processingMode: 'standard',
              recordingState: { $ne: 'idle' },
            });
            if (!recording) await rt.media.remove(meetingId, userId);
            await WebhookEvent.updateOne({ _id: event.id }, { $set: { processedAt: new Date() } });
            return;
          }
          try {
            await admitted(userId, meetingId);
          } catch {
            await rt.media.remove(meetingId, userId);
            await WebhookEvent.updateOne({ _id: event.id }, { $set: { processedAt: new Date() } });
            return;
          }
          await Participant.updateOne(
            { meetingId, userId, connected: false },
            { $set: { connected: true, connectedAt: new Date() } },
          );
          rt.events.emit(`meeting:${meetingId}`, 'presence.joined', { userId });
        }
        if (meetingId && userId && event.event === 'participant_left') {
          const participant = await Participant.findOneAndUpdate(
            { meetingId, userId, connected: true },
            { $set: { connected: false } },
          );
          if (participant?.connectedAt)
            await Participant.updateOne(
              { _id: participant._id },
              {
                $inc: {
                  connectedSeconds: Math.max(
                    0,
                    (Date.now() - participant.connectedAt.getTime()) / 1000,
                  ),
                },
              },
            );
          rt.events.emit(`meeting:${meetingId}`, 'presence.left', { userId });
        }
        if (event.event === 'egress_ended' && event.egressInfo) {
          const info = event.egressInfo;
          await finishRecording(rt, info.egressId, info.status, info.fileResults[0]?.filename);
        }
        await WebhookEvent.updateOne({ _id: event.id }, { $set: { processedAt: new Date() } });
      });
      res.status(204).end();
    },
  );
  return router;
}
