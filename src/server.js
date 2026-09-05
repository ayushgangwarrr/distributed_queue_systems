/**
 * src/server.js
 *
 * Standalone Express HTTP REST API Server.
 * Pure API layer — workers and reaper run as independent, separate processes.
 *
 * Example curl commands:
 *   Submit job:
 *     curl -X POST http://localhost:3000/jobs -H 'Content-Type: application/json' \
 *       -d '{"type":"demo-task","data":{"task":"send_report"},"priority":8}'
 *   Check job:
 *     curl http://localhost:3000/jobs/<JOB_ID>
 *   List jobs:
 *     curl http://localhost:3000/jobs?limit=10
 *   Check stats:
 *     curl http://localhost:3000/queues/stats
 *   Health check:
 *     curl http://localhost:3000/health
 *   Cancel pending job:
 *     curl -X DELETE http://localhost:3000/jobs/<JOB_ID>
 *   List DLQ:
 *     curl http://localhost:3000/dlq
 *   Retry dead job:
 *     curl -X POST http://localhost:3000/dlq/<JOB_ID>/retry
 *   Purge DLQ job:
 *     curl -X DELETE http://localhost:3000/dlq/<JOB_ID>
 */

const app = require('./app');
const redis = require('./config/redis');

const PORT = parseInt(process.env.PORT || '3000', 10);

const server = app.listen(PORT, () => {
  console.log('===============================================================');
  console.log(`        DISTRIBUTED QUEUE API SERVER RUNNING ON PORT ${PORT}       `);
  console.log('===============================================================');
  console.log(`[HTTP Server] Listening on http://localhost:${PORT}`);
  console.log('[HTTP Server] Note: Standalone workers and reaper run separately.');
  console.log('  - Start Worker: npm run worker (or WORKER_ID=worker-1 node src/workers/runWorker.js)');
  console.log('  - Start Reaper: npm run reaper (or node src/recovery/runReaper.js)\n');
});

// Graceful shutdown handling
let isShuttingDown = false;
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[Server] Received ${signal}. Gracefully stopping HTTP server...`);

  // Stop accepting new HTTP requests
  server.close(async () => {
    console.log('[Server] HTTP server stopped accepting connections.');
    try {
      // Disconnect Redis
      await redis.quit();
      console.log('[Server] Redis connection closed. Process exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[Server] Error during shutdown:', err);
      process.exit(1);
    }
  });

  // Force exit after 10 seconds if shutdown hangs
  setTimeout(() => {
    console.error('[Server] Shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));

module.exports = server;
