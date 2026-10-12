# 私密访问记录

2026-10-03 已创建 D1 数据库并部署 Cloudflare Worker。`assets/js/visit-tracker.js` 已配置采集地址 `https://yirenzzz-private-visits.yirenzzz-visits.workers.dev/collect`；网站文件发布至 GitHub Pages 后开始采集。现有页面仅加载一个独立脚本，外观不变。

网站继续由 GitHub Pages 托管。后台采用 Cloudflare Worker 接收记录，D1 保存数据。只通过有数据库权限的 Cloudflare 账号或 CLI 查看；没有公开查询 API，没有前端统计版面，也没有放在 GitHub 仓库里的访问数据。请使用自己的 Cloudflare 账号，避免授予其他成员数据库读取权限。

## 记录内容和口径

增强采集版本：`engagement-20261011`。旧脚本继续兼容；新增字段只对升级后的访问生效，不补造历史数据。

| 内容 | 保存位置和含义 |
| --- | --- |
| IP、时间、位置 | `visits.ip / visited_at / country / region / city / timezone`；接收时间为 UTC，位置为 Cloudflare 推断的粗略位置 |
| 来源网站 | `referrer`；外站只保留域名，同站保留路径，不保留查询参数或片段；浏览器未提供时为空 |
| 浏览器、系统、设备 | `browser / browser_version / os / os_version / device_type`；从请求 UA 推断，版本受浏览器信息缩减影响，不保证等于真实版本 |
| 首次／再次访问 | `visitor_profiles` 保存随机浏览器标识的首次、最近访问；`session_summary.is_returning` 为 0 表示首次已知会话，1 表示后续会话，NULL 表示无法识别 |
| 访问路径 | `visits.path / previous_path / page_sequence`；`session_paths` 按会话提供访问步骤 |
| 页面停留时间 | `active_ms` 为前台可见累计毫秒，不代表真正阅读；`last_seen_at` 为最近收到上报的时间 |
| 滚动深度 | `max_scroll_pct` 为最远滚动进度 0–100；长页顶部为 0，到底为 100，整页可见为 100 |
| 链接点击 | `link_clicks` 保存时间、目标、链接文字、类型；关联 `page_id` 后可查看来源页面和访客分类 |
| 推广来源参数 | `utm_source / utm_medium / utm_campaign / utm_term / utm_content`；只保留这五个查询参数，各最多 128 字符 |
| 访问会话 | `session_summary` 汇总页数、不同页面数、前台时长、首末时间；`session_paths` 提供访问顺序 |
| 论文关注度 | `paper_interest` 按论文标题和自己的／其他访问汇总链接、PDF、GitHub 点击，以及已知浏览器数和会话数 |
| 浏览器语言和时区 | `language / languages / browser_timezone`；与 IP 推断的 `timezone` 分开记录 |
| 网络信息 | `asn / as_organization` 为 Cloudflare 提供的 IP 所属网络编号和组织，不代表访客真实单位 |

### 统计规则

- 随机 `visitor_id` 保存在 localStorage；不使用浏览器指纹。清理站点数据、更换浏览器／设备或使用无痕窗口可能成为新访客；禁止存储时设为 NULL，不把每次访问伪装成一个新访客。
- `session_id` 保存在 sessionStorage，每个标签页分别记录，连续 30 分钟未活跃后开始新会话。标签页复制时浏览器可能复制 sessionStorage，因此不是跨标签页严格唯一的身份系统。前台可见页面的心跳算活跃，持续打开页面会延续会话。
- 每次加载、刷新、前进后退恢复页面，或超时后重新活跃，产生一条页面记录。30 秒心跳更新同一条记录，不增加访问次数。重复和乱序上报使用累计最大值；点击使用独立事件 ID 去重。
- 停留时间只累计页面在前台可见的时间；切后台或离开时尝试立即上报，定时约 30 秒上报。为避免电脑休眠导致虚增，单次计时差最多计 60 秒。关闭浏览器、离线或拦截可能损失最后一段时间／点击；这是尽力采集，不是完整审计日志。
- 论文关注度来自首页和 Publications 页面论文卡片里的链接点击，包括 PDF、代码、视频等，不表示论文被实际阅读或下载成功。没有点击时不能判断访客对哪篇论文感兴趣。
- `visitor_type`：`owner` 是已标记的自己的浏览器，`visitor` 是未标记的浏览器，`unknown` 是没有分类信息的旧记录。历史访问不随标记变化。一个会话中分类改变时，`session_summary.visitor_type` 为 `mixed`。
- 原有 `visitor_totals` 仍按 IP 汇总页面访问，包含自己的访问；IP 不等于独立访客，同一 IP 可以多人共享，一个人也可能更换 IP。
- 位置无法精确到街道／门牌，VPN 或代理位置也可能与实际位置不同。不请求定位权限，不记录 Cookie、表单输入或完整 URL 查询串；链接剥离查询、片段和 URL 凭据，邮件／电话点击只保存类型，不保存地址或号码。
- 来源为空可能是直接打开，也可能是浏览器或来源网站未提供，不能一律判为直接访问。推广链接可使用 `?utm_source=cv&utm_medium=pdf&utm_campaign=applications`；不要在这些值中放姓名、邮箱等敏感内容。
- 本地预览不采集。JavaScript 禁用、拦截器、网络故障或服务配额耗尽可能导致漏记；直接请求文件和不执行 JS 的爬虫不计入页面访问。
- 不自动删除历史数据；可从 D1 控制台删除或导出。30 秒心跳会增加数据库写入量，费用和配额以账号实际套餐为准。

