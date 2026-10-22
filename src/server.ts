import express, { Express } from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { env } from './config/env.js';
import { getDatabase } from './db/database.js';
import { VectorStore } from './db/vector-store.js';
import { DocumentParserService } from './services/document-parser.service.js';
import { EmbeddingService } from './services/embedding.service.js';
import { RiskAnalyzerService } from './services/risk-analyzer.service.js';
import { RagPipelineService } from './services/rag-pipeline.service.js';
import { createDocumentRoutes } from './routes/document.routes.js';
import { createRagRoutes } from './routes/rag.routes.js';
import { createLogger } from './utils/logger.js';
import { DocumentRecord } from './models/document.js';

const logger = createLogger('Server');

export function createApp(customDb?: any) {
  const app: Express = express();
  const db = customDb || getDatabase();

  const vectorStore = new VectorStore(db);
  const parserService = new DocumentParserService();
  const embeddingService = new EmbeddingService();
  const riskAnalyzer = new RiskAnalyzerService(db);
  const ragPipeline = new RagPipelineService(db, vectorStore, embeddingService);

  // Global Middleware
  app.use(cors());
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // Static Dashboard Assets
  const publicPaths = [
    path.resolve(process.cwd(), 'public'),
    path.resolve(process.cwd(), 'local-rag-contract-hub', 'public'),
    path.resolve(import.meta.dirname ?? '.', '../public'),
  ];

  for (const p of publicPaths) {
    if (fs.existsSync(p)) {
      app.use(express.static(p));
      break;
    }
  }

  // API Domain Routes
  app.use('/api/documents', createDocumentRoutes(db, parserService, embeddingService, vectorStore, riskAnalyzer));
  app.use('/api/rag', createRagRoutes(db, ragPipeline, riskAnalyzer, vectorStore));

  // Healthcheck
  app.get('/health', (_req, res) => {
    res.json({
      status: 'UP',
      service: 'local-rag-contract-hub',
      timestamp: new Date().toISOString(),
      database: 'SQLite (Air-Gapped)',
    });
  });

  return { app, db, vectorStore, parserService, embeddingService, riskAnalyzer, ragPipeline };
}

// Auto-seed demo document if empty
async function autoSeedIfEmpty(db: any, parser: DocumentParserService, embedder: EmbeddingService, vectors: VectorStore, risks: RiskAnalyzerService) {
  try {
    const row = db.prepare('SELECT COUNT(*) as cnt FROM documents').get() as { cnt: number };
    if (!row || row.cnt === 0) {
      logger.info('Database is empty. Ingesting default demo NDA contract...');
      const candidates = [
        path.resolve(process.cwd(), 'data', 'demo_nda_contract.txt'),
        path.resolve(process.cwd(), 'local-rag-contract-hub', 'data', 'demo_nda_contract.txt'),
      ];

      for (const c of candidates) {
        if (fs.existsSync(c)) {
          const raw = fs.readFileSync(c, 'utf-8');
          const docId = 'doc_demo_nda_2026';
          const filename = 'ApexTech_Nordic_NDA_2026.txt';
          const title = 'ApexTech & Nordic Automotive Systems - Geheimhaltungsvereinbarung (NDA)';

          db.prepare('INSERT OR REPLACE INTO documents (id, filename, title, document_type, file_size, raw_text) VALUES (?, ?, ?, ?, ?, ?)')
            .run(docId, filename, title, 'CONTRACT', raw.length, raw);

          const docRecord: DocumentRecord = { id: docId, filename, title, documentType: 'CONTRACT', fileSize: raw.length, rawText: raw };
          const chunks = parser.parseAndChunk(docRecord);
          for (const chk of chunks) {
            chk.embedding = await embedder.generateEmbedding(chk.chunkText);
          }
          vectors.saveBatch(chunks);
          risks.analyzeDocument(docId, chunks);
          logger.info(`Successfully ingested demo contract (${chunks.length} chunks) and vectorized into SQLite.`);
          break;
        }
      }
    }
  } catch (e) {
    logger.warn('Auto-seed notice: ' + (e as Error).message);
  }
}

// Direct Execution Entry Point
if (process.env.NODE_ENV !== 'test') {
  const { app, db, parserService, embeddingService, vectorStore, riskAnalyzer } = createApp();

  autoSeedIfEmpty(db, parserService, embeddingService, vectorStore, riskAnalyzer).then(() => {
    app.listen(env.port, () => {
      logger.info(`============================================================`);
      logger.info(`🛡️  Local RAG Contract Hub running at http://localhost:${env.port}`);
      logger.info(`⚡ Glassmorphic Web Dashboard: http://localhost:${env.port}`);
      logger.info(`🔒 Mode: Air-Gapped Privacy-First Vector RAG`);
      logger.info(`============================================================`);
    });
  });
}

export default createApp;
