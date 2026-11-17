import type { Context } from 'hydrooj';
import { ClientError, ClientService, fail } from './core.ts';
import { ClientOAuth, digest } from './oauth.ts';
import type { Grant, Identity } from './oauth.ts';
type Hydro = typeof import('hydrooj');
declare module 'hydrooj' {
  interface Collections {
    'hutoj.client.oauth': Grant;
    realname_superhut: Identity;
  }
}
export async function registerClientOAuth(ctx: Context, H: Hydro, service: ClientService) {
  const oauth = new ClientOAuth({
    grants: H.db.collection('hutoj.client.oauth'),
    identities: H.db.collection('realname_superhut'),
    clientKey: service.clientKey,
    select: (domain, uid) => service.select(domain, uid),
    eligible: (domain, uid) => service.eligible(domain, uid),
    eligibleAll: async (uid) => {
      const domains = await service.settings.distinct('domainId', { requireClient: true });
      const choices = [];
      for (const domain of domains) {
        if (!(await H.DomainModel.get(domain))) {
          continue;
        }
        const user = await H.UserModel.getById(domain, uid);
        if (
          !user?.hasPriv(H.PRIV.PRIV_USER_PROFILE) ||
          !user.hasPerm(H.PERM.PERM_VIEW | H.PERM.PERM_VIEW_CONTEST)
        ) {
          continue;
        }
        if (
          typeof user.contestMode === 'string' &&
          !['system', user.contestMode].includes(domain)
        ) {
          continue;
        }
        const enrolled = await service.eligible(domain, uid);
        const groups = enrolled.some(
          ({ tdoc }) =>
            tdoc.assign?.length &&
            !user.own(tdoc) &&
            !user.hasPerm(H.PERM.PERM_VIEW_HIDDEN_CONTEST),
        )
          ? new Set((await H.UserModel.listGroup(domain, uid)).map((group) => group.name))
          : new Set<string>();
        choices.push(
          ...enrolled.filter(
            ({ tdoc }) =>
              !tdoc.assign?.length ||
              user.own(tdoc) ||
              user.hasPerm(H.PERM.PERM_VIEW_HIDDEN_CONTEST) ||
              tdoc.assign.some((group) => groups.has(group)),
          ),
        );
      }
      return choices.sort(
        (a, b) =>
          +a.tdoc.beginAt - +b.tdoc.beginAt ||
          a.tdoc.domainId.localeCompare(b.tdoc.domainId) ||
          String(a.tdoc.docId).localeCompare(String(b.tdoc.docId)),
      );
    },
    validUser: async (domain, uid) =>
      !!(await H.UserModel.getById(domain, uid))?.hasPriv(H.PRIV.PRIV_USER_PROFILE),
    setName: (domain, uid, name) =>
      H.DomainModel.setUserInDomain(domain, uid, { displayName: name }),
  });
  await oauth.init();
  const ProtocolError = H.CreateError('HutojClientError', H.UserFacingError, '{0}', 403);
  class ClientAuthorizationHandler extends H.Handler {
    noCheckPermView = true;
    async post() {
      try {
        const origin = this.request.headers.origin;
        if (origin && new URL(String(origin)).host !== this.request.host) {
          fail('INVALID_ORIGIN');
        }
        const input = this.request.body;
        oauth.checkKey(this.request.headers['x-hutoj-client-key']);
        await this.limitRate('hutoj_client_identity_ip', 60, 20);
        if (this.request.path.endsWith('/authorize')) {
          await this.limitRate(
            'hutoj_client_identity_id',
            60,
            5,
            digest(String(input.studentId || '')),
          );
        }
        const result = this.request.path.endsWith('/authorize')
          ? await oauth.authorize(
              this.domain._id,
              input,
              this.request.headers['x-hutoj-client-key'],
            )
          : await oauth.exchange(
              this.domain._id,
              input,
              this.request.headers['x-hutoj-client-key'],
            );
        this.response.type = 'application/json';
        this.response.addHeader('Cache-Control', 'no-store');
        this.response.body = result;
      } catch (error) {
        if (!(error instanceof ClientError)) {
          throw error;
        }
        const converted = new ProtocolError(error.code);
        converted.code = error.status;
        throw converted;
      }
    }
  }
  ctx.Route(
    'hutoj_client_authorize',
    '/contest-client/oauth/authorize',
    ClientAuthorizationHandler,
  );
  ctx.Route('hutoj_client_token', '/contest-client/oauth/token', ClientAuthorizationHandler);
  ctx.on('handler/create', (h) => {
    const code = (h.context?.HydroContext as any)?.hutojClientOAuthError;
    if (code) {
      throw new ProtocolError(code);
    }
  });
  const competitorScope = [
    'PERM_VIEW',
    'PERM_VIEW_PROBLEM',
    'PERM_SUBMIT_PROBLEM',
    'PERM_VIEW_RECORD',
    'PERM_READ_RECORD_CODE',
    'PERM_VIEW_CONTEST',
    'PERM_ATTEND_CONTEST',
    'PERM_VIEW_CONTEST_SCOREBOARD',
  ].reduce((scope, name) => scope | ((H.PERM as Record<string, bigint>)[name] || 0n), 0n);
  ctx.server.addLayer('hutoj-client-oauth', async (c, next) => {
    const header = c.request.headers.authorization;
    if (typeof header !== 'string' || !header.startsWith('Bearer hcc_')) {
      return next();
    }
    try {
      const domain = c.HydroContext.domain._id;
      const path = c.request.path;
      const method = c.request.method.toLowerCase();
      const selecting = path === '/contest-client/select' && method === 'post';
      const grant = await oauth.authenticate(
        header.slice(7),
        domain,
        c.request.headers['x-hutoj-client-device'],
        selecting,
      );
      if (
        c.HydroContext.request.websocket ||
        c.HydroContext.args.domainId !== domain ||
        c.request.headers['x-hydro-inject']
      ) {
        fail('OAUTH_SCOPE_DENIED');
      }
      const body = c.request.body || {};
      const query = c.query;
      const keys = (...allowed: string[]) =>
        Object.keys(query).every((key) => allowed.includes(key));
      const fields = (...allowed: string[]) =>
        Object.keys(body).every((key) => allowed.includes(key));
      const tid = grant.tid;
      const choosing = grant.selectionRequired === true;
      const tdoc =
        choosing || grant.domainId !== domain
          ? null
          : await H.ContestModel.get(domain, service.parseTid(tid));
      if (tdoc) {
        const status = await H.ContestModel.getStatus(domain, tdoc.docId, grant.uid);
        if (!status?.attend) {
          fail('OAUTH_SCOPE_DENIED');
        }
      }
      if (choosing && path !== '/contest-client' && path !== '/contest-client/select') {
        fail('CLIENT_CONTEST_SELECTION_REQUIRED', 409);
      }
      let allowed = false;
      let image = false;
      if (path === '/contest-client') {
        allowed = method === 'get' && keys();
      }
      if (path === '/contest-client/select') {
        allowed = method === 'post' && keys() && fields('contestId', 'contestDomain');
      }
      if (path === '/contest-client/session') {
        allowed =
          keys() &&
          (method === 'get' ||
            (method === 'post' &&
              fields('deviceId', 'deviceInfo') &&
              body.deviceId === grant.deviceId));
      }
      if (path === '/contest-client/heartbeat' || path === '/contest-client/ready') {
        allowed =
          method === 'post' &&
          keys() &&
          fields(
            'networkControlled',
            'screenCapturing',
            'processMonitored',
            'usbStorageBlocked',
            'processEvents',
            'environmentIssues',
            'warningEpoch',
            'forceEnvironmentWarning',
            'deviceInfo',
          );
      }
      if (path === '/contest-client/session' && method === 'post') {
        await service.select(domain, grant.uid, tid);
      }
      if (path === `/contest/${tid}/problems`) {
        allowed =
          keys() &&
          (method === 'get' ||
            (method === 'post' &&
              body.operation === 'clarification' &&
              fields('operation', 'subject', 'content')));
      }
      if (path === `/contest/${tid}/scoreboard`) {
        allowed = method === 'get' && keys();
      }
      if (path === `/contest/${tid}`) {
        allowed =
          method === 'post' && keys() && body.operation === 'early_end' && fields('operation');
      }
      const problem = /^\/p\/([^/]+)(\/submit|\/file\/[^/]+)?$/.exec(path);
      if (
        problem &&
        tdoc &&
        String(query.tid) === tid &&
        tdoc.pids.some((pid) => String(pid) === problem[1])
      ) {
        image = !!problem[2]?.startsWith('/file/');
        allowed = image
          ? method === 'get' && keys('tid')
          : problem[2] === '/submit'
            ? keys('tid') &&
              (method === 'get' ||
                (method === 'post' && fields('lang', 'code', 'pretest', 'input')))
            : method === 'get' && keys('tid', 'lang');
      }
      if (path === '/record') {
        allowed =
          method === 'get' &&
          keys('tid', 'uidOrName', 'page') &&
          String(query.tid) === tid &&
          String(query.uidOrName) === String(grant.uid);
      }
      const record = /^\/record\/([a-f\d]{24})$/i.exec(path);
      if (record && method === 'get' && keys('tid') && String(query.tid) === tid) {
        const row = await H.RecordModel.get(domain, service.parseTid(record[1]));
        allowed =
          !!row &&
          row.uid === grant.uid &&
          (String(row.contest) === tid ||
            (String(row.contest) === '000000000000000000000000' &&
              !!tdoc?.pids.includes(row.pid)));
      }
      if (
        !allowed ||
        (!image && !String(c.request.headers.accept || '').includes('application/json'))
      ) {
        fail('OAUTH_SCOPE_DENIED');
      }
      if (!path.startsWith('/contest-client')) {
        const row = await service.authenticate(
          domain,
          grant.uid,
          c.request.headers['x-hutoj-client-session'],
        );
        if (row.tid !== grant.tid || row.deviceId !== grant.deviceId) {
          fail('OAUTH_SCOPE_DENIED');
        }
      }
      const origin = c.request.headers.origin;
      if (origin && new URL(String(origin)).host !== c.request.host) {
        fail('INVALID_ORIGIN');
      }
      const user = await (await H.UserModel.getById(domain, grant.uid)).private();
      user.scope = competitorScope;
      user.priv = H.PRIV.PRIV_USER_PROFILE;
      user.role = 'default';
      user.own = () => false;
      c.HydroContext.user = user;
      (c.HydroContext as any).hutojClientGrant = grant;
    } catch (error) {
      if (!(error instanceof ClientError)) {
        throw error;
      }
      // Let Hydro create a handler and render its normal error response. Directly
      // ending a middleware can be overwritten by the framework's finalizer.
      (c.HydroContext as any).hutojClientOAuthError = error.code;
    }
    await next();
  });
  return oauth;
}
