import {
    Context,
    CreateError,
    db,
    definePlugin,
    Handler,
    type HydroError,
    PRIV,
    Schema,
    Service,
    superagent,
    SystemModel,
    TokenModel,
    UserFacingError,
    UserModel,
    ValidationError,
} from 'hydrooj';

interface RealnameInfo {
    uid: number;
    studentId: string;
    studentIdClaimed?: boolean;
    className: string;
    realName: string;
    identityType: string;
    showRealName: boolean;
    verifiedAt: Date;
    source: 'cas' | 'cli';
}

type UserDetailRealnameView = Pick<
    RealnameInfo,
    'studentId' | 'className' | 'realName' | 'identityType' | 'showRealName' | 'verifiedAt' | 'source'
> & {
    verified: boolean;
};

declare module 'hydrooj' {
    interface Model {
        realnameSuperhut: {
            setRealnameInfo: typeof setRealnameInfo;
            getRealnameInfo: typeof getRealnameInfo;
        };
    }
    interface Collections {
        realname_superhut: RealnameInfo;
    }
    interface Context {
        realnameCas: RealnameCasService;
    }
}

const coll = db.collection('realname_superhut');
const StudentIdInUseError = CreateError('StudentIdInUseError', UserFacingError, function (this: HydroError) {
    const [ownerUid] = this.params;
    if (ownerUid === undefined) return '该学号的绑定状态已变化，请重新认证';
    return `该学号已在其他账号完成实名认证（UID：${ownerUid}）`;
});
let realnameIndexes: Promise<string[]> | undefined;
const XML_ENTITY_REGEXP = /&(amp|lt|gt|quot|apos);/g;
const XML_SPACE_REGEXP = /\s+/g;
const CAS_SERVER_TRAILING_SLASH_REGEXP = /\/+$/;

const xmlDecodeMap: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
};

function decodeXml(value: string) {
    return value.replace(XML_ENTITY_REGEXP, (match) => xmlDecodeMap[match] || match).trim();
}

function casTagPattern(tag: string) {
    return `(?:\\w+:)?${tag}`;
}

function readCasTag(xml: string, tag: string) {
    const pattern = new RegExp(`<${casTagPattern(tag)}[^>]*>([\\s\\S]*?)</${casTagPattern(tag)}>`, 'i');
    return decodeXml(pattern.exec(xml)?.[1] || '');
}

function hasCasTag(xml: string, tag: string) {
    return new RegExp(`<${casTagPattern(tag)}(?:\\s|>)`, 'i').test(xml);
}

function readCasFailureCode(xml: string) {
    const pattern = new RegExp(`<${casTagPattern('authenticationFailure')}[^>]*\\bcode=["']([^"']+)["']`, 'i');
    return decodeXml(pattern.exec(xml)?.[1] || '');
}

function readCasFailureMessage(xml: string) {
    return readCasTag(xml, 'authenticationFailure').replace(XML_SPACE_REGEXP, ' ');
}

function readCasFailureReason(xml: string) {
    const code = readCasFailureCode(xml);
    const message = readCasFailureMessage(xml);
    if (code && message && code !== message) return `${code}: ${message}`;
    return code || message || '认证失败';
}

// 设置实名信息
export async function setRealnameInfo(
    uid: number,
    studentId: string,
    className: string,
    realName: string,
    identityType: string,
    source: 'cas' | 'cli' = 'cli',
) {
    const normalizedStudentId = `${studentId}`.trim();
    const normalizedClassName = `${className}`.trim();
    const normalizedRealName = `${realName}`.trim();
    const normalizedIdentityType = `${identityType}`.trim();
    const payload = {
        uid,
        studentId: normalizedStudentId,
        className: normalizedClassName,
        realName: normalizedRealName,
        identityType: normalizedIdentityType,
        showRealName: true,
        verifiedAt: new Date(),
        source,
    };
    if (!payload.studentId || !payload.className || !payload.realName || !payload.identityType) {
        throw new UserFacingError('realname_invalid', '实名信息不完整');
    }
    // 历史记录里有重复学号。只对新版写入强制唯一，同时检查旧记录的占用情况。
    realnameIndexes ??= coll.createIndexes([
        { key: { uid: 1 }, name: 'uid_1', unique: true },
        { key: { studentId: 1 }, name: 'claimed_studentId', unique: true, partialFilterExpression: { studentIdClaimed: true } },
    ]).catch((error) => {
        realnameIndexes = undefined;
        throw error;
    });
    await realnameIndexes;
    const findOtherOwner = () => coll.findOne(
        { studentId: normalizedStudentId, uid: { $ne: uid } },
        { projection: { uid: 1, _id: 0 } },
    );
    const owner = await findOtherOwner();
    if (owner) throw new StudentIdInUseError(owner.uid);
    try {
        await coll.updateOne({ uid }, { $set: { ...payload, studentIdClaimed: true } }, { upsert: true });
    } catch (error: any) {
        if (error?.code === 11000 && error.keyPattern?.studentId === 1) {
            const currentOwner = await findOtherOwner();
            throw new StudentIdInUseError(currentOwner?.uid);
        }
        throw error;
    }
    await UserModel.setById(uid, {
        realnameVerified: true,
        realnameStudentId: payload.studentId,
        realnameClassName: payload.className,
        realnameName: payload.realName,
        realnameIdentityType: payload.identityType,
        realnameShowName: payload.showRealName,
        realnameVerifiedAt: payload.verifiedAt,
        realnameVerifySource: payload.source,
    });
    return payload;
}

