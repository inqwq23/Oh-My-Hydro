"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key2 of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key2) && key2 !== except)
        __defProp(to, key2, { get: () => from[key2], enumerable: !(desc = __getOwnPropDesc(from, key2)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// plugins/hutoj-contest-client/src/index.ts
var index_exports = {};
__export(index_exports, {
  Config: () => Config,
  apply: () => apply,
  inject: () => inject,
  name: () => name,
  registerTemplates: () => registerTemplates
});
module.exports = __toCommonJS(index_exports);
var Hydro = __toESM(require("hydrooj"), 1);

// plugins/hutoj-contest-client/src/core.ts
var import_node_crypto = require("node:crypto");
var import_node_net = require("node:net");

// plugins/hutoj-contest-client/src/heartbeat-watch.ts
var HEARTBEAT_SECONDS = 5;
var timeoutMs = 3 * HEARTBEAT_SECONDS * 1e3;
var HeartbeatWatch = class {
  static {
    __name(this, "HeartbeatWatch");
  }
  statuses;
  endTime;
  now;
  onDisconnect;
  constructor(statuses, endTime, now = () => /* @__PURE__ */ new Date()) {
    this.statuses = statuses;
    this.endTime = endTime;
    this.now = now;
  }
  async init() {
    await this.statuses.createIndex({ clientHeartbeatDue: 1 }, { sparse: true });
  }
  async enter(key2) {
    await this.statuses.updateOne(
      { ...key2, docType: 30, attend: 1, endAt: null, clientHeartbeatDue: { $exists: false } },
      { $set: { clientHeartbeatDue: new Date(+this.now() + timeoutMs) } }
    );
  }
  async beat(key2) {
    const now = this.now();
    await this.statuses.updateOne(
      { ...key2, docType: 30, endAt: null, clientHeartbeatDue: { $gt: now } },
      { $max: { clientHeartbeatDue: new Date(+now + timeoutMs) } }
    );
  }
  async disarm(filter) {
    await this.statuses.updateMany(
      { ...filter, docType: 30, clientHeartbeatDue: { $exists: true } },
      { $unset: { clientHeartbeatDue: "" } }
    );
  }
  async settle(row) {
    const due = row.clientHeartbeatDue;
    if (!due || due > this.now()) {
      return;
    }
    const match = {
      domainId: row.domainId,
      docId: row.docId,
      uid: row.uid,
      docType: 30,
      clientHeartbeatDue: due
    };
    const end = row.attend && !row.endAt ? await this.endTime(row) : null;
    if (!end || end <= due) {
      await this.statuses.updateOne(match, { $unset: { clientHeartbeatDue: "" } });
      return;
    }
    const result = await this.statuses.updateOne(
      { ...match, attend: 1, endAt: null },
      { $set: { endAt: due, clientOfflineAt: due }, $unset: { clientHeartbeatDue: "" } }
    );
    if (result.modifiedCount) {
      await this.onDisconnect?.(row);
    }
  }
  async sweep() {
    const overdue = this.statuses.find({ clientHeartbeatDue: { $lte: this.now() } });
    for await (const row of overdue) {
      await this.settle(row);
    }
  }
};

// plugins/hutoj-contest-client/src/core.ts
var PROTOCOL_VERSION = 1;
var LEASE_SECONDS = 90;
var DEFAULT_POLICY = Object.freeze({
  requireClient: false,
  clientOnly: false,
  restrictNetwork: true,
  blockBlacklistApps: true,
  blockUsbStorage: true,
  forceFullscreen: false,
  captureFps: 10,
  captureBitrateKbps: 2e3,
  whipUrlTemplate: "",
  mediaApiUrl: "",
  mediaPlaybackUrl: "",
  networkAllowHosts: [],
  networkAllowEndpoints: [],
  processBlackList: [
    "chrome.exe",
    "msedge.exe",
    "firefox.exe",
    "iexplore.exe",
    "qqbrowser.exe",
    "360se.exe",
    "360chrome.exe",
    "opera.exe",
    "brave.exe",
    "qq.exe",
    "wechat.exe",
    "weixin.exe",
    "telegram.exe",
    "discord.exe",
    "anydesk.exe",
    "todesk.exe",
    "sunloginclient.exe",
    "rustdesk.exe",
    "teamviewer.exe",
    "gameviewer.exe"
  ],
  keywordBlackList: [],
  keywordWhiteList: []
});
var ClientError = class extends Error {
  static {
    __name(this, "ClientError");
  }
  code;
  status;
  constructor(code, status = 403) {
    super(code);
    this.code = code;
    this.status = status;
  }
};
function fail(code, status) {
  throw new ClientError(code, status);
}
__name(fail, "fail");
var secret = /* @__PURE__ */ __name(() => (0, import_node_crypto.randomBytes)(32).toString("base64url"), "secret");
var hash = /* @__PURE__ */ __name((value) => (0, import_node_crypto.createHash)("sha256").update(value).digest("hex"), "hash");
function equalSecret(a, b) {
  return typeof a === "string" && typeof b === "string" && a.length > 0 && (0, import_node_crypto.timingSafeEqual)(Buffer.from(hash(a)), Buffer.from(hash(b)));
}
__name(equalSecret, "equalSecret");
var key = /* @__PURE__ */ __name((...values) => JSON.stringify(values.map(String)), "key");
function deviceMetadata(value) {
  if (value === void 0) {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some((key2) => !["system", "ip"].includes(key2))) {
    fail("INVALID_DEVICE_INFO", 400);
  }
  const { system, ip } = value;
  if (typeof system !== "string" || !system.trim() || system.length > 160 || /[\x00-\x1f\x7f]/.test(system)) {
    fail("INVALID_DEVICE_INFO", 400);
  }
  if (ip !== void 0 && (typeof ip !== "string" || ip.length > 64 || !(0, import_node_net.isIP)(ip))) {
    fail("INVALID_DEVICE_INFO", 400);
  }
  return { system: system.trim(), ...typeof ip === "string" ? { ip } : {} };
}
__name(deviceMetadata, "deviceMetadata");
function checkbox(name2, value, fallback = false) {
  if (value === void 0) return fallback;
  if (value === true || value === "true" || value === "on") return true;
  if (value === false || value === "false") return false;
  fail(`INVALID_${name2}`, 400);
}
__name(checkbox, "checkbox");
function clientAccess(allow, only) {
  const enabled = checkbox("requireClient", allow);
  const clientOnly = checkbox("clientOnly", only);
  return { requireClient: enabled || clientOnly, clientOnly };
}
__name(clientAccess, "clientAccess");
function validatePolicy(input) {
  const result = {
    ...DEFAULT_POLICY,
    ...clientAccess(input.requireClient, input.clientOnly),
    networkAllowHosts: []
  };
  for (const name2 of [
    "restrictNetwork",
    "blockBlacklistApps",
    "blockUsbStorage",
    "forceFullscreen"
  ]) {
    result[name2] = checkbox(name2, input[name2], DEFAULT_POLICY[name2]);
  }
  for (const [name2, min, max] of [
    ["captureFps", 1, 60],
    ["captureBitrateKbps", 128, 5e4]
  ]) {
    const value = input[name2] ?? DEFAULT_POLICY[name2];
    if (!["string", "number"].includes(typeof value) || !Number.isInteger(+value) || +value < min || +value > max) {
      fail(`INVALID_${name2}`, 400);
    }
    result[name2] = +value;
  }
  const template = input.whipUrlTemplate ?? "";
  if (typeof template !== "string" || template.length > 2048) {
    fail("INVALID_WHIP_URL", 400);
  }
  result.whipUrlTemplate = template.trim();
  if (result.whipUrlTemplate) {
    let url;
    try {
      url = new URL(
        result.whipUrlTemplate.replace(/\{(?:domainId|contestId|uid|sessionId)\}/g, "test")
      );
    } catch {
      fail("INVALID_WHIP_URL", 400);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || /[{}]/.test(
      result.whipUrlTemplate.replace(/\{(?:domainId|contestId|uid|sessionId)\}/g, "")
    )) {
      fail("INVALID_WHIP_URL", 400);
    }
  }
  const hosts = typeof input.networkAllowHosts === "string" ? input.networkAllowHosts.split(/[\s,]+/).filter(Boolean) : input.networkAllowHosts ?? [];
  if (!Array.isArray(hosts) || hosts.length > 64 || hosts.some(
    (host) => typeof host !== "string" || host.length > 253 || !/^[a-zA-Z0-9](?:[a-zA-Z0-9.-]*[a-zA-Z0-9])?$/.test(host)
  )) {
    fail("INVALID_ALLOW_HOSTS", 400);
  }
  result.networkAllowHosts = [...new Set(hosts.map((host) => host.toLowerCase()))];
  for (const name2 of [
    "networkAllowEndpoints",
    "processBlackList",
    "keywordBlackList",
    "keywordWhiteList"
  ]) {
    const value = input[name2] ?? DEFAULT_POLICY[name2];
    const list = typeof value === "string" ? value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean) : value;
    if (!Array.isArray(list) || list.length > 64 || list.some(
      (s) => typeof s !== "string" || s.length < 1 || s.length > 160 || /[\x00-\x1f]/.test(s)
    )) {
      fail(`INVALID_${name2}`, 400);
    }
    result[name2] = [...new Set(list)];
  }
  for (const endpoint of result.networkAllowEndpoints) {
    let url;
    try {
      url = new URL(endpoint);
    } catch {
      fail("INVALID_NETWORK_ENDPOINT", 400);
    }
    if (!["tcp:", "udp:"].includes(url.protocol) || !url.port || url.username || url.password || url.search || url.hash || !["", "/"].includes(url.pathname)) {
      fail("INVALID_NETWORK_ENDPOINT", 400);
    }
  }
  if (result.processBlackList.some((name2) => !/^[a-zA-Z0-9_. -]+$/.test(name2))) {
    fail("INVALID_PROCESS_NAME", 400);
  }
  for (const name2 of ["mediaApiUrl", "mediaPlaybackUrl"]) {
    const value = input[name2] ?? "";
    if (typeof value !== "string" || value.length > 2048) {
      fail(`INVALID_${name2}`, 400);
    }
    result[name2] = value.trim();
    if (!result[name2]) {
      continue;
    }
    let url;
    try {
      url = new URL(result[name2]);
    } catch {
      fail(`INVALID_${name2}`, 400);
    }
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.hash || url.search) {
      fail(`INVALID_${name2}`, 400);
    }
  }
  return result;
}
__name(validatePolicy, "validatePolicy");
function runtimeReport(input = {}) {
  return {
    networkControlled: input.networkControlled === true,
    screenCapturing: input.screenCapturing === true,
    processMonitored: input.processMonitored === true,
    usbStorageBlocked: input.usbStorageBlocked === true
  };
}
__name(runtimeReport, "runtimeReport");
var ClientService = class {
  static {
    __name(this, "ClientService");
  }
  watch;
  settings;
  sessions;
  contests;
  users;
  objectId;
  now;
  clientKey;
  mediaSettings = /* @__PURE__ */ __name(() => ({
    whipUrlTemplate: "",
    mediaApiUrl: "",
    mediaPlaybackUrl: ""
  }), "mediaSettings");
  constructor({
    settings,
    sessions,
    contests,
    users,
    objectId,
    now = /* @__PURE__ */ __name(() => /* @__PURE__ */ new Date(), "now"),
    clientKey = ""
  }) {
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
  parseTid(value) {
    if (!/^[a-f\d]{24}$/i.test(String(value))) {
      fail("INVALID_CONTEST_ID", 400);
    }
    return this.objectId(String(value));
  }
  async policy(domainId, tid) {
    const row = await this.settings.findOne({ _id: key(domainId, tid) });
    const {
      requireNetworkControl: _oldNetwork,
      requireScreenCapture: _oldScreen,
      captureWidth: _oldWidth,
      captureHeight: _oldHeight,
      ...current
    } = row || {};
    const media = this.mediaSettings();
    const version = Number.parseInt(
      hash(JSON.stringify([row?.version ?? 0, media])).slice(0, 13),
      16
    );
    return { ...DEFAULT_POLICY, ...current, ...media, version };
  }
  async savePolicy(domainId, tid, input, uid, fields = "all") {
    const policy = validatePolicy({
      ...input,
      whipUrlTemplate: "",
      mediaApiUrl: "",
      mediaPlaybackUrl: ""
    });
    if (policy.requireClient && this.clientKey.length < 32) {
      fail("CLIENT_KEY_NOT_CONFIGURED", 503);
    }
    const tdoc = await this.contests.get(domainId, this.parseTid(tid));
    if (tdoc.rule === "homework") {
      fail("HOMEWORK_NOT_SUPPORTED", 400);
    }
    const {
      requireClient,
      clientOnly,
      whipUrlTemplate,
      mediaApiUrl,
      mediaPlaybackUrl,
      ...settings
    } = policy;
    const access = { requireClient, clientOnly };
    let changes = { ...settings, ...access };
    let defaults = {};
    if (fields === "access") {
      changes = access;
      defaults = settings;
    } else if (fields === "settings") {
      changes = settings;
      defaults = access;
    }
    await this.settings.updateOne(
      { _id: key(domainId, tid) },
      {
        $set: { domainId, tid: String(tid), ...changes, updatedBy: uid, updatedAt: this.now() },
        ...fields === "all" ? {} : { $setOnInsert: defaults },
        $inc: { version: 1 },
        $unset: {
          requireNetworkControl: "",
          requireScreenCapture: "",
          captureWidth: "",
          captureHeight: "",
          whipUrlTemplate: "",
          mediaApiUrl: "",
          mediaPlaybackUrl: ""
        }
      },
      { upsert: true }
    );
    if (fields !== "settings" && !requireClient) {
      await this.watch?.disarm({ domainId, docId: this.parseTid(tid) });
    }
    return this.policy(domainId, tid);
  }
  async eligible(domainId, uid) {
    const configs = await this.settings.find({ domainId, requireClient: true }).toArray();
    if (!configs.length) {
      return [];
    }
    const exclusive = new Set(configs.filter((c) => c.clientOnly).map((c) => c.tid));
    const tids = configs.map((c) => this.parseTid(c.tid));
    const [tdocs, statuses] = await Promise.all([
      this.contests.getMulti(domainId, {
        docId: { $in: tids },
        endAt: { $gt: this.now() },
        rule: { $ne: "homework" }
      }).toArray(),
      this.contests.getMultiStatus(domainId, { uid, attend: 1, docId: { $in: tids } }).toArray()
    ]);
    const eligible = tdocs.flatMap((tdoc) => {
      const tsdoc = statuses.find((s) => String(s.docId) === String(tdoc.docId));
      if (!tsdoc || this.finished(tdoc, tsdoc)) return [];
      return [{ tdoc, tsdoc, clientOnly: exclusive.has(String(tdoc.docId)) }];
    });
    return eligible.sort(
      (a, b) => +a.tdoc.beginAt - +b.tdoc.beginAt || String(a.tdoc.docId).localeCompare(String(b.tdoc.docId))
    );
  }
  finished(tdoc, status) {
    return +tdoc.endAt <= +this.now() || !!(status.endAt && +status.endAt <= +this.now()) || !!(tdoc.duration && status.startAt && +status.startAt + Math.floor(tdoc.duration * 36e5) <= +this.now());
  }
  async select(domainId, uid, contestId) {
    let choices = await this.eligible(domainId, uid);
    if (contestId) {
      this.parseTid(contestId);
      const selected = choices.find((choice) => String(choice.tdoc.docId) === contestId);
      if (!selected) {
        fail("CONTEST_NOT_ELIGIBLE", 409);
      }
      return selected;
    }
    if (!choices.length) {
      fail("NO_CLIENT_CONTEST", 404);
    }
    const ongoing = choices.filter(({ tdoc }) => !this.contests.isNotStarted(tdoc));
    choices = ongoing.length ? ongoing : choices.filter(({ tdoc }) => +tdoc.beginAt === +choices[0].tdoc.beginAt);
    if (choices.length !== 1) {
      fail("MULTIPLE_CLIENT_CONTESTS", 409);
    }
    return choices[0];
  }
  async open(domainId, uid, suppliedKey, deviceId, contestId, metadata = {}) {
    if (this.clientKey.length < 32) {
      fail("CLIENT_KEY_NOT_CONFIGURED", 503);
    }
    if (!equalSecret(suppliedKey, this.clientKey)) {
      fail("INVALID_CLIENT_KEY");
    }
    if (typeof deviceId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(deviceId)) {
      fail("INVALID_DEVICE_ID", 400);
    }
    const deviceInfo = deviceMetadata(metadata.deviceInfo);
    const { tdoc } = await this.select(domainId, uid, contestId);
    const tid = String(tdoc.docId);
    const _id = key(domainId, tid, uid);
    const token = secret();
    const now = this.now();
    const row = {
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
      expiresAt: new Date(+now + LEASE_SECONDS * 1e3),
      purgeAt: new Date(Math.max(+tdoc.endAt, +now) + 7 * 864e5),
      readyAt: null,
      configVersion: -1,
      runtime: runtimeReport()
    };
    try {
      const acquired = await this.sessions.findOneAndUpdate(
        {
          _id,
          $or: [{ deviceId }, { expiresAt: { $lte: now } }]
        },
        { $set: row, $inc: { revision: 1 } },
        { upsert: true, returnDocument: "after" }
      );
      if (!acquired) {
        fail("CLIENT_SESSION_CHANGED", 409);
      }
      return { token, row: acquired };
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === 11e3) {
        fail("DEVICE_IN_USE", 409);
      }
      throw error;
    }
  }
  async authenticate(domainId, uid, token, allowExpired = false) {
    if (typeof token !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(token)) {
      fail("CLIENT_SESSION_REQUIRED");
    }
    const row = await this.sessions.findOne({
      domainId,
      uid,
      tokenHash: hash(token),
      ...allowExpired ? {} : { expiresAt: { $gt: this.now() } }
    });
    if (!row) {
      fail("CLIENT_SESSION_EXPIRED");
    }
    return row;
  }
  async state(row) {
    const tid = this.parseTid(row.tid);
    const [tdoc, initialStatus, policy] = await Promise.all([
      this.contests.get(row.domainId, tid),
      this.contests.getStatus(row.domainId, tid, row.uid),
      this.policy(row.domainId, row.tid)
    ]);
    let tsdoc = initialStatus;
    const deadline = tsdoc?.clientHeartbeatDue;
    if (this.watch && deadline && deadline <= this.now()) {
      await this.watch.settle(tsdoc);
      tsdoc = await this.contests.getStatus(row.domainId, tid, row.uid);
    }
    if (!tsdoc?.attend) {
      fail("CONTEST_MEMBERSHIP_REMOVED");
    }
    const ended = this.finished(tdoc, tsdoc);
    const ready = policy.requireClient && row.expiresAt > this.now() && !!row.readyAt && row.configVersion === policy.version && (!policy.restrictNetwork || row.runtime.networkControlled) && row.runtime.screenCapturing && (!policy.blockBlacklistApps || row.runtime.processMonitored) && (!policy.blockUsbStorage || row.runtime.usbStorageBlocked) && (!policy.blockBlacklistApps || !row.environmentWarning?.forced);
    return { tdoc, tsdoc, policy, ended, ready };
  }
  async snapshot(row) {
    const { tdoc, tsdoc, policy, ended, ready } = await this.state(row);
    const user = await this.users.getById(row.domainId, row.uid);
    if (!user) {
      fail("CLIENT_USER_MISSING");
    }
    const phase = !policy.requireClient ? "released" : ended ? "ended" : this.contests.isNotStarted(tdoc) ? "waiting" : ready ? "active" : "preparing";
    let endAt = tdoc.endAt;
    if (tsdoc.endAt && tsdoc.endAt < endAt) {
      endAt = tsdoc.endAt;
    }
    if (tdoc.duration && tsdoc.startAt) {
      endAt = new Date(Math.min(+endAt, +tsdoc.startAt + Math.floor(tdoc.duration * 36e5)));
    }
    const values = {
      domainId: row.domainId,
      contestId: row.tid,
      uid: String(row.uid),
      sessionId: row.sessionId
    };
    return {
      protocolVersion: PROTOCOL_VERSION,
      serverTime: this.now(),
      user: { id: row.uid, username: user.uname, displayName: user.displayName || "" },
      contest: {
        id: row.tid,
        title: tdoc.title,
        beginAt: tdoc.beginAt,
        endAt,
        startAt: tsdoc.startAt || null,
        scheduledEndAt: tdoc.endAt,
        durationHours: tdoc.duration || (+tdoc.endAt - +tdoc.beginAt) / 36e5,
        personalDurationHours: tdoc.duration || null
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
        heartbeatSeconds: HEARTBEAT_SECONDS
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
          whites: policy.keywordWhiteList
        },
        capture: { fps: policy.captureFps, bitrateKbps: policy.captureBitrateKbps },
        whipUrl: policy.whipUrlTemplate.replace(
          /\{(domainId|contestId|uid|sessionId)\}/g,
          (_, name2) => encodeURIComponent(values[name2])
        )
      }
    };
  }
  async heartbeat(row, input, markReady = false) {
    const { policy, ended } = await this.state(row);
    const report = runtimeReport(input);
    const deviceInfo = deviceMetadata(input.deviceInfo);
    const requirementsMet = (!policy.restrictNetwork || report.networkControlled) && report.screenCapturing && (!policy.blockBlacklistApps || report.processMonitored) && (!policy.blockUsbStorage || report.usbStorageBlocked);
    const events = input.processEvents ?? [];
    if (!Array.isArray(events) || events.length > 50) {
      fail("INVALID_PROCESS_EVENTS", 400);
    }
    const history = [...row.processEvents || []];
    for (const event of events) {
      if (!event || typeof event !== "object" || !/^[a-f0-9-]{36}$/.test(event.id) || !Number.isSafeInteger(event.pid) || event.pid < 1 || event.pid > 4294967295 || typeof event.name !== "string" || event.name.length > 160 || /[\\/\x00-\x1f]/.test(event.name) || typeof event.description !== "string" || event.description.length > 160 || typeof event.rule !== "string" || event.rule.length > 180 || !/^(process|keyword):/.test(event.rule)) {
        fail("INVALID_PROCESS_EVENTS", 400);
      }
      if (!history.some((old) => old.id === event.id)) {
        history.push({
          id: event.id,
          pid: event.pid,
          name: event.name,
          description: event.description,
          rule: event.rule,
          at: this.now()
        });
      }
    }
    if (markReady && (ended || !policy.requireClient)) {
      fail("CONTEST_NOT_ACTIVE", 409);
    }
    if (markReady && !requirementsMet) {
      fail("CLIENT_NOT_READY", 409);
    }
    if (markReady) {
      const user = await this.users.getById(row.domainId, row.uid);
      if (!user?.displayName?.trim()) {
        fail("DISPLAY_NAME_REQUIRED", 409);
      }
    }
    const now = this.now();
    let warning = row.environmentWarning || null;
    if (!policy.blockBlacklistApps) {
      warning = null;
    }
    let currentIssues = row.environmentIssues || [];
    let environmentEvents = row.environmentEvents || [];
    if (input.environmentIssues !== void 0) {
      const issues = policy.blockBlacklistApps ? input.environmentIssues : [];
      if (!Array.isArray(issues) || issues.length > 100 || issues.some(
        (issue) => !issue || typeof issue.key !== "string" || issue.key.length > 240 || typeof issue.name !== "string" || !issue.name || issue.name.length > 160 || /[\x00-\x1f]/.test(issue.name) || !["application", "model", "plugin"].includes(issue.kind)
      )) {
        fail("INVALID_ENVIRONMENT_ISSUES", 400);
      }
      const sameEpoch = input.warningEpoch === void 0 || input.warningEpoch === (row.warningEpoch || 0);
      if (row.enteredAt) {
        const oldKeys = new Set(currentIssues.map((issue) => issue.key));
        environmentEvents = [
          ...environmentEvents,
          ...issues.filter((issue) => issue.kind !== "application" && !oldKeys.has(issue.key)).map((issue) => ({ ...issue, at: now }))
        ].slice(-200);
      }
      currentIssues = issues;
      if (issues.length && row.enteredAt && sameEpoch) {
        warning = warning ? { ...warning, issues, forced: warning.forced || +now - +warning.since >= 6e4 } : { id: secret(), since: now, forced: false, issues };
        if (input.forceEnvironmentWarning === true) {
          warning.forced = true;
        }
      } else if (!warning?.forced && sameEpoch) {
        warning = null;
      }
    }
    const ready = requirementsMet && !ended && policy.requireClient && (markReady || !!row.readyAt && row.configVersion === policy.version);
    const updated = await this.sessions.findOneAndUpdate(
      {
        _id: row._id,
        tokenHash: row.tokenHash,
        revision: row.revision,
        expiresAt: { $gt: now }
      },
      {
        $set: {
          runtime: report,
          lastSeenAt: now,
          expiresAt: new Date(+now + LEASE_SECONDS * 1e3),
          readyAt: ready ? row.readyAt || now : null,
          configVersion: ready ? policy.version : -1,
          processEvents: history.slice(-200),
          environmentWarning: warning,
          environmentIssues: currentIssues,
          environmentEvents,
          ...deviceInfo ? { deviceInfo } : {}
        },
        $inc: { revision: 1 }
      },
      { returnDocument: "after" }
    );
    if (!updated) {
      fail("CLIENT_SESSION_CHANGED", 409);
    }
    return updated;
  }
  async requireSession(domainId, uid, token, tid, ready = true) {
    const row = await this.authenticate(domainId, uid, token);
    if (String(tid) !== row.tid) {
      fail("CLIENT_CONTEST_MISMATCH");
    }
    const state = await this.state(row);
    if (!state.policy.requireClient) fail("CONTEST_NOT_ELIGIBLE", 409);
    if (ready && !state.ended && !state.ready) {
      fail("CLIENT_NOT_READY", 409);
    }
    return row;
  }
  async resetReady(domainId, tid, uid) {
    await this.watch?.disarm({ domainId, docId: this.parseTid(tid), uid });
    await this.sessions.updateOne(
      { _id: key(domainId, tid, uid) },
      {
        $set: { readyAt: null, configVersion: -1 },
        $inc: { revision: 1 }
      }
    );
  }
  async clearWarning(domainId, tid, uid, warningId) {
    if (typeof warningId !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(warningId)) {
      fail("INVALID_WARNING_ID", 400);
    }
    const result = await this.sessions.updateOne(
      {
        _id: key(domainId, tid, uid),
        "environmentWarning.id": warningId,
        "environmentWarning.forced": true
      },
      { $set: { environmentWarning: null }, $inc: { revision: 1, warningEpoch: 1 } }
    );
    if (!result.matchedCount) {
      fail("WARNING_CHANGED", 409);
    }
  }
  async markEntered(row) {
    await this.sessions.updateOne(
      { _id: row._id, tokenHash: row.tokenHash, enteredAt: { $exists: false } },
      { $set: { enteredAt: this.now() } }
    );
  }
};

