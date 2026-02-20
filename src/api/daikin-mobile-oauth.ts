/**
 * Daikin Mobile OAuth Client
 *
 * Handles OAuth 2.0 authentication using the mobile app flow (Gigya + PKCE).
 * Provides:
 * - 5000 API calls/day (vs 200 for Developer Portal)
 * - WebSocket access for real-time device updates
 * - Automatic token refresh
 */

import * as fs from 'node:fs';
import * as https from 'node:https';
import * as crypto from 'node:crypto';
import {DAIKIN_MOBILE_CONFIG, TokenSet, MobileClientConfig} from './daikin-types';

interface PKCEPair {
    verifier: string;
    challenge: string;
}

interface GigyaLoginResult {
    errorCode: number;
    errorMessage?: string;
    errorDetails?: string;
    sessionInfo?: {
        login_token: string;
    };
}

export class DaikinMobileOAuth {
    private tokenSet: TokenSet | null = null;
    private refreshPromise: Promise<TokenSet> | null = null;
    private cookies = '';

    constructor(
        private readonly config: MobileClientConfig,
        private readonly onTokenUpdate?: (tokenSet: TokenSet) => void,
        private readonly onError?: (error: Error) => void,
    ) {
        this.loadTokenFromFile();
    }

    /**
     * Authenticate with email and password using mobile app flow.
     * Returns tokens with WebSocket access and 5000/day rate limit.
     */
    async authenticate(): Promise<TokenSet> {
        const pkce = this.generatePKCE();

        // Step 1: Get OIDC context
        const context = await this.getOidcContext(pkce);

        // Step 2: Initialize Gigya SDK (get cookies)
        this.cookies = await this.initGigyaSdk(context);

        // Step 3: Login with Gigya
        const loginToken = await this.gigyaLogin();

        // Step 4: Exchange for authorization code
        const code = await this.authorizeWithToken(context, loginToken);

        // Step 5: Exchange code for tokens at IDP
        const tokenSet = await this.exchangeCodeForTokens(code, pkce);

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

        this.refreshPromise = this.performRefresh();

        try {
            const tokenSet = await this.refreshPromise;
            this.setTokenSet(tokenSet);
            return tokenSet;
        } finally {
            this.refreshPromise = null;
        }
    }

