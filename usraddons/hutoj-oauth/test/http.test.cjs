require('@hydrooj/register');
const assert = require('node:assert/strict');
const { test } = require('node:test');
const path = require('node:path');
const fs = require('node:fs');
const Koa = require('koa');
const body = require('koa-body').default;
const request = require('supertest');
const nunjucks = require('nunjucks');
const { Handler } = require('@hydrooj/framework');
const { PRIV } = require('@hydrooj/common');
const base = require(path.join(path.dirname(require.resolve('@hydrooj/framework')), 'base')).default;
// Use the actual framework Handler and response renderer; replace only Hydro's
// application bootstrap, session lookup and database-backed OAuth service.
require.cache[require.resolve('hydrooj')] = { exports: { Handler, PRIV } };
const { registerHandlers } = require('../src/handlers.ts');
const { OAuth, OAuthError, challenge } = require('../src/oauth.ts');

function appFor(overrides = {}, loggedIn = true) {
    const routes = {};
    const oauth = overrides instanceof OAuth ? overrides : {
        validateRequest: async () => {},
        begin: async () => ({ clientName: '<script>bad()</script>', required: false, requestId: 'opaque-id', scope: ['profile', 'realname'] }),
        decide: async () => 'https://registration.example/cb?code=opaque&state=state',
        exchange: async () => ({ access_token: 'opaque', token_type: 'Bearer', expires_in: 600 }),
        userinfo: async () => ({ uid: 123, username: 'student' }),
        ...overrides,
    };
    registerHandlers({ Route: (name, url, clazz) => { routes[url] = clazz; } }, oauth);
    const app = new Koa();
    app.use(body());
    app.use(base({ error() {} }));
    app.use(async (c) => {
        c.session = { _id: 'session', uid: loggedIn ? 123 : 0 };
        c.HydroContext.UiContext = {};
        c.HydroContext.user = { privateField: 'never-return' };
        const h = new routes[c.path](c, {});
        c.handler = h;
        h.user = { _id: loggedIn ? 123 : 0, uname: 'student', hasPriv: () => loggedIn };
        h.limitRate = async () => {};
        h.url = (name, args) => name === 'user_login' ? `/login?${new URLSearchParams(args.query)}`
            : name === 'home_realname' ? '/home/realname' : '/oauth2/authorize';
        h.renderHTML = async (file, data) => {
            const source = fs.readFileSync(path.join(__dirname, '../templates', file), 'utf8')
                .replace('{% extends "layout/basic.html" %}', '');
            return nunjucks.renderString(source, { ...data, url: h.url });
        };
        try {
            await h.init();
            await h[c.method.toLowerCase()]();
        } catch (e) { await h.onerror(e); }
    });
    return app.callback();
}

