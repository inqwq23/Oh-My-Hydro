import assert from 'node:assert/strict';
import { after, before, beforeEach, test } from 'node:test';
import { MongoClient } from 'mongodb';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { createCLI } from '../src/cli.ts';
import { initialize } from '../src/model.ts';
import type { Client, Grant } from '../src/model.ts';
import { challenge, digest, OAuth, OAuthError, random } from '../src/oauth.ts';
import type { RealnameRecord } from '../src/realname.ts';

let server: MongoMemoryServer;
let mongo: MongoClient;
let oauth: OAuth;
let client: Awaited<ReturnType<OAuth['createClient']>>;
let identity: RealnameRecord | null;
let user: { uid: number; username: string } | null;
let time: number;
const session = 'browser-session-1';
const verifier = 'a'.repeat(43);
const redirect = 'https://registration.example/oauth/callback';
const state = 'state-from-registration-12345';
const error = (code: string) => (e: unknown) => e instanceof OAuthError && e.error === code;
const basic = (id = client._id, secret = client.client_secret) => `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
const request = (scope = 'profile realname') => ({
    client_id: client._id, redirect_uri: redirect, response_type: 'code', scope, state,
    code_challenge: challenge(verifier), code_challenge_method: 'S256',
});
async function code(scope = 'profile realname') {
    const page = await oauth.begin(request(scope), 123, session);
    assert.equal(page.required, false);
    const url = new URL(await oauth.decide(page.requestId, 123, session, 'allow'));
    assert.equal(url.searchParams.get('state'), state);
    return url.searchParams.get('code')!;
}
const exchange = (value: string, extra = {}, auth = basic()) => oauth.exchange({
    grant_type: 'authorization_code', code: value, redirect_uri: redirect, code_verifier: verifier, ...extra,
}, auth);
async function access(scope = 'profile realname') { return (await exchange(await code(scope))).access_token; }

before(async () => {
    server = await MongoMemoryServer.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY || '/usr/bin/mongod' } });
    mongo = await new MongoClient(server.getUri()).connect();
});
after(async () => { await mongo?.close(); await server?.stop(); });
beforeEach(async () => {
    const db = mongo.db('oauth_test');
    await db.dropDatabase();
    time = Date.parse('2026-11-18T00:00:00Z');
    user = { uid: 123, username: 'student' };
    identity = {
        uid: 123, studentId: '202600001', realName: '张三', className: '计算机2601', identityType: '学生',
        verifiedAt: new Date(time), source: 'cas', revision: random(), showRealName: false,
    };
    oauth = new OAuth({
        clients: db.collection<Client>('clients'), grants: db.collection<Grant>('grants'),
        user: async (uid) => uid === 123 ? user : null, realname: async () => identity,
        now: () => new Date(time),
    });
    await initialize(oauth.ports);
    client = await oauth.createClient('报名系统', [redirect], 'profile realname');
});

test('realname whitelist, hidden name, CAS and CLI sources', async () => {
    for (const source of ['cas', 'cli'] as const) {
        identity!.source = source;
        const token = await access();
        assert.deepEqual(await oauth.userinfo(`Bearer ${token}`), {
            uid: 123, username: 'student', realname: {
                verified: true, realName: '张三', studentId: '202600001', className: '计算机2601', identityType: '学生',
            },
        });
    }
});
test('profile works without realname and returns current username only', async () => {
    identity = null;
    const token = await access('profile');
    user!.username = 'renamed';
    assert.deepEqual(await oauth.userinfo(`Bearer ${token}`), { uid: 123, username: 'renamed' });
});
test('missing or incomplete realname blocks authorization without a pending grant', async () => {
    identity!.className = ' ';
    assert.equal((await oauth.begin(request(), 123, session)).required, true);
    identity = null;
    assert.equal((await oauth.begin(request(), 123, session)).required, true);
    assert.equal(await oauth.ports.grants.countDocuments(), 0);
});
test('each authorization requires a fresh confirmation; denial preserves state', async () => {
    const first = await oauth.begin(request(), 123, session);
    const second = await oauth.begin(request(), 123, session);
    assert.notEqual(first.requestId, second.requestId);
    const url = new URL(await oauth.decide(first.requestId, 123, session, 'deny'));
    assert.equal(url.searchParams.get('error'), 'access_denied');
    assert.equal(url.searchParams.get('state'), state);
    assert.equal(url.searchParams.has('code'), false);
    assert.equal(await oauth.ports.grants.countDocuments({ kind: 'code' }), 0);
});
test('confirmation is bound to user, browser session, expiry and single use', async () => {
    const page = await oauth.begin(request(), 123, session);
    await assert.rejects(oauth.decide(page.requestId, 124, session, 'allow'), error('invalid_request'));
    await assert.rejects(oauth.decide(page.requestId, 123, 'another-session', 'allow'), error('invalid_request'));
    await oauth.decide(page.requestId, 123, session, 'allow');
    await assert.rejects(oauth.decide(page.requestId, 123, session, 'allow'), error('invalid_request'));
    const expired = await oauth.begin(request(), 123, session);
    time += 600_000;
    await assert.rejects(oauth.decide(expired.requestId, 123, session, 'allow'), error('invalid_request'));
});
test('invalid parameters, redirect, scope and PKCE cannot start authorization', async () => {
    for (const patch of [
        { redirect_uri: `${redirect}/` }, { redirect_uri: 'https://evil.example' },
        { scope: 'profile admin' }, { scope: 'realname' }, { code_challenge_method: 'plain' },
        { state: ['first', 'second'] }, { response_type: 'token' }, { code_challenge: 'short' }, { sid: 'injected' },
    ]) await assert.rejects(oauth.validateRequest({ ...request(), ...patch }), OAuthError);
    await createCLI(oauth).update(client._id, '仅基础资料', [redirect], 'profile');
    await assert.rejects(oauth.validateRequest(request()), error('invalid_scope'));
});
test('callback registration requires HTTPS with explicit loopback exception', async () => {
    for (const url of ['http://example.com/cb', 'http://localhost/cb', 'https://example.com/*',
        'https://u:p@example.com/cb', 'https://example.com/cb#', 'https://example.com/cb?code=existing']) {
        await assert.rejects(oauth.createClient('bad', [url]), error('invalid_request'));
    }
    oauth.ports.allowLoopbackHttp = true;
    await oauth.createClient('dev', ['http://127.0.0.1:8080/cb']);
    await assert.rejects(oauth.createClient('bad', ['http://192.168.1.1/cb']), error('invalid_request'));
});
test('code is bound to authenticated client, callback and S256 verifier', async () => {
    const value = await code();
    await assert.rejects(exchange(value, {}, basic(client._id, 'wrong')), error('invalid_client'));
    await assert.rejects(exchange(value, { code_verifier: 'b'.repeat(43) }), error('invalid_grant'));
    await assert.rejects(exchange(value, { redirect_uri: `${redirect}/` }), error('invalid_grant'));
    const other = await oauth.createClient('other', [redirect], 'profile realname');
    await assert.rejects(exchange(value, {}, basic(other._id, other.client_secret)), error('invalid_grant'));
    await exchange(value);
    await assert.rejects(exchange(value), error('invalid_grant'));
});
test('Mongo atomic consumption permits exactly one concurrent exchange', async () => {
    const value = await code();
    const results = await Promise.allSettled(Array.from({ length: 12 }, () => exchange(value)));
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    assert.equal(await oauth.ports.grants.countDocuments({ kind: 'access' }), 1);
});
test('expiry is enforced even before Mongo TTL cleanup', async () => {
    const value = await code();
    time += 60_000;
    assert.ok(await oauth.ports.grants.findOne({ _id: digest(value) }));
    await assert.rejects(exchange(value), error('invalid_grant'));
    const token = await access();
    time += 600_000;
    assert.ok(await oauth.ports.grants.findOne({ _id: digest(token) }));
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
});
test('realname changes invalidate pending consent, code and token', async () => {
    const page = await oauth.begin(request(), 123, session);
    const value = await code();
    const token = await access();
    identity!.revision = random(); // same millisecond, same visible data
    await assert.rejects(oauth.decide(page.requestId, 123, session, 'allow'), error('authorization_changed'));
    await assert.rejects(exchange(value), error('invalid_grant'));
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
});
test('editing fields, deleting record or re-verifying invalidates existing access', async () => {
    for (const field of ['realName', 'studentId', 'className', 'identityType'] as const) {
        const token = await access();
        identity![field] += 'changed';
        await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
    }
    const token = await access();
    identity!.verifiedAt = new Date(time + 1);
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
    const next = await access();
    identity = null;
    await assert.rejects(oauth.userinfo(`Bearer ${next}`), error('invalid_token'));
});
test('display toggle does not revoke and legacy records remain usable', async () => {
    delete identity!.revision;
    const token = await access();
    identity!.showRealName = true;
    assert.ok('realname' in await oauth.userinfo(`Bearer ${token}`));
});
test('disabled/deleted user cannot exchange or read profile', async () => {
    const value = await code('profile');
    const token = await access('profile');
    user = null;
    await assert.rejects(exchange(value), error('invalid_grant'));
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
});
test('CLI disable/enable cannot revive grants; reset invalidates old credentials', async () => {
    const cli = createCLI(oauth);
    const value = await code();
    const token = await access();
    await cli.disable(client._id);
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
    await cli.enable(client._id);
    await assert.rejects(exchange(value), error('invalid_grant'));
    await assert.rejects(oauth.userinfo(`Bearer ${token}`), error('invalid_token'));
    const next = await access();
    const reset = await cli.rotateSecret(client._id);
    await assert.rejects(exchange(await code()), error('invalid_client'));
    await assert.rejects(oauth.userinfo(`Bearer ${next}`), error('invalid_token'));
    assert.ok(await exchange(await code(), {}, basic(client._id, reset.client_secret)));
    assert.equal('secretHash' in (await cli.list())[0], false);
});
test('stored secrets and grants contain no raw credentials or realname fields', async () => {
    const token = await access();
    const stored = JSON.stringify(await oauth.ports.grants.find().toArray());
    assert.ok(!stored.includes(token));
    assert.ok(!stored.includes('张三'));
    assert.ok(!JSON.stringify(await oauth.ports.clients.find().toArray()).includes(client.client_secret));
    await assert.rejects(oauth.userinfo(token), error('invalid_token'));
    await assert.rejects(oauth.userinfo('Bearer hydro-session-id'), error('invalid_token'));
});

test('CLI is available during startup but waits for database index readiness', async () => {
    let resolveReady!: () => void;
    const ready = new Promise<void>((resolve) => { resolveReady = resolve; });
    const cli = createCLI(oauth, ready);
    let finished = false;
    const pending = cli.create('启动中的应用', [redirect]).then((result) => { finished = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(finished, false);
    assert.equal(await oauth.ports.clients.countDocuments({ name: '启动中的应用' }), 0);
    resolveReady();
    assert.equal((await pending).name, '启动中的应用');
});
