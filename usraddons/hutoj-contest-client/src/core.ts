import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';
import {
  HEARTBEAT_SECONDS,
  type HeartbeatWatch,
  type WatchedStatus,
} from './heartbeat-watch.ts';
import type { Collection, ObjectId } from 'mongodb';
import type { ContestStatusDoc, Tdoc } from 'hydrooj';

export interface ClientPolicy {
  // Historical storage and protocol name for allowing the desktop client.
  requireClient: boolean;
  clientOnly: boolean;
  restrictNetwork: boolean;
  blockBlacklistApps: boolean;
  blockUsbStorage: boolean;
  forceFullscreen: boolean;
  captureFps: number;
  captureBitrateKbps: number;
  whipUrlTemplate: string;
  mediaApiUrl: string;
  mediaPlaybackUrl: string;
  networkAllowHosts: string[];
  networkAllowEndpoints: string[];
  processBlackList: string[];
  keywordBlackList: string[];
  keywordWhiteList: string[];
}

export type MediaSettings = Pick<
  ClientPolicy,
  'whipUrlTemplate' | 'mediaApiUrl' | 'mediaPlaybackUrl'
>;

export interface PolicyDocument extends Omit<ClientPolicy, keyof MediaSettings>, Partial<MediaSettings> {
  _id: string;
  domainId: string;
  tid: string;
  version: number;
  updatedBy: number;
  updatedAt: Date;
}

export interface RuntimeReport {
  networkControlled: boolean;
  screenCapturing: boolean;
  processMonitored: boolean;
  usbStorageBlocked: boolean;
}
export interface ProcessEvent {
  id: string;
  pid: number;
  name: string;
  description: string;
  rule: string;
  at: Date;
}
export interface EnvironmentIssue {
  key: string;
  name: string;
  kind: 'application' | 'model' | 'plugin';
}
export interface EnvironmentWarning {
  id: string;
  since: Date;
  forced: boolean;
  issues: EnvironmentIssue[];
}

export interface SessionDocument {
  _id: string;
  domainId: string;
  tid: string;
  uid: number;
  deviceId: string;
  deviceInfo?: { system?: string; ip?: string };
  tokenHash: string;
  sessionId: string;
  createdAt: Date;
  lastSeenAt: Date;
  expiresAt: Date;
  purgeAt: Date;
  readyAt: Date | null;
  configVersion: number;
  runtime: RuntimeReport;
  revision: number;
  processEvents?: ProcessEvent[];
  environmentWarning?: EnvironmentWarning | null;
  enteredAt?: Date;
  heartbeatV2?: boolean;
  warningEpoch?: number;
  environmentIssues?: EnvironmentIssue[];
  environmentEvents?: Array<EnvironmentIssue & { at: Date }>;
}

export interface ContestPort {
  get(domainId: string, tid: ObjectId): Promise<Tdoc>;
  getMulti(domainId: string, query: Record<string, unknown>): { toArray(): Promise<Tdoc[]> };
  getStatus(domainId: string, tid: ObjectId, uid: number): Promise<ContestStatusDoc | null>;
  getMultiStatus(
    domainId: string,
    query: Record<string, unknown>,
  ): { toArray(): Promise<ContestStatusDoc[]> };
  isDone(tdoc: Tdoc, tsdoc?: ContestStatusDoc): boolean;
  isNotStarted(tdoc: Tdoc): boolean;
}

export interface UserPort {
  getById(
    domainId: string,
    uid: number,
  ): Promise<{ uname: string; displayName?: string } | null>;
}

export interface ClientServiceOptions {
  settings: Collection<PolicyDocument>;
  sessions: Collection<SessionDocument>;
  contests: ContestPort;
  users: UserPort;
  objectId(value: string): ObjectId;
  now?: () => Date;
  clientKey?: string;
}

