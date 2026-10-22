import { describe, it, expect } from 'vitest';
import DatabaseConstructor from 'better-sqlite3';
import { RiskAnalyzerService } from '../../src/services/risk-analyzer.service.js';
import { DocumentChunk } from '../../src/models/document.js';

describe('RiskAnalyzerService Legal Clause Tests', () => {
  it('should detect unlimited liability and flag as CRITICAL', () => {
    const db = new DatabaseConstructor(':memory:');
    db.exec(`
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
    `);

    const analyzer = new RiskAnalyzerService(db);

    const chunks: DocumentChunk[] = [
      {
        id: 'c1',
        documentId: 'doc_risk',
        chunkIndex: 0,
        paragraphRef: '§ 4 HAFTUNG',
        pageNumber: 1,
        chunkText: 'Die Parteien haften unbeschränkt für Folgeschäden, Produktionsstillstand und entgangenen Gewinn.',
        tokenCount: 15,
        embedding: [],
      },
      {
        id: 'c2',
        documentId: 'doc_risk',
        chunkIndex: 1,
        paragraphRef: '§ 3 STRAFE',
        pageNumber: 1,
        chunkText: 'Bei Verstoß wird eine pauschale Vertragsstrafe in Höhe von 250.000 EUR fällig.',
        tokenCount: 15,
        embedding: [],
      },
    ];

    const summary = analyzer.analyzeDocument('doc_risk', chunks);

    expect(summary.criticalCount).toBeGreaterThanOrEqual(1);
    expect(summary.highCount).toBeGreaterThanOrEqual(1);
    expect(summary.overallRiskScore).toBeGreaterThan(40);

    const criticalRisk = summary.risks.find((r) => r.severity === 'CRITICAL');
    expect(criticalRisk).toBeDefined();
    expect(criticalRisk?.clauseType).toBe('LIABILITY');
  });
});
