/**
 * src/monitoring/runMonitoringServer.js
 *
 * Standalone entrypoint for the WebSocket monitoring server.
 * Streams real-time job and worker events to dashboard clients.
 *
 * Run via: node src/monitoring/runMonitoringServer.js
 */

const { createMonitoringServer } = require('./wsServer');
const redis = require('../config/redis');

const PORT = parseInt(process.env.WS_PORT || '4000', 10);

const wss = createMonitoringServer({ port: PORT });

console.log('===============================================================');
console.log(`      WEBSOCKET MONITORING SERVER RUNNING ON PORT ${PORT}      `);
console.log('===============================================================');
console.log(`[WSS] Live stream active at ws://localhost:${PORT}`);
console.log('[WSS] Broadcasting queue depth, worker heartbeats, and lifecycle events.\n');

// Handle graceful shutdown
let isShuttingDown = false;
async function handleShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;

  console.log(`\n[WSS] Received ${signal}. Closing WebSocket server...`);
  wss.close(async () => {
    try {
      await redis.quit();
      console.log('[WSS] Closed cleanly. Process exiting.');
      process.exit(0);
    } catch (err) {
      console.error('[WSS] Error during shutdown:', err);
      process.exit(1);
    }
  });

  setTimeout(() => {
    console.error('[WSS] Shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 5000).unref();
}

process.on('SIGINT', () => handleShutdown('SIGINT'));
process.on('SIGTERM', () => handleShutdown('SIGTERM'));
