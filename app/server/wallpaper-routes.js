'use strict';

// 把电脑上 Wallpaper Engine 的壁纸给播放页当背景（只读）。
//
// 原项目是桌面软件，靠 Electron 的自定义协议读壁纸文件；Vesper 是网页，所以改成本机 HTTP 接口：
//   GET /api/vesper/wallpapers                 列出壁纸（标题、类型、能不能直接播放），不返回本机路径
//   GET /api/vesper/wallpapers/media/<id>      视频壁纸文件（支持 Range，可以拖动、循环）
//   GET /api/vesper/wallpapers/preview/<id>    预览图（场景类壁纸网页里跑不了，只能用预览图）
// 扫描、路径校验、文件类型白名单都沿用 wallpaper/wallpaper-engine-library.js（来自原项目）。
// 服务只监听 127.0.0.1，局域网里的其他电脑访问不到。

const path = require('path');
const { Readable } = require('stream');
const { WallpaperEngineLibrary } = require('./wallpaper/wallpaper-engine-library');

function createWallpaperRoutes({ sendJSON }) {
  let library = null;
  function getLibrary() {
    if (!library) {
      library = new WallpaperEngineLibrary({ userDataPath: path.join(__dirname, '..', 'data') });
    }
    return library;
  }

  function publicProject(item) {
    const base = '/api/vesper/wallpapers';
    return {
      id: item.id,
      title: item.title,
      projectType: item.projectType,
      mediaType: item.mediaType,
      playable: item.playable && item.mediaType === 'video',
      hasPreview: item.hasPreview,
      previewAnimated: item.previewAnimated,
      source: item.sourceLabel,
      workshopId: item.workshopId,
      mediaUrl: item.playable ? `${base}/media/${item.id}` : '',
      previewUrl: item.hasPreview ? `${base}/preview/${item.id}` : '',
    };
  }

  async function pipeResponse(response, res) {
    const headers = {};
    response.headers.forEach((value, key) => { headers[key] = value; });
    res.writeHead(response.status, headers);
    if (!response.body) { res.end(); return; }
    Readable.fromWeb(response.body).on('error', () => res.destroy()).pipe(res);
  }

  return async function handleWallpaperRoute(pn, url, req, res) {
    if (pn === '/api/vesper/wallpapers') {
      try {
        const snapshot = await getLibrary().list({ force: url.searchParams.get('refresh') === '1' });
        const projects = snapshot.projects.map(publicProject);
        sendJSON(res, {
          ok: true,
          count: projects.length,
          videoCount: projects.filter((p) => p.playable).length,
          sourceCount: snapshot.sourceCount,
          projects,
        });
      } catch (err) {
        sendJSON(res, { ok: false, projects: [], error: err.message || String(err) }, 500);
      }
      return true;
    }

    const match = /^\/api\/vesper\/wallpapers\/(media|preview)\/([a-f0-9]{24})$/i.exec(pn);
    if (match) {
      const lib = getLibrary();
      try {
        const internal = new Request(`mineradio-wallpaper://${match[1].toLowerCase()}/${match[2].toLowerCase()}?token=${lib.mediaToken}`, {
          method: req.method === 'HEAD' ? 'HEAD' : 'GET',
          headers: req.headers.range ? { range: req.headers.range } : {},
        });
        await pipeResponse(await lib.mediaResponse(internal), res);
      } catch (err) {
        if (!res.headersSent) { res.writeHead(500); res.end(String(err.message || err)); }
      }
      return true;
    }

    sendJSON(res, { error: 'NOT_FOUND' }, 404);
    return true;
  };
}

module.exports = { createWallpaperRoutes };
