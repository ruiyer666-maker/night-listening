'use strict';

// 网易云桥接
//
// 原项目在 server.js 里直接 require('NeteaseCloudMusicApi')，在自己进程里调用。
// Vesper 改成统一走项目自带的网易云接口服务（../netease-api，双击"启动网易云接口.bat"，默认 http://127.0.0.1:3000）：
//   - 只维护一份接口服务：国内 IP、音频转发这些修补都在那边
//   - 这里导出的函数和 NeteaseCloudMusicApi 同名、同参数、同返回格式（{ status, body, cookie }），server.js 不用改
//
// 约定：
//   - 普通参数放地址里，cookie 放 POST 请求体里（不会出现在接口服务窗口的日志里，演示投屏时安全）
//   - 每次都带 timestamp：接口服务会按地址缓存 2 分钟，登录状态、喜欢这些不能读到旧结果
//   - song_url_v1 先用 weapi 加密方式：实测默认方式约三分之一请求会被风控拒绝（-460），weapi 稳定

const BASE = String(process.env.VESPER_NETEASE_API || 'http://127.0.0.1:3000').replace(/\/+$/, '');
const TIMEOUT_MS = 15000;

// 接口服务的路由名就是函数名把下划线换成斜杠，只有这三个例外（见 NeteaseCloudMusicApi/server.js 的 special）
const SPECIAL_ROUTES = {
  daily_signin: '/daily_signin',
  fm_trash: '/fm_trash',
  personal_fm: '/personal_fm',
};

function routeOf(name) {
  return SPECIAL_ROUTES[name] || '/' + name.replace(/_/g, '/');
}

function splitQuery(query) {
  const params = new URLSearchParams();
  const body = {};
  for (const [key, value] of Object.entries(query || {})) {
    if (value === undefined || value === null) continue;
    if (key === 'cookie') {
      // 接口服务会对字符串 cookie 做一次 decodeURIComponent，这里先编码，带 % 的 cookie 才不会出错
      body.cookie = typeof value === 'string' ? encodeURIComponent(value) : value;
    } else if (typeof value === 'object') {
      body[key] = value;
    } else {
      params.set(key, String(value));
    }
  }
  if (!params.has('timestamp')) params.set('timestamp', String(Date.now()));
  return { params, body };
}

function readSetCookie(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const raw = headers.get('set-cookie');
  return raw ? raw.split(/,(?=\s*[^;,\s]+=)/) : [];
}

async function callRoute(name, query) {
  const { params, body } = splitQuery(query);
  const url = `${BASE}${routeOf(name)}?${params}`;
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    const offline = err && (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message));
    const message = offline
      ? `连不上网易云接口服务（${BASE}）。请先双击"启动网易云接口.bat"。`
      : `网易云接口请求失败：${err.message}`;
    const failure = { status: 502, body: { code: 502, msg: message, message }, cookie: [] };
    failure.message = message;
    throw failure;
  }
  let data;
  const text = await response.text();
  try { data = text ? JSON.parse(text) : {}; } catch (_) { data = { code: response.status, raw: text }; }
  const answer = { status: response.status, body: data, cookie: readSetCookie(response.headers) };
  // 和 NeteaseCloudMusicApi 本身一样：状态码 100~399 算成功，其余抛出同样结构的对象
  if (answer.status > 100 && answer.status < 400) return answer;
  answer.message = (data && (data.message || data.msg)) || `HTTP ${answer.status}`;
  throw answer;
}

async function songUrlV1(query) {
  try {
    const first = await callRoute('song_url_v1', { crypto: 'weapi', ...query });
    const item = first.body && Array.isArray(first.body.data) ? first.body.data[0] : null;
    if (first.body && first.body.code !== -460 && item && item.url) return first;
  } catch (_) {
    // weapi 失败就退回默认方式再试一次
  }
  return callRoute('song_url_v1', query);
}

const overrides = { song_url_v1: songUrlV1 };
const cache = new Map();

module.exports = new Proxy({}, {
  get(target, name) {
    if (typeof name !== 'string' || name === 'then') return undefined;
    if (Object.prototype.hasOwnProperty.call(target, name)) return target[name];
    if (overrides[name]) return overrides[name];
    if (!cache.has(name)) cache.set(name, (query = {}) => callRoute(name, query));
    return cache.get(name);
  },
});
module.exports.NETEASE_API_BASE = BASE;
