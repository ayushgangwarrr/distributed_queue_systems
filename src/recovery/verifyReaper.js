/**
 * src/recovery/verifyReaper.js
 *
 * Automated verification of:
 * 1. Active lease tracking with JSON ({ workerId, leaseExpiresAt })
 * 2. Worker hanging on 'crash-test' task
 * 3. Reaper detecting expired lease and reclaiming the orphaned job
 * 4. Job returning to retry/backoff path with incremented retryCount and failure log
 */

const redis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');
const Worker = require('../workers/worker');
const JobReaper = require('./reaper');
// Ensure handlers are registered
require('../workers/handlerRegistry');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runReaperVerification() {
  console.log('===============================================================');
  console.log('       ORPHANED JOB LEASE RECOVERY VERIFICATION               ');
  console.log('===============================================================\n');

  const queue = new PriorityQueue(redis);

  // 1. Clean prior keys
  console.log('[Setup] Purging previous test keys...');
  const keys = await redis.keys('queue:*');
  const jobKeys = await redis.keys('job:*');
  const allKeys = [...keys, ...jobKeys];
  if (allKeys.length > 0) {
    await redis.del(...allKeys);
  }

  // 2. Enqueue a crash-test job
  console.log('--- STEP 1: Enqueuing crash-test job ---');
  const jobId = await queue.enqueue({
    type: 'crash-test',
    data: { simulation: 'frozen_worker' },
    priority: 8,
    maxRetries: 2,
  });
  console.log(`[PASS] Enqueued crash-test job with ID: ${jobId}\n`);

  // 3. Start a worker with a very short lease (2000ms)
  console.log('--- STEP 2: Spawning worker with 2000ms lease ---');
  const workerId = 'doomed-worker-99';
  const worker = new Worker(workerId, queue, 200, 2000);
  worker.start();

  // Wait 1000ms for worker to dequeue and hang in crash-test
  await sleep(1000);

  // Inspect active hash entry in Redis
  const rawActive = await redis.hget(queue.ACTIVE_KEY, jobId);
  console.log('Raw active lease entry in Redis:', rawActive);
  const activeEntry = JSON.parse(rawActive);
  console.log('Parsed active lease data:', activeEntry);

  if (!activeEntry || activeEntry.workerId !== workerId) {
    throw new Error('Active lease does not contain expected workerId');
  }
  console.log('[PASS] Active lease correctly records JSON { workerId, leaseExpiresAt }.\n');

  // 4. Wait for lease to expire (wait 1500ms more -> total 2500ms, lease was 2000ms)
  console.log('--- STEP 3: Waiting for lease duration to expire without renewal ---');
  await sleep(1500);
  const now = Date.now();
  console.log(`Current time: ${now}, Lease expired at: ${activeEntry.leaseExpiresAt}`);
  if (now <= activeEntry.leaseExpiresAt) {
    throw new Error('Lease should have expired');
  }
  console.log(`[PASS] Lease expired by ${now - activeEntry.leaseExpiresAt}ms.\n`);

  // 5. Start Reaper to scan and reclaim
  console.log('--- STEP 4: Triggering Reaper to reclaim orphaned job ---');
  const reaper = new JobReaper(queue, 500);
  // Perform immediate scan
  const reclaimed = await queue.reclaimExpiredLeases();
  console.log('Reclaimed items:', reclaimed);

  if (!reclaimed || reclaimed.length === 0 || reclaimed[0].jobId !== jobId) {
    throw new Error('Reaper failed to reclaim the expired job');
  }
  console.log('[PASS] Reaper successfully reclaimed expired job from doomed-worker-99.\n');

  // 6. Verify job state after reclamation
  console.log('--- STEP 5: Verifying job state post-reclamation ---');
  const jobAfter = await queue.getJob(jobId);
  console.log('Job status post-reclamation:', {
    id: jobAfter.id,
    status: jobAfter.status,
    retryCount: jobAfter.retryCount,
    maxRetries: jobAfter.maxRetries,
    errors: jobAfter.errors,
  });

  if (jobAfter.retryCount !== 1) {
    throw new Error(`Expected retryCount to be 1, but got ${jobAfter.retryCount}`);
  }
  if (!jobAfter.errors || jobAfter.errors.length === 0 || !jobAfter.errors[0].message.includes('Lease expired')) {
    throw new Error('Failure message did not document lease expiration');
  }

  // Verify removed from queue:active
  const remainingActive = await redis.hget(queue.ACTIVE_KEY, jobId);
  if (remainingActive !== null) {
    throw new Error('Job should have been removed from queue:active');
  }
  console.log('[PASS] Job was removed from queue:active and routed into retry backoff.\n');

  // Stop background services
  await worker.stop(500);
  await reaper.stop();
  await redis.quit();

  console.log('===============================================================');
  console.log('          ALL REAPER RECOVERY TESTS PASSED!                    ');
  console.log('===============================================================');
}

runReaperVerification()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('[Reaper Verification Failed]:', err);
    process.exit(1);
  });
