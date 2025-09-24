import { writeFileSync, renameSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { BotError } from '../errors/BotError.js';

/**
 * Write data to file atomically using temporary file + rename
 */
export function writeAtomic(filePath: string, data: string | Buffer): void {
  try {
    // Ensure directory exists
    const dir = dirname(filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    // Write to temporary file first
    const tempPath = `${filePath}.tmp`;
    writeFileSync(tempPath, data);

    // Atomic rename
    renameSync(tempPath, filePath);
  } catch (error) {
    throw new BotError('NETWORK',
      `Failed to write file atomically: ${error instanceof Error ? error.message : 'Unknown error'}`,
      { filePath, error }
    );
  }
}

/**
 * Write JSON data atomically
 */
export function writeAtomicJson(filePath: string, data: any): void {
  const jsonData = JSON.stringify(data, (key, value) => {
    // Convert BigInt to string for JSON serialization
    if (typeof value === 'bigint') {
      return value.toString();
    }
    return value;
  }, 2);
  
  writeAtomic(filePath, jsonData);
}