export const PROTOCOL_VERSION = 1;
export { HEARTBEAT_SECONDS };
export const LEASE_SECONDS = 90;
export const DEFAULT_POLICY: Readonly<ClientPolicy> = Object.freeze({
  requireClient: false,
  clientOnly: false,
  restrictNetwork: true,
  blockBlacklistApps: true,
  blockUsbStorage: true,
  forceFullscreen: false,
  captureFps: 10,
  captureBitrateKbps: 2000,
  whipUrlTemplate: '',
  mediaApiUrl: '',
  mediaPlaybackUrl: '',
  networkAllowHosts: [],
  networkAllowEndpoints: [],
  processBlackList: [
    'chrome.exe',
    'msedge.exe',
    'firefox.exe',
    'iexplore.exe',
    'qqbrowser.exe',
    '360se.exe',
    '360chrome.exe',
    'opera.exe',
    'brave.exe',
    'qq.exe',
    'wechat.exe',
    'weixin.exe',
    'telegram.exe',
    'discord.exe',
    'anydesk.exe',
    'todesk.exe',
    'sunloginclient.exe',
    'rustdesk.exe',
    'teamviewer.exe',
    'gameviewer.exe',
  ],
  keywordBlackList: [],
  keywordWhiteList: [],
});

export class ClientError extends Error {
  code: string;
  status: number;
  constructor(code: string, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
}
export function fail(code: string, status?: number): never {
  throw new ClientError(code, status);
}
export const secret = () => randomBytes(32).toString('base64url');
export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export function equalSecret(a: unknown, b: unknown): boolean {
  return (
    typeof a === 'string' &&
    typeof b === 'string' &&
    a.length > 0 &&
    timingSafeEqual(Buffer.from(hash(a)), Buffer.from(hash(b)))
  );
}
const key = (...values: Array<string | number | ObjectId>) =>
  JSON.stringify(values.map(String));

function deviceMetadata(value: unknown): { system: string; ip?: string } | undefined {
  if (value === undefined) {
    return;
  }
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !['system', 'ip'].includes(key))
  ) {
    fail('INVALID_DEVICE_INFO', 400);
  }
  const { system, ip } = value as { system?: unknown; ip?: unknown };
  if (
    typeof system !== 'string' ||
    !system.trim() ||
    system.length > 160 ||
    /[\x00-\x1f\x7f]/.test(system)
  ) {
    fail('INVALID_DEVICE_INFO', 400);
  }
  if (ip !== undefined && (typeof ip !== 'string' || ip.length > 64 || !isIP(ip))) {
    fail('INVALID_DEVICE_INFO', 400);
  }
  return { system: system.trim(), ...(typeof ip === 'string' ? { ip } : {}) };
}

function checkbox(name: string, value: unknown, fallback = false): boolean {
  if (value === undefined) return fallback;
  if (value === true || value === 'true' || value === 'on') return true;
  if (value === false || value === 'false') return false;
  fail(`INVALID_${name}`, 400);
}

export function clientAccess(allow: unknown, only: unknown) {
  const enabled = checkbox('requireClient', allow);
  const clientOnly = checkbox('clientOnly', only);
  return { requireClient: enabled || clientOnly, clientOnly };
}

