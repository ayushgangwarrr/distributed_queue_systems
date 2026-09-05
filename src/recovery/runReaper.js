/**
 * src/recovery/runReaper.js
 *
 * Standalone entrypoint for the JobReaper process.
 * Reclaims expired leases from orphaned or crashed workers.
 *
 * Run via: node src/recovery/runReaper.js
 */

const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');
const JobReaper = require('./reaper');

const intervalMs = parseInt(process.env.REAPER_INTERVAL_MS || '5000', 10);
const queue = new PriorityQueue(redis);
const reaper = new JobReaper(queue, intervalMs);

console.log('===============================================================');
console.log('             ORPHANED JOB REAPER PROCESS                       ');
console.log('===============================================================');

reaper.start();

// Handle graceful shutdown
let isShuttingDown = false;
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Reaper Process] Received ${signal}. Initiating shutdown...`);
  try {
    await reaper.stop();
    await redis.quit();
    console.log('[Reaper Process] Clean shutdown complete. Exiting.');
    process.exit(0);
  } catch (err) {
    console.error('[Reaper Process] Error during shutdown:', err);
    process.exit(1);
  }
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
