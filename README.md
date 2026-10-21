# CronPro（Vercel 版）

参照 cron-job.org 的在线定时任务平台：按 Cron 计划访问你登记的网址，失败自动发邮件告警。
本版本由 PHP + SQLite 改写为 **Node.js（Hono）+ Turso（libSQL 云端 SQLite）**，可直接部署到 Vercel。功能、界面与 PHP 版保持一致，旧的导出文件和旧数据库都能导入。

## 一、部署到 Vercel（约 10 分钟）

1. **建数据库**：在 [Turso](https://turso.tech) 注册（免费额度足够），新建数据库，拿到
   `TURSO_DATABASE_URL`（`libsql://...`）和 `TURSO_AUTH_TOKEN`。
   也可以在 Vercel 项目的 *Storage → Marketplace → Turso* 一键创建，环境变量会自动注入。
2. **推代码**：把本目录推到 GitHub，在 Vercel 中 *Add New → Project* 导入。Framework Preset 选 **Other**，其他保持默认。
3. **配环境变量**（Settings → Environment Variables），参考 `.env.example`：
   - `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`（必填）
   - `CRON_SECRET`（必填，随机字符串）
   - `SETUP_TOKEN`（强烈建议，防止别人抢先打开你的网址完成安装）
   - `SMTP_PASS`（强烈建议，邮箱授权码不进数据库）
4. **Deploy**，打开分配的域名，输入安装口令、创建管理员即可。
5. **配置触发**（重要，见下一节）。

## 二、任务是怎么被触发的

Serverless 没有常驻进程，必须由外部“敲门”：

| 方式 | 说明 |
|---|---|
| **外部 URL（推荐，免费版必选）** | 在 [cron-job.org](https://cron-job.org)、UptimeRobot、宝塔“访问 URL”等服务里，每分钟访问 `https://你的域名/cron?key=密钥`（后台「系统设置 → 触发方式」可复制） |
| Vercel Cron | `vercel.json` 已配置 `/cron`。**Hobby 免费版每天只能跑一次**（默认 `0 0 * * *` UTC 兜底）；Pro 版可把 schedule 改为 `* * * * *` |
| 访问触发 | 打开后台/状态页时，响应发出后用 `waitUntil` 顺带检查到点任务；也可在你的网站嵌入 `<script src="https://你的域名/trigger?js=1" async></script>` |

> 单次调度最长约 50 秒（`vercel.json` 的 `maxDuration: 60`）。任务超时会被自动压缩到剩余时间内；任务很多时调低「单次调度最多执行」或提高并发。

## 三、从 PHP 版迁移

**只迁任务配置**：旧后台「系统设置 → 导入导出」下载 JSON，新后台导入即可。

**完整迁移（任务 + 执行记录 + 账号）**：
```bash
npm install
TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=xxx \
  node scripts/migrate-sqlite.js /旧站/data/cronpro.sqlite
```
任务 ID 不变，管理员账号密码沿用（PHP 的 bcrypt 哈希可直接校验）。SMTP 密码不会迁移，请设置 `SMTP_PASS` 环境变量。

旧地址 `index.php`、`cron.php?key=`、`trigger.php`、`status.php` 均保留兼容，外部监控里的地址只需换域名（密钥随数据库一起迁移）。

## 四、本地开发
```bash
npm install
npm run dev        # http://localhost:3000，数据存在 data/local.db
npm test           # Cron 解析器自测
```

## 五、相对 PHP 版的改进
- **安全**：安装口令（SETUP_TOKEN）；SMTP 密码改用环境变量；新任务默认校验 SSL 证书；拦截内网/保留地址防 SSRF；密码至少 8 位；修改密码后其他设备自动登出；登录失败计数独立成表并自动清理；Cookie 签名 + HttpOnly + Secure + SameSite。
- **可靠性**：数据库租约锁替代文件锁，任务按“条件更新”原子认领，多实例并发也不会重复执行；调度有时间预算，避免函数超时导致状态写一半；响应体最多读取 1 MB。
- **性能**：任务列表的“最近 20 次”由 N+1 查询改为一次窗口函数查询；概览 24 小时柱状图和状态页改为 SQL 聚合。
- **正确性**：Cron 计算基于 luxon，正确处理夏令时；附带自测脚本。

## 目录
```
api/index.js        Vercel 函数入口
src/app.js          路由（后台 / cron / trigger / status）
src/runner.js       调度与执行
src/cron-expr.js    Cron 解析
src/mailer.js       邮件（nodemailer）
src/pages/          各页面
public/assets/      样式、脚本、图标
scripts/            本地开发、迁移、测试
```
