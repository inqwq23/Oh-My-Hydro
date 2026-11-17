import {
    Context, CreateError, db, ForbiddenError, Handler, moment, param, PRIV, requireSudo, Types,
    UserAlreadyExistError, UserModel, UserNotFoundError,
} from 'hydrooj';
import {
    canChangeUsername, getNextUsernameChangeAt, normalizeUsername, prepareUsername,
    USERNAME_CHANGE_COOLDOWN_MS, USERNAME_CHANGED_AT_FIELD,
} from './policy';

const UsernameCooldownError = CreateError(
    'UsernameCooldownError',
    ForbiddenError,
    'Username can only be changed once every 30 days. You can change it again after {0}.',
);

const UsernameUnchangedError = CreateError(
    'UsernameUnchangedError',
    ForbiddenError,
    'The new username must be different from the current username.',
);

const UsernameEmptyError = CreateError(
    'UsernameEmptyError',
    ForbiddenError,
    'Username cannot be empty.',
);

interface UsernameChangeState {
    canChange: boolean;
    changedAt: Date | null;
    nextChangeAt: Date | null;
}

const userCollection = UserModel.coll as any;
const virtualUserCollection = db.collection('vuser') as any;

function prepareHydroUsername(rawUsername: string) {
    const usernameType = Types.Username as any;
    if (!usernameType[1](rawUsername)) return null;
    return usernameType[0](rawUsername) as string;
}

async function ensureUsernameAvailable(uid: number, uname: string) {
    const unameLower = normalizeUsername(uname);
    const [registeredUser, virtualUser] = await Promise.all([
        userCollection.findOne({ unameLower }, { projection: { _id: 1 } }),
        virtualUserCollection.findOne({ unameLower }, { projection: { _id: 1 } }),
    ]);
    if ((registeredUser && registeredUser._id !== uid) || virtualUser) {
        throw new UserAlreadyExistError(uname);
    }
}

async function checkUsernameAvailability(uid: number, rawUsername: string) {
    const uname = prepareHydroUsername(rawUsername);
    if (uname === null) return { available: false, reason: 'invalid' };
    if (!uname) return { available: false, reason: 'empty' };

    const unameLower = normalizeUsername(uname);
    const [current, registeredUser, virtualUser] = await Promise.all([
        userCollection.findOne({ _id: uid }, { projection: { uname: 1 } }),
        userCollection.findOne({ unameLower }, { projection: { _id: 1 } }),
        virtualUserCollection.findOne({ unameLower }, { projection: { _id: 1 } }),
    ]);
    if (current?.uname === uname) return { available: false, reason: 'unchanged' };
    const taken = (registeredUser && registeredUser._id !== uid) || virtualUser;
    return { available: !taken, reason: taken ? 'taken' : 'available' };
}

async function getUsernameChangeState(uid: number, now = new Date()): Promise<UsernameChangeState> {
    const udoc = await userCollection.findOne(
        { _id: uid },
        { projection: { [USERNAME_CHANGED_AT_FIELD]: 1 } },
    );
    const changedAt = udoc?.[USERNAME_CHANGED_AT_FIELD] instanceof Date
        ? udoc[USERNAME_CHANGED_AT_FIELD]
        : null;
    const nextChangeAt = getNextUsernameChangeAt(changedAt);
    return {
        canChange: canChangeUsername(changedAt, now),
        changedAt,
        nextChangeAt,
    };
}

function formatNextChangeAt(date: Date, timeZone?: string) {
    return moment(date).tz(timeZone || 'Asia/Shanghai').format('YYYY-MM-DD HH:mm:ss');
}

async function changeUsername(
    domainId: string,
    uid: number,
    uname: string,
    bypassCooldown: boolean,
    timeZone?: string,
) {
    uname = prepareUsername(uname);
    if (!uname) throw new UsernameEmptyError();
    const unameLower = normalizeUsername(uname);
    const current = await userCollection.findOne({ _id: uid });
    if (!current) throw new UserNotFoundError(uid);
    if (current.uname === uname) throw new UsernameUnchangedError();

    const now = new Date();
    const changedAt = current[USERNAME_CHANGED_AT_FIELD] instanceof Date
        ? current[USERNAME_CHANGED_AT_FIELD]
        : null;
    const nextChangeAt = getNextUsernameChangeAt(changedAt);
    if (!canChangeUsername(changedAt, now, bypassCooldown) && nextChangeAt) {
        throw new UsernameCooldownError(formatNextChangeAt(nextChangeAt, timeZone));
    }

    // Query both Hydro username collections directly. This makes the check
    // global, case-insensitive, and independent of domain-specific user caches.
    await ensureUsernameAvailable(uid, uname);

    UserModel._deleteUserCache(current);
    let updated;
    try {
        const filter: any = { _id: uid };
        if (!bypassCooldown) {
            filter.$or = [
                { [USERNAME_CHANGED_AT_FIELD]: { $exists: false } },
                { [USERNAME_CHANGED_AT_FIELD]: { $lte: new Date(now.getTime() - USERNAME_CHANGE_COOLDOWN_MS) } },
            ];
        }
        updated = await userCollection.findOneAndUpdate(
            filter,
            {
                $set: {
                    uname,
                    unameLower,
                    [USERNAME_CHANGED_AT_FIELD]: now,
                },
            },
            { returnDocument: 'after' },
        );
    } catch (error: any) {
        if (error?.code === 11000) throw new UserAlreadyExistError(uname);
        throw error;
    }

    if (!updated) {
        const state = await getUsernameChangeState(uid, now);
        if (!bypassCooldown && state.nextChangeAt) {
            throw new UsernameCooldownError(formatNextChangeAt(state.nextChangeAt, timeZone));
        }
        throw new UserNotFoundError(uid);
    }

    // Clear both identity keys again after the write. This closes the small
    // window in which another Hydro process could repopulate the old-name cache.
    UserModel._deleteUserCache(current);
    UserModel._deleteUserCache(updated);
    return updated;
}

