# 客户端协议 v1

0.9.3 在 POST session 时要求 X-HUTOJ-Heartbeat-Seconds: 5。首次进入题目页后连续 15 秒未收到有效心跳，服务端将超时时刻写入该选手的 Hydro endAt。比赛主持人收到系统消息，监控页返回 offlineAt 并显示掉线通知。管理员可以使用 Hydro 自带的 resume 恢复参赛。

0.4.0 桌面客户端使用专用 `Authorization: Bearer hcc_<token>` 和 `X-HUTOJ-Client-Device: <deviceId>`。它只授权指定域、比赛、设备的参赛操作，不是普通 Hydro 登录会话。原有 Hydro Cookie／Hydro session 接口仍保留，供网页管理与旧协议兼容；客户端租约 token 与登录授权是两种不同凭据。

请求加 `Accept: application/json`；POST JSON 加 `Content-Type: application/json`。文中的路径是默认域示例，非默认域应使用 Hydro 返回的 URL。禁止跨站 Origin；Electron 主进程请求可省略 Origin。

0.9.0 的比赛策略增加布尔值 `restrictNetwork`、`blockBlacklistApps`、`blockUsbStorage`、`forceFullscreen`，分别对应禁止网络、禁止黑名单应用（含本地 AI／AI 插件）、禁止 USB 存储、始终强制全屏；默认值为 `true,true,true,false`。管理员比赛客户端配置表单中未勾选的开关保存为 `false`；保存会增加原有策略版本，旧的环境就绪声明失效。session/snapshot 返回同名策略字段。心跳新增布尔值 `usbStorageBlocked`；网络、进程与 USB 的就绪要求仅在对应策略开启时校验，`screenCapturing` 始终必需。0.9.0 插件与客户端应一同更新。

session/snapshot 的 `user` 增加当前登录选手自己的 `className`、`studentId`、`realName`，从已验证的 `realname_superhut` 记录读取，不接受客户端提交作为显示来源，不向其他选手返回这些字段。字段不进入诊断上报。

## 流程

1. 通过下方实名授权流程核对学号和姓名，取得仅保存在主进程内存的专用 Bearer 授权。
2. `GET /contest-client` 返回 `selectionRequired`、所有已报名且未结束的 `contests` 以及 `selectionUrl`。未开始的个人限时赛允许登录，`startAt=null` 不表示已结束。这个操作不会报名或启动作答计时。
3. 用户确认比赛卡片后，`POST selectionUrl`，JSON `{"contestId":"24位比赛ID","contestDomain":"比赛域ID"}`。0.7.0 卡片含 `domainId`；服务器响应 `{contestId,domainId,basePath}`，客户端验证其属于同一平台的所选域后，将后续 bootstrap、session 和业务请求切到该域。访问授权在服务器原子锁定目标域与比赛，不能改选；同一域、同一比赛重试允许。原发现域仅保留选择接口的幂等重试，不能再访问 bootstrap 或业务；未选择时不能访问目标域。同 ID 出现在不同域时必须明确指定域，旧单域客户端可省略 `contestDomain`。重新读取 bootstrap 后再 `POST sessionUrl`，附 `X-HUTOJ-Client-Key: <部署密钥>`，JSON `{"deviceId":"机房安装时生成的稳定ID"}`。ID 为 16–128 字符的字母、数字、下划线或连字符；重启不更换 ID。
4. 从响应保存 `token`，后续请求附 `X-HUTOJ-Client-Session: <token>`。token 应保存在 Electron 主进程，按 HUTOJ 精确源及路径注入；禁止发送给媒体节点、外站或任意导航地址。
5. 跨域模式在确认比赛后将目标域显示名设为实名姓名；旧单域模式在兑换授权时设置。客户端不再填写姓名，不开放改名接口；旧的 `urls.displayName` 仅供旧版 Hydro 会话兼容，专用授权不可访问。
6. 完成网络、进程与屏幕监控后，`POST urls.ready`，JSON `{"networkControlled":true,"screenCapturing":true,"processMonitored":true}`。只有相应功能实际运行后才报告 true。服务端要求非空域内显示名和三项环境状态都就绪；ready 不启动个人计时。
7. ready 成功后访问 `urls.problems`；**仅此时**由 Hydro 原生题目列表启动个人计时。开始前不可预取此 URL。
8. 比赛环境每 5 秒在本地复查黑名单进程、常见本地 AI 服务和 VS Code 系列已启用的 AI 插件，复用已启动的辅助进程并缓存未变化的插件状态。结果通过串行心跳提交三个环境布尔值、最多 50 条 `processEvents`、最多 100 条 `environmentIssues`（`key/name/kind`）。0.9.3 每 5 秒发送心跳，设备绑定租约为 90 秒；普通读取和提交不会续租。
9. 题目和提交复用 Hydro 原路由，例如 `/p/1000?tid=<比赛ID>` 与 POST `/p/1000/submit?tid=<比赛ID>`（`lang`、`code`），附两种 token。语言、题目和成绩以原生 API 响应为准。专用授权使用 HTTP 轮询记录，不开放 WebSocket/SSE。
10. 提前结束复用 `POST urls.contest`，JSON `{"operation":"early_end"}`。之后查询 `GET urls.session`，仅当 `unlockAllowed=true` 时解除管控。超时先查询，不以点击成功或本地计时解锁。

