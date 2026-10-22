export interface RagQueryRequest {
  query: string;
  documentId?: string;
  topK?: number;
  minScore?: number;
}

export interface Citation {
  chunkId: string;
  paragraphRef: string;
  pageNumber: number;
  snippet: string;
  relevanceScore: number;
}

export interface RagQueryResponse {
  answer: string;
  citations: Citation[];
  modelUsed: string;
  latencyMs: number;
  documentId?: string;
}

export type ClauseType = 'LIABILITY' | 'TERMINATION' | 'PENALTY' | 'NON_COMPETE' | 'IP_RIGHTS' | 'WARRANTY';
export type RiskSeverity = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export interface RiskClause {
  id: string;
  documentId: string;
  clauseType: ClauseType;
  severity: RiskSeverity;
  clauseText: string;
  riskAnalysis: string;
  recommendation: string;
  createdAt?: string;
}

export interface RiskSummary {
  totalClausesAnalyzed: number;
  criticalCount: number;
  highCount: number;
  mediumCount: number;
  lowCount: number;
  overallRiskScore: number; // 0 - 100
  risks: RiskClause[];
}
