import { randomUUID } from 'crypto';
import { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { ClauseType, RiskClause, RiskSeverity, RiskSummary } from '../models/query.js';
import { DocumentChunk } from '../models/document.js';

interface RulePattern {
  clauseType: ClauseType;
  regex: RegExp;
  severity: RiskSeverity;
  analysisTemplate: (match: string) => string;
  recommendation: string;
}

const RISK_RULES: RulePattern[] = [
  // 1. Unlimited Liability & Consequential Damages
  {
    clauseType: 'LIABILITY',
    regex: /(unbeschr[aä]nkt|unbegrenzt|ohne\s+begrenzung).{0,50}(haftung|folgesch[aä]den|produktionsstillstand|entgangener\s+gewinn)/i,
    severity: 'CRITICAL',
    analysisTemplate: () =>
      'Unbeschränkte Haftung für mittelbare Schäden, Folgeschäden oder Produktionsausfall. Dies birgt ein existenzbedrohendes Schadensrisiko.',
    recommendation:
      'Haftung zwingend auf die Deckungssumme der Betriebshaftpflichtversicherung (oder das 1- bis 2-fache des jährlichen Auftragswerts) deckeln (Liability Cap).',
  },
  {
    clauseType: 'LIABILITY',
    regex: /(haftungsh[oö]chstgrenze|liability\s+cap).{0,40}(ausgeschlossen|entf[aä]llt|gilt\s+nicht)/i,
    severity: 'CRITICAL',
    analysisTemplate: () => 'Ausschluss einer vertraglichen Haftungshöchstgrenze (Liability Cap).',
    recommendation: 'Auf Aufnahme einer angemessenen Haftungsobergrenze (z. B. max. 1.000.000 EUR) bestehen.',
  },

  // 2. Heavy Contractual Penalties
  {
    clauseType: 'PENALTY',
    regex: /(vertragsstrafe|p[oö]nale).{0,60}(pauschal|h[oö]he\s+von)\s+([0-9.,]+)\s*(eur|euro)/i,
    severity: 'HIGH',
    analysisTemplate: (match) =>
      `Pauschale, verschuldensunabhängige Vertragsstrafe (${match}). Unverhältnismäßig hoch und gefährlich bei unverschuldeten Verzögerungen.`,
    recommendation:
      'Vertragsstrafe an nachweisliches Verschulden knüpfen, auf maximal 5 % des Auftragswertes deckeln und Karenzzeit (Grace Period) von mind. 5 Werktagen vereinbaren.',
  },
  {
    clauseType: 'PENALTY',
    regex: /(verschuldensunabh[aä]ngig|ohne\s+nachweis).{0,30}(vertragsstrafe|schadensersatz)/i,
    severity: 'HIGH',
    analysisTemplate: () => 'Verschuldensunabhängige Haftungs- oder Strafzahlung vereinbart.',
    recommendation: 'Auf Verschuldenserfordernis (Vorsatz und grobe Fahrlässigkeit) umformulieren.',
  },

  // 3. Unfavourable Termination & Lock-In
  {
    clauseType: 'TERMINATION',
    regex: /(feste\s+grundlaufzeit|mindestlaufzeit).{0,30}([3-9]|\d{2})\s*(jahre|jahren)/i,
    severity: 'HIGH',
    analysisTemplate: (match) => `Ungewöhnlich lange Bindungsfrist (${match}) ohne vorzeitige Ausstiegsmöglichkeit.`,
    recommendation: 'Sonderkündigungsrechte bei Leistungsstörungen oder Index-Preisanpassungen verhandeln.',
  },
  {
    clauseType: 'TERMINATION',
    regex: /(ordentliche\s+k[uü]ndigung).{0,30}(ausgeschlossen)/i,
    severity: 'MEDIUM',
    analysisTemplate: () => 'Ausschluss der ordentlichen Kündigung während der Vertragslaufzeit.',
    recommendation: 'Reguläre Kündigungsfrist von 3 bis 6 Monaten vereinbaren.',
  },
  {
    clauseType: 'TERMINATION',
    regex: /(k[uü]ndigungsfrist).{0,30}(12|zw[oö]lf)\s*monat/i,
    severity: 'MEDIUM',
    analysisTemplate: () => 'Sehr lange Kündigungsfrist (12 Monate) zum Jahresende.',
    recommendation: 'Verkürzung auf marktübliche 3 Monate anstreben.',
  },

  // 4. IP Rights & Know-How Transfer
  {
    clauseType: 'IP_RIGHTS',
    regex: /(abtretung|rechts[uü]bertragung).{0,40}(s[aä]mtlicher\s+erfindungen|ausschlie[ßs]lich|exklusiv)/i,
    severity: 'HIGH',
    analysisTemplate: () => 'Abtretung von gewerblichen Schutzrechten (IP) ohne Rückbehalt von eigenem Background-Know-how.',
    recommendation: 'Klare Trennung zwischen "Background IP" (bleibt beim Entwickler) und "Foreground IP" festschreiben.',
  },
];

export class RiskAnalyzerService {
  private db: BetterSqliteDatabase;

  constructor(db: BetterSqliteDatabase) {
    this.db = db;
  }

  analyzeDocument(documentId: string, chunks: DocumentChunk[]): RiskSummary {
    const identifiedRisks: RiskClause[] = [];

    // Clear previous assessments for this document
    this.db.prepare('DELETE FROM risk_assessments WHERE document_id = ?').run(documentId);

    const insertStmt = this.db.prepare(`
      INSERT INTO risk_assessments (id, document_id, clause_type, severity, clause_text, risk_analysis, recommendation)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);

    for (const chunk of chunks) {
      for (const rule of RISK_RULES) {
        const match = chunk.chunkText.match(rule.regex);
        if (match) {
          const risk: RiskClause = {
            id: `risk_${randomUUID().substring(0, 8)}`,
            documentId,
            clauseType: rule.clauseType,
            severity: rule.severity,
            clauseText: chunk.paragraphRef + ': "' + chunk.chunkText.substring(0, 160) + '..."',
            riskAnalysis: rule.analysisTemplate(match[0]),
            recommendation: rule.recommendation,
          };

          identifiedRisks.push(risk);

          insertStmt.run(
            risk.id,
            risk.documentId,
            risk.clauseType,
            risk.severity,
            risk.clauseText,
            risk.riskAnalysis,
            risk.recommendation
          );
        }
      }
    }

    // Tally risk counts
    let criticalCount = 0;
    let highCount = 0;
    let mediumCount = 0;
    let lowCount = 0;

    for (const r of identifiedRisks) {
      if (r.severity === 'CRITICAL') criticalCount++;
      else if (r.severity === 'HIGH') highCount++;
      else if (r.severity === 'MEDIUM') mediumCount++;
      else lowCount++;
    }

    // Overall Risk Score (0 = completely safe, 100 = extreme risk)
    const rawScore = criticalCount * 35 + highCount * 20 + mediumCount * 10 + lowCount * 5;
    const overallRiskScore = Math.min(100, Math.max(0, rawScore));

    return {
      totalClausesAnalyzed: chunks.length,
      criticalCount,
      highCount,
      mediumCount,
      lowCount,
      overallRiskScore,
      risks: identifiedRisks,
    };
  }

  getRisksForDocument(documentId: string): RiskClause[] {
    const rows = this.db
      .prepare(
        'SELECT id, document_id, clause_type, severity, clause_text, risk_analysis, recommendation, created_at FROM risk_assessments WHERE document_id = ? ORDER BY CASE severity WHEN "CRITICAL" THEN 1 WHEN "HIGH" THEN 2 WHEN "MEDIUM" THEN 3 ELSE 4 END'
      )
      .all(documentId) as any[];

    return rows.map((r) => ({
      id: r.id,
      documentId: r.document_id,
      clauseType: r.clause_type,
      severity: r.severity,
      clauseText: r.clause_text,
      riskAnalysis: r.risk_analysis,
      recommendation: r.recommendation,
      createdAt: r.created_at,
    }));
  }
}