export function validatePolicy(input: Record<string, unknown>): ClientPolicy {
  const result: ClientPolicy = {
    ...DEFAULT_POLICY,
    ...clientAccess(input.requireClient, input.clientOnly),
    networkAllowHosts: [],
  };
  for (const name of [
    'restrictNetwork',
    'blockBlacklistApps',
    'blockUsbStorage',
    'forceFullscreen',
  ] as const) {
    result[name] = checkbox(name, input[name], DEFAULT_POLICY[name]);
  }
  for (const [name, min, max] of [
    ['captureFps', 1, 60],
    ['captureBitrateKbps', 128, 50000],
  ] as const) {
    const value = input[name] ?? DEFAULT_POLICY[name];
    if (
      !['string', 'number'].includes(typeof value) ||
      !Number.isInteger(+value) ||
      +value < min ||
      +value > max
    ) {
      fail(`INVALID_${name}`, 400);
    }
    result[name] = +value;
  }
  const template = input.whipUrlTemplate ?? '';
  if (typeof template !== 'string' || template.length > 2048) {
    fail('INVALID_WHIP_URL', 400);
  }
  result.whipUrlTemplate = template.trim();
  if (result.whipUrlTemplate) {
    let url;
    try {
      url = new URL(
        result.whipUrlTemplate.replace(/\{(?:domainId|contestId|uid|sessionId)\}/g, 'test'),
      );
    } catch {
      fail('INVALID_WHIP_URL', 400);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      /[{}]/.test(
        result.whipUrlTemplate.replace(/\{(?:domainId|contestId|uid|sessionId)\}/g, ''),
      )
    ) {
      fail('INVALID_WHIP_URL', 400);
    }
  }
  const hosts: unknown =
    typeof input.networkAllowHosts === 'string'
      ? input.networkAllowHosts.split(/[\s,]+/).filter(Boolean)
      : (input.networkAllowHosts ?? []);
  if (
    !Array.isArray(hosts) ||
    hosts.length > 64 ||
    hosts.some(
      (host) =>
        typeof host !== 'string' ||
        host.length > 253 ||
        !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host),
    )
  ) {
    fail('INVALID_ALLOW_HOSTS', 400);
  }
  result.networkAllowHosts = [...new Set(hosts.map((host) => host.toLowerCase()))];
  for (const name of [
    'networkAllowEndpoints',
    'processBlackList',
    'keywordBlackList',
    'keywordWhiteList',
  ] as const) {
    const value = input[name] ?? DEFAULT_POLICY[name];
    const list =
      typeof value === 'string'
        ? value
            .split(/\r?\n/)
            .map((s) => s.trim())
            .filter(Boolean)
        : value;
    if (
      !Array.isArray(list) ||
      list.length > 64 ||
      list.some(
        (s) => typeof s !== 'string' || s.length < 1 || s.length > 160 || /[\x00-\x1f]/.test(s),
      )
    ) {
      fail(`INVALID_${name}`, 400);
    }
    result[name] = [...new Set(list)];
  }
  for (const endpoint of result.networkAllowEndpoints) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      fail('INVALID_NETWORK_ENDPOINT', 400);
    }
    if (
      !['tcp:', 'udp:'].includes(url.protocol) ||
      !url.port ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      !['', '/'].includes(url.pathname)
    ) {
      fail('INVALID_NETWORK_ENDPOINT', 400);
    }
  }
  if (result.processBlackList.some((name) => !/^[a-zA-Z0-9_. -]+$/.test(name))) {
    fail('INVALID_PROCESS_NAME', 400);
  }
  for (const name of ['mediaApiUrl', 'mediaPlaybackUrl'] as const) {
    const value = input[name] ?? '';
    if (typeof value !== 'string' || value.length > 2048) {
      fail(`INVALID_${name}`, 400);
    }
    result[name] = value.trim();
    if (!result[name]) {
      continue;
    }
    let url;
    try {
      url = new URL(result[name]);
    } catch {
      fail(`INVALID_${name}`, 400);
    }
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.hash ||
      url.search
    ) {
      fail(`INVALID_${name}`, 400);
    }
  }
  return result;
}

export function runtimeReport(input: Record<string, unknown> = {}): RuntimeReport {
  // These are client reports, never proof of OS isolation or successful server recording.
  return {
    networkControlled: input.networkControlled === true,
    screenCapturing: input.screenCapturing === true,
    processMonitored: input.processMonitored === true,
    usbStorageBlocked: input.usbStorageBlocked === true,
  };
}

export class ClientService {
  watch?: HeartbeatWatch;
  settings: Collection<PolicyDocument>;
  sessions: Collection<SessionDocument>;
  contests: ContestPort;
  users: UserPort;
  objectId: (value: string) => ObjectId;
  now: () => Date;
  clientKey: string;
  mediaSettings: () => MediaSettings = () => ({
    whipUrlTemplate: '',
    mediaApiUrl: '',
    mediaPlaybackUrl: '',
  });