租约过期后，`GET urls.session` 仍可通过尚未被轮换的 token 查询真实结束状态，但不会续租。继续比赛须按步骤 3 重建会话，再次 ready。恢复比赛后必须重新准备环境；不能永久缓存 ended。

0.7.1 的 POST session、heartbeat 和 ready 可附 `deviceInfo: {system: "Windows 10 Pro（10.0.19045，x64）", ip: "192.168.1.20"}`。`system` 为 1–160 字符且不得含控制字符，`ip` 可省略，存在时必须是有效 IPv4／IPv6 地址。系统和 IP 由客户端上报，IP 优先取连接平台所用网卡的本地地址；路由识别不发送 UDP 数据，结果缓存 60 秒。旧客户端可完全省略此字段；同一设备重建旧协议会话时清除旧设备信息，避免误显示。设备信息仅用于管理员监控展示，不作为身份、权限或网络放行依据。

管理员监控页 GET JSON 的每个 `clients[]` 记录增加 `deviceInfo: {system,ip}`，缺失值为空字符串。页面选择选手后显示该信息，并每 5 秒刷新；客户端 session/snapshot 响应不返回此管理员字段。监控接口继续要求比赛管理权限。

进入题目列表后，持续违规满 60 秒触发 `environmentWarning.forced`；该内部倒计时不向选手显示。强制警告会保留到管理员解除，关闭应用、禁用插件或重启客户端不解除已保存的警告。客户端断网时仍使用单调时钟进行本地升级。网页管理员在监控页选择选手，点击“解除全屏警告”；接口为监控页 POST `action="clear-warning"`、`uid`、`warningId` 和会话 CSRF，权限与赛事管理一致。`warningEpoch` 防止旧检测请求覆盖管理员解除操作；仍有违规时开始新的处理期限。AI 插件仅提示自行禁用或卸载，客户端不修改编辑器配置。

## 实名授权

按管理员选择，仅核对 `realname_superhut` 已有学号、姓名，不经过学校 CAS。学号必须唯一，姓名严格匹配；未实名、重复学号、禁用账号或没有已报名客户端比赛时拒绝。普通网页账号登录方式不受影响。

