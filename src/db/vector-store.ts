import { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { DocumentChunk, ScoredChunk } from '../models/document.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('VectorStore');

/**
 * Calculates cosine similarity between two float vectors.
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length === 0 || vecB.length === 0 || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

export class VectorStore {
  private db: BetterSqliteDatabase;

  constructor(db: BetterSqliteDatabase) {
    this.db = db;
  }

  saveChunk(chunk: DocumentChunk): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO document_chunks (
        id, document_id, chunk_index, paragraph_ref, page_number, chunk_text, token_count, embedding_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      chunk.id,
      chunk.documentId,
      chunk.chunkIndex,
      chunk.paragraphRef,
      chunk.pageNumber,
      chunk.chunkText,
      chunk.tokenCount,
      JSON.stringify(chunk.embedding)
    );
  }

  saveBatch(chunks: DocumentChunk[]): void {
    const insert = this.db.prepare(`
      INSERT OR REPLACE INTO document_chunks (
        id, document_id, chunk_index, paragraph_ref, page_number, chunk_text, token_count, embedding_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const transaction = this.db.transaction((items: DocumentChunk[]) => {
      for (const item of items) {
        insert.run(
          item.id,
          item.documentId,
          item.chunkIndex,
          item.paragraphRef,
          item.pageNumber,
          item.chunkText,
          item.tokenCount,
          JSON.stringify(item.embedding)
        );
      }
    });

    transaction(chunks);
    logger.debug(`Saved batch of ${chunks.length} chunks to SQLite vector store.`);
  }

  findSimilar(queryEmbedding: number[], documentId?: string, topK: number = 4, minScore: number = 0.25): ScoredChunk[] {
    let sql = 'SELECT id, document_id, chunk_index, paragraph_ref, page_number, chunk_text, token_count, embedding_json FROM document_chunks';
    const params: unknown[] = [];

    if (documentId) {
      sql += ' WHERE document_id = ?';
      params.push(documentId);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const scored: ScoredChunk[] = [];

    for (const row of rows) {
      try {
        const embedding = JSON.parse(row.embedding_json) as number[];
        const score = cosineSimilarity(queryEmbedding, embedding);

        if (score >= minScore) {
          scored.push({
            id: row.id,
            documentId: row.document_id,
            chunkIndex: row.chunk_index,
            paragraphRef: row.paragraph_ref,
            pageNumber: row.page_number,
            chunkText: row.chunk_text,
            tokenCount: row.token_count,
            embedding,
            similarityScore: Math.round(score * 1000) / 1000,
            matchType: 'SEMANTIC',
          });
        }
      } catch (e) {
        logger.warn(`Failed to parse embedding for chunk ${row.id}`, e);
      }
    }

    scored.sort((a, b) => b.similarityScore - a.similarityScore);
    return scored.slice(0, topK);
  }

  findKeywordMatches(query: string, documentId?: string, topK: number = 4): ScoredChunk[] {
    const STOP_WORDS = new Set([
      'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
      'und', 'oder', 'aber', 'ist', 'sind', 'war', 'waren', 'wird', 'werden', 'wie', 'was', 'wo',
      'wer', 'warum', 'wann', 'mit', 'von', 'zu', 'zum', 'zur', 'in', 'im', 'am', 'an', 'auf',
      'für', 'nach', 'bei', 'über', 'unter', 'aus', 'durch', 'gibt', 'es', 'the', 'a', 'an', 'is',
      'are', 'in', 'on', 'at', 'of', 'to', 'for', 'with'
    ]);

    const terms = query
      .toLowerCase()
      .split(/\W+/)
      .filter((t) => t.length > 2 && !STOP_WORDS.has(t));

    if (terms.length === 0) return [];

    let sql = 'SELECT id, document_id, chunk_index, paragraph_ref, page_number, chunk_text, token_count, embedding_json FROM document_chunks';
    const params: unknown[] = [];

    if (documentId) {
      sql += ' WHERE document_id = ?';
      params.push(documentId);
    }

    const rows = this.db.prepare(sql).all(...params) as any[];
    const matches: ScoredChunk[] = [];

    for (const row of rows) {
      const lower = row.chunk_text.toLowerCase();
      let matchCount = 0;
      for (const t of terms) {
        if (lower.includes(t)) {
          matchCount++;
        }
      }

      if (matchCount > 0) {
        const score = Math.min(0.99, matchCount / terms.length);
        matches.push({
          id: row.id,
          documentId: row.document_id,
          chunkIndex: row.chunk_index,
          paragraphRef: row.paragraph_ref,
          pageNumber: row.page_number,
          chunkText: row.chunk_text,
          tokenCount: row.token_count,
          embedding: [],
          similarityScore: Math.round(score * 1000) / 1000,
          matchType: 'KEYWORD',
        });
      }
    }

    matches.sort((a, b) => b.similarityScore - a.similarityScore);
    return matches.slice(0, topK);
  }

  hybridSearch(query: string, queryEmbedding: number[], documentId?: string, topK: number = 4): ScoredChunk[] {
    const semantic = this.findSimilar(queryEmbedding, documentId, topK * 2, 0.20);
    const keyword = this.findKeywordMatches(query, documentId, topK * 2);

    const mergedMap = new Map<string, ScoredChunk>();

    for (const item of semantic) {
      mergedMap.set(item.id, item);
    }

    for (const item of keyword) {
      if (mergedMap.has(item.id)) {
        const existing = mergedMap.get(item.id)!;
        existing.similarityScore = Math.min(0.99, Math.round((existing.similarityScore * 0.4 + item.similarityScore * 0.6) * 1000) / 1000);
        existing.matchType = 'HYBRID';
      } else {
        mergedMap.set(item.id, item);
      }
    }

    const result = Array.from(mergedMap.values());
    result.sort((a, b) => b.similarityScore - a.similarityScore);
    return result.slice(0, topK);
  }

  getChunkCount(documentId?: string): number {
    if (documentId) {
      const row = this.db.prepare('SELECT COUNT(*) as cnt FROM document_chunks WHERE document_id = ?').get(documentId) as { cnt: number };
      return row.cnt;
    }
    const row = this.db.prepare('SELECT COUNT(*) as cnt FROM document_chunks').get() as { cnt: number };
    return row.cnt;
  }
}
