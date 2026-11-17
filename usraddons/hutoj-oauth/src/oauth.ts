import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Client, Grant, Store } from './model.ts';
import { realnameVersion, realnameView } from './realname.ts';
import type { RealnameRecord } from './realname.ts';

export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const random = () => randomBytes(32).toString('base64url');
export const challenge = (value: string) => createHash('sha256').update(value).digest('base64url');
const equal = (a: string, b: string) => timingSafeEqual(Buffer.from(digest(a)), Buffer.from(digest(b)));

export class OAuthError extends Error {
    error: string;
    status: number;
    constructor(error: string, status = 400) {
        super(error);
        this.error = error;
        this.status = status;
    }
}
export function fail(error: string, status = 400): never { throw new OAuthError(error, status); }
export function string(value: unknown, max = 2048): string {
    if (typeof value !== 'string' || !value.length || value.length > max || /[\x00-\x1f\x7f]/.test(value)) fail('invalid_request');
    return value;
}
export function scopes(value: unknown) {
    const result = [...new Set(string(value, 64).split(' '))];
    if (!result.includes('profile') || result.some((s) => !['profile', 'realname'].includes(s))) fail('invalid_scope');
    return result.sort();
}
export function only(input: Record<string, unknown>, keys: string[]) {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some((k) => !keys.includes(k))) {
        fail('invalid_request');
    }
}
export function basicCredentials(header: unknown) {
    if (typeof header !== 'string' || !/^Basic [A-Za-z0-9+/]+=*$/i.test(header) || header.length > 1024) fail('invalid_client', 401);
    const decoded = Buffer.from(header.slice(6), 'base64').toString('utf8');
    const colon = decoded.indexOf(':');
    if (colon < 1) fail('invalid_client', 401);
    try {
        return [decodeURIComponent(decoded.slice(0, colon).replace(/\+/g, ' ')),
            decodeURIComponent(decoded.slice(colon + 1).replace(/\+/g, ' '))] as const;
    } catch { return fail('invalid_client', 401); }
}

export interface Ports extends Store {
    user: (uid: number) => Promise<{ uid: number; username: string } | null>;
    realname: (uid: number) => Promise<RealnameRecord | null>;
    now?: () => Date;
    accessSeconds?: number;
    allowLoopbackHttp?: boolean;
}

export class OAuth {
    ports: Ports;
    now: () => Date;
    accessSeconds: number;
    constructor(ports: Ports) {
        this.ports = ports;
        this.now = ports.now || (() => new Date());
        this.accessSeconds = ports.accessSeconds ?? 600;
        if (!Number.isInteger(this.accessSeconds) || this.accessSeconds < 60 || this.accessSeconds > 3600) {
            throw new Error('accessSeconds must be an integer between 60 and 3600');
        }
    }

    redirectUris(value: unknown) {
        if (!Array.isArray(value) || !value.length || value.length > 20) fail('invalid_request');
        return [...new Set(value.map((entry) => {
            const raw = string(entry);
            let url: URL;
            try { url = new URL(raw); } catch { return fail('invalid_request'); }
            const loopback = this.ports.allowLoopbackHttp && url.protocol === 'http:'
                && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
            if ((!loopback && url.protocol !== 'https:') || url.username || url.password || raw.includes('#')
                || raw.includes('*') || raw.trim() !== raw
                || ['code', 'state', 'error', 'error_description'].some((key) => url.searchParams.has(key))) fail('invalid_request');
            return raw;
        }))];
    }

    publicClient(client: Client) {
        const { secretHash, ...result } = client;
        return result;
    }

    async createClient(name: unknown, redirectUris: unknown, scope: unknown = 'profile') {
        const clientSecret = `hto_s_${random()}`;
        const client: Client = {
            _id: `hto_c_${random()}`, name: string(name, 120),
            redirectUris: this.redirectUris(redirectUris), scopes: scopes(scope),
            secretHash: digest(clientSecret), enabled: true, version: random(), createdAt: this.now(),
        };
        await this.ports.clients.insertOne(client);
        return { ...this.publicClient(client), client_secret: clientSecret };
    }

    async editClient(id: string, patch: Partial<Pick<Client, 'name' | 'redirectUris' | 'scopes' | 'enabled' | 'secretHash'>>) {
        const client = await this.ports.clients.findOneAndUpdate(
            { _id: id }, { $set: { ...patch, version: random() } }, { returnDocument: 'after' },
        );
        if (!client) fail('invalid_client', 401);
        return this.publicClient(client);
    }

    async client(id: string) {
        const client = await this.ports.clients.findOne({ _id: id, enabled: true });
        if (!client) fail('invalid_client', 401);
        return client;
    }

