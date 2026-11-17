export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;
export const USERNAME_CHANGE_COOLDOWN_MS = USERNAME_CHANGE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
export const USERNAME_CHANGED_AT_FIELD = 'hutojUsernameChangedAt';

export function prepareUsername(username: string) {
    return username.trim();
}

export function normalizeUsername(username: string) {
    return prepareUsername(username).toLowerCase();
}

export function getNextUsernameChangeAt(changedAt: Date | null | undefined) {
    if (!(changedAt instanceof Date) || Number.isNaN(changedAt.getTime())) return null;
    return new Date(changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_MS);
}

export function canChangeUsername(
    changedAt: Date | null | undefined,
    now = new Date(),
    bypassCooldown = false,
) {
    if (bypassCooldown) return true;
    const nextChangeAt = getNextUsernameChangeAt(changedAt);
    return !nextChangeAt || now.getTime() >= nextChangeAt.getTime();
}