// plugins/hutoj-contest-client/src/monitor.ts
var import_promises = require("node:fs/promises");
var import_node_path = __toESM(require("node:path"), 1);
var import_node_stream = require("node:stream");

// plugins/hutoj-contest-client/src/recording-times.ts
function recordingStart(start, offsetSeconds) {
  const match = typeof start === "string" && start.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.(\d{1,9}))?(?:Z|[+-]\d{2}:\d{2})$/);
  const milliseconds = Date.parse(start);
  if (!match || !Number.isFinite(milliseconds) || !Number.isInteger(offsetSeconds) || offsetSeconds < 0) {
    throw new RangeError("Invalid recording timestamp");
  }
  if (offsetSeconds === 0) {
    return start;
  }
  const remainder = (match[1] || "").slice(3);
  return new Date(milliseconds + offsetSeconds * 1e3).toISOString().replace(/Z$/, `${remainder}Z`);
}
__name(recordingStart, "recordingStart");

// plugins/hutoj-contest-client/src/monitor.ts
var escape = /* @__PURE__ */ __name((text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "escape");
function recordingPattern(policy, domainId, tid) {
  if (!["{domainId}", "{contestId}", "{uid}", "{sessionId}"].every(
    (value) => policy.whipUrlTemplate.includes(value)
  )) {
    fail("MONITOR_TEMPLATE_REQUIRED", 400);
  }
  const shape = new URL(
    policy.whipUrlTemplate.replaceAll("{domainId}", "CLIENT_DOMAIN").replaceAll("{contestId}", "CLIENT_CONTEST").replaceAll("{uid}", "CLIENT_UID").replaceAll("{sessionId}", "CLIENT_SESSION")
  ).pathname;
  if (!["CLIENT_DOMAIN", "CLIENT_CONTEST", "CLIENT_UID", "CLIENT_SESSION"].every(
    (value) => shape.includes(value)
  )) {
    fail("MONITOR_TEMPLATE_REQUIRED", 400);
  }
  const target = new URL(
    policy.whipUrlTemplate.replaceAll("{domainId}", encodeURIComponent(domainId)).replaceAll("{contestId}", tid).replaceAll("{uid}", "CLIENT_UID").replaceAll("{sessionId}", "CLIENT_SESSION")
  );
  if (!target.pathname.endsWith("/whip")) {
    fail("MONITOR_WHIP_PATH_REQUIRED", 400);
  }
  return new RegExp(
    `^${escape(target.pathname.slice(1, -5)).replace("CLIENT_UID", "(?<uid>[1-9][0-9]*)").replace("CLIENT_SESSION", "[A-Za-z0-9_-]+")}$`
  );
}
__name(recordingPattern, "recordingPattern");
function registerMonitor(ctx, H, service) {
  const viewers = /* @__PURE__ */ new Map();
  const removeViewer = /* @__PURE__ */ __name(async (id) => {
    const viewer = viewers.get(id);
    if (!viewer) {
      return;
    }
    clearTimeout(viewer.timer);
    viewers.delete(id);
    await fetch(viewer.resource, {
      method: "DELETE",
      redirect: "error",
      signal: AbortSignal.timeout(5e3)
    }).catch(() => {
    });
  }, "removeViewer");
  const renew = /* @__PURE__ */ __name((id, viewer) => {
    clearTimeout(viewer.timer);
    viewer.timer = setTimeout(() => void removeViewer(id), 6e4);
    viewer.timer.unref();
  }, "renew");
  ctx.effect(() => () => {
    for (const id of viewers.keys()) {
      void removeViewer(id);
    }
  });
  const json2 = /* @__PURE__ */ __name((h, data) => {
    h.response.type = "application/json";
    h.response.body = data;
  }, "json");
  const getJson = /* @__PURE__ */ __name(async (url) => {
    try {
      const response = await fetch(url, {
        redirect: "error",
        signal: AbortSignal.timeout(15e3)
      });
      if (!response.ok) {
        fail("MEDIA_SERVICE_UNAVAILABLE", 502);
      }
      return await response.json();
    } catch {
      fail("MEDIA_SERVICE_UNAVAILABLE", 502);
    }
  }, "getJson");
  class MonitorBase extends H.Handler {
    static {
      __name(this, "MonitorBase");
    }
    tdoc;
    policy;
    async prepare() {
      this.checkPriv(H.PRIV.PRIV_USER_PROFILE);
      this.tdoc = await H.ContestModel.get(this.domain._id, service.parseTid(this.args.tid));
      if (!this.user.hasPerm(H.PERM.PERM_EDIT_CONTEST) && !(this.user.own(this.tdoc) && this.user.hasPerm(H.PERM.PERM_EDIT_CONTEST_SELF))) {
        fail("CONTEST_MANAGEMENT_REQUIRED");
      }
      this.policy = await service.policy(this.domain._id, this.tdoc.docId);
      this.response.addHeader("Cache-Control", "no-store");
    }
    streamPattern() {
      return recordingPattern(this.policy, this.domain._id, String(this.tdoc.docId));
    }
  }
  class HutojClientMonitorHandler extends MonitorBase {
    static {
      __name(this, "HutojClientMonitorHandler");
    }
    async get() {
      this.session.hutojClientCsrf ||= secret();
      if (this.request.query.events !== void 0) {
        const uid = Number(this.request.query.events);
        if (!Number.isSafeInteger(uid) || uid < 1) {
          fail("INVALID_UID", 400);
        }
        const row = await service.sessions.findOne(
          { domainId: this.domain._id, tid: String(this.tdoc.docId), uid },
          { projection: { processEvents: 1, environmentWarning: 1, environmentEvents: 1 } }
        );
        json2(this, {
          events: [...row?.processEvents || []].reverse(),
          environmentEvents: [...row?.environmentEvents || []].reverse(),
          environmentWarning: row?.environmentWarning || null
        });
        return;
      }
      if (this.request.query.recordings !== void 0) {
        const uid = Number(this.request.query.recordings);
        if (!Number.isSafeInteger(uid) || uid < 1) {
          fail("INVALID_UID", 400);
        }
        if (!this.policy.mediaApiUrl || !this.policy.mediaPlaybackUrl) {
          fail("PLAYBACK_NOT_CONFIGURED", 409);
        }
        const pattern = this.streamPattern();
        const recordings = [];
        for (let page = 0; page < 100; page++) {
          const url = new URL(
            `${this.policy.mediaApiUrl.replace(/\/$/, "")}/v3/recordings/list`
          );
          url.searchParams.set("page", String(page));
          url.searchParams.set("itemsPerPage", "1000");
          const data2 = await getJson(url);
          for (const item of data2.items || []) {
            if (Number(pattern.exec(item.name)?.groups?.uid) !== uid) {
              continue;
            }
            for (const segment of item.segments || []) {
              if (!Number.isFinite(segment.duration) || segment.duration <= 0 || !Number.isFinite(Date.parse(segment.start))) {
                continue;
              }
              for (let offset = 0; offset < Math.min(segment.duration, 86400); offset += 300) {
                const start = recordingStart(segment.start, offset);
                const duration = Math.min(segment.duration - offset, 300);
                const query = new URLSearchParams({
                  path: item.name,
                  start,
                  duration: String(duration)
                });
                recordings.push({
                  path: item.name,
                  start,
                  duration,
                  url: `${this.url("hutoj_client_recording", { tid: this.tdoc.docId })}?${query}`
                });
              }
            }
          }
          if (page + 1 >= data2.pageCount) {
            break;
          }
        }
        recordings.sort((a, b) => Date.parse(b.start) - Date.parse(a.start));
        json2(this, { recordings });
        return;
      }
      const rows = await service.sessions.find({ domainId: this.domain._id, tid: String(this.tdoc.docId) }).sort({ uid: 1 }).toArray();
      const attendees = await H.ContestModel.getMultiStatus(this.domain._id, {
        docId: this.tdoc.docId,
        attend: 1
      }).toArray();
      const ids = [
        .../* @__PURE__ */ new Set([...attendees.map((status) => status.uid), ...rows.map((row) => row.uid)])
      ].sort((a, b) => a - b);
      const users = await H.UserModel.getList(this.domain._id, ids);
      const sessions = new Map(rows.map((row) => [row.uid, row]));
      const offline = new Map(
        attendees.map((status) => [
          status.uid,
          status.clientOfflineAt
        ])
      );
      const ended = new Map(
        attendees.filter((status) => status.endAt && status.endAt <= /* @__PURE__ */ new Date()).map((status) => [status.uid, status.endAt])
      );
      const clients = ids.map((uid) => ({
        uid,
        name: users[uid]?.displayName || users[uid]?.uname || String(uid),
        offlineAt: offline.get(uid) || null,
        endAt: ended.get(uid) || null,
        online: !ended.has(uid) && !!sessions.get(uid) && +sessions.get(uid).expiresAt > Date.now() && sessions.get(uid).runtime.screenCapturing,
        lastSeenAt: sessions.get(uid)?.lastSeenAt || null,
        deviceInfo: {
          system: sessions.get(uid)?.deviceInfo?.system || "",
          ip: sessions.get(uid)?.deviceInfo?.ip || ""
        },
        processMonitored: sessions.get(uid)?.runtime.processMonitored === true,
        environmentWarning: sessions.get(uid)?.environmentWarning || null,
        violations: (sessions.get(uid)?.processEvents?.length || 0) + (sessions.get(uid)?.environmentEvents?.length || 0)
      }));
      const data = {
        tdoc: this.tdoc,
        clients,
        csrf: this.session.hutojClientCsrf,
        openedAt: Date.now(),
        playbackConfigured: !!this.policy.mediaApiUrl && !!this.policy.mediaPlaybackUrl
      };
      if (this.request.json) {
        json2(this, data);
      } else {
        this.response.template = "hutoj_client_monitor.html";
        this.response.body = data;
      }
    }
    async post() {
      const origin = this.request.headers.origin;
      if (origin && new URL(String(origin)).host !== this.request.host) {
        fail("INVALID_ORIGIN");
      }
      if (!equalSecret(this.request.body.csrf, this.session.hutojClientCsrf)) {
        fail("INVALID_CSRF");
      }
      const { action: operation, id } = this.request.body;
      if (operation === "clear-warning") {
        const uid2 = Number(this.request.body.uid);
        if (!Number.isSafeInteger(uid2) || uid2 < 1) {
          fail("INVALID_UID", 400);
        }
        await service.clearWarning(
          this.domain._id,
          this.tdoc.docId,
          uid2,
          this.request.body.warningId
        );
        json2(this, {});
        return;
      }
      if (operation === "stop" || operation === "keepalive") {
        const viewer2 = viewers.get(String(id));
        if (!viewer2 || viewer2.uid !== this.user._id || viewer2.domainId !== this.domain._id || viewer2.tid !== String(this.tdoc.docId)) {
          fail("VIEWER_NOT_FOUND", 404);
        }
        if (operation === "stop") {
          await removeViewer(id);
        } else {
          renew(id, viewer2);
        }
        json2(this, {});
        return;
      }
      if (operation !== "watch") {
        fail("INVALID_MONITOR_OPERATION", 400);
      }
      await this.limitRate("hutoj_monitor_watch", 60, 30);
      const uid = Number(this.request.body.uid);
      const sdp = this.request.body.sdp;
      if (!Number.isSafeInteger(uid) || uid < 1 || typeof sdp !== "string" || !sdp.startsWith("v=0") || sdp.length > 128 * 1024) {
        fail("INVALID_VIEWER", 400);
      }
      const row = await service.sessions.findOne({
        domainId: this.domain._id,
        tid: String(this.tdoc.docId),
        uid
      });
      if (!row || +row.expiresAt <= Date.now() || !row.runtime.screenCapturing) {
        fail("SCREEN_OFFLINE", 409);
      }
      this.streamPattern();
      const state = await service.snapshot(row);
      const target = new URL(state.policy.whipUrl);
      target.pathname = target.pathname.replace(/\/whip$/, "/whep");
      for (const [key2, viewer2] of viewers) {
        if (viewer2.uid === this.user._id && viewer2.tid === String(this.tdoc.docId) && viewer2.domainId === this.domain._id) {
          await removeViewer(key2);
        }
      }
      let response;
      try {
        response = await fetch(target, {
          method: "POST",
          redirect: "error",
          headers: { "Content-Type": "application/sdp" },
          body: sdp,
          signal: AbortSignal.timeout(15e3)
        });
      } catch {
        fail("MEDIA_SERVICE_UNAVAILABLE", 502);
      }
      if (response.status !== 201 || !response.headers.get("location")) {
        fail("SCREEN_OFFLINE", 409);
      }
      const resource = new URL(response.headers.get("location"), target);
      if (resource.origin !== target.origin || !resource.pathname.startsWith(`${target.pathname}/`)) {
        fail("INVALID_MEDIA_RESOURCE", 502);
      }
      const viewerId = secret();
      const viewer = {
        resource,
        domainId: this.domain._id,
        tid: String(this.tdoc.docId),
        uid: this.user._id,
        timer: null
      };
      viewers.set(viewerId, viewer);
      renew(viewerId, viewer);
      json2(this, { id: viewerId, sdp: await response.text() });
    }
  }
  class HutojClientMonitorScriptHandler extends MonitorBase {
    static {
      __name(this, "HutojClientMonitorScriptHandler");
    }
    async get() {
      this.response.type = "application/javascript";
      this.response.body = await (0, import_promises.readFile)(import_node_path.default.join(__dirname, "web/monitor.js"), "utf8");
    }
  }
  class HutojClientRecordingHandler extends MonitorBase {
    static {
      __name(this, "HutojClientRecordingHandler");
    }
    async get() {
      if (!this.policy.mediaPlaybackUrl) {
        fail("PLAYBACK_NOT_CONFIGURED", 409);
      }
      const { path: stream, start, duration } = this.request.query;
      if (typeof stream !== "string" || !this.streamPattern().test(stream) || typeof start !== "string" || !Number.isFinite(Date.parse(start)) || !Number.isFinite(Number(duration)) || Number(duration) <= 0 || Number(duration) > 300) {
        fail("INVALID_RECORDING", 400);
      }
      const target = new URL(`${this.policy.mediaPlaybackUrl.replace(/\/$/, "")}/get`);
      target.search = new URLSearchParams({
        path: stream,
        start,
        duration: String(duration),
        format: "mp4"
      }).toString();
      const range = this.request.headers.range;
      const response = await fetch(target, {
        redirect: "error",
        signal: AbortSignal.timeout(12e4),
        headers: typeof range === "string" ? { Range: range } : {}
      });
      if (!response.ok || !response.body) {
        fail("RECORDING_UNAVAILABLE", 404);
      }
      this.response.status = response.status;
      this.response.type = "video/mp4";
      for (const header of ["Content-Length", "Content-Range", "Accept-Ranges"]) {
        if (response.headers.get(header)) {
          this.response.addHeader(header, response.headers.get(header));
        }
      }
      this.response.body = import_node_stream.Readable.fromWeb(
        response.body
      );
    }
  }
  const ProtocolError = H.CreateError("HutojClientMonitorError", H.UserFacingError, "{0}", 403);
  for (const Class of [
    MonitorBase,
    HutojClientMonitorHandler,
    HutojClientMonitorScriptHandler,
    HutojClientRecordingHandler
  ]) {
    const prototype = Class.prototype;
    for (const method of ["prepare", "get", "post"]) {
      if (!Object.hasOwn(prototype, method)) {
        continue;
      }
      const original = prototype[method];
      prototype[method] = async function(...args) {
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
    "hutoj_client_monitor",
    "/contest/:tid/client/monitor",
    HutojClientMonitorHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_monitor_script",
    "/contest/:tid/client/monitor/script.js",
    HutojClientMonitorScriptHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_recording",
    "/contest/:tid/client/monitor/recording",
    HutojClientRecordingHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
}
__name(registerMonitor, "registerMonitor");

// plugins/hutoj-contest-client/src/oauth.ts
var import_node_crypto2 = require("node:crypto");
var CLIENT_ID = "hutoj-contest-client";
var CLIENT_SCOPE = "contest:client";
var CLIENT_REDIRECT = "hutoj-client://oauth/callback";
var digest = /* @__PURE__ */ __name((value) => (0, import_node_crypto2.createHash)("sha256").update(value).digest("hex"), "digest");
var challenge = /* @__PURE__ */ __name((value) => (0, import_node_crypto2.createHash)("sha256").update(value).digest("base64url"), "challenge");
var ClientOAuth = class {
  static {
    __name(this, "ClientOAuth");
  }
  now;
  ports;
  constructor(ports) {
    this.ports = ports;
    this.now = ports.now || (() => /* @__PURE__ */ new Date());
  }
  async init() {
    await this.ports.grants.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  checkKey(key2) {
    if (this.ports.clientKey.length < 32 || !equalSecret(key2, this.ports.clientKey)) {
      fail("INVALID_CLIENT_KEY");
    }
  }
  async choices(domain, uid, allDomains = false) {
    const choices = allDomains && this.ports.eligibleAll ? await this.ports.eligibleAll(uid) : this.ports.eligible ? await this.ports.eligible(domain, uid) : [await this.ports.select(domain, uid)];
    if (!choices.length) {
      fail("NO_CLIENT_CONTEST", 404);
    }
    return choices;
  }
  list(grant) {
    return this.choices(
      grant.domainId,
      grant.uid,
      grant.allDomains === true && grant.selectionRequired === true
    );
  }
  request(input) {
    if (input.client_id !== CLIENT_ID || input.redirect_uri !== CLIENT_REDIRECT || typeof input.deviceId !== "string" || !/^[a-zA-Z0-9_-]{16,128}$/.test(input.deviceId)) {
      fail("INVALID_OAUTH_REQUEST", 400);
    }
  }
  async authorize(domainId, input, key2) {
    this.checkKey(key2);
    this.request(input);
    const studentId = typeof input.studentId === "string" ? input.studentId.trim() : "";
    const realName = typeof input.name === "string" ? input.name.trim().normalize("NFC") : "";
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(studentId) || !realName || realName.length > 80 || /[\x00-\x1f\x7f]/.test(realName)) {
      fail("REALNAME_LOGIN_FAILED");
    }
    if (input.response_type !== "code" || input.scope !== CLIENT_SCOPE || input.code_challenge_method !== "S256" || typeof input.code_challenge !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input.code_challenge) || typeof input.state !== "string" || !/^[a-zA-Z0-9_-]{32,128}$/.test(input.state)) {
      fail("INVALID_OAUTH_REQUEST", 400);
    }
    const matches = await this.ports.identities.find({ studentId }).limit(2).toArray();
    const identity = matches[0];
    if (matches.length !== 1 || identity.realName !== realName || !identity.verifiedAt || !await this.ports.validUser(domainId, identity.uid)) {
      fail("REALNAME_LOGIN_FAILED");
    }
    if (input.contest_scope !== void 0 && input.contest_scope !== "all-domains") {
      fail("INVALID_OAUTH_REQUEST", 400);
    }
    const allDomains = input.contest_scope === "all-domains" && !!this.ports.eligibleAll;
    const [{ tdoc }] = await this.choices(domainId, identity.uid, allDomains);
    const code = secret();
    await this.ports.grants.insertOne({
      _id: digest(code),
      kind: "code",
      domainId,
      uid: identity.uid,
      tid: String(tdoc.docId),
      selectionRequired: true,
      allDomains,
      deviceId: input.deviceId,
      realName: identity.realName,
      verifiedAt: identity.verifiedAt,
      expiresAt: /* @__PURE__ */ new Date(+this.now() + 6e4),
      challenge: input.code_challenge
    });
    return { code, state: input.state };
  }
  async exchange(domainId, input, key2) {
    this.checkKey(key2);
    this.request(input);
    if (input.grant_type !== "authorization_code" || typeof input.code !== "string" || !/^[a-zA-Z0-9_-]{43}$/.test(input.code) || typeof input.code_verifier !== "string" || !/^[a-zA-Z0-9._~-]{43,128}$/.test(input.code_verifier)) {
      fail("INVALID_OAUTH_GRANT");
    }
    const grant = await this.ports.grants.findOneAndDelete({
      _id: digest(input.code),
      kind: "code",
      domainId,
      deviceId: input.deviceId,
      challenge: challenge(input.code_verifier),
      expiresAt: { $gt: this.now() }
    });
    if (!grant) {
      fail("INVALID_OAUTH_GRANT");
    }
    await this.identity(grant);
    await this.choices(domainId, grant.uid, grant.allDomains);
    if (!grant.allDomains) {
      await this.ports.setName(domainId, grant.uid, grant.realName);
    }
    const access = `hcc_${secret()}`;
    await this.ports.grants.insertOne({
      ...grant,
      _id: digest(access),
      kind: "access",
      challenge: void 0,
      expiresAt: new Date(+this.now() + 24 * 36e5)
    });
    return {
      access_token: access,
      token_type: "Bearer",
      expires_in: 24 * 3600,
      scope: CLIENT_SCOPE
    };
  }
  async identity(grant) {
    const identity = await this.ports.identities.findOne({
      uid: grant.uid,
      realName: grant.realName,
      verifiedAt: grant.verifiedAt
    });
    if (!identity || !await this.ports.validUser(grant.domainId, grant.uid)) {
      fail("OAUTH_ACCESS_EXPIRED");
    }
  }
  async authenticate(access, domainId, deviceId, selectionOrigin = false) {
    if (!/^hcc_[a-zA-Z0-9_-]{43}$/.test(access)) {
      fail("OAUTH_ACCESS_EXPIRED");
    }
    const grant = await this.ports.grants.findOne({
      _id: digest(access),
      kind: "access",
      ...selectionOrigin ? { $or: [{ domainId }, { discoveryDomainId: domainId }] } : { domainId },
      expiresAt: { $gt: this.now() }
    });
    if (!grant || grant.deviceId !== deviceId) {
      fail("OAUTH_ACCESS_EXPIRED");
    }
    await this.identity(grant);
    return grant;
  }
  async selectContest(grant, contestId, domainId) {
    if (typeof contestId !== "string" || !/^[a-f\d]{24}$/i.test(contestId)) {
      fail("INVALID_CONTEST_ID", 400);
    }
    if (domainId !== void 0 && (typeof domainId !== "string" || !domainId)) {
      fail("INVALID_CONTEST_DOMAIN", 400);
    }
    const choices = (await this.choices(grant.domainId, grant.uid, grant.allDomains)).filter(
      (choice) => String(choice.tdoc.docId) === contestId && (domainId === void 0 || (choice.tdoc.domainId || grant.domainId) === domainId)
    );
    if (!choices.length) {
      fail("CONTEST_NOT_ELIGIBLE", 409);
    }
    if (choices.length !== 1) {
      fail("CONTEST_SELECTION_AMBIGUOUS", 400);
    }
    const target = choices[0].tdoc.domainId || grant.domainId;
    const updated = await this.ports.grants.findOneAndUpdate(
      {
        _id: grant._id,
        kind: "access",
        selectionRequired: true,
        expiresAt: { $gt: this.now() }
      },
      {
        $set: {
          tid: contestId,
          domainId: target,
          discoveryDomainId: grant.domainId,
          selectionRequired: false
        }
      },
      { returnDocument: "after" }
    );
    if (updated) {
      if (grant.allDomains) {
        await this.ports.setName(target, grant.uid, grant.realName);
      }
      return updated;
    }
    const current = await this.ports.grants.findOne({
      _id: grant._id,
      kind: "access",
      expiresAt: { $gt: this.now() }
    });
    if (current && current.selectionRequired !== true && current.tid === contestId && current.domainId === target) {
      if (grant.allDomains) {
        await this.ports.setName(target, grant.uid, grant.realName);
      }
      return current;
    }
    fail("CLIENT_CONTEST_LOCKED", 409);
  }
};

// plugins/hutoj-contest-client/src/oauth-plugin.ts
async function registerClientOAuth(ctx, H, service) {
  const oauth = new ClientOAuth({
    grants: H.db.collection("hutoj.client.oauth"),
    identities: H.db.collection("realname_superhut"),
    clientKey: service.clientKey,
    select: /* @__PURE__ */ __name((domain, uid) => service.select(domain, uid), "select"),
    eligible: /* @__PURE__ */ __name((domain, uid) => service.eligible(domain, uid), "eligible"),
    eligibleAll: /* @__PURE__ */ __name(async (uid) => {
      const domains = await service.settings.distinct("domainId", { requireClient: true });
      const choices = [];
      for (const domain of domains) {
        if (!await H.DomainModel.get(domain)) {
          continue;
        }
        const user = await H.UserModel.getById(domain, uid);
        if (!user?.hasPriv(H.PRIV.PRIV_USER_PROFILE) || !user.hasPerm(H.PERM.PERM_VIEW | H.PERM.PERM_VIEW_CONTEST)) {
          continue;
        }
        if (typeof user.contestMode === "string" && !["system", user.contestMode].includes(domain)) {
          continue;
        }
        const enrolled = await service.eligible(domain, uid);
        const groups = enrolled.some(
          ({ tdoc }) => tdoc.assign?.length && !user.own(tdoc) && !user.hasPerm(H.PERM.PERM_VIEW_HIDDEN_CONTEST)
        ) ? new Set((await H.UserModel.listGroup(domain, uid)).map((group) => group.name)) : /* @__PURE__ */ new Set();
        choices.push(
          ...enrolled.filter(
            ({ tdoc }) => !tdoc.assign?.length || user.own(tdoc) || user.hasPerm(H.PERM.PERM_VIEW_HIDDEN_CONTEST) || tdoc.assign.some((group) => groups.has(group))
          )
        );
      }
      return choices.sort(
        (a, b) => +a.tdoc.beginAt - +b.tdoc.beginAt || a.tdoc.domainId.localeCompare(b.tdoc.domainId) || String(a.tdoc.docId).localeCompare(String(b.tdoc.docId))
      );
    }, "eligibleAll"),
    validUser: /* @__PURE__ */ __name(async (domain, uid) => !!(await H.UserModel.getById(domain, uid))?.hasPriv(H.PRIV.PRIV_USER_PROFILE), "validUser"),
    setName: /* @__PURE__ */ __name((domain, uid, name2) => H.DomainModel.setUserInDomain(domain, uid, { displayName: name2 }), "setName")
  });
  await oauth.init();
  const ProtocolError = H.CreateError("HutojClientError", H.UserFacingError, "{0}", 403);
  class ClientAuthorizationHandler extends H.Handler {
    static {
      __name(this, "ClientAuthorizationHandler");
    }
    noCheckPermView = true;
    async post() {
      try {
        const origin = this.request.headers.origin;
        if (origin && new URL(String(origin)).host !== this.request.host) {
          fail("INVALID_ORIGIN");
        }
        const input = this.request.body;
        oauth.checkKey(this.request.headers["x-hutoj-client-key"]);
        await this.limitRate("hutoj_client_identity_ip", 60, 20);
        if (this.request.path.endsWith("/authorize")) {
          await this.limitRate(
            "hutoj_client_identity_id",
            60,
            5,
            digest(String(input.studentId || ""))
          );
        }
        const result = this.request.path.endsWith("/authorize") ? await oauth.authorize(
          this.domain._id,
          input,
          this.request.headers["x-hutoj-client-key"]
        ) : await oauth.exchange(
          this.domain._id,
          input,
          this.request.headers["x-hutoj-client-key"]
        );
        this.response.type = "application/json";
        this.response.addHeader("Cache-Control", "no-store");
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
    "hutoj_client_authorize",
    "/contest-client/oauth/authorize",
    ClientAuthorizationHandler
  );
  ctx.Route("hutoj_client_token", "/contest-client/oauth/token", ClientAuthorizationHandler);
  ctx.on("handler/create", (h) => {
    const code = h.context?.HydroContext?.hutojClientOAuthError;
    if (code) {
      throw new ProtocolError(code);
    }
  });
  const competitorScope = [
    "PERM_VIEW",
    "PERM_VIEW_PROBLEM",
    "PERM_SUBMIT_PROBLEM",
    "PERM_VIEW_RECORD",
    "PERM_READ_RECORD_CODE",
    "PERM_VIEW_CONTEST",
    "PERM_ATTEND_CONTEST",
    "PERM_VIEW_CONTEST_SCOREBOARD"
  ].reduce((scope, name2) => scope | (H.PERM[name2] || 0n), 0n);
  ctx.server.addLayer("hutoj-client-oauth", async (c, next) => {
    const header = c.request.headers.authorization;
    if (typeof header !== "string" || !header.startsWith("Bearer hcc_")) {
      return next();
    }
    try {
      const domain = c.HydroContext.domain._id;
      const path5 = c.request.path;
      const method = c.request.method.toLowerCase();
      const selecting = path5 === "/contest-client/select" && method === "post";
      const grant = await oauth.authenticate(
        header.slice(7),
        domain,
        c.request.headers["x-hutoj-client-device"],
        selecting
      );
      if (c.HydroContext.request.websocket || c.HydroContext.args.domainId !== domain || c.request.headers["x-hydro-inject"]) {
        fail("OAUTH_SCOPE_DENIED");
      }
      const body = c.request.body || {};
      const query = c.query;
      const keys = /* @__PURE__ */ __name((...allowed2) => Object.keys(query).every((key2) => allowed2.includes(key2)), "keys");
      const fields = /* @__PURE__ */ __name((...allowed2) => Object.keys(body).every((key2) => allowed2.includes(key2)), "fields");
      const tid = grant.tid;
      const choosing = grant.selectionRequired === true;
      const tdoc = choosing || grant.domainId !== domain ? null : await H.ContestModel.get(domain, service.parseTid(tid));
      if (tdoc) {
        const status = await H.ContestModel.getStatus(domain, tdoc.docId, grant.uid);
        if (!status?.attend) {
          fail("OAUTH_SCOPE_DENIED");
        }
      }
      if (choosing && path5 !== "/contest-client" && path5 !== "/contest-client/select") {
        fail("CLIENT_CONTEST_SELECTION_REQUIRED", 409);
      }
      let allowed = false;
      let image = false;
      if (path5 === "/contest-client") {
        allowed = method === "get" && keys();
      }
      if (path5 === "/contest-client/select") {
        allowed = method === "post" && keys() && fields("contestId", "contestDomain");
      }
      if (path5 === "/contest-client/session") {
        allowed = keys() && (method === "get" || method === "post" && fields("deviceId", "deviceInfo") && body.deviceId === grant.deviceId);
      }
      if (path5 === "/contest-client/heartbeat" || path5 === "/contest-client/ready") {
        allowed = method === "post" && keys() && fields(
          "networkControlled",
          "screenCapturing",
          "processMonitored",
          "usbStorageBlocked",
          "processEvents",
          "environmentIssues",
          "warningEpoch",
          "forceEnvironmentWarning",
          "deviceInfo"
        );
      }
      if (path5 === "/contest-client/session" && method === "post") {
        await service.select(domain, grant.uid, tid);
      }
      if (path5 === `/contest/${tid}/problems`) {
        allowed = keys() && (method === "get" || method === "post" && body.operation === "clarification" && fields("operation", "subject", "content"));
      }
      if (path5 === `/contest/${tid}/scoreboard`) {
        allowed = method === "get" && keys();
      }
      if (path5 === `/contest/${tid}`) {
        allowed = method === "post" && keys() && body.operation === "early_end" && fields("operation");
      }
      const problem = /^\/p\/([^/]+)(\/submit|\/file\/[^/]+)?$/.exec(path5);
      if (problem && tdoc && String(query.tid) === tid && tdoc.pids.some((pid) => String(pid) === problem[1])) {
        image = !!problem[2]?.startsWith("/file/");
        allowed = image ? method === "get" && keys("tid") : problem[2] === "/submit" ? keys("tid") && (method === "get" || method === "post" && fields("lang", "code", "pretest", "input")) : method === "get" && keys("tid", "lang");
      }
      if (path5 === "/record") {
        allowed = method === "get" && keys("tid", "uidOrName", "page") && String(query.tid) === tid && String(query.uidOrName) === String(grant.uid);
      }
      const record = /^\/record\/([a-f\d]{24})$/i.exec(path5);
      if (record && method === "get" && keys("tid") && String(query.tid) === tid) {
        const row = await H.RecordModel.get(domain, service.parseTid(record[1]));
        allowed = !!row && row.uid === grant.uid && (String(row.contest) === tid || String(row.contest) === "000000000000000000000000" && !!tdoc?.pids.includes(row.pid));
      }
      if (!allowed || !image && !String(c.request.headers.accept || "").includes("application/json")) {
        fail("OAUTH_SCOPE_DENIED");
      }
      if (!path5.startsWith("/contest-client")) {
        const row = await service.authenticate(
          domain,
          grant.uid,
          c.request.headers["x-hutoj-client-session"]
        );
        if (row.tid !== grant.tid || row.deviceId !== grant.deviceId) {
          fail("OAUTH_SCOPE_DENIED");
        }
      }
      const origin = c.request.headers.origin;
      if (origin && new URL(String(origin)).host !== c.request.host) {
        fail("INVALID_ORIGIN");
      }
      const user = await (await H.UserModel.getById(domain, grant.uid)).private();
      user.scope = competitorScope;
      user.priv = H.PRIV.PRIV_USER_PROFILE;
      user.role = "default";
      user.own = () => false;
      c.HydroContext.user = user;
      c.HydroContext.hutojClientGrant = grant;
    } catch (error) {
      if (!(error instanceof ClientError)) {
        throw error;
      }
      c.HydroContext.hutojClientOAuthError = error.code;
    }
    await next();
  });
  return oauth;
}
__name(registerClientOAuth, "registerClientOAuth");

// plugins/hutoj-contest-client/src/avatar-images.ts
var cache = /* @__PURE__ */ new Map();
async function inlineAvatars(html, origin, gravatar, fallback, download = fetch) {
  const base = new URL(origin);
  const hosts = /* @__PURE__ */ new Set([
    "q1.qlogo.cn",
    "q2.qlogo.cn",
    "github.com",
    "avatars.githubusercontent.com",
    "www.gravatar.com",
    "secure.gravatar.com"
  ]);
  try {
    if (/^(?:https?:)?\/\//.test(gravatar)) {
      hosts.add(new URL(gravatar, base).hostname);
    }
  } catch {
  }
  const tags = [...html.matchAll(/<img\b[^>]*>/gi)].filter(
    ([tag]) => /class=["'][^"']*\buser-profile-avatar\b/.test(tag)
  );
  const sources = /* @__PURE__ */ new Map();
  async function image(src) {
    if (/^data:image\/(?:png|jpeg|gif|webp);base64,[a-z\d+/=]+$/i.test(src) && src.length < 9e4) {
      return src;
    }
    const allowed = /* @__PURE__ */ __name((url2) => !url2.username && !url2.password && url2.protocol === "https:" && hosts.has(url2.hostname) && (!url2.port || url2.port === "443"), "allowed");
    let url;
    try {
      url = new URL(src.replaceAll("&amp;", "&"), base);
    } catch {
      return fallback;
    }
    if (url.origin !== base.origin && url.protocol === "http:" && hosts.has(url.hostname)) {
      url.protocol = "https:";
    }
    if (!allowed(url)) {
      return fallback;
    }
    const key2 = url.href;
    const hit = cache.get(key2);
    if (hit && hit.expires > Date.now()) {
      return hit.value;
    }
    const value = (async () => {
      try {
        for (let redirects = 0; redirects <= 3; redirects++) {
          const response = await download(url, {
            redirect: "manual",
            headers: { Accept: "image/png,image/jpeg,image/webp,image/gif" },
            signal: AbortSignal.timeout(3e3)
          });
          if ([301, 302, 303, 307, 308].includes(response.status)) {
            await response.body?.cancel();
            url = new URL(response.headers.get("location") || "", url);
            if (!allowed(url)) {
              return fallback;
            }
            continue;
          }
          const type2 = response.headers.get("content-type")?.split(";")[0] || "";
          if (!response.ok || !/^image\/(png|jpeg|gif|webp)$/.test(type2) || Number(response.headers.get("content-length")) > 65536) {
            await response.body?.cancel();
            return fallback;
          }
          const reader = response.body?.getReader();
          if (!reader) {
            return fallback;
          }
          const parts = [];
          let size = 0;
          try {
            for (; ; ) {
              const item = await reader.read();
              if (item.done) {
                break;
              }
              size += item.value.length;
              if (size > 65536) {
                await reader.cancel();
                return fallback;
              }
              parts.push(item.value);
            }
          } finally {
            reader.releaseLock();
          }
          return size ? `data:${type2};base64,${Buffer.concat(parts).toString("base64")}` : fallback;
        }
      } catch {
      }
      return fallback;
    })();
    if (cache.size >= 256) {
      cache.delete(cache.keys().next().value);
    }
    cache.set(key2, { expires: Date.now() + 6e5, value });
    return value;
  }
  __name(image, "image");
  let cursor = 0;
  await Promise.all(
    Array.from({ length: Math.min(4, tags.length) }, async () => {
      while (cursor < tags.length) {
        const tag = tags[cursor++][0];
        const src = /\bsrc=["']([^"']*)["']/.exec(tag)?.[1];
        if (src && !sources.has(src)) {
          sources.set(src, await image(src));
        }
      }
    })
  );
  return html.replace(
    /<img\b[^>]*>/gi,
    (tag) => /class=["'][^"']*\buser-profile-avatar\b/.test(tag) ? tag.replace(
      /\bsrc=(["'])([^"']*)\1/,
      (_, quote, src) => `src=${quote}${sources.get(src) || fallback}${quote}`
    ) : tag
  );
}
__name(inlineAvatars, "inlineAvatars");

// plugins/hutoj-contest-client/src/recording-settings.ts
var import_node_path2 = __toESM(require("node:path"), 1);

// node_modules/.pnpm/js-yaml@4.3.0/node_modules/js-yaml/dist/js-yaml.mjs
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
__name(getDefaultExportFromCjs, "getDefaultExportFromCjs");
var jsYaml = {};
var loader = {};
var common = {};
var hasRequiredCommon;
function requireCommon() {
  if (hasRequiredCommon) return common;
  hasRequiredCommon = 1;
  function isNothing(subject) {
    return typeof subject === "undefined" || subject === null;
  }
  __name(isNothing, "isNothing");
  function isObject(subject) {
    return typeof subject === "object" && subject !== null;
  }
  __name(isObject, "isObject");
  function toArray(sequence) {
    if (Array.isArray(sequence)) return sequence;
    else if (isNothing(sequence)) return [];
    return [sequence];
  }
  __name(toArray, "toArray");
  function extend(target, source) {
    if (source) {
      const sourceKeys = Object.keys(source);
      for (let index = 0, length = sourceKeys.length; index < length; index += 1) {
        const key2 = sourceKeys[index];
        target[key2] = source[key2];
      }
    }
    return target;
  }
  __name(extend, "extend");
  function repeat(string, count) {
    let result = "";
    for (let cycle = 0; cycle < count; cycle += 1) {
      result += string;
    }
    return result;
  }
  __name(repeat, "repeat");
  function isNegativeZero(number) {
    return number === 0 && Number.NEGATIVE_INFINITY === 1 / number;
  }
  __name(isNegativeZero, "isNegativeZero");
  common.isNothing = isNothing;
  common.isObject = isObject;
  common.toArray = toArray;
  common.repeat = repeat;
  common.isNegativeZero = isNegativeZero;
  common.extend = extend;
  return common;
}
__name(requireCommon, "requireCommon");
var exception;
var hasRequiredException;
function requireException() {
  if (hasRequiredException) return exception;
  hasRequiredException = 1;
  function formatError(exception2, compact) {
    let where = "";
    const message = exception2.reason || "(unknown reason)";
    if (!exception2.mark) return message;
    if (exception2.mark.name) {
      where += 'in "' + exception2.mark.name + '" ';
    }
    where += "(" + (exception2.mark.line + 1) + ":" + (exception2.mark.column + 1) + ")";
    if (!compact && exception2.mark.snippet) {
      where += "\n\n" + exception2.mark.snippet;
    }
    return message + " " + where;
  }
  __name(formatError, "formatError");
  function YAMLException2(reason, mark) {
    Error.call(this);
    this.name = "YAMLException";
    this.reason = reason;
    this.mark = mark;
    this.message = formatError(this, false);
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    } else {
      this.stack = new Error().stack || "";
    }
  }
  __name(YAMLException2, "YAMLException2");
  YAMLException2.prototype = Object.create(Error.prototype);
  YAMLException2.prototype.constructor = YAMLException2;
  YAMLException2.prototype.toString = /* @__PURE__ */ __name(function toString(compact) {
    return this.name + ": " + formatError(this, compact);
  }, "toString");
  exception = YAMLException2;
  return exception;
}
__name(requireException, "requireException");
var snippet;
var hasRequiredSnippet;
function requireSnippet() {
  if (hasRequiredSnippet) return snippet;
  hasRequiredSnippet = 1;
  const common2 = requireCommon();
  function getLine(buffer, lineStart, lineEnd, position, maxLineLength) {
    let head = "";
    let tail = "";
    const maxHalfLength = Math.floor(maxLineLength / 2) - 1;
    if (position - lineStart > maxHalfLength) {
      head = " ... ";
      lineStart = position - maxHalfLength + head.length;
    }
    if (lineEnd - position > maxHalfLength) {
      tail = " ...";
      lineEnd = position + maxHalfLength - tail.length;
    }
    return {
      str: head + buffer.slice(lineStart, lineEnd).replace(/\t/g, "\u2192") + tail,
      pos: position - lineStart + head.length
      // relative position
    };
  }
  __name(getLine, "getLine");
  function padStart(string, max) {
    return common2.repeat(" ", max - string.length) + string;
  }
  __name(padStart, "padStart");
  function makeSnippet(mark, options) {
    options = Object.create(options || null);
    if (!mark.buffer) return null;
    if (!options.maxLength) options.maxLength = 79;
    if (typeof options.indent !== "number") options.indent = 1;
    if (typeof options.linesBefore !== "number") options.linesBefore = 3;
    if (typeof options.linesAfter !== "number") options.linesAfter = 2;
    const re = /\r?\n|\r|\0/g;
    const lineStarts = [0];
    const lineEnds = [];
    let match;
    let foundLineNo = -1;
    while (match = re.exec(mark.buffer)) {
      lineEnds.push(match.index);
      lineStarts.push(match.index + match[0].length);
      if (mark.position <= match.index && foundLineNo < 0) {
        foundLineNo = lineStarts.length - 2;
      }
    }
    if (foundLineNo < 0) foundLineNo = lineStarts.length - 1;
    let result = "";
    const lineNoLength = Math.min(mark.line + options.linesAfter, lineEnds.length).toString().length;
    const maxLineLength = options.maxLength - (options.indent + lineNoLength + 3);
    for (let i = 1; i <= options.linesBefore; i++) {
      if (foundLineNo - i < 0) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo - i],
        lineEnds[foundLineNo - i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo - i]),
        maxLineLength
      );
      result = common2.repeat(" ", options.indent) + padStart((mark.line - i + 1).toString(), lineNoLength) + " | " + line2.str + "\n" + result;
    }
    const line = getLine(mark.buffer, lineStarts[foundLineNo], lineEnds[foundLineNo], mark.position, maxLineLength);
    result += common2.repeat(" ", options.indent) + padStart((mark.line + 1).toString(), lineNoLength) + " | " + line.str + "\n";
    result += common2.repeat("-", options.indent + lineNoLength + 3 + line.pos) + "^\n";
    for (let i = 1; i <= options.linesAfter; i++) {
      if (foundLineNo + i >= lineEnds.length) break;
      const line2 = getLine(
        mark.buffer,
        lineStarts[foundLineNo + i],
        lineEnds[foundLineNo + i],
        mark.position - (lineStarts[foundLineNo] - lineStarts[foundLineNo + i]),
        maxLineLength
      );
      result += common2.repeat(" ", options.indent) + padStart((mark.line + i + 1).toString(), lineNoLength) + " | " + line2.str + "\n";
    }
    return result.replace(/\n$/, "");
  }
  __name(makeSnippet, "makeSnippet");
  snippet = makeSnippet;
  return snippet;
}
__name(requireSnippet, "requireSnippet");
var type;
var hasRequiredType;
function requireType() {
  if (hasRequiredType) return type;
  hasRequiredType = 1;
  const YAMLException2 = requireException();
  const TYPE_CONSTRUCTOR_OPTIONS = [
    "kind",
    "multi",
    "resolve",
    "construct",
    "instanceOf",
    "predicate",
    "represent",
    "representName",
    "defaultStyle",
    "styleAliases"
  ];
  const YAML_NODE_KINDS = [
    "scalar",
    "sequence",
    "mapping"
  ];
  function compileStyleAliases(map2) {
    const result = {};
    if (map2 !== null) {
      Object.keys(map2).forEach(function(style) {
        map2[style].forEach(function(alias) {
          result[String(alias)] = style;
        });
      });
    }
    return result;
  }
  __name(compileStyleAliases, "compileStyleAliases");
  function Type2(tag, options) {
    options = options || {};
    Object.keys(options).forEach(function(name2) {
      if (TYPE_CONSTRUCTOR_OPTIONS.indexOf(name2) === -1) {
        throw new YAMLException2('Unknown option "' + name2 + '" is met in definition of "' + tag + '" YAML type.');
      }
    });
    this.options = options;
    this.tag = tag;
    this.kind = options["kind"] || null;
    this.resolve = options["resolve"] || function() {
      return true;
    };
    this.construct = options["construct"] || function(data) {
      return data;
    };
    this.instanceOf = options["instanceOf"] || null;
    this.predicate = options["predicate"] || null;
    this.represent = options["represent"] || null;
    this.representName = options["representName"] || null;
    this.defaultStyle = options["defaultStyle"] || null;
    this.multi = options["multi"] || false;
    this.styleAliases = compileStyleAliases(options["styleAliases"] || null);
    if (YAML_NODE_KINDS.indexOf(this.kind) === -1) {
      throw new YAMLException2('Unknown kind "' + this.kind + '" is specified for "' + tag + '" YAML type.');
    }
  }
  __name(Type2, "Type2");
  type = Type2;
  return type;
}
__name(requireType, "requireType");
var schema;
var hasRequiredSchema;
function requireSchema() {
  if (hasRequiredSchema) return schema;
  hasRequiredSchema = 1;
  const YAMLException2 = requireException();
  const Type2 = requireType();
  function compileList(schema2, name2) {
    const result = [];
    schema2[name2].forEach(function(currentType) {
      let newIndex = result.length;
      result.forEach(function(previousType, previousIndex) {
        if (previousType.tag === currentType.tag && previousType.kind === currentType.kind && previousType.multi === currentType.multi) {
          newIndex = previousIndex;
        }
      });
      result[newIndex] = currentType;
    });
    return result;
  }
  __name(compileList, "compileList");
  function compileMap() {
    const result = {
      scalar: {},
      sequence: {},
      mapping: {},
      fallback: {},
      multi: {
        scalar: [],
        sequence: [],
        mapping: [],
        fallback: []
      }
    };
    function collectType(type2) {
      if (type2.multi) {
        result.multi[type2.kind].push(type2);
        result.multi["fallback"].push(type2);
      } else {
        result[type2.kind][type2.tag] = result["fallback"][type2.tag] = type2;
      }
    }
    __name(collectType, "collectType");
    for (let index = 0, length = arguments.length; index < length; index += 1) {
      arguments[index].forEach(collectType);
    }
    return result;
  }
  __name(compileMap, "compileMap");
  function Schema22(definition) {
    return this.extend(definition);
  }
  __name(Schema22, "Schema2");
  Schema22.prototype.extend = /* @__PURE__ */ __name(function extend(definition) {
    let implicit = [];
    let explicit = [];
    if (definition instanceof Type2) {
      explicit.push(definition);
    } else if (Array.isArray(definition)) {
      explicit = explicit.concat(definition);
    } else if (definition && (Array.isArray(definition.implicit) || Array.isArray(definition.explicit))) {
      if (definition.implicit) implicit = implicit.concat(definition.implicit);
      if (definition.explicit) explicit = explicit.concat(definition.explicit);
    } else {
      throw new YAMLException2("Schema.extend argument should be a Type, [ Type ], or a schema definition ({ implicit: [...], explicit: [...] })");
    }
    implicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
      if (type2.loadKind && type2.loadKind !== "scalar") {
        throw new YAMLException2("There is a non-scalar type in the implicit list of a schema. Implicit resolving of such types is not supported.");
      }
      if (type2.multi) {
        throw new YAMLException2("There is a multi type in the implicit list of a schema. Multi tags can only be listed as explicit.");
      }
    });
    explicit.forEach(function(type2) {
      if (!(type2 instanceof Type2)) {
        throw new YAMLException2("Specified list of YAML types (or a single Type object) contains a non-Type object.");
      }
    });
    const result = Object.create(Schema22.prototype);
    result.implicit = (this.implicit || []).concat(implicit);
    result.explicit = (this.explicit || []).concat(explicit);
    result.compiledImplicit = compileList(result, "implicit");
    result.compiledExplicit = compileList(result, "explicit");
    result.compiledTypeMap = compileMap(result.compiledImplicit, result.compiledExplicit);
    return result;
  }, "extend");
  schema = Schema22;
  return schema;
}
__name(requireSchema, "requireSchema");
var str;
var hasRequiredStr;
function requireStr() {
  if (hasRequiredStr) return str;
  hasRequiredStr = 1;
  const Type2 = requireType();
  str = new Type2("tag:yaml.org,2002:str", {
    kind: "scalar",
    construct: /* @__PURE__ */ __name(function(data) {
      return data !== null ? data : "";
    }, "construct")
  });
  return str;
}
__name(requireStr, "requireStr");
var seq;
var hasRequiredSeq;
function requireSeq() {
  if (hasRequiredSeq) return seq;
  hasRequiredSeq = 1;
  const Type2 = requireType();
  seq = new Type2("tag:yaml.org,2002:seq", {
    kind: "sequence",
    construct: /* @__PURE__ */ __name(function(data) {
      return data !== null ? data : [];
    }, "construct")
  });
  return seq;
}
__name(requireSeq, "requireSeq");
var map;
var hasRequiredMap;
function requireMap() {
  if (hasRequiredMap) return map;
  hasRequiredMap = 1;
  const Type2 = requireType();
  map = new Type2("tag:yaml.org,2002:map", {
    kind: "mapping",
    construct: /* @__PURE__ */ __name(function(data) {
      return data !== null ? data : {};
    }, "construct")
  });
  return map;
}
__name(requireMap, "requireMap");
var failsafe;
var hasRequiredFailsafe;
function requireFailsafe() {
  if (hasRequiredFailsafe) return failsafe;
  hasRequiredFailsafe = 1;
  const Schema22 = requireSchema();
  failsafe = new Schema22({
    explicit: [
      requireStr(),
      requireSeq(),
      requireMap()
    ]
  });
  return failsafe;
}
__name(requireFailsafe, "requireFailsafe");
var _null;
var hasRequired_null;
function require_null() {
  if (hasRequired_null) return _null;
  hasRequired_null = 1;
  const Type2 = requireType();
  function resolveYamlNull(data) {
    if (data === null) return true;
    const max = data.length;
    return max === 1 && data === "~" || max === 4 && (data === "null" || data === "Null" || data === "NULL");
  }
  __name(resolveYamlNull, "resolveYamlNull");
  function constructYamlNull() {
    return null;
  }
  __name(constructYamlNull, "constructYamlNull");
  function isNull(object) {
    return object === null;
  }
  __name(isNull, "isNull");
  _null = new Type2("tag:yaml.org,2002:null", {
    kind: "scalar",
    resolve: resolveYamlNull,
    construct: constructYamlNull,
    predicate: isNull,
    represent: {
      canonical: /* @__PURE__ */ __name(function() {
        return "~";
      }, "canonical"),
      lowercase: /* @__PURE__ */ __name(function() {
        return "null";
      }, "lowercase"),
      uppercase: /* @__PURE__ */ __name(function() {
        return "NULL";
      }, "uppercase"),
      camelcase: /* @__PURE__ */ __name(function() {
        return "Null";
      }, "camelcase"),
      empty: /* @__PURE__ */ __name(function() {
        return "";
      }, "empty")
    },
    defaultStyle: "lowercase"
  });
  return _null;
}
__name(require_null, "require_null");
var bool;
var hasRequiredBool;
function requireBool() {
  if (hasRequiredBool) return bool;
  hasRequiredBool = 1;
  const Type2 = requireType();
  function resolveYamlBoolean(data) {
    if (data === null) return false;
    const max = data.length;
    return max === 4 && (data === "true" || data === "True" || data === "TRUE") || max === 5 && (data === "false" || data === "False" || data === "FALSE");
  }
  __name(resolveYamlBoolean, "resolveYamlBoolean");
  function constructYamlBoolean(data) {
    return data === "true" || data === "True" || data === "TRUE";
  }
  __name(constructYamlBoolean, "constructYamlBoolean");
  function isBoolean(object) {
    return Object.prototype.toString.call(object) === "[object Boolean]";
  }
  __name(isBoolean, "isBoolean");
  bool = new Type2("tag:yaml.org,2002:bool", {
    kind: "scalar",
    resolve: resolveYamlBoolean,
    construct: constructYamlBoolean,
    predicate: isBoolean,
    represent: {
      lowercase: /* @__PURE__ */ __name(function(object) {
        return object ? "true" : "false";
      }, "lowercase"),
      uppercase: /* @__PURE__ */ __name(function(object) {
        return object ? "TRUE" : "FALSE";
      }, "uppercase"),
      camelcase: /* @__PURE__ */ __name(function(object) {
        return object ? "True" : "False";
      }, "camelcase")
    },
    defaultStyle: "lowercase"
  });
  return bool;
}
__name(requireBool, "requireBool");
var int;
var hasRequiredInt;
function requireInt() {
  if (hasRequiredInt) return int;
  hasRequiredInt = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  function isHexCode(c) {
    return c >= 48 && c <= 57 || c >= 65 && c <= 70 || c >= 97 && c <= 102;
  }
  __name(isHexCode, "isHexCode");
  function isOctCode(c) {
    return c >= 48 && c <= 55;
  }
  __name(isOctCode, "isOctCode");
  function isDecCode(c) {
    return c >= 48 && c <= 57;
  }
  __name(isDecCode, "isDecCode");
  function resolveYamlInteger(data) {
    if (data === null) return false;
    const max = data.length;
    let index = 0;
    let hasDigits = false;
    if (!max) return false;
    let ch = data[index];
    if (ch === "-" || ch === "+") {
      ch = data[++index];
    }
    if (ch === "0") {
      if (index + 1 === max) return true;
      ch = data[++index];
      if (ch === "b") {
        index++;
        for (; index < max; index++) {
          ch = data[index];
          if (ch !== "0" && ch !== "1") return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "x") {
        index++;
        for (; index < max; index++) {
          if (!isHexCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
      if (ch === "o") {
        index++;
        for (; index < max; index++) {
          if (!isOctCode(data.charCodeAt(index))) return false;
          hasDigits = true;
        }
        return hasDigits && isFinite(parseYamlInteger(data));
      }
    }
    for (; index < max; index++) {
      if (!isDecCode(data.charCodeAt(index))) {
        return false;
      }
      hasDigits = true;
    }
    if (!hasDigits) return false;
    return isFinite(parseYamlInteger(data));
  }
  __name(resolveYamlInteger, "resolveYamlInteger");
  function parseYamlInteger(data) {
    let value = data;
    let sign = 1;
    let ch = value[0];
    if (ch === "-" || ch === "+") {
      if (ch === "-") sign = -1;
      value = value.slice(1);
      ch = value[0];
    }
    if (value === "0") return 0;
    if (ch === "0") {
      if (value[1] === "b") return sign * parseInt(value.slice(2), 2);
      if (value[1] === "x") return sign * parseInt(value.slice(2), 16);
      if (value[1] === "o") return sign * parseInt(value.slice(2), 8);
    }
    return sign * parseInt(value, 10);
  }
  __name(parseYamlInteger, "parseYamlInteger");
  function constructYamlInteger(data) {
    return parseYamlInteger(data);
  }
  __name(constructYamlInteger, "constructYamlInteger");
  function isInteger(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 === 0 && !common2.isNegativeZero(object));
  }
  __name(isInteger, "isInteger");
  int = new Type2("tag:yaml.org,2002:int", {
    kind: "scalar",
    resolve: resolveYamlInteger,
    construct: constructYamlInteger,
    predicate: isInteger,
    represent: {
      binary: /* @__PURE__ */ __name(function(obj) {
        return obj >= 0 ? "0b" + obj.toString(2) : "-0b" + obj.toString(2).slice(1);
      }, "binary"),
      octal: /* @__PURE__ */ __name(function(obj) {
        return obj >= 0 ? "0o" + obj.toString(8) : "-0o" + obj.toString(8).slice(1);
      }, "octal"),
      decimal: /* @__PURE__ */ __name(function(obj) {
        return obj.toString(10);
      }, "decimal"),
      hexadecimal: /* @__PURE__ */ __name(function(obj) {
        return obj >= 0 ? "0x" + obj.toString(16).toUpperCase() : "-0x" + obj.toString(16).toUpperCase().slice(1);
      }, "hexadecimal")
    },
    defaultStyle: "decimal",
    styleAliases: {
      binary: [2, "bin"],
      octal: [8, "oct"],
      decimal: [10, "dec"],
      hexadecimal: [16, "hex"]
    }
  });
  return int;
}
__name(requireInt, "requireInt");
var float;
var hasRequiredFloat;
function requireFloat() {
  if (hasRequiredFloat) return float;
  hasRequiredFloat = 1;
  const common2 = requireCommon();
  const Type2 = requireType();
  const YAML_FLOAT_PATTERN = new RegExp(
    // 2.5e4, 2.5 and integers
    "^(?:[-+]?(?:[0-9]+)(?:\\.[0-9]*)?(?:[eE][-+]?[0-9]+)?|\\.[0-9]+(?:[eE][-+]?[0-9]+)?|[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  const YAML_FLOAT_SPECIAL_PATTERN = new RegExp(
    "^(?:[-+]?\\.(?:inf|Inf|INF)|\\.(?:nan|NaN|NAN))$"
  );
  function resolveYamlFloat(data) {
    if (data === null) return false;
    if (!YAML_FLOAT_PATTERN.test(data)) {
      return false;
    }
    if (isFinite(parseFloat(data, 10))) {
      return true;
    }
    return YAML_FLOAT_SPECIAL_PATTERN.test(data);
  }
  __name(resolveYamlFloat, "resolveYamlFloat");
  function constructYamlFloat(data) {
    let value = data.toLowerCase();
    const sign = value[0] === "-" ? -1 : 1;
    if ("+-".indexOf(value[0]) >= 0) {
      value = value.slice(1);
    }
    if (value === ".inf") {
      return sign === 1 ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
    } else if (value === ".nan") {
      return NaN;
    }
    return sign * parseFloat(value, 10);
  }
  __name(constructYamlFloat, "constructYamlFloat");
  const SCIENTIFIC_WITHOUT_DOT = /^[-+]?[0-9]+e/;
  function representYamlFloat(object, style) {
    if (isNaN(object)) {
      switch (style) {
        case "lowercase":
          return ".nan";
        case "uppercase":
          return ".NAN";
        case "camelcase":
          return ".NaN";
      }
    } else if (Number.POSITIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return ".inf";
        case "uppercase":
          return ".INF";
        case "camelcase":
          return ".Inf";
      }
    } else if (Number.NEGATIVE_INFINITY === object) {
      switch (style) {
        case "lowercase":
          return "-.inf";
        case "uppercase":
          return "-.INF";
        case "camelcase":
          return "-.Inf";
      }
    } else if (common2.isNegativeZero(object)) {
      return "-0.0";
    }
    const res = object.toString(10);
    return SCIENTIFIC_WITHOUT_DOT.test(res) ? res.replace("e", ".e") : res;
  }
  __name(representYamlFloat, "representYamlFloat");
  function isFloat(object) {
    return Object.prototype.toString.call(object) === "[object Number]" && (object % 1 !== 0 || common2.isNegativeZero(object));
  }
  __name(isFloat, "isFloat");
  float = new Type2("tag:yaml.org,2002:float", {
    kind: "scalar",
    resolve: resolveYamlFloat,
    construct: constructYamlFloat,
    predicate: isFloat,
    represent: representYamlFloat,
    defaultStyle: "lowercase"
  });
  return float;
}
__name(requireFloat, "requireFloat");
var json;
var hasRequiredJson;
function requireJson() {
  if (hasRequiredJson) return json;
  hasRequiredJson = 1;
  json = requireFailsafe().extend({
    implicit: [
      require_null(),
      requireBool(),
      requireInt(),
      requireFloat()
    ]
  });
  return json;
}
__name(requireJson, "requireJson");
var core;
var hasRequiredCore;
function requireCore() {
  if (hasRequiredCore) return core;
  hasRequiredCore = 1;
  core = requireJson();
  return core;
}
__name(requireCore, "requireCore");
var timestamp;
var hasRequiredTimestamp;
function requireTimestamp() {
  if (hasRequiredTimestamp) return timestamp;
  hasRequiredTimestamp = 1;
  const Type2 = requireType();
  const YAML_DATE_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9])-([0-9][0-9])$"
  );
  const YAML_TIMESTAMP_REGEXP = new RegExp(
    "^([0-9][0-9][0-9][0-9])-([0-9][0-9]?)-([0-9][0-9]?)(?:[Tt]|[ \\t]+)([0-9][0-9]?):([0-9][0-9]):([0-9][0-9])(?:\\.([0-9]*))?(?:[ \\t]*(Z|([-+])([0-9][0-9]?)(?::([0-9][0-9]))?))?$"
  );
  function resolveYamlTimestamp(data) {
    if (data === null) return false;
    if (YAML_DATE_REGEXP.exec(data) !== null) return true;
    if (YAML_TIMESTAMP_REGEXP.exec(data) !== null) return true;
    return false;
  }
  __name(resolveYamlTimestamp, "resolveYamlTimestamp");
  function constructYamlTimestamp(data) {
    let fraction = 0;
    let delta = null;
    let match = YAML_DATE_REGEXP.exec(data);
    if (match === null) match = YAML_TIMESTAMP_REGEXP.exec(data);
    if (match === null) throw new Error("Date resolve error");
    const year = +match[1];
    const month = +match[2] - 1;
    const day = +match[3];
    if (!match[4]) {
      return new Date(Date.UTC(year, month, day));
    }
    const hour = +match[4];
    const minute = +match[5];
    const second = +match[6];
    if (match[7]) {
      fraction = match[7].slice(0, 3);
      while (fraction.length < 3) {
        fraction += "0";
      }
      fraction = +fraction;
    }
    if (match[9]) {
      const tzHour = +match[10];
      const tzMinute = +(match[11] || 0);
      delta = (tzHour * 60 + tzMinute) * 6e4;
      if (match[9] === "-") delta = -delta;
    }
    const date = new Date(Date.UTC(year, month, day, hour, minute, second, fraction));
    if (delta) date.setTime(date.getTime() - delta);
    return date;
  }
  __name(constructYamlTimestamp, "constructYamlTimestamp");
  function representYamlTimestamp(object) {
    return object.toISOString();
  }
  __name(representYamlTimestamp, "representYamlTimestamp");
  timestamp = new Type2("tag:yaml.org,2002:timestamp", {
    kind: "scalar",
    resolve: resolveYamlTimestamp,
    construct: constructYamlTimestamp,
    instanceOf: Date,
    represent: representYamlTimestamp
  });
  return timestamp;
}
__name(requireTimestamp, "requireTimestamp");
var merge;
var hasRequiredMerge;
function requireMerge() {
  if (hasRequiredMerge) return merge;
  hasRequiredMerge = 1;
  const Type2 = requireType();
  function resolveYamlMerge(data) {
    return data === "<<" || data === null;
  }
  __name(resolveYamlMerge, "resolveYamlMerge");
  merge = new Type2("tag:yaml.org,2002:merge", {
    kind: "scalar",
    resolve: resolveYamlMerge
  });
  return merge;
}
__name(requireMerge, "requireMerge");
var binary;
var hasRequiredBinary;
function requireBinary() {
  if (hasRequiredBinary) return binary;
  hasRequiredBinary = 1;
  const Type2 = requireType();
  const BASE64_MAP = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=\n\r";
  function resolveYamlBinary(data) {
    if (data === null) return false;
    let bitlen = 0;
    const max = data.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      const code = map2.indexOf(data.charAt(idx));
      if (code > 64) continue;
      if (code < 0) return false;
      bitlen += 6;
    }
    return bitlen % 8 === 0;
  }
  __name(resolveYamlBinary, "resolveYamlBinary");
  function constructYamlBinary(data) {
    const input = data.replace(/[\r\n=]/g, "");
    const max = input.length;
    const map2 = BASE64_MAP;
    let bits = 0;
    const result = [];
    for (let idx = 0; idx < max; idx++) {
      if (idx % 4 === 0 && idx) {
        result.push(bits >> 16 & 255);
        result.push(bits >> 8 & 255);
        result.push(bits & 255);
      }
      bits = bits << 6 | map2.indexOf(input.charAt(idx));
    }
    const tailbits = max % 4 * 6;
    if (tailbits === 0) {
      result.push(bits >> 16 & 255);
      result.push(bits >> 8 & 255);
      result.push(bits & 255);
    } else if (tailbits === 18) {
      result.push(bits >> 10 & 255);
      result.push(bits >> 2 & 255);
    } else if (tailbits === 12) {
      result.push(bits >> 4 & 255);
    }
    return new Uint8Array(result);
  }
  __name(constructYamlBinary, "constructYamlBinary");
  function representYamlBinary(object) {
    let result = "";
    let bits = 0;
    const max = object.length;
    const map2 = BASE64_MAP;
    for (let idx = 0; idx < max; idx++) {
      if (idx % 3 === 0 && idx) {
        result += map2[bits >> 18 & 63];
        result += map2[bits >> 12 & 63];
        result += map2[bits >> 6 & 63];
        result += map2[bits & 63];
      }
      bits = (bits << 8) + object[idx];
    }
    const tail = max % 3;
    if (tail === 0) {
      result += map2[bits >> 18 & 63];
      result += map2[bits >> 12 & 63];
      result += map2[bits >> 6 & 63];
      result += map2[bits & 63];
    } else if (tail === 2) {
      result += map2[bits >> 10 & 63];
      result += map2[bits >> 4 & 63];
      result += map2[bits << 2 & 63];
      result += map2[64];
    } else if (tail === 1) {
      result += map2[bits >> 2 & 63];
      result += map2[bits << 4 & 63];
      result += map2[64];
      result += map2[64];
    }
    return result;
  }
  __name(representYamlBinary, "representYamlBinary");
  function isBinary(obj) {
    return Object.prototype.toString.call(obj) === "[object Uint8Array]";
  }
  __name(isBinary, "isBinary");
  binary = new Type2("tag:yaml.org,2002:binary", {
    kind: "scalar",
    resolve: resolveYamlBinary,
    construct: constructYamlBinary,
    predicate: isBinary,
    represent: representYamlBinary
  });
  return binary;
}
__name(requireBinary, "requireBinary");
var omap;
var hasRequiredOmap;
function requireOmap() {
  if (hasRequiredOmap) return omap;
  hasRequiredOmap = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const _toString = Object.prototype.toString;
  function resolveYamlOmap(data) {
    if (data === null) return true;
    const objectKeys = [];
    const object = data;
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      let pairHasKey = false;
      if (_toString.call(pair) !== "[object Object]") return false;
      let pairKey;
      for (pairKey in pair) {
        if (_hasOwnProperty.call(pair, pairKey)) {
          if (!pairHasKey) pairHasKey = true;
          else return false;
        }
      }
      if (!pairHasKey) return false;
      if (objectKeys.indexOf(pairKey) === -1) objectKeys.push(pairKey);
      else return false;
    }
    return true;
  }
  __name(resolveYamlOmap, "resolveYamlOmap");
  function constructYamlOmap(data) {
    return data !== null ? data : [];
  }
  __name(constructYamlOmap, "constructYamlOmap");
  omap = new Type2("tag:yaml.org,2002:omap", {
    kind: "sequence",
    resolve: resolveYamlOmap,
    construct: constructYamlOmap
  });
  return omap;
}
__name(requireOmap, "requireOmap");
var pairs;
var hasRequiredPairs;
function requirePairs() {
  if (hasRequiredPairs) return pairs;
  hasRequiredPairs = 1;
  const Type2 = requireType();
  const _toString = Object.prototype.toString;
  function resolveYamlPairs(data) {
    if (data === null) return true;
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      if (_toString.call(pair) !== "[object Object]") return false;
      const keys = Object.keys(pair);
      if (keys.length !== 1) return false;
      result[index] = [keys[0], pair[keys[0]]];
    }
    return true;
  }
  __name(resolveYamlPairs, "resolveYamlPairs");
  function constructYamlPairs(data) {
    if (data === null) return [];
    const object = data;
    const result = new Array(object.length);
    for (let index = 0, length = object.length; index < length; index += 1) {
      const pair = object[index];
      const keys = Object.keys(pair);
      result[index] = [keys[0], pair[keys[0]]];
    }
    return result;
  }
  __name(constructYamlPairs, "constructYamlPairs");
  pairs = new Type2("tag:yaml.org,2002:pairs", {
    kind: "sequence",
    resolve: resolveYamlPairs,
    construct: constructYamlPairs
  });
  return pairs;
}
__name(requirePairs, "requirePairs");
var set;
var hasRequiredSet;
function requireSet() {
  if (hasRequiredSet) return set;
  hasRequiredSet = 1;
  const Type2 = requireType();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  function resolveYamlSet(data) {
    if (data === null) return true;
    const object = data;
    for (const key2 in object) {
      if (_hasOwnProperty.call(object, key2)) {
        if (object[key2] !== null) return false;
      }
    }
    return true;
  }
  __name(resolveYamlSet, "resolveYamlSet");
  function constructYamlSet(data) {
    return data !== null ? data : {};
  }
  __name(constructYamlSet, "constructYamlSet");
  set = new Type2("tag:yaml.org,2002:set", {
    kind: "mapping",
    resolve: resolveYamlSet,
    construct: constructYamlSet
  });
  return set;
}
__name(requireSet, "requireSet");
var _default;
var hasRequired_default;
function require_default() {
  if (hasRequired_default) return _default;
  hasRequired_default = 1;
  _default = requireCore().extend({
    implicit: [
      requireTimestamp(),
      requireMerge()
    ],
    explicit: [
      requireBinary(),
      requireOmap(),
      requirePairs(),
      requireSet()
    ]
  });
  return _default;
}
__name(require_default, "require_default");
var hasRequiredLoader;
function requireLoader() {
  if (hasRequiredLoader) return loader;
  hasRequiredLoader = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const makeSnippet = requireSnippet();
  const DEFAULT_SCHEMA2 = require_default();
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CONTEXT_FLOW_IN = 1;
  const CONTEXT_FLOW_OUT = 2;
  const CONTEXT_BLOCK_IN = 3;
  const CONTEXT_BLOCK_OUT = 4;
  const CHOMPING_CLIP = 1;
  const CHOMPING_STRIP = 2;
  const CHOMPING_KEEP = 3;
  const PATTERN_NON_PRINTABLE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x84\x86-\x9F\uFFFE\uFFFF]|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?:[^\uD800-\uDBFF]|^)[\uDC00-\uDFFF]/;
  const PATTERN_NON_ASCII_LINE_BREAKS = /[\x85\u2028\u2029]/;
  const PATTERN_FLOW_INDICATORS = /[,\[\]{}]/;
  const PATTERN_TAG_HANDLE = /^(?:!|!!|![0-9A-Za-z-]+!)$/;
  const PATTERN_TAG_URI = /^(?:!|[^,\[\]{}])(?:%[0-9a-f]{2}|[0-9a-z\-#;/?:@&=+$,_.!~*'()\[\]])*$/i;
  function _class(obj) {
    return Object.prototype.toString.call(obj);
  }
  __name(_class, "_class");
  function isEol(c) {
    return c === 10 || c === 13;
  }
  __name(isEol, "isEol");
  function isWhiteSpace(c) {
    return c === 9 || c === 32;
  }
  __name(isWhiteSpace, "isWhiteSpace");
  function isWsOrEol(c) {
    return c === 9 || c === 32 || c === 10 || c === 13;
  }
  __name(isWsOrEol, "isWsOrEol");
  function isFlowIndicator(c) {
    return c === 44 || c === 91 || c === 93 || c === 123 || c === 125;
  }
  __name(isFlowIndicator, "isFlowIndicator");
  function fromHexCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    const lc = c | 32;
    if (lc >= 97 && lc <= 102) {
      return lc - 97 + 10;
    }
    return -1;
  }
  __name(fromHexCode, "fromHexCode");
  function escapedHexLen(c) {
    if (c === 120) {
      return 2;
    }
    if (c === 117) {
      return 4;
    }
    if (c === 85) {
      return 8;
    }
    return 0;
  }
  __name(escapedHexLen, "escapedHexLen");
  function fromDecimalCode(c) {
    if (c >= 48 && c <= 57) {
      return c - 48;
    }
    return -1;
  }
  __name(fromDecimalCode, "fromDecimalCode");
  function simpleEscapeSequence(c) {
    switch (c) {
      case 48:
        return "\0";
      case 97:
        return "\x07";
      case 98:
        return "\b";
      case 116:
        return "	";
      case 9:
        return "	";
      case 110:
        return "\n";
      case 118:
        return "\v";
      case 102:
        return "\f";
      case 114:
        return "\r";
      case 101:
        return "\x1B";
      case 32:
        return " ";
      case 34:
        return '"';
      case 47:
        return "/";
      case 92:
        return "\\";
      case 78:
        return "\x85";
      case 95:
        return "\xA0";
      case 76:
        return "\u2028";
      case 80:
        return "\u2029";
      default:
        return "";
    }
  }
  __name(simpleEscapeSequence, "simpleEscapeSequence");
  function charFromCodepoint(c) {
    if (c <= 65535) {
      return String.fromCharCode(c);
    }
    return String.fromCharCode(
      (c - 65536 >> 10) + 55296,
      (c - 65536 & 1023) + 56320
    );
  }
  __name(charFromCodepoint, "charFromCodepoint");
  function setProperty(object, key2, value) {
    if (key2 === "__proto__") {
      Object.defineProperty(object, key2, {
        configurable: true,
        enumerable: true,
        writable: true,
        value
      });
    } else {
      object[key2] = value;
    }
  }
  __name(setProperty, "setProperty");
  const simpleEscapeCheck = new Array(256);
  const simpleEscapeMap = new Array(256);
  for (let i = 0; i < 256; i++) {
    simpleEscapeCheck[i] = simpleEscapeSequence(i) ? 1 : 0;
    simpleEscapeMap[i] = simpleEscapeSequence(i);
  }
  function State(input, options) {
    this.input = input;
    this.filename = options["filename"] || null;
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.onWarning = options["onWarning"] || null;
    this.legacy = options["legacy"] || false;
    this.json = options["json"] || false;
    this.listener = options["listener"] || null;
    this.maxDepth = typeof options["maxDepth"] === "number" ? options["maxDepth"] : 100;
    this.maxTotalMergeKeys = typeof options["maxTotalMergeKeys"] === "number" ? options["maxTotalMergeKeys"] : 1e4;
    this.implicitTypes = this.schema.compiledImplicit;
    this.typeMap = this.schema.compiledTypeMap;
    this.length = input.length;
    this.position = 0;
    this.line = 0;
    this.lineStart = 0;
    this.lineIndent = 0;
    this.depth = 0;
    this.totalMergeKeys = 0;
    this.firstTabInLine = -1;
    this.documents = [];
    this.anchorMapTransactions = [];
  }
  __name(State, "State");
  function generateError(state, message) {
    const mark = {
      name: state.filename,
      buffer: state.input.slice(0, -1),
      // omit trailing \0
      position: state.position,
      line: state.line,
      column: state.position - state.lineStart
    };
    mark.snippet = makeSnippet(mark);
    return new YAMLException2(message, mark);
  }
  __name(generateError, "generateError");
  function throwError(state, message) {
    throw generateError(state, message);
  }
  __name(throwError, "throwError");
  function throwWarning(state, message) {
    if (state.onWarning) {
      state.onWarning.call(null, generateError(state, message));
    }
  }
  __name(throwWarning, "throwWarning");
  function storeAnchor(state, name2, value) {
    const transactions = state.anchorMapTransactions;
    if (transactions.length !== 0) {
      const transaction = transactions[transactions.length - 1];
      if (!_hasOwnProperty.call(transaction, name2)) {
        transaction[name2] = {
          existed: _hasOwnProperty.call(state.anchorMap, name2),
          value: state.anchorMap[name2]
        };
      }
    }
    state.anchorMap[name2] = value;
  }
  __name(storeAnchor, "storeAnchor");
  function beginAnchorTransaction(state) {
    state.anchorMapTransactions.push(/* @__PURE__ */ Object.create(null));
  }
  __name(beginAnchorTransaction, "beginAnchorTransaction");
  function commitAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const transactions = state.anchorMapTransactions;
    if (transactions.length === 0) return;
    const parent = transactions[transactions.length - 1];
    const names = Object.keys(transaction);
    for (let index = 0, length = names.length; index < length; index += 1) {
      const name2 = names[index];
      if (!_hasOwnProperty.call(parent, name2)) {
        parent[name2] = transaction[name2];
      }
    }
  }
  __name(commitAnchorTransaction, "commitAnchorTransaction");
  function rollbackAnchorTransaction(state) {
    const transaction = state.anchorMapTransactions.pop();
    const names = Object.keys(transaction);
    for (let index = names.length - 1; index >= 0; index -= 1) {
      const entry = transaction[names[index]];
      if (entry.existed) {
        state.anchorMap[names[index]] = entry.value;
      } else {
        delete state.anchorMap[names[index]];
      }
    }
  }
  __name(rollbackAnchorTransaction, "rollbackAnchorTransaction");
  function snapshotState(state) {
    return {
      position: state.position,
      line: state.line,
      lineStart: state.lineStart,
      lineIndent: state.lineIndent,
      firstTabInLine: state.firstTabInLine,
      tag: state.tag,
      anchor: state.anchor,
      kind: state.kind,
      result: state.result
    };
  }
  __name(snapshotState, "snapshotState");
  function restoreState(state, snapshot) {
    state.position = snapshot.position;
    state.line = snapshot.line;
    state.lineStart = snapshot.lineStart;
    state.lineIndent = snapshot.lineIndent;
    state.firstTabInLine = snapshot.firstTabInLine;
    state.tag = snapshot.tag;
    state.anchor = snapshot.anchor;
    state.kind = snapshot.kind;
    state.result = snapshot.result;
  }
  __name(restoreState, "restoreState");
  const directiveHandlers = {
    YAML: /* @__PURE__ */ __name(function handleYamlDirective(state, name2, args) {
      if (state.version !== null) {
        throwError(state, "duplication of %YAML directive");
      }
      if (args.length !== 1) {
        throwError(state, "YAML directive accepts exactly one argument");
      }
      const match = /^([0-9]+)\.([0-9]+)$/.exec(args[0]);
      if (match === null) {
        throwError(state, "ill-formed argument of the YAML directive");
      }
      const major = parseInt(match[1], 10);
      const minor = parseInt(match[2], 10);
      if (major !== 1) {
        throwError(state, "unacceptable YAML version of the document");
      }
      state.version = args[0];
      state.checkLineBreaks = minor < 2;
      if (minor !== 1 && minor !== 2) {
        throwWarning(state, "unsupported YAML version of the document");
      }
    }, "handleYamlDirective"),
    TAG: /* @__PURE__ */ __name(function handleTagDirective(state, name2, args) {
      let prefix;
      if (args.length !== 2) {
        throwError(state, "TAG directive accepts exactly two arguments");
      }
      const handle = args[0];
      prefix = args[1];
      if (!PATTERN_TAG_HANDLE.test(handle)) {
        throwError(state, "ill-formed tag handle (first argument) of the TAG directive");
      }
      if (_hasOwnProperty.call(state.tagMap, handle)) {
        throwError(state, 'there is a previously declared suffix for "' + handle + '" tag handle');
      }
      if (!PATTERN_TAG_URI.test(prefix)) {
        throwError(state, "ill-formed tag prefix (second argument) of the TAG directive");
      }
      try {
        prefix = decodeURIComponent(prefix);
      } catch (err) {
        throwError(state, "tag prefix is malformed: " + prefix);
      }
      state.tagMap[handle] = prefix;
    }, "handleTagDirective")
  };
  function captureSegment(state, start, end, checkJson) {
    if (start < end) {
      const _result = state.input.slice(start, end);
      if (checkJson) {
        for (let _position = 0, _length = _result.length; _position < _length; _position += 1) {
          const _character = _result.charCodeAt(_position);
          if (!(_character === 9 || _character >= 32 && _character <= 1114111)) {
            throwError(state, "expected valid JSON character");
          }
        }
      } else if (PATTERN_NON_PRINTABLE.test(_result)) {
        throwError(state, "the stream contains non-printable characters");
      }
      state.result += _result;
    }
  }
  __name(captureSegment, "captureSegment");
  function mergeMappings(state, destination, source, overridableKeys) {
    if (!common2.isObject(source)) {
      throwError(state, "cannot merge mappings; the provided source object is unacceptable");
    }
    const sourceKeys = Object.keys(source);
    for (let index = 0, quantity = sourceKeys.length; index < quantity; index += 1) {
      const key2 = sourceKeys[index];
      if (state.maxTotalMergeKeys !== -1 && ++state.totalMergeKeys > state.maxTotalMergeKeys) {
        throwError(state, "merge keys exceeded maxTotalMergeKeys (" + state.maxTotalMergeKeys + ")");
      }
      if (!_hasOwnProperty.call(destination, key2)) {
        setProperty(destination, key2, source[key2]);
        overridableKeys[key2] = true;
      }
    }
  }
  __name(mergeMappings, "mergeMappings");
  function storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, startLine, startLineStart, startPos) {
    if (Array.isArray(keyNode)) {
      keyNode = Array.prototype.slice.call(keyNode);
      for (let index = 0, quantity = keyNode.length; index < quantity; index += 1) {
        if (Array.isArray(keyNode[index])) {
          throwError(state, "nested arrays are not supported inside keys");
        }
        if (typeof keyNode === "object" && _class(keyNode[index]) === "[object Object]") {
          keyNode[index] = "[object Object]";
        }
      }
    }
    if (typeof keyNode === "object" && _class(keyNode) === "[object Object]") {
      keyNode = "[object Object]";
    }
    keyNode = String(keyNode);
    if (_result === null) {
      _result = {};
    }
    if (keyTag === "tag:yaml.org,2002:merge") {
      if (Array.isArray(valueNode)) {
        for (let index = 0, quantity = valueNode.length; index < quantity; index += 1) {
          mergeMappings(state, _result, valueNode[index], overridableKeys);
        }
      } else {
        mergeMappings(state, _result, valueNode, overridableKeys);
      }
    } else {
      if (!state.json && !_hasOwnProperty.call(overridableKeys, keyNode) && _hasOwnProperty.call(_result, keyNode)) {
        state.line = startLine || state.line;
        state.lineStart = startLineStart || state.lineStart;
        state.position = startPos || state.position;
        throwError(state, "duplicated mapping key");
      }
      setProperty(_result, keyNode, valueNode);
      delete overridableKeys[keyNode];
    }
    return _result;
  }
  __name(storeMappingPair, "storeMappingPair");
  function readLineBreak(state) {
    const ch = state.input.charCodeAt(state.position);
    if (ch === 10) {
      state.position++;
    } else if (ch === 13) {
      state.position++;
      if (state.input.charCodeAt(state.position) === 10) {
        state.position++;
      }
    } else {
      throwError(state, "a line break is expected");
    }
    state.line += 1;
    state.lineStart = state.position;
    state.firstTabInLine = -1;
  }
  __name(readLineBreak, "readLineBreak");
  function skipSeparationSpace(state, allowComments, checkIndent) {
    let lineBreaks = 0;
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      while (isWhiteSpace(ch)) {
        if (ch === 9 && state.firstTabInLine === -1) {
          state.firstTabInLine = state.position;
        }
        ch = state.input.charCodeAt(++state.position);
      }
      if (allowComments && ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (ch !== 10 && ch !== 13 && ch !== 0);
      }
      if (isEol(ch)) {
        readLineBreak(state);
        ch = state.input.charCodeAt(state.position);
        lineBreaks++;
        state.lineIndent = 0;
        while (ch === 32) {
          state.lineIndent++;
          ch = state.input.charCodeAt(++state.position);
        }
      } else {
        break;
      }
    }
    if (checkIndent !== -1 && lineBreaks !== 0 && state.lineIndent < checkIndent) {
      throwWarning(state, "deficient indentation");
    }
    return lineBreaks;
  }
  __name(skipSeparationSpace, "skipSeparationSpace");
  function testDocumentSeparator(state) {
    let _position = state.position;
    let ch = state.input.charCodeAt(_position);
    if ((ch === 45 || ch === 46) && ch === state.input.charCodeAt(_position + 1) && ch === state.input.charCodeAt(_position + 2)) {
      _position += 3;
      ch = state.input.charCodeAt(_position);
      if (ch === 0 || isWsOrEol(ch)) {
        return true;
      }
    }
    return false;
  }
  __name(testDocumentSeparator, "testDocumentSeparator");
  function writeFoldedLines(state, count) {
    if (count === 1) {
      state.result += " ";
    } else if (count > 1) {
      state.result += common2.repeat("\n", count - 1);
    }
  }
  __name(writeFoldedLines, "writeFoldedLines");
  function readPlainScalar(state, nodeIndent, withinFlowCollection) {
    let captureStart;
    let captureEnd;
    let hasPendingContent;
    let _line;
    let _lineStart;
    let _lineIndent;
    const _kind = state.kind;
    const _result = state.result;
    let ch = state.input.charCodeAt(state.position);
    if (isWsOrEol(ch) || isFlowIndicator(ch) || ch === 35 || ch === 38 || ch === 42 || ch === 33 || ch === 124 || ch === 62 || ch === 39 || ch === 34 || ch === 37 || ch === 64 || ch === 96) {
      return false;
    }
    if (ch === 63 || ch === 45) {
      const following = state.input.charCodeAt(state.position + 1);
      if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
        return false;
      }
    }
    state.kind = "scalar";
    state.result = "";
    captureStart = captureEnd = state.position;
    hasPendingContent = false;
    while (ch !== 0) {
      if (ch === 58) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following) || withinFlowCollection && isFlowIndicator(following)) {
          break;
        }
      } else if (ch === 35) {
        const preceding = state.input.charCodeAt(state.position - 1);
        if (isWsOrEol(preceding)) {
          break;
        }
      } else if (state.position === state.lineStart && testDocumentSeparator(state) || withinFlowCollection && isFlowIndicator(ch)) {
        break;
      } else if (isEol(ch)) {
        _line = state.line;
        _lineStart = state.lineStart;
        _lineIndent = state.lineIndent;
        skipSeparationSpace(state, false, -1);
        if (state.lineIndent >= nodeIndent) {
          hasPendingContent = true;
          ch = state.input.charCodeAt(state.position);
          continue;
        } else {
          state.position = captureEnd;
          state.line = _line;
          state.lineStart = _lineStart;
          state.lineIndent = _lineIndent;
          break;
        }
      }
      if (hasPendingContent) {
        captureSegment(state, captureStart, captureEnd, false);
        writeFoldedLines(state, state.line - _line);
        captureStart = captureEnd = state.position;
        hasPendingContent = false;
      }
      if (!isWhiteSpace(ch)) {
        captureEnd = state.position + 1;
      }
      ch = state.input.charCodeAt(++state.position);
    }
    captureSegment(state, captureStart, captureEnd, false);
    if (state.result) {
      return true;
    }
    state.kind = _kind;
    state.result = _result;
    return false;
  }
  __name(readPlainScalar, "readPlainScalar");
  function readSingleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 39) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 39) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (ch === 39) {
          captureStart = state.position;
          state.position++;
          captureEnd = state.position;
        } else {
          return true;
        }
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a single quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a single quoted scalar");
  }
  __name(readSingleQuotedScalar, "readSingleQuotedScalar");
  function readDoubleQuotedScalar(state, nodeIndent) {
    let captureStart;
    let captureEnd;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 34) {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    state.position++;
    captureStart = captureEnd = state.position;
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      if (ch === 34) {
        captureSegment(state, captureStart, state.position, true);
        state.position++;
        return true;
      } else if (ch === 92) {
        captureSegment(state, captureStart, state.position, true);
        ch = state.input.charCodeAt(++state.position);
        if (isEol(ch)) {
          skipSeparationSpace(state, false, nodeIndent);
        } else if (ch < 256 && simpleEscapeCheck[ch]) {
          state.result += simpleEscapeMap[ch];
          state.position++;
        } else if ((tmp = escapedHexLen(ch)) > 0) {
          let hexLength = tmp;
          let hexResult = 0;
          for (; hexLength > 0; hexLength--) {
            ch = state.input.charCodeAt(++state.position);
            if ((tmp = fromHexCode(ch)) >= 0) {
              hexResult = (hexResult << 4) + tmp;
            } else {
              throwError(state, "expected hexadecimal character");
            }
          }
          state.result += charFromCodepoint(hexResult);
          state.position++;
        } else {
          throwError(state, "unknown escape sequence");
        }
        captureStart = captureEnd = state.position;
      } else if (isEol(ch)) {
        captureSegment(state, captureStart, captureEnd, true);
        writeFoldedLines(state, skipSeparationSpace(state, false, nodeIndent));
        captureStart = captureEnd = state.position;
      } else if (state.position === state.lineStart && testDocumentSeparator(state)) {
        throwError(state, "unexpected end of the document within a double quoted scalar");
      } else {
        state.position++;
        if (!isWhiteSpace(ch)) {
          captureEnd = state.position;
        }
      }
    }
    throwError(state, "unexpected end of the stream within a double quoted scalar");
  }
  __name(readDoubleQuotedScalar, "readDoubleQuotedScalar");
  function readFlowCollection(state, nodeIndent) {
    let readNext = true;
    let _line;
    let _lineStart;
    let _pos;
    const _tag = state.tag;
    let _result;
    const _anchor = state.anchor;
    let terminator;
    let isPair;
    let isExplicitPair;
    let isMapping;
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyNode;
    let keyTag;
    let valueNode;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 91) {
      terminator = 93;
      isMapping = false;
      _result = [];
    } else if (ch === 123) {
      terminator = 125;
      isMapping = true;
      _result = {};
    } else {
      return false;
    }
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    ch = state.input.charCodeAt(++state.position);
    while (ch !== 0) {
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === terminator) {
        state.position++;
        state.tag = _tag;
        state.anchor = _anchor;
        state.kind = isMapping ? "mapping" : "sequence";
        state.result = _result;
        return true;
      } else if (!readNext) {
        throwError(state, "missed comma between flow collection entries");
      } else if (ch === 44) {
        throwError(state, "expected the node content, but found ','");
      }
      keyTag = keyNode = valueNode = null;
      isPair = isExplicitPair = false;
      if (ch === 63) {
        const following = state.input.charCodeAt(state.position + 1);
        if (isWsOrEol(following)) {
          isPair = isExplicitPair = true;
          state.position++;
          skipSeparationSpace(state, true, nodeIndent);
        }
      }
      _line = state.line;
      _lineStart = state.lineStart;
      _pos = state.position;
      composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
      keyTag = state.tag;
      keyNode = state.result;
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if ((isExplicitPair || state.line === _line) && ch === 58) {
        isPair = true;
        ch = state.input.charCodeAt(++state.position);
        skipSeparationSpace(state, true, nodeIndent);
        composeNode(state, nodeIndent, CONTEXT_FLOW_IN, false, true);
        valueNode = state.result;
      }
      if (isMapping) {
        storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos);
      } else if (isPair) {
        _result.push(storeMappingPair(state, null, overridableKeys, keyTag, keyNode, valueNode, _line, _lineStart, _pos));
      } else {
        _result.push(keyNode);
      }
      skipSeparationSpace(state, true, nodeIndent);
      ch = state.input.charCodeAt(state.position);
      if (ch === 44) {
        readNext = true;
        ch = state.input.charCodeAt(++state.position);
      } else {
        readNext = false;
      }
    }
    throwError(state, "unexpected end of the stream within a flow collection");
  }
  __name(readFlowCollection, "readFlowCollection");
  function readBlockScalar(state, nodeIndent) {
    let folding;
    let chomping = CHOMPING_CLIP;
    let didReadContent = false;
    let detectedIndent = false;
    let textIndent = nodeIndent;
    let emptyLines = 0;
    let atMoreIndented = false;
    let tmp;
    let ch = state.input.charCodeAt(state.position);
    if (ch === 124) {
      folding = false;
    } else if (ch === 62) {
      folding = true;
    } else {
      return false;
    }
    state.kind = "scalar";
    state.result = "";
    while (ch !== 0) {
      ch = state.input.charCodeAt(++state.position);
      if (ch === 43 || ch === 45) {
        if (CHOMPING_CLIP === chomping) {
          chomping = ch === 43 ? CHOMPING_KEEP : CHOMPING_STRIP;
        } else {
          throwError(state, "repeat of a chomping mode identifier");
        }
      } else if ((tmp = fromDecimalCode(ch)) >= 0) {
        if (tmp === 0) {
          throwError(state, "bad explicit indentation width of a block scalar; it cannot be less than one");
        } else if (!detectedIndent) {
          textIndent = nodeIndent + tmp - 1;
          detectedIndent = true;
        } else {
          throwError(state, "repeat of an indentation width identifier");
        }
      } else {
        break;
      }
    }
    if (isWhiteSpace(ch)) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (isWhiteSpace(ch));
      if (ch === 35) {
        do {
          ch = state.input.charCodeAt(++state.position);
        } while (!isEol(ch) && ch !== 0);
      }
    }
    while (ch !== 0) {
      readLineBreak(state);
      state.lineIndent = 0;
      ch = state.input.charCodeAt(state.position);
      while ((!detectedIndent || state.lineIndent < textIndent) && ch === 32) {
        state.lineIndent++;
        ch = state.input.charCodeAt(++state.position);
      }
      if (!detectedIndent && state.lineIndent > textIndent) {
        textIndent = state.lineIndent;
      }
      if (isEol(ch)) {
        emptyLines++;
        continue;
      }
      if (!detectedIndent && textIndent === 0) {
        throwError(state, "missing indentation for block scalar");
      }
      if (state.lineIndent < textIndent) {
        if (chomping === CHOMPING_KEEP) {
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (chomping === CHOMPING_CLIP) {
          if (didReadContent) {
            state.result += "\n";
          }
        }
        break;
      }
      if (folding) {
        if (isWhiteSpace(ch)) {
          atMoreIndented = true;
          state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
        } else if (atMoreIndented) {
          atMoreIndented = false;
          state.result += common2.repeat("\n", emptyLines + 1);
        } else if (emptyLines === 0) {
          if (didReadContent) {
            state.result += " ";
          }
        } else {
          state.result += common2.repeat("\n", emptyLines);
        }
      } else {
        state.result += common2.repeat("\n", didReadContent ? 1 + emptyLines : emptyLines);
      }
      didReadContent = true;
      detectedIndent = true;
      emptyLines = 0;
      const captureStart = state.position;
      while (!isEol(ch) && ch !== 0) {
        ch = state.input.charCodeAt(++state.position);
      }
      captureSegment(state, captureStart, state.position, false);
    }
    return true;
  }
  __name(readBlockScalar, "readBlockScalar");
  function readBlockSequence(state, nodeIndent) {
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = [];
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      if (ch !== 45) {
        break;
      }
      const following = state.input.charCodeAt(state.position + 1);
      if (!isWsOrEol(following)) {
        break;
      }
      detected = true;
      state.position++;
      if (skipSeparationSpace(state, true, -1)) {
        if (state.lineIndent <= nodeIndent) {
          _result.push(null);
          ch = state.input.charCodeAt(state.position);
          continue;
        }
      }
      const _line = state.line;
      composeNode(state, nodeIndent, CONTEXT_BLOCK_IN, false, true);
      _result.push(state.result);
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a sequence entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "sequence";
      state.result = _result;
      return true;
    }
    return false;
  }
  __name(readBlockSequence, "readBlockSequence");
  function readBlockMapping(state, nodeIndent, flowIndent) {
    let allowCompact;
    let _keyLine;
    let _keyLineStart;
    let _keyPos;
    const _tag = state.tag;
    const _anchor = state.anchor;
    const _result = {};
    const overridableKeys = /* @__PURE__ */ Object.create(null);
    let keyTag = null;
    let keyNode = null;
    let valueNode = null;
    let atExplicitKey = false;
    let detected = false;
    if (state.firstTabInLine !== -1) return false;
    if (state.anchor !== null) {
      storeAnchor(state, state.anchor, _result);
    }
    let ch = state.input.charCodeAt(state.position);
    while (ch !== 0) {
      if (!atExplicitKey && state.firstTabInLine !== -1) {
        state.position = state.firstTabInLine;
        throwError(state, "tab characters must not be used in indentation");
      }
      const following = state.input.charCodeAt(state.position + 1);
      const _line = state.line;
      if ((ch === 63 || ch === 58) && isWsOrEol(following)) {
        if (ch === 63) {
          if (atExplicitKey) {
            storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
            keyTag = keyNode = valueNode = null;
          }
          detected = true;
          atExplicitKey = true;
          allowCompact = true;
        } else if (atExplicitKey) {
          atExplicitKey = false;
          allowCompact = true;
        } else {
          throwError(state, "incomplete explicit mapping pair; a key node is missed; or followed by a non-tabulated empty line");
        }
        state.position += 1;
        ch = following;
      } else {
        _keyLine = state.line;
        _keyLineStart = state.lineStart;
        _keyPos = state.position;
        if (!composeNode(state, flowIndent, CONTEXT_FLOW_OUT, false, true)) {
          break;
        }
        if (state.line === _line) {
          ch = state.input.charCodeAt(state.position);
          while (isWhiteSpace(ch)) {
            ch = state.input.charCodeAt(++state.position);
          }
          if (ch === 58) {
            ch = state.input.charCodeAt(++state.position);
            if (!isWsOrEol(ch)) {
              throwError(state, "a whitespace character is expected after the key-value separator within a block mapping");
            }
            if (atExplicitKey) {
              storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
              keyTag = keyNode = valueNode = null;
            }
            detected = true;
            atExplicitKey = false;
            allowCompact = false;
            keyTag = state.tag;
            keyNode = state.result;
          } else if (detected) {
            throwError(state, "can not read an implicit mapping pair; a colon is missed");
          } else {
            state.tag = _tag;
            state.anchor = _anchor;
            return true;
          }
        } else if (detected) {
          throwError(state, "can not read a block mapping entry; a multiline key may not be an implicit key");
        } else {
          state.tag = _tag;
          state.anchor = _anchor;
          return true;
        }
      }
      if (state.line === _line || state.lineIndent > nodeIndent) {
        if (atExplicitKey) {
          _keyLine = state.line;
          _keyLineStart = state.lineStart;
          _keyPos = state.position;
        }
        if (composeNode(state, nodeIndent, CONTEXT_BLOCK_OUT, true, allowCompact)) {
          if (atExplicitKey) {
            keyNode = state.result;
          } else {
            valueNode = state.result;
          }
        }
        if (!atExplicitKey) {
          storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, valueNode, _keyLine, _keyLineStart, _keyPos);
          keyTag = keyNode = valueNode = null;
        }
        skipSeparationSpace(state, true, -1);
        ch = state.input.charCodeAt(state.position);
      }
      if ((state.line === _line || state.lineIndent > nodeIndent) && ch !== 0) {
        throwError(state, "bad indentation of a mapping entry");
      } else if (state.lineIndent < nodeIndent) {
        break;
      }
    }
    if (atExplicitKey) {
      storeMappingPair(state, _result, overridableKeys, keyTag, keyNode, null, _keyLine, _keyLineStart, _keyPos);
    }
    if (detected) {
      state.tag = _tag;
      state.anchor = _anchor;
      state.kind = "mapping";
      state.result = _result;
    }
    return detected;
  }
  __name(readBlockMapping, "readBlockMapping");
  function readTagProperty(state) {
    let isVerbatim = false;
    let isNamed = false;
    let tagHandle;
    let tagName;
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 33) return false;
    if (state.tag !== null) {
      throwError(state, "duplication of a tag property");
    }
    ch = state.input.charCodeAt(++state.position);
    if (ch === 60) {
      isVerbatim = true;
      ch = state.input.charCodeAt(++state.position);
    } else if (ch === 33) {
      isNamed = true;
      tagHandle = "!!";
      ch = state.input.charCodeAt(++state.position);
    } else {
      tagHandle = "!";
    }
    let _position = state.position;
    if (isVerbatim) {
      do {
        ch = state.input.charCodeAt(++state.position);
      } while (ch !== 0 && ch !== 62);
      if (state.position < state.length) {
        tagName = state.input.slice(_position, state.position);
        ch = state.input.charCodeAt(++state.position);
      } else {
        throwError(state, "unexpected end of the stream within a verbatim tag");
      }
    } else {
      while (ch !== 0 && !isWsOrEol(ch)) {
        if (ch === 33) {
          if (!isNamed) {
            tagHandle = state.input.slice(_position - 1, state.position + 1);
            if (!PATTERN_TAG_HANDLE.test(tagHandle)) {
              throwError(state, "named tag handle cannot contain such characters");
            }
            isNamed = true;
            _position = state.position + 1;
          } else {
            throwError(state, "tag suffix cannot contain exclamation marks");
          }
        }
        ch = state.input.charCodeAt(++state.position);
      }
      tagName = state.input.slice(_position, state.position);
      if (PATTERN_FLOW_INDICATORS.test(tagName)) {
        throwError(state, "tag suffix cannot contain flow indicator characters");
      }
    }
    if (tagName && !PATTERN_TAG_URI.test(tagName)) {
      throwError(state, "tag name cannot contain such characters: " + tagName);
    }
    try {
      tagName = decodeURIComponent(tagName);
    } catch (err) {
      throwError(state, "tag name is malformed: " + tagName);
    }
    if (isVerbatim) {
      state.tag = tagName;
    } else if (_hasOwnProperty.call(state.tagMap, tagHandle)) {
      state.tag = state.tagMap[tagHandle] + tagName;
    } else if (tagHandle === "!") {
      state.tag = "!" + tagName;
    } else if (tagHandle === "!!") {
      state.tag = "tag:yaml.org,2002:" + tagName;
    } else {
      throwError(state, 'undeclared tag handle "' + tagHandle + '"');
    }
    return true;
  }
  __name(readTagProperty, "readTagProperty");
  function readAnchorProperty(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 38) return false;
    if (state.anchor !== null) {
      throwError(state, "duplication of an anchor property");
    }
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an anchor node must contain at least one character");
    }
    state.anchor = state.input.slice(_position, state.position);
    return true;
  }
  __name(readAnchorProperty, "readAnchorProperty");
  function readAlias(state) {
    let ch = state.input.charCodeAt(state.position);
    if (ch !== 42) return false;
    ch = state.input.charCodeAt(++state.position);
    const _position = state.position;
    while (ch !== 0 && !isWsOrEol(ch) && !isFlowIndicator(ch)) {
      ch = state.input.charCodeAt(++state.position);
    }
    if (state.position === _position) {
      throwError(state, "name of an alias node must contain at least one character");
    }
    const alias = state.input.slice(_position, state.position);
    if (!_hasOwnProperty.call(state.anchorMap, alias)) {
      throwError(state, 'unidentified alias "' + alias + '"');
    }
    state.result = state.anchorMap[alias];
    skipSeparationSpace(state, true, -1);
    return true;
  }
  __name(readAlias, "readAlias");
  function tryReadBlockMappingFromProperty(state, propertyStart, nodeIndent, flowIndent) {
    const fallbackState = snapshotState(state);
    beginAnchorTransaction(state);
    restoreState(state, propertyStart);
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    if (readBlockMapping(state, nodeIndent, flowIndent) && state.kind === "mapping") {
      commitAnchorTransaction(state);
      return true;
    }
    rollbackAnchorTransaction(state);
    restoreState(state, fallbackState);
    return false;
  }
  __name(tryReadBlockMappingFromProperty, "tryReadBlockMappingFromProperty");
  function composeNode(state, parentIndent, nodeContext, allowToSeek, allowCompact) {
    let allowBlockScalars;
    let allowBlockCollections;
    let indentStatus = 1;
    let atNewLine = false;
    let hasContent = false;
    let propertyStart = null;
    let type2;
    let flowIndent;
    let blockIndent;
    if (state.depth >= state.maxDepth) {
      throwError(state, "nesting exceeded maxDepth (" + state.maxDepth + ")");
    }
    state.depth += 1;
    if (state.listener !== null) {
      state.listener("open", state);
    }
    state.tag = null;
    state.anchor = null;
    state.kind = null;
    state.result = null;
    const allowBlockStyles = allowBlockScalars = allowBlockCollections = CONTEXT_BLOCK_OUT === nodeContext || CONTEXT_BLOCK_IN === nodeContext;
    if (allowToSeek) {
      if (skipSeparationSpace(state, true, -1)) {
        atNewLine = true;
        if (state.lineIndent > parentIndent) {
          indentStatus = 1;
        } else if (state.lineIndent === parentIndent) {
          indentStatus = 0;
        } else if (state.lineIndent < parentIndent) {
          indentStatus = -1;
        }
      }
    }
    if (indentStatus === 1) {
      while (true) {
        const ch = state.input.charCodeAt(state.position);
        const propertyState = snapshotState(state);
        if (atNewLine && (ch === 33 && state.tag !== null || ch === 38 && state.anchor !== null)) {
          break;
        }
        if (!readTagProperty(state) && !readAnchorProperty(state)) {
          break;
        }
        if (propertyStart === null) {
          propertyStart = propertyState;
        }
        if (skipSeparationSpace(state, true, -1)) {
          atNewLine = true;
          allowBlockCollections = allowBlockStyles;
          if (state.lineIndent > parentIndent) {
            indentStatus = 1;
          } else if (state.lineIndent === parentIndent) {
            indentStatus = 0;
          } else if (state.lineIndent < parentIndent) {
            indentStatus = -1;
          }
        } else {
          allowBlockCollections = false;
        }
      }
    }
    if (allowBlockCollections) {
      allowBlockCollections = atNewLine || allowCompact;
    }
    if (indentStatus === 1 || CONTEXT_BLOCK_OUT === nodeContext) {
      if (CONTEXT_FLOW_IN === nodeContext || CONTEXT_FLOW_OUT === nodeContext) {
        flowIndent = parentIndent;
      } else {
        flowIndent = parentIndent + 1;
      }
      blockIndent = state.position - state.lineStart;
      if (indentStatus === 1) {
        if (allowBlockCollections && (readBlockSequence(state, blockIndent) || readBlockMapping(state, blockIndent, flowIndent)) || readFlowCollection(state, flowIndent)) {
          hasContent = true;
        } else {
          const ch = state.input.charCodeAt(state.position);
          if (propertyStart !== null && allowBlockStyles && !allowBlockCollections && ch !== 124 && ch !== 62 && tryReadBlockMappingFromProperty(
            state,
            propertyStart,
            propertyStart.position - propertyStart.lineStart,
            flowIndent
          )) {
            hasContent = true;
          } else if (allowBlockScalars && readBlockScalar(state, flowIndent) || readSingleQuotedScalar(state, flowIndent) || readDoubleQuotedScalar(state, flowIndent)) {
            hasContent = true;
          } else if (readAlias(state)) {
            hasContent = true;
            if (state.tag !== null || state.anchor !== null) {
              throwError(state, "alias node should not have any properties");
            }
          } else if (readPlainScalar(state, flowIndent, CONTEXT_FLOW_IN === nodeContext)) {
            hasContent = true;
            if (state.tag === null) {
              state.tag = "?";
            }
          }
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
        }
      } else if (indentStatus === 0) {
        hasContent = allowBlockCollections && readBlockSequence(state, blockIndent);
      }
    }
    if (state.tag === null) {
      if (state.anchor !== null) {
        storeAnchor(state, state.anchor, state.result);
      }
    } else if (state.tag === "?") {
      if (state.result !== null && state.kind !== "scalar") {
        throwError(state, 'unacceptable node kind for !<?> tag; it should be "scalar", not "' + state.kind + '"');
      }
      for (let typeIndex = 0, typeQuantity = state.implicitTypes.length; typeIndex < typeQuantity; typeIndex += 1) {
        type2 = state.implicitTypes[typeIndex];
        if (type2.resolve(state.result)) {
          state.result = type2.construct(state.result);
          state.tag = type2.tag;
          if (state.anchor !== null) {
            storeAnchor(state, state.anchor, state.result);
          }
          break;
        }
      }
    } else if (state.tag !== "!") {
      if (_hasOwnProperty.call(state.typeMap[state.kind || "fallback"], state.tag)) {
        type2 = state.typeMap[state.kind || "fallback"][state.tag];
      } else {
        type2 = null;
        const typeList = state.typeMap.multi[state.kind || "fallback"];
        for (let typeIndex = 0, typeQuantity = typeList.length; typeIndex < typeQuantity; typeIndex += 1) {
          if (state.tag.slice(0, typeList[typeIndex].tag.length) === typeList[typeIndex].tag) {
            type2 = typeList[typeIndex];
            break;
          }
        }
      }
      if (!type2) {
        throwError(state, "unknown tag !<" + state.tag + ">");
      }
      if (state.result !== null && type2.kind !== state.kind) {
        throwError(state, "unacceptable node kind for !<" + state.tag + '> tag; it should be "' + type2.kind + '", not "' + state.kind + '"');
      }
      if (!type2.resolve(state.result, state.tag)) {
        throwError(state, "cannot resolve a node with !<" + state.tag + "> explicit tag");
      } else {
        state.result = type2.construct(state.result, state.tag);
        if (state.anchor !== null) {
          storeAnchor(state, state.anchor, state.result);
        }
      }
    }
    if (state.listener !== null) {
      state.listener("close", state);
    }
    state.depth -= 1;
    return state.tag !== null || state.anchor !== null || hasContent;
  }
  __name(composeNode, "composeNode");
  function readDocument(state) {
    const documentStart = state.position;
    let hasDirectives = false;
    let ch;
    state.version = null;
    state.checkLineBreaks = state.legacy;
    state.tagMap = /* @__PURE__ */ Object.create(null);
    state.anchorMap = /* @__PURE__ */ Object.create(null);
    while ((ch = state.input.charCodeAt(state.position)) !== 0) {
      skipSeparationSpace(state, true, -1);
      ch = state.input.charCodeAt(state.position);
      if (state.lineIndent > 0 || ch !== 37) {
        break;
      }
      hasDirectives = true;
      ch = state.input.charCodeAt(++state.position);
      let _position = state.position;
      while (ch !== 0 && !isWsOrEol(ch)) {
        ch = state.input.charCodeAt(++state.position);
      }
      const directiveName = state.input.slice(_position, state.position);
      const directiveArgs = [];
      if (directiveName.length < 1) {
        throwError(state, "directive name must not be less than one character in length");
      }
      while (ch !== 0) {
        while (isWhiteSpace(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        if (ch === 35) {
          do {
            ch = state.input.charCodeAt(++state.position);
          } while (ch !== 0 && !isEol(ch));
          break;
        }
        if (isEol(ch)) break;
        _position = state.position;
        while (ch !== 0 && !isWsOrEol(ch)) {
          ch = state.input.charCodeAt(++state.position);
        }
        directiveArgs.push(state.input.slice(_position, state.position));
      }
      if (ch !== 0) readLineBreak(state);
      if (_hasOwnProperty.call(directiveHandlers, directiveName)) {
        directiveHandlers[directiveName](state, directiveName, directiveArgs);
      } else {
        throwWarning(state, 'unknown document directive "' + directiveName + '"');
      }
    }
    skipSeparationSpace(state, true, -1);
    if (state.lineIndent === 0 && state.input.charCodeAt(state.position) === 45 && state.input.charCodeAt(state.position + 1) === 45 && state.input.charCodeAt(state.position + 2) === 45) {
      state.position += 3;
      skipSeparationSpace(state, true, -1);
    } else if (hasDirectives) {
      throwError(state, "directives end mark is expected");
    }
    composeNode(state, state.lineIndent - 1, CONTEXT_BLOCK_OUT, false, true);
    skipSeparationSpace(state, true, -1);
    if (state.checkLineBreaks && PATTERN_NON_ASCII_LINE_BREAKS.test(state.input.slice(documentStart, state.position))) {
      throwWarning(state, "non-ASCII line breaks are interpreted as content");
    }
    state.documents.push(state.result);
    if (state.position === state.lineStart && testDocumentSeparator(state)) {
      if (state.input.charCodeAt(state.position) === 46) {
        state.position += 3;
        skipSeparationSpace(state, true, -1);
      }
      return;
    }
    if (state.position < state.length - 1) {
      throwError(state, "end of the stream or a document separator is expected");
    }
  }
  __name(readDocument, "readDocument");
  function loadDocuments(input, options) {
    input = String(input);
    options = options || {};
    if (input.length !== 0) {
      if (input.charCodeAt(input.length - 1) !== 10 && input.charCodeAt(input.length - 1) !== 13) {
        input += "\n";
      }
      if (input.charCodeAt(0) === 65279) {
        input = input.slice(1);
      }
    }
    const state = new State(input, options);
    const nullpos = input.indexOf("\0");
    if (nullpos !== -1) {
      state.position = nullpos;
      throwError(state, "null byte is not allowed in input");
    }
    state.input += "\0";
    while (state.input.charCodeAt(state.position) === 32) {
      state.lineIndent += 1;
      state.position += 1;
    }
    while (state.position < state.length - 1) {
      readDocument(state);
    }
    return state.documents;
  }
  __name(loadDocuments, "loadDocuments");
  function loadAll2(input, iterator, options) {
    if (iterator !== null && typeof iterator === "object" && typeof options === "undefined") {
      options = iterator;
      iterator = null;
    }
    const documents = loadDocuments(input, options);
    if (typeof iterator !== "function") {
      return documents;
    }
    for (let index = 0, length = documents.length; index < length; index += 1) {
      iterator(documents[index]);
    }
  }
  __name(loadAll2, "loadAll2");
  function load2(input, options) {
    const documents = loadDocuments(input, options);
    if (documents.length === 0) {
      return void 0;
    } else if (documents.length === 1) {
      return documents[0];
    }
    throw new YAMLException2("expected a single document in the stream, but found more");
  }
  __name(load2, "load2");
  loader.loadAll = loadAll2;
  loader.load = load2;
  return loader;
}
__name(requireLoader, "requireLoader");
var dumper = {};
var hasRequiredDumper;
function requireDumper() {
  if (hasRequiredDumper) return dumper;
  hasRequiredDumper = 1;
  const common2 = requireCommon();
  const YAMLException2 = requireException();
  const DEFAULT_SCHEMA2 = require_default();
  const _toString = Object.prototype.toString;
  const _hasOwnProperty = Object.prototype.hasOwnProperty;
  const CHAR_BOM = 65279;
  const CHAR_TAB = 9;
  const CHAR_LINE_FEED = 10;
  const CHAR_CARRIAGE_RETURN = 13;
  const CHAR_SPACE = 32;
  const CHAR_EXCLAMATION = 33;
  const CHAR_DOUBLE_QUOTE = 34;
  const CHAR_SHARP = 35;
  const CHAR_PERCENT = 37;
  const CHAR_AMPERSAND = 38;
  const CHAR_SINGLE_QUOTE = 39;
  const CHAR_ASTERISK = 42;
  const CHAR_COMMA = 44;
  const CHAR_MINUS = 45;
  const CHAR_COLON = 58;
  const CHAR_EQUALS = 61;
  const CHAR_GREATER_THAN = 62;
  const CHAR_QUESTION = 63;
  const CHAR_COMMERCIAL_AT = 64;
  const CHAR_LEFT_SQUARE_BRACKET = 91;
  const CHAR_RIGHT_SQUARE_BRACKET = 93;
  const CHAR_GRAVE_ACCENT = 96;
  const CHAR_LEFT_CURLY_BRACKET = 123;
  const CHAR_VERTICAL_LINE = 124;
  const CHAR_RIGHT_CURLY_BRACKET = 125;
  const ESCAPE_SEQUENCES = {};
  ESCAPE_SEQUENCES[0] = "\\0";
  ESCAPE_SEQUENCES[7] = "\\a";
  ESCAPE_SEQUENCES[8] = "\\b";
  ESCAPE_SEQUENCES[9] = "\\t";
  ESCAPE_SEQUENCES[10] = "\\n";
  ESCAPE_SEQUENCES[11] = "\\v";
  ESCAPE_SEQUENCES[12] = "\\f";
  ESCAPE_SEQUENCES[13] = "\\r";
  ESCAPE_SEQUENCES[27] = "\\e";
  ESCAPE_SEQUENCES[34] = '\\"';
  ESCAPE_SEQUENCES[92] = "\\\\";
  ESCAPE_SEQUENCES[133] = "\\N";
  ESCAPE_SEQUENCES[160] = "\\_";
  ESCAPE_SEQUENCES[8232] = "\\L";
  ESCAPE_SEQUENCES[8233] = "\\P";
  const DEPRECATED_BOOLEANS_SYNTAX = [
    "y",
    "Y",
    "yes",
    "Yes",
    "YES",
    "on",
    "On",
    "ON",
    "n",
    "N",
    "no",
    "No",
    "NO",
    "off",
    "Off",
    "OFF"
  ];
  const DEPRECATED_BASE60_SYNTAX = /^[-+]?[0-9_]+(?::[0-9_]+)+(?:\.[0-9_]*)?$/;
  function compileStyleMap(schema2, map2) {
    if (map2 === null) return {};
    const result = {};
    const keys = Object.keys(map2);
    for (let index = 0, length = keys.length; index < length; index += 1) {
      let tag = keys[index];
      let style = String(map2[tag]);
      if (tag.slice(0, 2) === "!!") {
        tag = "tag:yaml.org,2002:" + tag.slice(2);
      }
      const type2 = schema2.compiledTypeMap["fallback"][tag];
      if (type2 && _hasOwnProperty.call(type2.styleAliases, style)) {
        style = type2.styleAliases[style];
      }
      result[tag] = style;
    }
    return result;
  }
  __name(compileStyleMap, "compileStyleMap");
  function encodeHex(character) {
    let handle;
    let length;
    const string = character.toString(16).toUpperCase();
    if (character <= 255) {
      handle = "x";
      length = 2;
    } else if (character <= 65535) {
      handle = "u";
      length = 4;
    } else if (character <= 4294967295) {
      handle = "U";
      length = 8;
    } else {
      throw new YAMLException2("code point within a string may not be greater than 0xFFFFFFFF");
    }
    return "\\" + handle + common2.repeat("0", length - string.length) + string;
  }
  __name(encodeHex, "encodeHex");
  const QUOTING_TYPE_SINGLE = 1;
  const QUOTING_TYPE_DOUBLE = 2;
  function State(options) {
    this.schema = options["schema"] || DEFAULT_SCHEMA2;
    this.indent = Math.max(1, options["indent"] || 2);
    this.noArrayIndent = options["noArrayIndent"] || false;
    this.skipInvalid = options["skipInvalid"] || false;
    this.flowLevel = common2.isNothing(options["flowLevel"]) ? -1 : options["flowLevel"];
    this.styleMap = compileStyleMap(this.schema, options["styles"] || null);
    this.sortKeys = options["sortKeys"] || false;
    this.lineWidth = options["lineWidth"] || 80;
    this.noRefs = options["noRefs"] || false;
    this.noCompatMode = options["noCompatMode"] || false;
    this.condenseFlow = options["condenseFlow"] || false;
    this.quotingType = options["quotingType"] === '"' ? QUOTING_TYPE_DOUBLE : QUOTING_TYPE_SINGLE;
    this.forceQuotes = options["forceQuotes"] || false;
    this.replacer = typeof options["replacer"] === "function" ? options["replacer"] : null;
    this.implicitTypes = this.schema.compiledImplicit;
    this.explicitTypes = this.schema.compiledExplicit;
    this.tag = null;
    this.result = "";
    this.duplicates = [];
    this.usedDuplicates = null;
  }
  __name(State, "State");
  function indentString(string, spaces) {
    const ind = common2.repeat(" ", spaces);
    let position = 0;
    let result = "";
    const length = string.length;
    while (position < length) {
      let line;
      const next = string.indexOf("\n", position);
      if (next === -1) {
        line = string.slice(position);
        position = length;
      } else {
        line = string.slice(position, next + 1);
        position = next + 1;
      }
      if (line.length && line !== "\n") result += ind;
      result += line;
    }
    return result;
  }
  __name(indentString, "indentString");
  function generateNextLine(state, level) {
    return "\n" + common2.repeat(" ", state.indent * level);
  }
  __name(generateNextLine, "generateNextLine");
  function testImplicitResolving(state, str2) {
    for (let index = 0, length = state.implicitTypes.length; index < length; index += 1) {
      const type2 = state.implicitTypes[index];
      if (type2.resolve(str2)) {
        return true;
      }
    }
    return false;
  }
  __name(testImplicitResolving, "testImplicitResolving");
  function isWhitespace(c) {
    return c === CHAR_SPACE || c === CHAR_TAB;
  }
  __name(isWhitespace, "isWhitespace");
  function isPrintable(c) {
    return c >= 32 && c <= 126 || c >= 161 && c <= 55295 && c !== 8232 && c !== 8233 || c >= 57344 && c <= 65533 && c !== CHAR_BOM || c >= 65536 && c <= 1114111;
  }
  __name(isPrintable, "isPrintable");
  function isNsCharOrWhitespace(c) {
    return isPrintable(c) && c !== CHAR_BOM && // - b-char
    c !== CHAR_CARRIAGE_RETURN && c !== CHAR_LINE_FEED;
  }
  __name(isNsCharOrWhitespace, "isNsCharOrWhitespace");
  function isPlainSafe(c, prev, inblock) {
    const cIsNsCharOrWhitespace = isNsCharOrWhitespace(c);
    const cIsNsChar = cIsNsCharOrWhitespace && !isWhitespace(c);
    return (
      // ns-plain-safe
      (inblock ? cIsNsCharOrWhitespace : cIsNsCharOrWhitespace && // - c-flow-indicator
      c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET) && // ns-plain-char
      c !== CHAR_SHARP && // false on '#'
      !(prev === CHAR_COLON && !cIsNsChar) || // false on ': '
      isNsCharOrWhitespace(prev) && !isWhitespace(prev) && c === CHAR_SHARP || // change to true on '[^ ]#'
      prev === CHAR_COLON && cIsNsChar
    );
  }
  __name(isPlainSafe, "isPlainSafe");
  function isPlainSafeFirst(c) {
    return isPrintable(c) && c !== CHAR_BOM && !isWhitespace(c) && // - s-white
    // - (c-indicator ::=
    // “-” | “?” | “:” | “,” | “[” | “]” | “{” | “}”
    c !== CHAR_MINUS && c !== CHAR_QUESTION && c !== CHAR_COLON && c !== CHAR_COMMA && c !== CHAR_LEFT_SQUARE_BRACKET && c !== CHAR_RIGHT_SQUARE_BRACKET && c !== CHAR_LEFT_CURLY_BRACKET && c !== CHAR_RIGHT_CURLY_BRACKET && // | “#” | “&” | “*” | “!” | “|” | “=” | “>” | “'” | “"”
    c !== CHAR_SHARP && c !== CHAR_AMPERSAND && c !== CHAR_ASTERISK && c !== CHAR_EXCLAMATION && c !== CHAR_VERTICAL_LINE && c !== CHAR_EQUALS && c !== CHAR_GREATER_THAN && c !== CHAR_SINGLE_QUOTE && c !== CHAR_DOUBLE_QUOTE && // | “%” | “@” | “`”)
    c !== CHAR_PERCENT && c !== CHAR_COMMERCIAL_AT && c !== CHAR_GRAVE_ACCENT;
  }
  __name(isPlainSafeFirst, "isPlainSafeFirst");
  function isPlainSafeLast(c) {
    return !isWhitespace(c) && c !== CHAR_COLON;
  }
  __name(isPlainSafeLast, "isPlainSafeLast");
  function codePointAt(string, pos) {
    const first = string.charCodeAt(pos);
    let second;
    if (first >= 55296 && first <= 56319 && pos + 1 < string.length) {
      second = string.charCodeAt(pos + 1);
      if (second >= 56320 && second <= 57343) {
        return (first - 55296) * 1024 + second - 56320 + 65536;
      }
    }
    return first;
  }
  __name(codePointAt, "codePointAt");
  function needIndentIndicator(string) {
    const leadingSpaceRe = /^\n* /;
    return leadingSpaceRe.test(string);
  }
  __name(needIndentIndicator, "needIndentIndicator");
  const STYLE_PLAIN = 1;
  const STYLE_SINGLE = 2;
  const STYLE_LITERAL = 3;
  const STYLE_FOLDED = 4;
  const STYLE_DOUBLE = 5;
  function chooseScalarStyle(string, singleLineOnly, indentPerLevel, lineWidth, testAmbiguousType, quotingType, forceQuotes, inblock) {
    let i;
    let char = 0;
    let prevChar = null;
    let hasLineBreak = false;
    let hasFoldableLine = false;
    const shouldTrackWidth = lineWidth !== -1;
    let previousLineBreak = -1;
    let plain = isPlainSafeFirst(codePointAt(string, 0)) && isPlainSafeLast(codePointAt(string, string.length - 1));
    if (singleLineOnly || forceQuotes) {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
    } else {
      for (i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
        char = codePointAt(string, i);
        if (char === CHAR_LINE_FEED) {
          hasLineBreak = true;
          if (shouldTrackWidth) {
            hasFoldableLine = hasFoldableLine || // Foldable line = too long, and not more-indented.
            i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ";
            previousLineBreak = i;
          }
        } else if (!isPrintable(char)) {
          return STYLE_DOUBLE;
        }
        plain = plain && isPlainSafe(char, prevChar, inblock);
        prevChar = char;
      }
      hasFoldableLine = hasFoldableLine || shouldTrackWidth && (i - previousLineBreak - 1 > lineWidth && string[previousLineBreak + 1] !== " ");
    }
    if (!hasLineBreak && !hasFoldableLine) {
      if (plain && !forceQuotes && !testAmbiguousType(string)) {
        return STYLE_PLAIN;
      }
      return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
    }
    if (indentPerLevel > 9 && needIndentIndicator(string)) {
      return STYLE_DOUBLE;
    }
    if (!forceQuotes) {
      return hasFoldableLine ? STYLE_FOLDED : STYLE_LITERAL;
    }
    return quotingType === QUOTING_TYPE_DOUBLE ? STYLE_DOUBLE : STYLE_SINGLE;
  }
  __name(chooseScalarStyle, "chooseScalarStyle");
  function writeScalar(state, string, level, iskey, inblock) {
    state.dump = (function() {
      if (string.length === 0) {
        return state.quotingType === QUOTING_TYPE_DOUBLE ? '""' : "''";
      }
      if (!state.noCompatMode) {
        if (DEPRECATED_BOOLEANS_SYNTAX.indexOf(string) !== -1 || DEPRECATED_BASE60_SYNTAX.test(string)) {
          return state.quotingType === QUOTING_TYPE_DOUBLE ? '"' + string + '"' : "'" + string + "'";
        }
      }
      const indent = state.indent * Math.max(1, level);
      const lineWidth = state.lineWidth === -1 ? -1 : Math.max(Math.min(state.lineWidth, 40), state.lineWidth - indent);
      const singleLineOnly = iskey || // No block styles in flow mode.
      state.flowLevel > -1 && level >= state.flowLevel;
      function testAmbiguity(string2) {
        return testImplicitResolving(state, string2);
      }
      __name(testAmbiguity, "testAmbiguity");
      switch (chooseScalarStyle(
        string,
        singleLineOnly,
        state.indent,
        lineWidth,
        testAmbiguity,
        state.quotingType,
        state.forceQuotes && !iskey,
        inblock
      )) {
        case STYLE_PLAIN:
          return string;
        case STYLE_SINGLE:
          return "'" + string.replace(/'/g, "''") + "'";
        case STYLE_LITERAL:
          return "|" + blockHeader(string, state.indent) + dropEndingNewline(indentString(string, indent));
        case STYLE_FOLDED:
          return ">" + blockHeader(string, state.indent) + dropEndingNewline(indentString(foldString(string, lineWidth), indent));
        case STYLE_DOUBLE:
          return '"' + escapeString(string) + '"';
        default:
          throw new YAMLException2("impossible error: invalid scalar style");
      }
    })();
  }
  __name(writeScalar, "writeScalar");
  function blockHeader(string, indentPerLevel) {
    const indentIndicator = needIndentIndicator(string) ? String(indentPerLevel) : "";
    const clip = string[string.length - 1] === "\n";
    const keep = clip && (string[string.length - 2] === "\n" || string === "\n");
    const chomp = keep ? "+" : clip ? "" : "-";
    return indentIndicator + chomp + "\n";
  }
  __name(blockHeader, "blockHeader");
  function dropEndingNewline(string) {
    return string[string.length - 1] === "\n" ? string.slice(0, -1) : string;
  }
  __name(dropEndingNewline, "dropEndingNewline");
  function foldString(string, width) {
    const lineRe = /(\n+)([^\n]*)/g;
    let result = (function() {
      let nextLF = string.indexOf("\n");
      nextLF = nextLF !== -1 ? nextLF : string.length;
      lineRe.lastIndex = nextLF;
      return foldLine(string.slice(0, nextLF), width);
    })();
    let prevMoreIndented = string[0] === "\n" || string[0] === " ";
    let moreIndented;
    let match;
    while (match = lineRe.exec(string)) {
      const prefix = match[1];
      const line = match[2];
      moreIndented = line[0] === " ";
      result += prefix + (!prevMoreIndented && !moreIndented && line !== "" ? "\n" : "") + foldLine(line, width);
      prevMoreIndented = moreIndented;
    }
    return result;
  }
  __name(foldString, "foldString");
  function foldLine(line, width) {
    if (line === "" || line[0] === " ") return line;
    const breakRe = / [^ ]/g;
    let match;
    let start = 0;
    let end;
    let curr = 0;
    let next = 0;
    let result = "";
    while (match = breakRe.exec(line)) {
      next = match.index;
      if (next - start > width) {
        end = curr > start ? curr : next;
        result += "\n" + line.slice(start, end);
        start = end + 1;
      }
      curr = next;
    }
    result += "\n";
    if (line.length - start > width && curr > start) {
      result += line.slice(start, curr) + "\n" + line.slice(curr + 1);
    } else {
      result += line.slice(start);
    }
    return result.slice(1);
  }
  __name(foldLine, "foldLine");
  function escapeString(string) {
    let result = "";
    let char = 0;
    for (let i = 0; i < string.length; char >= 65536 ? i += 2 : i++) {
      char = codePointAt(string, i);
      const escapeSeq = ESCAPE_SEQUENCES[char];
      if (!escapeSeq && isPrintable(char)) {
        result += string[i];
        if (char >= 65536) result += string[i + 1];
      } else {
        result += escapeSeq || encodeHex(char);
      }
    }
    return result;
  }
  __name(escapeString, "escapeString");
  function writeFlowSequence(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level, value, false, false) || typeof value === "undefined" && writeNode(state, level, null, false, false)) {
        if (_result !== "") _result += "," + (!state.condenseFlow ? " " : "");
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = "[" + _result + "]";
  }
  __name(writeFlowSequence, "writeFlowSequence");
  function writeBlockSequence(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    for (let index = 0, length = object.length; index < length; index += 1) {
      let value = object[index];
      if (state.replacer) {
        value = state.replacer.call(object, String(index), value);
      }
      if (writeNode(state, level + 1, value, true, true, false, true) || typeof value === "undefined" && writeNode(state, level + 1, null, true, true, false, true)) {
        if (!compact || _result !== "") {
          _result += generateNextLine(state, level);
        }
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          _result += "-";
        } else {
          _result += "- ";
        }
        _result += state.dump;
      }
    }
    state.tag = _tag;
    state.dump = _result || "[]";
  }
  __name(writeBlockSequence, "writeBlockSequence");
  function writeFlowMapping(state, level, object) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (_result !== "") pairBuffer += ", ";
      if (state.condenseFlow) pairBuffer += '"';
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level, objectKey, false, false)) {
        continue;
      }
      if (state.dump.length > 1024) pairBuffer += "? ";
      pairBuffer += state.dump + (state.condenseFlow ? '"' : "") + ":" + (state.condenseFlow ? "" : " ");
      if (!writeNode(state, level, objectValue, false, false)) {
        continue;
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = "{" + _result + "}";
  }
  __name(writeFlowMapping, "writeFlowMapping");
  function writeBlockMapping(state, level, object, compact) {
    let _result = "";
    const _tag = state.tag;
    const objectKeyList = Object.keys(object);
    if (state.sortKeys === true) {
      objectKeyList.sort();
    } else if (typeof state.sortKeys === "function") {
      objectKeyList.sort(state.sortKeys);
    } else if (state.sortKeys) {
      throw new YAMLException2("sortKeys must be a boolean or a function");
    }
    for (let index = 0, length = objectKeyList.length; index < length; index += 1) {
      let pairBuffer = "";
      if (!compact || _result !== "") {
        pairBuffer += generateNextLine(state, level);
      }
      const objectKey = objectKeyList[index];
      let objectValue = object[objectKey];
      if (state.replacer) {
        objectValue = state.replacer.call(object, objectKey, objectValue);
      }
      if (!writeNode(state, level + 1, objectKey, true, true, true)) {
        continue;
      }
      const explicitPair = state.tag !== null && state.tag !== "?" || state.dump && state.dump.length > 1024;
      if (explicitPair) {
        if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
          pairBuffer += "?";
        } else {
          pairBuffer += "? ";
        }
      }
      pairBuffer += state.dump;
      if (explicitPair) {
        pairBuffer += generateNextLine(state, level);
      }
      if (!writeNode(state, level + 1, objectValue, true, explicitPair)) {
        continue;
      }
      if (state.dump && CHAR_LINE_FEED === state.dump.charCodeAt(0)) {
        pairBuffer += ":";
      } else {
        pairBuffer += ": ";
      }
      pairBuffer += state.dump;
      _result += pairBuffer;
    }
    state.tag = _tag;
    state.dump = _result || "{}";
  }
  __name(writeBlockMapping, "writeBlockMapping");
  function detectType(state, object, explicit) {
    const typeList = explicit ? state.explicitTypes : state.implicitTypes;
    for (let index = 0, length = typeList.length; index < length; index += 1) {
      const type2 = typeList[index];
      if ((type2.instanceOf || type2.predicate) && (!type2.instanceOf || typeof object === "object" && object instanceof type2.instanceOf) && (!type2.predicate || type2.predicate(object))) {
        if (explicit) {
          if (type2.multi && type2.representName) {
            state.tag = type2.representName(object);
          } else {
            state.tag = type2.tag;
          }
        } else {
          state.tag = "?";
        }
        if (type2.represent) {
          const style = state.styleMap[type2.tag] || type2.defaultStyle;
          let _result;
          if (_toString.call(type2.represent) === "[object Function]") {
            _result = type2.represent(object, style);
          } else if (_hasOwnProperty.call(type2.represent, style)) {
            _result = type2.represent[style](object, style);
          } else {
            throw new YAMLException2("!<" + type2.tag + '> tag resolver accepts not "' + style + '" style');
          }
          state.dump = _result;
        }
        return true;
      }
    }
    return false;
  }
  __name(detectType, "detectType");
  function writeNode(state, level, object, block, compact, iskey, isblockseq) {
    state.tag = null;
    state.dump = object;
    if (!detectType(state, object, false)) {
      detectType(state, object, true);
    }
    const type2 = _toString.call(state.dump);
    const inblock = block;
    if (block) {
      block = state.flowLevel < 0 || state.flowLevel > level;
    }
    const objectOrArray = type2 === "[object Object]" || type2 === "[object Array]";
    let duplicateIndex;
    let duplicate;
    if (objectOrArray) {
      duplicateIndex = state.duplicates.indexOf(object);
      duplicate = duplicateIndex !== -1;
    }
    if (state.tag !== null && state.tag !== "?" || duplicate || state.indent !== 2 && level > 0) {
      compact = false;
    }
    if (duplicate && state.usedDuplicates[duplicateIndex]) {
      state.dump = "*ref_" + duplicateIndex;
    } else {
      if (objectOrArray && duplicate && !state.usedDuplicates[duplicateIndex]) {
        state.usedDuplicates[duplicateIndex] = true;
      }
      if (type2 === "[object Object]") {
        if (block && Object.keys(state.dump).length !== 0) {
          writeBlockMapping(state, level, state.dump, compact);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowMapping(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object Array]") {
        if (block && state.dump.length !== 0) {
          if (state.noArrayIndent && !isblockseq && level > 0) {
            writeBlockSequence(state, level - 1, state.dump, compact);
          } else {
            writeBlockSequence(state, level, state.dump, compact);
          }
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + state.dump;
          }
        } else {
          writeFlowSequence(state, level, state.dump);
          if (duplicate) {
            state.dump = "&ref_" + duplicateIndex + " " + state.dump;
          }
        }
      } else if (type2 === "[object String]") {
        if (state.tag !== "?") {
          writeScalar(state, state.dump, level, iskey, inblock);
        }
      } else if (type2 === "[object Undefined]") {
        return false;
      } else {
        if (state.skipInvalid) return false;
        throw new YAMLException2("unacceptable kind of an object to dump " + type2);
      }
      if (state.tag !== null && state.tag !== "?") {
        let tagStr = encodeURI(
          state.tag[0] === "!" ? state.tag.slice(1) : state.tag
        ).replace(/!/g, "%21");
        if (state.tag[0] === "!") {
          tagStr = "!" + tagStr;
        } else if (tagStr.slice(0, 18) === "tag:yaml.org,2002:") {
          tagStr = "!!" + tagStr.slice(18);
        } else {
          tagStr = "!<" + tagStr + ">";
        }
        state.dump = tagStr + " " + state.dump;
      }
    }
    return true;
  }
  __name(writeNode, "writeNode");
  function getDuplicateReferences(object, state) {
    const objects = [];
    const duplicatesIndexes = [];
    inspectNode(object, objects, duplicatesIndexes);
    const length = duplicatesIndexes.length;
    for (let index = 0; index < length; index += 1) {
      state.duplicates.push(objects[duplicatesIndexes[index]]);
    }
    state.usedDuplicates = new Array(length);
  }
  __name(getDuplicateReferences, "getDuplicateReferences");
  function inspectNode(object, objects, duplicatesIndexes) {
    if (object !== null && typeof object === "object") {
      const index = objects.indexOf(object);
      if (index !== -1) {
        if (duplicatesIndexes.indexOf(index) === -1) {
          duplicatesIndexes.push(index);
        }
      } else {
        objects.push(object);
        if (Array.isArray(object)) {
          for (let i = 0, length = object.length; i < length; i += 1) {
            inspectNode(object[i], objects, duplicatesIndexes);
          }
        } else {
          const objectKeyList = Object.keys(object);
          for (let i = 0, length = objectKeyList.length; i < length; i += 1) {
            inspectNode(object[objectKeyList[i]], objects, duplicatesIndexes);
          }
        }
      }
    }
  }
  __name(inspectNode, "inspectNode");
  function dump2(input, options) {
    options = options || {};
    const state = new State(options);
    if (!state.noRefs) getDuplicateReferences(input, state);
    let value = input;
    if (state.replacer) {
      value = state.replacer.call({ "": value }, "", value);
    }
    if (writeNode(state, 0, value, true, true)) return state.dump + "\n";
    return "";
  }
  __name(dump2, "dump2");
  dumper.dump = dump2;
  return dumper;
}
__name(requireDumper, "requireDumper");
var hasRequiredJsYaml;
function requireJsYaml() {
  if (hasRequiredJsYaml) return jsYaml;
  hasRequiredJsYaml = 1;
  const loader2 = requireLoader();
  const dumper2 = requireDumper();
  function renamed(from, to) {
    return function() {
      throw new Error("Function yaml." + from + " is removed in js-yaml 4. Use yaml." + to + " instead, which is now safe by default.");
    };
  }
  __name(renamed, "renamed");
  jsYaml.Type = requireType();
  jsYaml.Schema = requireSchema();
  jsYaml.FAILSAFE_SCHEMA = requireFailsafe();
  jsYaml.JSON_SCHEMA = requireJson();
  jsYaml.CORE_SCHEMA = requireCore();
  jsYaml.DEFAULT_SCHEMA = require_default();
  jsYaml.load = loader2.load;
  jsYaml.loadAll = loader2.loadAll;
  jsYaml.dump = dumper2.dump;
  jsYaml.YAMLException = requireException();
  jsYaml.types = {
    binary: requireBinary(),
    float: requireFloat(),
    map: requireMap(),
    null: require_null(),
    pairs: requirePairs(),
    set: requireSet(),
    timestamp: requireTimestamp(),
    bool: requireBool(),
    int: requireInt(),
    merge: requireMerge(),
    omap: requireOmap(),
    seq: requireSeq(),
    str: requireStr()
  };
  jsYaml.safeLoad = renamed("safeLoad", "load");
  jsYaml.safeLoadAll = renamed("safeLoadAll", "loadAll");
  jsYaml.safeDump = renamed("safeDump", "dump");
  return jsYaml;
}
__name(requireJsYaml, "requireJsYaml");
var jsYamlExports = requireJsYaml();
var yaml = /* @__PURE__ */ getDefaultExportFromCjs(jsYamlExports);
var {
  Type,
  Schema,
  FAILSAFE_SCHEMA,
  JSON_SCHEMA,
  CORE_SCHEMA,
  DEFAULT_SCHEMA,
  load,
  loadAll,
  dump,
  YAMLException,
  types,
  safeLoad,
  safeLoadAll,
  safeDump
} = yaml;

