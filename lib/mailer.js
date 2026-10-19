'use strict';
/**
 * 邮件发信（SMTP）
 * 配置来自 meta.site.mail，全部由后台「站点设置 → 邮件服务」维护。
 */
const nodemailer = require('nodemailer');

function cfgOf(site) {
  return (site && site.mail) || {};
}

/** 配置是否完整到可以发信 */
function ready(cfg) {
  return !!(cfg && cfg.enabled && cfg.host && (cfg.fromAddr || cfg.user));
}

function transportOf(cfg) {
  const secure = cfg.secure !== 'starttls' && cfg.secure !== 'none' ? true : false;
  const opts = {
    host: cfg.host,
    port: Number(cfg.port) || (secure ? 465 : 587),
    secure,
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 15000
  };
  if (cfg.user) opts.auth = { user: cfg.user, pass: cfg.pass || '' };
  if (!secure) opts.requireTLS = cfg.secure === 'starttls';
  return nodemailer.createTransport(opts);
}

function fromOf(cfg) {
  const addr = cfg.fromAddr || cfg.user || '';
  return cfg.fromName ? `"${cfg.fromName}" <${addr}>` : addr;
}

/**
 * 发送一封纯文本邮件
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function send(cfg, { to, subject, text }) {
  if (!ready(cfg)) return { ok: false, error: '邮件服务未配置' };
  try {
    const info = await transportOf(cfg).sendMail({
      from: fromOf(cfg),
      to,
      subject,
      text
    });
    return { ok: true, id: info && info.messageId };
  } catch (e) {
    return { ok: false, error: (e && e.message) || '发送失败' };
  }
}

function codeMail(siteName, code, minutes, purpose) {
  return [
    `你正在${purpose}，本次验证码：`,
    '',
    `    ${code}`,
    '',
    `${minutes} 分钟内有效，请勿转发给他人。`,
    '如果不是你本人操作，忽略这封邮件即可。',
    '',
    `—— ${siteName}`
  ].join('\n');
}

module.exports = { ready, send, codeMail, cfgOf };
