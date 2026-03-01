/**
 * Token Storage Utility
 *
 * Provides shared token file operations for OAuth clients.
 * Ensures consistent file permissions and error handling.
 */

import * as fs from 'node:fs';
import type { TokenSet } from './daikin-types';
import { TokenSetSchema } from './daikin-schemas';

/** File permissions: owner read/write only */
const TOKEN_FILE_MODE = 0o600;

/**
 * Load a token set from a file.
 * Validates the loaded data against the TokenSetSchema.
 */
export function loadTokenFromFile(filePath: string): TokenSet | null {
  try {
    if (fs.existsSync(filePath)) {
      const data = fs.readFileSync(filePath, 'utf8');
      const parsed = JSON.parse(data);
      const result = TokenSetSchema.safeParse(parsed);
      if (result.success) {
        return result.data as TokenSet;
      }
      // Token file has invalid structure - treat as missing
      return null;
    }
  } catch {
    // Return null on any read/parse error
  }
  return null;
}

/**
 * Save a token set to a file with restricted permissions.
 */
export function saveTokenToFile(filePath: string, tokenSet: TokenSet): void {
  fs.writeFileSync(
    filePath,
    JSON.stringify(tokenSet, null, 2),
    { encoding: 'utf8', mode: TOKEN_FILE_MODE },
  );
}

/**
 * Delete a token file if it exists.
 */
export function deleteTokenFile(filePath: string): void {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch {
    // Ignore delete errors
  }
}
