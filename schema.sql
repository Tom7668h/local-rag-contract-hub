-- Documents Master Table
CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    filename TEXT NOT NULL,
    title TEXT NOT NULL,
    document_type TEXT NOT NULL DEFAULT 'CONTRACT',
    file_size INTEGER NOT NULL,
    raw_text TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Semantic Chunks with Vector Embeddings
CREATE TABLE IF NOT EXISTS document_chunks (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    chunk_index INTEGER NOT NULL,
    paragraph_ref TEXT,
    page_number INTEGER DEFAULT 1,
    chunk_text TEXT NOT NULL,
    token_count INTEGER NOT NULL,
    embedding_json TEXT NOT NULL,  -- JSON serialized float vector
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_chunks_doc ON document_chunks(document_id);
CREATE INDEX IF NOT EXISTS idx_chunks_idx ON document_chunks(chunk_index);

-- Extracted Risk Assessments
CREATE TABLE IF NOT EXISTS risk_assessments (
    id TEXT PRIMARY KEY,
    document_id TEXT NOT NULL,
    clause_type TEXT NOT NULL,     -- 'LIABILITY', 'TERMINATION', 'PENALTY', 'NON_COMPETE', 'IP_RIGHTS'
    severity TEXT NOT NULL,        -- 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'
    clause_text TEXT NOT NULL,
    risk_analysis TEXT NOT NULL,
    recommendation TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_risk_doc ON risk_assessments(document_id);
CREATE INDEX IF NOT EXISTS idx_risk_severity ON risk_assessments(severity);

-- RAG Query Logs with Citation Tracing
CREATE TABLE IF NOT EXISTS query_history (
    id TEXT PRIMARY KEY,
    document_id TEXT,
    user_query TEXT NOT NULL,
    ai_response TEXT NOT NULL,
    citations_json TEXT NOT NULL,
    model_used TEXT NOT NULL,
    latency_ms INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
