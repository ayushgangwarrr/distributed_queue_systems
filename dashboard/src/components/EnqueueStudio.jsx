/**
 * dashboard/src/components/EnqueueStudio.jsx
 *
 * Interactive studio for submitting jobs, configuring priorities and retries,
 * and firing 1-click failure testing scenarios.
 */

import React, { useState } from 'react';
import {
  Send,
  Sparkles,
  Zap,
  AlertTriangle,
  Flame,
  Layers,
  CheckCircle2,
  AlertCircle,
} from 'lucide-react';

export function EnqueueStudio({ onEnqueue, onBatchEnqueue }) {
  const [type, setType] = useState('demo-task');
  const [priority, setPriority] = useState(7);
  const [maxRetries, setMaxRetries] = useState(3);
  const [payloadText, setPayloadText] = useState('{\n  "task": "generate_report",\n  "userId": 1042\n}');
  const [jsonError, setJsonError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Validate and submit custom job
  const handleSubmit = async (e) => {
    e.preventDefault();
    setJsonError('');

    let parsedPayload;
    try {
      parsedPayload = JSON.parse(payloadText);
      if (typeof parsedPayload !== 'object' || parsedPayload === null) {
        throw new Error('Payload must be a valid JSON object');
      }
    } catch (err) {
      setJsonError(err.message);
      return;
    }

    setIsSubmitting(true);
    try {
      await onEnqueue({
        type: type.trim(),
        data: parsedPayload,
        priority: Number(priority),
        maxRetries: Number(maxRetries),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  // 1-Click Scenario presets
  const presets = [
    {
      id: 'urgent',
      title: 'Urgent Financial Report',
      desc: 'High priority (P10) job executed immediately ahead of pending queue.',
      icon: Sparkles,
      color: 'border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 text-indigo-300',
      apply: () => {
        setType('demo-task');
        setPriority(10);
        setMaxRetries(3);
        setPayloadText('{\n  "task": "urgent_q4_audit",\n  "priority": "highest",\n  "department": "finance"\n}');
      },
    },
    {
      id: 'flaky',
      title: 'Flaky Payment Webhook',
      desc: 'Fails 2 times before succeeding on attempt #3 (observes backoff).',
      icon: Zap,
      color: 'border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 text-amber-300',
      apply: () => {
        setType('flaky-task');
        setPriority(7);
        setMaxRetries(4);
        setPayloadText('{\n  "task": "stripe_webhook",\n  "failUntilAttempt": 2,\n  "amount": 25000\n}');
      },
    },
    {
      id: 'always-fail',
      title: 'Exhaust Retries to DLQ',
      desc: 'Fails every attempt and gets isolated in Dead Letter Queue (DLQ).',
      icon: AlertTriangle,
      color: 'border-rose-500/40 bg-rose-500/10 hover:bg-rose-500/20 text-rose-300',
      apply: () => {
        setType('always-fails');
        setPriority(6);
        setMaxRetries(2);
        setPayloadText('{\n  "task": "third_party_sync",\n  "target": "external_api_v1"\n}');
      },
    },
    {
      id: 'crash-test',
      title: 'Freeze Worker (Reaper Test)',
      desc: 'Worker hangs indefinitely; reaper reclaims lease after timeout.',
      icon: Flame,
      color: 'border-red-500/40 bg-red-500/10 hover:bg-red-500/20 text-red-300',
      apply: () => {
        setType('crash-test');
        setPriority(8);
        setMaxRetries(3);
        setPayloadText('{\n  "task": "freeze_worker",\n  "simulate": "unhandled_deadlock"\n}');
      },
    },
  ];

  const handleBatch = async (count) => {
    setIsSubmitting(true);
    try {
      await onBatchEnqueue(count);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      {/* Custom Enqueue Form */}
      <div className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-slate-800 space-y-6">
        <div>
          <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
            <Send className="w-5 h-5 text-indigo-400" />
            Enqueue New Job
          </h2>
          <p className="text-xs text-slate-400 mt-1">
            Publish jobs with deterministic priority scores (1–10) and configurable retry budgets.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Task Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-slate-300">Job Handler Type</label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {['demo-task', 'flaky-task', 'always-fails', 'crash-test'].map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => setType(t)}
                  className={`px-3 py-2 rounded-xl text-xs font-mono font-medium transition-all text-center border ${
                    type === t
                      ? 'bg-indigo-600/30 border-indigo-500 text-indigo-200 shadow-sm'
                      : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <input
              type="text"
              value={type}
              onChange={(e) => setType(e.target.value)}
              placeholder="Or enter custom job type..."
              className="w-full mt-2 px-3.5 py-2 text-xs font-mono bg-slate-950 border border-slate-800 rounded-xl text-slate-200 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
            />
          </div>

          {/* Priority Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-300">
                Priority: <span className="font-mono text-indigo-400 font-bold">{priority} / 10</span>
              </label>
              <span className="text-[11px] text-slate-400 font-mono">
                {priority >= 9
                  ? 'Critical (Evaluated first)'
                  : priority >= 7
                  ? 'High Priority'
                  : priority >= 4
                  ? 'Normal Priority'
                  : 'Low Priority / Batch'}
              </span>
            </div>
            <input
              type="range"
              min="1"
              max="10"
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
            <div className="flex justify-between text-[10px] font-mono text-slate-500 px-1">
              <span>1 (Lowest)</span>
              <span>5 (Standard)</span>
              <span>10 (Highest)</span>
            </div>
          </div>

          {/* Max Retries Slider */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <label className="font-semibold text-slate-300">
                Max Retries: <span className="font-mono text-slate-200 font-bold">{maxRetries}</span>
              </label>
              <span className="text-[11px] text-slate-400">
                {maxRetries === 0 ? 'No retry (direct to DLQ on failure)' : 'Exponential backoff with jitter'}
              </span>
            </div>
            <input
              type="range"
              min="0"
              max="10"
              value={maxRetries}
              onChange={(e) => setMaxRetries(Number(e.target.value))}
              className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-indigo-500"
            />
          </div>

          {/* JSON Payload Editor */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-xs font-semibold text-slate-300">Task Data Payload (JSON)</label>
              {jsonError && (
                <span className="text-[11px] text-rose-400 flex items-center gap-1 font-mono">
                  <AlertCircle className="w-3 h-3" /> {jsonError}
                </span>
              )}
            </div>
            <textarea
              rows={5}
              value={payloadText}
              onChange={(e) => {
                setPayloadText(e.target.value);
                setJsonError('');
              }}
              className={`w-full p-3 text-xs font-mono bg-slate-950 border rounded-xl text-slate-200 focus:outline-none transition-colors ${
                jsonError
                  ? 'border-rose-500 focus:ring-1 focus:ring-rose-500'
                  : 'border-slate-800 focus:border-indigo-500'
              }`}
            />
          </div>

          {/* Submit Button */}
          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full py-2.5 px-4 rounded-xl text-xs font-semibold text-white bg-gradient-to-r from-indigo-600 to-indigo-500 hover:from-indigo-500 hover:to-indigo-400 shadow-lg shadow-indigo-600/25 transition-all flex items-center justify-center gap-2 active:scale-98 disabled:opacity-50"
          >
            <Send className="w-4 h-4" />
            {isSubmitting ? 'Enqueueing Job...' : 'Submit Job to Priority Queue'}
          </button>
        </form>
      </div>

      {/* Quick Presets & Batch Injector */}
      <div className="space-y-6">
        {/* Preset Cards */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-indigo-400" />
            Quick Test Scenarios
          </h3>
          <p className="text-[11px] text-slate-400">
            Preconfigured jobs designed to trigger specific distributed queue behaviors.
          </p>

          <div className="space-y-2.5 pt-1">
            {presets.map((preset) => {
              const Icon = preset.icon;
              return (
                <button
                  key={preset.id}
                  onClick={preset.apply}
                  className={`w-full text-left p-3 rounded-xl border transition-all ${preset.color} flex items-start gap-3`}
                >
                  <Icon className="w-4 h-4 mt-0.5 shrink-0" />
                  <div className="space-y-0.5">
                    <div className="text-xs font-semibold">{preset.title}</div>
                    <div className="text-[11px] opacity-80 leading-relaxed">{preset.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Batch Injection */}
        <div className="glass-panel rounded-2xl p-5 border border-slate-800 space-y-3">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
            <Layers className="w-4 h-4 text-cyan-400" />
            Batch Enqueue Tool
          </h3>
          <p className="text-[11px] text-slate-400">
            Inject multiple concurrent jobs with randomly distributed priorities (1–10) to observe dynamic ZSET ordering.
          </p>

          <div className="grid grid-cols-2 gap-2 pt-1">
            <button
              onClick={() => handleBatch(5)}
              disabled={isSubmitting}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold text-cyan-300 bg-cyan-500/15 hover:bg-cyan-500/25 border border-cyan-500/30 transition-all flex items-center justify-center gap-1.5"
            >
              Enqueue 5 Jobs
            </button>
            <button
              onClick={() => handleBatch(10)}
              disabled={isSubmitting}
              className="py-2.5 px-3 rounded-xl text-xs font-semibold text-indigo-300 bg-indigo-500/15 hover:bg-indigo-500/25 border border-indigo-500/30 transition-all flex items-center justify-center gap-1.5"
            >
              Enqueue 10 Jobs
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
