import {
  Context,
  DomainModel,
  OplogModel,
  PERM,
  Schema,
  Service,
  TokenModel,
  UserAlreadyExistError,
  UserModel,
} from "hydrooj";

type RegistrationIdentity = {
  provider?: string;
  platform?: string;
  id?: string;
};

type RegistrationToken = {
  mail?: string;
  username?: string;
  redirect?: string;
  set?: Record<string, any>;
  setInDomain?: Record<string, any>;
  identity?: RegistrationIdentity;
};

function extractRegistrationCode(redirect: string) {
  // OAuth 回调在未找到账号时会跳到 /register/:code，这里只提取 code
  const marker = "/register/";
  const index = redirect.indexOf(marker);
  if (index < 0) return "";
  const suffix = redirect.slice(index + marker.length);
  return suffix.split(/[?#/]/)[0] || "";
}

function generateRandomUname() {
  // 按需求走 # + 4 位数字，冲突时上层会继续重试
  const randomFourDigits = Math.floor(Math.random() * 10000)
    .toString()
    .padStart(4, "0");
  return `#${randomFourDigits}`;
}

function getFallbackMail() {
  // 部分第三方身份不会返回邮箱，这里兜底一个本地域名邮箱
  return `${Math.random().toString(36).slice(2, 14)}@invalid.local`;
}

function isUserAlreadyExistError(error: any) {
  return (
    error instanceof UserAlreadyExistError ||
    error?.name === "UserAlreadyExistError"
  );
}

export default class HutAutoRegisterService extends Service {
  static inject = ["oauth"];

  static Config = Schema.object({
    enabled: Schema.boolean().default(true),
    // 兼容旧配置，单 provider 写法仍然可用
    provider: Schema.string().default(""),
    // 默认仅支持正式 HUT provider
    providers: Schema.array(Schema.string()).default(["hut"]),
    unameRetryMax: Schema.number().default(10),
  });

  constructor(
    ctx: Context,
    config: ReturnType<typeof HutAutoRegisterService.Config>
  ) {
    super(ctx, "oauth.hut-autoregister");

    const providers = new Set(
      (config.providers && config.providers.length
        ? config.providers
        : [(config.provider || "").trim() || "hut"])
        .map((i: string) => i.trim())
        .filter(Boolean)
    );
    const retryMax = Math.max(1, Math.floor(config.unameRetryMax || 10));

    ctx.on("handler/after/OauthCallback", async (that: any) => {
      // 插件只处理命中的 provider，避免误改其他第三方登录
      if (!config.enabled) return;
      const currentProvider = String(that.args?.type || "").trim();
      if (!providers.has(currentProvider)) return;

      const redirect = that.response?.redirect;
      // 只有原流程准备跳注册页时才接管，不影响已有账号的直接登录
      if (typeof redirect !== "string" || !redirect.includes("/register/")) return;

      const code = extractRegistrationCode(redirect);
      if (!code) return;

      const tdoc = (await TokenModel.get(
        code,
        TokenModel.TYPE_REGISTRATION
      )) as RegistrationToken | null;
      // token 缺失或第三方身份不完整时回退原注册页流程
      if (!tdoc?.identity?.id) return;
      const tokenProvider = String(
        tdoc.identity.provider || tdoc.identity.platform || currentProvider
      ).trim();
      if (!providers.has(tokenProvider)) return;

      const userId = String(tdoc.identity.id || "").trim();
      // 学号不足六位时拒绝自动注册
      if (userId.length < 6) {
        console.warn(
          `[hut-autoregister] userId too short for default password, fallback to manual register token=${code}`
        );
        return;
      }
      const initialPassword = userId.slice(-6);

      const domainId =
        String(that.args?.domainId || that.domain?._id || "system") || "system";
      const mail = tdoc.mail || getFallbackMail();
      const ip = that.request?.ip || "127.0.0.1";
      const tried = new Set<string>();
      const candidates: string[] = [];
      const preferred = (tdoc.username || "").trim();
      if (preferred) candidates.push(preferred);
      for (let i = 0; i < retryMax; i++) candidates.push(generateRandomUname());

      let uid = 0;

      try {
        for (const candidate of candidates) {
          if (!candidate || tried.has(candidate)) continue;
          tried.add(candidate);

          const exists = await UserModel.getByUname("system", candidate);
          if (exists) continue;

          try {
            // 默认密码使用学号后六位
            uid = await UserModel.create(mail, candidate, initialPassword, undefined, ip);
            break;
          } catch (error: any) {
            if (!isUserAlreadyExistError(error)) throw error;

            // 并发下若用户名/邮箱被抢占，优先复用同邮箱已创建账号
            const byMail = await UserModel.getByEmail("system", mail);
            if (byMail?._id) {
              uid = byMail._id;
              break;
            }
          }
        }

        if (!uid) {
          const byMail = await UserModel.getByEmail("system", mail);
          if (!byMail?._id) {
            console.warn(
              `[hut-autoregister] unable to allocate username for token ${code}, fallback to manual register`
            );
            return;
          }
          uid = byMail._id;
        }

        if (tdoc.set && Object.keys(tdoc.set).length) {
          await UserModel.setById(uid, tdoc.set);
        }
        if (tdoc.setInDomain && Object.keys(tdoc.setInDomain).length) {
          await DomainModel.setUserInDomain(domainId, uid, tdoc.setInDomain);
        }

        await ctx.oauth.set(tdoc.identity.platform || currentProvider, tdoc.identity.id, uid);
        await TokenModel.del(code, TokenModel.TYPE_REGISTRATION);

        const udoc = await UserModel.getById("system", uid);
        if (!udoc) {
          console.warn(
            `[hut-autoregister] user ${uid} created but not readable, fallback to manual register`
          );
          return;
        }

        await UserModel.setById(uid, { loginat: new Date(), loginip: ip });
        that.context.HydroContext.user = udoc;
        that.session.viewLang = "";
        that.session.uid = uid;
        that.session.sudo = null;
        that.session.sudoUid = null;
        that.session.scope = PERM.PERM_ALL.toString();
        that.session.oauthBind = null;
        that.session.recreate = true;

        try {
          await OplogModel.log(that, "user.loginSuccess", { uid });
        } catch (error) {
          console.warn("[hut-autoregister] failed to write login oplog", error);
        }

        that.response.redirect = tdoc.redirect || "/";
        console.info(`[hut-autoregister] auto register success uid=${uid}`);
      } catch (error) {
        // 兜底策略是保留原跳转，让用户走手动注册页
        console.error("[hut-autoregister] auto register failed, fallback to manual", error);
      }
    });

  }
}