// plugins/hutoj-contest-client/src/recording-settings.ts
function recordingPath(directory) {
  if (/[\x00-\x1f]/.test(directory)) {
    throw new Error("\u5F55\u50CF\u5B58\u50A8\u76EE\u5F55\u4E0D\u80FD\u5305\u542B\u63A7\u5236\u5B57\u7B26\u3002");
  }
  const value = directory.trim();
  if (!value) {
    return "";
  }
  if (value.length > 2048 || /[\x00-\x1f%]/.test(value) || !(import_node_path2.default.posix.isAbsolute(value) || import_node_path2.default.win32.isAbsolute(value))) {
    throw new Error("\u5F55\u50CF\u5B58\u50A8\u76EE\u5F55\u5FC5\u987B\u662F\u5F55\u50CF\u670D\u52A1\u6240\u5728\u673A\u5668\u7684\u7EDD\u5BF9\u8DEF\u5F84\u3002");
  }
  return `${value.replaceAll("\\", "/").replace(/\/+$/, "")}/%path/%Y-%m-%d_%H-%M-%S-%f_%z`;
}
__name(recordingPath, "recordingPath");
async function configureRecording(api, directory, download = fetch) {
  const recordPath = recordingPath(directory);
  if (!recordPath || !api) {
    return;
  }
  const url = new URL(`${api.replace(/\/$/, "")}/v3/config/pathdefaults/`);
  const current = await download(new URL("get", url), {
    redirect: "error",
    signal: AbortSignal.timeout(5e3)
  });
  if (!current.ok) {
    throw new Error("\u65E0\u6CD5\u8BFB\u53D6\u5F55\u50CF\u670D\u52A1\u914D\u7F6E\u3002");
  }
  if ((await current.json()).recordPath === recordPath) {
    return;
  }
  const result = await download(new URL("patch", url), {
    method: "PATCH",
    redirect: "error",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ record: true, recordPath }),
    signal: AbortSignal.timeout(5e3)
  });
  if (!result.ok) {
    throw new Error("\u5F55\u50CF\u670D\u52A1\u672A\u80FD\u5E94\u7528\u65B0\u7684\u5B58\u50A8\u76EE\u5F55\u3002");
  }
}
__name(configureRecording, "configureRecording");
async function registerRecordingSettings(ctx, H, service) {
  const mediaField = /* @__PURE__ */ __name((label) => H.Schema.string().max(2048).description(label), "mediaField");
  const config = ctx.setting.requestConfig(
    H.Schema.object({
      contestClient: H.Schema.object({
        whipUrlTemplate: mediaField("WHIP \u5730\u5740\u6A21\u677F"),
        mediaApiUrl: mediaField("\u5A92\u4F53\u7BA1\u7406 API \u5730\u5740"),
        mediaPlaybackUrl: mediaField("\u5F55\u50CF\u56DE\u653E\u670D\u52A1\u5730\u5740"),
        recordingDirectory: H.Schema.string().default("").pattern(/^(?:$|(?:\/|[a-zA-Z]:[\\/]|\\\\)[^\x00-\x1f%]*)$/).description("\u5F55\u50CF\u5B58\u50A8\u76EE\u5F55")
      }).description("\u6BD4\u8D5B\u5BA2\u6237\u7AEF")
    })
  );
  ctx.on("handler/before/SystemConfig#post", (h) => {
    try {
      const values = load(h.request.body.value);
      validatePolicy(values?.contestClient || {});
    } catch (error) {
      throw new H.ValidationError("contestClient", "", error.message);
    }
  });
  const rows = await service.settings.find({}).toArray();
  const migrated = {};
  for (const name2 of ["whipUrlTemplate", "mediaApiUrl", "mediaPlaybackUrl"]) {
    if (config.contestClient[name2] !== void 0) continue;
    const values = [...new Set(rows.map((row) => row[name2]?.trim()).filter(Boolean))];
    migrated[name2] = values.length === 1 ? validatePolicy({ [name2]: values[0] })[name2] : "";
    if (values.length > 1) {
      console.warn(`\u6BD4\u8D5B\u5BA2\u6237\u7AEF\uFF1A\u65E7\u6BD4\u8D5B\u7684 ${name2} \u4E0D\u4E00\u81F4\uFF0C\u8BF7\u5728\u7CFB\u7EDF\u8BBE\u7F6E\u4E2D\u7EDF\u4E00\u914D\u7F6E\u3002`);
    }
  }
  if (Object.keys(migrated).length) {
    await ctx.setting.setConfig("contestClient", { ...config.contestClient, ...migrated });
  }
  service.mediaSettings = () => {
    const validated = validatePolicy(config.contestClient);
    return {
      whipUrlTemplate: validated.whipUrlTemplate,
      mediaApiUrl: validated.mediaApiUrl,
      mediaPlaybackUrl: validated.mediaPlaybackUrl
    };
  };
  const applied = /* @__PURE__ */ new Map();
  const pending = /* @__PURE__ */ new Map();
  const ensure = /* @__PURE__ */ __name(async (api) => {
    const directory = config.contestClient.recordingDirectory;
    if (!directory || !api) {
      return;
    }
    const previous = applied.get(api);
    if (previous?.directory === directory && Date.now() - previous.time < 3e4) {
      return;
    }
    if (pending.has(api)) {
      return pending.get(api);
    }
    const job = configureRecording(api, directory).then(() => {
      applied.set(api, { directory, time: Date.now() });
    });
    pending.set(api, job);
    try {
      await job;
    } finally {
      pending.delete(api);
    }
  }, "ensure");
  ctx.on("handler/after", async (h) => {
    if (h.constructor.name.replace(/Handler$/, "") !== "SystemConfig" || h.request.method !== "post") {
      return;
    }
    applied.clear();
    await ensure(service.mediaSettings().mediaApiUrl);
  });
  return ensure;
}
__name(registerRecordingSettings, "registerRecordingSettings");