class HomeUsernameHandler extends Handler {
    @param('uname', Types.Username)
    async post(domainId: string, uname: string) {
        const isSuperAdmin = this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        await changeUsername(domainId, this.user._id, uname, isSuperAdmin, this.user.timeZone);
        this.response.redirect = this.url('home_settings', { category: 'account' });
    }
}

class UsernameAvailabilityHandler extends Handler {
    @param('uname', Types.String)
    @param('target', Types.UidOrName, true)
    async get(domainId: string, uname: string, target?: string) {
        let targetUid = this.user._id;
        if (target && this.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM)) {
            const numericUid = /^-?\d+$/.test(target) ? Number(target) : NaN;
            const targetUser = Number.isSafeInteger(numericUid)
                ? await UserModel.getById(domainId, numericUid)
                : await UserModel.getByUname(domainId, target);
            if (targetUser) targetUid = targetUser._id;
        }
        this.response.addHeader('Cache-Control', 'no-store');
        this.response.body = await checkUsernameAvailability(targetUid, uname);
    }
}

class ManageUsernameHandler extends Handler {
    @requireSudo
    async get() {
        this.response.template = 'manage_username.html';
    }

    @requireSudo
    @param('target', Types.UidOrName)
    @param('uname', Types.Username)
    async post(domainId: string, target: string, uname: string) {
        const numericUid = /^-?\d+$/.test(target) ? Number(target) : NaN;
        const targetUser = Number.isSafeInteger(numericUid)
            ? await UserModel.getById(domainId, numericUid)
            : await UserModel.getByUname(domainId, target);
        if (!targetUser) throw new UserNotFoundError(target);

        await changeUsername(domainId, targetUser._id, uname, true, this.user.timeZone);
        this.response.redirect = this.url('manage_username');
    }
}

export function apply(ctx: Context) {
    ctx.Route('home_username', '/home/username', HomeUsernameHandler, PRIV.PRIV_USER_PROFILE);
    ctx.Route(
        'home_username_check',
        '/home/username/check',
        UsernameAvailabilityHandler,
        PRIV.PRIV_USER_PROFILE,
    );
    ctx.Route('manage_username', '/manage/username', ManageUsernameHandler, PRIV.PRIV_EDIT_SYSTEM);
    ctx.injectUI('ControlPanel', 'manage_username', { before: 'manage_user_priv' }, PRIV.PRIV_EDIT_SYSTEM);

    ctx.on('handler/after/HomeSettings#get', async (handler: any) => {
        if (handler.args.category !== 'account') return;
        const state = await getUsernameChangeState(handler.user._id);
        const bypassCooldown = handler.user.hasPriv(PRIV.PRIV_EDIT_SYSTEM);
        handler.response.body.usernameChange = {
            ...state,
            bypassCooldown,
            canChange: state.canChange || bypassCooldown,
        };
    });

    ctx.i18n.load('en', {
        'Change Username': 'Change Username',
        'Current Username': 'Current Username',
        'New Username': 'New Username',
        'Change username': 'Change username',
        'After changing, you cannot change it again for 30 days.':
            'After changing, you cannot change it again for 30 days.',
        'This username is already in use.': 'This username is already in use.',
        'Username format is invalid.': 'Username format is invalid.',
        'Username cannot be empty.': 'Username cannot be empty.',
        'Unable to check username availability. Please try again.':
            'Unable to check username availability. Please try again.',
        'Username can only be changed once every 30 days. You can change it again after {0}.':
            'Username can only be changed once every 30 days. You can change it again after {0}.',
        'The new username must be different from the current username.':
            'The new username must be different from the current username.',
        manage_username: 'Username Management',
        'Username Management': 'Username Management',
        'Target User': 'Target User',
        'Select User': 'Select User',
        'Are you sure you want to change your username? It can only be changed once every 30 days.':
            'Are you sure you want to change your username? It can only be changed once every 30 days.',
        'Confirm username change': 'Confirm',
        'Cancel username change': 'Cancel',
    });

    ctx.i18n.load('zh', {
        'Change Username': '修改用户名',
        'Current Username': '当前用户名',
        'New Username': '新用户名',
        'Change username': '确认修改',
        'After changing, you cannot change it again for 30 days.': '修改后30天不能再次修改',
        'This username is already in use.': '该用户名已被使用。',
        'Username format is invalid.': '用户名格式不符合要求。',
        'Username cannot be empty.': '用户名不能为空。',
        'Unable to check username availability. Please try again.': '检测失败，请稍后重试。',
        'Username can only be changed once every 30 days. You can change it again after {0}.':
            '用户名每 30 天只能修改一次，你可以在 {0} 后再次修改。',
        'The new username must be different from the current username.': '新用户名不能与当前用户名相同。',
        manage_username: '用户名管理',
        'Username Management': '用户名管理',
        'Target User': '目标用户',
        'Select User': '选择用户',
        'Are you sure you want to change your username? It can only be changed once every 30 days.':
            '是否确认修改用户名，30天内仅可修改一次',
        'Confirm username change': '确认',
        'Cancel username change': '取消',
    });
}
