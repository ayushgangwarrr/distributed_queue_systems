/**
 * src/loadtest/generateLoad.js
 *
 * Standalone load generator using autocannon.
 * Fires concurrent POST /jobs requests with randomized priorities (1-10)
 * to stress test queue ingestion, atomic enqueue pipelines, and priority distribution.
 *
 * CLI Usage:
 *   node src/loadtest/generateLoad.js [--jobs 5000] [--concurrency 50] [--type demo-task] [--url http://localhost:3000/jobs]
 *
 * Environment variables:
 *   TOTAL_JOBS (default: 5000)
 *   CONCURRENCY (default: 50)
 *   JOB_TYPE (default: 'demo-task')
 *   API_URL (default: 'http://localhost:3000/jobs')
 */

const autocannon = require('autocannon');

/**
 * Parse command-line flags or environment variables.
 */
function parseConfig(cliArgs = process.argv.slice(2)) {
  const args = {};
  for (let i = 0; i < cliArgs.length; i++) {
    if (cliArgs[i] === '--jobs' && cliArgs[i + 1]) args.jobs = parseInt(cliArgs[++i], 10);
    if (cliArgs[i] === '--concurrency' && cliArgs[i + 1]) args.concurrency = parseInt(cliArgs[++i], 10);
    if (cliArgs[i] === '--type' && cliArgs[i + 1]) args.type = cliArgs[++i];
    if (cliArgs[i] === '--url' && cliArgs[i + 1]) args.url = cliArgs[++i];
  }

  return {
    totalJobs: args.jobs || parseInt(process.env.TOTAL_JOBS, 10) || 5000,
    concurrency: args.concurrency || parseInt(process.env.CONCURRENCY, 10) || 50,
    jobType: args.type || process.env.JOB_TYPE || 'demo-task',
    url: args.url || process.env.API_URL || 'http://localhost:3000/jobs',
  };
}

/**
 * Executes the load test with autocannon.
 *
 * @param {Object} [options]
 * @param {number} [options.totalJobs=5000]
 * @param {number} [options.concurrency=50]
 * @param {string} [options.jobType='demo-task']
 * @param {string} [options.url='http://localhost:3000/jobs']
 * @param {boolean} [options.silent=false]
 * @returns {Promise<Object>} Benchmark submission stats
 */
function generateLoad(options = {}) {
  const config = {
    totalJobs: options.totalJobs || parseInt(process.env.TOTAL_JOBS, 10) || 5000,
    concurrency: options.concurrency || parseInt(process.env.CONCURRENCY, 10) || 50,
    jobType: options.jobType || process.env.JOB_TYPE || 'demo-task',
    url: options.url || process.env.API_URL || 'http://localhost:3000/jobs',
    silent: options.silent || false,
  };

  if (!config.silent) {
    console.log('='.repeat(60));
    console.log('  LOAD GENERATION TEST (autocannon)');
    console.log('='.repeat(60));
    console.log(` Target URL:   ${config.url}`);
    console.log(` Total Jobs:   ${config.totalJobs}`);
    console.log(` Concurrency:  ${config.concurrency}`);
    console.log(` Job Type:     ${config.jobType}`);
    console.log(` Priority:     Randomized (1 - 10) per request`);
    console.log('-'.repeat(60));
  }

  return new Promise((resolve, reject) => {
    let requestsSent = 0;
    const priorityCounts = {};
    for (let p = 1; p <= 10; p++) priorityCounts[p] = 0;

    const makePayload = () => {
      const priority = Math.floor(Math.random() * 10) + 1;
      priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
      return JSON.stringify({
        type: config.jobType,
        data: {
          submittedAt: Date.now(),
          taskSeq: ++requestsSent,
          label: `loadtest-${requestsSent}`,
        },
        priority,
        maxRetries: 3,
      });
    };

    const instance = autocannon(
      {
        url: config.url,
        connections: config.concurrency,
        amount: config.totalJobs,
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        setupClient: (client) => {
          client.setBody(makePayload());
          client.on('body', () => {
            client.setBody(makePayload());
          });
        },
      },
      (err, result) => {
        if (err) return reject(err);

        const totalSent = result.requests.sent || result.requests.total || config.totalJobs;
        const durationSec = result.duration || 1;
        const reqPerSec = result.requests.average || (totalSent / durationSec);
        const failedSubmissions = result.non2xx + result.errors + result.timeouts;

        const summary = {
          totalJobs: totalSent,
          durationSec: Number(durationSec.toFixed(2)),
          requestsPerSec: Number(reqPerSec.toFixed(2)),
          failedSubmissions,
          statusCode2xx: result['2xx'] || (totalSent - failedSubmissions),
          statusCodeNon2xx: result.non2xx || 0,
          errors: result.errors || 0,
          timeouts: result.timeouts || 0,
          priorityDistribution: priorityCounts,
          latency: {
            p50: result.latency.p50,
            p97_5: result.latency.p97_5,
            p99: result.latency.p99,
            average: result.latency.average,
          },
        };

        if (!config.silent) {
          console.log('\n--- Submission Results ---');
          console.log(` Total Requests Sent:   ${summary.totalJobs}`);
          console.log(` Duration:              ${summary.durationSec}s`);
          console.log(` Requests / Second:     ${summary.requestsPerSec} req/s`);
          console.log(` Successful (2xx):      ${summary.statusCode2xx}`);
          console.log(` Failed (non-2xx):      ${summary.failedSubmissions}`);
          console.log(` Latency (avg / p99):   ${summary.latency.average}ms / ${summary.latency.p99}ms`);
          console.log('-'.repeat(60));
        }

        resolve(summary);
      }
    );

    // Track progress during execution
    if (!config.silent) {
      autocannon.track(instance, { renderProgressBar: true });
    }
  });
}

// Direct CLI execution
if (require.main === module) {
  const config = parseConfig();
  generateLoad(config)
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('Load generation failed:', err);
      process.exit(1);
    });
}

module.exports = {
  generateLoad,
  parseConfig,
};