// plugins/hutoj-contest-client/src/scoreboard-view.ts
function realNameUsers(users, identities) {
  const names = new Map(
    identities.filter((row) => typeof row.realName === "string" && row.realName.trim()).map((row) => [row.uid, row.realName.trim()])
  );
  return Object.fromEntries(
    Object.entries(users).map(([id, user]) => {
      if (!user || typeof user !== "object") {
        return [id, user];
      }
      const name2 = names.get(user._id) || user.displayName || user.uname;
      const view = Object.create(user);
      Object.defineProperties(view, {
        uname: { value: name2, enumerable: true },
        displayName: { value: name2, enumerable: true }
      });
      return [id, view];
    })
  );
}
__name(realNameUsers, "realNameUsers");

// plugins/hutoj-contest-client/src/plugin.ts
async function register(ctx, H, config) {
  const service = new ClientService({
    settings: H.db.collection("hutoj.client.settings"),
    sessions: H.db.collection("hutoj.client.sessions"),
    contests: H.ContestModel,
    users: H.UserModel,
    objectId: /* @__PURE__ */ __name((value) => new H.ObjectId(value), "objectId"),
    clientKey: config.clientKey
  });
  await service.init();
  const watch = new HeartbeatWatch(
    H.db.collection("document.status"),
    async (row) => {
      if (!(await service.policy(row.domainId, row.docId)).requireClient) {
        return null;
      }
      const contest = await H.ContestModel.getMulti(row.domainId, { docId: row.docId }).next();
      if (!contest) {
        return null;
      }
      const personalEnd = contest.duration && row.startAt ? +row.startAt + contest.duration * 36e5 : Infinity;
      return new Date(Math.min(+contest.endAt, personalEnd));
    }
  );
  await watch.init();
  watch.onDisconnect = async (row) => {
    const [contest, identity] = await Promise.all([
      H.ContestModel.get(row.domainId, row.docId),
      H.db.collection("realname_superhut").findOne({ uid: row.uid }, { projection: { realName: 1 } })
    ]);
    const text = `\u6BD4\u8D5B\u6389\u7EBF\u901A\u77E5
\u300A${contest.title}\u300B\u9009\u624B${identity?.realName || row.uid}\u5DF2\u8FDE\u7EED 15 \u79D2\u672A\u53D1\u9001\u5FC3\u8DF3\uFF0C\u7CFB\u7EDF\u5DF2\u81EA\u52A8\u7ED3\u675F\u8BE5\u9009\u624B\u7684\u6BD4\u8D5B\u3002`;
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
      console.error("Contest heartbeat sweep failed", error);
    } finally {
      sweeping = false;
    }
  }, 1e3);
  const ensureRecording = await registerRecordingSettings(ctx, H, service);
  const oauth = await registerClientOAuth(ctx, H, service);
  const ProtocolError = H.CreateError("HutojClientError", H.UserFacingError, "{0}", 403);
  const wrap = /* @__PURE__ */ __name((fn) => async function(...args) {
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
  }, "wrap");
  const header = /* @__PURE__ */ __name((h, name2) => h.request.headers[name2.toLowerCase()], "header");
  const token = /* @__PURE__ */ __name((h) => header(h, "x-hutoj-client-session"), "token");
  const domain = /* @__PURE__ */ __name((h) => h.domain._id, "domain");
  const signedIn = /* @__PURE__ */ __name((h) => h.checkPriv(H.PRIV.PRIV_USER_PROFILE), "signedIn");
  const manager = /* @__PURE__ */ __name((h, tdoc) => h.user.hasPerm(H.PERM.PERM_EDIT_CONTEST) || h.user.own(tdoc) && h.user.hasPerm(H.PERM.PERM_EDIT_CONTEST_SELF), "manager");
  function sameOrigin(h) {
    const origin = header(h, "origin");
    if (!origin) {
      return;
    }
    if (typeof origin !== "string") {
      fail("INVALID_ORIGIN");
    }
    let parsed;
    try {
      parsed = new URL(origin);
    } catch {
      fail("INVALID_ORIGIN");
    }
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.host !== h.request.host) {
      fail("INVALID_ORIGIN");
    }
  }
  __name(sameOrigin, "sameOrigin");
  function json2(h, body) {
    h.response.type = "application/json";
    h.response.addHeader("Cache-Control", "no-store");
    h.response.body = body;
  }
  __name(json2, "json");
  const auth = /* @__PURE__ */ __name(async (h, allowExpired = false) => {
    signedIn(h);
    sameOrigin(h);
    const row = await service.authenticate(domain(h), h.user._id, token(h), allowExpired);
    const grant = h.context?.HydroContext?.hutojClientGrant;
    if (grant && (grant.selectionRequired === true || row.tid !== grant.tid || row.deviceId !== grant.deviceId)) {
      fail("OAUTH_SCOPE_DENIED");
    }
    return row;
  }, "auth");
  async function snapshot(h, row) {
    const data = await service.snapshot(row);
    const identity = await H.db.collection("realname_superhut").findOne(
      { uid: row.uid, verifiedAt: { $type: "date" } },
      { projection: { studentId: 1, className: 1, realName: 1 } }
    );
    if (ctx.setting.get("contestClient.recordingDirectory")) {
      await ensureRecording((await service.policy(row.domainId, row.tid)).mediaApiUrl);
    }
    const tid = row.tid;
    return {
      ...data,
      user: {
        ...data.user,
        ...identity ? {
          studentId: identity.studentId,
          className: identity.className || "",
          realName: identity.realName
        } : {}
      },
      urls: {
        session: h.url("hutoj_client_session"),
        heartbeat: h.url("hutoj_client_heartbeat"),
        ready: h.url("hutoj_client_ready"),
        displayName: h.url("home_settings", { category: "domain" }),
        contest: h.url("contest_detail", { tid }),
        problems: h.url("contest_problemlist", { tid }),
        records: h.url("record_main", { query: { tid, uidOrName: h.user._id } })
      }
    };
  }
  __name(snapshot, "snapshot");
  class HutojClientBootstrapHandler extends H.Handler {
    static {
      __name(this, "HutojClientBootstrapHandler");
    }
    get = wrap(async function() {
      signedIn(this);
      const grant = this.context?.HydroContext?.hutojClientGrant;
      const choices = grant ? await oauth.list(grant) : await service.eligible(domain(this), this.user._id);
      if (!choices.length) {
        fail("NO_CLIENT_CONTEST", 404);
      }
      const selected = grant?.selectionRequired === true ? null : await service.select(domain(this), this.user._id, grant?.tid);
      const tdoc = selected?.tdoc;
      json2(this, {
        protocolVersion: 1,
        selectionRequired: grant?.selectionRequired === true,
        contests: choices.map(({ tdoc: tdoc2 }) => ({
          id: String(tdoc2.docId),
          domainId: tdoc2.domainId,
          title: tdoc2.title,
          beginAt: tdoc2.beginAt,
          endAt: tdoc2.endAt,
          durationHours: tdoc2.duration || (+tdoc2.endAt - +tdoc2.beginAt) / 36e5,
          personalDurationHours: tdoc2.duration || null
        })),
        user: {
          id: this.user._id,
          username: this.user.uname,
          displayName: this.user.displayName || ""
        },
        editorPreferences: {
          fontFamily: this.user.codeFontFamily || "Source Code Pro",
          theme: this.user.theme === "dark" ? "vs-dark" : "hutoj",
          showInvisibleChar: !!this.user.showInvisibleChar,
          language: this.user.codeLang || ""
        },
        contest: tdoc ? {
          id: String(tdoc.docId),
          title: tdoc.title,
          beginAt: tdoc.beginAt,
          endAt: tdoc.endAt,
          descriptionHtml: await this.renderHTML("hutoj_client_markdown.html", {
            content: tdoc.content || ""
          })
        } : void 0,
        sessionUrl: this.url("hutoj_client_session"),
        selectionUrl: this.url("hutoj_client_select"),
        serverTime: /* @__PURE__ */ new Date()
      });
    });
  }
  class HutojClientSelectHandler extends H.Handler {
    static {
      __name(this, "HutojClientSelectHandler");
    }
    post = wrap(async function() {
      signedIn(this);
      sameOrigin(this);
      const grant = this.context?.HydroContext?.hutojClientGrant;
      if (!grant) {
        fail("OAUTH_SCOPE_DENIED");
      }
      const selected = await oauth.selectContest(
        grant,
        this.request.body.contestId,
        this.request.body.contestDomain
      );
      json2(this, {
        contestId: selected.tid,
        domainId: selected.domainId,
        basePath: selected.domainId === "system" ? "/" : `/d/${encodeURIComponent(selected.domainId)}/`
      });
    });
  }
  class HutojClientSessionHandler extends H.Handler {
    static {
      __name(this, "HutojClientSessionHandler");
    }
    get = wrap(async function() {
      json2(this, await snapshot(this, await auth(this, true)));
    });
    post = wrap(async function() {
      signedIn(this);
      sameOrigin(this);
      await this.limitRate("hutoj_client_session", 60, 20);
      const grant = this.context?.HydroContext?.hutojClientGrant;
      if (grant?.selectionRequired === true) {
        fail("CLIENT_CONTEST_SELECTION_REQUIRED", 409);
      }
      if (header(this, "x-hutoj-heartbeat-seconds") !== "5") {
        fail("\u8BF7\u66F4\u65B0\u6BD4\u8D5B\u5BA2\u6237\u7AEF\u81F3 0.9.3 \u6216\u66F4\u9AD8\u7248\u672C\u3002", 409);
      }
      const { token: sessionToken, row } = await service.open(
        domain(this),
        this.user._id,
        header(this, "x-hutoj-client-key"),
        this.request.body.deviceId,
        grant?.tid,
        { deviceInfo: this.request.body.deviceInfo, heartbeatV2: true }
      );
      json2(this, { ...await snapshot(this, row), token: sessionToken });
    });
  }
  class HutojClientHeartbeatHandler extends H.Handler {
    static {
      __name(this, "HutojClientHeartbeatHandler");
    }
    post = wrap(async function() {
      const row = await service.heartbeat(await auth(this), this.request.body);
      if (row.heartbeatV2 && row.enteredAt) {
        await watch.beat({
          domainId: row.domainId,
          docId: service.parseTid(row.tid),
          uid: row.uid
        });
      }
      json2(this, await snapshot(this, row));
    });
  }
  class HutojClientReadyHandler extends H.Handler {
    static {
      __name(this, "HutojClientReadyHandler");
    }
    post = wrap(async function() {
      const row = await service.heartbeat(await auth(this), this.request.body, true);
      json2(this, await snapshot(this, row));
    });
  }
  class HutojClientSettingsHandler extends H.Handler {
    static {
      __name(this, "HutojClientSettingsHandler");
    }
    tdoc;
    prepare = wrap(async function() {
      signedIn(this);
      this.tdoc = await H.ContestModel.get(domain(this), service.parseTid(this.args.tid));
      if (!manager(this, this.tdoc)) {
        fail("CONTEST_MANAGEMENT_REQUIRED");
      }
      if (this.tdoc.rule === "homework") {
        fail("HOMEWORK_NOT_SUPPORTED", 400);
      }
    });
    get = wrap(async function() {
      this.session.hutojClientCsrf ||= secret();
      const data = {
        tdoc: this.tdoc,
        policy: await service.policy(domain(this), this.tdoc.docId),
        csrf: this.session.hutojClientCsrf
      };
      if (this.request.json) {
        json2(this, data);
      } else {
        this.response.addHeader("Cache-Control", "no-store");
        this.response.template = "hutoj_client_settings.html";
        this.response.body = data;
      }
    });
    post = wrap(async function() {
      sameOrigin(this);
      if (!equalSecret(this.request.body.csrf, this.session.hutojClientCsrf)) {
        fail("INVALID_CSRF");
      }
      const policy = await service.savePolicy(
        domain(this),
        this.tdoc.docId,
        {
          ...this.request.body,
          requireClient: false,
          clientOnly: false,
          ...Object.fromEntries(
            ["restrictNetwork", "blockBlacklistApps", "blockUsbStorage", "forceFullscreen"].map(
              (key2) => [key2, this.request.body[key2] ?? false]
            )
          )
        },
        this.user._id,
        "settings"
      );
      if (this.request.json) {
        json2(this, { policy });
      } else {
        this.response.redirect = this.url("hutoj_client_settings", { tid: this.tdoc.docId });
      }
    });
  }
  ctx.Route(
    "hutoj_client_bootstrap",
    "/contest-client",
    HutojClientBootstrapHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_select",
    "/contest-client/select",
    HutojClientSelectHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_session",
    "/contest-client/session",
    HutojClientSessionHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_heartbeat",
    "/contest-client/heartbeat",
    HutojClientHeartbeatHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_ready",
    "/contest-client/ready",
    HutojClientReadyHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  ctx.Route(
    "hutoj_client_settings",
    "/contest/:tid/client",
    HutojClientSettingsHandler,
    H.PRIV.PRIV_USER_PROFILE
  );
  registerMonitor(ctx, H, service);
  const protectedNames = /* @__PURE__ */ new Set([
    "ContestProblemList",
    "ContestScoreboard",
    "ContestFileDownload",
    "ContestPrint",
    "ProblemMain",
    "ProblemRandom",
    "ProblemDetail",
    "ProblemSubmit",
    "ProblemFileDownload",
    "ProblemSolution",
    "ProblemSolutionRaw",
    "ProblemStatistics",
    "ProblemHack",
    "ProblemFiles",
    "RecordList",
    "RecordDetail",
    "RecordMainConnection",
    "RecordDetailConnection"
  ]);
  async function guard(h, name2) {
    const finish = name2 === "ContestDetail" && h.request.method === "post" && h.request.body.operation === "early_end";
    if (!finish && !protectedNames.has(name2)) {
      return;
    }
    if (!h.user._id) {
      return;
    }
    const candidates = (await service.eligible(domain(h), h.user._id)).filter(
      ({ tdoc: tdoc2 }) => !manager(h, tdoc2)
    );
    const sessionToken = token(h);
    let tid = name2 === "ProblemMain" || name2 === "ProblemRandom" ? void 0 : h.args.tid;
    if (name2 === "RecordDetail" || name2 === "RecordDetailConnection") {
      const record = await H.RecordModel.get(domain(h), service.parseTid(h.args.rid));
      tid = record?.contest;
      if (String(tid) === "000000000000000000000000" && record?.uid === h.user._id) {
        const candidate = candidates.find(
          ({ tdoc: tdoc2 }) => String(tdoc2.docId) === String(h.args.tid) && tdoc2.pids.includes(record.pid)
        );
        tid = candidate?.tdoc.docId;
      }
    }
    const selected = candidates.find(({ tdoc: tdoc2 }) => String(tdoc2.docId) === String(tid));
    if (selected) {
      if (!sessionToken && !selected.clientOnly) return;
      sameOrigin(h);
      await service.requireSession(
        domain(h),
        h.user._id,
        sessionToken,
        selected.tdoc.docId,
        !finish
      );
      return;
    }
    if (sessionToken && candidates.length) {
      fail("CLIENT_CONTEST_REQUIRED");
    }
    const scoped = /^[a-f\d]{24}$/i.test(String(tid)) && String(tid) !== "000000000000000000000000";
    if (!scoped) {
      if (candidates.some((c) => c.clientOnly)) fail("CLIENT_CONTEST_REQUIRED");
      return;
    }
    const policy = await service.policy(domain(h), tid);
    if (sessionToken && !policy.requireClient) fail("CONTEST_NOT_ELIGIBLE", 409);
    if (!sessionToken && !policy.clientOnly) return;
    const tdoc = await H.ContestModel.get(domain(h), service.parseTid(tid));
    if (manager(h, tdoc) || H.ContestModel.isDone(tdoc)) return;
    const tsdoc = await H.ContestModel.getStatus(domain(h), tdoc.docId, h.user._id);
    if (tsdoc && H.ContestModel.isDone(tdoc, tsdoc)) return;
    sameOrigin(h);
    await service.requireSession(domain(h), h.user._id, sessionToken, tid, !finish);
  }
  __name(guard, "guard");
  ctx.on(
    "handler/before-prepare",
    wrap(async (h) => guard(h, h.constructor.name.replace(/Handler$/, "")))
  );
  ctx.on(
    "handler/create/ws",
    wrap(async (h) => {
      const name2 = h.constructor.name.replace(/Handler$/, "");
      if (!protectedNames.has(name2)) {
        return;
      }
      await guard(h, name2);
      h.ctx.interval(async () => {
        try {
          await guard(h, name2);
        } catch {
          h.close(4003, "Client session unavailable");
        }
      }, 15e3);
    })
  );
  ctx.on(
    "handler/after",
    wrap(async (h) => {
      if (!token(h) || !h.request.json || !h.response.body) {
        return;
      }
      const name2 = h.constructor.name.replace(/Handler$/, "");
      if (![
        "ProblemDetail",
        "ProblemSubmit",
        "ContestProblemList",
        "ContestScoreboard",
        "RecordList",
        "RecordDetail"
      ].includes(name2) || h.request.method !== "get") {
        return;
      }
      const body = h.response.body;
      const view = {};
      if (name2 === "ProblemDetail") {
        const pdoc = { ...body.pdoc };
        pdoc.content = pdoc.content.replace(
          /file:\/\/([^ \n)\\"]+)/g,
          (raw, info) => {
            let filename = info.split("?")[0];
            try {
              filename = decodeURIComponent(filename);
            } catch {
              return raw;
            }
            if (!pdoc.additional_file?.some((file) => file.name === filename)) {
              return raw;
            }
            return `./${pdoc.docId}/file/${info}${info.includes("?") ? "&" : "?"}tid=${h.args.tid}`;
          }
        );
        view.statementHtml = await h.renderHTML("hutoj_client_statement.html", {
          ...body,
          pdoc
        });
        view.statementLanguages = JSON.parse(
          String(await h.renderHTML("hutoj_client_languages.json", body))
        );
        view.canPretest = ["default", "remote_judge"].includes(body.pdoc.config?.type);
        view.canViewRecord = !body.tdoc || H.ContestModel.canShowSelfRecord.call(h, body.tdoc);
      }
      if (name2 === "ContestProblemList") {
        const participant = await auth(h);
        await service.markEntered(participant);
        if (participant.heartbeatV2 && (await service.policy(participant.domainId, participant.tid)).requireClient) {
          await watch.enter({
            domainId: participant.domainId,
            docId: service.parseTid(participant.tid),
            uid: participant.uid
          });
        }
        view.clarifications = await Promise.all(
          (body.tcdocs || []).map(async (doc) => ({
            id: String(doc.docId),
            owner: doc.owner,
            subject: doc.subject,
            html: await h.renderHTML("hutoj_client_markdown.html", { content: doc.content }),
            replies: await Promise.all(
              (doc.reply || []).map(async (reply) => ({
                id: String(reply._id),
                html: await h.renderHTML("hutoj_client_markdown.html", {
                  content: reply.content
                })
              }))
            )
          }))
        );
      }
      if (name2 === "ContestScoreboard") {
        const ids = Object.values(body.udict || {}).map((user) => user?._id).filter(Number.isSafeInteger);
        const identities = await H.db.collection("realname_superhut").find(
          { uid: { $in: ids }, verifiedAt: { $type: "date" } },
          { projection: { uid: 1, realName: 1 } }
        ).toArray();
        const rows = Array.isArray(body.rows) ? body.rows.map(
          (row, index) => index === 0 ? row.map((cell) => cell.type === "user" ? { ...cell, value: "\u59D3\u540D" } : cell) : row
        ) : body.rows;
        view.scoreboardHtml = await inlineAvatars(
          String(
            await h.renderHTML("partials/scoreboard.html", {
              ...body,
              rows,
              udict: realNameUsers(body.udict || {}, identities)
            })
          ),
          `${h.context.request.protocol}://${h.request.host}`,
          String(H.SystemModel.get("avatar.gravatar_url") || ""),
          config.avatarFallback || ""
        );
      }
      if (name2 === "RecordDetail" && typeof body.rdoc?.status === "number") {
        view.statusHtml = await h.renderHTML("record_detail_status.html", body);
      }
      view.labels = JSON.parse(String(await h.renderHTML("hutoj_client_labels.json", {})));
      body.clientView = view;
    })
  );
  ctx.on(
    "handler/before-prepare/HomeSettings#post",
    wrap(async (h) => {
      if (h.args.category !== "domain" || !token(h)) {
        return;
      }
      const row = await auth(h);
      const state = await service.state(row);
      if (state.ended || !state.policy.requireClient) {
        fail("CONTEST_NOT_ACTIVE", 409);
      }
      if (Object.keys(h.request.body).some((field) => field !== "displayName") || typeof h.request.body.displayName !== "string" || !h.request.body.displayName.trim()) {
        fail("DISPLAY_NAME_ONLY", 400);
      }
      if (typeof h.user.contestMode === "string" && !["system", h.user.contestMode].includes(domain(h))) {
        fail("INVALID_CONTEST_DOMAIN");
      }
      await h.post({
        domainId: domain(h),
        category: "domain",
        displayName: h.request.body.displayName
      });
      if (h.request.json) {
        delete h.response.redirect;
        const user = await H.UserModel.getById(domain(h), h.user._id);
        json2(h, { displayName: user?.displayName || "" });
      }
      return "after";
    })
  );
  ctx.on(
    "handler/after/ContestDetail#post",
    wrap(async (h) => {
      if (h.request.body.operation === "early_end") {
        await service.resetReady(domain(h), h.args.tid, h.user._id);
      }
    })
  );
  ctx.on(
    "handler/after/ContestUser#post",
    wrap(async (h) => {
      if (h.request.body.operation === "resume") {
        await service.resetReady(domain(h), h.args.tid, +h.args.uid);
      }
    })
  );
  ctx.on(
    "handler/after/ContestEdit#get",
    wrap(async (h) => {
      if (h.tdoc && manager(h, h.tdoc) && h.response.template === "contest_edit.html") {
        h.response.body.hutojClientPolicy = await service.policy(domain(h), h.tdoc.docId);
        h.response.template = "hutoj_client_contest_edit.html";
      }
    })
  );
  const fromEditForm = /* @__PURE__ */ __name((h) => h.tdoc && h.request.body.operation === "update" && ["1", "2"].includes(h.request.body.hutojClientPresent), "fromEditForm");
  const requestedAccess = /* @__PURE__ */ __name((h) => clientAccess(h.request.body.hutojRequireClient, h.request.body.hutojClientOnly), "requestedAccess");
  ctx.on(
    "handler/before/ContestEdit#post",
    wrap(async (h) => {
      if (!fromEditForm(h)) {
        return;
      }
      if (requestedAccess(h).requireClient && service.clientKey.length < 32) {
        fail("CLIENT_KEY_NOT_CONFIGURED", 503);
      }
    })
  );
  ctx.on(
    "handler/after/ContestEdit#post",
    wrap(async (h) => {
      if (!fromEditForm(h)) {
        return;
      }
      const access = requestedAccess(h);
      const current = await service.policy(domain(h), h.tdoc.docId);
      if (h.request.body.hutojClientPresent === "1" && access.requireClient) {
        access.clientOnly = current.clientOnly;
      }
      if (current.requireClient !== access.requireClient || current.clientOnly !== access.clientOnly) {
        await service.savePolicy(domain(h), h.tdoc.docId, access, h.user._id, "access");
      }
    })
  );
  ctx.on("handler/after", (h) => {
    if (!h.tdoc || !manager(h, h.tdoc) || h.tdoc.rule === "homework") {
      return;
    }
    const originalTemplate = h.response.template;
    const sidebarTemplate = originalTemplate ? config.sidebarTemplates?.[originalTemplate] : void 0;
    if (sidebarTemplate) {
      h.response.body.page_name ||= originalTemplate.split(".")[0];
      h.response.template = sidebarTemplate;
    }
    if (!h.response.body?.overrideNav) {
      return;
    }
    h.response.body.overrideNav.push({
      name: "hutoj_client_settings",
      displayName: "\u6BD4\u8D5B\u5BA2\u6237\u7AEF",
      args: { tid: h.tdoc.docId, prefix: "hutoj_client_settings" },
      checker: /* @__PURE__ */ __name(() => true, "checker")
    });
  });
  ctx.i18n.load("zh", {
    hutoj_client_settings: "\u6BD4\u8D5B\u5BA2\u6237\u7AEF",
    hutoj_client_monitor: "\u5C4F\u5E55\u76D1\u63A7"
  });
  return service;
}
__name(register, "register");

// plugins/hutoj-contest-client/src/templates.ts
var import_promises2 = require("node:fs/promises");
var import_node_path3 = __toESM(require("node:path"), 1);
async function registerTemplates(ctx, folder) {
  const registry = ctx.template.registry;
  const entries = [];
  for (const file of await (0, import_promises2.readdir)(folder, { withFileTypes: true })) {
    if (!file.isFile() || !/^hutoj_client_[a-z_]+\.(html|json)$/.test(file.name)) {
      continue;
    }
    const filename = import_node_path3.default.join(folder, file.name);
    entries.push(
      [file.name, await (0, import_promises2.readFile)(filename, "utf8")],
      [`${file.name}.source`, filename]
    );
  }
  const sidebarTemplates = {};
  const sidebar = registry["partials/contest_sidebar_management.html"];
  const clarification = /<li\b[^>]*>\s*<a\b[^>]*\{\{\s*url\(['"]contest_clarification['"][\s\S]*?<\/a>\s*<\/li>/;
  if (sidebar && clarification.test(sidebar)) {
    const customSidebar = "hutoj_client_management_sidebar.html";
    entries.push([
      customSidebar,
      sidebar.replace(clarification, '$&\n{% include "hutoj_client_sidebar_entry.html" %}')
    ]);
    for (const [name2, content] of Object.entries({
      ...registry,
      ...Object.fromEntries(entries)
    })) {
      if (!name2.endsWith(".html") || !content.includes("partials/contest_sidebar_management.html")) {
        continue;
      }
      const alias = `hutoj_client_sidebar_${name2.replace(/[^a-zA-Z0-9_]/g, "_")}.html`;
      sidebarTemplates[name2] = alias;
      entries.push([
        alias,
        content.replaceAll("partials/contest_sidebar_management.html", customSidebar)
      ]);
    }
  }
  ctx.effect(() => {
    const previous = entries.map(([name2]) => registry[name2]);
    for (const [name2, content] of entries) {
      registry[name2] = content;
    }
    return () => entries.forEach(([name2, content], index) => {
      if (registry[name2] !== content) {
        return;
      }
      if (previous[index] === void 0) {
        delete registry[name2];
      } else {
        registry[name2] = previous[index];
      }
    });
  });
  return sidebarTemplates;
}
__name(registerTemplates, "registerTemplates");

// plugins/hutoj-contest-client/src/index.ts
var import_node_path4 = __toESM(require("node:path"), 1);
var import_promises3 = require("node:fs/promises");
var name = "hutoj-contest-client";
var inject = ["db", "server", "template", "setting"];
var Config = Hydro.Schema.object({
  clientKey: Hydro.Schema.string().role("secret").default("").description("\u5BA2\u6237\u7AEF\u90E8\u7F72\u5BC6\u94A5\uFF08\u81F3\u5C11 32 \u5B57\u7B26\uFF09")
});
async function apply(ctx, config) {
  const sidebarTemplates = await registerTemplates(ctx, import_node_path4.default.join(__dirname, "templates"));
  const avatarFallback = `data:image/png;base64,${(await (0, import_promises3.readFile)(import_node_path4.default.join(__dirname, "web/avatar.png"))).toString("base64")}`;
  await register(ctx, Hydro, {
    clientKey: process.env.HUTOJ_CONTEST_CLIENT_KEY || config.clientKey || "",
    sidebarTemplates,
    avatarFallback
  });
}
__name(apply, "apply");
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  Config,
  apply,
  inject,
  name,
  registerTemplates
});
