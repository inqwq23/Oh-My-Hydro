import type { Collection, ObjectId } from 'mongodb';

// Keep the deadline on Hydro's participant status. Rotating a client lease or
// restarting a server worker must not reset the clock.
export const HEARTBEAT_SECONDS = 5;
const timeoutMs = 3 * HEARTBEAT_SECONDS * 1000;
export type Contestant = { domainId: string; docId: ObjectId; uid: number };
export type WatchedStatus = Contestant & {
  docType: number;
  attend: number;
  startAt?: Date;
  endAt?: Date | null;
  clientHeartbeatDue?: Date;
  clientOfflineAt?: Date;
};

export class HeartbeatWatch {
  readonly statuses: Collection<WatchedStatus>;
  readonly endTime: (row: WatchedStatus) => Promise<Date | null>;
  readonly now: () => Date;
  onDisconnect?: (row: WatchedStatus) => Promise<void>;
  constructor(
    statuses: Collection<WatchedStatus>,
    endTime: (row: WatchedStatus) => Promise<Date | null>,
    now = () => new Date(),
  ) {
    this.statuses = statuses;
    this.endTime = endTime;
    this.now = now;
  }

  async init() {
    await this.statuses.createIndex({ clientHeartbeatDue: 1 }, { sparse: true });
  }
  async enter(key: Contestant) {
    await this.statuses.updateOne(
      { ...key, docType: 30, attend: 1, endAt: null, clientHeartbeatDue: { $exists: false } },
      { $set: { clientHeartbeatDue: new Date(+this.now() + timeoutMs) } },
    );
  }
  async beat(key: Contestant) {
    const now = this.now();
    await this.statuses.updateOne(
      { ...key, docType: 30, endAt: null, clientHeartbeatDue: { $gt: now } },
      { $max: { clientHeartbeatDue: new Date(+now + timeoutMs) } },
    );
  }
  async disarm(filter: Partial<Contestant>) {
    await this.statuses.updateMany(
      { ...filter, docType: 30, clientHeartbeatDue: { $exists: true } },
      { $unset: { clientHeartbeatDue: '' } },
    );
  }
  async settle(row: WatchedStatus) {
    const due = row.clientHeartbeatDue;
    if (!due || due > this.now()) {
      return;
    }
    const match = {
      domainId: row.domainId,
      docId: row.docId,
      uid: row.uid,
      docType: 30,
      clientHeartbeatDue: due,
    };
    const end = row.attend && !row.endAt ? await this.endTime(row) : null;
    if (!end || end <= due) {
      await this.statuses.updateOne(match, { $unset: { clientHeartbeatDue: '' } });
      return;
    }
    // Only the winner records the event. A concurrent valid heartbeat,
    // manual finish or administrator reset invalidates the predicate.
    const result = await this.statuses.updateOne(
      { ...match, attend: 1, endAt: null },
      { $set: { endAt: due, clientOfflineAt: due }, $unset: { clientHeartbeatDue: '' } },
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
}
