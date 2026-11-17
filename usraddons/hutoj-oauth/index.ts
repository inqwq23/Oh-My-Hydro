import type { Collection } from 'mongodb';
import { Collections, Context, PRIV, Schema } from 'hydrooj';
import { createCLI } from './src/cli.ts';
import { registerHandlers } from './src/handlers.ts';
import { initialize } from './src/model.ts';
import type { Client, Grant } from './src/model.ts';
import { OAuth } from './src/oauth.ts';
import type { RealnameRecord } from './src/realname.ts';

export const name = 'hutoj-oauth';
export const inject = ['db'];
export const Config = Schema.object({
    accessSeconds: Schema.number().min(60).max(3600).default(600).description('访问令牌有效秒数'),
    allowLoopbackHttp: Schema.boolean().default(false).description('允许 localhost / 127.0.0.1 / [::1] 的 HTTP 回调，仅用于本地联调'),
});

declare module 'hydrooj' {
    interface Collections {
        'hutoj.oauth.clients': Client;
        'hutoj.oauth.grants': Grant;
    }
    interface Model {
        hutojOAuth: ReturnType<typeof createCLI>;
    }
}

export async function apply(ctx: Context, config: ReturnType<typeof Config>) {
    // Keep Hydro's collection prefix/map support without redeclaring another plugin's schema.
    const identities = ctx.db.collection('realname_superhut' as keyof Collections) as unknown as Collection<RealnameRecord>;
    const oauth = new OAuth({
        clients: ctx.db.collection('hutoj.oauth.clients'),
        grants: ctx.db.collection('hutoj.oauth.grants'),
        accessSeconds: config.accessSeconds,
        allowLoopbackHttp: config.allowLoopbackHttp,
        user: async (uid) => {
            if (!Number.isSafeInteger(uid) || uid <= 0) return null;
            // Read current account status without the UserModel cache.
            const user = await ctx.db.collection('user').findOne({ _id: uid }, { projection: { uname: 1, priv: 1 } });
            if (!user || !(user.priv & PRIV.PRIV_USER_PROFILE)) return null;
            return { uid, username: user.uname };
        },
        realname: (uid) => identities.findOne({ uid }),
    });
    // Hydro's CLI may dispatch before an async plugin entry has completed.
    // Publish entry points synchronously, and let each operation await readiness.
    const ready = initialize(oauth.ports);
    const cli = createCLI(oauth, ready);
    ctx.effect(() => {
        const previous = global.Hydro.model.hutojOAuth;
        global.Hydro.model.hutojOAuth = cli;
        return () => {
            if (global.Hydro.model.hutojOAuth === cli) {
                if (previous) global.Hydro.model.hutojOAuth = previous;
                else delete (global.Hydro.model as Partial<typeof global.Hydro.model>).hutojOAuth;
            }
        };
    });
    ctx.inject(['server'], (child) => registerHandlers(child, oauth, ready));
    ctx.i18n.load('zh', {
        hutoj_oauth_authorize: '第三方应用授权',
        oauth_authorize: '第三方应用授权',
        oauth_realname_required: '需要实名认证',
    });
    await ready;
}
