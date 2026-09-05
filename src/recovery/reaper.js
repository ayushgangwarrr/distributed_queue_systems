/**
 * src/recovery/reaper.js
 *
 * Background service that scans 'queue:active' and reclaims orphaned/expired jobs
 * from crashed or hung workers.
 */

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class JobReaper {
  /**
   * @param {import('../queue/priorityQueue')} priorityQueue
   * @param {number} [intervalMs=5000] - Scan frequency in milliseconds
   */
  constructor(priorityQueue, intervalMs = 5000) {
    if (!priorityQueue) {
      throw new Error('JobReaper requires a PriorityQueue instance');
    }

    this.queue = priorityQueue;
    this.intervalMs = intervalMs;
    this.isRunning = false;
    this.timer = null;
    this.isScanning = false;
  }

  /**
   * Start the reaper scanning loop.
   */
  start() {
    if (this.isRunning) {
      console.warn('[Reaper] Reaper is already running.');
      return;
    }

    this.isRunning = true;
    console.log(
      `[Reaper] Started orphaned job reaper service (scan interval: ${this.intervalMs}ms).`
    );

    this.timer = setInterval(async () => {
      await this.scan();
    }, this.intervalMs);

    // Immediate initial scan
    this.scan().catch((err) => {
      console.error('[Reaper] Initial scan error:', err.message);
    });
  }

  /**
   * Run a single reclamation cycle.
   */
  async scan() {
    if (this.isScanning) return;
    this.isScanning = true;

    try {
      const reclaimed = await this.queue.reclaimExpiredLeases();
      if (reclaimed && reclaimed.length > 0) {
        console.log(`\n[Reaper] Detected ${reclaimed.length} expired lease(s):`);
        for (const item of reclaimed) {
          console.log(
            `  - [RECLAIMED] Job ID: ${item.jobId} | Abandoned by worker: '${item.workerId}' | Expired by: ${item.expiredBy}ms -> Re-routed to retry/DLQ`
          );
        }
        console.log('');
      }
    } catch (err) {
      console.error('[Reaper] Error during lease reclamation scan:', err.message);
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Gracefully stop the reaper.
   */
  async stop() {
    if (!this.isRunning) return;

    console.log('[Reaper] Gracefully stopping reaper service...');
    this.isRunning = false;

    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    while (this.isScanning) {
      await sleep(100);
    }

    console.log('[Reaper] Reaper stopped gracefully.');
  }
}

module.exports = JobReaper;
