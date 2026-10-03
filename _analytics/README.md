# 私密访问记录

2026-10-03 已创建 D1 数据库并部署 Cloudflare Worker。`assets/js/visit-tracker.js` 已配置采集地址 `https://yirenzzz-private-visits.yirenzzz-visits.workers.dev/collect`；网站文件发布至 GitHub Pages 后开始采集。现有页面仅加载一个独立脚本，外观不变。

网站继续由 GitHub Pages 托管。后台采用 Cloudflare Worker 接收记录，D1 保存数据。只通过有数据库权限的 Cloudflare 账号或 CLI 查看；没有公开查询 API，没有前端统计版面，也没有放在 GitHub 仓库里的访问数据。请使用自己的 Cloudflare 账号，避免授予其他成员数据库读取权限。

## 记录内容和口径

- `visits`：公网 IP、服务端接收时间（UTC ISO 8601）、页面路径、国家代码、省／地区、城市、所在时区。
- `visitor_totals`：按 IP 汇总访问次数、首次及最近访问时间。
- 每次页面加载、刷新、浏览器前进后退恢复页面分别计一次。不是按会话计数，也不是独立访客人数。共享网络可能多人使用同一 IP；同一个人也可能更换 IP。
- 地址仅为 IP 推断的粗略位置，缺失时保存 NULL；无法获取街道／门牌地址，VPN 或代理位置也可能与实际位置不同。
- 不记录 URL 查询参数、片段、来源页、Cookie、浏览器指纹；不请求浏览器定位权限。
- 只有启用后的新访问会被记录。JavaScript 被禁用、拦截器、网络故障、服务配额耗尽都可能导致漏记。文件下载、图片请求以及不执行 JS 的爬虫不计入。
- 当前不自动删除历史数据；可从 D1 控制台删除或导出。数据库配额和费用随记录增长变化，部署前在账号中确认适用套餐与配额。

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

登录 Cloudflare 控制台，打开 D1 数据库 `yirenzzz-private-visits` 的查询控制台，执行：

```sql
-- 最近 100 条访问（时间是 UTC）
SELECT ip, country, region, city, visited_at, path
FROM visits ORDER BY visited_at DESC, id DESC LIMIT 100;

-- 每个 IP 的访问次数
SELECT * FROM visitor_totals ORDER BY visit_count DESC;
```

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

测试以本机内存 SQLite 验证实际 SQL、次数汇总、输入限制和读取隔离，用模拟 Cloudflare 请求元数据验证服务端处理。真实地理信息和 D1 权限需部署后再验证；本地预览不能代表真实访客位置。

公开写入入口没有用户登录，Origin 限制只过滤其他网站的浏览器请求，不是鉴权，也不能阻止伪造 Origin 的脚本制造记录。因此统计不保证无机器人、无刷量；发现滥用时需增加限流措施。未来做版面时应单独添加受认证保护的读取服务，不能直接将完整 IP 数据公开。

暂停采集：清空客户端 `endpoint` 并重新发布；若需立即阻断已打开或缓存的旧页面，停用 Worker。已经保存的数据库记录不会自动删除。

官方参考：[GitHub Pages 静态托管](https://docs.github.com/en/pages/getting-started-with-github-pages/what-is-github-pages)、[Workers 请求地理信息](https://developers.cloudflare.com/workers/runtime-apis/request/)、[D1 创建与绑定](https://developers.cloudflare.com/d1/get-started/)。
