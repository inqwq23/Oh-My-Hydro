# HUTOJ OAuth

供第三方报名系统读取用户授权的 HUTOJ 基础资料和实名资料。每次授权均需用户确认；申请实名资料时必须已完成有效实名。访问令牌默认 10 分钟，不提供刷新令牌。

## 安装

在当前 Hydro 仓库环境中注册插件：

```bash
hydrooj addon add /root/Hydro/usraddons/hutoj-oauth
```

启用 `realname-superhut`，并一并部署本次对该插件的 `revision` 更新。它让每次实名写入产生新的版本，即使两次认证的时间戳相同，也会使旧授权失效。原有记录仍可使用，下一次认证会自动补充版本。修改资料应使用实名插件提供的写入方法；直接恢复数据库旧快照不属于授权版本机制支持的修改方式。

本插件使用 Hydro 的 TypeScript 加载器，无需生成 `index.js`。重启 Hydro 后加载路由和模板。生产环境使用 HTTPS，反向代理应正确传递外部协议和 Host。不要记录 Authorization 请求头或 token 接口请求体。

可选插件配置（Hydro `/manage/config`）：

```yaml
hutoj-oauth:
  accessSeconds: 600
  allowLoopbackHttp: false
```

访问令牌有效期必须是 60–3600 的整数。授权请求有效期固定 10 分钟，授权码固定 60 秒。`allowLoopbackHttp` 只允许注册 localhost、127.0.0.1 或 [::1] 的 HTTP 回调，默认关闭；回调端口和路径仍须精确匹配。插件不开放浏览器跨站 CORS，报名系统通过后端访问 API。

## 应用管理

命令需在加载了该插件、可连接 Hydro 数据库的管理员环境中运行。CLI 参数中的回调地址使用 JSON 数组。

```bash
# 创建应用，允许申请基础资料和实名资料
hydrooj cli hutojOAuth create '报名系统' '["https://registration.example/oauth/callback"]' 'profile realname'

# 查看应用配置（不返回密钥摘要）
hydrooj cli hutojOAuth list

# 更新应用名称、回调地址和 scope
hydrooj cli hutojOAuth update 'hto_c_替换为应用ID' '报名系统' '["https://registration.example/oauth/callback"]' 'profile realname'

# 禁用、重新启用、重置密钥
hydrooj cli hutojOAuth disable 'hto_c_替换为应用ID'
hydrooj cli hutojOAuth enable 'hto_c_替换为应用ID'
hydrooj cli hutojOAuth rotateSecret 'hto_c_替换为应用ID'
```

创建和重置返回一次明文 `client_secret`，请直接保存到报名系统后端的密钥配置中；不要提交到代码仓库。`_id` 即 API 的 `client_id`。数据库只保存密钥摘要，无法通过 list 取回明文。

更新配置、禁用、重新启用和重置密钥都会更换应用版本，使旧授权请求、授权码和访问令牌失效。重新启用不会恢复旧授权。不同应用分别保存权限和回调地址。

## 使用约定

- `profile` 必选，返回全站 `uid` 和当前 `username`。报名系统使用 UID 关联账号。
- `realname` 可选，返回姓名、学号、班级、身份类型及 `verified: true`。
- CAS 与管理员录入的完整实名记录均认可；关闭资料页实名展示不会阻止用户主动授权。
- 未实名时显示实名入口，用户完成后回报名系统重新发起；不会自动继续本次请求。
- 重新实名、实名资料变化或记录删除后，旧实名授权不能兑换或取数。
- 应用禁用、账号不可用、令牌过期时，资料访问被拒绝。
- 已经交付给报名系统的数据不会被令牌失效机制远程收回。

详细协议、错误码及接入示例见 [API 文档](docs/API.md)，需求与设计记录见 [开发计划](PLAN.md)。

## 开发验证

从已安装依赖的 Hydro 仓库执行：

```bash
cd usraddons/hutoj-oauth
npm run typecheck
npm test
```

测试依赖宿主工作区的 `typescript`、`mongodb`、`mongodb-memory-server`、`@hydrooj/register`、`koa`、`koa-body`、`supertest` 和 `nunjucks`。使用 Node.js 24 测试；MongoDB 默认使用 `/usr/bin/mongod`，可通过 `MONGOMS_SYSTEM_BINARY` 指定可执行文件。测试创建独立临时数据库进程，不读取站点现有数据库。

类型检查报告插件自身的诊断；Hydro 源码在本插件严格选项下产生的依赖诊断被排除。数据库测试覆盖实际 MongoDB 原子兑换与授权失效；HTTP 测试使用真实的 Hydro Handler 和响应渲染层，但替换站点登录态及数据服务。上线前仍需在目标 Hydro 站点完成登录、CAS、CLI 和报名系统端到端联调。