    private async performRefresh(): Promise<TokenSet> {
        const basicAuth = Buffer.from(
            DAIKIN_MOBILE_CONFIG.clientId + ':' + DAIKIN_MOBILE_CONFIG.clientSecret,
        ).toString('base64');

        const params = new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: this.tokenSet!.refresh_token!,
        });

        const response = await this.httpsRequest(
            DAIKIN_MOBILE_CONFIG.idpTokenEndpoint,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + basicAuth,
                },
            },
            params.toString(),
        );

        const result = JSON.parse(response.body) as TokenSet & { error?: string; error_description?: string };

        if (result.error) {
            throw new Error('Token refresh failed: ' + (result.error_description || result.error));
        }

        return result;
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

    /**
     * Clear stored tokens
     */
    clearTokens(): void {
        this.deleteTokenFile();
        this.tokenSet = null;
    }

    // =========================================================================
    // Private authentication methods
    // =========================================================================

    private generatePKCE(): PKCEPair {
        const verifier = crypto.randomBytes(32).toString('base64url');
        const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
        return {verifier, challenge};
    }

    private async getOidcContext(pkce: PKCEPair): Promise<string> {
        const params = new URLSearchParams({
            client_id: DAIKIN_MOBILE_CONFIG.clientId,
            redirect_uri: DAIKIN_MOBILE_CONFIG.redirectUri,
            response_type: 'code',
            scope: DAIKIN_MOBILE_CONFIG.scope,
            code_challenge: pkce.challenge,
            code_challenge_method: 'S256',
            state: crypto.randomBytes(16).toString('hex'),
        });

        const oidcBase = DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/oidc/op/v1.0/' + DAIKIN_MOBILE_CONFIG.apiKey;
        const url = oidcBase + '/authorize?' + params;

        const response = await this.httpsRequest(url, {method: 'GET'});

        if (response.statusCode === 302 && response.headers.location) {
            const location = response.headers.location as string;
            const contextMatch = location.match(/context=([^&]+)/);
            if (contextMatch) {
                return decodeURIComponent(contextMatch[1]);
            }
        }

        throw new Error('Failed to get OIDC context');
    }

    private async initGigyaSdk(context: string): Promise<string> {
        const proxyUrl = 'https://id.daikin.eu/cdc/onecta/oidc/proxy.html?context=' + encodeURIComponent(context) + '&client_id=' + DAIKIN_MOBILE_CONFIG.clientId + '&mode=login&scope=' + encodeURIComponent(DAIKIN_MOBILE_CONFIG.scope) + '&gig_skipConsent=true';

        const params = new URLSearchParams({
            apiKey: DAIKIN_MOBILE_CONFIG.apiKey,
            pageURL: proxyUrl,
            sdk: 'js_latest',
            sdkBuild: '18305',
            format: 'json',
        });

        const response = await this.httpsRequest(
            DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/accounts.webSdkBootstrap?' + params,
            {
                method: 'GET',
                headers: {
                    'Accept': '*/*',
                    'Origin': 'https://id.daikin.eu',
                    'Referer': 'https://id.daikin.eu/',
                },
            },
        );

        // Extract cookies
        const cookies: string[] = [];
        const setCookies = response.headers['set-cookie'];
        if (setCookies) {
            const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies];
            for (const cookie of cookieArray) {
                const match = cookie.match(/^([^=]+=[^;]+)/);
                if (match) {
                    cookies.push(match[1]);
                }
            }
        }
        cookies.push('gig_bootstrap_' + DAIKIN_MOBILE_CONFIG.apiKey + '=cdc_ver4');

        return cookies.join('; ');
    }

    private generateRiskContext(): string {
        const now = new Date();
        const timeStr = now.getHours() + ':' + String(now.getMinutes()).padStart(2, '0') + ':' + String(now.getSeconds()).padStart(2, '0');
        return JSON.stringify({
            b0: 14063,
            b1: [0, 2, 2, 0],
            b2: 4,
            b3: [],
            b4: 2,
            b5: 1,
            b6: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko)',
            b7: [],
            b8: timeStr,
            b9: 0,
            b10: {state: 'denied'},
            b11: false,
            b12: null,
            b13: [5, '402|874|24', false, true],
        });
    }

    private async gigyaLogin(): Promise<string> {
        const params = new URLSearchParams({
            loginID: this.config.email,
            password: this.config.password,
            sessionExpiration: '31536000',
            targetEnv: 'jssdk',
            include: 'profile,data,emails,subscriptions,preferences,',
            includeUserInfo: 'true',
            loginMode: 'standard',
            lang: 'en',
            riskContext: this.generateRiskContext(),
            APIKey: DAIKIN_MOBILE_CONFIG.apiKey,
            source: 'showScreenSet',
            sdk: 'js_latest',
            authMode: 'cookie',
            pageURL: 'https://id.daikin.eu/cdc/onecta/oidc/registration-login.html?gig_client_id=' + DAIKIN_MOBILE_CONFIG.clientId,
            sdkBuild: '18305',
            format: 'json',
        });

        const response = await this.httpsRequest(
            DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/accounts.login',
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Origin': 'https://id.daikin.eu',
                    'Referer': 'https://id.daikin.eu/',
                    'Cookie': this.cookies,
                },
            },
            params.toString(),
        );

        const result = JSON.parse(response.body) as GigyaLoginResult;

        if (result.errorCode !== 0) {
            throw new Error('Login failed (' + result.errorCode + '): ' + (result.errorMessage || result.errorDetails));
        }

        if (!result.sessionInfo?.login_token) {
            throw new Error('No login_token in response');
        }

        return result.sessionInfo.login_token;
    }

    private async authorizeWithToken(context: string, loginToken: string): Promise<string> {
        const params = new URLSearchParams({
            context: context,
            login_token: loginToken,
        });

        const cookieStr = this.cookies + '; glt_' + DAIKIN_MOBILE_CONFIG.apiKey + '=' + loginToken;
        const oidcBase = DAIKIN_MOBILE_CONFIG.gigyaBaseUrl + '/oidc/op/v1.0/' + DAIKIN_MOBILE_CONFIG.apiKey;
        const url = oidcBase + '/authorize/continue?' + params;

        const response = await this.httpsRequest(url, {
            method: 'GET',
            headers: {
                'Cookie': cookieStr,
                'Referer': 'https://id.daikin.eu/',
            },
        });

        if (response.statusCode === 302 && response.headers.location) {
            const location = response.headers.location as string;
            const codeMatch = location.match(/code=([^&]+)/);
            if (codeMatch) {
                return codeMatch[1];
            }

            const errorMatch = location.match(/error=([^&]+)/);
            if (errorMatch) {
                const errorDesc = location.match(/error_description=([^&]+)/);
                throw new Error('Authorization error: ' + decodeURIComponent(errorDesc ? errorDesc[1] : errorMatch[1]));
            }
        }

        throw new Error('Failed to get authorization code');
    }

    private async exchangeCodeForTokens(code: string, pkce: PKCEPair): Promise<TokenSet> {
        const basicAuth = Buffer.from(
            DAIKIN_MOBILE_CONFIG.clientId + ':' + DAIKIN_MOBILE_CONFIG.clientSecret,
        ).toString('base64');

        const params = new URLSearchParams({
            grant_type: 'authorization_code',
            code: code,
            redirect_uri: DAIKIN_MOBILE_CONFIG.redirectUri,
            code_verifier: pkce.verifier,
        });

        const response = await this.httpsRequest(
            DAIKIN_MOBILE_CONFIG.idpTokenEndpoint,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + basicAuth,
                },
            },
            params.toString(),
        );

        const result = JSON.parse(response.body) as TokenSet & { error?: string; error_description?: string };

        if (result.error) {
            throw new Error('Token exchange failed: ' + (result.error_description || result.error));
        }

        return result;
    }

    // =========================================================================
    // Token storage methods
    // =========================================================================

    private setTokenSet(tokenSet: TokenSet): void {
        if (tokenSet.expires_in && !tokenSet.expires_at) {
            tokenSet.expires_at = Math.floor(Date.now() / 1000) + tokenSet.expires_in;
        }

        this.tokenSet = tokenSet;
        this.saveTokenToFile();

        if (this.onTokenUpdate) {
            this.onTokenUpdate(tokenSet);
        }
    }

    private loadTokenFromFile(): void {
        try {
            if (fs.existsSync(this.config.tokenFilePath)) {
                const data = fs.readFileSync(this.config.tokenFilePath, 'utf8');
                this.tokenSet = JSON.parse(data);
            }
        } catch (error) {
            if (this.onError) {
                this.onError(new Error('Failed to load token file: ' + (error as Error).message));
            }
        }
    }

    private saveTokenToFile(): void {
        try {
            // Write token file with restricted permissions (owner read/write only)
            fs.writeFileSync(
                this.config.tokenFilePath,
                JSON.stringify(this.tokenSet, null, 2),
                { encoding: 'utf8', mode: 0o600 },
            );
        } catch (error) {
            if (this.onError) {
                this.onError(new Error('Failed to save token file: ' + (error as Error).message));
            }
        }
    }

    private deleteTokenFile(): void {
        try {
            if (fs.existsSync(this.config.tokenFilePath)) {
                fs.unlinkSync(this.config.tokenFilePath);
            }
        } catch {
            // Ignore delete errors
        }
    }

    // =========================================================================
    // HTTP helper
    // =========================================================================

    private httpsRequest(
        url: string,
        options: { method: string; headers?: Record<string, string> },
        postData?: string,
    ): Promise<{ statusCode: number; headers: Record<string, string | string[] | undefined>; body: string }> {
        return new Promise((resolve, reject) => {
            const urlObj = new URL(url);
            const reqOptions: https.RequestOptions = {
                hostname: urlObj.hostname,
                port: 443,
                path: urlObj.pathname + urlObj.search,
                method: options.method,
                headers: {
                    ...options.headers,
                    ...(postData ? {'Content-Length': Buffer.byteLength(postData).toString()} : {}),
                },
            };

            const req = https.request(reqOptions, (res) => {
                let data = '';
                res.on('data', (chunk) => data += chunk);
                res.on('end', () => {
                    resolve({
                        statusCode: res.statusCode || 0,
                        headers: res.headers,
                        body: data,
                    });
                });
            });

            req.on('error', reject);

            if (postData) {
                req.write(postData);
            }
            req.end();
        });
    }
}
