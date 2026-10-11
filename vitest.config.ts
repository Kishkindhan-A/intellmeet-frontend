import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { environment: 'node', fileParallelism: false, testTimeout: 60000, hookTimeout: 180000, coverage: { provider: 'v8', include: ['src/**'] } } });
