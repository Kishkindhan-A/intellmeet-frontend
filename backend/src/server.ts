import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { connectDatabase, ensureIndexes, mongoose } from './db.js';
import { createRuntime } from './providers.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

const config = readConfig();
const services = createRuntime(config);
try {
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  await services.runtime.coordinator.healthy();
  const server = createServer(createApp(services.runtime));
  server.requestTimeout = 30000;
  server.headersTimeout = 15000;
  server.keepAliveTimeout = 5000;
  const realtime = await attachRealtime(server, services.runtime, services.redis);
  server.listen(config.PORT, config.BIND_ADDRESS, () =>
    services.runtime.logger.info({ port: config.PORT }, 'IntellMeet API listening'),
  );
  let closing = false;
  async function shutdown() {
    if (closing) return;
    closing = true;
    services.runtime.logger.info('Shutting down API');
    const deadline = setTimeout(() => process.exit(1), 15000);
    deadline.unref();
    await realtime.close();
    await services.close();
    await mongoose.disconnect();
    clearTimeout(deadline);
  }
  process.on('SIGTERM', () => {
    void shutdown();
  });
  process.on('SIGINT', () => {
    void shutdown();
  });
} catch (err) {
  services.runtime.logger.fatal({ err }, 'API startup failed');
  await services.close();
  await mongoose.disconnect();
  process.exitCode = 1;
}