## 重新搭建时的首次部署

本账号的数据库和 Worker 已建好，日常查看数据无需重做这些步骤。以后在新的终端使用 CLI 时可重新运行 `npx wrangler@4 login`；本次部署的授权保存在本机临时目录，不在仓库里。

1. 在 <https://dash.cloudflare.com/sign-up> 注册并登录你自己的账号。不需要迁移网站或添加自己的域名。账号密码和 API token 不要填进网页代码或提交到 GitHub。
2. 本机安装 Node.js 后，在仓库根目录执行以下命令。Wrangler 首次运行可能提示安装，`login` 会打开浏览器授权：

   ```sh
   cd _analytics
   cp wrangler.example.jsonc wrangler.jsonc
   npx wrangler@4 login
   npx wrangler@4 d1 create yirenzzz-private-visits
   ```

3. 将上一步返回的 `database_id` 填入本地 `wrangler.jsonc`，保留 `DB` 绑定和 `migrations_dir`。该配置文件已被 Git 忽略。
4. 建表并部署采集服务：

   ```sh
   npx wrangler@4 d1 migrations apply yirenzzz-private-visits --remote
   npx wrangler@4 deploy
   ```

5. 将部署返回的实际 HTTPS Worker 域名加上 `/collect`，填入 `assets/js/visit-tracker.js` 的 `endpoint`，例如 `https://yirenzzz-private-visits.<你的子域>.workers.dev/collect`。这只是公开写入入口，不是读取凭据。
6. 按现有流程发布 GitHub Pages 文件。访问线上主页及一个子页面，在浏览器网络面板确认 `/collect` 返回 204，再到 D1 控制台核实记录。204 只有在数据库写入成功后才返回。用 GET 打开采集地址不会显示数据。

网站和 Worker 都完成发布后，才算正式启用。若更换网站域名，需要同步修改客户端的 origin 限制和 Worker 的 `ALLOWED_ORIGIN`，重新部署两端。

## 私下查看

### 分开记录自己的访问

