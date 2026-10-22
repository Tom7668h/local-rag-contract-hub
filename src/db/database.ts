import DatabaseConstructor, { Database as BetterSqliteDatabase } from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { env } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('Database');

let dbInstance: BetterSqliteDatabase | null = null;

export function getDatabase(overridePath?: string): BetterSqliteDatabase {
  if (dbInstance) {
    return dbInstance;
  }

  const targetPath = overridePath || env.databasePath;

  if (targetPath !== ':memory:') {
    const dir = path.dirname(targetPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  dbInstance = new DatabaseConstructor(targetPath);
  dbInstance.pragma('journal_mode = WAL');
  dbInstance.pragma('foreign_keys = ON');

  initSchema(dbInstance);

  logger.info(`Connected to SQLite database at: ${targetPath}`);
  return dbInstance;
}

export function resetDatabase(inMemory: boolean = false): BetterSqliteDatabase {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
  return getDatabase(inMemory ? ':memory:' : env.databasePath);
}

function initSchema(db: BetterSqliteDatabase): void {
  const schemaCandidates = [
    path.resolve(process.cwd(), 'schema.sql'),
    path.resolve(process.cwd(), 'local-rag-contract-hub', 'schema.sql'),
    path.resolve(import.meta.dirname ?? '.', '../../schema.sql'),
  ];

  for (const p of schemaCandidates) {
    if (fs.existsSync(p)) {
      const sql = fs.readFileSync(p, 'utf-8');
      db.exec(sql);
      return;
    }
  }
  logger.warn('schema.sql could not be found for database initialization');
}