  constructor({
    settings,
    sessions,
    contests,
    users,
    objectId,
    now = () => new Date(),
    clientKey = '',
  }: ClientServiceOptions) {
    this.settings = settings;
    this.sessions = sessions;
    this.contests = contests;
    this.users = users;
    this.objectId = objectId;
    this.now = now;
    this.clientKey = clientKey;
  }

  async init() {
    await this.settings.createIndex({ domainId: 1, requireClient: 1 });
    await this.sessions.createIndex({ domainId: 1, tid: 1 });
    await this.sessions.createIndex({ tokenHash: 1 }, { unique: true });
    await this.sessions.createIndex({ purgeAt: 1 }, { expireAfterSeconds: 0 });
  }

  parseTid(value: unknown): ObjectId {
    if (!/^[a-f\d]{24}$/i.test(String(value))) {
      fail('INVALID_CONTEST_ID', 400);
    }
    return this.objectId(String(value));
  }

  async policy(domainId: string, tid: ObjectId | string) {
    const row = await this.settings.findOne({ _id: key(domainId, tid) });
    const {
      requireNetworkControl: _oldNetwork,
      requireScreenCapture: _oldScreen,
      captureWidth: _oldWidth,
      captureHeight: _oldHeight,
      ...current
    } = (row || {}) as PolicyDocument & {
      requireNetworkControl?: boolean;
      requireScreenCapture?: boolean;
      captureWidth?: number;
      captureHeight?: number;
    };
    const media = this.mediaSettings();
    // The numeric revision is opaque to clients. Include global settings so an
    // address change invalidates readiness and reconnects capture on every worker.
    const version = Number.parseInt(
      hash(JSON.stringify([row?.version ?? 0, media])).slice(0, 13),
      16,
    );
    return { ...DEFAULT_POLICY, ...current, ...media, version };
  }

  async savePolicy(
    domainId: string,
    tid: ObjectId | string,
    input: Record<string, unknown>,
    uid: number,
    fields: 'all' | 'access' | 'settings' = 'all',
  ) {
    // Media infrastructure is owned by system settings, including for old forms.
    const policy = validatePolicy({
      ...input,
      whipUrlTemplate: '',
      mediaApiUrl: '',
      mediaPlaybackUrl: '',
    });
    if (policy.requireClient && this.clientKey.length < 32) {
      fail('CLIENT_KEY_NOT_CONFIGURED', 503);
    }
    const tdoc = await this.contests.get(domainId, this.parseTid(tid));
    if (tdoc.rule === 'homework') {
      fail('HOMEWORK_NOT_SUPPORTED', 400);
    }
    // The contest and settings forms own different fields and can be saved concurrently.
    const {
      requireClient,
      clientOnly,
      whipUrlTemplate,
      mediaApiUrl,
      mediaPlaybackUrl,
      ...settings
    } = policy;
    const access = { requireClient, clientOnly };
    let changes: Partial<ClientPolicy> = { ...settings, ...access };
    let defaults: Partial<ClientPolicy> = {};
    if (fields === 'access') {
      changes = access;
      defaults = settings;
    } else if (fields === 'settings') {
      changes = settings;
      defaults = access;
    }
    // Every policy change invalidates readiness, including off -> on transitions.
    await this.settings.updateOne(
      { _id: key(domainId, tid) },
      {
        $set: { domainId, tid: String(tid), ...changes, updatedBy: uid, updatedAt: this.now() },
        ...(fields === 'all' ? {} : { $setOnInsert: defaults }),
        $inc: { version: 1 },
        $unset: {
          requireNetworkControl: '',
          requireScreenCapture: '',
          captureWidth: '',
          captureHeight: '',
          whipUrlTemplate: '',
          mediaApiUrl: '',
          mediaPlaybackUrl: '',
        },
      },
      { upsert: true },
    );
    if (fields !== 'settings' && !requireClient) {
      await this.watch?.disarm({ domainId, docId: this.parseTid(tid) });
    }
    return this.policy(domainId, tid);
  }

