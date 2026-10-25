# CronPro（Vercel 版）

参照 cron-job.org 的在线定时任务平台：按 Cron 计划访问你登记的网址，失败自动发邮件告警。

本版本由 PHP + SQLite 改写为 **Node.js（Hono）+ Turso（libSQL 云端 SQLite）**，可直接部署到 Vercel。功能、界面与 PHP 版保持一致，旧的导出文件和旧数据库都能导入。

- [一、部署到 Vercel](#一部署到-vercel约-10-分钟)
- [二、让任务准时执行（必读）](#二让任务准时执行必读)
- [三、从 PHP 版迁移](#三从-php-版迁移)
- [四、环境变量](#四环境变量)
- [五、本地开发](#五本地开发)
- [六、目录结构](#六目录结构)
- [七、常见问题](#七常见问题)


## 一、部署到 Vercel（约 10 分钟）

1. **建数据库**：在 [Turso](https://turso.tech) 注册（免费额度足够），新建数据库，拿到 `TURSO_DATABASE_URL`（`libsql://...`）和 `TURSO_AUTH_TOKEN`。
   也可以在 Vercel 项目的 *Storage → Marketplace → Turso* 一键创建，环境变量会自动注入。
   建议数据库区域和 Vercel 函数区域选同一个（例如都选东京），调度更快。
2. **推代码**：把本目录推到 GitHub，在 Vercel 中 *Add New → Project* 导入。Framework Preset 选 **Other**，其他保持默认。
3. **配环境变量**（Settings → Environment Variables），至少填 `TURSO_DATABASE_URL`、`TURSO_AUTH_TOKEN`、`CRON_SECRET`，强烈建议再填 `SETUP_TOKEN`、`SMTP_PASS`。完整列表见[第四节](#四环境变量)。
4. **Deploy**，打开分配的域名，输入安装口令、创建管理员。
5. **配置触发器**：见下一节，这一步不做任务不会按时跑。
6. 在后台「系统设置」发一封测试邮件，确认告警能收到。

## 二、让任务准时执行（必读）

Serverless 没有常驻进程，需要外部每分钟来“敲一次门”。触发器只负责敲门，**任务什么时候跑由 CronPro 里的 Cron 表达式决定**，所以只要每分钟都有人敲门，任务就能准到分钟。

### 推荐组合：两个触发器 + 一个停跳报警

| 作用 | 服务 | 怎么配 |
|---|---|---|
| 主触发器 | [cron-job.org](https://cron-job.org)（免费） | 新建任务，每分钟访问后台「系统设置 → 触发方式」里复制的地址：`https://你的域名/cron?key=密钥` |
| 备用触发器 | Cloudflare Workers Cron（免费） | 照 `triggers/cloudflare-worker.js` 顶部注释操作，Cron 设为 `* * * * *` |
| 停跳报警 | [healthchecks.io](https://healthchecks.io)（免费） | 新建检查：周期 1 分钟、宽限 10 分钟，把 ping 地址填到环境变量 `HEARTBEAT_URL` |

- **两个触发器同时开不会重复执行**：CronPro 用数据库租约锁 + 条件更新认领任务，同一分钟来两次，第二次直接跳过。任何一个挂了，另一个照样顶上。
- **为什么要停跳报警**：触发器全挂时 CronPro 根本没被叫醒，自己发不出告警。配置 `HEARTBEAT_URL` 后，每次 `/cron` 调度完都会 ping 一次监控；超过宽限时间没收到，healthchecks.io 会发邮件 / Telegram 通知你。

### 各种触发方式对比

| 方式 | 精度 | 费用 | 建议 |
|---|---|---|---|
| cron-job.org | 每分钟 | 免费 | 主触发器 |
| Cloudflare Workers Cron | 每分钟 | 免费 | 备用触发器 |
| Vercel Cron（Pro） | 每分钟 | Pro 套餐 | 把 `vercel.json` 的 schedule 改为 `* * * * *` |
| Vercel Cron（Hobby） | 每天一次，且在设定时间后 0–59 分钟内随机触发 | 免费 | 只当兜底（已默认配置 `0 0 * * *`） |
| UptimeRobot | 5 分钟 | 免费 | 可用，但较粗 |
| GitHub Actions | 常延迟 10–30 分钟 | 免费 | 第三重保险，见 `triggers/github-actions.yml` |
| 访问触发 | 有人访问才跑 | 免费 | 打开后台 / 状态页，或在网站嵌入 `<script src="https://你的域名/trigger?js=1" async></script>` |

> 注意：Hobby 套餐如果把 `vercel.json` 的 schedule 改成比每天一次更频繁，部署会直接失败。

### `/cron` 接口参数

| 参数 | 说明 |
|---|---|
| `key` | 必填，后台「系统设置 → 触发方式」里的触发密钥（Vercel Cron 自带 `CRON_SECRET` 鉴权，不需要） |
| `job=ID` | 只执行指定任务，不看计划。适合很慢的任务单独触发，不占用公共调度时间 |
| `format=json` | 以 JSON 返回本轮执行结果 |

### 调度建议

- **错开同一时刻的任务**：单次调度最长约 50 秒（`maxDuration: 60`）。很多任务都排在 `0 3 * * *` 时，改成 `0 3`、`2 3`、`4 3`… 各错开几分钟更稳。
- **保活类任务加关键字判定**：休眠中或构建中的页面也可能返回 200，只看状态码会“假成功”。在任务里填一个页面上稳定出现的关键字，并开 1 次重试。
- 任务很多时，调低「单次调度最多执行」或提高并发；超时的任务会被自动压缩到剩余时间内。

## 三、从 PHP 版迁移

**只迁任务配置**：旧后台「系统设置 → 导入导出」下载 JSON，新后台导入即可。

**完整迁移（任务 + 执行记录 + 账号）**：

```bash
npm install
TURSO_DATABASE_URL=libsql://xxx.turso.io TURSO_AUTH_TOKEN=xxx \
  npm run migrate:sqlite -- /旧站/data/cronpro.sqlite
```

- 任务 ID 不变，管理员账号密码沿用（PHP 的 `$2y$` bcrypt 哈希可直接校验）。
- SMTP 密码**不会**迁移，请设置 `SMTP_PASS` 环境变量。
- 旧地址 `index.php`、`cron.php?key=`、`trigger.php`、`status.php` 均保留兼容，外部监控里的地址只需换域名（触发密钥随数据库一起迁移）。
- 旧数据库含账号、密钥和任务地址，迁移完请勿把它放进代码仓库。

## 四、环境变量

参考 `.env.example`。

| 变量 | 必填 | 说明 |
|---|---|---|
| `TURSO_DATABASE_URL` | 是 | Turso 数据库地址；本地不填则使用 `data/local.db` |
| `TURSO_AUTH_TOKEN` | 是 | Turso 访问令牌 |
| `CRON_SECRET` | 是 | Vercel Cron 鉴权，随机字符串（`openssl rand -hex 24`） |
| `SETUP_TOKEN` | 强烈建议 | 安装口令，防止别人抢先打开网址完成安装 |
| `SMTP_PASS` | 强烈建议 | 邮箱授权码，放环境变量而不是数据库 |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `MAIL_FROM` | 否 | 覆盖后台里的 SMTP 设置 |
| `HEARTBEAT_URL` | 建议 | 停跳报警地址，每次 `/cron` 调度后 GET 一次 |
| `HEARTBEAT_FAIL_ON_JOB_ERROR` | 否 | 设为 `1` 时，本轮有任务失败改为 ping `HEARTBEAT_URL/fail` |
| `SESSION_SECRET` | 否 | Cookie 签名密钥，不填则自动生成并存入数据库 |
| `TICK_BUDGET_SECONDS` | 否 | 单次调度时间预算（默认 50），需小于 `maxDuration` |

## 五、本地开发

需要 Node.js 20+。

```bash
npm install
npm run dev        # http://localhost:3000，数据存在 data/local.db
npm test           # Cron 解析器自测
```

## 六、目录结构

```
api/
  index.js              Vercel 函数入口
src/
  app.js                路由：后台 / cron / trigger / status，旧 .php 路径兼容
  core/
    runner.js           调度：认领到点任务、发 HTTP 请求、重试、判定、日志、告警
    jobs.js             任务读写与字段校验
    actions.js          后台表单动作（保存、批量、导入导出、设置等）
  lib/
    db.js               Turso/libSQL 连接与建表
    settings.js         系统设置读写
    auth.js             登录、签名 Cookie 会话、CSRF、登录锁定
    cron-expr.js        Cron 解析与下次运行时间（luxon，支持夏令时）
    mailer.js           邮件发送（nodemailer）
    util.js             通用工具函数
  views/
    layout.js           页面骨架与公共组件
    pages/              概览、任务、日志、设置、状态页、登录安装页
public/assets/          样式、前端脚本、图标
scripts/
  dev.js                本地开发服务器
  migrate-sqlite.js     PHP 版 SQLite → Turso 迁移
  test-cron.js          Cron 自测
triggers/
  cloudflare-worker.js  备用触发器（Cloudflare Workers）
  github-actions.yml    兜底触发器（GitHub Actions）
.env.example            环境变量模板
vercel.json             路由重写、函数时长、Vercel Cron
```

## 七、常见问题

**任务没按时跑？** 先在浏览器打开 `https://你的域名/cron?key=密钥`，能看到执行结果说明程序正常，问题在触发器；再看 cron-job.org 的执行历史是否每分钟都有记录。

**返回“密钥错误”？** 密钥以后台「系统设置 → 触发方式」显示的为准；迁移后密钥沿用旧库，重新生成后要同步更新所有触发器。

**一个任务很慢，拖累其他任务？** 用 `/cron?key=密钥&job=任务ID` 给它单独建一个外部触发，并在 CronPro 里把它停用，避免重复执行。

**部署报 “Hobby accounts are limited to daily cron jobs”？** 说明改了 `vercel.json` 的 schedule。Hobby 套餐请保持每天一次，用外部触发器实现每分钟。