    async validateRequest(input: Record<string, unknown>) {
        only(input, ['client_id', 'redirect_uri', 'response_type', 'scope', 'state', 'code_challenge', 'code_challenge_method']);
        const client = await this.client(string(input.client_id, 128));
        const redirectUri = string(input.redirect_uri);
        if (!client.redirectUris.includes(redirectUri)) fail('invalid_request');
        if (input.response_type !== 'code') fail('unsupported_response_type');
        const scope = scopes(input.scope);
        if (scope.some((s) => !client.scopes.includes(s))) fail('invalid_scope');
        const state = string(input.state, 512);
        if (state.length < 16) fail('invalid_request');
        const codeChallenge = string(input.code_challenge, 43);
        if (input.code_challenge_method !== 'S256' || !/^[\w-]{43}$/.test(codeChallenge)) fail('invalid_request');
        return { client, redirectUri, scope, state, codeChallenge };
    }

    async begin(input: Record<string, unknown>, uid: number, session: string) {
        const request = await this.validateRequest(input);
        if (!await this.ports.user(uid)) fail('access_denied', 403);
        const version = request.scope.includes('realname') ? realnameVersion(await this.ports.realname(uid)) : undefined;
        if (request.scope.includes('realname') && !version) return { clientName: request.client.name, required: true as const };
        const id = random();
        await this.ports.grants.insertOne({
            _id: digest(id), kind: 'request', clientId: request.client._id, clientVersion: request.client.version,
            uid, scope: request.scope, redirectUri: request.redirectUri, challenge: request.codeChallenge,
            state: request.state, sessionHash: digest(string(session)), realnameVersion: version,
            expiresAt: new Date(+this.now() + 600_000),
        });
        return { clientName: request.client.name, required: false as const, requestId: id, scope: request.scope };
    }

    async identity(grant: Grant, error: string) {
        const user = await this.ports.user(grant.uid);
        if (!user) fail(error, error === 'invalid_token' ? 401 : 400);
        if (!grant.scope.includes('realname')) return { ...user };
        const record = await this.ports.realname(grant.uid);
        if (!grant.realnameVersion || realnameVersion(record) !== grant.realnameVersion) {
            fail(error, error === 'invalid_token' ? 401 : 400);
        }
        return { ...user, realname: realnameView(record)! };
    }

    async active(grant: Grant, error: string) {
        const client = await this.ports.clients.findOne({ _id: grant.clientId, enabled: true, version: grant.clientVersion });
        if (!client || !client.redirectUris.includes(grant.redirectUri) || grant.scope.some((s) => !client.scopes.includes(s))) {
            fail(error, error === 'invalid_token' ? 401 : 400);
        }
    }

    async decide(id: unknown, uid: number, session: string, decision: unknown) {
        if (decision !== 'allow' && decision !== 'deny') fail('invalid_request');
        const grant = await this.ports.grants.findOneAndDelete({
            _id: digest(string(id, 64)), kind: 'request', uid,
            sessionHash: digest(string(session)), expiresAt: { $gt: this.now() },
        });
        if (!grant) fail('invalid_request');
        await this.active(grant, 'invalid_request');
        const url = new URL(grant.redirectUri);
        url.searchParams.set('state', grant.state);
        if (decision === 'deny') {
            url.searchParams.set('error', 'access_denied');
        } else {
            await this.identity(grant, 'authorization_changed');
            const code = `hto_code_${random()}`;
            const { sessionHash, ...data } = grant;
            await this.ports.grants.insertOne({ ...data, _id: digest(code), kind: 'code', expiresAt: new Date(+this.now() + 60_000) });
            url.searchParams.set('code', code);
        }
        return url.toString();
    }

    async exchange(input: Record<string, unknown>, authorization: unknown) {
        only(input, ['grant_type', 'code', 'redirect_uri', 'code_verifier']);
        const [id, secret] = basicCredentials(authorization);
        const client = await this.client(id);
        if (!equal(digest(secret), client.secretHash)) fail('invalid_client', 401);
        if (input.grant_type !== 'authorization_code') fail('unsupported_grant_type');
        const verifier = string(input.code_verifier, 128);
        if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) fail('invalid_grant');
        const grant = await this.ports.grants.findOneAndDelete({
            _id: digest(string(input.code, 128)), kind: 'code', clientId: id, clientVersion: client.version,
            redirectUri: string(input.redirect_uri), challenge: challenge(verifier), expiresAt: { $gt: this.now() },
        });
        if (!grant) fail('invalid_grant');
        await this.active(grant, 'invalid_grant');
        await this.identity(grant, 'invalid_grant');
        const token = `hto_at_${random()}`;
        await this.ports.grants.insertOne({
            ...grant, _id: digest(token), kind: 'access', challenge: '', state: '',
            expiresAt: new Date(+this.now() + this.accessSeconds * 1000),
        });
        return { access_token: token, token_type: 'Bearer', expires_in: this.accessSeconds, scope: grant.scope.join(' ') };
    }

    async userinfo(header: unknown) {
        if (typeof header !== 'string' || !/^Bearer hto_at_[\w-]{43}$/i.test(header)) fail('invalid_token', 401);
        const grant = await this.ports.grants.findOne({
            _id: digest(header.slice(7)), kind: 'access', expiresAt: { $gt: this.now() },
        });
        if (!grant) fail('invalid_token', 401);
        await this.active(grant, 'invalid_token');
        return this.identity(grant, 'invalid_token');
    }
}
