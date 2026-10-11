import { Server } from 'socket.io';
import type { Server as HttpServer } from 'node:http';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Redis } from 'ioredis';
import { z } from 'zod';
import { decodeJwt } from 'jose';
import { authenticate } from './auth.js';
import { contentAccess, hostAccess, membership, admitted } from './policy.js';
import { assert, HttpError, uuid } from './lib.js';
import { sendMessage, updateNote } from './collaboration.js';
import type { Runtime } from './ports.js';
import { Participant } from './db.js';

export async function attachRealtime(server: HttpServer, rt: Runtime, redis?: Redis) {
  const origins = rt.config.CORS_ORIGINS.split(',').map((v) => v.trim());
  const io = new Server(server, {
    transports: ['websocket'],
    maxHttpBufferSize: 128000,
    cors: { origin: origins, credentials: true },
    allowRequest: (req, cb) =>
      cb(null, !req.headers.origin || origins.includes(req.headers.origin)),
  });
  let pub: Redis | undefined;
  let sub: Redis | undefined;
  if (redis) {
    pub = redis.duplicate();
    sub = redis.duplicate();
    io.adapter(createAdapter(pub, sub));
  }
  io.use(async (socket, next) => {
    try {
      assert(!rt.config.MAINTENANCE_MODE, 503, 'MAINTENANCE', 'Service is under maintenance');
      const access = z.string().max(4000).parse(socket.handshake.auth.token);
      const auth = await authenticate(rt, access);
      assert(
        await rt.coordinator.consume(`sockets:${auth.userId}`, 30, 60),
        429,
        'RATE_LIMITED',
        'Connection limit reached',
      );
      socket.data = { access, auth };
      next();
    } catch {
      next(new Error('Authentication required'));
    }
  });
  io.on('connection', (socket) => {
    const userId = socket.data.auth.userId as string;
    void socket.join(`user:${userId}`);
    const exp = decodeJwt(socket.data.access).exp!;
    const timer = setTimeout(() => socket.disconnect(true), Math.max(0, exp * 1000 - Date.now()));
    socket.on('disconnect', () => clearTimeout(timer));
    function handle(event: string, fn: (data: unknown) => Promise<unknown>) {
      socket.on(event, async (data, ack) => {
        if (typeof ack !== 'function') return;
        try {
          assert(!rt.config.MAINTENANCE_MODE, 503, 'MAINTENANCE', 'Service is under maintenance');
          socket.data.auth = await authenticate(rt, socket.data.access);
          assert(
            await rt.coordinator.consume(`socket-events:${userId}`, 180, 60),
            429,
            'RATE_LIMITED',
            'Event limit reached',
          );
          const result = await fn(data);
          ack({ ok: true, data: result });
        } catch (err) {
          ack({
            ok: false,
            error: {
              code:
                err instanceof HttpError
                  ? err.code
                  : err instanceof z.ZodError
                    ? 'VALIDATION_ERROR'
                    : 'INTERNAL_ERROR',
              message: err instanceof HttpError ? err.message : 'Event rejected',
            },
          });
        }
      });
    }
    handle('workspace.subscribe', async (data) => {
      const { workspaceId } = z.object({ workspaceId: uuid }).strict().parse(data);
      await membership(userId, workspaceId);
      await socket.join(`workspace:${workspaceId}`);
      return { workspaceId };
    });
    handle('meeting.subscribe', async (data) => {
      const { meetingId } = z.object({ meetingId: uuid }).strict().parse(data);
      const access = await contentAccess(userId, meetingId);
      assert(
        access.meeting.status === 'live' || access.meeting.status === 'ended',
        409,
        'MEETING_STATE',
        'Meeting content subscriptions start with the live meeting',
      );
      if (access.meeting.status === 'live') await admitted(userId, meetingId);
      await socket.join(`meeting:${meetingId}`);
      return { meetingId };
    });
    handle('lobby.subscribe', async (data) => {
      const { meetingId } = z.object({ meetingId: uuid }).strict().parse(data);
      await hostAccess(rt, socket.data.auth, meetingId);
      await socket.join(`lobby:${meetingId}`);
      return { meetingId };
    });
    handle('meeting.unsubscribe', async (data) => {
      const { meetingId } = z.object({ meetingId: uuid }).strict().parse(data);
      await socket.leave(`meeting:${meetingId}`);
      await socket.leave(`lobby:${meetingId}`);
      return {};
    });
    handle('message.send', async (data) => {
      const { meetingId, message } = z
        .object({ meetingId: uuid, message: z.unknown() })
        .strict()
        .parse(data);
      return sendMessage(rt, userId, meetingId, message);
    });
    handle('note.update', async (data) => {
      const { meetingId, note } = z
        .object({ meetingId: uuid, note: z.unknown() })
        .strict()
        .parse(data);
      return updateNote(rt, userId, meetingId, note);
    });
    handle('presence.typing', async (data) => {
      const { meetingId, typing } = z
        .object({ meetingId: uuid, typing: z.boolean() })
        .strict()
        .parse(data);
      await admitted(userId, meetingId);
      socket.to(`meeting:${meetingId}`).emit('presence.typing', { userId, typing });
      return {};
    });
  });
  rt.events = {
    emit(room, event, payload) {
      io.to(room).emit(event, payload);
    },
    async revokeUser(userId) {
      io.in(`user:${userId}`).disconnectSockets(true);
      const participants = await Participant.find({ userId, status: 'admitted' });
      await Participant.updateMany(
        { userId, status: 'admitted' },
        { $set: { status: 'left', leftAt: new Date() } },
      );
      for (const p of participants)
        if (rt.media.configured)
          await rt.media
            .remove(p.meetingId, userId)
            .catch(() =>
              rt.logger.warn(
                { meetingId: p.meetingId },
                'Session media revocation pending reconciliation',
              ),
            );
    },
    async revokeWorkspace(userId, _workspaceId) {
      io.in(`user:${userId}`).disconnectSockets(true);
    },
    async revokeMeeting(userId, meetingId) {
      const sockets = await io.in(`user:${userId}`).fetchSockets();
      for (const socket of sockets) {
        await socket.leave(`meeting:${meetingId}`);
        await socket.leave(`lobby:${meetingId}`);
        socket.emit('meeting.access.revoked', { meetingId });
      }
    },
  };
  return {
    io,
    async close() {
      await new Promise<void>((resolve) => io.close(() => resolve()));
      await pub?.quit();
      await sub?.quit();
    },
  };
}
