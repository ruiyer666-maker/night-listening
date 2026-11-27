'use strict';

const { createDemoRoutes } = require('./demo-media');

// Vesper 新加的接口（都在 /api/vesper/ 下面），给黑胶选歌首页、3D 歌单架和壁纸背景用。
// 网易云数据同样经过 netease-bridge 转给项目自带的网易云接口服务。

const secure = (url) => String(url || '').replace(/^http:\/\//, 'https://');

function mapPlaylistCard(p) {
  if (!p || !p.id) return null;
  return {
    id: p.id,
    name: p.name || '',
    cover: secure(p.coverImgUrl || p.picUrl || p.cover || ''),
    trackCount: Number(p.trackCount) || 0,
    playCount: Number(p.playCount) || 0,
    description: p.copywriter || p.updateFrequency || p.description || '',
    creator: (p.creator && p.creator.nickname) || '',
  };
}

function createVesperRoutes({ netease, sendJSON, getCookie, wallpaper }) {
  const handleDemoRoute = createDemoRoutes({ sendJSON });
  const cache = new Map();
  async function cached(key, ttlMs, load) {
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < ttlMs) return hit.value;
    const value = await load();
    cache.set(key, { at: Date.now(), value });
    return value;
  }

  return async function handleVesperRoute(pn, url, req, res) {
    if (!pn.startsWith('/api/vesper/')) return false;
    if (handleDemoRoute(pn, req, res)) return true;

    // 官方排行榜（未登录也能用）：飙升榜、新歌榜、热歌榜、原创榜……
    if (pn === '/api/vesper/charts') {
      try {
        const charts = await cached('charts', 30 * 60 * 1000, async () => {
          const r = await netease.toplist({});
          const list = (r.body && r.body.list) || [];
          return list.slice(0, 12).map(mapPlaylistCard).filter(Boolean);
        });
        sendJSON(res, { charts });
      } catch (err) {
        sendJSON(res, { charts: [], error: err.message || String(err) }, 502);
      }
      return true;
    }

    // 推荐歌单：没登录时是网易云的公共推荐，登录后会按账号推荐
    if (pn === '/api/vesper/playlists') {
      const limit = Math.max(6, Math.min(60, parseInt(url.searchParams.get('limit') || '30', 10) || 30));
      const cookie = getCookie();
      try {
        const playlists = await cached('personalized|' + limit + '|' + (cookie ? 'user' : 'anon'), 10 * 60 * 1000, async () => {
          const r = await netease.personalized({ limit, cookie });
          return ((r.body && r.body.result) || []).map(mapPlaylistCard).filter(Boolean);
        });
        sendJSON(res, { playlists });
      } catch (err) {
        sendJSON(res, { playlists: [], error: err.message || String(err) }, 502);
      }
      return true;
    }

    if (wallpaper && pn.startsWith('/api/vesper/wallpapers')) {
      return wallpaper(pn, url, req, res);
    }

    sendJSON(res, { error: 'NOT_FOUND' }, 404);
    return true;
  };
}

module.exports = { createVesperRoutes, mapPlaylistCard };
