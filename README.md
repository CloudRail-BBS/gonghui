# 方碑 · MC 公会中心

一个可以自己部署的 Minecraft 公会平台：跨服务器公会榜、双方确认的战报、赛事对阵、荣誉墙与管理后台。
不依赖任何游戏服务器或插件，纯 Web + 账号体系。

- 前端：单文件 `public/index.html`（原生 JS，无构建步骤）
- 后端：Node.js + Express
- 存储：单文件 JSON（`data/db.json`，原子写入），无需数据库
- 部署：`npm start` 或 `docker compose up -d`

---

## 功能

**公开**
- 明暗两套主题，跟随系统 / 手动切换（按浏览器记忆）
- 移动端底部标签栏（≤760px 自动切换，含安全区适配），桌面端保留顶部导航
- 首页：赛季信息、Top3 领奖台、最新战报、赛事入口
- 公会榜：按积分 / 胜率 / 人数 / 等级排序，按服务器筛选、关键词搜索
- 公会空间：概览、成员、荣誉、战报、招募五个页签
- 赛事中心：赛事列表、8 队淘汰赛对阵图、地图 BP 面板
- 全站搜索

**登录后**
- 创建公会（提交审核）、申请入会 / 直接加入
- 提交战报 → 对方确认 → 计分；有异议转争议
- 赛事报名
- 站内信：未读、展开、全部已读
- 个人名片：MC ID、平台 ID、我的公会、战绩

**管理与会长**
- 建会审核（通过后自动出现在榜单，初始 Lv.1 / 1000 分）
- 荣誉颁发（写入公会荣誉墙并发站内信）
- 赛事编排：录入半决赛比分，胜者自动进入决赛
- 争议仲裁：举报成立扣分 / 驳回
- 站点设置：首页文案、赛季起止与剩余天数、赛制/计分说明、冠军卡、数据条四项、开放注册与创建公会开关
- 审计日志：注册、建会、确认战报、报名、仲裁等动作留痕

---

## 快速开始（Node）

要求 Node.js ≥ 18。

```bash
npm install
ADMIN_PASS=你的管理员密码 npm start
```

打开 http://localhost:3000 。

- 首次启动会用 `ADMIN_USER` / `ADMIN_PASS` 创建管理员（默认 `admin` / `admin123`，**上线前务必改掉**）。
- 数据库文件在 `data/db.json`，删除即可重置为示例数据。

## Docker 部署

```bash
cp .env.example .env      # 修改 ADMIN_PASS
docker compose up -d --build
```

默认映射 `3000` 端口，数据挂载在 `./data`。

也可以不用 compose：

```bash
docker build -t fangbei .
docker run -d --name fangbei -p 3000:3000 \
  -e ADMIN_PASS=your-password \
  -v $(pwd)/data:/app/data \
  fangbei
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口 |
| `HOST` | `0.0.0.0` | 监听地址 |
| `DATA_DIR` | `./data` | 数据目录 |
| `ADMIN_USER` | `admin` | 首次启动创建的管理员用户名 |
| `ADMIN_PASS` | `admin123` | 首次启动创建的管理员密码 |

> 管理员只在数据库为空时创建。已有数据后再改环境变量不会改密码。

## 目录结构

```
fangbei-server/
├── server.js           # 路由、鉴权、业务操作
├── lib/
│   ├── store.js        # JSON 存储、密码哈希、种子数据
│   └── seed.js         # 示例公会 / 赛事 / 对阵
├── public/
│   ├── index.html      # 前端（单文件）
│   └── assets/
│       ├── logo.svg    # 站点标识（原图）
│       └── favicon.svg # 浏览器页签图标
├── data/db.json        # 运行时生成
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## 站点设置（内容都在后台改）

用管理员登录 → 管理 → 站点设置，可以改：

- 站点名 / 英文副标（顶栏与页脚）
- 首页角标、主标题两段、简介
- 赛季起止、剩余天数、赛制、计分方式
- 冠军卡指向哪个公会、标签与副标
- 首页四个数据条的数值与标签
- 是否开放注册、是否开放创建公会

保存后立即生效，存于 `data/db.json` 的 `meta.site`。重置数据会一并恢复默认文案。

主题切换在顶栏右侧：默认跟随系统，点一下在浅色 / 深色之间切换，选择存在浏览器本地，不影响其他访客。

## 反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name guild.example.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

HTTPS 用 certbot 即可：`certbot --nginx -d guild.example.com`。

## 备份与升级

```bash
# 备份（直接复制即可，JSON 是原子写入，不会读到半个文件）
cp data/db.json backup-$(date +%F).json

# 升级：替换代码后重启
docker compose up -d --build
```

数据在 `data/` 里，升级不会动它。

## 安全说明

- 密码使用 scrypt + 随机盐存储，接口不返回密码字段
- 会话是 HttpOnly + SameSite=Lax 的 Cookie，30 天过期
- 登录 / 注册按 IP 限流（每分钟 12 次）
- 用户输入会过滤 `<>` 与控制字符，长度截断，避免 HTML 注入
- 生产环境请务必：改管理员密码、开 HTTPS、把 `data/` 排除在公开访问之外

## 已知限制

- 单文件 JSON 存储：适合单机、几千用户以内。要横向扩展，把 `lib/store.js` 的 `load/save` 换成 PostgreSQL 即可，业务代码不用改。
- 单进程。多实例部署需要把存储换成数据库，并把会话放到共享存储。
- 没有邮件服务，注册不需要验证邮箱；找回密码需管理员手动处理。

## 接口摘要

| 方法 | 路径 | 说明 |
|---|---|---|
| POST | `/api/register` | 注册（username / password / name / mc） |
| POST | `/api/login` | 登录 |
| POST | `/api/logout` | 退出 |
| GET | `/api/bootstrap` | 当前用户 + 全站状态 |
| GET | `/api/health` | 健康检查 |
| POST | `/api/op` | 业务操作（见下） |

`/api/op` 的 `type`：`createGuild` `reviewGuild` `joinGuild` `editGuild` `kickMember`
`reportMatch` `confirmMatch` `disputeMatch` `signup` `saveScore` `awardHonor`
`readMail` `resolveReport` `saveSettings` `resetData`。

所有操作都在服务端校验权限：会长只能改自己的公会，确认战报必须是另一方，管理操作需要 `admin`。

## 许可

自用 / 二次开发均可。
