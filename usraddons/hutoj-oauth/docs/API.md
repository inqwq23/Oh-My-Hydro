# HUTOJ OAuth API

版本：1.0。本文示例基地址为 `https://oj.example`，使用时替换成 HUTOJ 实际域名。

协议采用 OAuth 2.0 授权码流程和 PKCE S256。应用是具有后端的机密客户端；不提供 OIDC、ID Token、刷新令牌、动态注册或浏览器跨站 CORS。账号登录态由 HUTOJ 管理，应用不接触用户的 HUTOJ 密码。

## 接入前准备

管理员通过 [CLI](../README.md#应用管理) 创建应用，向报名系统后端配置 `client_id`、`client_secret` 和精确匹配的 `redirect_uri`。允许申请的 scope 由管理员配置。

客户端在发起授权时生成至少 128 位随机 `state` 和随机 PKCE `code_verifier`，保存在本次用户会话中。建议设置 10 分钟本地超时，多个标签页按 state 分别保存请求，避免覆盖。授权成功或失败后均消费本次 state。

## 1 发起授权

`GET /oauth2/authorize`，通过浏览器导航访问。

| 参数 | 规则 |
| --- | --- |
| `client_id` | 管理员创建应用时返回的 `_id` |
| `redirect_uri` | 与登记字符串完全一致，不接受通配符或 fragment |
| `response_type` | 固定 `code` |
| `scope` | `profile` 或 `profile realname`，空格分隔 |
| `state` | 必填，16–512 字符；客户端负责随机性、会话绑定及回调验证 |
| `code_challenge` | `BASE64URL(SHA256(code_verifier))`，43 字符，不含填充 |
| `code_challenge_method` | 固定 `S256` |

所有参数必填，不允许重复参数、未知参数或控制字符。`profile` 必须包含在 scope 中。回调地址默认仅允许 HTTPS；本地 HTTP 例外需要管理员显式开启。

未登录用户先进入 HUTOJ 登录页。登录后展示应用名称、当前账号和申请字段，每次都需要用户明确确认。

申请实名资料时，如果实名记录不完整或不存在，HUTOJ 显示实名入口，不签发授权码，也不回调第三方。用户完成实名后，应从报名系统重新发起授权。

用户同意后的浏览器回调：

```text
https://registration.example/oauth/callback?code=hto_code_...&state=...
```

用户拒绝后的回调：

```text
https://registration.example/oauth/callback?error=access_denied&state=...
```

授权码有效期 60 秒且仅可使用一次。非法授权请求在 HUTOJ 本地返回 JSON 错误，不重定向到请求中的回调地址。授权页打开后应用配置或实名信息变化，会拒绝旧确认，用户需重新发起。

`POST /oauth2/authorize` 仅供 HUTOJ 自身的确认表单使用。表单提交 `request_id` 和 `decision=allow|deny`，必须绑定同一登录会话；第三方不能代替用户调用。

## 2 兑换访问令牌

`POST /oauth2/token`

请求体必须为 `application/x-www-form-urlencoded`。只支持 `client_secret_basic`：HTTP Basic 用户名为 client_id，密码为 client_secret。禁止在查询参数或请求体提交应用凭据。

| 表单字段 | 规则 |
| --- | --- |
| `grant_type` | 固定 `authorization_code` |
| `code` | 回调得到的授权码 |
| `redirect_uri` | 必须与授权请求中的回调字符串一致 |
| `code_verifier` | 原始 PKCE 校验值，43–128 字符，仅字母、数字及 `-._~` |

```bash
# 环境变量由应用的安全配置提供；CODE 和 VERIFIER 来自本次授权会话。
curl --fail-with-body -u "$CLIENT_ID:$CLIENT_SECRET" \
  -X POST 'https://oj.example/oauth2/token' \
  --data-urlencode 'grant_type=authorization_code' \
  --data-urlencode "code=$CODE" \
  --data-urlencode "redirect_uri=$REDIRECT_URI" \
  --data-urlencode "code_verifier=$VERIFIER"
```

成功响应（HTTP 200）：

```json
{
  "access_token": "hto_at_...",
  "token_type": "Bearer",
  "expires_in": 600,
  "scope": "profile realname"
}
```

令牌有效期取决于管理员配置，以 `expires_in` 为准。不返回 refresh_token。并发兑换同一个授权码最多成功一次；网络错误时不能假设兑换未发生。

## 3 获取用户资料

`GET /oauth2/userinfo`

```bash
curl --fail-with-body 'https://oj.example/oauth2/userinfo' \
  -H "Authorization: Bearer $ACCESS_TOKEN"
```

不接受查询参数或 URL 中的令牌，不要求额外的 Accept 请求头。

仅授权 `profile`：

```json
{ "uid": 123, "username": "student" }
```

授权 `profile realname`：

```json
{
  "uid": 123,
  "username": "student",
  "realname": {
    "verified": true,
    "realName": "张三",
    "studentId": "202600001",
    "className": "计算机2601",
    "identityType": "学生"
  }
}
```

UID 是数字，用户名和学号是字符串。学号不得转为数字，以保留前导零。UID 用于关联同一 HUTOJ 站点内的账号，用户名可能变化。只有 realname scope 返回实名对象；认证时间、来源、展示设置、邮箱及其他用户属性不会返回。

## 错误与失效规则

API 错误采用 JSON，例如：

```json
{ "error": "invalid_grant" }
```

| error | HTTP 状态 | 处理方式 |
| --- | --- | --- |
| `invalid_request` | 通常 400；会话请求的 CSRF 拒绝为 403 | 检查编码、参数、回调地址及会话；不要自动重放用户确认 |
| `invalid_client` | 401，附 Basic WWW-Authenticate | 检查应用是否启用及密钥是否正确 |
| `invalid_scope` | 400 | 使用 profile，并检查应用是否允许 realname |
| `unsupported_response_type` | 400 | 使用 code |
| `unsupported_grant_type` | 400 | 使用 authorization_code |
| `access_denied` | 用户拒绝时随 302 回调；账号无权授权时为 403 | 尊重用户拒绝，不自动重复发起 |
| `authorization_changed` | 400 | 实名或账号状态在确认前发生变化，重新发起 |
| `invalid_grant` | 400 | 授权码过期、已使用、绑定不匹配或授权失效，重新发起 |
| `invalid_token` | 401，附 Bearer WWW-Authenticate | 令牌无效、到期或授权失效，重新发起 |
| `rate_limited` | 429 | 稍后重试，必要时重新发起授权 |
| `server_error` | 500 | 服务暂时不可用，避免记录或展示令牌信息 |

未知方法等 Hydro 框架拒绝也会返回 JSON，HTTP 状态沿用框架的 4xx。授权和 API 响应设置 `Cache-Control: no-store`。

授权请求最长 10 分钟。实名授权在确认、兑换和资料读取时均检查当前实名版本。重新认证、修改资料或删除记录会使旧实名授权失效；仅修改资料页展示开关不会失效。仅基础资料授权不依赖实名状态。

应用更新配置、禁用、重新启用或重置密钥均使旧授权失效。账号不存在或不能正常使用时，兑换和资料访问失败。令牌只能访问本插件资料接口，不是 Hydro 登录会话。

## 报名系统后端伪代码

以下代码展示接入顺序，`session.pendingOAuth` 表示报名系统自己的服务端会话存储。应使用持久化会话、HTTPS 和 HttpOnly Cookie。多进程应用应共享会话存储并原子消费 state。

```js
import { randomBytes, createHash } from 'node:crypto';

// 用户点击“通过 HUTOJ 授权”时
const state = randomBytes(32).toString('base64url');
const verifier = randomBytes(32).toString('base64url');
session.pendingOAuth[state] = { verifier, expiresAt: Date.now() + 600_000 };
const query = new URLSearchParams({
  client_id: CLIENT_ID,
  redirect_uri: REDIRECT_URI,
  response_type: 'code',
  scope: 'profile realname',
  state,
  code_challenge: createHash('sha256').update(verifier).digest('base64url'),
  code_challenge_method: 'S256',
});
// 保存会话后重定向浏览器到 `${HUTOJ_BASE}/oauth2/authorize?${query}`。

// 回调处理：严格读取单个 state/code/error 参数，不接受数组或重复值。
const pending = consumePendingOAuthAtomically(session, callback.state);
if (!pending || pending.expiresAt <= Date.now()) throw new Error('授权会话无效');
if (callback.error) return showAuthorizationDenied();
if (!callback.code) throw new Error('缺少授权码');

const tokenResponse = await fetch(`${HUTOJ_BASE}/oauth2/token`, {
  method: 'POST',
  headers: {
    Authorization: `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    'Content-Type': 'application/x-www-form-urlencoded',
  },
  body: new URLSearchParams({
    grant_type: 'authorization_code', code: callback.code,
    redirect_uri: REDIRECT_URI, code_verifier: pending.verifier,
  }),
  signal: AbortSignal.timeout(10000),
});
if (!tokenResponse.ok) throw new Error('授权码兑换失败');
const token = await tokenResponse.json();
const profileResponse = await fetch(`${HUTOJ_BASE}/oauth2/userinfo`, {
  headers: { Authorization: `Bearer ${token.access_token}` },
  signal: AbortSignal.timeout(10000),
});
if (!profileResponse.ok) throw new Error('资料读取失败，请重新授权');
const profile = await profileResponse.json();
// 校验返回结构及预期实名范围，以 profile.uid 关联账号。
// 绑定已有报名账号时，还需验证用户在报名系统内的登录状态。
// 完成后建立报名系统自己的会话；无需长期保存 HUTOJ 令牌。
```

HUTOJ_BASE、CLIENT_ID、CLIENT_SECRET 和 REDIRECT_URI 应来自固定后端配置，不能从不可信回调参数取得。
