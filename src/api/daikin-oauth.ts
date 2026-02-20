/**
 * Daikin OAuth Client
 *
 * Handles OAuth 2.0 authentication with the Daikin Cloud API.
 */

import * as https from 'node:https';
import * as crypto from 'node:crypto';
import {DAIKIN_OIDC_CONFIG, TokenSet, DaikinClientConfig} from './daikin-types';
import {HTTP_REQUEST_TIMEOUT_MS} from '../constants';
import {loadTokenFromFile, saveTokenToFile, deleteTokenFile} from './token-storage';

export class DaikinOAuth {
    private tokenSet: TokenSet | null = null;
    private refreshPromise: Promise<TokenSet> | null = null;

    constructor(
        private readonly config: DaikinClientConfig,
        private readonly onTokenUpdate?: (tokenSet: TokenSet) => void,
        private readonly onError?: (error: Error) => void,
    ) {
        this.loadFromFile();
    }

    // =========================================================================
    // Static utility methods (for use by homebridge-ui)
    // =========================================================================

    /**
     * Build authorization URL (static version)
     */
    static buildAuthUrlStatic(clientId: string, redirectUri: string, state: string): string {
        const url = new URL(DAIKIN_OIDC_CONFIG.authorizationEndpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', clientId);
        url.searchParams.set('redirect_uri', redirectUri);
        url.searchParams.set('scope', DAIKIN_OIDC_CONFIG.scope);
        url.searchParams.set('state', state);
        return url.toString();
    }

    /**
     * Exchange authorization code for tokens (static version)
     */
    static async exchangeCodeStatic(
        code: string,
        clientId: string,
        clientSecret: string,
        redirectUri: string,
    ): Promise<TokenSet> {
        const tokenSet = await DaikinOAuth.makeStaticRequest(DAIKIN_OIDC_CONFIG.tokenEndpoint, {
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri,
            client_id: clientId,
            client_secret: clientSecret,
        });

        // Calculate expires_at if not present
        if (tokenSet.expires_in && !tokenSet.expires_at) {
            tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
        }

        return tokenSet;
    }

    /**
     * Revoke token (static version)
     */
    static async revokeTokenStatic(
        refreshToken: string,
        clientId: string,
        clientSecret: string,
    ): Promise<void> {
        await DaikinOAuth.makeStaticRequestRaw(DAIKIN_OIDC_CONFIG.revokeEndpoint, {
            token: refreshToken,
            token_type_hint: 'refresh_token',
            client_id: clientId,
            client_secret: clientSecret,
        });
    }

    /**
     * Make a static token request
     */
    private static async makeStaticRequest(url: string, params: Record<string, string>): Promise<TokenSet> {
        const response = await DaikinOAuth.makeStaticRequestRaw(url, params);
        const tokenSet = JSON.parse(response) as TokenSet;

        if ((tokenSet as unknown as { error?: string }).error) {
            const errorResponse = tokenSet as unknown as { error: string; error_description?: string };
            throw new Error(errorResponse.error_description || errorResponse.error);
        }

        return tokenSet;
    }

    /**
     * Make a raw static HTTP request
     */
    private static makeStaticRequestRaw(url: string, params: Record<string, string>): Promise<string> {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams(params).toString();
            const urlObj = new URL(url);

            const options: https.RequestOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
                req.destroy(new Error(`OAuth request timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }

    // =========================================================================
    // Instance methods
    // =========================================================================

    /**
     * Get the redirect URI for OAuth
     */
    getRedirectUri(): string {
        return `https://${this.config.callbackServerExternalAddress}:${this.config.callbackServerPort}`;
    }

    /**
     * Build the authorization URL
     */
    buildAuthUrl(state?: string): { url: string; state: string } {
        const authState = state || crypto.randomBytes(32).toString('hex');
        const url = new URL(DAIKIN_OIDC_CONFIG.authorizationEndpoint);
        url.searchParams.set('response_type', 'code');
        url.searchParams.set('client_id', this.config.clientId);
        url.searchParams.set('redirect_uri', this.getRedirectUri());
        url.searchParams.set('scope', DAIKIN_OIDC_CONFIG.scope);
        url.searchParams.set('state', authState);
        return {url: url.toString(), state: authState};
    }

    /**
     * Exchange authorization code for tokens
     */
    async exchangeCode(code: string): Promise<TokenSet> {
        const tokenSet = await this.makeTokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: this.getRedirectUri(),
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
        });

        this.setTokenSet(tokenSet);
        return tokenSet;
    }

    /**
     * Refresh the access token
     */
    async refreshToken(): Promise<TokenSet> {
        if (!this.tokenSet?.refresh_token) {
            throw new Error('No refresh token available');
        }

        // Prevent concurrent refresh requests
        if (this.refreshPromise) {
            return this.refreshPromise;
        }

        this.refreshPromise = this.makeTokenRequest({
            grant_type: 'refresh_token',
            refresh_token: this.tokenSet.refresh_token,
            client_id: this.config.clientId,
            client_secret: this.config.clientSecret,
        });

        try {
            const tokenSet = await this.refreshPromise;
            this.setTokenSet(tokenSet);
            return tokenSet;
        } finally {
            this.refreshPromise = null;
        }
    }

    /**
     * Revoke the current token
     */
    async revokeToken(): Promise<void> {
        if (!this.tokenSet?.refresh_token) {
            return;
        }

        try {
            await this.makeRequest(DAIKIN_OIDC_CONFIG.revokeEndpoint, {
                token: this.tokenSet.refresh_token,
                token_type_hint: 'refresh_token',
                client_id: this.config.clientId,
                client_secret: this.config.clientSecret,
            });
        } catch (error) {
            // Ignore revocation errors
        }

        this.deleteFile();
        this.tokenSet = null;
    }

    /**
     * Get a valid access token, refreshing if necessary
     */
    async getAccessToken(): Promise<string> {
        if (!this.tokenSet) {
            throw new Error('Not authenticated. Please authenticate first.');
        }

        // Check if token is expired or about to expire (10 second buffer)
        const now = Math.floor(Date.now() / 1000);
        const expiresAt = this.tokenSet.expires_at || 0;

        if (expiresAt < now + 10) {
            if (!this.tokenSet.refresh_token) {
                throw new Error('Token expired and no refresh token available. Please re-authenticate.');
            }
            await this.refreshToken();
        }

        return this.tokenSet!.access_token;
    }

    /**
     * Check if we have a valid token
     */
    isAuthenticated(): boolean {
        return this.tokenSet !== null && !!this.tokenSet.access_token;
    }

    /**
     * Get token expiration date
     */
    getTokenExpiration(): Date | null {
        if (!this.tokenSet?.expires_at) {
            return null;
        }
        return new Date(this.tokenSet.expires_at * 1000);
    }

    /**
     * Get current token set (for status display)
     */
    getTokenSet(): TokenSet | null {
        return this.tokenSet;
    }

    // Private methods

    private setTokenSet(tokenSet: TokenSet): void {
        // Calculate expires_at if not present
        if (tokenSet.expires_in && !tokenSet.expires_at) {
            tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
        }

        this.tokenSet = tokenSet;
        this.saveToFile();

        if (this.onTokenUpdate) {
            this.onTokenUpdate(tokenSet);
        }
    }

    private loadFromFile(): void {
        try {
            this.tokenSet = loadTokenFromFile(this.config.tokenFilePath);
        } catch (error) {
            if (this.onError) {
                this.onError(new Error(`Failed to load token file: ${(error as Error).message}`));
            }
        }
    }

    private saveToFile(): void {
        try {
            if (this.tokenSet) {
                saveTokenToFile(this.config.tokenFilePath, this.tokenSet);
            }
        } catch (error) {
            if (this.onError) {
                this.onError(new Error(`Failed to save token file: ${(error as Error).message}`));
            }
        }
    }

    private deleteFile(): void {
        deleteTokenFile(this.config.tokenFilePath);
    }

    private async makeTokenRequest(params: Record<string, string>): Promise<TokenSet> {
        const response = await this.makeRequest(DAIKIN_OIDC_CONFIG.tokenEndpoint, params);
        const tokenSet = JSON.parse(response) as TokenSet;

        if ((tokenSet as unknown as { error?: string }).error) {
            const errorResponse = tokenSet as unknown as { error: string; error_description?: string };
            throw new Error(errorResponse.error_description || errorResponse.error);
        }

        return tokenSet;
    }

    private makeRequest(url: string, params: Record<string, string>): Promise<string> {
        return new Promise((resolve, reject) => {
            const postData = new URLSearchParams(params).toString();
            const urlObj = new URL(url);

            const options: https.RequestOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname,
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Content-Length': Buffer.byteLength(postData),
                },
            };

            const req = https.request(options, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => resolve(data));
            });

            req.setTimeout(HTTP_REQUEST_TIMEOUT_MS, () => {
                req.destroy(new Error(`OAuth request timed out after ${HTTP_REQUEST_TIMEOUT_MS}ms`));
            });

            req.on('error', reject);
            req.write(postData);
            req.end();
        });
    }
}
