/**
 * dashboard/src/components/DLQManager.jsx
 *
 * Dedicated management console for Dead Letter Queue (DLQ).
 * Displays isolated failed jobs with root-cause diagnostic logs, retry, and permanent purge actions.
 */

import React, { useState } from 'react';
import {
  AlertOctagon,
  RotateCcw,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
  Skull,
  CheckCircle2,
  Copy,
  Check,
} from 'lucide-react';

export function DLQManager({
  jobs = [],
  total = 0,
  limit = 20,
  offset = 0,
  onPageChange,
  onRetry,
  onPurge,
  onSelectJob,
  isLoading,
}) {
  const [copiedId, setCopiedId] = useState(null);

  const handleCopy = (id) => {
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatDate = (ts) => {
    if (!ts) return 'N/A';
    return new Date(Number(ts)).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  };

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="space-y-6">
      {/* DLQ Header & Diagnostic Alert */}
      <div className="glass-panel rounded-2xl p-5 border border-rose-500/30 bg-gradient-to-r from-rose-950/40 via-slate-900/40 to-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex items-start gap-4">
          <div className="p-3 rounded-xl bg-rose-500/20 text-rose-400 border border-rose-500/30">
            <AlertOctagon className="w-6 h-6" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
              Dead Letter Queue Isolation (DLQ)
              <span className="text-xs font-mono font-normal px-2 py-0.5 rounded-full bg-rose-500/20 text-rose-300 border border-rose-500/30">
                {total} {total === 1 ? 'Job' : 'Jobs'} Isolated
              </span>
            </h2>
            <p className="text-xs text-slate-300 max-w-2xl leading-relaxed">
              Jobs that exceeded their configured <code className="text-rose-300 bg-rose-950/80 px-1 py-0.5 rounded">maxRetries</code> are safely moved here. They no longer consume worker capacity. Inspect root cause errors below, replay them back into the active queue, or permanently purge them.
            </p>
          </div>
        </div>
      </div>

      {/* DLQ Table */}
      <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-slate-300">
            <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800 font-mono">
              <tr>
                <th className="py-3 px-4">Job ID & Handler</th>
                <th className="py-3 px-4">Retries Exhausted</th>
                <th className="py-3 px-4">Last Error Diagnostic</th>
                <th className="py-3 px-4">Died At</th>
                <th className="py-3 px-4 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {isLoading ? (
                <tr>
                  <td colSpan="5" className="py-12 text-center text-slate-400 font-mono">
                    Loading dead letter queue...
                  </td>
                </tr>
              ) : jobs.length === 0 ? (
                <tr>
                  <td colSpan="5" className="py-16 text-center text-slate-400">
                    <div className="max-w-sm mx-auto space-y-2">
                      <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto" />
                      <div className="text-sm font-semibold text-slate-200">DLQ is completely clean!</div>
                      <p className="text-xs text-slate-400">
                        Zero dead-lettered jobs in queue:dlq. All distributed workers operating cleanly.
                      </p>
                    </div>
                  </td>
                </tr>
              ) : (
                jobs.map((job) => {
                  const lastError = job.errors && job.errors.length > 0
                    ? (job.errors[job.errors.length - 1].message || job.errors[job.errors.length - 1].error || 'Execution failed')
                    : 'Unknown failure';

                  return (
                    <tr
                      key={job.id}
                      onClick={() => onSelectJob(job)}
                      className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                    >
                      {/* Job ID & Handler */}
                      <td className="py-3.5 px-4">
                        <div className="flex flex-col gap-1">
                          <div className="flex items-center gap-2">
                            <span className="font-mono text-slate-100 font-semibold truncate max-w-[180px]">
                              {job.id}
                            </span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCopy(job.id);
                              }}
                              className="text-slate-500 hover:text-slate-200"
                              title="Copy ID"
                            >
                              {copiedId === job.id ? (
                                <Check className="w-3.5 h-3.5 text-emerald-400" />
                              ) : (
                                <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
                              )}
                            </button>
                          </div>
                          <span className="text-[10px] font-mono text-slate-400">
                            type: <span className="text-slate-200">{job.type}</span>
                          </span>
                        </div>
                      </td>

                      {/* Retries */}
                      <td className="py-3.5 px-4 whitespace-nowrap">
                        <span className="font-mono text-xs px-2 py-0.5 rounded bg-rose-500/15 text-rose-300 border border-rose-500/30">
                          {job.retryCount ?? 0} / {job.maxRetries ?? 3} retries
                        </span>
                      </td>

                      {/* Error Snippet */}
                      <td className="py-3.5 px-4">
                        <div className="max-w-xs sm:max-w-md truncate font-mono text-rose-200 text-[11px]">
                          {lastError}
                        </div>
                      </td>

                      {/* Died At */}
                      <td className="py-3.5 px-4 whitespace-nowrap font-mono text-[11px] text-slate-400">
                        {formatDate(job.diedAt || job.createdAt)}
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => onRetry(job.id)}
                            title="Re-enqueue from DLQ into Pending"
                            className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 rounded-lg transition-all"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Replay
                          </button>
                          <button
                            onClick={() => onPurge(job.id)}
                            title="Permanently purge from Redis"
                            className="p-1.5 text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => onSelectJob(job)}
                            title="Inspect details"
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-lg transition-colors"
                          >
                            <ExternalLink className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination Footer */}
        <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
          <div>
            Showing <span className="font-mono text-slate-200">{total === 0 ? 0 : offset + 1}</span> to{' '}
            <span className="font-mono text-slate-200">{Math.min(offset + limit, total)}</span> of{' '}
            <span className="font-mono text-slate-200">{total}</span> dead jobs
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono text-xs px-2">
              Page {currentPage} of {totalPages}
            </span>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={offset + limit >= total}
              className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 transition-colors"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
