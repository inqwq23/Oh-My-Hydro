import { createHash } from 'node:crypto';

export interface RealnameRecord {
    _id?: unknown;
    uid: number;
    studentId: string;
    className: string;
    realName: string;
    identityType: string;
    verifiedAt: Date;
    source: 'cas' | 'cli';
    revision?: string;
    showRealName?: boolean;
}

export function realnameView(record: RealnameRecord | null) {
    if (!record || !['cas', 'cli'].includes(record.source)
        || !(record.verifiedAt instanceof Date) || !Number.isFinite(+record.verifiedAt)
        || ![record.studentId, record.className, record.realName, record.identityType]
            .every((v) => typeof v === 'string' && v.trim())) return null;
    return {
        verified: true as const,
        realName: record.realName,
        studentId: record.studentId,
        className: record.className,
        identityType: record.identityType,
    };
}

export function realnameVersion(record: RealnameRecord | null): string | undefined {
    const view = realnameView(record);
    if (!view || !record) return undefined;
    return createHash('sha256').update(JSON.stringify([
        String(record._id ?? ''), record.uid, record.revision ?? '', +record.verifiedAt,
        record.source, view.realName, view.studentId, view.className, view.identityType,
    ])).digest('hex');
}
