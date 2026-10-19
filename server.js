'use strict';
/**
 * 方碑 · MC 公会中心 —— 可自部署服务端
 * 依赖：express（唯一生产依赖）
 * 数据：data/db.json（自动创建，原子写入）
 */
const express = require('express');
const path = require('path');
const crypto = require('crypto');
const store = require('./lib/store');

const PORT = parseInt(process.env.PORT || '3000', 10);
const HOST = process.env.HOST || '0.0.0.0';
const COOKIE = 'fb_token';
const SESSION_DAYS = 30;

const app = express();
app.set('trust proxy', 1);
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname, 'public'), {
  index: 'index.html',
  setHeaders(res, filePath) {
    // HTML 不缓存，保证改版后立刻生效；其余静态资源缓存 1 小时
    if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache');
    else res.setHeader('Cache-Control', 'public, max-age=3600');
  }
}));

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
function meOf(user) {
  if (!user) return null;
  const db = store.get();
  const g = db.guilds.find(x => x.slug === user.guildSlug);
  return {
    id: user.id, username: user.username, name: user.name, mc: user.mc,
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
    meta: db.meta,
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
function log(db, who, act, tg) {
  db.logs.unshift({ t: new Date().toISOString().slice(11, 16), who, act, tg });
  db.logs = db.logs.slice(0, 100);
}
function today() {
  return new Date().toISOString().slice(0, 10);
}

/* ---------------- 认证接口 ---------------- */
app.post('/api/register', (req, res) => {
  const ip = req.ip || '';
  if (tooMany(ip)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  const db = store.get();
  if ((db.meta.site || {}).allowRegister === false) {
    return res.status(403).json({ error: '站点暂未开放注册' });
  }
  const username = store.clean(req.body.username, 24).toLowerCase();
  const password = String(req.body.password || '');
  const name = store.clean(req.body.name, 16) || username;
  const mc = store.clean(req.body.mc, 16);
  if (!/^[a-z0-9_]{3,24}$/.test(username)) return res.status(400).json({ error: '用户名需为 3–24 位字母、数字或下划线' });
  if (password.length < 6) return res.status(400).json({ error: '密码至少 6 位' });
  if (db.users.some(u => u.username === username)) return res.status(409).json({ error: '用户名已被占用' });

  const user = store.makeUser({ username, password, name, mc });
  db.users.push(user);
  log(db, name, '注册账号', username);
  store.save();
  setSession(res, user);
  res.json({ me: meOf(user), state: publicState(user) });
});

app.post('/api/login', (req, res) => {
  const ip = req.ip || '';
  if (tooMany(ip)) return res.status(429).json({ error: '尝试过于频繁，请稍后再试' });
  const db = store.get();
  const username = store.clean(req.body.username, 24).toLowerCase();
  const user = db.users.find(u => u.username === username);
  if (!user || !store.verifyPassword(String(req.body.password || ''), user)) {
    return res.status(401).json({ error: '用户名或密码错误' });
  }
  setSession(res, user);
  res.json({ me: meOf(user), state: publicState(user) });
});

app.post('/api/logout', (req, res) => {
  const db = store.get();
  const t = tokenOf(req);
  if (t) delete db.sessions[t];
  store.save();
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
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

      case 'saveSettings': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const s = p.site || {};
        const cur = db.meta.site || store.defaultSite();
        const num = v => Math.max(0, Math.min(9999, parseInt(v, 10) || 0));
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
          allowCreateGuild: s.allowCreateGuild !== false
        };
        log(db, user.name, '更新站点设置', '首页内容');
        break;
      }

      case 'resetData': {
        if (!isAdmin) throw new Error('需要管理员权限');
        const uname = user.username;
        store.reset();
        const freshDb = store.get();
        const fresh = freshDb.users.find(u => u.username === uname) || freshDb.users[0];
        setSession(res, fresh);
        return res.json({ me: meOf(fresh), state: publicState(fresh), reset: true });
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
app.listen(PORT, HOST, () => {
  console.log(`\n  方碑 · MC 公会中心`);
  console.log(`  http://localhost:${PORT}`);
  console.log(`  数据文件：${store.DB_FILE}`);
  console.log(`  默认管理员：${process.env.ADMIN_USER || 'admin'} / ${process.env.ADMIN_PASS || 'admin123'}（首次启动生成，请尽快修改密码）\n`);
});
