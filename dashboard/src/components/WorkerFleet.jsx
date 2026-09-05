/**
 * dashboard/src/components/WorkerFleet.jsx
 *
 * Real-time monitoring of distributed worker instances and recovery reaper status.
 */

import React from 'react';
import {
  Cpu,
  Zap,
  Clock,
  ShieldCheck,
  Terminal,
  Activity,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';

export function WorkerFleet({ workers = [], onSelectJobId }) {
  const activeWorkers = workers.filter((w) => w.status !== 'offline');
  const offlineWorkers = workers.filter((w) => w.status === 'offline');

  return (
    <div className="space-y-6">
      {/* Cluster Banner */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 bg-gradient-to-r from-slate-900/60 via-slate-900/40 to-slate-950/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
            <Cpu className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-bold text-white tracking-tight">
                Autonomous Worker Fleet
              </h2>
              <span className="text-xs font-mono px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                {activeWorkers.length} Active / {workers.length} Registered
              </span>
            </div>
            <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
              Workers continuously renew active job leases via Lua every 15s. The recovery reaper periodically scans for expired leases to resurrect abandoned jobs.
            </p>
          </div>
        </div>

        {/* CLI Helper */}
        <div className="bg-slate-950/80 border border-slate-800 rounded-xl p-3 text-xs font-mono text-slate-300 flex items-center gap-2 shrink-0">
          <Terminal className="w-4 h-4 text-emerald-400 shrink-0" />
          <code>WORKER_ID=worker-3 npm run worker</code>
        </div>
      </div>

      {/* Workers Grid */}
      {workers.length === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center border border-slate-800 space-y-3">
          <Cpu className="w-12 h-12 text-slate-600 mx-auto" />
          <div className="text-sm font-semibold text-slate-200">No Workers Connected Yet</div>
          <p className="text-xs text-slate-400 max-w-md mx-auto">
            Start a worker in your terminal to see heartbeats and active job leases in real time:
          </p>
          <div className="inline-block bg-slate-950 px-4 py-2 rounded-xl border border-slate-800 font-mono text-xs text-indigo-300">
            npm run worker
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {workers.map((worker) => {
            const isProcessing = worker.status === 'processing';
            const isOffline = worker.status === 'offline';

            return (
              <div
                key={worker.workerId}
                className={`glass-panel rounded-2xl p-5 border transition-all relative overflow-hidden ${
                  isProcessing
                    ? 'border-cyan-500/40 bg-cyan-950/10 shadow-lg shadow-cyan-950/20'
                    : isOffline
                    ? 'border-slate-800 opacity-60 bg-slate-950/40'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-2.5">
                    <div
                      className={`w-2.5 h-2.5 rounded-full ${
                        isProcessing
                          ? 'bg-cyan-400 pulse-glow shadow-sm shadow-cyan-400'
                          : isOffline
                          ? 'bg-slate-600'
                          : 'bg-emerald-400 shadow-sm shadow-emerald-400'
                      }`}
                    />
                    <span className="font-mono font-bold text-sm text-white">
                      {worker.workerId}
                    </span>
                  </div>

                  <span
                    className={`text-[11px] font-mono px-2 py-0.5 rounded-full border uppercase tracking-wider ${
                      isProcessing
                        ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                        : isOffline
                        ? 'bg-slate-800 text-slate-400 border-slate-700'
                        : 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    }`}
                  >
                    {worker.status}
                  </span>
                </div>

                {/* Details */}
                <div className="space-y-3 text-xs">
                  {/* Current Job */}
                  <div className="bg-slate-950/60 rounded-xl p-3 border border-slate-800/80 space-y-1">
                    <div className="text-[11px] text-slate-400 flex items-center justify-between">
                      <span>Currently Leased Job:</span>
                      {worker.currentJobId && onSelectJobId && (
                        <button
                          onClick={() => onSelectJobId(worker.currentJobId)}
                          className="text-indigo-400 hover:text-indigo-300 flex items-center gap-1 font-mono text-[10px]"
                        >
                          inspect <ExternalLink className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                    <div className="font-mono text-slate-200 truncate">
                      {worker.currentJobId ? (
                        <span className="text-cyan-300">{worker.currentJobId}</span>
                      ) : (
                        <span className="text-slate-500 italic">Idle / Polling for jobs</span>
                      )}
                    </div>
                  </div>

                  {/* Heartbeat Status */}
                  <div className="flex items-center justify-between text-[11px] font-mono text-slate-400 px-1">
                    <span>Last Heartbeat:</span>
                    <span className={worker.lastSeenSecondsAgo > 10 ? 'text-amber-400' : 'text-emerald-400'}>
                      {worker.lastSeenSecondsAgo}s ago
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Reaper & Crash Recovery Info Box */}
      <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-indigo-400" />
          Orphaned Job Recovery Reaper Architecture
        </h3>
        <p className="text-xs text-slate-400 leading-relaxed">
          In a distributed system, worker nodes can crash unexpectedly (<code className="text-slate-300 bg-slate-900 px-1 py-0.5 rounded font-mono">kill -9</code>) or freeze indefinitely in event loops. To avoid stalled jobs, workers acquire time-limited leases (<code className="text-slate-300 bg-slate-900 px-1 py-0.5 rounded font-mono">leaseMs: 30000</code>) in Redis. If a worker dies and fails to renew its lease heartbeat, the standalone <strong>Reaper process</strong> detects the expired lease in <code className="text-slate-300 bg-slate-900 px-1 py-0.5 rounded font-mono">queue:active</code>, reclaims the job, and routes it into exponential backoff for other workers to pick up.
        </p>
      </div>
    </div>
  );
}