在自己的每个浏览器中打开一次 [标记此浏览器为自己](https://yirenzzz.github.io/?analytics-setup=owner-v1#analytics-owner=on)。出现成功提示后，标记保存在此网站的 localStorage 中，未来访问自动归类为 `owner`，即使 IP 改变也继续有效。设置完成会从地址栏移除设置片段，以免误分享。

需要取消时，打开 [取消此浏览器的自己的访问标记](https://yirenzzz.github.io/?analytics-setup=owner-v1#analytics-owner=off)。普通访问不会出现提示，页面外观不变。清理站点数据、更换浏览器／设备、使用无痕窗口后需重新设置；存储被禁止时会提示设置仅对当前页面有效。

这是浏览器自行声明的分类标记，不是身份验证，也不赋予数据库读取权限。不要把开启标记的链接当作网站普通链接分享给别人。`visitor` 指未标记浏览器，可能包括尚未标记的自己的设备。设置同一设备的标记也不会更改此前已保存的访问；历史记录保留 `unknown`，不根据 IP 自动猜测归属。

在 D1 控制台分别查询：

```sql
-- 自己的访问
SELECT * FROM owner_visits ORDER BY visited_at DESC LIMIT 100;

-- 其他未标记浏览器的访问
SELECT * FROM other_visits ORDER BY visited_at DESC LIMIT 100;

-- 按分类和 IP 分别统计次数
SELECT * FROM visitor_totals_by_type ORDER BY visit_count DESC;

-- 此功能上线以前或旧版脚本产生的记录
SELECT * FROM visits WHERE visitor_type = 'unknown' ORDER BY visited_at DESC LIMIT 100;
```

`visits` 仍保留全部明细；原有 `visitor_totals` 仍表示包括自己的访问在内的全部次数。

### 全部记录

登录 Cloudflare 控制台，打开 D1 数据库 `yirenzzz-private-visits` 的查询控制台，执行：

```sql
-- 最近 100 条访问（时间是 UTC）
SELECT ip, country, region, city, visited_at, path
FROM visits ORDER BY visited_at DESC, id DESC LIMIT 100;

-- 每个 IP 的访问次数
SELECT * FROM visitor_totals ORDER BY visit_count DESC;
```

### 新增行为数据

在同一个 D1 数据库的查询控制台执行以下 SQL。`active_ms / 1000.0` 将毫秒转换为秒。以下查询排除已标记的自己的访问：

```sql
-- 最近访问的环境、来源、网络和阅读进度
SELECT visited_at, path, referrer, browser, os, device_type,
       language, browser_timezone, asn, as_organization,
       active_ms / 1000.0 AS foreground_seconds, max_scroll_pct,
       utm_source, utm_medium, utm_campaign
FROM visits WHERE visitor_type = 'visitor'
ORDER BY visited_at DESC LIMIT 100;

-- 首次／回访会话及会话内访问路径（第一条查询取出 session_id）
SELECT * FROM session_summary WHERE visitor_type = 'visitor'
ORDER BY started_at DESC LIMIT 100;
SELECT * FROM session_paths WHERE session_id = '填入会话 ID' ORDER BY step;

-- 链接点击，关联来源页面
SELECT c.clicked_at, v.path, c.target_url, c.link_type, c.link_text, c.paper_title
FROM link_clicks c JOIN visits v ON v.page_id = c.page_id
WHERE v.visitor_type = 'visitor'
ORDER BY c.clicked_at DESC LIMIT 100;

-- 论文关注度
SELECT * FROM paper_interest WHERE visitor_type = 'visitor'
ORDER BY link_clicks DESC;
```

`visitor_profiles` 提供每个已知浏览器的累计访问概况，包含自己的访问；没有随机浏览器标识的记录不会强行合并为一个人。

也可以在 `_analytics` 目录通过已登录的 CLI 查询：

```sh
npx wrangler@4 d1 execute yirenzzz-private-visits --remote --command "SELECT * FROM visitor_totals ORDER BY visit_count DESC LIMIT 100"
```

需要导出时，写入已忽略的 `_analytics/exports/` 目录。不要将真实记录复制到 HTML、公开 JSON、仓库文件或提交信息中。`_analytics` 下划线目录通常被 Jekyll 排除，但这不是访问控制；保密性来自数据库权限和不提供公开读取接口。

## 验证与限制

在仓库根目录使用 Node.js 22.13+ 执行：

```sh
node --test _analytics/analytics.test.mjs
```

测试以本机内存 SQLite 验证真实迁移和 SQL、重复／乱序上报、点击去重、会话汇总、历史兼容、输入限制和读取隔离，并用浏览器模拟验证可见时间、滚动、会话超时、前进后退和点击采集。真实地理信息和 D1 权限需部署后再验证；本地预览不能代表真实访客位置。

公开写入入口没有用户登录，Origin 限制只过滤其他网站的浏览器请求，不是鉴权，也不能阻止伪造 Origin 的脚本制造记录。因此统计不保证无机器人、无刷量；发现滥用时需增加限流措施。未来做版面时应单独添加受认证保护的读取服务，不能直接将完整 IP 数据公开。

暂停采集：清空客户端 `endpoint` 并重新发布；若需立即阻断已打开或缓存的旧页面，停用 Worker。已经保存的数据库记录不会自动删除。

官方参考：[GitHub Pages 静态托管](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Workers 请求地理信息](https://developers.cloudflare.com/workers/runtime-apis/request/)、[D1 创建与绑定](https://developers.cloudflare.com/d1/get-started/)。
