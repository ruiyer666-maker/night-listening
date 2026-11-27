'use strict';

// Vesper 只接入网易云音乐。原项目里 QQ 音乐、酷狗、汽水、Spotify 的接口模块都换成了这里的空实现：
// 名字照旧导出，这样 server.js 里引用它们的地方不用一处处改；真被调用到时返回"未接入"。

const DISABLED_MESSAGE = 'Vesper 只接入了网易云音乐，这个平台的接口已移除。';

function sendDisabled(res) {
  if (!res || typeof res.writeHead !== 'function' || res.headersSent) return;
  res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ ok: false, code: 410, error: 'PROVIDER_DISABLED', message: DISABLED_MESSAGE }));
}

function makeStub(name) {
  if (/^handle/.test(name)) {
    return function disabledHandler(...args) {
      sendDisabled(args.find((a) => a && typeof a.writeHead === 'function'));
      return Promise.resolve(false);
    };
  }
  if (/^(normalize|extract)/.test(name)) return () => '';
  if (/(Has|has|Looks|looks)[A-Z]|^is[A-Z]/.test(name)) return () => false;
  if (/^(get|resolve|read)/.test(name)) return () => ({ ok: false, loggedIn: false, disabled: true });
  if (/(Ms|Ttl)$/.test(name)) return () => 0;
  if (/Referer$/.test(name)) return () => '';
  // 其余（清缓存、类）：既能直接调用也能 new。new 出来的对象可以放着，调用它的方法才报"未接入"
  return function disabledNoop() {
    if (new.target) {
      return new Proxy({}, {
        get: (_, key) => (key === 'then' ? undefined : () => Promise.reject(new Error(DISABLED_MESSAGE))),
      });
    }
    return null;
  };
}

module.exports = function disabledProvider() {
  const cache = new Map();
  return new Proxy({}, {
    get(_, name) {
      if (typeof name !== 'string') return undefined;
      if (!cache.has(name)) cache.set(name, makeStub(name));
      return cache.get(name);
    },
  });
};
module.exports.DISABLED_MESSAGE = DISABLED_MESSAGE;
