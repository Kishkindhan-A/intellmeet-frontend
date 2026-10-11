import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { Asset, JobRecord } from './db.js';
import { assert, audit, body, param } from './lib.js';
import { admitted, contentAccess, hostAccess } from './policy.js';
import { requireAuth } from './auth.js';
import { ensureProcessing, requestJob } from './meetings.js';
import type { Runtime } from './ports.js';

export function validAudio(type: string, data: Buffer) {
  if (type === 'audio/wav')
    return data.subarray(0, 4).toString() === 'RIFF' && data.subarray(8, 12).toString() === 'WAVE';
  if (type === 'audio/webm') return data.subarray(0, 4).toString('hex') === '1a45dfa3';
  if (type === 'audio/mp4') return data.subarray(4, 8).toString() === 'ftyp';
  if (type === 'audio/mpeg')
    return (
      data.subarray(0, 3).toString() === 'ID3' || (data[0] === 0xff && (data[1]! & 0xe0) === 0xe0)
    );
  return false;
}
export function assetRoutes(rt: Runtime) {
  const router = Router();
  router.use(requireAuth(rt));
  router.post('/meetings/:meetingId/audio-uploads', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const result = await rt.coordinator.lock(`meeting:${meetingId}`, async () => {
      const { meeting } = await admitted(req.auth!.userId, meetingId);
      await ensureProcessing(meetingId, 'ai');
      assert(rt.ai.configured, 503, 'AI_UNAVAILABLE', 'OpenAI is not configured');
      const input = body(
        z
          .object({
            contentType: z.enum(['audio/webm', 'audio/wav', 'audio/mpeg', 'audio/mp4']),
            size: z.number().int().min(12).max(rt.config.MAX_AUDIO_BYTES),
            startSeconds: z.number().min(0).max(86400),
            durationSeconds: z.number().min(0.1).max(300),
          })
          .strict(),
        req,
      );
      assert(
        await rt.coordinator.consume(`uploads:${meeting.workspaceId}`, 2000, 86400),
        429,
        'UPLOAD_QUOTA',
        'Daily audio upload limit reached',
      );
      const id = randomUUID();
      const key = `pending/${meeting.workspaceId}/${meetingId}/${id}`;
      const asset = await Asset.create({
        _id: id,
        ...input,
        workspaceId: meeting.workspaceId,
        meetingId,
        userId: req.auth!.userId,
        key,
        kind: 'audio',
        expiresAt: new Date(Date.now() + 3600000),
      });
      const url = await rt.storage.uploadUrl(key, input.contentType, input.size);
      return {
        assetId: asset._id,
        uploadUrl: url,
        method: 'PUT',
        headers: { 'Content-Type': input.contentType, 'Content-Length': String(input.size) },
        expiresIn: 300,
      };
    });
    res.status(201).json(result);
  });
  router.post('/assets/:assetId/complete', async (req, res) => {
    const assetId = param(req, 'assetId');
    const initial = await Asset.findById(assetId);
    assert(initial, 404, 'NOT_FOUND', 'Asset not found');
    await contentAccess(req.auth!.userId, initial.meetingId);
    assert(
      initial.userId === req.auth!.userId && initial.kind === 'audio',
      403,
      'FORBIDDEN',
      'Only the uploader can complete this upload',
    );
    const result = await rt.coordinator.lock(`meeting:${initial.meetingId}`, () =>
      rt.coordinator.lock(`asset:${assetId}`, async () => {
        await contentAccess(req.auth!.userId, initial.meetingId);
        const asset = await Asset.findById(assetId);
        assert(
          asset && ['pending', 'ready'].includes(asset.status),
          409,
          'ASSET_STATE',
          'Upload is unavailable',
        );
        await ensureProcessing(asset.meetingId, 'ai');
        if (asset.status === 'pending') {
          assert(
            asset.expiresAt && asset.expiresAt > new Date(),
            410,
            'UPLOAD_EXPIRED',
            'Upload has expired',
          );
          const meta = await rt.storage.inspect(asset.key);
          assert(
            meta.size === asset.size &&
              meta.contentType === asset.contentType &&
              validAudio(meta.contentType, meta.prefix),
            400,
            'INVALID_UPLOAD',
            'Uploaded audio does not match its declared type or size',
          );
          const key = `${asset.workspaceId}/${asset.meetingId}/${asset._id}.audio`;
          const pendingKey = asset.key;
          await rt.storage.seal(asset.key, key, meta.etag);
          asset.key = key;
          asset.status = 'ready';
          asset.expiresAt = undefined;
          await asset.save();
          await rt.storage
            .delete(pendingKey)
            .catch(() =>
              rt.logger.warn({ assetId: asset._id }, 'Staging object awaits lifecycle cleanup'),
            );
        }
        const job = await JobRecord.findOne({ assetId, kind: 'transcribe' });
        return {
          asset,
          job:
            job ??
            (await requestJob(rt, {
              workspaceId: asset.workspaceId,
              meetingId: asset.meetingId,
              requestedBy: req.auth!.userId,
              kind: 'transcribe',
              assetId,
            })),
        };
      }),
    );
    res.status(202).json(result);
  });
  router.get('/meetings/:meetingId/assets', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await contentAccess(req.auth!.userId, meetingId);
    res.json({
      assets: await Asset.find({ meetingId, status: 'ready' })
        .select('-key')
        .sort({ createdAt: -1 })
        .limit(100),
    });
  });
  router.get('/assets/:assetId/download', async (req, res) => {
    const asset = await Asset.findOne({ _id: param(req, 'assetId'), status: 'ready' });
    assert(asset, 404, 'NOT_FOUND', 'Asset not found');
    await contentAccess(req.auth!.userId, asset.meetingId);
    res.setHeader('Cache-Control', 'no-store');
    await audit(req, 'asset.downloaded', asset._id, asset.workspaceId);
    res.json({ url: await rt.storage.downloadUrl(asset.key), expiresIn: 60 });
  });
  router.delete('/assets/:assetId', async (req, res) => {
    const initial = await Asset.findById(param(req, 'assetId'));
    assert(initial, 404, 'NOT_FOUND', 'Asset not found');
    await rt.coordinator.lock(`meeting:${initial.meetingId}`, () =>
      rt.coordinator.lock(`asset:${initial._id}`, async () => {
        const { meeting } = await hostAccess(rt, req.auth!, initial.meetingId);
        const asset = await Asset.findById(initial._id);
        assert(asset, 404, 'NOT_FOUND', 'Asset not found');
        assert(
          meeting.recordingAssetId !== asset._id || meeting.recordingState === 'idle',
          409,
          'RECORDING_ACTIVE',
          'Stop recording and wait for completion before deleting the object',
        );
        if (asset.status === 'deleted') return;
        asset.status = 'deleting';
        await asset.save();
        await rt.storage.delete(asset.key);
        asset.status = 'deleted';
        await asset.save();
        await audit(req, 'asset.deleted', asset._id, asset.workspaceId);
      }),
    );
    res.status(204).end();
  });
  return router;
}
