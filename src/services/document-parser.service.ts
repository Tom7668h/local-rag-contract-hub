import { randomUUID } from 'crypto';
import { DocumentChunk, DocumentRecord } from '../models/document.js';

export interface ChunkingOptions {
  maxChunkChars?: number;
  overlapChars?: number;
}

export class DocumentParserService {

  parseAndChunk(doc: DocumentRecord, options: ChunkingOptions = {}): DocumentChunk[] {
    const maxChars = options.maxChunkChars || 500;
    const overlap = options.overlapChars || 80;

    const raw = doc.rawText.trim();
    if (!raw) return [];

    // Split by paragraphs / legal section headers (§ 1, § 2, etc.)
    const rawParagraphs = raw.split(/\n\s*\n/);
    const chunks: DocumentChunk[] = [];
    let chunkIndex = 0;
    let currentPage = 1;

    for (let pIdx = 0; pIdx < rawParagraphs.length; pIdx++) {
      const pText = rawParagraphs[pIdx].trim();
      if (!pText) continue;

      // Extract paragraph reference if present (e.g. "§ 3 VERTRAGSSTRAFE", "PRÄAMBEL", "Art. 4")
      const sectionMatch = pText.match(/(§\s*\d+[A-Za-z]?|[A-ZÄÖÜ\s]{4,30}:|PRÄAMBEL|ANHANG\s*[A-Z0-9]?)/i);
      const paragraphRef = sectionMatch ? sectionMatch[1].trim() : `Abschnitt ${pIdx + 1}`;

      // Rough page estimation (every ~1800 chars is ~1 page)
      currentPage = Math.max(1, Math.floor(raw.indexOf(pText) / 1800) + 1);

      if (pText.length <= maxChars) {
        chunks.push({
          id: `chk_${randomUUID().substring(0, 8)}`,
          documentId: doc.id,
          chunkIndex: chunkIndex++,
          paragraphRef,
          pageNumber: currentPage,
          chunkText: pText,
          tokenCount: Math.ceil(pText.length / 4),
          embedding: [],
        });
      } else {
        // Sub-chunk with overlap
        let start = 0;
        let subIdx = 1;
        while (start < pText.length) {
          const end = Math.min(start + maxChars, pText.length);
          const slice = pText.substring(start, end).trim();

          if (slice.length > 20) {
            chunks.push({
              id: `chk_${randomUUID().substring(0, 8)}`,
              documentId: doc.id,
              chunkIndex: chunkIndex++,
              paragraphRef: `${paragraphRef} (Teil ${subIdx++})`,
              pageNumber: currentPage,
              chunkText: slice,
              tokenCount: Math.ceil(slice.length / 4),
              embedding: [],
            });
          }

          if (end >= pText.length) break;
          start += (maxChars - overlap);
        }
      }
    }

    return chunks;
  }
}
