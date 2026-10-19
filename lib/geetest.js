'use strict';
/**
 * 极验 4.0 服务端二次校验
 * 配置来自 meta.site.geetest：captcha_id / captcha_key / 场景开关。
 *
 * 策略：
 *  - 未启用或未填全 ID+Key   → 跳过（视为未开启）
 *  - 缺少前端 token          → 拒绝
 *  - 校验接口返回 fail       → 拒绝
 *  - 校验接口网络异常        → 放行（记入日志），避免验证服务抖动导致全站无法登录
 */
const crypto = require('crypto');
const ENDPOINT = 'https://gcaptcha4.geetest.com/validate';

function active(cfg) {
  return !!(cfg && cfg.enabled && cfg.captchaId && cfg.captchaKey);
}

function sceneOn(cfg, scene) {
  if (!active(cfg)) return false;
  const sc = cfg.scenes || {};
  return sc[scene] !== false;
}

function sign(lotNumber, key) {
  return crypto.createHmac('sha256', key).update(String(lotNumber)).digest('hex');
}

/**
 * @returns {Promise<{ok:boolean, skipped?:boolean, degraded?:boolean, reason?:string}>}
 */
async function verify(cfg, token) {
  if (!active(cfg)) return { ok: true, skipped: true };
  const t = token || {};
  const need = ['lot_number', 'captcha_output', 'pass_token', 'gen_time'];
  if (need.some(k => t[k] == null || t[k] === '')) {
    return { ok: false, reason: '请先完成人机验证' };
  }

  const body = new URLSearchParams({
    lot_number: String(t.lot_number),
    captcha_output: String(t.captcha_output),
    pass_token: String(t.pass_token),
    gen_time: String(t.gen_time),
    sign_token: sign(t.lot_number, cfg.captchaKey)
  });

  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 6000);
    const r = await fetch(`${ENDPOINT}?captcha_id=${encodeURIComponent(cfg.captchaId)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal
    });
    clearTimeout(timer);
    const d = await r.json().catch(() => ({}));
    if (d && d.result === 'success') return { ok: true };
    return { ok: false, reason: (d && (d.reason || d.msg)) || '人机验证未通过' };
  } catch (e) {
    return { ok: true, degraded: true, reason: '验证服务不可用，已放行：' + ((e && e.message) || 'network') };
  }
}

module.exports = { active, sceneOn, verify };
