-- PostgreSQL schema for durable job history and audit trail

CREATE TABLE IF NOT EXISTS job_history (
    id UUID PRIMARY KEY,
    type TEXT NOT NULL,
    payload JSONB,
    priority INT NOT NULL DEFAULT 5,
    status TEXT NOT NULL DEFAULT 'pending',
    retry_count INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    error_log JSONB DEFAULT '[]'::jsonb,
    worker_id TEXT
);

-- Indexes for status filtering and time-based dashboard queries
CREATE INDEX IF NOT EXISTS idx_job_history_status ON job_history(status);
CREATE INDEX IF NOT EXISTS idx_job_history_created_at ON job_history(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_job_history_completed_at ON job_history(completed_at DESC);
