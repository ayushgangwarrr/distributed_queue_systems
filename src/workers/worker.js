/**
 * src/workers/worker.js
 *
 * Worker implementation that polls from PriorityQueue and executes handlers.
 * Includes:
 * - Deterministic lifecycle state transitions
 * - Active job lease-renewal heartbeat every (leaseMs / 2)
 * - Worker status heartbeat every 5 seconds
 * - Graceful shutdown allowing in-flight jobs to complete (up to timeout)
 * - Crash handlers that leave in-flight leases abandoned for the reaper
 */

const { getHandler } = require('./handlerRegistry');
const eventBus = require('../events/eventBus');
const jobHistoryRepo = require('../db/jobHistoryRepo');

// Helper to delay execution
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class Worker {
  /**
   * @param {string} workerId - Unique worker identifier
   * @param {import('../queue/priorityQueue')} priorityQueue - PriorityQueue engine instance
   * @param {number} [pollIntervalMs=1000] - Polling delay when queue is empty
   * @param {number} [leaseMs=30000] - Lease duration granted per job in milliseconds
   */
  constructor(workerId, priorityQueue, pollIntervalMs = 1000, leaseMs = 30000) {
    if (!workerId) {
      throw new Error('Worker requires a workerId');
    }
    if (!priorityQueue) {
      throw new Error('Worker requires a PriorityQueue instance');
    }

    this.workerId = workerId;
    this.queue = priorityQueue;
    this.pollIntervalMs = pollIntervalMs;
    this.leaseMs = leaseMs;

    this.isRunning = false;
    this.isProcessing = false;
    this.currentJob = null;
    this.heartbeatTimer = null;
    this.leaseRenewalTimer = null;
    this._loopPromise = null;

    // Register fatal crash handlers that do NOT clean up the active lease
    this._registerCrashHandlers();
  }

  /**
   * Start the worker polling and heartbeat loops.
   */
  start() {
    if (this.isRunning) {
      console.warn(`[Worker:${this.workerId}] Worker is already running.`);
      return;
    }

    this.isRunning = true;
    console.log(
      `[Worker:${this.workerId}] Worker started (pollInterval: ${this.pollIntervalMs}ms, leaseMs: ${this.leaseMs}ms).`
    );

    // Start 5-second status heartbeat
    this._startStatusHeartbeat();

    // Start main polling loop
    this._loopPromise = this._runLoop();
  }

  /**
   * Main polling and processing loop.
   * @private
   */
  async _runLoop() {
    while (this.isRunning) {
      try {
        // 1. Attempt to dequeue a job atomically with lease duration
        const job = await this.queue.dequeue(this.workerId, this.leaseMs);

        if (!job) {
          // Queue is empty; wait for next poll interval
          await sleep(this.pollIntervalMs);
          continue;
        }

        // 2. Job received: enter processing state
        this.isProcessing = true;
        this.currentJob = job;

        console.log(
          `[Worker:${this.workerId}] [DEQUEUED] Job ${job.id} | Type: ${job.type} | Priority: ${job.priority}`
        );

        // Publish job:started and update Postgres
        eventBus.publish('job:started', {
          jobId: job.id,
          workerId: this.workerId,
          type: job.type,
          priority: job.priority,
          startedAt: Date.now(),
        });
        jobHistoryRepo.updateJobStatus(job.id, 'processing', {
          workerId: this.workerId,
          startedAt: new Date(),
        });

        // 3. Find registered handler for the job type
        const handler = getHandler(job.type);
        if (!handler) {
          console.error(
            `[Worker:${this.workerId}] [NO_HANDLER] No handler registered for job type "${job.type}". Failing job ${job.id}...`
          );
          const failResult = await this.queue.fail(job.id, `No handler registered for job type: ${job.type}`);
          console.log(
            `[Worker:${this.workerId}] [FAILED] Job ${job.id} marked failed (Action: ${failResult?.action || 'unknown'})`
          );
          this.currentJob = null;
          this.isProcessing = false;
          continue;
        }

        // 4. Start lease renewal heartbeat loop (renews every leaseMs / 2)
        // crash-test intentionally bypasses lease renewal to simulate an unresponsive worker
        if (job.type !== 'crash-test') {
          this._startLeaseRenewal(job.id);
        } else {
          console.log(
            `[Worker:${this.workerId}] [CRASH_SIMULATION] Lease renewal intentionally suppressed for crash-test job ${job.id}`
          );
        }

        // 5. Execute handler with job.data and full job object
        console.log(`[Worker:${this.workerId}] [PROCESSING] Executing handler for job ${job.id}...`);
        try {
          await handler(job.data, job);
          await this.queue.complete(job.id);
          console.log(
            `[Worker:${this.workerId}] [COMPLETED] Job ${job.id} finished successfully.`
          );

          // Publish job:completed and update Postgres
          eventBus.publish('job:completed', {
            jobId: job.id,
            workerId: this.workerId,
            completedAt: Date.now(),
          });
          jobHistoryRepo.updateJobStatus(job.id, 'completed', {
            completedAt: new Date(),
          });
        } catch (err) {
          // Handle failure and calculate retry/DLQ transition
          const failResult = await this.queue.fail(job.id, err.message);
          console.error(
            `[Worker:${this.workerId}] [FAILED] Job ${job.id} failed: "${err.message}" | Action: ${failResult?.action || 'fail'} | RetryCount: ${failResult?.retryCount ?? 'N/A'}/${failResult?.maxRetries ?? 'N/A'}`
          );

          // Publish job:failed or job:dead-lettered and update Postgres
          const isDead = failResult?.action === 'dead';
          const eventType = isDead ? 'job:dead-lettered' : 'job:failed';
          eventBus.publish(eventType, {
            jobId: job.id,
            workerId: this.workerId,
            retryCount: failResult?.retryCount ?? job.retryCount,
            maxRetries: failResult?.maxRetries ?? job.maxRetries,
            error: err.message,
            action: failResult?.action || 'fail',
            delayedUntil: failResult?.delayedUntil,
          });
          jobHistoryRepo.updateJobStatus(job.id, isDead ? 'dead' : 'pending', {
            error: err.message,
            retryCount: failResult?.retryCount ?? job.retryCount,
          });
        } finally {
          // Stop lease renewal loop immediately after processing ends
          this._stopLeaseRenewal();
          this.currentJob = null;
          this.isProcessing = false;
        }
      } catch (loopError) {
        console.error(`[Worker:${this.workerId}] Unexpected error in polling loop:`, loopError);
        await sleep(this.pollIntervalMs);
      }
    }
  }

  /**
   * Starts periodic lease renewal heartbeat while actively processing a job.
   * Runs every leaseMs / 2 to prevent healthy workers from timing out.
   * @private
   */
  _startLeaseRenewal(jobId) {
    this._stopLeaseRenewal();
    const renewIntervalMs = Math.max(500, Math.floor(this.leaseMs / 2));

    this.leaseRenewalTimer = setInterval(async () => {
      try {
        const renewed = await this.queue.renewLease(jobId, this.workerId, this.leaseMs);
        if (renewed) {
          console.log(
            `[Worker:${this.workerId}] [LEASE_RENEWED] Extended lease for job ${jobId} (+${this.leaseMs}ms)`
          );
        } else {
          console.warn(
            `[Worker:${this.workerId}] [LEASE_LOST] Could not renew lease for job ${jobId} (reclaimed by reaper or ownership lost)`
          );
        }
      } catch (err) {
        console.error(`[Worker:${this.workerId}] Error renewing lease for job ${jobId}:`, err.message);
      }
    }, renewIntervalMs);

    if (this.leaseRenewalTimer.unref) {
      this.leaseRenewalTimer.unref();
    }
  }

  /**
   * Stops the active job's lease renewal timer.
   * @private
   */
  _stopLeaseRenewal() {
    if (this.leaseRenewalTimer) {
      clearInterval(this.leaseRenewalTimer);
      this.leaseRenewalTimer = null;
    }
  }

  /**
   * Starts a 5-second status heartbeat logger.
   * @private
   */
  _startStatusHeartbeat() {
    this.heartbeatTimer = setInterval(() => {
      const status = this.currentJob ? 'processing' : 'idle';
      if (this.currentJob) {
        console.log(
          `[Heartbeat] Worker ${this.workerId} alive, currently processing job ${this.currentJob.id} (priority ${this.currentJob.priority})`
        );
      } else {
        console.log(`[Heartbeat] Worker ${this.workerId} alive, currently idle`);
      }

      // Publish worker:heartbeat event to eventBus
      eventBus.publish('worker:heartbeat', {
        workerId: this.workerId,
        status,
        currentJobId: this.currentJob?.id || null,
        priority: this.currentJob?.priority || null,
        timestamp: Date.now(),
      });
    }, 5000);

    if (this.heartbeatTimer.unref) {
      this.heartbeatTimer.unref();
    }
  }

  /**
   * Gracefully stop the worker.
   * Ceases polling and waits up to timeoutMs for any in-flight job to finish before resolving.
   *
   * @param {number} [timeoutMs=10000] Maximum wait time for in-flight job
   */
  async stop(timeoutMs = 10000) {
    if (!this.isRunning) {
      return;
    }

    console.log(`[Worker:${this.workerId}] [SHUTDOWN] Graceful shutdown initiated...`);
    this.isRunning = false;

    // Clear heartbeats
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this._stopLeaseRenewal();

    // Wait for in-flight job up to timeoutMs
    if (this.isProcessing) {
      console.log(
        `[Worker:${this.workerId}] [SHUTDOWN] In-flight job detected (job: ${this.currentJob?.id}). Waiting up to ${timeoutMs}ms for completion...`
      );
      const startWait = Date.now();
      while (this.isProcessing && Date.now() - startWait < timeoutMs) {
        await sleep(100);
      }

      if (this.isProcessing) {
        console.warn(
          `[Worker:${this.workerId}] [SHUTDOWN_TIMEOUT] In-flight job did not finish within ${timeoutMs}ms. Forcing shutdown.`
        );
      } else {
        console.log(`[Worker:${this.workerId}] [SHUTDOWN] In-flight job finished cleanly.`);
      }
    }

    // Wait for loop to exit
    if (this._loopPromise) {
      await this._loopPromise;
    }

    console.log(`[Worker:${this.workerId}] Stopped gracefully.`);
  }

  /**
   * Register crash handlers that log fatal events but do NOT release active leases.
   * @private
   */
  _registerCrashHandlers() {
    process.on('uncaughtException', (err) => {
      console.error(
        `\n[Worker:${this.workerId}] [FATAL_CRASH] Uncaught Exception occurred:`,
        err.message
      );
      console.error(
        `[Worker:${this.workerId}] [FATAL_CRASH] Process terminating IMMEDIATELY without releasing lease so the reaper can reclaim it.\n`
      );
      process.exit(1);
    });

    process.on('unhandledRejection', (reason) => {
      console.error(
        `\n[Worker:${this.workerId}] [FATAL_CRASH] Unhandled Rejection occurred:`,
        reason
      );
      console.error(
        `[Worker:${this.workerId}] [FATAL_CRASH] Process terminating IMMEDIATELY without releasing lease so the reaper can reclaim it.\n`
      );
      process.exit(1);
    });
  }
}

module.exports = Worker;