客户端生成随机 `state`、43–128 字符的 `code_verifier` 和 `code_challenge=BASE64URL(SHA256(code_verifier))`（[S256 PKCE](https://www.rfc-editor.org/rfc/rfc7636.html)）。两个 POST 都携带部署密钥 `X-HUTOJ-Client-Key`：

1. `POST /contest-client/oauth/authorize`：JSON 包含 `client_id="hutoj-contest-client"`、`redirect_uri="hutoj-client://oauth/callback"`、`response_type="code"`、`scope="contest:client"`、`studentId`、`name`、`deviceId`、`state`、`code_challenge_method="S256"`、`code_challenge`。0.7.0 另带 `contest_scope="all-domains"`，按域访问权限、分组与账号固定比赛域限制汇总赛事；省略时保持旧单域协议。返回 `{code,state}`。
2. 核对 state，`POST /contest-client/oauth/token`：JSON 包含相同 `client_id`、`redirect_uri`、`deviceId`，以及 `grant_type="authorization_code"`、`code`、`code_verifier`。返回 `{access_token,token_type:"Bearer",scope:"contest:client",expires_in:86400}`。

这是本客户端专用的 JSON 授权交换，固定注册回调标识，不提供浏览器跳转或通用第三方 OAuth 接入。授权码 60 秒过期，原子兑换且只能使用一次；访问授权 24 小时过期，重新核验账号和实名版本。凭据仅存 SHA-256；TTL 清理不替代请求时的过期检查。登录错误统一返回 `REALNAME_LOGIN_FAILED`，按 IP 和学号摘要限流。

专用授权仅允许客户端 bootstrap／租约、分配题目和图片、提交／自测、个人提交记录、比赛排行榜／答疑／提前结束。严格限定比赛、题目、记录归属、请求参数与设备；管理员账号同样按选手权限处理。禁止账号设置、管理接口、他人记录、跨域／跨比赛、额外上下文注入及 WebSocket。它不能作为 Cookie 或普通 Hydro Bearer 会话使用。媒体请求与离开比赛域路径的签名存储跳转不携带该凭据。

## 会话响应

0.4.1 起，bootstrap 的 `contest.descriptionHtml` 是 Hydro 原生 Markdown 渲染后的比赛说明，仅随登录返回。会话的 `contest.scheduledEndAt` 为比赛原定结束时间，`durationHours` 为显示时长（优先使用弹性赛配置，否则使用起止时间差），`personalDurationHours` 为弹性赛个人时长或 null。`endAt` 继续表示个人实际结束上限。客户端进入前展示原定起止时间与配置时长，不预取题目列表。

`POST /contest-client/session` 返回下列结构并额外带一次性返回的 `token`。`GET /contest-client/session`、POST heartbeat 和 ready 返回同样结构但无 token。

```json
{
  "protocolVersion": 1,
  "serverTime": "2026-11-03T01:00:00.000Z",
  "user": { "id": 2, "username": "contestant", "displayName": "张三" },
  "contest": {
    "id": "0123456789abcdef01234567", "title": "测试比赛",
    "beginAt": "2026-11-03T01:00:00.000Z",
    "endAt": "2026-11-03T04:00:00.000Z", "startAt": null
  },
  "phase": "preparing", "ready": false, "unlockAllowed": false,
  "session": { "id": "媒体流会话ID", "expiresAt": "2026-11-03T01:01:30.000Z", "heartbeatSeconds": 5 },
  "policy": {
    "version": 1, "requireClient": true, "clientOnly": false,
    "networkAllowHosts": [],
    "networkAllowEndpoints": [],
    "processPolicy": { "names": ["chrome.exe", "msedge.exe"], "keywords": [], "whites": [] },
    "capture": { "fps": 10, "bitrateKbps": 2000 },
    "whipUrl": ""
  },
  "urls": {
    "session": "/contest-client/session", "heartbeat": "/contest-client/heartbeat",
    "ready": "/contest-client/ready", "displayName": "/home/settings/domain",
    "contest": "/contest/0123456789abcdef01234567",
    "problems": "/contest/0123456789abcdef01234567/problems",
    "records": "/record?tid=0123456789abcdef01234567&uidOrName=2"
  }
}
```

`contest.endAt` 是全局结束、个人提前结束、个人时长上限中的最早时间。仅在服务端确认个人结束或管理员显式取消客户端要求时，`unlockAllowed` 为 true。

| phase | 含义 |
| --- | --- |
| waiting | 比赛未开始，可先准备环境；不访问题目列表 |
| preparing | 比赛已开始，但本客户端环境尚未就绪或就绪失效 |
| active | 比赛进行中且本客户端已就绪；是否计时由 startAt 表示 |
| ended | Hydro 确认该选手比赛结束 |
| released | 管理员已关闭本比赛的客户端要求 |

`ready` 表示当前租约和策略下环境声明有效，不表示题目列表已打开或媒体平台已录到画面。

## 错误

插件错误沿用 Hydro 格式：`error.name = "HutojClientError"`，稳定错误码位于 `error.params[0]`。原生登录、题目、提交、显示名校验的错误仍由 Hydro 返回。任何非成功响应都不能当作解锁凭据。

| HTTP | 主要错误码 | 处理 |
| --- | --- | --- |
| 404 | NO_CLIENT_CONTEST | 检查当前域、参赛名单和比赛客户端开关 |
| 409 | MULTIPLE_CLIENT_CONTESTS | 管理员检查重叠比赛，不让客户端猜测 |
| 503 | CLIENT_KEY_NOT_CONFIGURED | 配置至少32字符的部署密钥 |
| 403 | INVALID_CLIENT_KEY | 检查部署密钥 |
| 409 | DEVICE_IN_USE | 原设备仍有租约；退出原客户端并等待90秒 |
| 403 | CLIENT_SESSION_REQUIRED / CLIENT_SESSION_EXPIRED | 建立或重建客户端会话 |
| 409 | CLIENT_SESSION_CHANGED | 重新读取会话，再串行重试；旧状态不能覆盖恢复操作 |
| 403 | CLIENT_CONTEST_REQUIRED / CLIENT_CONTEST_MISMATCH | 检查 tid、域、用户与 token 是否匹配 |
| 409 | CLIENT_NOT_READY / DISPLAY_NAME_REQUIRED | 完成显示名及环境准备，重新 ready |
| 403 | CONTEST_MEMBERSHIP_REMOVED | 联系管理员，不能自动解锁 |
| 409 | CONTEST_NOT_ACTIVE | 不再接受 ready 或显示名准备请求，查询会话状态 |
| 400 | DISPLAY_NAME_ONLY / INVALID_* | 修正请求字段；显示名写入不可混入其他设置 |
| 403 | INVALID_ORIGIN / INVALID_CSRF / CONTEST_MANAGEMENT_REQUIRED | 检查请求来源、管理员会话及权限 |

## 管理接口

比赛编辑页通过“更新”保存两项设置。`requireClient` 是沿用的协议字段，表示“允许客户端”。`clientOnly` 表示“仅允许比赛客户端”，启用时同时将 `requireClient` 设为 true。已有数据缺少 `clientOnly` 时按 false 处理。选手通过客户端参赛时，两种模式都要求有效且就绪的会话。仅客户端模式也会校验选手通过网页请求的题目、提交和评测记录。两项都关闭后，现有会话读取状态时收到 `released`。

GET `/contest/:tid/client`：调试参数页；`Accept: application/json` 时返回 `{tdoc,policy,csrf}`。POST 同地址保存调试参数，必须携带 GET 得到的 `csrf`，使用同一 Hydro 管理员会话。此接口不修改比赛客户端开关。

调试字段：`captureFps`、`captureBitrateKbps`、`networkAllowHosts`、`networkAllowEndpoints`、`processBlackList`、`keywordBlackList`、`keywordWhiteList`。客户端按所选显示器原始分辨率采集，服务端不设置宽高。主机名单为数组或按空白／逗号分隔的文本，仅增加 TCP 80/443；端点数组或按行分隔，必须是 `tcp://主机:端口` 或 `udp://主机:端口`。进程名单数组或按行分隔、每项最多 160 字符、每份最多 64 项；白名单优先，名称精确匹配，关键词忽略大小写匹配名称和程序描述。保存使现有 ready 失效。`requireClient` 和 `clientOnly` 均由比赛编辑页控制。

全局媒体字段在控制面板“系统设置 → 比赛客户端”保存，使用 Hydro 原生 `/manage/config` 与系统管理权限：`contestClient.whipUrlTemplate`、`contestClient.mediaApiUrl`、`contestClient.mediaPlaybackUrl`。适用于所有域和比赛，比赛设置 POST 中的同名字段会被忽略。GET 比赛设置返回合并后的有效值。`policy.version` 是有效策略的不透明数字修订标识，比赛设置或全局媒体地址变化都会改变它，客户端只应比较是否相等。

`processEvents` 项为 `{id,pid,name,description,rule}`：id 为 UUID，rule 以 `process:` 或 `keyword:` 开头。服务端绑定已认证的用户、域、比赛，对重试按 id 去重，忽略客户端时间，加入服务器 `at`，保留最近 200 条。客户端不上传全部进程、路径或命令行；进程告警本身不自动清除就绪，采集器停止则必须报告 `processMonitored=false`。

插件没有为选手创建新报名、选赛、结束或恢复接口；这些功能由 Hydro 原生接口负责。

## 管理员屏幕监控

GET `/contest/:tid/client/monitor` 返回管理网页，JSON 返回选手和连接状态，不返回 tokenHash 或部署密钥。POST 使用 `action:watch|keepalive|stop` 与管理员 session 的 CSRF；watch 的 `uid,sdp` 仅用于本比赛选手当前会话，服务端转发到对应 WHEP 地址，返回随机查看句柄及 SDP。每位管理员在一场比赛中最多保留一个实时订阅，离开页面或心跳中断后释放。

GET 同地址 `?recordings=uid` 列出本比赛该选手的录像；GET `/contest/:tid/client/monitor/recording?path=...&start=...&duration=...` 流式播放 MP4，每次请求重新校验比赛管理权限和域/比赛/选手路径。每次最多播放 300 秒，页面按录像片段选择；选手不得调用以上接口。历史参赛者在客户端会话过期后仍能从参赛名单选择回放。

GET 同地址 `?events=uid` 返回 `{events:[...]}`，按新到旧排序，仅比赛管理者可查看；普通监控列表只返回每人 `processMonitored` 与 `violations` 数量，不泄露 token 或完整记录。

全局字段 `mediaApiUrl` 和 `mediaPlaybackUrl` 为 Hydro 服务端可访问的 MediaMTX 控制 API 和回放服务地址，不下发给比赛客户端。媒体 API、回放端口可仅监听回环地址；浏览器通过 Hydro 访问。本机值为 `http://127.0.0.1:9997` 和 `http://127.0.0.1:9996`。WHIP 模板须在路径内包含 `{domainId}/{contestId}/{uid}/{sessionId}` 并以 `/whip` 结束，以对应 WHEP 和录像路径。配置与播放参数依据 [MediaMTX 回放接口](https://mediamtx.org/docs/features/playback)。

## 原生比赛功能与渲染

客户端使用原生 `/p/:pid/submit?tid=...`，普通提交发送 `pretest:false`，自测发送 `pretest:true,input:[...]`。通过原生 `/record/:rid?tid=...` 跟踪判定与编译/运行输出，完成后停止轮询。自测使用 Hydro 保留的全零比赛 ID，守卫仅允许当前选手查看当前比赛题目上的本人自测；不计入正式提交与排行榜。

提交记录使用 `/record?tid=...&uidOrName=...&page=...`；排行榜使用 `/contest/:tid/scoreboard`；公告和答疑使用 `/contest/:tid/problems` 原生返回的 `tcdocs`。提问 POST 到同一地址，发送 `operation:clarification,subject,content`，保留原生限流、选手隐私与裁判消息流程。

带有效客户端 token 的 JSON GET 响应增加 `clientView`，网页端响应不变：题目包含 `statementHtml,statementLanguages,canPretest,canViewRecord`，题目列表包含 `clarifications`（仅公告和本人/队伍的问题及回复），排行榜包含 `scoreboardHtml`，评测详情包含 `statusHtml`（仅在原生接口允许查看时）。全部使用当前 Hydro 的模板、content/markdown 过滤器和原生记录模板生成；状态名称/样式映射来自 `model.builtin`。客户端补充同版 KaTeX 的长公式渲染及样例排列，不自行解析多语言 JSON。封榜和成绩可见性由原生处理器控制。
