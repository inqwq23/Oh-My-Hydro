import { clientAccess, ClientError, ClientService, equalSecret, fail, secret } from './core.ts';
import type { PolicyDocument, SessionDocument } from './core.ts';
import type { Context, Handler, HandlerCommon, Tdoc } from 'hydrooj';
import { registerMonitor } from './monitor.ts';
import { HeartbeatWatch, type WatchedStatus } from './heartbeat-watch.ts';
import type { Collection } from 'mongodb';
import { registerClientOAuth } from './oauth-plugin.ts';
import type { Grant } from './oauth.ts';
import { inlineAvatars } from './avatar-images.ts';
import { registerRecordingSettings } from './recording-settings.ts';
import { realNameUsers } from './scoreboard-view.ts';

declare module 'hydrooj' {
  interface Collections {
    'hutoj.client.settings': PolicyDocument;
    'hutoj.client.sessions': SessionDocument;
  }
}

type Hydro = typeof import('hydrooj');
type ContestHandler = HandlerCommon & { tdoc?: Tdoc };
type DisplayNameHandler = Handler & {
  post(args: { domainId: string; category: 'domain'; displayName: string }): Promise<void>;
};

export async function register(
  ctx: Context,
  H: Hydro,
  config: {
    clientKey: string;
    sidebarTemplates?: Record<string, string>;
    avatarFallback?: string;
  },
) {
  const service = new ClientService({
    settings: H.db.collection('hutoj.client.settings'),
    sessions: H.db.collection('hutoj.client.sessions'),
    contests: H.ContestModel,
    users: H.UserModel,
    objectId: (value: string) => new H.ObjectId(value),
    clientKey: config.clientKey,
  });
  await service.init();
  const watch = new HeartbeatWatch(
    H.db.collection('document.status') as unknown as Collection<WatchedStatus>,
    async (row) => {
      if (!(await service.policy(row.domainId, row.docId)).requireClient) {
        return null;
      }
      const contest = await H.ContestModel.getMulti(row.domainId, { docId: row.docId }).next();
      if (!contest) {
        return null;
      }
      const personalEnd =
        contest.duration && row.startAt ? +row.startAt + contest.duration * 3600_000 : Infinity;
      return new Date(Math.min(+contest.endAt, personalEnd));
    },
  );
  await watch.init();
  watch.onDisconnect = async (row) => {
    const [contest, identity] = await Promise.all([
      H.ContestModel.get(row.domainId, row.docId),
      H.db
        .collection('realname_superhut')
        .findOne({ uid: row.uid }, { projection: { realName: 1 } }),
    ]);
    const text = `比赛掉线通知\n《${contest.title}》选手${identity?.realName || row.uid}已连续 15 秒未发送心跳，系统已自动结束该选手的比赛。`;
    await H.MessageModel.send(1, contest.owner, text, H.MessageModel.FLAG_UNREAD);
  };
  service.watch = watch;
  let sweeping = false;
  ctx.interval(async () => {
    if (sweeping) {
      return;
    }
    sweeping = true;
    try {
      await watch.sweep();
    } catch (error) {
      console.error('Contest heartbeat sweep failed', error);
    } finally {
      sweeping = false;
    }
  }, 1000);
  const ensureRecording = await registerRecordingSettings(ctx, H, service);
  const oauth = await registerClientOAuth(ctx, H, service);
  const ProtocolError = H.CreateError('HutojClientError', H.UserFacingError, '{0}', 403);
  const wrap = <T extends HandlerCommon, A extends unknown[]>(
    fn: (this: T, ...args: A) => Promise<unknown>,
  ) =>
    async function (this: T, ...args: A) {
      try {
        return await fn.apply(this, args);
      } catch (error) {
        if (!(error instanceof ClientError)) {
          throw error;
        }
        const converted = new ProtocolError(error.code);
        converted.code = error.status;
        throw converted;
      }
    };
  const header = (h: HandlerCommon, name: string) => h.request.headers[name.toLowerCase()];
  const token = (h: HandlerCommon) => header(h, 'x-hutoj-client-session');
  const domain = (h: HandlerCommon) => h.domain._id;
  const signedIn = (h: HandlerCommon) => h.checkPriv(H.PRIV.PRIV_USER_PROFILE);
  const manager = (h: HandlerCommon, tdoc: Tdoc) =>
    h.user.hasPerm(H.PERM.PERM_EDIT_CONTEST) ||
    (h.user.own(tdoc) && h.user.hasPerm(H.PERM.PERM_EDIT_CONTEST_SELF));
  function sameOrigin(h: HandlerCommon) {
    const origin = header(h, 'origin');
    if (!origin) {
      return;
    } // Electron main-process requests have no Origin.
    if (typeof origin !== 'string') {
      fail('INVALID_ORIGIN');
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail('INVALID_ORIGIN');
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== h.request.host) {
      fail('INVALID_ORIGIN');
    }
  }
  function json(h: HandlerCommon, body: unknown) {
    h.response.type = 'application/json';
    h.response.addHeader('Cache-Control', 'no-store');
    h.response.body = body;
  }
  const auth = async (h: HandlerCommon, allowExpired = false) => {
    signedIn(h);
    sameOrigin(h);
    const row = await service.authenticate(domain(h), h.user._id, token(h), allowExpired);
    const grant = (h.context?.HydroContext as any)?.hutojClientGrant as Grant | undefined;
    if (
      grant &&
      (grant.selectionRequired === true ||
        row.tid !== grant.tid ||
        row.deviceId !== grant.deviceId)
    ) {
      fail('OAUTH_SCOPE_DENIED');
    }
    return row;
  };
  async function snapshot(h: HandlerCommon, row: SessionDocument) {
    const data = await service.snapshot(row);
    const identity = await H.db
      .collection('realname_superhut')
      .findOne(
        { uid: row.uid, verifiedAt: { $type: 'date' } },
        { projection: { studentId: 1, className: 1, realName: 1 } },
      );
    if (ctx.setting.get('contestClient.recordingDirectory')) {
      await ensureRecording((await service.policy(row.domainId, row.tid)).mediaApiUrl);
    }
    const tid = row.tid;
    return {
      ...data,
      user: {
        ...data.user,
        ...(identity
          ? {
              studentId: identity.studentId,
              className: identity.className || '',
              realName: identity.realName,
            }
          : {}),
      },
      urls: {
        session: h.url('hutoj_client_session'),
        heartbeat: h.url('hutoj_client_heartbeat'),
        ready: h.url('hutoj_client_ready'),
        displayName: h.url('home_settings', { category: 'domain' }),
        contest: h.url('contest_detail', { tid }),
        problems: h.url('contest_problemlist', { tid }),
        records: h.url('record_main', { query: { tid, uidOrName: h.user._id } }),
      },
    };
  }

  class HutojClientBootstrapHandler extends H.Handler {
    get = wrap(async function () {
      signedIn(this);
      const grant = (this.context?.HydroContext as any)?.hutojClientGrant as Grant | undefined;
      const choices = (
        grant ? await oauth.list(grant) : await service.eligible(domain(this), this.user._id)
      ) as Awaited<ReturnType<ClientService['eligible']>>;
      if (!choices.length) {
        fail('NO_CLIENT_CONTEST', 404);
      }
      const selected =
        grant?.selectionRequired === true
          ? null
          : await service.select(domain(this), this.user._id, grant?.tid);
      const tdoc = selected?.tdoc;
      json(this, {
        protocolVersion: 1,
        selectionRequired: grant?.selectionRequired === true,
        contests: choices.map(({ tdoc }) => ({
          id: String(tdoc.docId),
          domainId: tdoc.domainId,
          title: tdoc.title,
          beginAt: tdoc.beginAt,
          endAt: tdoc.endAt,
          durationHours: tdoc.duration || (+tdoc.endAt - +tdoc.beginAt) / 3600_000,
          personalDurationHours: tdoc.duration || null,
        })),
        user: {
          id: this.user._id,
          username: this.user.uname,
          displayName: this.user.displayName || '',
        },
        editorPreferences: {
          fontFamily: this.user.codeFontFamily || 'Source Code Pro',
          theme: this.user.theme === 'dark' ? 'vs-dark' : 'hutoj',
          showInvisibleChar: !!this.user.showInvisibleChar,
          language: this.user.codeLang || '',
        },
        contest: tdoc
          ? {
              id: String(tdoc.docId),
              title: tdoc.title,
              beginAt: tdoc.beginAt,
              endAt: tdoc.endAt,
              descriptionHtml: await this.renderHTML('hutoj_client_markdown.html', {
                content: tdoc.content || '',
              }),
            }
          : undefined,
        sessionUrl: this.url('hutoj_client_session'),
        selectionUrl: this.url('hutoj_client_select'),
        serverTime: new Date(),
      });
    });
  }
  class HutojClientSelectHandler extends H.Handler {
    post = wrap(async function () {
      signedIn(this);
      sameOrigin(this);
      const grant = (this.context?.HydroContext as any)?.hutojClientGrant as Grant | undefined;
      if (!grant) {
        fail('OAUTH_SCOPE_DENIED');
      }
      const selected = await oauth.selectContest(
        grant,
        this.request.body.contestId,
        this.request.body.contestDomain,
      );
      json(this, {
        contestId: selected.tid,
        domainId: selected.domainId,
        basePath:
          selected.domainId === 'system' ? '/' : `/d/${encodeURIComponent(selected.domainId)}/`,
      });
    });
  }
  class HutojClientSessionHandler extends H.Handler {
    get = wrap(async function () {
      json(this, await snapshot(this, await auth(this, true)));
    });
    post = wrap(async function () {
      signedIn(this);
      sameOrigin(this);
      await this.limitRate('hutoj_client_session', 60, 20);
      const grant = (this.context?.HydroContext as any)?.hutojClientGrant as Grant | undefined;
      if (grant?.selectionRequired === true) {
        fail('CLIENT_CONTEST_SELECTION_REQUIRED', 409);
      }
      if (header(this, 'x-hutoj-heartbeat-seconds') !== '5') {
        fail('请更新比赛客户端至 0.9.3 或更高版本。', 409);
      }
      const { token: sessionToken, row } = await service.open(
        domain(this),
        this.user._id,
        header(this, 'x-hutoj-client-key'),
        this.request.body.deviceId,
        grant?.tid,
        { deviceInfo: this.request.body.deviceInfo, heartbeatV2: true },
      );
      json(this, { ...(await snapshot(this, row)), token: sessionToken });
    });
  }
  class HutojClientHeartbeatHandler extends H.Handler {
    post = wrap(async function () {
      const row = await service.heartbeat(await auth(this), this.request.body);
      if (row.heartbeatV2 && row.enteredAt) {
        await watch.beat({
          domainId: row.domainId,
          docId: service.parseTid(row.tid),
          uid: row.uid,
        });
      }
      json(this, await snapshot(this, row));
    });
  }
  class HutojClientReadyHandler extends H.Handler {
    post = wrap(async function () {
      const row = await service.heartbeat(await auth(this), this.request.body, true);
      json(this, await snapshot(this, row));
    });
  }
  class HutojClientSettingsHandler extends H.Handler {
    tdoc!: Tdoc;
    prepare = wrap(async function (this: HutojClientSettingsHandler) {
      signedIn(this);
      this.tdoc = await H.ContestModel.get(domain(this), service.parseTid(this.args.tid));
      if (!manager(this, this.tdoc)) {
        fail('CONTEST_MANAGEMENT_REQUIRED');
      }
      if (this.tdoc.rule === 'homework') {
        fail('HOMEWORK_NOT_SUPPORTED', 400);
      }
    });
    get = wrap(async function (this: HutojClientSettingsHandler) {
      this.session.hutojClientCsrf ||= secret();
      const data = {
        tdoc: this.tdoc,
        policy: await service.policy(domain(this), this.tdoc.docId),
        csrf: this.session.hutojClientCsrf,
      };
      if (this.request.json) {
        json(this, data);
      } else {
        this.response.addHeader('Cache-Control', 'no-store');
        this.response.template = 'hutoj_client_settings.html';
        this.response.body = data;
      }
    });
    post = wrap(async function (this: HutojClientSettingsHandler) {
      sameOrigin(this);
      if (!equalSecret(this.request.body.csrf, this.session.hutojClientCsrf)) {
        fail('INVALID_CSRF');
      }
      const policy = await service.savePolicy(
        domain(this),
        this.tdoc.docId,
        {
          ...this.request.body,
          requireClient: false,
          clientOnly: false,
          ...Object.fromEntries(
            ['restrictNetwork', 'blockBlacklistApps', 'blockUsbStorage', 'forceFullscreen'].map(
              (key) => [key, this.request.body[key] ?? false],
            ),
          ),
        },
        this.user._id,
        'settings',
      );
      if (this.request.json) {
        json(this, { policy });
      } else {
        this.response.redirect = this.url('hutoj_client_settings', { tid: this.tdoc.docId });
      }
    });
  }

  ctx.Route(
    'hutoj_client_bootstrap',
    '/contest-client',
    HutojClientBootstrapHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_select',
    '/contest-client/select',
    HutojClientSelectHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_session',
    '/contest-client/session',
    HutojClientSessionHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_heartbeat',
    '/contest-client/heartbeat',
    HutojClientHeartbeatHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_ready',
    '/contest-client/ready',
    HutojClientReadyHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_settings',
    '/contest/:tid/client',
    HutojClientSettingsHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  registerMonitor(ctx, H, service);

  // Run before Hydro's problem-list GET can write startAt. Never prefetch this GET.
  const protectedNames = new Set([
    'ContestProblemList',
    'ContestScoreboard',
    'ContestFileDownload',
    'ContestPrint',
    'ProblemMain',
    'ProblemRandom',
    'ProblemDetail',
    'ProblemSubmit',
    'ProblemFileDownload',
    'ProblemSolution',
    'ProblemSolutionRaw',
    'ProblemStatistics',
    'ProblemHack',
    'ProblemFiles',
    'RecordList',
    'RecordDetail',
    'RecordMainConnection',
    'RecordDetailConnection',
  ]);
  async function guard(h: HandlerCommon, name: string) {
    const finish =
      name === 'ContestDetail' &&
      h.request.method === 'post' &&
      h.request.body.operation === 'early_end';
    if (!finish && !protectedNames.has(name)) {
      return;
    }
    if (!h.user._id) {
      return;
    } // Hydro handles anonymous privileges itself.
    const candidates = (await service.eligible(domain(h), h.user._id)).filter(
      ({ tdoc }) => !manager(h, tdoc),
    );
    const sessionToken = token(h);
    // The global problem list and random problem routes ignore a supplied contest ID.
    let tid = name === 'ProblemMain' || name === 'ProblemRandom' ? undefined : h.args.tid;
    if (name === 'RecordDetail' || name === 'RecordDetailConnection') {
      const record = await H.RecordModel.get(domain(h), service.parseTid(h.args.rid));
      tid = record?.contest;
      // Hydro stores self-tests under its reserved contest ID. Keep the real
      // contest context, and only allow the participant's own test of its problems.
      if (String(tid) === '000000000000000000000000' && record?.uid === h.user._id) {
        const candidate = candidates.find(
          ({ tdoc }) =>
            String(tdoc.docId) === String(h.args.tid) && tdoc.pids.includes(record.pid),
        );
        tid = candidate?.tdoc.docId;
      }
    }
    const selected = candidates.find(({ tdoc }) => String(tdoc.docId) === String(tid));
    if (selected) {
      if (!sessionToken && !selected.clientOnly) return;
      sameOrigin(h);
      // Ending is allowed before ready as long as Hydro itself considers the contest ongoing.
      await service.requireSession(
        domain(h),
        h.user._id,
        sessionToken,
        selected.tdoc.docId,
        !finish,
      );
      return;
    }
    if (sessionToken && candidates.length) {
      fail('CLIENT_CONTEST_REQUIRED');
    }
    const scoped =
      /^[a-f\d]{24}$/i.test(String(tid)) && String(tid) !== '000000000000000000000000';
    if (!scoped) {
      if (candidates.some((c) => c.clientOnly)) fail('CLIENT_CONTEST_REQUIRED');
      return;
    }
    // Also cover direct access by a non-attendee; do not replace Hydro's attendance checks.
    const policy = await service.policy(domain(h), tid);
    if (sessionToken && !policy.requireClient) fail('CONTEST_NOT_ELIGIBLE', 409);
    if (!sessionToken && !policy.clientOnly) return;
    const tdoc = await H.ContestModel.get(domain(h), service.parseTid(tid));
    if (manager(h, tdoc) || H.ContestModel.isDone(tdoc)) return;
    const tsdoc = await H.ContestModel.getStatus(domain(h), tdoc.docId, h.user._id);
    if (tsdoc && H.ContestModel.isDone(tdoc, tsdoc)) return;
    sameOrigin(h);
    await service.requireSession(domain(h), h.user._id, sessionToken, tid, !finish);
  }
  ctx.on(
    'handler/before-prepare',
    wrap(async (h: HandlerCommon) => guard(h, h.constructor.name.replace(/Handler$/, ''))),
  );
  // HTTP hooks are not run on Hydro WebSocket/SSE routes.
  ctx.on(
    'handler/create/ws',
    wrap(async (h: InstanceType<Hydro['ConnectionHandler']>) => {
      const name = h.constructor.name.replace(/Handler$/, '');
      if (!protectedNames.has(name)) {
        return;
      }
      await guard(h, name);
      h.ctx.interval(async () => {
        try {
          await guard(h, name);
        } catch {
          h.close(4003, 'Client session unavailable');
        }
      }, 15_000);
    }),
  );

  // Add fragments only to authenticated client JSON responses, after the native
  // handlers have applied attendance, contest visibility and record projections.
  // Rendering goes through the running Hydro's renderer, including local plugins.
  ctx.on(
    'handler/after',
    wrap(async (h: Handler) => {
      if (!token(h) || !h.request.json || !h.response.body) {
        return;
      }
      const name = h.constructor.name.replace(/Handler$/, '');
      if (
        ![
          'ProblemDetail',
          'ProblemSubmit',
          'ContestProblemList',
          'ContestScoreboard',
          'RecordList',
          'RecordDetail',
        ].includes(name) ||
        h.request.method !== 'get'
      ) {
        return;
      }
      const body = h.response.body;
      const view: Record<string, unknown> = {};
      if (name === 'ProblemDetail') {
        // Match ProblemDetail#get's HTML path: rewrite recognized attachments
        // before Markdown/XSS processing, which correctly rejects file:// URLs.
        const pdoc = { ...body.pdoc };
        pdoc.content = pdoc.content.replace(
          /file:\/\/([^ \n)\\"]+)/g,
          (raw: string, info: string) => {
            let filename = info.split('?')[0];
            try {
              filename = decodeURIComponent(filename);
            } catch {
              return raw;
            }
            if (
              !pdoc.additional_file?.some((file: { name: string }) => file.name === filename)
            ) {
              return raw;
            }
            return `./${pdoc.docId}/file/${info}${info.includes('?') ? '&' : '?'}tid=${h.args.tid}`;
          },
        );
        view.statementHtml = await h.renderHTML('hutoj_client_statement.html', {
          ...body,
          pdoc,
        });
        view.statementLanguages = JSON.parse(
          String(await h.renderHTML('hutoj_client_languages.json', body)),
        );
        view.canPretest = ['default', 'remote_judge'].includes(body.pdoc.config?.type);
        view.canViewRecord = !body.tdoc || H.ContestModel.canShowSelfRecord.call(h, body.tdoc);
      }
      if (name === 'ContestProblemList') {
        const participant = await auth(h);
        await service.markEntered(participant);
        if (
          participant.heartbeatV2 &&
          (await service.policy(participant.domainId, participant.tid)).requireClient
        ) {
          await watch.enter({
            domainId: participant.domainId,
            docId: service.parseTid(participant.tid),
            uid: participant.uid,
          });
        }
        view.clarifications = await Promise.all(
          (body.tcdocs || []).map(async (doc: Record<string, any>) => ({
            id: String(doc.docId),
            owner: doc.owner,
            subject: doc.subject,
            html: await h.renderHTML('hutoj_client_markdown.html', { content: doc.content }),
            replies: await Promise.all(
              (doc.reply || []).map(async (reply: Record<string, any>) => ({
                id: String(reply._id),
                html: await h.renderHTML('hutoj_client_markdown.html', {
                  content: reply.content,
                }),
              })),
            ),
          })),
        );
      }
      if (name === 'ContestScoreboard') {
        const ids = Object.values(body.udict || {})
          .map((user: any) => user?._id)
          .filter(Number.isSafeInteger) as number[];
        const identities = await H.db
          .collection('realname_superhut')
          .find(
            { uid: { $in: ids }, verifiedAt: { $type: 'date' } },
            { projection: { uid: 1, realName: 1 } },
          )
          .toArray();
        const rows = Array.isArray(body.rows)
          ? body.rows.map((row: any[], index: number) =>
              index === 0
                ? row.map((cell) => (cell.type === 'user' ? { ...cell, value: '姓名' } : cell))
                : row,
            )
          : body.rows;
        view.scoreboardHtml = await inlineAvatars(
          String(
            await h.renderHTML('partials/scoreboard.html', {
              ...body,
              rows,
              udict: realNameUsers(body.udict || {}, identities),
            }),
          ),
          `${h.context.request.protocol}://${h.request.host}`,
          String(H.SystemModel.get('avatar.gravatar_url') || ''),
          config.avatarFallback || '',
        );
      }
      if (name === 'RecordDetail' && typeof body.rdoc?.status === 'number') {
        view.statusHtml = await h.renderHTML('record_detail_status.html', body);
      }
      view.labels = JSON.parse(String(await h.renderHTML('hutoj_client_labels.json', {})));
      body.clientView = view;
    }),
  );

  // The onsite toolkit blocks all domain settings in a later hook. Delegate ONLY
  // displayName to the native handler, then skip that later hook via Hydro control flow.
  ctx.on(
    'handler/before-prepare/HomeSettings#post',
    wrap(async (h: DisplayNameHandler) => {
      if (h.args.category !== 'domain' || !token(h)) {
        return;
      }
      const row = await auth(h);
      const state = await service.state(row);
      if (state.ended || !state.policy.requireClient) {
        fail('CONTEST_NOT_ACTIVE', 409);
      }
      if (
        Object.keys(h.request.body).some((field) => field !== 'displayName') ||
        typeof h.request.body.displayName !== 'string' ||
        !h.request.body.displayName.trim()
      ) {
        fail('DISPLAY_NAME_ONLY', 400);
      }
      // Preserve the onsite toolkit's domain restriction even though its global hook is skipped.
      if (
        typeof h.user.contestMode === 'string' &&
        !['system', h.user.contestMode].includes(domain(h))
      ) {
        fail('INVALID_CONTEST_DOMAIN');
      }
      await h.post({
        domainId: domain(h),
        category: 'domain',
        displayName: h.request.body.displayName,
      });
      if (h.request.json) {
        delete h.response.redirect;
        const user = await H.UserModel.getById(domain(h), h.user._id);
        json(h, { displayName: user?.displayName || '' });
      }
      return 'after';
    }),
  );

  // Resume must not revive a previous environment-ready assertion, even if the
  // client never polled the intermediate ended state.
  ctx.on(
    'handler/after/ContestDetail#post',
    wrap(async (h: HandlerCommon) => {
      if (h.request.body.operation === 'early_end') {
        await service.resetReady(domain(h), h.args.tid, h.user._id);
      }
    }),
  );
  ctx.on(
    'handler/after/ContestUser#post',
    wrap(async (h: HandlerCommon) => {
      if (h.request.body.operation === 'resume') {
        await service.resetReady(domain(h), h.args.tid, +h.args.uid);
      }
    }),
  );
  ctx.on(
    'handler/after/ContestEdit#get',
    wrap(async (h: ContestHandler) => {
      if (h.tdoc && manager(h, h.tdoc) && h.response.template === 'contest_edit.html') {
        h.response.body.hutojClientPolicy = await service.policy(domain(h), h.tdoc.docId);
        h.response.template = 'hutoj_client_contest_edit.html';
      }
    }),
  );
  const fromEditForm = (h: ContestHandler) =>
    h.tdoc &&
    h.request.body.operation === 'update' &&
    ['1', '2'].includes(h.request.body.hutojClientPresent);
  const requestedAccess = (h: ContestHandler) =>
    clientAccess(h.request.body.hutojRequireClient, h.request.body.hutojClientOnly);
  ctx.on(
    'handler/before/ContestEdit#post',
    wrap(async (h: ContestHandler) => {
      if (!fromEditForm(h)) {
        return;
      }
      if (requestedAccess(h).requireClient && service.clientKey.length < 32) {
        fail('CLIENT_KEY_NOT_CONFIGURED', 503);
      }
    }),
  );
  ctx.on(
    'handler/after/ContestEdit#post',
    wrap(async (h: ContestHandler) => {
      if (!fromEditForm(h)) {
        return;
      }
      const access = requestedAccess(h);
      const current = await service.policy(domain(h), h.tdoc!.docId);
      // An edit page opened before the upgrade has no control for exclusivity.
      if (h.request.body.hutojClientPresent === '1' && access.requireClient) {
        access.clientOnly = current.clientOnly;
      }
      if (
        current.requireClient !== access.requireClient ||
        current.clientOnly !== access.clientOnly
      ) {
        await service.savePolicy(domain(h), h.tdoc!.docId, access, h.user._id, 'access');
      }
    }),
  );
  ctx.on('handler/after', (h: ContestHandler) => {
    if (!h.tdoc || !manager(h, h.tdoc) || h.tdoc.rule === 'homework') {
      return;
    }
    const originalTemplate = h.response.template;
    const sidebarTemplate = originalTemplate
      ? config.sidebarTemplates?.[originalTemplate]
      : undefined;
    if (sidebarTemplate) {
      h.response.body.page_name ||= originalTemplate!.split('.')[0];
      h.response.template = sidebarTemplate;
    }
    if (!h.response.body?.overrideNav) {
      return;
    }
    h.response.body.overrideNav.push({
      name: 'hutoj_client_settings',
      displayName: '比赛客户端',
      args: { tid: h.tdoc.docId, prefix: 'hutoj_client_settings' },
      checker: () => true,
    });
  });
  ctx.i18n.load('zh', {
    hutoj_client_settings: '比赛客户端',
    hutoj_client_monitor: '屏幕监控',
  });
  return service;
}
