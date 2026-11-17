import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable } from 'node:stream';
import type { Context, Handler, Tdoc } from 'hydrooj';
import { ClientError, ClientService, equalSecret, fail, secret } from './core.ts';
import type { ClientPolicy, SessionDocument } from './core.ts';
import { recordingStart } from './recording-times.ts';
import type { WatchedStatus } from './heartbeat-watch.ts';

type Hydro = typeof import('hydrooj');
type Viewer = {
  resource: URL;
  domainId: string;
  tid: string;
  uid: number;
  timer: ReturnType<typeof setTimeout>;
};
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function recordingPattern(policy: ClientPolicy, domainId: string, tid: string): RegExp {
  if (
    !['{domainId}', '{contestId}', '{uid}', '{sessionId}'].every((value) =>
      policy.whipUrlTemplate.includes(value),
    )
  ) {
    fail('MONITOR_TEMPLATE_REQUIRED', 400);
  }
  const shape = new URL(
    policy.whipUrlTemplate
      .replaceAll('{domainId}', 'CLIENT_DOMAIN')
      .replaceAll('{contestId}', 'CLIENT_CONTEST')
      .replaceAll('{uid}', 'CLIENT_UID')
      .replaceAll('{sessionId}', 'CLIENT_SESSION'),
  ).pathname;
  if (
    !['CLIENT_DOMAIN', 'CLIENT_CONTEST', 'CLIENT_UID', 'CLIENT_SESSION'].every((value) =>
      shape.includes(value),
    )
  ) {
    fail('MONITOR_TEMPLATE_REQUIRED', 400);
  }
  const target = new URL(
    policy.whipUrlTemplate
      .replaceAll('{domainId}', encodeURIComponent(domainId))
      .replaceAll('{contestId}', tid)
      .replaceAll('{uid}', 'CLIENT_UID')
      .replaceAll('{sessionId}', 'CLIENT_SESSION'),
  );
  if (!target.pathname.endsWith('/whip')) {
    fail('MONITOR_WHIP_PATH_REQUIRED', 400);
  }
  return new RegExp(
    `^${escape(target.pathname.slice(1, -5)).replace('CLIENT_UID', '(?<uid>[1-9][0-9]*)').replace('CLIENT_SESSION', '[A-Za-z0-9_-]+')}$`,
  );
}

