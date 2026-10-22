export interface DocumentRecord {
  id: string;
  filename: string;
  title: string;
  documentType: string;
  fileSize: number;
  rawText: string;
  createdAt?: string;
  chunkCount?: number;
}

export interface DocumentChunk {
  id: string;
  documentId: string;
  chunkIndex: number;
  paragraphRef: string;
  pageNumber: number;
  chunkText: string;
  tokenCount: number;
  embedding: number[];
  createdAt?: string;
}

export interface ScoredChunk extends DocumentChunk {
  similarityScore: number;
  matchType: 'SEMANTIC' | 'KEYWORD' | 'HYBRID';
}
