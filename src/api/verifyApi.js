/**
 * src/api/verifyApi.js
 *
 * Automated verification of the REST API endpoints.
 */

const http = require('http');
const app = require('../app');
const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');

const queue = new PriorityQueue(redis);

// Helper to make HTTP requests against the Express app
function request(server, method, path, body = null) {
  return new Promise((resolve, reject) => {
    const port = server.address().port;
    const options = {
      hostname: '127.0.0.1',
      port,
      path,
      method,
      headers: {
        'Content-Type': 'application/json',
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, headers: res.headers, body: parsed });
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function runApiTests() {
  console.log('===============================================================');
  console.log('             REST API ENDPOINTS VERIFICATION                   ');
  console.log('===============================================================\n');

  // Start temporary server for testing app.js directly (no background worker yet)
  const server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  console.log(`[Test Server] Listening on http://127.0.0.1:${port}\n`);

  try {
    // 1. GET /health
    console.log('--- TEST 1: GET /health ---');
    const healthRes = await request(server, 'GET', '/health');
    console.log('Status:', healthRes.status, '| Body:', healthRes.body);
    if (healthRes.status !== 200 || healthRes.body.redis !== 'connected') {
      throw new Error('Health check failed');
    }
    console.log('[PASS] Health check working.\n');

    // 2. GET /queues/stats
    console.log('--- TEST 2: GET /queues/stats ---');
    const statsRes = await request(server, 'GET', '/queues/stats');
    console.log('Status:', statsRes.status, '| Body:', statsRes.body);
    if (statsRes.status !== 200 || typeof statsRes.body.pending !== 'number') {
      throw new Error('Stats check failed');
    }
    console.log('[PASS] Queue stats working.\n');

    // 3. POST /jobs - Validation failure (missing type & data, invalid priority)
    console.log('--- TEST 3: POST /jobs - Validation Error Handling ---');
    const invalidJobRes = await request(server, 'POST', '/jobs', { priority: 25 });
    console.log('Status:', invalidJobRes.status, '| Body:', JSON.stringify(invalidJobRes.body));
    if (invalidJobRes.status !== 400 || !invalidJobRes.body.details) {
      throw new Error('Validation error handling failed');
    }
    console.log('[PASS] Zod validation properly rejected invalid payload with 400.\n');

    // 4. POST /jobs - Valid submission
    console.log('--- TEST 4: POST /jobs - Valid Submission ---');
    const validJobRes = await request(server, 'POST', '/jobs', {
      type: 'demo-task',
      data: { invoiceId: 'INV-1001', amount: 500 },
      priority: 8,
      maxRetries: 3,
    });
    console.log('Status:', validJobRes.status, '| Body:', validJobRes.body);
    if (validJobRes.status !== 201 || !validJobRes.body.id || validJobRes.body.status !== 'pending') {
      throw new Error('Valid job creation failed');
    }
    const createdJobId = validJobRes.body.id;
    console.log(`[PASS] Job created with ID: ${createdJobId}\n`);

    // 5. GET /jobs/:id - Valid ID
    console.log(`--- TEST 5: GET /jobs/${createdJobId} ---`);
    const getJobRes = await request(server, 'GET', `/jobs/${createdJobId}`);
    console.log('Status:', getJobRes.status, '| Body:', {
      id: getJobRes.body.id,
      type: getJobRes.body.type,
      priority: getJobRes.body.priority,
      status: getJobRes.body.status,
      data: getJobRes.body.data,
    });
    if (getJobRes.status !== 200 || typeof getJobRes.body.data !== 'object' || getJobRes.body.data.invoiceId !== 'INV-1001') {
      throw new Error('GET /jobs/:id failed or did not parse JSON fields');
    }
    console.log('[PASS] GET /jobs/:id returned full parsed job object.\n');

    // 6. GET /jobs/:id - Non-existent ID
    console.log('--- TEST 6: GET /jobs/non-existent-id (404 Test) ---');
    const notFoundRes = await request(server, 'GET', '/jobs/00000000-0000-0000-0000-000000000000');
    console.log('Status:', notFoundRes.status, '| Body:', notFoundRes.body);
    if (notFoundRes.status !== 404) {
      throw new Error('404 check failed for non-existent job');
    }
    console.log('[PASS] 404 returned for non-existent job.\n');

    // 7. GET /jobs - Pagination & Listing
    console.log('--- TEST 7: GET /jobs?limit=5&offset=0 ---');
    const listRes = await request(server, 'GET', '/jobs?limit=5&offset=0');
    console.log('Status:', listRes.status, '| Total:', listRes.body.total, '| Returned:', listRes.body.jobs.length);
    if (listRes.status !== 200 || !Array.isArray(listRes.body.jobs)) {
      throw new Error('Job listing failed');
    }
    console.log('[PASS] Job listing and pagination working.\n');

    // 8. DELETE /jobs/:id - Cancel Pending Job
    console.log(`--- TEST 8: DELETE /jobs/${createdJobId} (Cancellation of pending job) ---`);
    const cancelRes = await request(server, 'DELETE', `/jobs/${createdJobId}`);
    console.log('Status:', cancelRes.status, '| Body:', cancelRes.body);
    if (cancelRes.status !== 200) {
      throw new Error('Cancellation of pending job failed');
    }
    // Verify deleted
    const verifyCancel = await request(server, 'GET', `/jobs/${createdJobId}`);
    if (verifyCancel.status !== 404) {
      throw new Error('Cancelled job was still found');
    }
    console.log('[PASS] Pending job successfully cancelled.\n');

    // 9. DELETE /jobs/:id - Cancel non-pending job (409 Conflict)
    console.log('--- TEST 9: DELETE /jobs/:id on completed job (409 Conflict) ---');
    // Create a dummy completed job directly in Redis
    const completedJobId = await queue.enqueue({ type: 'demo-task', data: { test: true } });
    await redis.hset(`job:${completedJobId}`, 'status', 'completed');
    await redis.zrem(queue.PENDING_KEY, completedJobId);

    const cancelConflictRes = await request(server, 'DELETE', `/jobs/${completedJobId}`);
    console.log('Status:', cancelConflictRes.status, '| Body:', cancelConflictRes.body);
    if (cancelConflictRes.status !== 409) {
      throw new Error('Expected 409 Conflict when cancelling non-pending job');
    }
    console.log('[PASS] 409 Conflict returned when cancelling completed job.\n');

    // 10. POST /jobs/:id/retry - Dead job retry vs non-dead
    console.log('--- TEST 10: POST /jobs/:id/retry (409 on non-dead job) ---');
    const nonDeadRetryRes = await request(server, 'POST', `/jobs/${completedJobId}/retry`);
    console.log('Status:', nonDeadRetryRes.status, '| Body:', nonDeadRetryRes.body);
    if (nonDeadRetryRes.status !== 409) {
      throw new Error('Expected 409 when retrying non-dead job');
    }

    // 11. GET /dlq - List dead-lettered jobs
    console.log('--- TEST 11: GET /dlq (Listing DLQ jobs) ---');
    const deadJobId = await queue.enqueue({ type: 'always-fails', data: { fail: true } });
    await redis.hset(`job:${deadJobId}`, 'status', 'dead', 'retryCount', '3', 'failedAt', Date.now().toString());
    await redis.zrem(queue.PENDING_KEY, deadJobId);
    await redis.zadd(queue.DLQ_KEY, Date.now(), deadJobId);

    const dlqListRes = await request(server, 'GET', '/dlq?limit=10&offset=0');
    console.log('Status:', dlqListRes.status, '| Total in DLQ:', dlqListRes.body.total);
    if (dlqListRes.status !== 200 || !Array.isArray(dlqListRes.body.jobs) || dlqListRes.body.total < 1) {
      throw new Error('GET /dlq failed');
    }
    console.log('[PASS] GET /dlq returned paginated DLQ jobs list.\n');

    // 12. POST /dlq/:id/retry - Retry from DLQ endpoint
    console.log(`--- TEST 12: POST /dlq/${deadJobId}/retry ---`);
    const dlqRetryRes = await request(server, 'POST', `/dlq/${deadJobId}/retry`);
    console.log('Status:', dlqRetryRes.status, '| Body:', {
      message: dlqRetryRes.body.message,
      source: dlqRetryRes.body.source,
      status: dlqRetryRes.body.job?.status,
      retryCount: dlqRetryRes.body.job?.retryCount,
    });
    if (dlqRetryRes.status !== 200 || dlqRetryRes.body.source !== 'dlq' || dlqRetryRes.body.job?.status !== 'pending') {
      throw new Error('POST /dlq/:id/retry failed');
    }
    console.log('[PASS] POST /dlq/:id/retry successfully re-queued dead job.\n');

    // 13. DELETE /dlq/:id - Purge job from DLQ
    console.log('--- TEST 13: DELETE /dlq/:id (Purge from DLQ) ---');
    // Create another dead job specifically to test purge
    const purgeJobId = await queue.enqueue({ type: 'always-fails', data: { purge: true } });
    await redis.hset(`job:${purgeJobId}`, 'status', 'dead', 'retryCount', '3');
    await redis.zrem(queue.PENDING_KEY, purgeJobId);
    await redis.zadd(queue.DLQ_KEY, Date.now(), purgeJobId);

    const purgeRes = await request(server, 'DELETE', `/dlq/${purgeJobId}`);
    console.log('Status:', purgeRes.status, '| Body:', purgeRes.body);
    if (purgeRes.status !== 200 || purgeRes.body.id !== purgeJobId) {
      throw new Error('DELETE /dlq/:id failed');
    }
    // Verify job hash and DLQ entry are purged
    const checkDlqScore = await redis.zscore(queue.DLQ_KEY, purgeJobId);
    const checkJobHash = await queue.getJob(purgeJobId);
    if (checkDlqScore !== null || checkJobHash !== null) {
      throw new Error('Job was not completely purged from DLQ and Redis');
    }
    console.log('[PASS] DELETE /dlq/:id successfully purged job permanently.\n');

    console.log('===============================================================');
    console.log('                 ALL API TESTS PASSED!                         ');
    console.log('===============================================================');
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await redis.quit();
  }
}

runApiTests().catch((err) => {
  console.error('[Verification Failed]:', err);
  process.exit(1);
});
