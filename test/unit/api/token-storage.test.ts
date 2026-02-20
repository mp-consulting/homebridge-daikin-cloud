import * as fs from 'node:fs';
import {loadTokenFromFile, saveTokenToFile, deleteTokenFile} from '../../../src/api/token-storage';
import {TokenSet} from '../../../src/api/daikin-types';

jest.mock('node:fs');

const mockFs = fs as jest.Mocked<typeof fs>;

describe('Token Storage', () => {
    const filePath = '/tmp/test-token.json';
    const tokenSet: TokenSet = {
        access_token: 'test-access-token',
        refresh_token: 'test-refresh-token',
        token_type: 'Bearer',
        expires_in: 3600,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
    };

    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('loadTokenFromFile', () => {
        it('should return null if file does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            expect(loadTokenFromFile(filePath)).toBeNull();
        });

        it('should return parsed token set from file', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue(JSON.stringify(tokenSet));
            const result = loadTokenFromFile(filePath);
            expect(result).toEqual(tokenSet);
        });

        it('should return null on invalid JSON', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockReturnValue('not-json{{{');
            expect(loadTokenFromFile(filePath)).toBeNull();
        });

        it('should return null on invalid token structure', () => {
            mockFs.existsSync.mockReturnValue(true);
            // Missing required access_token and token_type
            mockFs.readFileSync.mockReturnValue(JSON.stringify({ foo: 'bar' }));
            expect(loadTokenFromFile(filePath)).toBeNull();
        });

        it('should return null if readFileSync throws', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.readFileSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });
            expect(loadTokenFromFile(filePath)).toBeNull();
        });
    });

    describe('saveTokenToFile', () => {
        it('should write token set with restricted permissions', () => {
            saveTokenToFile(filePath, tokenSet);
            expect(mockFs.writeFileSync).toHaveBeenCalledWith(
                filePath,
                JSON.stringify(tokenSet, null, 2),
                { encoding: 'utf8', mode: 0o600 },
            );
        });
    });

    describe('deleteTokenFile', () => {
        it('should delete file if it exists', () => {
            mockFs.existsSync.mockReturnValue(true);
            deleteTokenFile(filePath);
            expect(mockFs.unlinkSync).toHaveBeenCalledWith(filePath);
        });

        it('should not throw if file does not exist', () => {
            mockFs.existsSync.mockReturnValue(false);
            expect(() => deleteTokenFile(filePath)).not.toThrow();
            expect(mockFs.unlinkSync).not.toHaveBeenCalled();
        });

        it('should not throw if unlinkSync fails', () => {
            mockFs.existsSync.mockReturnValue(true);
            mockFs.unlinkSync.mockImplementation(() => {
                throw new Error('Permission denied');
            });
            expect(() => deleteTokenFile(filePath)).not.toThrow();
        });
    });
});