test('userinfo is JSON without Accept header and blocks framework account injection', async () => {
    const r = await request(appFor()).get('/oauth2/userinfo').set('x-hydro-inject', 'usercontext,uicontext');
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /application\/json/);
    assert.equal(r.headers['cache-control'], 'no-store');
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
    assert.deepEqual(r.body, { uid: 123, username: 'student' });
});
test('token accepts form encoding, rejects JSON and query credentials', async () => {
    await request(appFor()).post('/oauth2/token').type('form').send({ code: 'opaque' }).expect(200);
    await request(appFor()).post('/oauth2/token').send({ code: 'opaque' }).expect(400, { error: 'invalid_request' });
    await request(appFor()).post('/oauth2/token?access_token=bad').type('form').send({}).expect(400);
});
test('errors use JSON and authentication challenges, hide internal exceptions', async () => {
    const r = await request(appFor({ userinfo: async () => { throw new OAuthError('invalid_token', 401); } })).get('/oauth2/userinfo');
    assert.equal(r.status, 401);
    assert.equal(r.headers['www-authenticate'], 'Bearer error="invalid_token"');
    assert.deepEqual(r.body, { error: 'invalid_token' });
    await request(appFor({ exchange: async () => { throw new Error('private database details'); } }))
        .post('/oauth2/token').type('form').send({}).expect(500, { error: 'server_error' });
});
test('login redirect preserves authorization parameters', async () => {
    const r = await request(appFor({}, false)).get('/oauth2/authorize?client_id=abc&state=example');
    assert.equal(r.status, 302);
    assert.equal(new URL(r.headers.location, 'https://hutoj.example').searchParams.get('redirect'), '/oauth2/authorize?client_id=abc&state=example');
});
test('consent template escapes application name, shows requested fields and blocks framing', async () => {
    const r = await request(appFor()).get('/oauth2/authorize');
    assert.equal(r.status, 200);
    assert.match(r.text, /&lt;script&gt;/);
    assert.match(r.text, /姓名、学号、班级/);
    assert.match(r.text, /name="request_id" value="opaque-id"/);
    assert.equal(r.headers['x-frame-options'], 'DENY');
    assert.equal(r.headers['referrer-policy'], 'strict-origin');
});
test('unverified page provides entry and requires a new authorization', async () => {
    const r = await request(appFor({ begin: async () => ({ required: true, clientName: 'registration' }) })).get('/oauth2/authorize');
    assert.match(r.text, /href="\/home\/realname"/);
    assert.match(r.text, /重新发起授权/);
    assert.doesNotMatch(r.text, /name="request_id"/);
});
test('consent returns browser redirect even with JSON Accept', async () => {
    const r = await request(appFor()).post('/oauth2/authorize').set('Accept', 'application/json').type('form')
        .send({ request_id: 'opaque-id', decision: 'allow' });
    assert.equal(r.status, 302);
    assert.match(r.headers.location, /^https:\/\/registration.example\/cb\?code=/);
    assert.equal(r.headers['referrer-policy'], 'no-referrer');
});
test('consent accepts native same-origin form submission with origin-only Referer', async () => {
    let calls = 0;
    const app = appFor({ decide: async (id, uid, session, decision) => {
        assert.deepEqual([id, uid, session, decision], ['opaque-id', 123, 'session', 'allow']);
        calls++;
        return 'https://registration.example/cb?code=opaque&state=state';
    } });
    await request(app).post('/oauth2/authorize').set('Host', 'hutoj.example')
        .set('Origin', 'http://hutoj.example').set('Referer', 'http://hutoj.example/').type('form')
        .send({ request_id: 'opaque-id', decision: 'allow' }).expect(302);
    assert.equal(calls, 1);
});
test('consent rejects foreign and opaque origins and extra scope fields', async () => {
    await request(appFor()).post('/oauth2/authorize').set('Origin', 'https://evil.example').type('form')
        .send({ request_id: 'id', decision: 'allow' }).expect(400);
    await request(appFor()).post('/oauth2/authorize').set('Origin', 'null').type('form')
        .send({ request_id: 'id', decision: 'allow' }).expect(400);
    await request(appFor()).post('/oauth2/authorize').type('form')
        .send({ request_id: 'id', decision: 'allow', scope: 'admin' }).expect(400);
    await request(appFor()).post('/oauth2/authorize').set('Referer', 'https://evil.example/').type('form')
        .send({ request_id: 'id', decision: 'allow' }).expect(403);
});

test('HTTP consent to authenticated token exchange to profile using real Mongo', async (t) => {
    const { MongoClient } = require('mongodb');
    const { MongoMemoryServer } = require('mongodb-memory-server');
    const { initialize } = require('../src/model.ts');
    const server = await MongoMemoryServer.create({ binary: { systemBinary: process.env.MONGOMS_SYSTEM_BINARY || '/usr/bin/mongod' } });
    t.after(() => server.stop());
    const mongo = await new MongoClient(server.getUri()).connect();
    t.after(() => mongo.close());
    const db = mongo.db('oauth_http');
    const oauth = new OAuth({
        clients: db.collection('clients'), grants: db.collection('grants'),
        user: async () => ({ uid: 123, username: 'student' }), realname: async () => null,
    });
    await initialize(oauth.ports);
    const client = await oauth.createClient('报名系统', ['https://registration.example/cb']);
    const verifier = 'v'.repeat(43);
    const app = appFor(oauth);
    const page = await request(app).get('/oauth2/authorize').query({
        client_id: client._id, redirect_uri: client.redirectUris[0], response_type: 'code', scope: 'profile',
        state: 'state-from-registration', code_challenge: challenge(verifier), code_challenge_method: 'S256',
    }).expect(200);
    const id = /name="request_id" value="([^"]+)"/.exec(page.text)[1];
    const consent = await request(app).post('/oauth2/authorize').type('form').send({ request_id: id, decision: 'allow' }).expect(302);
    const callback = new URL(consent.headers.location);
    assert.equal(callback.searchParams.get('state'), 'state-from-registration');
    const exchanged = await request(app).post('/oauth2/token').auth(client._id, client.client_secret).type('form').send({
        grant_type: 'authorization_code', code: callback.searchParams.get('code'), redirect_uri: client.redirectUris[0], code_verifier: verifier,
    }).expect(200);
    assert.equal(exchanged.body.expires_in, 600);
    await request(app).get('/oauth2/userinfo').set('Authorization', `Bearer ${exchanged.body.access_token}`)
        .expect(200, { uid: 123, username: 'student' });
});
