'use strict';
/**
 * 方碑 · MC 公会中心 —— 可自部署服务端
 * 依赖：express（唯一生产依赖）
 * 数据：data/db.json（自动创建，原子写入）
 */
const express = require('express');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const store = require('./lib/store');
const mailer = require('./lib/mailer');
const geetest = require('./lib/geetest');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'fb_token';
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    // HTML 不缓存，保证改版后立刻生效；其余静态资源缓存 1 小时
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

const UPLOAD_DIR = path.join(store.DATA_DIR, 'uploads');
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (e) {
  console.error('[upload] 无法创建上传目录 ' + UPLOAD_DIR + '：' + e.message + '（Logo 上传将不可用，其余功能不受影响）');
}
app.use('/uploads', express.static(UPLOAD_DIR, { maxAge: '1d', fallthrough: true }));

/* ---------------- 鉴权 ---------------- */
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach(p => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}

function tokenOf(req) {
  const c = parseCookies(req.headers.cookie)[COOKIE];
  if (c) return c;
  const a = String(req.headers.authorization || '');
  return a.startsWith('Bearer ') ? a.slice(7) : '';
}

function currentUser(req) {
  const db = store.get();
  const t = tokenOf(req);
  const s = t && db.sessions[t];
  if (!s) return null;
  if (Date.now() - s.createdAt > SESSION_DAYS * 864e5) {
    delete db.sessions[t];
    return null;
  }
  return db.users.find(u => u.id === s.userId) || null;
}

function setSession(res, user) {
  const db = store.get();
  const token = crypto.randomBytes(24).toString('hex');
  db.sessions[token] = { userId: user.id, createdAt: Date.now() };
  store.save();
  res.setHeader('Set-Cookie',
    `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${SESSION_DAYS * 86400}`);
}

/* ---------------- 登录限流 ---------------- */
const loginHits = new Map();
function tooMany(ip) {
  const now = Date.now();
  const rec = loginHits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 60e3) { rec.n = 0; rec.t = now; }
  rec.n += 1;
  loginHits.set(ip, rec);
  return rec.n > 12;
}

/* ---------------- 序列化 ---------------- */
/** 站点配置对外输出：密码/密钥永不下发，管理员只拿到「是否已设置」 */
function sitePublic(site, isAdmin) {
  const s = JSON.parse(JSON.stringify(site || store.defaultSite()));
  const m = s.mail || {};
  const g = s.geetest || {};
  if (isAdmin) {
    s.mail = {
      enabled: !!m.enabled,
      host: m.host || '',
      port: m.port || 465,
      secure: m.secure || 'ssl',
      user: m.user || '',
      fromName: m.fromName || '',
      fromAddr: m.fromAddr || '',
      requireVerify: !!m.requireVerify,
      hasPass: !!m.pass
    };
    s.geetest = {
      enabled: !!g.enabled,
      captchaId: g.captchaId || '',
      scenes: g.scenes || { login: true, register: true, reset: true },
      hasKey: !!g.captchaKey
    };
  } else {
    s.mail = { enabled: !!m.enabled, requireVerify: !!m.requireVerify };
    s.geetest = { enabled: !!g.enabled, captchaId: g.captchaId || '', scenes: g.scenes || {} };
  }
  return s;
}

function meOf(user) {
  if (!user) return null;
  const db = store.get();
  const g = db.guilds.find(x => x.slug === user.guildSlug);
  return {
    id: user.id, username: user.username, name: user.name, mc: user.mc,
    email: user.email || '',
    admin: !!user.admin, guildSlug: g ? g.slug : null, guildName: g ? g.name : null
  };
}

function publicState(user) {
  const db = store.get();
  const isAdmin = !!(user && user.admin);
  const myGuild = user ? db.guilds.find(g => g.slug === user.guildSlug) : null;
  const signups = {};
  Object.keys(db.signups || {}).forEach(tid => {
    const list = db.signups[tid] || [];
    if (myGuild && list.includes(myGuild.slug)) signups[tid] = myGuild.name;
  });
  return {
    firstRun: db.users.length === 0,
    meta: Object.assign({}, db.meta, { site: sitePublic(db.meta.site, isAdmin) }),
    guilds: db.guilds,
    matches: db.matches,
    honors: db.honors,
    bracket: db.bracket,
    tournaments: db.tournaments,
    reviews: isAdmin ? db.reviews : [],
    reports: isAdmin ? db.reports : [],
    logs: isAdmin ? db.logs.slice(0, 50) : [],
    applications: isAdmin ? db.applications : [],
    mails: user ? db.mails.filter(m => m.to === user.id).slice(0, 50)
      .map(m => ({ id: m.id, from: m.from, title: m.title, body: m.body, time: m.time, unread: !m.read })) : [],
    signups,
    signupCounts: Object.fromEntries(Object.entries(db.signups || {}).map(([k, v]) => [k, v.length]))
  };
}

