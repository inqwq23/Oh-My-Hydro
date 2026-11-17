import type { Collection } from 'mongodb';

export interface Client {
    _id: string;
    name: string;
    secretHash: string;
    redirectUris: string[];
    scopes: string[];
    enabled: boolean;
    version: string;
    createdAt: Date;
}

export interface Grant {
    _id: string;
    kind: 'request' | 'code' | 'access';
    clientId: string;
    clientVersion: string;
    uid: number;
    scope: string[];
    redirectUri: string;
    challenge: string;
    state: string;
    sessionHash?: string;
    realnameVersion?: string;
    expiresAt: Date;
}

export interface Store {
    clients: Collection<Client>;
    grants: Collection<Grant>;
}

export async function initialize(store: Store) {
    await store.grants.createIndexes([
        { key: { expiresAt: 1 }, name: 'oauth_expiry', expireAfterSeconds: 0 },
        { key: { clientId: 1, uid: 1 }, name: 'oauth_owner' },
    ]);
}