// 获取用户实名信息
export async function getRealnameInfo(uid: number) {
    return await coll.findOne({ uid });
}

function buildUserDetailRealnameView(realname?: RealnameInfo | null): UserDetailRealnameView | null {
    if (!realname) return null;
    return {
        verified: true,
        studentId: realname.studentId,
        className: realname.className,
        realName: realname.realName,
        identityType: realname.identityType,
        showRealName: realname.showRealName,
        verifiedAt: realname.verifiedAt,
        source: realname.source,
    };
}

// 设置是否展示实名信息
export async function setShowRealName(uid: number, showRealName: boolean) {
    await coll.updateOne({ uid }, { $set: { showRealName } });
    await UserModel.setById(uid, { realnameShowName: showRealName });
}

/*
 * 暴露接口，可以使用命令行修改和查看实名信息
 * 设置实名：yarn hydrooj cli realnameSuperhut setRealnameInfo <uid> '<学号>' '<班级>' '<姓名>' '<身份>'
 * 查看实名：yarn hydrooj cli realnameSuperhut getRealnameInfo <uid>
 * 设置展示：yarn hydrooj cli realnameSuperhut setShowRealName <uid> <boolean>
 */

const realnameSuperhutModel = { setRealnameInfo, getRealnameInfo, setShowRealName };
global.Hydro.model.realnameSuperhut = realnameSuperhutModel;

class HomeRealnameHandler extends Handler {
    async get() {
        const realname = await getRealnameInfo(this.user._id);
        this.response.template = 'home_realname.html';
        this.response.body = {
            realname,
            canAuthorize: true,
        };
    }

    async post() {
        const realname = await getRealnameInfo(this.user._id);
        if (!realname) throw new UserFacingError('realname_missing', '请先完成实名认证');
        await setShowRealName(this.user._id, !!this.request.body?.showRealName);
        this.back();
    }
}

class RealnameCasAuthorizeHandler extends Handler {
    static inject = ['realnameCas'];

    async get() {
        const { state, ticket } = this.args;
        const service = this.ctx.realnameCas as RealnameCasService;
        if (ticket) {
            const redirect = await service.handleCallback(this, state, ticket);
            this.response.redirect = redirect;
            return;
        }
        this.response.redirect = await service.createAuthorizationUrl(this);
    }
}

class RealnameCasService extends Service {
    static Config = Schema.object({
        casServer: Schema.string().default('https://mycas.hut.edu.cn/cas'),
        service: Schema.string().description('CAS service callback override'),
    });

    constructor(ctx: Context, config: ReturnType<typeof RealnameCasService.Config>) {
        super(ctx, 'realnameCas');
        this.casServer = config.casServer.replace(CAS_SERVER_TRAILING_SLASH_REGEXP, '');
        this.serviceOverride = config.service?.trim();
    }

    private casServer: string;
    private serviceOverride?: string;

