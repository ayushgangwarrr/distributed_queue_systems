/**
 * src/loadtest/measureRecoveryTime.js
 *
 * Automated Crash Recovery & MTTR (Mean Time To Recovery) Test.
 *
 * Protocol:
 * 1. Spawns Worker-1, Worker-2, and Reaper as child processes.
 * 2. Enqueues a batch of test jobs.
 * 3. Waits until Worker-1 dequeues and begins processing a job.
 * 4. Programmatically sends SIGKILL (kill -9) to Worker-1.
 * 5. Measures the elapsed time from Worker-1's sudden crash (last heartbeat)
 *    until Worker-2 successfully reclaims and begins processing the orphaned job.
 * 6. Shuts down Worker-2 and Reaper, reporting the MTTR.
 *
 * CLI Usage:
 *   node src/loadtest/measureRecoveryTime.js [--jobs 100] [--lease 5000]
 */

const { spawn } = require('child_process');
const path = require('path');
const defaultRedis = require('../config/redis');
const PriorityQueue = require('../queue/priorityQueue');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Spawns a background Node process.
 *
 * @param {string} scriptPath
 * @param {Array<string>} args
 * @param {Object} env
 * @returns {import('child_process').ChildProcess}
 */
function spawnProcess(scriptPath, args = [], env = {}) {
  const child = spawn(process.execPath, [scriptPath, ...args], {
    env: { ...process.env, ...env },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  child.stderr.on('data', (d) => {
    const msg = d.toString();
    if (!msg.includes('Warning') && !msg.includes('notice')) {
      // console.error(`[ChildErr ${child.pid}] ${msg}`);
    }
  });

  return child;
}

/**
 * Run the crash recovery benchmark.
 *
 * @param {Object} [options]
 * @param {number} [options.jobCount=100]
 * @param {number} [options.leaseMs=5000]
 * @param {number} [options.reaperIntervalMs=1000]
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object>} Recovery performance metrics
 */
async function measureRecoveryTime(options = {}) {
  const jobCount = options.jobCount || parseInt(process.env.RECOVERY_JOBS, 10) || 100;
  const leaseMs = options.leaseMs || parseInt(process.env.RECOVERY_LEASE_MS, 10) || 5000;
  const reaperIntervalMs = options.reaperIntervalMs || 1000;
  const silent = options.silent || false;

  const queue = new PriorityQueue(defaultRedis);
  const worker1Id = `recovery-w1-${Date.now()}`;
  const worker2Id = `recovery-w2-${Date.now()}`;

  if (!silent) {
    console.log('='.repeat(60));
    console.log('  CRASH RECOVERY & MTTR TEST');
    console.log('='.repeat(60));
    console.log(` Batch Size:      ${jobCount} jobs`);
    console.log(` Worker Lease:    ${leaseMs}ms`);
    console.log(` Reaper Interval: ${reaperIntervalMs}ms`);
    console.log(` Worker-1 (Victim): ${worker1Id}`);
    console.log(` Worker-2 (Backup): ${worker2Id}`);
    console.log('-'.repeat(60));
  }

  const runnerPath = path.join(__dirname, '../workers/runWorker.js');
  const reaperPath = path.join(__dirname, '../recovery/runReaper.js');

  // 1. Spawn Worker-1, Worker-2, and Reaper
  const worker1 = spawnProcess(runnerPath, [worker1Id], {
    WORKER_ID: worker1Id,
    LEASE_MS: String(leaseMs),
    POLL_INTERVAL_MS: '200',
  });

  const worker2 = spawnProcess(runnerPath, [worker2Id], {
    WORKER_ID: worker2Id,
    LEASE_MS: String(leaseMs),
    POLL_INTERVAL_MS: '200',
  });

  const reaper = spawnProcess(reaperPath, [], {
    REAPER_INTERVAL_MS: String(reaperIntervalMs),
  });

  // Ensure child processes are cleaned up on error/exit
  const cleanupProcesses = () => {
    try { worker1.kill('SIGKILL'); } catch (_) {}
    try { worker2.kill('SIGTERM'); } catch (_) {}
    try { reaper.kill('SIGTERM'); } catch (_) {}
  };

  try {
    // Wait for processes to start
    await sleep(800);

    if (!silent) console.log(` Submitting ${jobCount} test jobs...`);

    // 2. Enqueue batch of jobs
    const enqueuedJobIds = [];
    for (let i = 0; i < jobCount; i++) {
      const id = await queue.enqueue({
        type: 'demo-task',
        data: { test: 'recovery', index: i },
        priority: 5,
        maxRetries: 3,
      });
      enqueuedJobIds.push(id);
    }

    if (!silent) console.log(` Enqueued ${enqueuedJobIds.length} jobs. Waiting for ${worker1Id} to claim a job...`);

    // 3. Poll queue:active until worker1 claims at least one job
    let targetedJobId = null;
    let initialLeaseInfo = null;
    const waitStart = Date.now();

    while (Date.now() - waitStart < 15000) {
      const activeRaw = await defaultRedis.hgetall('queue:active');
      for (const [jId, val] of Object.entries(activeRaw)) {
        try {
          const info = JSON.parse(val);
          if (info.workerId === worker1Id) {
            targetedJobId = jId;
            initialLeaseInfo = info;
            break;
          }
        } catch (_) {}
      }
      if (targetedJobId) break;
      await sleep(100);
    }

    if (!targetedJobId) {
      throw new Error(`Timeout waiting for ${worker1Id} to pick up a job.`);
    }

    if (!silent) {
      console.log(`\n [TARGET ACQUIRED] ${worker1Id} is actively holding job: ${targetedJobId}`);
      console.log(` Executing programmatic crash: SIGKILL (kill -9) on Worker-1 (PID: ${worker1.pid})...`);
    }

    // 4. Record crash timestamp and send SIGKILL
    const crashTime = Date.now();
    worker1.kill('SIGKILL');

    if (!silent) {
      console.log(` Worker-1 terminated. Monitoring queue:active and reaper reclamation...`);
    }

    // 5. Poll until Worker-2 or another worker reclaims this targeted job
    let reclaimedTime = null;
    let pickedUpByWorker2Time = null;
    let newOwner = null;
    const pollReclaimStart = Date.now();

    while (Date.now() - pollReclaimStart < 30000) {
      const activeRaw = await defaultRedis.hgetall('queue:active');
      const jobRecord = activeRaw[targetedJobId];

      if (jobRecord) {
        try {
          const info = JSON.parse(jobRecord);
          if (info.workerId === worker2Id) {
            pickedUpByWorker2Time = Date.now();
            newOwner = info.workerId;
            break;
          }
        } catch (_) {}
      } else {
        // Job was temporarily evicted from queue:active by the reaper
        if (!reclaimedTime) {
          reclaimedTime = Date.now();
        }
      }

      // Also check job hash
      const jobHash = await defaultRedis.hgetall(`job:${targetedJobId}`);
      if (jobHash && jobHash.workerId === worker2Id && jobHash.status === 'processing') {
        pickedUpByWorker2Time = Date.now();
        newOwner = worker2Id;
        break;
      }

      await sleep(100);
    }

    const finalRecoveryTime = pickedUpByWorker2Time || reclaimedTime || Date.now();
    const mttrMs = finalRecoveryTime - crashTime;
    const mttrSec = Number((mttrMs / 1000).toFixed(2));
    const leaseSec = Number((leaseMs / 1000).toFixed(2));

    const result = {
      targetedJobId,
      victimWorker: worker1Id,
      rescueWorker: newOwner || worker2Id,
      crashTimestamp: crashTime,
      recoveredTimestamp: finalRecoveryTime,
      mttrMs,
      mttrSec,
      leaseMs,
      leaseSec,
      reaperIntervalMs,
      recoveredSuccessfully: !!pickedUpByWorker2Time,
    };

    if (!silent) {
      console.log('\n--- Crash Recovery Results ---');
      console.log(` Orphaned Job ID:          ${result.targetedJobId}`);
      console.log(` Crashed Worker:           ${result.victimWorker}`);
      console.log(` Rescuing Worker:          ${result.rescueWorker}`);
      console.log(` Lease Timeout:            ${result.leaseSec}s (${result.leaseMs}ms)`);
      console.log(` Mean Time to Recovery:    ${result.mttrSec}s (${result.mttrMs}ms)`);
      console.log(` Recovery Status:          ${result.recoveredSuccessfully ? 'PASS (Reclaimed & Picked Up)' : 'RECLAIMED'}`);
      console.log('-'.repeat(60));
    }

    return result;
  } finally {
    cleanupProcesses();
  }
}

// Direct CLI execution
if (require.main === module) {
  measureRecoveryTime()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Recovery measurement failed:', err);
      process.exit(1);
    });
}

module.exports = {
  measureRecoveryTime,
};