  async eligible(
    domainId: string,
    uid: number,
  ): Promise<Array<{ tdoc: Tdoc; tsdoc: ContestStatusDoc; clientOnly: boolean }>> {
    const configs = await this.settings.find({ domainId, requireClient: true }).toArray();
    if (!configs.length) {
      return [];
    }
    const exclusive = new Set(configs.filter((c) => c.clientOnly).map((c) => c.tid));
    const tids = configs.map((c) => this.parseTid(c.tid));
    const [tdocs, statuses] = await Promise.all([
      this.contests
        .getMulti(domainId, {
          docId: { $in: tids },
          endAt: { $gt: this.now() },
          rule: { $ne: 'homework' },
        })
        .toArray(),
      this.contests
        .getMultiStatus(domainId, { uid, attend: 1, docId: { $in: tids } })
        .toArray(),
    ]);
    const eligible = tdocs.flatMap((tdoc) => {
      const tsdoc = statuses.find((s) => String(s.docId) === String(tdoc.docId));
      if (!tsdoc || this.finished(tdoc, tsdoc)) return [];
      return [{ tdoc, tsdoc, clientOnly: exclusive.has(String(tdoc.docId)) }];
    });
    return eligible.sort(
      (a, b) =>
        +a.tdoc.beginAt - +b.tdoc.beginAt ||
        String(a.tdoc.docId).localeCompare(String(b.tdoc.docId)),
    );
  }

  private finished(tdoc: Tdoc, status: ContestStatusDoc) {
    // Hydro may compare a null startAt to a Date as zero. An enrolled contestant
    // who has not opened the problem list has not consumed their personal timer.
    return (
      +tdoc.endAt <= +this.now() ||
      !!(status.endAt && +status.endAt <= +this.now()) ||
      !!(
        tdoc.duration &&
        status.startAt &&
        +status.startAt + Math.floor(tdoc.duration * 3600_000) <= +this.now()
      )
    );
  }

  async select(domainId: string, uid: number, contestId?: string) {
    let choices = await this.eligible(domainId, uid);
    if (contestId) {
      this.parseTid(contestId);
      const selected = choices.find((choice) => String(choice.tdoc.docId) === contestId);
      if (!selected) {
        fail('CONTEST_NOT_ELIGIBLE', 409);
      }
      return selected;
    }
    if (!choices.length) {
      fail('NO_CLIENT_CONTEST', 404);
    }
    const ongoing = choices.filter(({ tdoc }) => !this.contests.isNotStarted(tdoc));
    choices = ongoing.length
      ? ongoing
      : choices.filter(({ tdoc }) => +tdoc.beginAt === +choices[0].tdoc.beginAt);
    if (choices.length !== 1) {
      fail('MULTIPLE_CLIENT_CONTESTS', 409);
    }
    return choices[0];
  }