export function registerMonitor(ctx: Context, H: Hydro, service: ClientService) {
  const viewers = new Map<string, Viewer>();
  const removeViewer = async (id: string) => {
    const viewer = viewers.get(id);
    if (!viewer) {
      return;
    }
    clearTimeout(viewer.timer);
    viewers.delete(id);
    await fetch(viewer.resource, {
      method: 'DELETE',
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  };
  const renew = (id: string, viewer: Viewer) => {
    clearTimeout(viewer.timer);
    viewer.timer = setTimeout(() => void removeViewer(id), 60_000);
    viewer.timer.unref();
  };
  ctx.effect(() => () => {
    for (const id of viewers.keys()) {
      void removeViewer(id);
    }
  });
  const json = (h: Handler, data: unknown) => {
    h.response.type = 'application/json';
    h.response.body = data;
  };
  const getJson = async (url: URL) => {
    try {
      const response = await fetch(url, {
        redirect: 'error',
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        fail('MEDIA_SERVICE_UNAVAILABLE', 502);
      }
      return await response.json();
    } catch {
      fail('MEDIA_SERVICE_UNAVAILABLE', 502);
    }
  };
  class MonitorBase extends H.Handler {
    tdoc!: Tdoc;
    policy!: ClientPolicy;
    async prepare() {
      this.checkPriv(H.PRIV.PRIV_USER_PROFILE);
      this.tdoc = await H.ContestModel.get(this.domain._id, service.parseTid(this.args.tid));
      if (
        !this.user.hasPerm(H.PERM.PERM_EDIT_CONTEST) &&
        !(this.user.own(this.tdoc) && this.user.hasPerm(H.PERM.PERM_EDIT_CONTEST_SELF))
      ) {
        fail('CONTEST_MANAGEMENT_REQUIRED');
      }
      this.policy = await service.policy(this.domain._id, this.tdoc.docId);
      this.response.addHeader('Cache-Control', 'no-store');
    }
    streamPattern() {
      return recordingPattern(this.policy, this.domain._id, String(this.tdoc.docId));
    }
  }
  class HutojClientMonitorHandler extends MonitorBase {
    async get() {
      this.session.hutojClientCsrf ||= secret();
      if (this.request.query.events !== undefined) {
        const uid = Number(this.request.query.events);
        if (!Number.isSafeInteger(uid) || uid < 1) {
          fail('INVALID_UID', 400);
        }
        const row = await service.sessions.findOne(
          { domainId: this.domain._id, tid: String(this.tdoc.docId), uid },
          { projection: { processEvents: 1, environmentWarning: 1, environmentEvents: 1 } },
        );
        json(this, {
          events: [...(row?.processEvents || [])].reverse(),
          environmentEvents: [...(row?.environmentEvents || [])].reverse(),
          environmentWarning: row?.environmentWarning || null,
        });
        return;
      }
      if (this.request.query.recordings !== undefined) {
        const uid = Number(this.request.query.recordings);
        if (!Number.isSafeInteger(uid) || uid < 1) {
          fail('INVALID_UID', 400);
        }
        if (!this.policy.mediaApiUrl || !this.policy.mediaPlaybackUrl) {
          fail('PLAYBACK_NOT_CONFIGURED', 409);
        }
        const pattern = this.streamPattern();
        const recordings: { path: string; start: string; duration: number; url: string }[] = [];
        for (let page = 0; page < 100; page++) {
          const url = new URL(
            `${this.policy.mediaApiUrl.replace(/\/$/, '')}/v3/recordings/list`,
          );
          url.searchParams.set('page', String(page));
          url.searchParams.set('itemsPerPage', '1000');
          const data = await getJson(url);
          for (const item of data.items || []) {
            if (Number(pattern.exec(item.name)?.groups?.uid) !== uid) {
              continue;
            }
            for (const segment of item.segments || []) {
              if (
                !Number.isFinite(segment.duration) ||
                segment.duration <= 0 ||
                !Number.isFinite(Date.parse(segment.start))
              ) {
                continue;
              }
              for (let offset = 0; offset < Math.min(segment.duration, 86400); offset += 300) {
                const start = recordingStart(segment.start, offset);
                const duration = Math.min(segment.duration - offset, 300);
                const query = new URLSearchParams({
                  path: item.name,
                  start,
                  duration: String(duration),
                });
                recordings.push({
                  path: item.name,
                  start,
                  duration,
                  url: `${this.url('hutoj_client_recording', { tid: this.tdoc.docId })}?${query}`,
                });
              }
            }
          }
          if (page + 1 >= data.pageCount) {
            break;
          }
        }
        recordings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
        json(this, { recordings });
        return;
      }
      const rows = await service.sessions
        .find({ domainId: this.domain._id, tid: String(this.tdoc.docId) })
        .sort({ uid: 1 })
        .toArray();
      const attendees = await H.ContestModel.getMultiStatus(this.domain._id, {
        docId: this.tdoc.docId,
        attend: 1,
      }).toArray();
      const ids = [
        ...new Set([...attendees.map((status) => status.uid), ...rows.map((row) => row.uid)]),
      ].sort((a, b) => a - b);
      const users = await H.UserModel.getList(this.domain._id, ids);
      const sessions = new Map(rows.map((row) => [row.uid, row]));
      const offline = new Map(
        attendees.map((status) => [
          status.uid,
          (status as unknown as WatchedStatus).clientOfflineAt,
        ]),
      );
      const ended = new Map(
        attendees
          .filter((status) => status.endAt && status.endAt <= new Date())
          .map((status) => [status.uid, status.endAt]),
      );
      const clients = ids.map((uid) => ({
        uid,
        name: users[uid]?.displayName || users[uid]?.uname || String(uid),
        offlineAt: offline.get(uid) || null,
        endAt: ended.get(uid) || null,
        online:
          !ended.has(uid) &&
          !!sessions.get(uid) &&
          +sessions.get(uid)!.expiresAt > Date.now() &&
          sessions.get(uid)!.runtime.screenCapturing,
        lastSeenAt: sessions.get(uid)?.lastSeenAt || null,
        deviceInfo: {
          system: sessions.get(uid)?.deviceInfo?.system || '',
          ip: sessions.get(uid)?.deviceInfo?.ip || '',
        },
        processMonitored: sessions.get(uid)?.runtime.processMonitored === true,
        environmentWarning: sessions.get(uid)?.environmentWarning || null,
        violations:
          (sessions.get(uid)?.processEvents?.length || 0) +
          (sessions.get(uid)?.environmentEvents?.length || 0),
      }));
      const data = {
        tdoc: this.tdoc,
        clients,
        csrf: this.session.hutojClientCsrf,
        openedAt: Date.now(),
        playbackConfigured: !!this.policy.mediaApiUrl && !!this.policy.mediaPlaybackUrl,
      };
      if (this.request.json) {
        json(this, data);
      } else {
        this.response.template = 'hutoj_client_monitor.html';
        this.response.body = data;
      }
    }
    async post() {
      const origin = this.request.headers.origin;
      if (origin && new URL(String(origin)).host !== this.request.host) {
        fail('INVALID_ORIGIN');
      }
      if (!equalSecret(this.request.body.csrf, this.session.hutojClientCsrf)) {
        fail('INVALID_CSRF');
      }
      const { action: operation, id } = this.request.body;
      if (operation === 'clear-warning') {
        const uid = Number(this.request.body.uid);
        if (!Number.isSafeInteger(uid) || uid < 1) {
          fail('INVALID_UID', 400);
        }
        await service.clearWarning(
          this.domain._id,
          this.tdoc.docId,
          uid,
          this.request.body.warningId,
        );
        json(this, {});
        return;
      }
      if (operation === 'stop' || operation === 'keepalive') {
        const viewer = viewers.get(String(id));
        if (
          !viewer ||
          viewer.uid !== this.user._id ||
          viewer.domainId !== this.domain._id ||
          viewer.tid !== String(this.tdoc.docId)
        ) {
          fail('VIEWER_NOT_FOUND', 404);
        }
        if (operation === 'stop') {
          await removeViewer(id);
        } else {
          renew(id, viewer);
        }
        json(this, {});
        return;
      }
      if (operation !== 'watch') {
        fail('INVALID_MONITOR_OPERATION', 400);
      }
      await this.limitRate('hutoj_monitor_watch', 60, 30);
      const uid = Number(this.request.body.uid);
      const sdp = this.request.body.sdp;
      if (
        !Number.isSafeInteger(uid) ||
        uid < 1 ||
        typeof sdp !== 'string' ||
        !sdp.startsWith('v=0') ||
        sdp.length > 128 * 1024
      ) {
        fail('INVALID_VIEWER', 400);
      }
      const row = await service.sessions.findOne({
        domainId: this.domain._id,
        tid: String(this.tdoc.docId),
        uid,
      });
      if (!row || +row.expiresAt <= Date.now() || !row.runtime.screenCapturing) {
        fail('SCREEN_OFFLINE', 409);
      }
      this.streamPattern();
      const state = await service.snapshot(row as SessionDocument);
      const target = new URL(state.policy.whipUrl);
      target.pathname = target.pathname.replace(/\/whip$/, '/whep');
      // Keep one live reader per administrator/contest. Never send Hydro cookies,
      // session tokens or the deployment key to the media service.
      for (const [key, viewer] of viewers) {
        if (
          viewer.uid === this.user._id &&
          viewer.tid === String(this.tdoc.docId) &&
          viewer.domainId === this.domain._id
        ) {
          await removeViewer(key);
        }
      }
      let response;
      try {
        response = await fetch(target, {
          method: 'POST',
          redirect: 'error',
          headers: { 'Content-Type': 'application/sdp' },
          body: sdp,
          signal: AbortSignal.timeout(15000),
        });
      } catch {
        fail('MEDIA_SERVICE_UNAVAILABLE', 502);
      }
      if (response.status !== 201 || !response.headers.get('location')) {
        fail('SCREEN_OFFLINE', 409);
      }
      const resource = new URL(response.headers.get('location')!, target);
      if (
        resource.origin !== target.origin ||
        !resource.pathname.startsWith(`${target.pathname}/`)
      ) {
        fail('INVALID_MEDIA_RESOURCE', 502);
      }
      const viewerId = secret();
      const viewer = {
        resource,
        domainId: this.domain._id,
        tid: String(this.tdoc.docId),
        uid: this.user._id,
        timer: null!,
      } as Viewer;
      viewers.set(viewerId, viewer);
      renew(viewerId, viewer);
      json(this, { id: viewerId, sdp: await response.text() });
    }
  }
  class HutojClientMonitorScriptHandler extends MonitorBase {
    async get() {
      this.response.type = 'application/javascript';
      this.response.body = await readFile(path.join(__dirname, 'web/monitor.js'), 'utf8');
    }
  }
  class HutojClientRecordingHandler extends MonitorBase {
    async get() {
      if (!this.policy.mediaPlaybackUrl) {
        fail('PLAYBACK_NOT_CONFIGURED', 409);
      }
      const { path: stream, start, duration } = this.request.query;
      if (
        typeof stream !== 'string' ||
        !this.streamPattern().test(stream) ||
        typeof start !== 'string' ||
        !Number.isFinite(Date.parse(start)) ||
        !Number.isFinite(Number(duration)) ||
        Number(duration) <= 0 ||
        Number(duration) > 300
      ) {
        fail('INVALID_RECORDING', 400);
      }
      const target = new URL(`${this.policy.mediaPlaybackUrl.replace(/\/$/, '')}/get`);
      target.search = new URLSearchParams({
        path: stream,
        start,
        duration: String(duration),
        format: 'mp4',
      }).toString();
      const range = this.request.headers.range;
      const response = await fetch(target, {
        redirect: 'error',
        signal: AbortSignal.timeout(120000),
        headers: typeof range === 'string' ? { Range: range } : {},
      });
      if (!response.ok || !response.body) {
        fail('RECORDING_UNAVAILABLE', 404);
      }
      this.response.status = response.status;
      this.response.type = 'video/mp4';
      for (const header of ['Content-Length', 'Content-Range', 'Accept-Ranges']) {
        if (response.headers.get(header)) {
          this.response.addHeader(header, response.headers.get(header)!);
        }
      }
      this.response.body = Readable.fromWeb(
        response.body as Parameters<typeof Readable.fromWeb>[0],
      );
    }
  }
  const ProtocolError = H.CreateError('HutojClientMonitorError', H.UserFacingError, '{0}', 403);
  for (const Class of [
    MonitorBase,
    HutojClientMonitorHandler,
    HutojClientMonitorScriptHandler,
    HutojClientRecordingHandler,
  ]) {
    const prototype = Class.prototype as unknown as Record<
      string,
      (this: Handler, ...args: any[]) => Promise<unknown>
    >;
    for (const method of ['prepare', 'get', 'post']) {
      if (!Object.hasOwn(prototype, method)) {
        continue;
      }
      const original = prototype[method];
      prototype[method] = async function (...args: any[]) {
        try {
          return await original.apply(this, args);
        } catch (error) {
          if (!(error instanceof ClientError)) {
            throw error;
          }
          const converted = new ProtocolError(error.code);
          converted.code = error.status;
          throw converted;
        }
      };
    }
  }
  ctx.Route(
    'hutoj_client_monitor',
    '/contest/:tid/client/monitor',
    HutojClientMonitorHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_monitor_script',
    '/contest/:tid/client/monitor/script.js',
    HutojClientMonitorScriptHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
  ctx.Route(
    'hutoj_client_recording',
    '/contest/:tid/client/monitor/recording',
    HutojClientRecordingHandler,
    H.PRIV.PRIV_USER_PROFILE,
  );
}
