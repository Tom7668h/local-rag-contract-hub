import { Router, Request, Response } from 'express';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { DocumentParserService } from '../services/document-parser.service.js';
import { EmbeddingService } from '../services/embedding.service.js';
import { VectorStore } from '../db/vector-store.js';
import { RiskAnalyzerService } from '../services/risk-analyzer.service.js';
import { DocumentRecord } from '../models/document.js';

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

export function createDocumentRoutes(
  db: BetterSqliteDatabase,
  parserService: DocumentParserService,
  embeddingService: EmbeddingService,
  vectorStore: VectorStore,
  riskAnalyzer: RiskAnalyzerService
): Router {
  const router = Router();

  // List all documents
  router.get('/', (_req: Request, res: Response) => {
    const docs = db
      .prepare(`
        SELECT d.id, d.filename, d.title, d.document_type as documentType, d.file_size as fileSize, d.created_at as createdAt,
               COUNT(c.id) as chunkCount
        FROM documents d
        LEFT JOIN document_chunks c ON d.id = c.document_id
        GROUP BY d.id
        ORDER BY d.created_at DESC
      `)
      .all() as any[];

    res.json({ success: true, documents: docs });
  });

  // Get specific document by ID with chunks and risks
  router.get('/:id', (req: Request, res: Response) => {
    const docId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const doc = db
      .prepare('SELECT id, filename, title, document_type as documentType, file_size as fileSize, raw_text as rawText, created_at as createdAt FROM documents WHERE id = ?')
      .get(docId) as DocumentRecord | undefined;

    if (!doc) {
      return res.status(404).json({ success: false, error: 'Document not found' });
    }

    const chunks = db
      .prepare('SELECT id, chunk_index as chunkIndex, paragraph_ref as paragraphRef, page_number as pageNumber, chunk_text as chunkText, token_count as tokenCount FROM document_chunks WHERE document_id = ? ORDER BY chunk_index ASC')
      .all(docId);

    const risks = riskAnalyzer.getRisksForDocument(docId);

    res.json({
      success: true,
      document: doc,
      chunks,
      risks,
    });
  });

  // Upload or ingest document
  router.post('/upload', upload.single('file'), async (req: Request, res: Response) => {
    try {
      let rawText = '';
      let filename = 'document.txt';

      if (req.file) {
        rawText = req.file.buffer.toString('utf-8');
        filename = req.file.originalname;
      } else if (req.body.text) {
        rawText = req.body.text;
        filename = req.body.filename || 'manual_contract.txt';
      }

      if (!rawText.trim()) {
        return res.status(400).json({ success: false, error: 'No text or file provided' });
      }

      const docId = `doc_${randomUUID().substring(0, 8)}`;
      const title = req.body.title || filename.replace(/\.[^/.]+$/, '');

      // 1. Save Document Master Record
      db.prepare(`
        INSERT INTO documents (id, filename, title, document_type, file_size, raw_text)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(docId, filename, title, req.body.documentType || 'CONTRACT', rawText.length, rawText);

      const docRecord: DocumentRecord = {
        id: docId,
        filename,
        title,
        documentType: 'CONTRACT',
        fileSize: rawText.length,
        rawText,
      };

      // 2. Parse into Chunks
      const chunks = parserService.parseAndChunk(docRecord);

      // 3. Generate Vector Embeddings
      for (const chunk of chunks) {
        chunk.embedding = await embeddingService.generateEmbedding(chunk.chunkText);
      }

      // 4. Save to Vector Store
      vectorStore.saveBatch(chunks);

      // 5. Run Automated Legal Risk Assessment
      const riskSummary = riskAnalyzer.analyzeDocument(docId, chunks);

      res.json({
        success: true,
        document: {
          id: docId,
          title,
          filename,
          chunkCount: chunks.length,
        },
        riskSummary,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // Load demo NDA contract
  router.post('/seed-demo', async (_req: Request, res: Response) => {
    try {
      const candidates = [
        path.resolve(process.cwd(), 'data', 'demo_nda_contract.txt'),
        path.resolve(process.cwd(), 'local-rag-contract-hub', 'data', 'demo_nda_contract.txt'),
        path.resolve(import.meta.dirname ?? '.', '../../data/demo_nda_contract.txt'),
      ];

      let rawText = '';
      for (const p of candidates) {
        if (fs.existsSync(p)) {
          rawText = fs.readFileSync(p, 'utf-8');
          break;
        }
      }

      if (!rawText) {
        return res.status(500).json({ success: false, error: 'Demo contract file not found' });
      }

      const docId = 'doc_demo_nda_2026';
      const filename = 'ApexTech_Nordic_NDA_2026.txt';
      const title = 'ApexTech & Nordic Automotive Systems - Geheimhaltungsvereinbarung (NDA)';

      // Insert or replace
      db.prepare(`
        INSERT OR REPLACE INTO documents (id, filename, title, document_type, file_size, raw_text)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(docId, filename, title, 'CONTRACT', rawText.length, rawText);

      const docRecord: DocumentRecord = {
        id: docId,
        filename,
        title,
        documentType: 'CONTRACT',
        fileSize: rawText.length,
        rawText,
      };

      const chunks = parserService.parseAndChunk(docRecord);
      for (const chunk of chunks) {
        chunk.embedding = await embeddingService.generateEmbedding(chunk.chunkText);
      }
      vectorStore.saveBatch(chunks);

      const riskSummary = riskAnalyzer.analyzeDocument(docId, chunks);

      res.json({
        success: true,
        message: 'Demo contract seeded and vectorized successfully',
        document: {
          id: docId,
          title,
          chunkCount: chunks.length,
        },
        riskSummary,
      });
    } catch (e) {
      res.status(500).json({ success: false, error: (e as Error).message });
    }
  });

  // Delete document
  router.delete('/:id', (req: Request, res: Response) => {
    const docId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    db.prepare('DELETE FROM documents WHERE id = ?').run(docId);
    db.prepare('DELETE FROM document_chunks WHERE document_id = ?').run(docId);
    db.prepare('DELETE FROM risk_assessments WHERE document_id = ?').run(docId);
    res.json({ success: true, message: 'Document deleted' });
  });

  return router;
}
