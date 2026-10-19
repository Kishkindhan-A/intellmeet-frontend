import express from 'express';
import { createServer } from 'node:http';
import { readConfig } from './config.js';
import { connectDatabase, ensureIndexes, mongoose } from './db.js';
import { createRuntime } from './providers.js';
import { createApp } from './app.js';
import { attachRealtime } from './realtime.js';

// Vercel owns the listener. Export the HTTP server so Socket.IO upgrades reach it.
const config = readConfig();
const services = createRuntime(config);
const app = express();
const server = createServer(app);
try {
  await connectDatabase(config.MONGODB_URI);
  await ensureIndexes();
  await services.runtime.coordinator.healthy();
  app.use(createApp(services.runtime));
  await attachRealtime(server, services.runtime, services.redis);
} catch (error) {
  await services.close();
  await mongoose.disconnect();
  throw error;
}

export default server;
