import { Router } from 'express';
import { z } from 'zod';
import { Message, Note } from './db.js';
import { assert, body, pagination, param, text, uuid } from './lib.js';
import { admitted, contentAccess, validateMembers } from './policy.js';
import { requireAuth } from './auth.js';
import type { Runtime } from './ports.js';
import { notify } from './workspaces.js';

export const messageInput = z
  .object({ clientId: uuid, text: text(8000), mentions: z.array(uuid).max(20).default([]) })
  .strict();
export const noteInput = z
  .object({ text: z.string().max(100000), revision: z.number().int().min(0) })
  .strict();
export async function sendMessage(rt: Runtime, userId: string, meetingId: string, raw: unknown) {
  return rt.coordinator.lock(`meeting:${meetingId}`, () =>
    sendMessageLocked(rt, userId, meetingId, raw),
  );
}
async function sendMessageLocked(rt: Runtime, userId: string, meetingId: string, raw: unknown) {
  const input = messageInput.parse(raw);
  const { meeting } = await admitted(userId, meetingId);
  await validateMembers(meeting.workspaceId, input.mentions);
  assert(
    await rt.coordinator.consume(`chat:${userId}:${meetingId}`, 60, 60),
    429,
    'RATE_LIMITED',
    'Message limit reached',
  );
  // Unique clientId makes HTTP/socket retries idempotent.
  const existing = await Message.findOne({ meetingId, userId, clientId: input.clientId });
  if (existing) return existing;
  let message;
  try {
    message = await Message.create({
      ...input,
      workspaceId: meeting.workspaceId,
      meetingId,
      userId,
    });
  } catch (err) {
    const duplicate = await Message.findOne({ meetingId, userId, clientId: input.clientId });
    if (duplicate) return duplicate;
    throw err;
  }
  rt.events.emit(`meeting:${meetingId}`, 'message.created', message.toObject());
  for (const target of input.mentions) {
    // A mention must not disclose a private meeting to a workspace member outside it.
    try {
      await contentAccess(target, meetingId);
      await notify(
        rt,
        meeting.workspaceId,
        target,
        'message.mention',
        'You were mentioned in a meeting',
        meetingId,
      );
    } catch {
      /* inaccessible mentions receive no notification */
    }
  }
  return message;
}
export async function updateNote(rt: Runtime, userId: string, meetingId: string, raw: unknown) {
  return rt.coordinator.lock(`meeting:${meetingId}`, () =>
    updateNoteLocked(rt, userId, meetingId, raw),
  );
}
async function updateNoteLocked(rt: Runtime, userId: string, meetingId: string, raw: unknown) {
  const input = noteInput.parse(raw);
  const { meeting } = await contentAccess(userId, meetingId);
  assert(
    meeting.status === 'live' || meeting.status === 'ended',
    409,
    'MEETING_STATE',
    'Meeting notes are unavailable',
  );
  if (meeting.status === 'live') await admitted(userId, meetingId);
  // Optimistic concurrency keeps independent editors from silently overwriting each other.
  await Note.updateOne(
    { meetingId },
    {
      $setOnInsert: { workspaceId: meeting.workspaceId, updatedBy: userId, text: '', revision: 0 },
    },
    { upsert: true },
  );
  const note = await Note.findOneAndUpdate(
    { meetingId, revision: input.revision },
    { $set: { text: input.text, updatedBy: userId }, $inc: { revision: 1 } },
    { returnDocument: 'after' },
  );
  assert(
    note,
    409,
    'VERSION_CONFLICT',
    'Notes changed; fetch the latest revision and merge your edits',
  );
  rt.events.emit(`meeting:${meetingId}`, 'note.updated', note.toObject());
  return note;
}
export function collaborationRoutes(rt: Runtime) {
  const router = Router();
  router.use(requireAuth(rt));
  router.get('/meetings/:meetingId/messages', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await contentAccess(req.auth!.userId, meetingId);
    const input = pagination
      .extend({ afterId: uuid.optional(), beforeId: uuid.optional() })
      .parse(req.query);
    assert(!(input.afterId && input.beforeId), 400, 'INVALID_CURSOR', 'Use one cursor direction');
    const reference =
      input.afterId || input.beforeId
        ? await Message.findOne({ _id: input.afterId ?? input.beforeId, meetingId })
        : null;
    if (input.afterId || input.beforeId)
      assert(reference, 400, 'INVALID_CURSOR', 'Cursor is not from this meeting');
    const op = input.afterId ? '$gt' : '$lt';
    const cursor = reference
      ? {
          $or: [
            { createdAt: { [op]: reference.createdAt } },
            { createdAt: reference.createdAt, _id: { [op]: reference._id } },
          ],
        }
      : input.before
        ? { createdAt: { $lt: new Date(input.before) } }
        : {};
    const messages = await Message.find({ meetingId, ...cursor })
      .sort({ createdAt: input.afterId ? 1 : -1, _id: input.afterId ? 1 : -1 })
      .limit(input.limit);
    res.json({ messages, nextCursor: messages.at(-1)?._id ?? null });
  });
  router.post('/meetings/:meetingId/messages', async (req, res) => {
    res.status(201).json({
      message: await sendMessage(rt, req.auth!.userId, param(req, 'meetingId'), req.body),
    });
  });
  router.delete('/meetings/:meetingId/messages/:messageId', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    const { meeting, member } = await contentAccess(req.auth!.userId, meetingId);
    const message = await Message.findOne({ _id: param(req, 'messageId'), meetingId });
    assert(message, 404, 'NOT_FOUND', 'Message not found');
    assert(
      message.userId === req.auth!.userId ||
        meeting.hostId === req.auth!.userId ||
        member.role !== 'member',
      403,
      'FORBIDDEN',
      'Only the author or moderator can delete this message',
    );
    message.text = '[deleted]';
    message.mentions = [];
    message.deletedAt = new Date();
    await message.save();
    rt.events.emit(`meeting:${meetingId}`, 'message.deleted', { id: message._id });
    res.status(204).end();
  });
  router.get('/meetings/:meetingId/notes', async (req, res) => {
    const meetingId = param(req, 'meetingId');
    await contentAccess(req.auth!.userId, meetingId);
    res.json({ note: (await Note.findOne({ meetingId })) ?? { meetingId, text: '', revision: 0 } });
  });
  router.put('/meetings/:meetingId/notes', async (req, res) => {
    res.json({
      note: await updateNote(rt, req.auth!.userId, param(req, 'meetingId'), body(noteInput, req)),
    });
  });
  return router;
}