    private baseServiceUrl() {
        if (this.serviceOverride) return this.serviceOverride;
        const baseUrl = SystemModel.get('server.url');
        return `${baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`}home/realname/cas`;
    }

    private serviceWithState(state: string) {
        const service = this.baseServiceUrl();
        const joiner = service.includes('?') ? '&' : '?';
        return `${service}${joiner}state=${encodeURIComponent(state)}`;
    }

    async createAuthorizationUrl(handler: Handler) {
        const [state] = await TokenModel.add(TokenModel.TYPE_OAUTH, 600, {
            redirect: handler.url('home_realname'),
            uid: handler.user._id,
            purpose: 'realname-superhut',
        });
        const service = this.serviceWithState(state);
        return `${this.casServer}/login?service=${encodeURIComponent(service)}&state=${encodeURIComponent(state)}`;
    }

    async handleCallback(handler: Handler, state?: string, ticket?: string) {
        if (!state) throw new ValidationError('state');
        if (!ticket) throw new ValidationError('ticket');
        const token = await TokenModel.get(state, TokenModel.TYPE_OAUTH);
        if (!token || token.purpose !== 'realname-superhut') throw new ValidationError('token');

        const validateUrl = `${this.casServer}/serviceValidate`;
        const serviceUrl = this.serviceWithState(state);

        let xml = '';
        try {
            const res = await superagent
                .get(validateUrl)
                .query({ service: serviceUrl, ticket })
                .timeout({ response: 5000, deadline: 8000 })
                .buffer(true);
            xml = (res.text || '').trim();
        } catch (error: any) {
            throw new UserFacingError('cas_error', error?.message || 'CAS 验证服务异常');
        }

        if (!xml) throw new UserFacingError('cas_error', 'CAS 返回空响应');
        if (!hasCasTag(xml, 'authenticationSuccess')) {
            await TokenModel.del(state, TokenModel.TYPE_OAUTH);
            throw new UserFacingError('cas_auth_failed', readCasFailureReason(xml));
        }

        const attributesXml = readCasTag(xml, 'attributes');
        const studentId = readCasTag(attributesXml, 'accountName') || readCasTag(xml, 'user');
        const className = readCasTag(attributesXml, 'organizationName') || readCasTag(attributesXml, 'organizationCode');
        const realName = readCasTag(attributesXml, 'name') || readCasTag(attributesXml, 'userName');
        const identityType = readCasTag(attributesXml, 'identityTypeName') || readCasTag(attributesXml, 'identityTypeCode') || '无';

        if (!studentId || !className || !realName || !identityType) {
            await TokenModel.del(state, TokenModel.TYPE_OAUTH);
            throw new UserFacingError('realname_invalid', 'CAS 未返回完整信息');
        }

        await TokenModel.del(state, TokenModel.TYPE_OAUTH);
        await setRealnameInfo(token.uid, studentId, className, realName, identityType, 'cas');
        return token.redirect || handler.url('home_realname');
    }
}

export default definePlugin({
    name: 'realname-superhut',
    apply: (ctx) => {
        ctx.plugin(RealnameCasService);
        ctx.withHandlerClass('UserDetailHandler', (UserDetailHandler) => {
            const userDetailHandler = UserDetailHandler as typeof Handler & {
                prototype: Handler & { get: (...args: any[]) => Promise<void> };
            };
            const originalGet = userDetailHandler.prototype.get;
            userDetailHandler.prototype.get = async function getWithRealname(...args: any[]) {
                await originalGet.apply(this, args);
                const uid = Number(this.args?.uid ?? args[1]);
                if (!Number.isInteger(uid) || uid <= 0) return;
                const realname = buildUserDetailRealnameView(await getRealnameInfo(uid));
                this.response.body.realname = realname;
                if (realname && this.response.body.udoc) {
                    this.response.body.udoc.realname = realname;
                    this.response.body.udoc.realnameVerified = realname.verified;
                    this.response.body.udoc.realnameShowName = realname.showRealName;
                    this.response.body.udoc.realnameClassName = realname.className;
                    this.response.body.udoc.realnameName = realname.realName;
                    this.response.body.udoc.realnameIdentityType = realname.identityType;
                }
            };
        });
        ctx.Route('home_realname', '/home/realname', HomeRealnameHandler, PRIV.PRIV_USER_PROFILE);
        ctx.inject(['realnameCas'], ({ Route }) => {
            Route('home_realname_cas', '/home/realname/cas', RealnameCasAuthorizeHandler, PRIV.PRIV_USER_PROFILE);
        });
        ctx.injectUI('UserDropdown', 'home_realname', {
            icon: 'user',
            displayName: 'Real Name Settings',
        }, PRIV.PRIV_USER_PROFILE);

        ctx.i18n.load('zh', {
            'Real Name Settings': '实名认证',
            'Real Name Verification': '实名认证',
            Verified: '已实名',
            Unverified: '未实名',
            Authorize: '授权',
            'Authorize via HUT CAS': '通过智慧工大授权认证',
            home_realname: '实名认证',
        });

        global.Hydro.model.realnameSuperhut = realnameSuperhutModel;
    },
});
