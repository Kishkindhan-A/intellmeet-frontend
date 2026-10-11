import { Worker } from 'bullmq';
import { Emitter } from '@socket.io/redis-emitter';
import { readConfig } from './config.js';
import { connectDatabase, ensureIndexes, mongoose } from './db.js';
import { createRuntime, queueName } from './providers.js';
import { housekeeping, processJob } from './jobs.js';

const config = readConfig();
const services = createRuntime(config);
await connectDatabase(config.MONGODB_URI);
await ensureIndexes();
const emitter = new Emitter(services.redis);
services.runtime.events.emit = (room, event, payload) => {
  emitter.to(room).emit(event, payload);
};
const workerRedis = services.redis.duplicate({ maxRetriesPerRequest: null });
const worker = new Worker(queueName, async (job) => processJob(services.runtime, job.data.id), {
  connection: workerRedis,
  concurrency: 3,
  lockDuration: 180000,
});
worker.on('error', (err) => services.runtime.logger.error({ error: err.message }, 'Worker error'));
worker.on('failed', (job) =>
  services.runtime.logger.warn({ jobId: job?.id }, 'Job failed; retry policy applies'),
);
let busy = false;
async function maintain() {
  if (busy) return;
  busy = true;
  try {
    await housekeeping(services.runtime);
    await services.redis.set('intellmeet:worker:heartbeat', String(Date.now()), 'EX', 120);
  } catch (err) {
    services.runtime.logger.error(
      { error: err instanceof Error ? err.message : 'unknown' },
      'Worker maintenance failed',
    );
  } finally {
    busy = false;
  }
}
await maintain();
const interval = setInterval(() => {
  void maintain();
}, 30000);
services.runtime.logger.info('IntellMeet worker started');
let closing = false;
async function shutdown() {
  if (closing) return;
  closing = true;
  clearInterval(interval);
  await worker.close();
  await workerRedis.quit();
  await services.close();
  await mongoose.disconnect();
}
process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
