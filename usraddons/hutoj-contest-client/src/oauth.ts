import { createHash } from 'node:crypto';
import type { Collection } from 'mongodb';
import { equalSecret, fail, secret } from './core.ts';

export const CLIENT_ID = 'hutoj-contest-client';
export const CLIENT_SCOPE = 'contest:client';
export const CLIENT_REDIRECT = 'hutoj-client://oauth/callback';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export const challenge = (value: string) =>
  createHash('sha256').update(value).digest('base64url');
export interface Identity {
  uid: number;
  studentId: string;
  realName: string;
  className?: string;
  verifiedAt: Date;
}
export interface Grant {
  _id: string;
  kind: 'code' | 'access';
  domainId: string;
  uid: number;
  tid: string;
  deviceId: string;
  realName: string;
  verifiedAt: Date;
  expiresAt: Date;
  challenge?: string;
  selectionRequired?: boolean;
  allDomains?: boolean;
  discoveryDomainId?: string;
}
type Choice = { tdoc: { docId: unknown; domainId?: string } };
type Ports = {
  grants: Collection<Grant>;
  identities: Collection<Identity>;
  clientKey: string;
  select: (domain: string, uid: number) => Promise<Choice>;
  eligible?: (domain: string, uid: number) => Promise<Choice[]>;
  eligibleAll?: (uid: number) => Promise<Choice[]>;
  validUser: (domain: string, uid: number) => Promise<boolean>;
  setName: (domain: string, uid: number, name: string) => Promise<unknown>;
  now?: () => Date;
};
export class ClientOAuth {
  readonly now: () => Date;
  readonly ports: Ports;
  constructor(ports: Ports) {
    this.ports = ports;
    this.now = ports.now || (() => new Date());
  }
  async init() {
    await this.ports.grants.createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 });
  }
  checkKey(key: unknown) {
    if (this.ports.clientKey.length < 32 || !equalSecret(key, this.ports.clientKey)) {
      fail('INVALID_CLIENT_KEY');
    }
  }
  private async choices(domain: string, uid: number, allDomains = false) {
    const choices =
      allDomains && this.ports.eligibleAll
        ? await this.ports.eligibleAll(uid)
        : this.ports.eligible
          ? await this.ports.eligible(domain, uid)
          : [await this.ports.select(domain, uid)];
    if (!choices.length) {
      fail('NO_CLIENT_CONTEST', 404);
    }
    return choices;
  }
  list(grant: Grant) {
    return this.choices(
      grant.domainId,
      grant.uid,
      grant.allDomains === true && grant.selectionRequired === true,
    );
  }
  private request(input: Record<string, unknown>) {
    if (
      input.client_id !== CLIENT_ID ||
      input.redirect_uri !== CLIENT_REDIRECT ||
      typeof input.deviceId !== 'string' ||
      !/^[a-zA-Z0-9_-]{16,128}$/.test(input.deviceId)
    ) {
      fail('INVALID_OAUTH_REQUEST', 400);
    }
  }
  async authorize(domainId: string, input: Record<string, unknown>, key: unknown) {
    this.checkKey(key);
    this.request(input);
    const studentId = typeof input.studentId === 'string' ? input.studentId.trim() : '';
    const realName = typeof input.name === 'string' ? input.name.trim().normalize('NFC') : '';
    if (
      !/^[a-zA-Z0-9_-]{1,64}$/.test(studentId) ||
      !realName ||
      realName.length > 80 ||
      /[\x00-\x1f\x7f]/.test(realName)
    ) {
      fail('REALNAME_LOGIN_FAILED');
    }
    if (
      input.response_type !== 'code' ||
      input.scope !== CLIENT_SCOPE ||
      input.code_challenge_method !== 'S256' ||
      typeof input.code_challenge !== 'string' ||
      !/^[a-zA-Z0-9_-]{43}$/.test(input.code_challenge) ||
      typeof input.state !== 'string' ||
      !/^[a-zA-Z0-9_-]{32,128}$/.test(input.state)
    ) {
      fail('INVALID_OAUTH_REQUEST', 400);
    }
    // A student number must identify exactly one verified Hydro account.
    const matches = await this.ports.identities.find({ studentId }).limit(2).toArray();
    const identity = matches[0];
    if (
      matches.length !== 1 ||
      identity.realName !== realName ||
      !identity.verifiedAt ||
      !(await this.ports.validUser(domainId, identity.uid))
    ) {
      fail('REALNAME_LOGIN_FAILED');
    }
    if (input.contest_scope !== undefined && input.contest_scope !== 'all-domains') {
      fail('INVALID_OAUTH_REQUEST', 400);
    }
    const allDomains = input.contest_scope === 'all-domains' && !!this.ports.eligibleAll;
    const [{ tdoc }] = await this.choices(domainId, identity.uid, allDomains);
    const code = secret();
    await this.ports.grants.insertOne({
      _id: digest(code),
      kind: 'code',
      domainId,
      uid: identity.uid,
      tid: String(tdoc.docId),
      selectionRequired: true,
      allDomains,
      deviceId: input.deviceId as string,
      realName: identity.realName,
      verifiedAt: identity.verifiedAt,
      expiresAt: new Date(+this.now() + 60_000),
      challenge: input.code_challenge,
    });
    return { code, state: input.state };
  }
  async exchange(domainId: string, input: Record<string, unknown>, key: unknown) {
    this.checkKey(key);
    this.request(input);
    if (
      input.grant_type !== 'authorization_code' ||
      typeof input.code !== 'string' ||
      !/^[a-zA-Z0-9_-]{43}$/.test(input.code) ||
      typeof input.code_verifier !== 'string' ||
      !/^[a-zA-Z0-9._~-]{43,128}$/.test(input.code_verifier)
    ) {
      fail('INVALID_OAUTH_GRANT');
    }
    const grant = await this.ports.grants.findOneAndDelete({
      _id: digest(input.code),
      kind: 'code',
      domainId,
      deviceId: input.deviceId as string,
      challenge: challenge(input.code_verifier),
      expiresAt: { $gt: this.now() },
    });
    if (!grant) {
      fail('INVALID_OAUTH_GRANT');
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
      kind: 'access',
      challenge: undefined,
      expiresAt: new Date(+this.now() + 24 * 3600_000),
    });
    return {
      access_token: access,
      token_type: 'Bearer',
      expires_in: 24 * 3600,
      scope: CLIENT_SCOPE,
    };
  }
  private async identity(grant: Grant) {
    const identity = await this.ports.identities.findOne({
      uid: grant.uid,
      realName: grant.realName,
      verifiedAt: grant.verifiedAt,
    });
    if (!identity || !(await this.ports.validUser(grant.domainId, grant.uid))) {
      fail('OAUTH_ACCESS_EXPIRED');
    }
  }
  async authenticate(
    access: string,
    domainId: string,
    deviceId: unknown,
    selectionOrigin = false,
  ) {
    if (!/^hcc_[a-zA-Z0-9_-]{43}$/.test(access)) {
      fail('OAUTH_ACCESS_EXPIRED');
    }
    const grant = await this.ports.grants.findOne({
      _id: digest(access),
      kind: 'access',
      ...(selectionOrigin
        ? { $or: [{ domainId }, { discoveryDomainId: domainId }] }
        : { domainId }),
      expiresAt: { $gt: this.now() },
    });
    if (!grant || grant.deviceId !== deviceId) {
      fail('OAUTH_ACCESS_EXPIRED');
    }
    await this.identity(grant);
    return grant;
  }
  async selectContest(grant: Grant, contestId: unknown, domainId?: unknown) {
    if (typeof contestId !== 'string' || !/^[a-f\d]{24}$/i.test(contestId)) {
      fail('INVALID_CONTEST_ID', 400);
    }
    if (domainId !== undefined && (typeof domainId !== 'string' || !domainId)) {
      fail('INVALID_CONTEST_DOMAIN', 400);
    }
    const choices = (await this.choices(grant.domainId, grant.uid, grant.allDomains)).filter(
      (choice) =>
        String(choice.tdoc.docId) === contestId &&
        (domainId === undefined || (choice.tdoc.domainId || grant.domainId) === domainId),
    );
    if (!choices.length) {
      fail('CONTEST_NOT_ELIGIBLE', 409);
    }
    if (choices.length !== 1) {
      fail('CONTEST_SELECTION_AMBIGUOUS', 400);
    }
    const target = choices[0].tdoc.domainId || grant.domainId;
    const updated = await this.ports.grants.findOneAndUpdate(
      {
        _id: grant._id,
        kind: 'access',
        selectionRequired: true,
        expiresAt: { $gt: this.now() },
      },
      {
        $set: {
          tid: contestId,
          domainId: target,
          discoveryDomainId: grant.domainId,
          selectionRequired: false,
        },
      },
      { returnDocument: 'after' },
    );
    if (updated) {
      if (grant.allDomains) {
        await this.ports.setName(target, grant.uid, grant.realName);
      }
      return updated;
    }
    const current = await this.ports.grants.findOne({
      _id: grant._id,
      kind: 'access',
      expiresAt: { $gt: this.now() },
    });
    if (
      current &&
      current.selectionRequired !== true &&
      current.tid === contestId &&
      current.domainId === target
    ) {
      if (grant.allDomains) {
        await this.ports.setName(target, grant.uid, grant.realName);
      }
      return current;
    }
    fail('CLIENT_CONTEST_LOCKED', 409);
  }
}
