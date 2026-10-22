import { describe, it, expect, beforeAll } from 'vitest';
import request from 'supertest';
import DatabaseConstructor from 'better-sqlite3';
import { createApp } from '../../src/server.js';

describe('RAG Contract Hub API Integration Tests', () => {
  let app: any;
  let memDb: any;

  beforeAll(() => {
    memDb = new DatabaseConstructor(':memory:');
    memDb.exec(`
      CREATE TABLE documents (
        id TEXT PRIMARY KEY,
        filename TEXT NOT NULL,
        title TEXT NOT NULL,
        document_type TEXT NOT NULL DEFAULT 'CONTRACT',
        file_size INTEGER NOT NULL,
        raw_text TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        paragraph_ref TEXT,
        page_number INTEGER DEFAULT 1,
        chunk_text TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        embedding_json TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE risk_assessments (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        clause_type TEXT NOT NULL,
        severity TEXT NOT NULL,
        clause_text TEXT NOT NULL,
        risk_analysis TEXT NOT NULL,
        recommendation TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE query_history (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        user_query TEXT NOT NULL,
        ai_response TEXT NOT NULL,
        citations_json TEXT NOT NULL,
        model_used TEXT NOT NULL,
        latency_ms INTEGER NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    const serverInstance = createApp(memDb);
    app = serverInstance.app;
  });

  it('GET /health - should return UP status', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
  });

  it('POST /api/documents/seed-demo - should ingest demo NDA contract', async () => {
    const res = await request(app).post('/api/documents/seed-demo');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.document.chunkCount).toBeGreaterThan(0);
    expect(res.body.riskSummary.risks.length).toBeGreaterThan(0);
  });

  it('GET /api/documents - should return list of documents', async () => {
    const res = await request(app).get('/api/documents');
    expect(res.status).toBe(200);
    expect(res.body.documents.length).toBeGreaterThan(0);
  });

  it('POST /api/rag/ask - should answer query with citations', async () => {
    const res = await request(app)
      .post('/api/rag/ask')
      .send({
        query: 'Wie hoch ist die pauschale Vertragsstrafe?',
        documentId: 'doc_demo_nda_2026',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.answer).toContain('250.000');
    expect(res.body.citations.length).toBeGreaterThan(0);
    expect(res.body.citations.some((c: any) => c.paragraphRef.includes('§ 3'))).toBe(true);
  });

  it('GET /api/rag/status - should report local RAG and vector store telemetry', async () => {
    const res = await request(app).get('/api/rag/status');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('UP');
    expect(res.body.vectorStore.totalChunks).toBeGreaterThan(0);
  });
});