  async open(
    domainId: string,
    uid: number,
    suppliedKey: unknown,
    deviceId: unknown,
    contestId?: string,
    metadata: { deviceInfo?: unknown; heartbeatV2?: boolean } = {},
  ) {
    if (this.clientKey.length < 32) {
      fail('CLIENT_KEY_NOT_CONFIGURED', 503);
    }
    if (!equalSecret(suppliedKey, this.clientKey)) {
      fail('INVALID_CLIENT_KEY');
    }
    if (typeof deviceId !== 'string' || !/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId)) {
      fail('INVALID_DEVICE_ID', 400);
    }
    const deviceInfo = deviceMetadata(metadata.deviceInfo);
    const { tdoc } = await this.select(domainId, uid, contestId);
    const tid = String(tdoc.docId);
    const _id = key(domainId, tid, uid);
    const token = secret();
    const now = this.now();
    const row: Omit<SessionDocument, '_id' | 'revision'> = {
      domainId,
      tid,
      uid,
      deviceId,
      tokenHash: hash(token),
      sessionId: secret(),
      deviceInfo: deviceInfo || {},
      heartbeatV2: metadata.heartbeatV2 === true,
      createdAt: now,
      lastSeenAt: now,
      expiresAt: new Date(+now + LEASE_SECONDS * 1000),
      purgeAt: new Date(Math.max(+tdoc.endAt, +now) + 7 * 86400_000),
      readyAt: null,
      configVersion: -1,
      runtime: runtimeReport(),
    };
    // The deterministic _id makes simultaneous opens/takeovers atomic across PM2 workers.
    try {
      const acquired = await this.sessions.findOneAndUpdate(
        {
          _id,
          $or: [{ deviceId }, { expiresAt: { $lte: now } }],
        },
        { $set: row, $inc: { revision: 1 } },
        { upsert: true, returnDocument: 'after' },
      );
      if (!acquired) {
        fail('CLIENT_SESSION_CHANGED', 409);
      }
      return { token, row: acquired };
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 11000) {
        fail('DEVICE_IN_USE', 409);
      }
      throw error;
    }
  }

  async authenticate(
    domainId: string,
    uid: number,
    token: unknown,
    allowExpired = false,
  ): Promise<SessionDocument> {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) {
      fail('CLIENT_SESSION_REQUIRED');
    }
    const row = await this.sessions.findOne({
      domainId,
      uid,
      tokenHash: hash(token),
      ...(allowExpired ? {} : { expiresAt: { $gt: this.now() } }),
    });
    if (!row) {
      fail('CLIENT_SESSION_EXPIRED');
    }
    return row;
  }

  async state(row: SessionDocument) {
    const tid = this.parseTid(row.tid);
    const [tdoc, initialStatus, policy] = await Promise.all([
      this.contests.get(row.domainId, tid),
      this.contests.getStatus(row.domainId, tid, row.uid),
      this.policy(row.domainId, row.tid),
    ]);
    let tsdoc = initialStatus;
    const deadline = (tsdoc as WatchedStatus | null)?.clientHeartbeatDue;
    if (this.watch && deadline && deadline <= this.now()) {
      await this.watch.settle(tsdoc as WatchedStatus);
      tsdoc = await this.contests.getStatus(row.domainId, tid, row.uid);
    }
    if (!tsdoc?.attend) {
      fail('CONTEST_MEMBERSHIP_REMOVED');
    }
    const ended = this.finished(tdoc, tsdoc);
    const ready =
      policy.requireClient &&
      row.expiresAt > this.now() &&
      !!row.readyAt &&
      row.configVersion === policy.version &&
      (!policy.restrictNetwork || row.runtime.networkControlled) &&
      row.runtime.screenCapturing &&
      (!policy.blockBlacklistApps || row.runtime.processMonitored) &&
      (!policy.blockUsbStorage || row.runtime.usbStorageBlocked) &&
      (!policy.blockBlacklistApps || !row.environmentWarning?.forced);
    return { tdoc, tsdoc, policy, ended, ready };
  }

  async snapshot(row: SessionDocument) {
    const { tdoc, tsdoc, policy, ended, ready } = await this.state(row);
    const user = await this.users.getById(row.domainId, row.uid);
    if (!user) {
      fail('CLIENT_USER_MISSING');
    }
    const phase = !policy.requireClient
      ? 'released'
      : ended
        ? 'ended'
        : this.contests.isNotStarted(tdoc)
          ? 'waiting'
          : ready
            ? 'active'
            : 'preparing';
    let endAt = tdoc.endAt;
    if (tsdoc.endAt && tsdoc.endAt < endAt) {
      endAt = tsdoc.endAt;
    }
    if (tdoc.duration && tsdoc.startAt) {
      endAt = new Date(Math.min(+endAt, +tsdoc.startAt + Math.floor(tdoc.duration * 3600_000)));
    }
    const values = {
      domainId: row.domainId,
      contestId: row.tid,
      uid: String(row.uid),
      sessionId: row.sessionId,
    };
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverTime: this.now(),
      user: { id: row.uid, username: user.uname, displayName: user.displayName || '' },
      contest: {
        id: row.tid,
        title: tdoc.title,
        beginAt: tdoc.beginAt,
        endAt,
        startAt: tsdoc.startAt || null,
        scheduledEndAt: tdoc.endAt,
        durationHours: tdoc.duration || (+tdoc.endAt - +tdoc.beginAt) / 3600_000,
        personalDurationHours: tdoc.duration || null,
      },
      phase,
      ready,
      unlockAllowed: ended || !policy.requireClient,
      environmentWarning: policy.blockBlacklistApps ? row.environmentWarning || null : null,
      warningEpoch: row.warningEpoch || 0,
      entered: !!row.enteredAt,
      session: {
        id: row.sessionId,
        expiresAt: row.expiresAt,
        heartbeatSeconds: HEARTBEAT_SECONDS,
      },
      policy: {
        version: policy.version,
        requireClient: policy.requireClient,
        clientOnly: policy.clientOnly,
        restrictNetwork: policy.restrictNetwork,
        blockBlacklistApps: policy.blockBlacklistApps,
        blockUsbStorage: policy.blockUsbStorage,
        forceFullscreen: policy.forceFullscreen,
        networkAllowHosts: policy.networkAllowHosts,
        networkAllowEndpoints: policy.networkAllowEndpoints,
        processPolicy: {
          names: policy.processBlackList,
          keywords: policy.keywordBlackList,
          whites: policy.keywordWhiteList,
        },
        capture: { fps: policy.captureFps, bitrateKbps: policy.captureBitrateKbps },
        whipUrl: policy.whipUrlTemplate.replace(
          /\{(domainId|contestId|uid|sessionId)\}/g,
          (_, name: keyof typeof values) => encodeURIComponent(values[name]),
        ),
      },
    };
  }

  async heartbeat(
    row: SessionDocument,
    input: Record<string, unknown>,
    markReady = false,
  ): Promise<SessionDocument> {
    const { policy, ended } = await this.state(row);
    const report = runtimeReport(input);
    const deviceInfo = deviceMetadata(input.deviceInfo);
    const requirementsMet =
      (!policy.restrictNetwork || report.networkControlled) &&
      report.screenCapturing &&
      (!policy.blockBlacklistApps || report.processMonitored) &&
      (!policy.blockUsbStorage || report.usbStorageBlocked);
    const events = input.processEvents ?? [];
    if (!Array.isArray(events) || events.length > 50) {
      fail('INVALID_PROCESS_EVENTS', 400);
    }
    const history = [...(row.processEvents || [])];
    for (const event of events) {
      if (
        !event ||
        typeof event !== 'object' ||
        !/^[a-f0-9-]{36}$/.test(event.id) ||
        !Number.isSafeInteger(event.pid) ||
        event.pid < 1 ||
        event.pid > 0xffffffff ||
        typeof event.name !== 'string' ||
        event.name.length > 160 ||
        /[\\/\x00-\x1f]/.test(event.name) ||
        typeof event.description !== 'string' ||
        event.description.length > 160 ||
        typeof event.rule !== 'string' ||
        event.rule.length > 180 ||
        !/^(process|keyword):/.test(event.rule)
      ) {
        fail('INVALID_PROCESS_EVENTS', 400);
      }
      if (!history.some((old) => old.id === event.id)) {
        history.push({
          id: event.id,
          pid: event.pid,
          name: event.name,
          description: event.description,
          rule: event.rule,
          at: this.now(),
        });
      }
    }
    if (markReady && (ended || !policy.requireClient)) {
      fail('CONTEST_NOT_ACTIVE', 409);
    }
    if (markReady && !requirementsMet) {
      fail('CLIENT_NOT_READY', 409);
    }
    if (markReady) {
      const user = await this.users.getById(row.domainId, row.uid);
      if (!user?.displayName?.trim()) {
        fail('DISPLAY_NAME_REQUIRED', 409);
      }
    }
    const now = this.now();
    let warning = row.environmentWarning || null;
    if (!policy.blockBlacklistApps) {
      warning = null;
    }
    let currentIssues = row.environmentIssues || [];
    let environmentEvents = row.environmentEvents || [];
    if (input.environmentIssues !== undefined) {
      const issues = policy.blockBlacklistApps ? input.environmentIssues : [];
      if (
        !Array.isArray(issues) ||
        issues.length > 100 ||
        issues.some(
          (issue) =>
            !issue ||
            typeof issue.key !== 'string' ||
            issue.key.length > 240 ||
            typeof issue.name !== 'string' ||
            !issue.name ||
            issue.name.length > 160 ||
            /[\x00-\x1f]/.test(issue.name) ||
            !['application', 'model', 'plugin'].includes(issue.kind),
        )
      ) {
        fail('INVALID_ENVIRONMENT_ISSUES', 400);
      }
      const sameEpoch =
        input.warningEpoch === undefined || input.warningEpoch === (row.warningEpoch || 0);
      if (row.enteredAt) {
        const oldKeys = new Set(currentIssues.map((issue) => issue.key));
        environmentEvents = [
          ...environmentEvents,
          ...issues
            .filter((issue) => issue.kind !== 'application' && !oldKeys.has(issue.key))
            .map((issue) => ({ ...issue, at: now })),
        ].slice(-200);
      }
      currentIssues = issues;
      if (issues.length && row.enteredAt && sameEpoch) {
        warning = warning
          ? { ...warning, issues, forced: warning.forced || +now - +warning.since >= 60000 }
          : { id: secret(), since: now, forced: false, issues };
        if (input.forceEnvironmentWarning === true) {
          warning.forced = true;
        }
      } else if (!warning?.forced && sameEpoch) {
        warning = null;
      }
    }
    const ready =
      requirementsMet &&
      !ended &&
      policy.requireClient &&
      (markReady || (!!row.readyAt && row.configVersion === policy.version));
    const updated = await this.sessions.findOneAndUpdate(
      {
        _id: row._id,
        tokenHash: row.tokenHash,
        revision: row.revision,
        expiresAt: { $gt: now },
      },
      {
        $set: {
          runtime: report,
          lastSeenAt: now,
          expiresAt: new Date(+now + LEASE_SECONDS * 1000),
          readyAt: ready ? row.readyAt || now : null,
          configVersion: ready ? policy.version : -1,
          processEvents: history.slice(-200),
          environmentWarning: warning,
          environmentIssues: currentIssues,
          environmentEvents,
          ...(deviceInfo ? { deviceInfo } : {}),
        },
        $inc: { revision: 1 },
      },
      { returnDocument: 'after' },
    );
    if (!updated) {
      fail('CLIENT_SESSION_CHANGED', 409);
    }
    return updated;
  }

  async requireSession(
    domainId: string,
    uid: number,
    token: unknown,
    tid: ObjectId | string,
    ready = true,
  ) {
    const row = await this.authenticate(domainId, uid, token);
    if (String(tid) !== row.tid) {
      fail('CLIENT_CONTEST_MISMATCH');
    }
    const state = await this.state(row);
    if (!state.policy.requireClient) fail('CONTEST_NOT_ELIGIBLE', 409);
    if (ready && !state.ended && !state.ready) {
      fail('CLIENT_NOT_READY', 409);
    }
    return row;
  }

  async resetReady(domainId: string, tid: ObjectId | string, uid: number) {
    await this.watch?.disarm({ domainId, docId: this.parseTid(tid), uid });
    await this.sessions.updateOne(
      { _id: key(domainId, tid, uid) },
      {
        $set: { readyAt: null, configVersion: -1 },
        $inc: { revision: 1 },
      },
    );
  }
  async clearWarning(domainId: string, tid: ObjectId | string, uid: number, warningId: string) {
    if (typeof warningId !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(warningId)) {
      fail('INVALID_WARNING_ID', 400);
    }
    const result = await this.sessions.updateOne(
      {
        _id: key(domainId, tid, uid),
        'environmentWarning.id': warningId,
        'environmentWarning.forced': true,
      },
      { $set: { environmentWarning: null }, $inc: { revision: 1, warningEpoch: 1 } },
    );
    if (!result.matchedCount) {
      fail('WARNING_CHANGED', 409);
    }
  }
  async markEntered(row: SessionDocument) {
    await this.sessions.updateOne(
      { _id: row._id, tokenHash: row.tokenHash, enteredAt: { $exists: false } },
      { $set: { enteredAt: this.now() } },
    );
  }
}
