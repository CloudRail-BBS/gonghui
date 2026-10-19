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
- 后台可切换站点 Logo：上传图片 / 文字徽标、高度、是否显示站名
- 移动端底部标签栏（≤760px 自动切换，含安全区适配），桌面端保留顶部导航
- 首页：赛季信息、Top3 领奖台、最新战报、赛事入口
- 公会榜：按积分 / 胜率 / 人数 / 等级排序，按服务器筛选、关键词搜索
- 公会空间：概览、成员、荣誉、战报、招募五个页签
- 赛事中心：赛事列表、8 队淘汰赛对阵图、地图 BP 面板
- 全站搜索

**登录后**
- 创建公会（提交审核）、申请入会 / 直接加入
- 邮箱绑定；忘记密码走「邮箱验证码 → 重置密码」
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
- 品牌与 Logo：上传图片 / 文字徽标、显示高度、是否显示站名
- 邮件服务（SMTP）：主机、端口、加密方式、账号、授权码、发件人、注册是否需邮箱验证、一键发送测试邮件
- 人机验证（极验 4.0）：Captcha ID / Key、生效场景（登录 / 注册 / 找回密码）
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

### 换端口（3000 被占用时）

**改 `.env` 里的 `PORT`，两侧同时生效** —— 宿主机映射端口和容器内监听端口都由它决定：

```bash
# .env
PORT=8080
```

```bash
docker compose up -d          # 重新创建容器，端口映射随之更新
docker compose ps             # 应显示 0.0.0.0:8080->8080/tcp
```

原理：compose 里写的是 `"${PORT:-3000}:${PORT:-3000}"`，同时把 `PORT` 传进容器作为环境变量。这样不会出现「宿主机映射了 8080、容器还在监听 3000」的错位。

也可以不用 compose：

```bash
docker build -t fangbei .
# 容器内端口用 -e PORT 指定，映射两侧保持一致
docker run -d --name fangbei -p 8080:8080 \
  -e PORT=8080 \
  -e ADMIN_PASS=your-password \
  -v $(pwd)/data:/app/data \
  fangbei
```

> 如果只改 `-p 8080:3000` 而不传 `-e PORT`，容器仍监听 3000，映射同样有效；
> 但把两侧都写成 8080 却忘了 `-e PORT=8080`，就会连不上。所以最省心的做法是两边都跟着 `PORT` 走。

### 端口映射不通怎么查

```bash
docker compose ps                 # STATUS 应为 Up (healthy)；端口列显示 0.0.0.0:8080->8080/tcp
docker compose logs --tail=50     # 应看到「监听地址：0.0.0.0:8080（所有网卡）」
docker compose exec fangbei node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>r.text()).then(console.log)"
```

对照排查：

| 现象 | 原因 | 处理 |
|---|---|---|
| `docker compose up` 报 `port is already allocated` | 宿主机该端口被占用 | 换 `PORT`，或 `lsof -i:8080` / `netstat -ano \| findstr :8080` 找出占用进程 |
| `docker compose ps` 里容器 `Restarting` | 进程启动失败（多半是依赖或数据目录） | `docker compose logs` 看具体报错 |
| 日志显示 `监听地址：127.0.0.1:...` | `HOST` 被设成了回环地址 | 删掉自定义的 `HOST`，或设成 `0.0.0.0` |
| 容器 `Up` 但浏览器连不上 | 云服务器安全组 / 防火墙没放行 | 放行对应端口的入站规则 |
| 平台托管（Railway、Zeabur 等）访问 502 | 平台注入 `$PORT`，应用没跟随 | 本项目已读 `process.env.PORT`，不要额外写死端口 |

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `3000` | 监听端口；用 compose 时**同时决定宿主机映射端口** |
| `HOST` | `0.0.0.0` | 监听地址，容器部署不要改成 `127.0.0.1` |
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
│   ├── seed.js         # 示例公会 / 赛事 / 对阵
│   ├── mailer.js       # SMTP 发信（nodemailer 封装）
│   └── geetest.js      # 极验 4.0 服务端二次校验
├── public/
│   ├── index.html      # 前端（单文件）
│   └── assets/
│       ├── logo.svg    # 站点标识（原图）
│       └── favicon.svg # 浏览器页签图标
├── data/
│   ├── db.json         # 运行时生成
│   └── uploads/        # 后台上传的 Logo
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

### 品牌与 Logo

- **显示方式**：图片 Logo / 文字徽标（站点名首字，自动配色）
- **图片地址**：可填站内路径、外链，或直接点「上传」存到 `data/uploads/`（PNG / JPG / WEBP / GIF / SVG，≤1.5 MB）
- **高度**：16–48 px；**站点名文字**可单独隐藏
- 浏览器页签图标（favicon）会跟着 Logo 一起变

### 邮件服务（SMTP）

填好主机、端口、加密方式、账号与授权码后，先点「发送测试邮件」确认能发出去。常见配置：

| 邮箱 | 主机 | 端口 | 加密 |
|---|---|---|---|
| QQ 邮箱 | smtp.qq.com | 465 | SSL（密码填授权码） |
| 163 邮箱 | smtp.163.com | 465 | SSL（密码填授权码） |
| Gmail | smtp.gmail.com | 465 | SSL（应用专用密码） |
| 自建 Postfix | 你的域名 | 587 | STARTTLS |

开启「注册需邮箱验证」后，注册必须填邮箱并输入 6 位验证码；验证码 10 分钟内有效，同邮箱 60 秒内只能发一次。
「忘记密码」只在邮件服务启用后显示，走的是同一套 SMTP。

密码与授权码**只存在服务器**（`meta.site.mail.pass`），接口从不下发明文；后台里显示为「已保存，留空表示不修改」。

### 人机验证（极验 4.0）

1. 到 [geetest.com](https://www.geetest.com/) 申请「行为验证 4.0」，拿到 Captcha ID 与 Key；
2. 后台填入，勾选生效场景（登录 / 注册 / 找回密码）；
3. 前端自动加载 `gt4.js`，提交时弹验证，通过后把 `lot_number / captcha_output / pass_token / gen_time` 交给服务端；
4. 服务端用 Key 做 HMAC-SHA256 签名，请求 `gcaptcha4.geetest.com/validate` 二次校验。

未填 ID 与 Key 时整段自动跳过。若极验接口本身不可达（网络故障），服务端会放行并在日志里记一条 `degraded`，避免验证服务抖动导致全站无法登录。

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
| POST | `/api/register` | 注册（username / password / name / mc / email / code / captcha） |
| POST | `/api/login` | 登录（可带 captcha） |
| POST | `/api/logout` | 退出 |
| GET | `/api/bootstrap` | 当前用户 + 全站状态（站点配置已脱敏） |
| GET | `/api/health` | 健康检查 |
| POST | `/api/op` | 业务操作（见下） |
| POST | `/api/mail/code` | 发送 6 位邮箱验证码（scene: register / reset） |
| POST | `/api/mail/test` | 管理员发送 SMTP 测试邮件 |
| POST | `/api/password/reset` | 邮箱验证码重置密码 |
| POST | `/api/upload` | 管理员上传 Logo 图片（base64） |

`/api/op` 的 `type`：`createGuild` `reviewGuild` `joinGuild` `editGuild` `kickMember`
`reportMatch` `confirmMatch` `disputeMatch` `signup` `saveScore` `awardHonor`
`readMail` `resolveReport` `setEmail` `saveSettings` `resetData`。

所有操作都在服务端校验权限：会长只能改自己的公会，确认战报必须是另一方，管理操作需要 `admin`。

## 许可

自用 / 二次开发均可。
