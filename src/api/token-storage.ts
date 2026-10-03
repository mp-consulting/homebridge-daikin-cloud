/**
 * Token Storage Utility
 *
 * Provides shared token file operations for OAuth clients.
 * Ensures consistent file permissions and error handling.
 */

import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
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
        return result.data;
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
 *
 * Writes atomically (temp file + rename) so a crash mid-write never leaves a
 * truncated token file behind. `mode` on writeFileSync only applies when a
 * file is created, so a pre-existing world-readable token file would keep its
 * permissions: the temp file is always freshly created with 0600 and replaces
 * the old inode, and the final file is chmod'ed again for good measure.
 */
export function saveTokenToFile(filePath: string, tokenSet: TokenSet): void {
  const tempPath = `${filePath}.tmp-${crypto.randomBytes(8).toString('hex')}`;
  try {
    fs.writeFileSync(
      tempPath,
      JSON.stringify(tokenSet, null, 2),
      { encoding: 'utf8', mode: TOKEN_FILE_MODE, flag: 'wx' },
    );
    fs.renameSync(tempPath, filePath);
  } catch (error) {
    try {
      fs.rmSync(tempPath, { force: true });
    } catch {
      // Best effort cleanup
    }
    throw error;
  }
  try {
    fs.chmodSync(filePath, TOKEN_FILE_MODE);
  } catch {
    // Platforms without POSIX permissions (Windows)
  }
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
