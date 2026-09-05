/**
 * src/monitoring/verifyMonitoring.js
 *
 * Automated verification of:
 * 1. Redis Pub/Sub eventBus
 * 2. WebSocket monitoring server (streaming snapshots, worker heartbeats, and job events)
 * 3. GET /stats/throughput API endpoint
 * 4. Static dashboard serving at /dashboard
 */

const http = require('http');
const { WebSocket } = require('ws');
const app = require('../app');
const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');
const eventBus = require('../events/eventBus');
const { createMonitoringServer } = require('./wsServer');

const queue = new PriorityQueue(redis);

// Helper for HTTP requests
function request(server, path) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    http.get(`http://127.0.0.1:${port}${path}`, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    }).on('error', reject);
  });
}

async function runMonitoringVerification() {
  console.log('===============================================================');
  console.log('       MONITORING & WEBSOCKET STREAMING VERIFICATION           ');
  console.log('===============================================================\n');

  // Start HTTP API server on random port
  const apiServer = http.createServer(app);
  await new Promise((resolve) => apiServer.listen(0, '127.0.0.1', resolve));
  const apiPort = apiServer.address().port;
  console.log(`[Test API Server] Listening on http://127.0.0.1:${apiPort}`);

  // Start WebSocket monitoring server on random port
  const wsPort = 4055;
  const wss = createMonitoringServer({ port: wsPort });
  console.log(`[Test WebSocket Server] Listening on ws://127.0.0.1:${wsPort}\n`);

  try {
    // 1. Verify GET /dashboard serving
    console.log('--- TEST 1: Static Dashboard Serving (GET /dashboard) ---');
    const dashRes = await request(apiServer, '/dashboard/index.html');
    console.log('Status:', dashRes.status, '| Content length:', typeof dashRes.body === 'string' ? dashRes.body.length : 'N/A');
    if (dashRes.status !== 200 || !dashRes.body.includes('Distributed Queue System')) {
      throw new Error('Static dashboard not served properly');
    }
    console.log('[PASS] Static dashboard served successfully with HTTP 200.\n');

    // 2. Verify GET /stats/throughput API
    console.log('--- TEST 2: GET /stats/throughput ---');
    const tpRes = await request(apiServer, '/stats/throughput?windowMinutes=30');
    console.log('Status:', tpRes.status, '| Response:', tpRes.body);
    if (tpRes.status !== 200 || !Array.isArray(tpRes.body.data)) {
      throw new Error('Throughput API failed');
    }
    console.log('[PASS] GET /stats/throughput returned valid data structure.\n');

    // 3. Verify WebSocket Connection & Snapshot
    console.log('--- TEST 3: WebSocket Connection & Initial Snapshot ---');
    const ws = new WebSocket(`ws://127.0.0.1:${wsPort}`);

    const receivedEvents = [];
    ws.on('message', (raw) => {
      try {
        const msg = JSON.parse(raw);
        receivedEvents.push(msg);
      } catch (err) {
        console.error('WS Parse Error', err);
      }
    });

    await new Promise((resolve, reject) => {
      ws.on('open', resolve);
      ws.on('error', reject);
    });
    console.log('[PASS] WebSocket client connected successfully.');

    // Wait for snapshot
    await new Promise((resolve) => setTimeout(resolve, 300));
    const snapshot = receivedEvents.find((e) => e.type === 'snapshot' || e.event === 'system:snapshot');
    console.log('Received Snapshot:', {
      type: snapshot?.type || snapshot?.event,
      stats: snapshot?.stats,
      workerCount: snapshot?.workers?.length,
    });
    if (!snapshot || !snapshot.stats) {
      throw new Error('Initial snapshot not received over WebSocket');
    }
    console.log('[PASS] Initial queue & worker snapshot received.\n');

    // 4. Verify Live Event Broadcast (worker:heartbeat)
    console.log('--- TEST 4: Live Event Streaming (worker:heartbeat) ---');
    await eventBus.publish('worker:heartbeat', {
      workerId: 'test-runner-worker',
      status: 'idle',
      currentJobId: null,
      timestamp: Date.now(),
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const heartbeatEvt = receivedEvents.find(
      (e) => e.event === 'worker:heartbeat' && e.payload.workerId === 'test-runner-worker'
    );
    console.log('Received Heartbeat Event:', heartbeatEvt);
    if (!heartbeatEvt) {
      throw new Error('worker:heartbeat event not received over WebSocket');
    }
    console.log('[PASS] worker:heartbeat event successfully broadcasted over WebSocket.\n');

    // 5. Verify Live Event Broadcast (job:created)
    console.log('--- TEST 5: Live Event Streaming (job:created) ---');
    const testJobId = await queue.enqueue({
      type: 'demo-task',
      data: { streamTest: true },
      priority: 9,
    });

    await new Promise((resolve) => setTimeout(resolve, 300));
    const jobCreatedEvt = receivedEvents.find(
      (e) => e.event === 'job:created' && e.payload.id === testJobId
    );
    console.log('Received job:created Event:', {
      event: jobCreatedEvt?.event,
      jobId: jobCreatedEvt?.payload?.id,
      priority: jobCreatedEvt?.payload?.priority,
    });
    if (!jobCreatedEvt) {
      throw new Error('job:created event not received over WebSocket');
    }
    console.log('[PASS] job:created event successfully streamed over WebSocket.\n');

    // Close connections
    ws.close();
    console.log('===============================================================');
    console.log('           ALL MONITORING & WS TESTS PASSED!                   ');
    console.log('===============================================================');
  } finally {
    await new Promise((resolve) => apiServer.close(resolve));
    await new Promise((resolve) => wss.close(resolve));
    await redis.quit();
    eventBus.subscriber.disconnect();
  }
}

runMonitoringVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Monitoring Verification Failed]:', err);
    process.exit(1);
  });
