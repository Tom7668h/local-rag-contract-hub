import { Router, Request, Response } from 'express';
import { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { RagPipelineService } from '../services/rag-pipeline.service.js';
import { RiskAnalyzerService } from '../services/risk-analyzer.service.js';
import { VectorStore } from '../db/vector-store.js';
import { env } from '../config/env.js';

export function createRagRoutes(
  db: BetterSqliteDatabase,
  ragPipeline: RagPipelineService,
  riskAnalyzer: RiskAnalyzerService,
  vectorStore: VectorStore
): Router {
  const router = Router();

  // Answer query with citations
  router.post('/ask', async (req: Request, res: Response) => {
    try {
      const { query, documentId, topK } = req.body;
      if (!query || typeof query !== 'string' || !query.trim()) {
        return res.status(400).json({ success: false, error: 'Query parameter is required' });
      }

      const response = await ragPipeline.answerQuestion({
        query: query.trim(),
        documentId: documentId || undefined,
        topK: topK ? parseInt(topK, 10) : 4,
      });

      res.json({
        success: true,
        ...response,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // Get risk analysis for document
  router.get('/risks/:documentId', (req: Request, res: Response) => {
    try {
      const docId = Array.isArray(req.params.documentId) ? req.params.documentId[0] : req.params.documentId;
      const risks = riskAnalyzer.getRisksForDocument(docId);
      res.json({
        success: true,
        documentId: docId,
        totalRisks: risks.length,
        risks,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // Query history logs
  router.get('/history', (_req: Request, res: Response) => {
    try {
      const history = db
        .prepare('SELECT id, document_id as documentId, user_query as query, ai_response as response, citations_json as citationsJson, model_used as modelUsed, latency_ms as latencyMs, created_at as createdAt FROM query_history ORDER BY created_at DESC LIMIT 25')
        .all() as any[];

      const formatted = history.map((h) => ({
        ...h,
        citations: JSON.parse(h.citationsJson || '[]'),
      }));

      res.json({ success: true, history: formatted });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // Health and Local AI connectivity status
  router.get('/status', async (_req: Request, res: Response) => {
    let ollamaOnline = false;
    let availableModels: string[] = [];

    try {
      const resp = await fetch(`${env.ollamaHost}/api/tags`, { method: 'GET', signal: AbortSignal.timeout(1500) });
      if (resp.ok) {
        ollamaOnline = true;
        const data = (await resp.json()) as { models?: { name: string }[] };
        availableModels = (data.models || []).map((m) => m.name);
      }
    } catch (e) {
      ollamaOnline = false;
    }

    const chunkCount = vectorStore.getChunkCount();
    const docCountRow = db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number };

    res.json({
      status: 'UP',
      service: 'Air-Gapped Local RAG Contract Hub',
      mode: ollamaOnline ? 'HYBRID_LOCAL_OLLAMA' : 'AIR_GAPPED_DETERMINISTIC_FALLBACK',
      ollama: {
        online: ollamaOnline,
        host: env.ollamaHost,
        configuredModel: env.ollamaModel,
        availableModels,
      },
      vectorStore: {
        totalDocuments: docCountRow?.cnt || 0,
        totalChunks: chunkCount,
        dimensions: 64,
        metric: 'Cosine-Similarity',
      },
    });
  });

  return router;
}
