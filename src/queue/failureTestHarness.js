/**
 * src/queue/failureTestHarness.js
 *
 * Standalone verification script demonstrating failure injection, exponential backoff,
 * automatic retries, and Dead Letter Queue (DLQ) arrival.
 *
 * Test Scenario:
 * 1. Enqueues one 'flaky-task' job (maxRetries: 4, failUntilAttempt: 2):
 *    - Fails on attempt #1 (retryCount: 0 -> 1)
 *    - Backoff delay ~2s
 *    - Fails on attempt #2 (retryCount: 1 -> 2)
 *    - Backoff delay ~4s
 *    - Succeeds on attempt #3 (retryCount: 2 -> completed)
 * 2. Enqueues one 'always-fails' job (maxRetries: 3):
 *    - Fails on attempt #1 (delay ~2s)
 *    - Fails on attempt #2 (delay ~4s)
 *    - Fails on attempt #3 (delay ~8s)
 *    - Terminal transition to DLQ (status: 'dead')
 *
 * Run via: node src/queue/failureTestHarness.js
 */

const redis = require('../config/redis');
const PriorityQueue = require('./priorityQueue');
const Worker = require('../workers/worker');
// Ensure handlers are registered
require('../workers/handlerRegistry');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function runFailureHarness() {
  console.log('===============================================================');
  console.log('       FAILURE INJECTION & BACKOFF VERIFICATION HARNESS       ');
  console.log('===============================================================\n');

  const queue = new PriorityQueue(redis);

  // Clean prior queue state
  const keys = await redis.keys('queue:*');
  const jobKeys = await redis.keys('job:*');
  const allKeys = [...keys, ...jobKeys];
  if (allKeys.length > 0) {
    await redis.del(...allKeys);
  }

  // 1. Start worker and periodic delay promoter in this process
  console.log('[Setup] Initializing test worker and delayed job promotion scheduler...');
  const worker = new Worker('failure-harness-worker', queue, 250);
  worker.start();

  // Run promotion loop every 250ms to move expired delayed jobs back to pending
  const promoteInterval = setInterval(async () => {
    try {
      await queue.promoteDelayedJobs();
    } catch {
      // ignore in background
    }
  }, 250);

  // 2. Enqueue test jobs
  console.log('\n--- STEP 1: Enqueuing Failure Test Jobs ---');

  const startTime = Date.now();

  const flakyJobId = await queue.enqueue({
    type: 'flaky-task',
    data: { taskName: 'Flaky Payment Verification', failUntilAttempt: 2 },
    priority: 8,
    maxRetries: 4,
  });
  console.log(`  [Enqueued] Flaky Job ID:       ${flakyJobId} (maxRetries: 4, failUntilAttempt: 2)`);

  const alwaysFailsJobId = await queue.enqueue({
    type: 'always-fails',
    data: { taskName: 'Unrecoverable External Service Failure' },
    priority: 5,
    maxRetries: 3,
  });
  console.log(`  [Enqueued] Always-Fails Job ID: ${alwaysFailsJobId} (maxRetries: 3)\n`);

  // 3. Poll every 500ms to monitor state transitions
  console.log('--- STEP 2: Monitoring Lifecycle & Retries Over Time ---');
  console.log('Timestamp  | Job Type     | Status     | RetryCount | Notes');
  console.log('-----------|--------------|------------|------------|-----------------------------------------');

  let flakyLastState = '';
  let alwaysLastState = '';

  const jobHistory = {
    [flakyJobId]: [],
    [alwaysFailsJobId]: [],
  };

  const timeoutMs = 60000; // 60s safety timeout

  while (Date.now() - startTime < timeoutMs) {
    const flakyJob = await queue.getJob(flakyJobId);
    const alwaysJob = await queue.getJob(alwaysFailsJobId);

    const elapsedSec = ((Date.now() - startTime) / 1000).toFixed(1);

    // Track flaky job transitions
    if (flakyJob) {
      const currentState = `${flakyJob.status}:${flakyJob.retryCount}`;
      if (currentState !== flakyLastState) {
        flakyLastState = currentState;
        jobHistory[flakyJobId].push({
          time: Date.now(),
          status: flakyJob.status,
          retryCount: flakyJob.retryCount,
        });
        console.log(
          `T+${elapsedSec.padStart(4, ' ')}s    | flaky-task   | ${flakyJob.status.padEnd(10, ' ')} | ${flakyJob.retryCount}/${flakyJob.maxRetries}        | State transition: status=${flakyJob.status}`
        );
      }
    }

    // Track always-fails job transitions
    if (alwaysJob) {
      const currentState = `${alwaysJob.status}:${alwaysJob.retryCount}`;
      if (currentState !== alwaysLastState) {
        alwaysLastState = currentState;
        jobHistory[alwaysFailsJobId].push({
          time: Date.now(),
          status: alwaysJob.status,
          retryCount: alwaysJob.retryCount,
        });
        console.log(
          `T+${elapsedSec.padStart(4, ' ')}s    | always-fails | ${alwaysJob.status.padEnd(10, ' ')} | ${alwaysJob.retryCount}/${alwaysJob.maxRetries}        | State transition: status=${alwaysJob.status}`
        );
      }
    }

    // Check terminal condition: flaky completed and always-fails dead
    if (flakyJob?.status === 'completed' && alwaysJob?.status === 'dead') {
      console.log(`\n[Harness] Both jobs reached terminal states at T+${elapsedSec}s!\n`);
      break;
    }

    await sleep(500);
  }

  // 4. Stop background services
  clearInterval(promoteInterval);
  await worker.stop();

  // 5. Query final job states
  const finalFlaky = await queue.getJob(flakyJobId);
  const finalAlways = await queue.getJob(alwaysFailsJobId);

  // 6. Print Summary Table
  console.log('===============================================================');
  console.log('                     SUMMARY OF RESULTS                        ');
  console.log('===============================================================');

  const summary = [
    {
      jobId: flakyJobId.slice(0, 8) + '...',
      type: finalFlaky.type,
      finalStatus: finalFlaky.status,
      totalAttempts: finalFlaky.retryCount + 1,
      maxRetries: finalFlaky.maxRetries,
      recordedErrors: finalFlaky.errors.length,
    },
    {
      jobId: alwaysFailsJobId.slice(0, 8) + '...',
      type: finalAlways.type,
      finalStatus: finalAlways.status,
      totalAttempts: finalAlways.retryCount + 1,
      maxRetries: finalAlways.maxRetries,
      recordedErrors: finalAlways.errors.length,
    },
  ];
  console.table(summary);

  // 7. Backoff Delays Analysis
  console.log('\n--- Observed Exponential Backoff Delays ---');
  console.log('\n[flaky-task Error History & Intervals]:');
  finalFlaky.errors.forEach((err, idx) => {
    const ts = err.timestamp ? new Date(err.timestamp).toISOString() : 'N/A';
    let delayStr = '';
    if (idx > 0 && err.timestamp && finalFlaky.errors[idx - 1].timestamp) {
      const diffMs = err.timestamp - finalFlaky.errors[idx - 1].timestamp;
      delayStr = ` (Interval since last attempt: ${diffMs}ms ~ ${Math.round(diffMs / 1000)}s)`;
    }
    console.log(`  Attempt #${idx + 1}: ${ts} - "${err.message}"${delayStr}`);
  });
  console.log(`  Attempt #3: Succeeded and transitioned to status 'completed'.`);

  console.log('\n[always-fails Error History & Intervals]:');
  finalAlways.errors.forEach((err, idx) => {
    const ts = err.timestamp ? new Date(err.timestamp).toISOString() : 'N/A';
    let delayStr = '';
    if (idx > 0 && err.timestamp && finalAlways.errors[idx - 1].timestamp) {
      const diffMs = err.timestamp - finalAlways.errors[idx - 1].timestamp;
      delayStr = ` (Interval since last attempt: ${diffMs}ms ~ ${Math.round(diffMs / 1000)}s)`;
    }
    console.log(`  Attempt #${idx + 1}: ${ts} - "${err.message}"${delayStr}`);
  });

  // 8. Direct DLQ assertion
  console.log('\n--- Direct Redis DLQ Verification ---');
  const dlqScore = await redis.zscore(queue.DLQ_KEY, alwaysFailsJobId);
  console.log(`  Checking sorted set 'queue:dlq' for ${alwaysFailsJobId}...`);
  console.log(`  DLQ Score (diedAt timestamp): ${dlqScore}`);

  if (dlqScore !== null && finalAlways.status === 'dead') {
    console.log('  [PASS] Always-fails job successfully confirmed present in DLQ!');
  } else {
    console.error('  [FAIL] Always-fails job was NOT found in DLQ!');
  }

  if (finalFlaky.status === 'completed') {
    console.log('  [PASS] Flaky job successfully completed after controlled retries!');
  } else {
    console.error('  [FAIL] Flaky job did not reach completed status!');
  }

  console.log('\n===============================================================');
  console.log('                FAILURE HARNESS COMPLETE                       ');
  console.log('===============================================================');

  await redis.quit();
}

runFailureHarness().catch((err) => {
  console.error('[Fatal Harness Error]:', err);
  process.exit(1);
});
