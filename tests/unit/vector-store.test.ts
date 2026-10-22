import { describe, it, expect, beforeEach } from 'vitest';
import DatabaseConstructor from 'better-sqlite3';
import { VectorStore, cosineSimilarity } from '../../src/db/vector-store.js';
import { DocumentChunk } from '../../src/models/document.js';

describe('VectorStore & Cosine Similarity Tests', () => {
  it('should compute exact cosine similarity for identical vectors', () => {
    const vecA = [0.5, 0.5, 0.5, 0.5];
    const vecB = [0.5, 0.5, 0.5, 0.5];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(1.0, 4);
  });

  it('should compute 0.0 similarity for orthogonal vectors', () => {
    const vecA = [1.0, 0.0];
    const vecB = [0.0, 1.0];
    expect(cosineSimilarity(vecA, vecB)).toBeCloseTo(0.0, 4);
  });

  it('should store and retrieve nearest chunks ranked by score', () => {
    const db = new DatabaseConstructor(':memory:');
    db.exec(`
      CREATE TABLE document_chunks (
        id TEXT PRIMARY KEY,
        document_id TEXT NOT NULL,
        chunk_index INTEGER NOT NULL,
        paragraph_ref TEXT,
        page_number INTEGER DEFAULT 1,
        chunk_text TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        embedding_json TEXT NOT NULL
      );
    `);

    const store = new VectorStore(db);

    const chunk1: DocumentChunk = {
      id: 'c1',
      documentId: 'doc1',
      chunkIndex: 0,
      paragraphRef: '§ 1',
      pageNumber: 1,
      chunkText: 'Vertrauliche Informationen und Geheimhaltung',
      tokenCount: 10,
      embedding: [0.9, 0.1, 0.0],
    };

    const chunk2: DocumentChunk = {
      id: 'c2',
      documentId: 'doc1',
      chunkIndex: 1,
      paragraphRef: '§ 2',
      pageNumber: 1,
      chunkText: 'Vertragsstrafe in Höhe von 250.000 EUR',
      tokenCount: 12,
      embedding: [0.0, 0.9, 0.1],
    };

    store.saveBatch([chunk1, chunk2]);

    // Query close to chunk1
    const results = store.findSimilar([0.95, 0.05, 0.0], 'doc1', 2, 0.1);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].id).toBe('c1');
    expect(results[0].similarityScore).toBeGreaterThan(0.9);
  });
});
