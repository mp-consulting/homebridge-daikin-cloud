import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { loadTokenFromFile, saveTokenToFile, deleteTokenFile } from '../../../src/api/token-storage';
import type { TokenSet } from '../../../src/api/daikin-types';

const isPosix = process.platform !== 'win32';

describe('Token Storage', () => {
  let tempDir: string;
  let filePath: string;
  const tokenSet: TokenSet = {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
    token_type: 'Bearer',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
  };

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'daikin-token-storage-'));
    filePath = path.join(tempDir, '.daikin-tokenset');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe('loadTokenFromFile', () => {
    it('should return null if file does not exist', () => {
      expect(loadTokenFromFile(filePath)).toBeNull();
    });

    it('should return parsed token set from file', () => {
      fs.writeFileSync(filePath, JSON.stringify(tokenSet));
      expect(loadTokenFromFile(filePath)).toEqual(tokenSet);
    });

    it('should return null on invalid JSON', () => {
      fs.writeFileSync(filePath, 'not-json{{{');
      expect(loadTokenFromFile(filePath)).toBeNull();
    });

    it('should return null on invalid token structure', () => {
      fs.writeFileSync(filePath, JSON.stringify({ foo: 'bar' }));
      expect(loadTokenFromFile(filePath)).toBeNull();
    });

    it('should return null if the file cannot be read', () => {
      fs.mkdirSync(filePath); // reading a directory throws EISDIR
      expect(loadTokenFromFile(filePath)).toBeNull();
    });
  });

  describe('saveTokenToFile', () => {
    it('should write the token set so it round-trips', () => {
      saveTokenToFile(filePath, tokenSet);
      expect(JSON.parse(fs.readFileSync(filePath, 'utf8'))).toEqual(tokenSet);
      expect(loadTokenFromFile(filePath)).toEqual(tokenSet);
    });

    it('should leave no temp files behind', () => {
      saveTokenToFile(filePath, tokenSet);
      saveTokenToFile(filePath, { ...tokenSet, access_token: 'second' });
      expect(fs.readdirSync(tempDir)).toEqual(['.daikin-tokenset']);
      expect(loadTokenFromFile(filePath)?.access_token).toBe('second');
    });

    it.runIf(isPosix)('should create the file with mode 0600', () => {
      saveTokenToFile(filePath, tokenSet);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
    });

    it.runIf(isPosix)('should tighten a pre-existing 0644 file to 0600', () => {
      fs.writeFileSync(filePath, '{}', { mode: 0o644 });
      fs.chmodSync(filePath, 0o644);
      expect(fs.statSync(filePath).mode & 0o777).toBe(0o644);

      saveTokenToFile(filePath, tokenSet);

      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(loadTokenFromFile(filePath)).toEqual(tokenSet);
    });

    it('should replace the file atomically (new inode, old content never truncated in place)', () => {
      fs.writeFileSync(filePath, JSON.stringify({ ...tokenSet, access_token: 'old' }));
      const before = fs.statSync(filePath).ino;

      saveTokenToFile(filePath, tokenSet);

      expect(fs.statSync(filePath).ino).not.toBe(before);
    });

    it('should throw and clean up the temp file when the target cannot be replaced', () => {
      fs.mkdirSync(filePath); // rename over a directory fails
      expect(() => saveTokenToFile(filePath, tokenSet)).toThrow();
      expect(fs.readdirSync(tempDir)).toEqual(['.daikin-tokenset']);
    });
  });

  describe('deleteTokenFile', () => {
    it('should delete file if it exists', () => {
      fs.writeFileSync(filePath, '{}');
      deleteTokenFile(filePath);
      expect(fs.existsSync(filePath)).toBe(false);
    });

    it('should not throw if file does not exist', () => {
      expect(() => deleteTokenFile(filePath)).not.toThrow();
    });

    it('should not throw if unlink fails', () => {
      fs.mkdirSync(filePath); // unlink on a directory fails
      expect(() => deleteTokenFile(filePath)).not.toThrow();
    });
  });
});
