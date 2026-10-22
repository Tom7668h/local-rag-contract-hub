import dotenv from 'dotenv';
import path from 'path';

dotenv.config();

export interface EnvConfig {
  port: number;
  nodeEnv: string;
  ollamaHost: string;
  ollamaModel: string;
  databasePath: string;
  maxChunkSize: number;
  chunkOverlap: number;
}

export const env: EnvConfig = {
  port: parseInt(process.env.PORT || '3002', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  ollamaHost: process.env.OLLAMA_HOST || 'http://localhost:11434',
  ollamaModel: process.env.OLLAMA_MODEL || 'llama3.2',
  databasePath: process.env.DATABASE_PATH || path.resolve(process.cwd(), 'data', 'contracts.db'),
  maxChunkSize: parseInt(process.env.MAX_CHUNK_SIZE || '500', 10),
  chunkOverlap: parseInt(process.env.CHUNK_OVERLAP || '100', 10),
};
