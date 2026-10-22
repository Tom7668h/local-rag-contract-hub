import { describe, it, expect } from 'vitest';
import { DocumentParserService } from '../../src/services/document-parser.service.js';
import { DocumentRecord } from '../../src/models/document.js';

describe('DocumentParserService Tests', () => {
  const parser = new DocumentParserService();

  it('should split raw text into paragraphs and extract section references', () => {
    const text = `
PRÄAMBEL:
Dies ist die Einleitung des Vertrages zwischen den Parteien.

§ 1 GEGENSTAND DES VERTRAGES
Hier wird der Liefergegenstand geregelt.

§ 2 GEHEIMHALTUNG
Alle technischen Daten sind vertraulich zu behandeln.
    `;

    const doc: DocumentRecord = {
      id: 'doc_test',
      filename: 'contract.txt',
      title: 'Test Contract',
      documentType: 'CONTRACT',
      fileSize: text.length,
      rawText: text,
    };

    const chunks = parser.parseAndChunk(doc);
    expect(chunks.length).toBe(3);
    expect(chunks[0].paragraphRef).toContain('PRÄAMBEL');
    expect(chunks[1].paragraphRef).toContain('§ 1');
    expect(chunks[2].paragraphRef).toContain('§ 2');
  });

  it('should calculate page numbers and token estimations', () => {
    const doc: DocumentRecord = {
      id: 'doc_pages',
      filename: 'sample.txt',
      title: 'Sample',
      documentType: 'CONTRACT',
      fileSize: 100,
      rawText: 'Kurzer Textabschnitt für den Test.',
    };

    const chunks = parser.parseAndChunk(doc);
    expect(chunks.length).toBe(1);
    expect(chunks[0].pageNumber).toBe(1);
    expect(chunks[0].tokenCount).toBeGreaterThan(0);
  });
});
