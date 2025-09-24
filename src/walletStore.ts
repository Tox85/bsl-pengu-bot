import { mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname } from 'path';
import { randomBytes, scryptSync, createCipheriv, createDecipheriv } from 'crypto';
import { Wallet } from 'ethers';
import { PATHS, STRATEGY_CONSTANTS, env } from './config.js';
import type { HubWalletState, WalletRecord } from './types.js';
import { logger } from './logger.js';

const ALGORITHM = 'aes-256-gcm';
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;

const deriveKey = (password: string, salt: Buffer) => scryptSync(password, salt, 32);

const encrypt = (password: string, payload: string): string => {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(payload, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([salt, iv, tag, encrypted]).toString('base64');
};

const decrypt = (password: string, ciphertext: string): string => {
  const buffer = Buffer.from(ciphertext, 'base64');
  const salt = buffer.subarray(0, SALT_LENGTH);
  const iv = buffer.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const tag = buffer.subarray(SALT_LENGTH + IV_LENGTH, SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const encrypted = buffer.subarray(SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH);
  const key = deriveKey(password, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString('utf8');
};

const ensureDirectory = (filePath: string) => {
  mkdirSync(dirname(filePath), { recursive: true });
};

export const generateWalletRecords = (count: number): WalletRecord[] => {
  return Array.from({ length: count }).map((_, index) => {
    const wallet = Wallet.createRandom();
    return {
      label: index === STRATEGY_CONSTANTS.hubIndex ? 'hub' : `satellite-${index}`,
      address: wallet.address,
      privateKey: wallet.privateKey,
    } satisfies WalletRecord;
  });
};

export const loadWalletRecords = (): WalletRecord[] | null => {
  try {
    const content = readFileSync(PATHS.walletStore, 'utf8');
    const decrypted = decrypt(env.HUB_WALLET_PASSWORD, content);
    return JSON.parse(decrypted) as WalletRecord[];
  } catch (error) {
    logger.warn({ err: error }, 'Unable to load existing wallet store');
    return null;
  }
};

export const persistWalletRecords = (records: WalletRecord[]) => {
  ensureDirectory(PATHS.walletStore);
  const payload = JSON.stringify(records, null, 2);
  const encrypted = encrypt(env.HUB_WALLET_PASSWORD, payload);
  writeFileSync(PATHS.walletStore, encrypted, 'utf8');
  logger.info({ count: records.length, path: PATHS.walletStore }, 'Wallet store saved');
};

export const ensureWalletState = (): HubWalletState => {
  const existing = loadWalletRecords();
  if (existing && existing.length >= STRATEGY_CONSTANTS.walletCount) {
    const hub = existing[STRATEGY_CONSTANTS.hubIndex];
    const satellites = existing.filter((_, index) => index !== STRATEGY_CONSTANTS.hubIndex);
    return { hub, satellites };
  }

  logger.info('Generating new deterministic wallet set');
  const generated = generateWalletRecords(STRATEGY_CONSTANTS.walletCount);
  persistWalletRecords(generated);
  const hub = generated[STRATEGY_CONSTANTS.hubIndex];
  const satellites = generated.filter((_, index) => index !== STRATEGY_CONSTANTS.hubIndex);
  return { hub, satellites };
};
