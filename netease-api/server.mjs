// Vesper 用的网易云接口服务
//
// 就是开源项目 NeteaseCloudMusicApi（node_modules 里那个），外面包了一层，多做两件事：
//   1. /audio?url=…  音频代理。网易云的音频服务器不一定允许网页跨域读取，
//      而 3D 画面要分析频谱，必须用 fetch 拿到音频数据，所以从这里转一手
//   2. 本机发来的请求统一带上一个国内 IP（接口服务自己对 IPv6 本机请求也是这么做的），
//      在海外也能拿到大部分歌曲的播放地址
//
// 启动：双击上一层的"启动网易云接口.bat"，或在这个文件夹运行 npm start
// 非官方接口，仅供个人学习和课堂演示，不要部署到公网。

import http from 'node:http'
import { once } from 'node:events'
import { Readable } from 'node:stream'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const PORT = Number(process.env.PORT || 3000)
const HOST = '127.0.0.1'

// 和接口服务自带的 app.js 一样：先生成匿名身份和随机国内 IP（global.cnIp）
const tokenFile = path.resolve(os.tmpdir(), 'anonymous_token')
if (!fs.existsSync(tokenFile)) fs.writeFileSync(tokenFile, '', 'utf-8')
// 匿名身份注册需要联网；网络不可用时也应先启动本地服务，方便重试和诊断。
let registrationTimer
await Promise.race([
  require('NeteaseCloudMusicApi/generateConfig')(),
  new Promise((resolve) => {
    registrationTimer = setTimeout(() => {
      console.warn('  匿名身份仍在准备，先启动本地接口；联网请求稍后可重试。')
      resolve()
    }, 5000)
  }),
])
clearTimeout(registrationTimer)
const { serveNcmApi } = require('NeteaseCloudMusicApi/server')

// 让它先在随机端口上建好，再关掉，只拿它的请求处理函数，由下面的服务器统一对外
// 该依赖用 options.port || process.env.PORT；字符串 '0' 才会真正分配随机端口。
const app = await serveNcmApi({ port: '0', host: '127.0.0.1' })
if (!app.server.listening) await once(app.server, 'listening')
await new Promise((resolve, reject) => app.server.close((err) => err ? reject(err) : resolve()))

const AUDIO_HOSTS = /(^|\.)(126\.net|127\.net|netease\.com|163\.com)$/i
const isLocal = (addr = '') => /^(::1|127\.|::ffff:127\.)/.test(addr)

async function proxyAudio(req, res) {
  const target = new URL(req.url, 'http://x').searchParams.get('url') || ''
  let url
  try {
    url = new URL(target)
  } catch {
    res.writeHead(400).end('bad url')
    return
  }
  // 只转发网易云自己的音频地址，避免变成谁都能用的代理
  if (!/^https?:$/.test(url.protocol) || !AUDIO_HOSTS.test(url.hostname)) {
    res.writeHead(403).end('host not allowed')
    return
  }
  try {
    const upstream = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://music.163.com/', ...(req.headers.range ? { Range: req.headers.range } : {}) },
    })
    const headers = { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'max-age=3600' }
    for (const k of ['content-type', 'content-length', 'content-range', 'accept-ranges']) {
      const v = upstream.headers.get(k)
      if (v) headers[k] = v
    }
    res.writeHead(upstream.status, headers)
    if (upstream.body) Readable.fromWeb(upstream.body).pipe(res)
    else res.end()
  } catch (e) {
    res.writeHead(502, { 'Access-Control-Allow-Origin': '*' }).end(`upstream failed: ${e.message}`)
  }
}

http
  .createServer((req, res) => {
    if (req.url.split('?')[0] === '/vesper/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
      res.end(JSON.stringify({ service: 'vesper-netease-api', ready: true }))
      return
    }
    if (req.url.startsWith('/audio?')) return proxyAudio(req, res)
    if (isLocal(req.socket.remoteAddress) && !req.headers['x-real-ip']) req.headers['x-forwarded-for'] = global.cnIp
    app(req, res)
  })
  .listen(PORT, HOST, () => {
    console.log('')
    console.log(`  网易云接口服务已启动：http://${HOST}:${PORT}`)
    console.log('  在 Vesper 的设置页选"网易云音乐"，接口地址填上面这个。')
    console.log('  演示期间不要关闭这个窗口。')
    console.log('')
  })
  .on('error', (e) => {
    if (e.code === 'EADDRINUSE') console.error(`\n  端口 ${PORT} 已经被占用：可能接口服务已经开着了，不用再开一次。\n`)
    else console.error(e)
    process.exit(1)
  })
