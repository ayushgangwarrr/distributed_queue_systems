# Distributed Priority Queue System

A robust, multi-process, Redis-backed priority queue engine in Node.js featuring atomic Lua transactions, deterministic priority ordering, exponential backoff retries, lease heartbeats, Dead Letter Queue (DLQ) isolation, and an orphaned job recovery reaper.

---

## Architecture Overview

```
                      +-----------------------------+
                      |   Express REST API Server   |
                      |          (Port 3000)        |
                      +--------------+--------------+
                                     | POST /jobs
                                     v
                  +------------------------------------+
                  |               Redis                |
                  |  - queue:pending  (ZSET)           |
                  |  - queue:active   (HASH)           |
                  |  - queue:delayed  (ZSET)           |
                  |  - queue:dlq      (ZSET)           |
                  |  - jobs:all       (ZSET)           |
                  +-------+----------+----------+------+
                          ^          ^          ^
             dequeue/fail |          | renew    | reclaim
                          v          |          v
        +-------------------+        |    +-------------------+
        | Standalone Worker |--------+    |  Recovery Reaper  |
        |    (Worker 1)     |             |  (runReaper.js)   |
        +-------------------+             +-------------------+
        +-------------------+
        | Standalone Worker |
        |    (Worker 2)     |
        +-------------------+
```

---

## Running the Distributed System (Multi-Terminal)

Run each service in its own terminal window to observe multi-worker execution and fault recovery in real time:

### Terminal 1: REST API Server
```bash
npm start
```
*Starts the Express server on `http://localhost:3000`. Workers do NOT run in this process.*

### Terminal 2: Worker Instance 1
```bash
WORKER_ID=worker-1 npm run worker
```
*Listens and processes jobs, renewing active leases every `leaseMs / 2`.*

### Terminal 3: Worker Instance 2
```bash
WORKER_ID=worker-2 npm run worker
```
*Second concurrent consumer competing for highest-priority jobs.*

### Terminal 4: Orphaned Job Reaper
```bash
npm run reaper
```
*Periodically scans `queue:active` (default every 5s) and reclaims expired leases abandoned by dead or frozen workers.*

### Terminal 5: WebSocket Monitoring Server
```bash
npm run monitor
```
*Starts the WebSocket event streaming server on `ws://localhost:4000`.*

### Live Web Dashboard
Once the API server and monitoring server are running, open the dashboard in your browser:
- **Web Browser URL:** [http://localhost:3000/dashboard](http://localhost:3000/dashboard)
- Or open `dashboard/index.html` directly.

---

## Testing Fault Tolerance & Worker Crash Scenarios

### 1. Deterministic Freeze / Hang Simulation (`crash-test`)
Submit a job configured with `type: "crash-test"`:
```bash
curl -i -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"type":"crash-test","data":{"task":"freeze_worker"},"priority":8}'
```
1. One of the active workers will dequeue the job and enter the `crash-test` handler.
2. The handler intentionally awaits an unresolving promise, simulating a frozen worker.
3. The worker stops extending its lease heartbeat.
4. Within `leaseMs` (e.g. 30 seconds), the lease expires.
5. In Terminal 4, the **Reaper** detects the expired lease, reclaims the job from the frozen worker, and routes it into exponential backoff / retry.

### 2. Kill -9 / Abrupt Process Termination
Start a long-running demo job and abruptly kill the worker process:
```bash
# In Terminal 2, while processing:
kill -9 <WORKER_PID>
```
Because the worker died without cleaning up Redis state, the active lease remains in `queue:active` until the **Reaper** reclaims it and re-queues it for other workers.

---

## REST API Reference & Curl Cheatsheet

### Submit a Job
```bash
curl -i -X POST http://localhost:3000/jobs \
  -H 'Content-Type: application/json' \
  -d '{"type":"demo-task","data":{"task":"financial_report"},"priority":9}'
```

### Inspect Job Details
```bash
curl -i http://localhost:3000/jobs/<JOB_ID>
```

### List Jobs (Paginated)
```bash
curl -i "http://localhost:3000/jobs?limit=10&offset=0"
```

### List Dead Letter Queue (DLQ)
```bash
curl -i "http://localhost:3000/dlq?limit=10&offset=0"
```

### Retry a Dead Job from DLQ
```bash
curl -i -X POST http://localhost:3000/dlq/<JOB_ID>/retry
```

### Permanently Purge a Dead Job from DLQ
```bash
curl -i -X DELETE http://localhost:3000/dlq/<JOB_ID>
```

### Check Queue Statistics
```bash
curl -i http://localhost:3000/queues/stats
```

### System Health
```bash
curl -i http://localhost:3000/health
```

---

## Automated Verification Suites

- **Complete REST API & DLQ Endpoint Verification:**
  ```bash
  npm run test:api
  ```
- **Failure Injection & Exponential Backoff Verification:**
  ```bash
  npm run test:failure
  ```
- **Priority Engine & Worker Concurrency Verification:**
  ```bash
  npm run test:harness
  ```
