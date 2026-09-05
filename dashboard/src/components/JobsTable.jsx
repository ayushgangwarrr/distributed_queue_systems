/**
 * dashboard/src/components/JobsTable.jsx
 *
 * Paginated and searchable table of jobs with priority badges, status filters,
 * duration tracking, and contextual actions.
 */

import React, { useState } from 'react';
import {
  Search,
  CheckCircle,
  Clock,
  Zap,
  AlertCircle,
  Skull,
  RotateCcw,
  Trash2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  Copy,
  Check,
} from 'lucide-react';

export function JobsTable({
  jobs = [],
  total = 0,
  limit = 20,
  offset = 0,
  statusFilter = '',
  onFilterChange,
  onPageChange,
  onSelectJob,
  onCancelJob,
  onRetryJob,
  onOpenEnqueue,
  isLoading,
}) {
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedId, setCopiedId] = useState(null);

  const statuses = [
    { id: '', label: 'All Jobs' },
    { id: 'pending', label: 'Pending', count: null },
    { id: 'processing', label: 'Processing', count: null },
    { id: 'completed', label: 'Completed', count: null },
    { id: 'delayed', label: 'Delayed', count: null },
    { id: 'dead', label: 'Dead (DLQ)', count: null },
  ];

  const handleCopy = (e, id) => {
    e.stopPropagation();
    navigator.clipboard?.writeText(id);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const getPriorityBadge = (priority = 5) => {
    const p = Number(priority);
    if (p >= 9) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40 shadow-sm shadow-rose-950">
          <Sparkles className="w-3 h-3 text-rose-400" /> P{p} CRITICAL
        </span>
      );
    }
    if (p >= 7) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/40">
          P{p} HIGH
        </span>
      );
    }
    if (p >= 4) {
      return (
        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono text-indigo-300 bg-indigo-500/20 border border-indigo-500/40">
          P{p} NORMAL
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-mono text-slate-400 bg-slate-800 border border-slate-700">
        P{p} LOW
      </span>
    );
  };

  const getStatusBadge = (status = 'pending') => {
    switch (status.toLowerCase()) {
      case 'completed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
            <CheckCircle className="w-3.5 h-3.5 text-emerald-400" /> Completed
          </span>
        );
      case 'processing':
      case 'active':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
            <Zap className="w-3.5 h-3.5 text-cyan-400 animate-pulse" /> Processing
          </span>
        );
      case 'delayed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30">
            <Clock className="w-3.5 h-3.5 text-amber-400" /> Delayed
          </span>
        );
      case 'dead':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <Skull className="w-3.5 h-3.5 text-rose-400" /> Dead (DLQ)
          </span>
        );
      case 'failed':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-rose-500/15 text-rose-300 border border-rose-500/30">
            <AlertCircle className="w-3.5 h-3.5 text-rose-400" /> Failed
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-500/15 text-indigo-300 border border-indigo-500/30">
            <Clock className="w-3.5 h-3.5 text-indigo-400" /> Pending
          </span>
        );
    }
  };

  const formatTimeAgo = (timestamp) => {
    if (!timestamp) return '-';
    const now = Date.now();
    const diff = Math.max(0, now - Number(timestamp));
    const seconds = Math.floor(diff / 1000);
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  };

  // Filter jobs client-side if a search string is entered
  const filteredJobs = jobs.filter((job) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    const idMatch = job.id?.toLowerCase().includes(q);
    const typeMatch = job.type?.toLowerCase().includes(q);
    const dataMatch = JSON.stringify(job.data || {}).toLowerCase().includes(q);
    return idMatch || typeMatch || dataMatch;
  });

  const totalPages = Math.ceil(total / limit) || 1;
  const currentPage = Math.floor(offset / limit) + 1;

  return (
    <div className="glass-panel rounded-2xl overflow-hidden border border-slate-800 shadow-xl">
      {/* Header controls: Search & Filters */}
      <div className="p-4 sm:p-5 border-b border-slate-800/80 bg-slate-900/40 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Status filter pills */}
        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 md:pb-0">
          {statuses.map((s) => (
            <button
              key={s.id}
              onClick={() => onFilterChange(s.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap ${
                statusFilter === s.id
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'bg-slate-800/80 text-slate-400 hover:text-white hover:bg-slate-800'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Search input */}
        <div className="relative w-full md:w-72">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by ID, type, payload..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-1.5 text-xs bg-slate-950/80 border border-slate-800 rounded-lg text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 transition-all"
          />
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs text-slate-300">
          <thead className="bg-slate-950/60 text-[11px] uppercase tracking-wider text-slate-400 border-b border-slate-800 font-mono">
            <tr>
              <th className="py-3 px-4">Priority</th>
              <th className="py-3 px-4">Job ID & Task Type</th>
              <th className="py-3 px-4">Status</th>
              <th className="py-3 px-4">Retries</th>
              <th className="py-3 px-4">Created</th>
              <th className="py-3 px-4 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800/60">
            {isLoading ? (
              <tr>
                <td colSpan="6" className="py-12 text-center text-slate-400 font-mono">
                  <div className="inline-flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
                    Synchronizing queue state...
                  </div>
                </td>
              </tr>
            ) : filteredJobs.length === 0 ? (
              <tr>
                <td colSpan="6" className="py-16 text-center text-slate-400">
                  <div className="max-w-sm mx-auto space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-2xl bg-slate-800/80 border border-slate-700 flex items-center justify-center text-slate-400">
                      <Clock className="w-6 h-6" />
                    </div>
                    <div className="text-sm font-semibold text-slate-200">No jobs found</div>
                    <p className="text-xs text-slate-400">
                      There are currently no jobs matching the selected status filter.
                    </p>
                    {onOpenEnqueue && (
                      <button
                        onClick={onOpenEnqueue}
                        className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-indigo-200 bg-indigo-600/30 hover:bg-indigo-600/40 border border-indigo-500/40 rounded-xl transition-all shadow-sm"
                      >
                        <Sparkles className="w-3.5 h-3.5" /> Enqueue Test Job
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ) : (
              filteredJobs.map((job) => (
                <tr
                  key={job.id}
                  onClick={() => onSelectJob(job)}
                  className="hover:bg-slate-800/40 transition-colors cursor-pointer group"
                >
                  {/* Priority */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {getPriorityBadge(job.priority)}
                  </td>

                  {/* Job ID & Type */}
                  <td className="py-3.5 px-4">
                    <div className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-slate-100 font-semibold truncate max-w-[150px] sm:max-w-[200px]">
                          {job.id}
                        </span>
                        <button
                          onClick={(e) => handleCopy(e, job.id)}
                          className="text-slate-500 hover:text-slate-200 transition-colors"
                          title="Copy UUID"
                        >
                          {copiedId === job.id ? (
                            <Check className="w-3.5 h-3.5 text-emerald-400" />
                          ) : (
                            <Copy className="w-3.5 h-3.5 opacity-0 group-hover:opacity-100" />
                          )}
                        </button>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] font-mono text-slate-300 border border-slate-700/60">
                          {job.type || 'default'}
                        </span>
                        {job.workerId && (
                          <span className="text-[10px] font-mono text-cyan-400">
                            @{job.workerId}
                          </span>
                        )}
                      </div>
                    </div>
                  </td>

                  {/* Status */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    {getStatusBadge(job.status)}
                  </td>

                  {/* Retries */}
                  <td className="py-3.5 px-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            (Number(job.retryCount) || 0) >= (Number(job.maxRetries) || 3)
                              ? 'bg-rose-500'
                              : (Number(job.retryCount) || 0) > 0
                              ? 'bg-amber-500'
                              : 'bg-indigo-500'
                          }`}
                          style={{
                            width: `${Math.min(
                              100,
                              (((Number(job.retryCount) || 0) + 1) / ((Number(job.maxRetries) || 3) + 1)) * 100
                            )}%`,
                          }}
                        />
                      </div>
                      <span className="font-mono text-[11px] text-slate-400">
                        {job.retryCount ?? 0} / {job.maxRetries ?? 3}
                      </span>
                    </div>
                  </td>

                  {/* Created Time */}
                  <td className="py-3.5 px-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                    {formatTimeAgo(job.createdAt)}
                  </td>

                  {/* Actions */}
                  <td className="py-3.5 px-4 text-right whitespace-nowrap">
                    <div className="flex items-center justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
                      {job.status === 'pending' && onCancelJob && (
                        <button
                          onClick={() => onCancelJob(job.id)}
                          title="Cancel pending job"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                      {job.status === 'dead' && onRetryJob && (
                        <button
                          onClick={() => onRetryJob(job.id)}
                          title="Retry dead job"
                          className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
                        >
                          <RotateCcw className="w-4 h-4" />
                        </button>
                      )}
                      <button
                        onClick={() => onSelectJob(job)}
                        title="Inspect details"
                        className="p-1.5 rounded-lg text-slate-400 hover:text-indigo-300 hover:bg-indigo-500/10 transition-colors"
                      >
                        <ExternalLink className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      <div className="p-4 border-t border-slate-800 bg-slate-950/40 flex items-center justify-between text-xs text-slate-400">
        <div>
          Showing{' '}
          <span className="font-mono font-medium text-slate-200">
            {total === 0 ? 0 : offset + 1}
          </span>{' '}
          to{' '}
          <span className="font-mono font-medium text-slate-200">
            {Math.min(offset + limit, total)}
          </span>{' '}
          of <span className="font-mono font-medium text-slate-200">{total}</span> jobs
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => onPageChange(Math.max(0, offset - limit))}
            disabled={offset === 0}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="font-mono text-xs px-2">
            Page {currentPage} of {totalPages}
          </span>
          <button
            onClick={() => onPageChange(offset + limit)}
            disabled={offset + limit >= total}
            className="p-1.5 rounded-lg bg-slate-900 border border-slate-800 text-slate-300 hover:bg-slate-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
