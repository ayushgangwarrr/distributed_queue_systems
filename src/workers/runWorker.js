/**
 * src/workers/runWorker.js
 *
 * Standalone worker process runner.
 * Connects to Redis, initializes PriorityQueue, starts a Worker instance,
 * and handles termination signals (SIGINT / SIGTERM) gracefully.
 *
 * Run via: node src/workers/runWorker.js
 */

const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');
const Worker = require('./worker');
// Requiring handlerRegistry ensures 'demo-task' handler is registered
require('./handlerRegistry');

const queue = new PriorityQueue(redis);
const workerId = process.argv[2] || process.env.WORKER_ID || `worker-${process.pid}`;
const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '1000', 10);
const leaseMs = parseInt(process.env.LEASE_MS || '30000', 10);

const worker = new Worker(workerId, queue, pollIntervalMs, leaseMs);

console.log('===============================================================');
console.log(`       WORKER SERVICE RUNNER — ID: ${workerId}       `);
console.log(`       Lease Duration: ${leaseMs}ms | Poll Interval: ${pollIntervalMs}ms`);
console.log('===============================================================');

worker.start();

// Handle termination signals
let isShuttingDown = false;
async function shutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Runner] Received ${signal}. Initiating graceful shutdown...`);
  try {
    await worker.stop();
    await redis.quit();
    console.log('[Runner] Redis connection closed. Exiting process.');
    process.exit(0);
  } catch (err) {
    console.error('[Runner] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
