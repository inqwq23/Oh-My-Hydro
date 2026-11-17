import { Context, Handler, PRIV } from 'hydrooj';
import { fail, OAuth, OAuthError, only } from './oauth.ts';

export function registerHandlers(ctx: Context, oauth: OAuth, ready: Promise<void> = Promise.resolve()) {
    class OAuthBaseHandler extends Handler {
        noCheckPermView = true;

        headers() {
            this.response.addHeader('Cache-Control', 'no-store');
            this.response.addHeader('Pragma', 'no-cache');
            this.response.addHeader('Referrer-Policy', 'no-referrer');
            this.response.addHeader('X-Frame-Options', 'DENY');
            this.response.addHeader('Content-Security-Policy', "frame-ancestors 'none'");
        }

        async init() {
            // Hydro's slow-request oplog serializes handler.args. Keep credentials out.
            for (const key of ['code', 'code_verifier', 'request_id', 'client_secret', 'access_token', 'state']) {
                delete this.args[key];
            }
            this.headers();
            await ready;
            await super.init();
            await this.limitRate('hutoj_oauth_ip', 60, 60, '{{ip}}');
        }

        json(body: unknown, status = 200) {
            this.headers();
            this.response.status = status;
            this.response.template = '';
            this.response.redirect = '';
            this.response.type = 'application/json';
            // A serialized body also prevents x-hydro-inject from adding account data.
            this.response.body = JSON.stringify(body);
        }

        async onerror(error: Error) {
            const known = error instanceof OAuthError;
            const frameworkStatus = 'code' in error && typeof error.code === 'number'
                && error.code >= 400 && error.code < 500 ? error.code : 500;
            const status = known ? error.status : frameworkStatus;
            const code = known ? error.error : status === 429 ? 'rate_limited' : status < 500 ? 'invalid_request' : 'server_error';
            if (code === 'invalid_client') this.response.addHeader('WWW-Authenticate', 'Basic realm="HUTOJ OAuth"');
            if (code === 'invalid_token') this.response.addHeader('WWW-Authenticate', 'Bearer error="invalid_token"');
            this.json({ error: code }, status);
        }
    }

    class OAuthAuthorizeHandler extends OAuthBaseHandler {
        async init() {
            await super.init();
            this.request.json = false;
            if (this.request.headers.authorization) fail('invalid_request');
        }

        sessionId() {
            if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE) || typeof this.session._id !== 'string'
                || this.session.uid !== this.user._id) fail('access_denied', 403);
            return this.session._id;
        }

        async get() {
            const input = this.context.query as Record<string, unknown>;
            await oauth.validateRequest(input);
            if (!this.user.hasPriv(PRIV.PRIV_USER_PROFILE)) {
                this.response.redirect = this.url('user_login', {
                    query: { redirect: (this.context.originalPath || this.request.path) + this.context.search },
                });
                return;
            }
            const result = await oauth.begin(input, this.user._id, this.sessionId());
            // no-referrer makes native browser form POSTs send Origin: null.
            // Keep the origin for CSRF checks without exposing authorization query
            // parameters in Referer. API responses and redirects keep no-referrer.
            this.response.addHeader('Referrer-Policy', 'strict-origin');
            this.response.template = result.required ? 'oauth_realname_required.html' : 'oauth_authorize.html';
            this.response.body = { ...result, username: this.user.uname, uid: this.user._id };
        }

        async post() {
            only(this.context.query, []);
            const input = this.request.body;
            only(input, ['request_id', 'decision']);
            const origin = this.request.headers.origin;
            if (origin && origin !== `${this.context.request.protocol}://${this.request.host}`) fail('invalid_request');
            this.response.redirect = await oauth.decide(input.request_id, this.user._id, this.sessionId(), input.decision);
        }
    }

    class OAuthTokenHandler extends OAuthBaseHandler {
        async post() {
            only(this.context.query, []);
            if (!this.context.is('application/x-www-form-urlencoded')) fail('invalid_request');
            this.json(await oauth.exchange(this.request.body, this.request.headers.authorization));
        }
    }

    class OAuthUserinfoHandler extends OAuthBaseHandler {
        async get() {
            only(this.context.query, []);
            this.json(await oauth.userinfo(this.request.headers.authorization));
        }
    }

    ctx.Route('hutoj_oauth_authorize', '/oauth2/authorize', OAuthAuthorizeHandler);
    ctx.Route('hutoj_oauth_token', '/oauth2/token', OAuthTokenHandler);
    ctx.Route('hutoj_oauth_userinfo', '/oauth2/userinfo', OAuthUserinfoHandler);
}
