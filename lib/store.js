'use strict';
/**
 * 数据存储：单文件 JSON + 原子写。
 * 单机部署（几百到几千用户）足够；要上更大规模时，把 load/save 换成 Postgres 即可，
 * 其余业务代码不用动。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const seedData = require('./seed');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');

let db = null;
let timer = null;

/* ---------- 基础工具 ---------- */
function rid(prefix) {
  return prefix + '_' + crypto.randomBytes(6).toString('hex');
}
function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 64).toString('hex');
}
function verifyPassword(password, user) {
  const a = Buffer.from(hashPassword(password, user.salt), 'hex');
  const b = Buffer.from(user.pass, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
function clean(str, max) {
  return String(str == null ? '' : str)
    .replace(/[<>]/g, '')
    .replace(/[\u0000-\u001f]/g, ' ')
    .trim()
    .slice(0, max || 200);
}

/* ---------- 种子 ---------- */
const NAME_POOL = [
  '白露','南山','迟野','一苇','木鱼','子夜','廿四','青禾','铁砧','灯灯',
  '阿岚','拾贰','北辰星','洛水','半山','早川','乌鸦','柚子','秋分','不困',
  '三十','灰烬','雾灯','长夏','清和','小满','既白','南栀','北屿','见山',
  '停云','折枝','临渊','照野','听风','江离','宿雨','苔生','雪见','无咎'
];

function seedRoster(g, idx) {
  const n = g.members || 10;
  const list = [];
  for (let i = 0; i < n; i++) {
    const base = NAME_POOL[(i * 7 + idx * 3) % NAME_POOL.length];
    const name = i < NAME_POOL.length ? base : base + '·' + (Math.floor(i / NAME_POOL.length) + 1);
    list.push({
      name,
      role: i === 0 ? '会长' : i < 3 ? '副会长' : i < 6 ? '精英' : '成员',
      contrib: Math.round((n - i) * 1370),
      joined: ['2025-11-02', '2025-12-18', '2026-01-09', '2026-02-14'][i % 4],
      online: i < Math.min(8, Math.round((g.online || 0) / 2))
    });
  }
  return list;
}

function seedMatches(guilds) {
  const pairs = [
    ['beichen', 'mush', 2, 0, '荒芜之地', '昨天 21:40'],
    ['shuangxu', 'dune', 2, 1, '樱花平原', '昨天 19:05'],
    ['redstone', 'birch', 2, 0, '冰霜峡谷', '10-17'],
    ['endwalker', 'deepguard', 1, 2, '熔岩洞窟', '10-17'],
    ['oakbay', 'starglow', 2, 0, '蘑菇森林', '10-16'],
    ['forge', 'creeper', 2, 1, '沉船海湾', '10-16'],
    ['shuangxu', 'beichen', 1, 2, '荒芜之地', '10-14'],
    ['redstone', 'shuangxu', 1, 2, '樱花平原', '10-12']
  ];
  return pairs.map((p, i) => ({
    id: 'm' + (i + 1),
    aSlug: p[0], bSlug: p[1], sa: p[2], sb: p[3],
    map: p[4], timeText: p[5],
    status: 'confirmed',
    reporterId: null,
    createdAt: Date.now() - (i + 1) * 86400000
  }));
}

function makeUser({ username, password, name, mc, admin, email }) {
  const salt = crypto.randomBytes(16).toString('hex');
  return {
    id: rid('u'),
    username,
    name: name || username,
    mc: mc || '',
    email: email || '',
    salt,
    pass: hashPassword(password, salt),
    admin: !!admin,
    createdAt: Date.now()
  };
}

function setPassword(user, password) {
  user.salt = crypto.randomBytes(16).toString('hex');
  user.pass = hashPassword(password, user.salt);
  return user;
}

/* 站点默认内容：后台「站点设置」里可改，改完存进 meta.site */
function defaultSite() {
  return {
    brand: '方碑',
    brandSub: 'GUILDHUB',
    heroKicker: 'SEASON 03 · 进行中',
    heroTitleA: '群系争锋',
    heroTitleB: '第 3 赛季',
    heroLead: '128 个公会、2,431 名玩家挤在同一张榜上。平台不连接任何服务器，战绩由双方确认后计入。赛季结束那天，冠军的名字会被刻在主城广场的石碑上。',
    seasonStart: '2026-09-01',
    seasonEnd: '2026-11-30',
    seasonDays: 42,
    format: '积分 + 单败淘汰',
    scoring: '双方确认',
    championSlug: 'beichen',
    championLabel: '卫冕冠军 · S2',
    championSub: 'SEASON 02 CHAMPION',
    stats: [
      { v: '128', label: '收录公会' },
      { v: '486', label: '本赛季场次' },
      { v: '2,431', label: '注册玩家' },
      { v: '96', label: '已颁荣誉' }
    ],
    allowRegister: true,
    allowCreateGuild: true,
    logo: {
      mode: 'image',            // image | text
      url: '/assets/logo.svg',
      height: 27,
      showText: true
    },
    mail: {
      enabled: false,
      host: '',
      port: 465,
      secure: 'ssl',            // ssl | starttls | none
      user: '',
      pass: '',
      fromName: '方碑公会中心',
      fromAddr: '',
      requireVerify: false      // 注册需邮箱验证
    },
    geetest: {
      enabled: false,
      captchaId: '',
      captchaKey: '',
      scenes: { login: true, register: true, reset: true }
    }
  };
}

function seed() {
  const adminUser = process.env.ADMIN_USER || 'admin';
  const adminPass = process.env.ADMIN_PASS || 'admin123';
  const guilds = seedData.guilds.map((g, i) => Object.assign({}, g, {
    ownerId: null,
    roster: seedRoster(g, i)
  }));
  return {
    meta: { version: 1, season: 'S3', createdAt: Date.now(), site: defaultSite() },
    users: [makeUser({ username: adminUser, password: adminPass, name: '阿岚', mc: 'Alan', admin: true })],
    sessions: {},
    guilds,
    matches: seedMatches(guilds),
    reviews: [],
    reports: [],
    applications: [],
    honors: {},
    bracket: JSON.parse(JSON.stringify(seedData.bracket)),
    tournaments: JSON.parse(JSON.stringify(seedData.tournaments)),
    mails: [],
    logs: [{
      t: new Date().toISOString().slice(11, 16),
      who: '系统',
      act: '初始化站点',
      tg: '示例数据已载入'
    }]
  };
}

/* ---------- 读写 ---------- */
function load() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (fs.existsSync(DB_FILE)) {
      db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
      db.sessions = db.sessions || {};
      db.applications = db.applications || [];
      db.meta = db.meta || {};
      db.meta.site = Object.assign(defaultSite(), db.meta.site || {});
      db.meta.site.logo = Object.assign(defaultSite().logo, db.meta.site.logo || {});
      db.meta.site.mail = Object.assign(defaultSite().mail, db.meta.site.mail || {});
      db.meta.site.geetest = Object.assign(defaultSite().geetest, db.meta.site.geetest || {});
      db.meta.site.geetest.scenes = Object.assign(defaultSite().geetest.scenes, db.meta.site.geetest.scenes || {});
      return db;
    }
  } catch (e) {
    console.error('[store] 读取数据失败，将重新初始化：', e.message);
  }
  db = seed();
  saveNow();
  return db;
}

function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DB_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
    fs.renameSync(tmp, DB_FILE);
  } catch (e) {
    console.error('[store] 写入失败：', e.message);
  }
}

/** 合并短时间内的多次写入，避免每个操作都落盘 */
function save() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    saveNow();
  }, 120);
}

function get() {
  if (!db) load();
  return db;
}

function reset() {
  db = seed();
  saveNow();
  return db;
}

module.exports = {
  get, load, save, saveNow, reset,
  rid, clean, verifyPassword, makeUser, setPassword, defaultSite,
  DATA_DIR, DB_FILE
};