function mail(db, to, from, title, body) {
  db.mails.unshift({
    id: store.rid('mail'), to, from, title, body,
    time: new Date().toLocaleString('zh-CN', { hour12: false, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
    read: false
  });
  db.mails = db.mails.slice(0, 80);
}
/** 只允许站内路径 / http(s) / data:image，避免 javascript: 之类的伪协议 */
function safeImgUrl(u) {
  const v = String(u || '').trim();
  if (!v) return '';
  if (/^\/(?!\/)/.test(v)) return v;
  if (/^https?:\/\//i.test(v)) return v;
  if (/^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,/i.test(v)) return v;
  return '';
}

function log(db, who, act, tg) {
  db.logs.unshift({ t: new Date().toISOString().slice(11, 16), who, act, tg });
  db.logs = db.logs.slice(0, 100);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------- 邮箱验证码 ---------------- */
const codes = new Map();      // `${scene}:${email}` -> {code, exp, tries}
const lastSend = new Map();   // email -> ts
const CODE_TTL = 10 * 60e3;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function issueCode(email, scene) {
  const code = String(crypto.randomInt(100000, 1000000));
  codes.set(scene + ':' + email, { code, exp: Date.now() + CODE_TTL, tries: 0 });
  return code;
}
function checkCode(email, scene, code) {
  const rec = codes.get(scene + ':' + email);
  if (!rec) return { ok: false, error: '请先获取邮箱验证码' };
  if (Date.now() > rec.exp) { codes.delete(scene + ':' + email); return { ok: false, error: '验证码已过期，请重新获取' }; }
  if (rec.tries >= 6) return { ok: false, error: '尝试次数过多，请重新获取验证码' };
  rec.tries += 1;
  if (String(code || '').trim() !== rec.code) return { ok: false, error: '验证码不正确' };
  codes.delete(scene + ':' + email);
  return { ok: true };
}
function consumeCode(email, scene) { codes.delete(scene + ':' + email); }

/* ---------------- 认证接口 ---------------- */
app.post('/api/register', async (req, res) => {
  const ip = req.ip || '';
  if (tooMany(ip)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  const db = store.get();
  const site = db.meta.site || store.defaultSite();
  const firstRun = db.users.length === 0;
  // 一个人都没有时，即使关掉了注册也要放行，否则永远没人能当站长
  if (site.allowRegister === false && !firstRun) {
    return res.status(403).json({ error: '站点暂未开放注册' });
  }

  if (geetest.sceneOn(site.geetest, 'register')) {
    const g = await geetest.verify(site.geetest, req.body.captcha);
    if (!g.ok) return res.status(400).json({ error: g.reason || '人机验证未通过' });
    if (g.degraded) console.warn('[geetest] register', g.reason);
  }

  const username = store.clean(req.body.username, 24).toLowerCase();
  const password = String(req.body.password || '');
  const name = store.clean(req.body.name, 16) || username;
  const mc = store.clean(req.body.mc, 16);
  const email = store.clean(req.body.email, 64).toLowerCase();
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: '用户名需为 3–24 位字母、数字或下划线' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (email && !EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (db.users.some(u => u.username === username)) return res.status(409).json({ error: '用户名已被占用' });
  if (email && db.users.some(u => (u.email || '') === email)) return res.status(409).json({ error: '该邮箱已被注册' });

  const needMail = !!(site.mail && site.mail.requireVerify);
  if (needMail) {
    if (!email) return res.status(400).json({ error: '本站注册需要邮箱验证' });
    if (!mailer.ready(site.mail)) return res.status(400).json({ error: '站点尚未配置邮件服务，暂时无法完成邮箱验证' });
    const c = checkCode(email, 'register', req.body.code);
    if (!c.ok) return res.status(400).json({ error: c.error });
  }

  const user = store.makeUser({ username, password, name, mc, email, admin: firstRun });
  db.users.push(user);
  log(db, name, firstRun ? '注册站长账号' : '注册账号', username);
  store.save();
  setSession(res, user);
  res.json({ me: meOf(user), state: publicState(user) });
});

app.post('/api/login', async (req, res) => {
  const ip = req.ip || '';
  if (tooMany(ip)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  const db = store.get();
  const site = db.meta.site || store.defaultSite();

  if (geetest.sceneOn(site.geetest, 'login')) {
    const g = await geetest.verify(site.geetest, req.body.captcha);
    if (!g.ok) return res.status(400).json({ error: g.reason || '人机验证未通过' });
    if (g.degraded) console.warn('[geetest] login', g.reason);
  }

  const username = store.clean(req.body.username, 24).toLowerCase();
  const user = db.users.find(u => u.username === username);
  if (!user || !store.verifyPassword(String(req.body.password || ''), user)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  setSession(res, user);
  res.json({ me: meOf(user), state: publicState(user) });
});

/* ---------------- 发信 / 找回密码 ---------------- */
app.post('/api/mail/code', async (req, res) => {
  const site = store.get().meta.site || store.defaultSite();
  const ip = req.ip || '';
  if (tooMany(ip)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });

  const scene = req.body.scene === 'reset' ? 'reset' : 'register';
  const email = store.clean(req.body.email, 64).toLowerCase();
  if (!EMAIL_RE.test(email)) return res.status(400).json({ error: '邮箱格式不正确' });
  if (!mailer.ready(site.mail)) return res.status(400).json({ error: '站点尚未配置邮件服务' });

  const now = Date.now();
  const last = lastSend.get(email) || 0;
  if (now - last < 60e3) return res.status(429).json({ error: '发送过于频繁，请 ' + Math.ceil((60e3 - (now - last)) / 1000) + ' 秒后再试' });

  if (scene === 'reset') {
    const u = store.get().users.find(x => (x.email || '') === email);
    if (!u) return res.status(404).json({ error: '该邮箱没有绑定账号' });
  }

  const code = issueCode(email, scene);
  const purpose = scene === 'reset' ? '重置方碑账号密码' : '注册方碑账号';
  const out = await mailer.send(site.mail, {
    to: email,
    subject: `【${site.brand || '方碑'}】验证码 ${code}`,
    text: mailer.codeMail(site.brand || '方碑', code, CODE_TTL / 60e3, purpose)
  });
  if (!out.ok) return res.status(502).json({ error: '邮件发送失败：' + out.error });

  lastSend.set(email, now);
  res.json({ ok: true, ttl: CODE_TTL / 1000 });
});

app.post('/api/mail/test', async (req, res) => {
  const user = currentUser(req);
  if (!user || !user.admin) return res.status(403).json({ error: '需要管理员权限' });
  const site = store.get().meta.site || store.defaultSite();
  const to = store.clean(req.body.to, 64).toLowerCase();
  if (!EMAIL_RE.test(to)) return res.status(400).json({ error: '收件邮箱格式不正确' });
  const out = await mailer.send(site.mail, {
    to,
    subject: `【${site.brand || '方碑'}】SMTP 测试邮件`,
    text: [
      '这是一封测试邮件。',
      '',
      '如果你收到了它，说明后台的 SMTP 配置可以正常发信。',
      '',
      '—— ' + (site.brand || '方碑')
    ].join('\n')
  });
  if (!out.ok) return res.status(502).json({ error: out.error });
  res.json({ ok: true });
});

app.post('/api/password/reset', async (req, res) => {
  const db = store.get();
  const site = db.meta.site || store.defaultSite();

  if (geetest.sceneOn(site.geetest, 'reset')) {
    const g = await geetest.verify(site.geetest, req.body.captcha);
    if (!g.ok) return res.status(400).json({ error: g.reason || '人机验证未通过' });
  }

  const email = store.clean(req.body.email, 64).toLowerCase();
  const password = String(req.body.password || '');
  if (password.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  const user = db.users.find(u => (u.email || '') === email);
  if (!user) return res.status(404).json({ error: '该邮箱没有绑定账号' });
  const c = checkCode(email, 'reset', req.body.code);
  if (!c.ok) return res.status(400).json({ error: c.error });

  store.setPassword(user, password);
  // 该账号的其他会话全部失效
  Object.keys(db.sessions).forEach(t => { if (db.sessions[t].userId === user.id) delete db.sessions[t]; });
  log(db, user.name, '重置密码', email);
  store.save();
  res.json({ ok: true });
});

/* ---------------- 图片上传（管理员） ---------------- */
app.post('/api/upload', (req, res) => {
  const user = currentUser(req);
  if (!user || !user.admin) return res.status(403).json({ error: '需要管理员权限' });
  const dataUrl = String(req.body.dataUrl || '');
  const m = /^data:image\/(png|jpeg|jpg|gif|webp|svg\+xml);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
  if (!m) return res.status(400).json({ error: '只支持 PNG / JPG / WEBP / GIF / SVG' });
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 1.5 * 1024 * 1024) return res.status(400).json({ error: '图片请小于 1.5 MB' });
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1] === 'svg+xml' ? 'svg' : m[1];
  if (ext === 'svg') {
    const txt = buf.toString('utf8');
    if (/<script|onload=|onerror=|onclick=|javascript:/i.test(txt)) {
      return res.status(400).json({ error: 'SVG 中含脚本内容，已拒绝' });
    }
  }
  const name = 'logo-' + crypto.randomBytes(8).toString('hex') + '.' + ext;
  try {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(path.join(UPLOAD_DIR, name), buf);
  } catch (e) {
    return res.status(500).json({ error: '写入上传目录失败：' + e.message + '（检查 data 目录是否可写）' });
  }
  res.json({ url: '/uploads/' + name, size: buf.length });
});

app.post('/api/logout', (req, res) => {
  const db = store.get();
  const t = tokenOf(req);
  if (t) delete db.sessions[t];
  store.save();
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
  res.json({ ok: true });
});

app.post('/api/password/change', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const oldPass = String(req.body.old || '');
  const newPass = String(req.body.new || '');
  if (!store.verifyPassword(oldPass, user)) return res.status(400).json({ error: '当前密码不正确' });
  if (newPass.length < 6) return res.status(400).json({ error: '新密码至少 6 位' });
  if (newPass === oldPass) return res.status(400).json({ error: '新密码不能和旧密码相同' });

  store.setPassword(user, newPass);
  const db = store.get();
  const keep = tokenOf(req);
  Object.keys(db.sessions).forEach(t => {
    if (t !== keep && db.sessions[t].userId === user.id) delete db.sessions[t];
  });
  log(db, user.name, '修改密码', user.username);
  store.save();
  res.json({ ok: true });
});

app.get('/api/bootstrap', (req, res) => {
  const user = currentUser(req);
  res.json({ me: meOf(user), state: publicState(user) });
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

/* ---------------- 业务操作 ---------------- */
app.post('/api/op', (req, res) => {
  const user = currentUser(req);
  if (!user) return res.status(401).json({ error: '请先登录' });
  const db = store.get();
  const { type } = req.body || {};
  const p = req.body || {};
  const myGuild = db.guilds.find(g => g.slug === user.guildSlug);
  const isAdmin = !!user.admin;

  try {
    switch (type) {
      /* ---- 建会 ---- */
      case 'createGuild': {
        if ((db.meta.site || {}).allowCreateGuild === false) throw new Error('站点暂未开放创建公会');
        if (myGuild) throw new Error('你已经在一个公会里了');
        const name = store.clean(p.name, 12);
        const intro = store.clean(p.intro, 400);
        if (name.length < 2) throw new Error('公会名至少 2 个字');
        if (db.guilds.some(g => g.name === name) || db.reviews.some(r => r.name === name && r.applicantId !== user.id)) {
          throw new Error('这个公会名已经被占用了');
        }
        if (db.reviews.some(r => r.applicantId === user.id)) throw new Error('你已经有一份待审核的建会申请');
        db.reviews.unshift({
          id: store.rid('rev'), name,
          badge: store.clean(p.badge, 2).slice(0, 2) || name.slice(0, 1),
          color: /^#[0-9a-fA-F]{6}$/.test(p.color || '') ? p.color : '#2DD4BF',
          by: user.name, server: store.clean(p.server, 16) || '未填写',
          time: '刚刚', intro: intro || '还没有写简介。',
          applicantId: user.id
        });
        log(db, user.name, '提交建会申请', name);
        break;
      }

      /* ---- 审核建会 ---- */
      case 'reviewGuild': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const r = db.reviews.find(x => x.id === p.id);
        if (!r) throw new Error('申请不存在或已处理');
        db.reviews = db.reviews.filter(x => x.id !== r.id);
        if (p.approve) {
          const applicant = db.users.find(u => u.id === r.applicantId);
          if (db.guilds.some(g => g.name === r.name)) throw new Error('同名公会已存在');
          const slug = 'g' + crypto.randomBytes(4).toString('hex');
          db.guilds.push({
            slug, name: r.name, badge: r.badge, color: r.color, level: 1, points: 1000,
            wr: 0, members: 1, trend: 0, recruit: true, server: r.server, founded: today(),
            online: 0, tags: ['新会'], intro: r.intro, ownerId: r.applicantId,
            roster: [{ name: applicant ? applicant.name : r.by, role: '会长', contrib: 0, joined: today(), online: true, userId: r.applicantId }]
          });
          if (applicant) {
            applicant.guildSlug = slug;
            mail(db, applicant.id, '方碑 · 站务', '建会申请已通过', `「${r.name}」已通过审核，你现在是会长，可以邀请成员并报名赛事。`);
          }
          log(db, user.name, '通过建会', r.name);
        } else {
          const applicant = db.users.find(u => u.id === r.applicantId);
          if (applicant) mail(db, applicant.id, '方碑 · 站务', '建会申请未通过', `「${r.name}」的申请未通过，可修改名称或简介后重新提交。`);
          log(db, user.name, '驳回建会', r.name);
        }
        break;
      }

      /* ---- 入会 ---- */
      case 'joinGuild': {
        if (myGuild) throw new Error('你已经在一个公会里了');
        const g = db.guilds.find(x => x.slug === p.slug);
        if (!g) throw new Error('公会不存在');
        if (g.recruit) {
          g.roster = g.roster || [];
          g.roster.push({ name: user.name, role: '成员', contrib: 0, joined: today(), online: true, userId: user.id });
          g.members = g.roster.length;
          user.guildSlug = g.slug;
          const owner = db.users.find(u => u.id === g.ownerId);
          if (owner) mail(db, owner.id, user.name, '有新成员加入', `${user.name} 加入了「${g.name}」。`);
          log(db, user.name, '加入公会', g.name);
        } else {
          db.applications.unshift({ id: store.rid('app'), guildSlug: g.slug, userId: user.id, name: user.name, message: store.clean(p.message, 200), time: '刚刚' });
          const owner = db.users.find(u => u.id === g.ownerId);
          if (owner) mail(db, owner.id, user.name, '入会申请', `${user.name} 申请加入「${g.name}」：${store.clean(p.message, 200) || '（未填写）'}`);
        }
        break;
      }

      /* ---- 编辑公会 ---- */
      case 'editGuild': {
        const g = db.guilds.find(x => x.slug === p.slug);
        if (!g) throw new Error('公会不存在');
        if (!isAdmin && g.ownerId !== user.id) throw new Error('只有会长可以编辑');
        if (p.intro != null) g.intro = store.clean(p.intro, 400);
        if (p.recruit != null) g.recruit = !!p.recruit;
        log(db, user.name, '编辑公会资料', g.name);
        break;
      }

      /* ---- 成员 ---- */
      case 'kickMember': {
        const g = myGuild || db.guilds.find(x => x.slug === p.slug);
        if (!g) throw new Error('公会不存在');
        if (!isAdmin && g.ownerId !== user.id) throw new Error('只有会长可以移出成员');
        const n = store.clean(p.name, 16);
        const entry = (g.roster || []).find(m => m.name === n);
        if (!entry) throw new Error('成员不存在');
        if (entry.role === '会长') throw new Error('不能移出会长');
        g.roster = g.roster.filter(m => m.name !== n);
        g.members = g.roster.length;
        const target = db.users.find(u => u.id === entry.userId);
        if (target) { target.guildSlug = null; mail(db, target.id, '系统', '你已被移出公会', `你已被移出「${g.name}」。`); }
        log(db, user.name, '移出成员', g.name + ' · ' + n);
        break;
      }

      /* ---- 战报 ---- */
      case 'reportMatch': {
        if (!myGuild) throw new Error('先加入一个公会才能提交战报');
        const opp = db.guilds.find(x => x.slug === p.oppSlug);
        if (!opp || opp.slug === myGuild.slug) throw new Error('对手不合法');
        const sa = Math.max(0, Math.min(5, parseInt(p.sa, 10) || 0));
        const sb = Math.max(0, Math.min(5, parseInt(p.sb, 10) || 0));
        if (sa === sb) throw new Error('比分不能相同');
        const m = {
          id: store.rid('m'), aSlug: myGuild.slug, bSlug: opp.slug, sa, sb,
          map: store.clean(p.map, 20) || '未填写', status: 'pending',
          reporterId: user.id, timeText: '刚刚', createdAt: Date.now()
        };
        db.matches.unshift(m);
        const oppOwner = db.users.find(u => u.id === opp.ownerId);
        if (oppOwner) mail(db, oppOwner.id, myGuild.name + ' · ' + user.name, '战报待确认', `${myGuild.name} 提交了 ${sa}:${sb}（${m.map}），请确认或提出异议。`);
        else db.users.filter(u => u.admin).forEach(a => mail(db, a.id, myGuild.name, '战报待确认（对手无会长）', `${myGuild.name} vs ${opp.name}，${sa}:${sb}，等待站务代确认。`));
        log(db, user.name, '提交战报', `${myGuild.name} ${sa}:${sb} ${opp.name}`);
        break;
      }

      case 'confirmMatch':
      case 'disputeMatch': {
        const m = db.matches.find(x => x.id === p.id);
        if (!m || m.status !== 'pending') throw new Error('该战报已处理');
        const a = db.guilds.find(g => g.slug === m.aSlug);
        const b = db.guilds.find(g => g.slug === m.bSlug);
        // 只有「被提交方」（bSlug，即对手）或站长可以确认/异议；
        // 提交方本会的人（包括其他成员）不能自己确认自己的战报。
        const isOpponent = user.guildSlug && user.guildSlug === m.bSlug;
        if (!isAdmin && !(isOpponent && user.id !== m.reporterId)) {
          throw new Error('只有对方公会可以处理这条战报');
        }

        if (type === 'disputeMatch') {
          m.status = 'disputed';
          db.reports.unshift({
            id: store.rid('rep'), title: '战报争议', target: (a || {}).name || m.aSlug,
            by: user.name, match: `${(a || {}).name} ${m.sa}:${m.sb} ${(b || {}).name}`,
            time: '刚刚', detail: store.clean(p.reason, 200) || '对方提出异议，等待站务裁定。', ev: '—'
          });
          log(db, user.name, '提出异议', m.id);
          break;
        }

        m.status = 'confirmed';
        m.confirmedAt = Date.now();
        const aw = m.sa > m.sb;
        const winner = aw ? a : b, loser = aw ? b : a;
        if (winner) { winner.points = (winner.points || 1000) + 6; winner.trend = 1; }
        if (loser) { loser.points = Math.max(800, (loser.points || 1000) - 3); loser.trend = -1; }
        const reporter = db.users.find(u => u.id === m.reporterId);
        if (reporter && reporter.id !== user.id) mail(db, reporter.id, '系统', '战报已确认', `${(a || {}).name} ${m.sa}:${m.sb} ${(b || {}).name} 已确认，积分已更新。`);
        log(db, user.name, '确认战报', `${(a || {}).name} ${m.sa}:${m.sb} ${(b || {}).name}`);
        break;
      }

      /* ---- 赛事 ---- */
      case 'signup': {
        if (!myGuild) throw new Error('先加入一个公会');
        const t = db.tournaments.find(x => x.id === p.tournamentId);
        if (!t) throw new Error('赛事不存在');
        if (t.status !== 'open') throw new Error('该赛事已停止报名');
        db.signups = db.signups || {};
        const list = db.signups[t.id] || (db.signups[t.id] = []);
        if (list.includes(myGuild.slug)) throw new Error('已经报过名了');
        if (list.length >= t.cap) throw new Error('名额已满');
        list.push(myGuild.slug);
        log(db, user.name, '赛事报名', t.name + ' · ' + myGuild.name);
        break;
      }

      case 'saveScore': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const sa = Math.max(0, Math.min(5, parseInt(p.sa, 10) || 0));
        const sb = Math.max(0, Math.min(5, parseInt(p.sb, 10) || 0));
        if (sa === sb) throw new Error('淘汰赛不能平局');
        let mt = null;
        db.bracket.forEach(r => (r.ms || []).forEach(m => { if (m.id === p.id) mt = m; }));
        if (!mt) throw new Error('场次不存在');
        mt.sa = sa; mt.sb = sb; mt.done = true;
        const winner = sa > sb ? mt.a : mt.b;
        const final = db.bracket[2] && db.bracket[2].ms[0];
        if (final) {
          if (mt.id === 'r2m1') final.a = winner;
          if (mt.id === 'r2m2') final.b = winner;
        }
        log(db, user.name, '录入赛事比分', `${mt.a} ${sa}:${sb} ${mt.b}`);
        break;
      }

      /* ---- 荣誉 ---- */
      case 'awardHonor': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const g = db.guilds.find(x => x.slug === p.slug);
        if (!g) throw new Error('公会不存在');
        const title = store.clean(p.title, 40);
        if (!title) throw new Error('请填写荣誉名称');
        db.honors[g.slug] = db.honors[g.slug] || [];
        db.honors[g.slug].unshift({
          y: String(new Date().getFullYear()),
          t: title,
          tier: ['S', 'A', 'B'].includes(p.tier) ? p.tier : 'A',
          r: store.clean(p.rank, 12) || '获奖',
          n: '由站务颁发'
        });
        const owner = db.users.find(u => u.id === g.ownerId);
        if (owner) mail(db, owner.id, '方碑 · 站务', '公会获得新荣誉', `「${g.name}」获得：${title}。`);
        log(db, user.name, '颁发荣誉', g.name + ' · ' + title);
        break;
      }

      /* ---- 站内信 / 仲裁 ---- */
      case 'readMail': {
        const m = db.mails.find(x => x.id === p.id && x.to === user.id);
        if (m) m.read = true;
        if (p.all) db.mails.forEach(x => { if (x.to === user.id) x.read = true; });
        break;
      }

      case 'resolveReport': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const r = db.reports.find(x => x.id === p.id);
        if (!r) throw new Error('举报不存在');
        db.reports = db.reports.filter(x => x.id !== r.id);
        if (p.uphold) {
          const g = db.guilds.find(x => x.name === r.target);
          if (g) g.points = Math.max(800, (g.points || 1000) - 20);
          log(db, user.name, '举报成立', r.target);
        } else {
          log(db, user.name, '驳回举报', r.target);
        }
        break;
      }

      case 'setEmail': {
        const email = store.clean(p.email, 64).toLowerCase();
        if (email && !EMAIL_RE.test(email)) throw new Error('邮箱格式不正确');
        if (email && db.users.some(u => u.id !== user.id && (u.email || '') === email)) {
          throw new Error('该邮箱已被其他账号使用');
        }
        user.email = email;
        log(db, user.name, email ? '绑定邮箱' : '解绑邮箱', email || '—');
        break;
      }

      case 'saveSettings': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const s = p.site || {};
        const cur = db.meta.site || store.defaultSite();
        const num = v => Math.max(0, Math.min(9999, parseInt(v, 10) || 0));
        const logo = s.logo || {};
        const mail = s.mail || {};
        const gt = s.geetest || {};
        const stats = Array.isArray(s.stats)
          ? s.stats.slice(0, 4).map((x, i) => ({
              v: store.clean(x && x.v, 12) || (cur.stats[i] ? cur.stats[i].v : ''),
              label: store.clean(x && x.label, 12) || (cur.stats[i] ? cur.stats[i].label : '')
            }))
          : cur.stats;
        db.meta.site = {
          brand: store.clean(s.brand, 12) || cur.brand,
          brandSub: store.clean(s.brandSub, 16) || cur.brandSub,
          heroKicker: store.clean(s.heroKicker, 40),
          heroTitleA: store.clean(s.heroTitleA, 20),
          heroTitleB: store.clean(s.heroTitleB, 20),
          heroLead: store.clean(s.heroLead, 200),
          seasonStart: store.clean(s.seasonStart, 20),
          seasonEnd: store.clean(s.seasonEnd, 20),
          seasonDays: num(s.seasonDays),
          format: store.clean(s.format, 30),
          scoring: store.clean(s.scoring, 30),
          championSlug: store.clean(s.championSlug, 40),
          championLabel: store.clean(s.championLabel, 30),
          championSub: store.clean(s.championSub, 40),
          stats,
          allowRegister: s.allowRegister !== false,
          allowCreateGuild: s.allowCreateGuild !== false,
          logo: {
            mode: logo.mode === 'text' ? 'text' : 'image',
            url: safeImgUrl(store.clean(logo.url, 300)) || (cur.logo && cur.logo.url) || '/assets/logo.svg',
            height: Math.max(16, Math.min(48, parseInt(logo.height, 10) || 27)),
            showText: logo.showText !== false
          },
          mail: {
            enabled: !!mail.enabled,
            host: store.clean(mail.host, 120),
            port: Math.max(1, Math.min(65535, parseInt(mail.port, 10) || 465)),
            secure: ['ssl', 'starttls', 'none'].indexOf(mail.secure) >= 0 ? mail.secure : 'ssl',
            user: store.clean(mail.user, 120),
            pass: mail.pass ? String(mail.pass).slice(0, 200) : ((cur.mail && cur.mail.pass) || ''),
            fromName: store.clean(mail.fromName, 40),
            fromAddr: store.clean(mail.fromAddr, 120),
            requireVerify: !!mail.requireVerify
          },
          geetest: {
            enabled: !!gt.enabled,
            captchaId: store.clean(gt.captchaId, 64),
            captchaKey: gt.captchaKey ? String(gt.captchaKey).slice(0, 128) : ((cur.geetest && cur.geetest.captchaKey) || ''),
            scenes: {
              login: !gt.scenes || gt.scenes.login !== false,
              register: !gt.scenes || gt.scenes.register !== false,
              reset: !gt.scenes || gt.scenes.reset !== false
            }
          }
        };
        log(db, user.name, '更新站点设置', '站点内容');
        break;
      }

      case 'resetData': {
        if (!isAdmin) throw new Error('需要管理员权限');
        // 重置只清内容，必须保住当前站长，否则没人能再进后台
        const keep = Object.assign({}, user, { admin: true });
        store.reset();
        const freshDb = store.get();
        freshDb.users = [keep];
        freshDb.sessions = {};
        setSession(res, keep);
        return res.json({ me: meOf(keep), state: publicState(keep), reset: true });
      }

      default:
        throw new Error('未知操作：' + type);
    }

    store.save();
    res.json({ me: meOf(user), state: publicState(user) });
  } catch (e) {
    res.status(400).json({ error: e.message || '操作失败' });
  }
});

/* SPA 兜底 */
app.get('*', (req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'not found' });
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

store.load();

/* ADMIN_RESET_PASS=1 时，用 ADMIN_PASS 覆盖现有管理员的密码（忘记密码时用） */
(function resetAdminPass() {
  const flag = String(process.env.ADMIN_RESET_PASS || '').toLowerCase();
  if (flag !== '1' && flag !== 'true') return;
  const db = store.get();
  const adm = db.users.find(u => u.admin) || db.users[0];
  const pass = String(process.env.ADMIN_PASS || '');
  if (!adm) {
    console.error('[admin] 数据库里还没有任何账号，先打开首页注册（第一个注册的账号自动成为站长）');
    return;
  }
  if (!adm.admin) adm.admin = true;
  if (pass.length < 6) {
    console.error('[admin] ADMIN_RESET_PASS 已开启，但 ADMIN_PASS 为空或少于 6 位，已跳过');
    return;
  }
  store.setPassword(adm, pass);
  Object.keys(db.sessions).forEach(t => {
    if (db.sessions[t].userId === adm.id) delete db.sessions[t];
  });
  store.saveNow();
  console.log(`[admin] 已按环境变量重置管理员「${adm.username}」的密码，所有旧会话已失效`);
})();

if (HOST === 'localhost' || HOST === '127.0.0.1') {
  console.warn('[警告] HOST=' + HOST + ' 只监听回环地址，容器外（含 -p 映射）访问不到。容器部署请用 HOST=0.0.0.0');
}

const server = app.listen(PORT, HOST, () => {
  const addr = server.address();
  const ip = addr && typeof addr === 'object' ? addr.address : HOST;
  console.log(`\n  方碑 · MC 公会中心`);
  console.log(`  监听地址：${ip}:${PORT}${ip === '0.0.0.0' ? '（所有网卡）' : ''}`);
  console.log(`  本机访问：http://localhost:${PORT}`);
  console.log(`  数据目录：${store.DATA_DIR}`);
  const u = store.get().users;
  const adm = u.find(x => x.admin);
  if (!u.length) {
    console.log('  账号：还没有 —— 打开首页点「注册」，第一个注册的账号自动成为站长');
  } else if (adm) {
    console.log(`  站长：${adm.username}（共 ${u.length} 个账号；改密码在右上角头像里）`);
    console.log('  忘记密码：ADMIN_PASS=新密码 ADMIN_RESET_PASS=1 重启一次');
  } else {
    console.log(`  注意：已有 ${u.length} 个账号但没有站长，用 ADMIN_RESET_PASS=1 可把第一个账号提为站长`);
  }
  console.log('');
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`\n[启动失败] 端口 ${PORT} 已被占用。`);
    console.error(`  本机：换个端口，PORT=8080 npm start`);
    console.error(`  容器：在 .env 里改 PORT=8080，再 docker compose up -d\n`);
  } else if (e.code === 'EACCES') {
    console.error(`\n[启动失败] 没有权限绑定端口 ${PORT}（1024 以下需要 root）。换个高位端口即可。\n`);
  } else {
    console.error('\n[启动失败]', e);
  }
  process.exit(1);
});
