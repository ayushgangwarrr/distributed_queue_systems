/**
 * src/monitoring/wsServer.js
 *
 * WebSocket streaming server that broadcasts queue events and worker heartbeats
 * to connected dashboard clients in real time.
 */

const { WebSocketServer } = require('ws');
const eventBus = require('../events/eventBus');
const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');

const priorityQueue = new PriorityQueue(redis);

/**
 * Creates and initializes the WebSocket monitoring server.
 *
 * @param {Object} [options]
 * @param {number} [options.port=4000]
 * @returns {WebSocketServer}
 */
function createMonitoringServer(options = {}) {
  const port = options.port || parseInt(process.env.WS_PORT || '4000', 10);
  const wss = new WebSocketServer({ port });

  // In-memory worker heartbeat tracking
  const knownWorkers = new Map();

  /**
   * Helper to format active workers list and detect offline workers (>15s timeout).
   * @returns {Array<Object>}
   */
  function getWorkersList() {
    const now = Date.now();
    const list = [];
    for (const [id, info] of knownWorkers.entries()) {
      const isOffline = now - info.lastSeen > 15000;
      list.push({
        workerId: id,
        status: isOffline ? 'offline' : info.status,
        currentJobId: isOffline ? null : info.currentJobId,
        lastSeen: info.lastSeen,
        lastSeenSecondsAgo: Math.round((now - info.lastSeen) / 1000),
      });
    }
    return list;
  }

  // Subscribe to Redis Pub/Sub events
  eventBus.subscribe((message) => {
    const { event, payload, timestamp } = message;

    // Track worker heartbeats & state transitions
    if (event === 'worker:heartbeat' && payload.workerId) {
      knownWorkers.set(payload.workerId, {
        workerId: payload.workerId,
        status: payload.status || 'idle',
        currentJobId: payload.currentJobId || null,
        lastSeen: timestamp || Date.now(),
      });
    } else if (event === 'job:started' && payload.workerId) {
      const existing = knownWorkers.get(payload.workerId);
      if (existing) {
        existing.status = 'processing';
        existing.currentJobId = payload.jobId;
        existing.lastSeen = timestamp || Date.now();
      }
    } else if (
      (event === 'job:completed' || event === 'job:failed' || event === 'job:dead-lettered') &&
      payload.workerId
    ) {
      const existing = knownWorkers.get(payload.workerId);
      if (existing) {
        existing.status = 'idle';
        existing.currentJobId = null;
        existing.lastSeen = timestamp || Date.now();
      }
    }

    // Broadcast event to all connected dashboard clients
    const rawBroadcast = JSON.stringify(message);
    for (const client of wss.clients) {
      if (client.readyState === 1 /* OPEN */) {
        client.send(rawBroadcast);
      }
    }
  });

  // Handle client connections
  wss.on('connection', async (ws, req) => {
    const clientIp = req.socket.remoteAddress;

    // Send initial snapshot to newly connected client
    try {
      const stats = await priorityQueue.getStats();
      const snapshot = {
        type: 'snapshot',
        event: 'system:snapshot',
        stats,
        workers: getWorkersList(),
        timestamp: Date.now(),
      };
      ws.send(JSON.stringify(snapshot));
    } catch (err) {
      console.warn('[WSS] Failed to generate initial snapshot:', err.message);
    }
  });

  // Periodic heartbeat broadcast (every 2 seconds) to keep clients in sync
  const syncInterval = setInterval(async () => {
    if (wss.clients.size === 0) return;
    try {
      const stats = await priorityQueue.getStats();
      const syncMessage = JSON.stringify({
        event: 'system:stats',
        payload: {
          stats,
          workers: getWorkersList(),
        },
        timestamp: Date.now(),
      });

      for (const client of wss.clients) {
        if (client.readyState === 1) {
          client.send(syncMessage);
        }
      }
    } catch {
      // Ignore background sync errors
    }
  }, 2000);

  wss.on('close', () => {
    clearInterval(syncInterval);
  });

  return wss;
}

module.exports = {
  createMonitoringServer,
};
