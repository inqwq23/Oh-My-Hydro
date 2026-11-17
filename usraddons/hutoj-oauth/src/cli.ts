import { digest, random, scopes, string } from './oauth.ts';
import type { OAuth } from './oauth.ts';

export function createCLI(oauth: OAuth, ready: Promise<void> = Promise.resolve()) {
    return {
        async create(name: string, redirectUris: string[], scope = 'profile') {
            await ready;
            return oauth.createClient(name, redirectUris, scope);
        },
        async list() {
            await ready;
            return oauth.ports.clients.find({}, { projection: { secretHash: 0 } }).toArray();
        },
        async update(clientId: string, name: string, redirectUris: string[], scope: string) {
            await ready;
            return oauth.editClient(string(clientId, 128), {
                name: string(name, 120), redirectUris: oauth.redirectUris(redirectUris), scopes: scopes(scope),
            });
        },
        async disable(clientId: string) {
            await ready;
            return oauth.editClient(string(clientId, 128), { enabled: false });
        },
        async enable(clientId: string) {
            await ready;
            return oauth.editClient(string(clientId, 128), { enabled: true });
        },
        async rotateSecret(clientId: string) {
            await ready;
            const secret = `hto_s_${random()}`;
            const client = await oauth.editClient(string(clientId, 128), { secretHash: digest(secret) });
            return { ...client, client_secret: secret };
        },
    };
}
