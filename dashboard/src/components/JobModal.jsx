/**
 * dashboard/src/components/JobModal.jsx
 *
 * Detailed inspection drawer/modal displaying full job metadata, syntax-highlighted
 * payload, error stack traces, and action buttons.
 */

import React, { useState } from 'react';
import {
  X,
  Copy,
  Check,
  RotateCcw,
  Trash2,
  Calendar,
  AlertTriangle,
  FileCode,
  Info,
  Clock,
  Zap,
} from 'lucide-react';

export function JobModal({ job, onClose, onCancel, onRetry }) {
  const [activeTab, setActiveTab] = useState('overview'); // 'overview' | 'payload' | 'errors'
  const [copied, setCopied] = useState(false);

  if (!job) return null;

  const handleCopy = (text) => {
    navigator.clipboard?.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const formatDate = (ts) => {
    if (!ts) return 'N/A';
    return new Date(Number(ts)).toLocaleString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      fractionalSecondDigits: 3,
    });
  };

  const errors = Array.isArray(job.errors) ? job.errors : [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/70 backdrop-blur-md animate-in fade-in duration-200">
      <div className="glass-panel rounded-2xl w-full max-w-2xl border border-slate-700/80 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/60 flex items-start justify-between gap-4">
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-mono uppercase tracking-widest text-indigo-400 bg-indigo-500/10 border border-indigo-500/30 px-2 py-0.5 rounded">
                {job.type || 'default'}
              </span>
              <span className="text-xs font-mono text-slate-400">
                P{job.priority || 5}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <h3 className="font-mono text-base font-bold text-white truncate max-w-md">
                {job.id}
              </h3>
              <button
                onClick={() => handleCopy(job.id)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors"
                title="Copy Job UUID"
              >
                {copied ? (
                  <Check className="w-4 h-4 text-emerald-400" />
                ) : (
                  <Copy className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Selection */}
        <div className="flex items-center px-5 border-b border-slate-800 bg-slate-950/40 text-xs gap-4">
          <button
            onClick={() => setActiveTab('overview')}
            className={`py-3 font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'overview'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Info className="w-3.5 h-3.5" /> Overview
          </button>
          <button
            onClick={() => setActiveTab('payload')}
            className={`py-3 font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'payload'
                ? 'border-indigo-500 text-indigo-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileCode className="w-3.5 h-3.5" /> Payload Data
          </button>
          <button
            onClick={() => setActiveTab('errors')}
            className={`py-3 font-medium flex items-center gap-1.5 border-b-2 transition-colors ${
              activeTab === 'errors'
                ? 'border-rose-500 text-rose-300'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <AlertTriangle className="w-3.5 h-3.5" /> Error Log ({errors.length})
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 overflow-y-auto space-y-5 text-xs text-slate-300">
          {activeTab === 'overview' && (
            <div className="space-y-4">
              {/* Metadata Grid */}
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                  <div className="text-[11px] text-slate-400">Status</div>
                  <div className="font-semibold text-white uppercase font-mono tracking-wider">
                    {job.status}
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                  <div className="text-[11px] text-slate-400">Priority Level</div>
                  <div className="font-semibold text-indigo-300 font-mono">
                    {job.priority} / 10
                  </div>
                </div>
                <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                  <div className="text-[11px] text-slate-400">Retries Used</div>
                  <div className="font-semibold text-slate-200 font-mono">
                    {job.retryCount || 0} / {job.maxRetries || 3}
                  </div>
                </div>
                {job.workerId && (
                  <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                    <div className="text-[11px] text-slate-400">Assigned Worker</div>
                    <div className="font-semibold text-cyan-400 font-mono">
                      {job.workerId}
                    </div>
                  </div>
                )}
                {job.leaseExpiresAt && (
                  <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                    <div className="text-[11px] text-slate-400">Lease Expiry</div>
                    <div className="font-semibold text-amber-300 font-mono truncate">
                      {formatDate(job.leaseExpiresAt)}
                    </div>
                  </div>
                )}
                {job.delayedUntil && (
                  <div className="bg-slate-900/80 border border-slate-800 p-3 rounded-xl space-y-1">
                    <div className="text-[11px] text-slate-400">Delayed Until</div>
                    <div className="font-semibold text-amber-300 font-mono truncate">
                      {formatDate(job.delayedUntil)}
                    </div>
                  </div>
                )}
              </div>

              {/* Execution Timeline */}
              <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="text-xs font-semibold text-slate-200 flex items-center gap-2">
                  <Clock className="w-4 h-4 text-slate-400" /> Lifecycle Timestamps
                </div>
                <div className="space-y-2 font-mono text-[11px]">
                  <div className="flex justify-between py-1 border-b border-slate-800/60">
                    <span className="text-slate-400">Created:</span>
                    <span className="text-slate-200">{formatDate(job.createdAt)}</span>
                  </div>
                  {job.dequeuedAt && (
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Dequeued / Started:</span>
                      <span className="text-cyan-300">{formatDate(job.dequeuedAt)}</span>
                    </div>
                  )}
                  {job.completedAt && (
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Completed:</span>
                      <span className="text-emerald-300">{formatDate(job.completedAt)}</span>
                    </div>
                  )}
                  {job.failedAt && (
                    <div className="flex justify-between py-1 border-b border-slate-800/60">
                      <span className="text-slate-400">Last Failed:</span>
                      <span className="text-rose-300">{formatDate(job.failedAt)}</span>
                    </div>
                  )}
                  {job.diedAt && (
                    <div className="flex justify-between py-1">
                      <span className="text-slate-400">Dead-Lettered:</span>
                      <span className="text-rose-400 font-bold">{formatDate(job.diedAt)}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'payload' && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-slate-400 text-xs">
                <span>JSON Payload</span>
                <button
                  onClick={() => handleCopy(JSON.stringify(job.data, null, 2))}
                  className="inline-flex items-center gap-1 text-slate-300 hover:text-white"
                >
                  <Copy className="w-3.5 h-3.5" /> Copy JSON
                </button>
              </div>
              <pre className="bg-slate-950 p-4 rounded-xl border border-slate-800 text-slate-200 font-mono text-xs overflow-x-auto max-h-72 select-all leading-relaxed">
                {JSON.stringify(job.data, null, 2) || '{}'}
              </pre>
            </div>
          )}

          {activeTab === 'errors' && (
            <div className="space-y-3">
              {errors.length === 0 ? (
                <div className="text-center py-8 text-slate-500 font-mono">
                  No error entries logged for this job.
                </div>
              ) : (
                errors.map((err, idx) => (
                  <div
                    key={idx}
                    className="bg-rose-950/30 border border-rose-500/30 rounded-xl p-3 space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[11px] text-rose-300 font-mono">
                      <span>Attempt #{idx + 1}</span>
                      <span>{formatDate(err.timestamp)}</span>
                    </div>
                    <div className="text-xs text-rose-200 font-mono break-words leading-relaxed">
                      {typeof err === 'object' ? err.message || err.error || JSON.stringify(err) : String(err)}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Modal Footer Actions */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {job.status === 'pending' && onCancel && (
              <button
                onClick={() => {
                  onCancel(job.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-300 bg-rose-500/15 hover:bg-rose-500/25 border border-rose-500/30 transition-all"
              >
                <Trash2 className="w-4 h-4" /> Cancel Job
              </button>
            )}
            {job.status === 'dead' && onRetry && (
              <button
                onClick={() => {
                  onRetry(job.id);
                  onClose();
                }}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold text-emerald-300 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 transition-all"
              >
                <RotateCcw className="w-4 h-4" /> Retry Job to Pending
              </button>
            )}
          </div>

          <button
            onClick={onClose}
            className="px-4 py-2 rounded-xl text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
