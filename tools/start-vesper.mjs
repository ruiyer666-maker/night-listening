import fs from 'node:fs'
import path from 'node:path'
import net from 'node:net'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath, pathToFileURL } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHILD_HELPER = path.join(ROOT, 'tools', 'service-child.mjs')
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function portNumber(value, name) {
  if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > 65535) {
    throw new Error(`${name} 必须是 1 到 65535 之间的端口号。`)
  }
  return Number(value)
}

export function resolveConfig(env = process.env, args = [], root = ROOT) {
  const accepted = new Set(['--no-open', '--check', '--api-only', '--help'])
  for (const arg of args) if (!accepted.has(arg)) throw new Error(`未知选项：${arg}（使用 --help 查看用法）`)
  const port = portNumber(env.VESPER_PORT || env.PORT || 5180, 'VESPER_PORT / PORT')
  const apiPort = portNumber(env.VESPER_NETEASE_PORT || (args.includes('--api-only') && env.PORT) || 3000, 'VESPER_NETEASE_PORT')
  let apiUrl
  try { apiUrl = new URL(env.VESPER_NETEASE_API || `http://127.0.0.1:${apiPort}`) } catch {
    throw new Error('VESPER_NETEASE_API 必须是有效的 HTTP(S) 接口地址。')
  }
  if (!/^https?:$/.test(apiUrl.protocol) || apiUrl.username || apiUrl.password || apiUrl.search || apiUrl.hash) {
    throw new Error('VESPER_NETEASE_API 只支持不含账号、查询参数和锚点的 HTTP(S) 地址。')
  }
  const loopbackApi = apiUrl.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(apiUrl.hostname) && apiUrl.pathname === '/'
  // An explicit URL belongs to the user (including local compatible/mock APIs).
  // Start our own API only when no external URL was selected.
  const managedApi = !env.VESPER_NETEASE_API && loopbackApi
  if (loopbackApi) apiUrl.hostname = '127.0.0.1'
  const services = [{
    name: '网易云接口', kind: 'api', cwd: path.join(root, 'netease-api'), entry: 'server.mjs',
    url: apiUrl.href.replace(/\/$/, ''), port: Number(apiUrl.port || (apiUrl.protocol === 'https:' ? 443 : 80)),
    managed: managedApi,
  }]
  if (!args.includes('--api-only')) services.push({
    name: 'Vesper 网页', kind: 'app', cwd: path.join(root, 'app'), entry: 'server.js',
    url: `http://127.0.0.1:${port}`, port, managed: true,
  })
  if (services.length > 1 && loopbackApi && services[0].port === port) {
    throw new Error('Vesper 网页和网易云接口不能使用同一个端口，请修改 VESPER_PORT 或 VESPER_NETEASE_PORT。')
  }
  return { root, env, services, apiUrl: services[0].url, appUrl: `http://127.0.0.1:${port}`, open: !args.includes('--no-open') && !args.includes('--api-only'), check: args.includes('--check'), help: args.includes('--help') }
}

export function missingDependencies(directory) {
  const manifest = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'))
  const req = createRequire(path.join(directory, 'package.json'))
  return Object.keys(manifest.dependencies || {}).filter((name) => {
    try { req.resolve(name); return false } catch { return true }
  })
}

export function findNpmCli(env = process.env) {
  const nodeDir = path.dirname(process.execPath)
  const candidates = [env.npm_execpath, path.join(nodeDir, 'node_modules/npm/bin/npm-cli.js'), path.join(nodeDir, '../node_modules/npm/bin/npm-cli.js')]
  for (const directory of String(env.PATH || env.Path || '').split(path.delimiter).filter(Boolean)) {
    candidates.push(path.join(directory, 'node_modules/npm/bin/npm-cli.js'))
    if (process.platform !== 'win32') {
      try { candidates.push(fs.realpathSync(path.join(directory, 'npm'))) } catch {}
    }
  }
  return candidates.find((file) => file && /npm-cli\.js$/.test(file) && fs.existsSync(file)) || null
}

export function portInUse(port, hostname = '127.0.0.1') {
  return new Promise((resolve) => {
    const socket = net.connect({ host: hostname, port })
    const finish = (value) => { socket.destroy(); resolve(value) }
    socket.setTimeout(700, () => finish(true))
    socket.once('connect', () => finish(true))
    socket.once('error', (err) => finish(err.code !== 'ECONNREFUSED'))
  })
}

export async function serviceReady(service) {
  const endpoint = service.kind === 'api' ? '/vesper/health' : '/api/app/version'
  try {
    const response = await fetch(service.url + endpoint, { signal: AbortSignal.timeout(1000), redirect: 'error' })
    if (!response.ok) return false
    const value = await response.json()
    return service.kind === 'api' ? value.service === 'vesper-netease-api' && value.ready === true : value.name === 'vesper' && value.productName === 'Vesper'
  } catch { return false }
}

async function externalApiReady(service) {
  // Explicitly configured external/compatible providers need not implement our
  // local health route. We only check that their HTTP service responds here.
  try {
    const response = await fetch(service.url + '/', { signal: AbortSignal.timeout(5000), redirect: 'error' })
    await response.body?.cancel()
    return response.status < 500
  } catch { return false }
}

export async function inspectServices(config) {
  const result = []
  for (const service of config.services) {
    if (!service.managed) {
      result.push({ ...service, state: await externalApiReady(service) ? 'external' : 'unreachable', missing: [] })
      continue
    }
    const ready = await serviceReady(service)
    const state = ready ? 'running' : (await portInUse(service.port) ? 'conflict' : 'available')
    result.push({ ...service, state, missing: ready ? [] : missingDependencies(service.cwd) })
  }
  return result
}

export async function startStack(config, options = {}) {
  const log = options.log || console.log
  const owned = []
  let stopping = false
  let resolveStopped
  const stopped = new Promise((resolve) => { resolveStopped = resolve })
  const waitExit = (child) => child.exitCode !== null || child.signalCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve))

  async function stop() {
    if (stopping) return stopped
    stopping = true
    await Promise.all(owned.map(async ({ child }) => {
      if (child.exitCode !== null || child.signalCode !== null) return
      // The IPC disconnect also handles abrupt launcher termination on Windows.
      if (child.connected) child.disconnect()
      else child.kill('SIGTERM')
      await Promise.race([waitExit(child), delay(1500)])
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL')
      await Promise.race([waitExit(child), delay(500)])
    }))
    resolveStopped()
  }

  const onSignal = () => { void stop() }
  process.once('SIGINT', onSignal)
  process.once('SIGTERM', onSignal)
  const detach = () => { process.removeListener('SIGINT', onSignal); process.removeListener('SIGTERM', onSignal) }
  stopped.then(detach)

  function startChild(service, entry, args = [], install = false) {
    if (stopping) throw new Error('启动已取消。')
    const child = spawn(process.execPath, [CHILD_HELPER, entry, ...args], {
      cwd: service.cwd, windowsHide: true,
      env: { ...config.env, HOST: '127.0.0.1', PORT: String(service.port), VESPER_NETEASE_API: config.apiUrl },
      stdio: ['ignore', options.stdio || 'inherit', options.stdio || 'inherit', 'ipc'],
    })
    const record = { child, service, install, failed: null }
    child.once('error', (error) => { record.failed = error })
    owned.push(record)
    child.once('exit', (code, signal) => {
      if (!stopping && !install && record.ready) {
        log(`${service.name} 已退出（${signal || code}），正在停止本次启动的服务。`)
        void stop()
      }
    })
    return record
  }

  async function installDependencies(service) {
    const missing = missingDependencies(service.cwd)
    if (!missing.length) return
    const npm = findNpmCli(config.env)
    if (!npm) throw new Error(`${service.name}缺少依赖 ${missing.join(', ')}，且未找到 npm。请安装带 npm 的 Node.js，再重新启动。`)
    log(`${service.name}首次运行，正在安装依赖（需要网络）…`)
    const command = fs.existsSync(path.join(service.cwd, 'package-lock.json')) ? 'ci' : 'install'
    const record = startChild(service, npm, [command, '--no-fund', '--no-audit'], true)
    const code = await new Promise((resolve, reject) => {
      record.child.once('exit', resolve)
      record.child.once('error', reject)
    })
    if (code !== 0 || missingDependencies(service.cwd).length) throw new Error(`${service.name}依赖安装失败，请检查网络后重新启动。`)
  }

  try {
    const statuses = await inspectServices(config)
    for (const service of statuses) {
      if (service.state === 'conflict') throw new Error(`${service.url} 已被其他程序或旧版服务占用，无法确认是 ${service.name}。请关闭对应窗口，或更换端口；启动器不会结束已有进程。`)
      if (service.state === 'unreachable') throw new Error(`无法连接已配置的网易云接口 ${service.url}。请启动该服务或检查 VESPER_NETEASE_API。`)
    }
    for (const service of statuses) {
      if (stopping) throw new Error('启动已取消。')
      if (service.state === 'running' || service.state === 'external') {
        log(`复用${service.name}：${service.url}（退出时保留）`)
        continue
      }
      await installDependencies(service)
      log(`正在启动${service.name}：${service.url}`)
      const record = startChild(service, path.join(service.cwd, service.entry))
      const deadline = Date.now() + (options.readyTimeoutMs || 60000)
      while (!(await serviceReady(service))) {
        if (stopping) throw new Error('启动已取消。')
        if (record.failed) throw record.failed
        if (record.child.exitCode !== null || record.child.signalCode !== null) throw new Error(`${service.name}启动失败，请查看上面的错误。`)
        if (Date.now() >= deadline) throw new Error(`${service.name}启动超时，请检查端口和服务日志。`)
        await delay(150)
      }
      record.ready = true
    }
    return { stop, stopped, owned: owned.filter((item) => !item.install).map((item) => ({ kind: item.service.kind, pid: item.child.pid })), appUrl: config.appUrl }
  } catch (error) {
    await stop()
    throw error
  }
}

export function openBrowser(url) {
  return new Promise((resolve, reject) => {
    let child
    if (process.platform === 'win32') {
      // URL is our validated loopback address, passed as one literal argument.
      child = spawn('rundll32.exe', ['url.dll,FileProtocolHandler', url], { windowsHide: true, detached: true, stdio: 'ignore' })
    } else {
      child = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { detached: true, stdio: 'ignore' })
    }
    child.once('error', reject)
    child.once('spawn', () => { child.unref(); resolve() })
  })
}

async function main() {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('请使用 Node.js 22 或更新版本。')
  const config = resolveConfig(process.env, process.argv.slice(2))
  if (config.help) {
    console.log('Vesper 新版启动器\n  node tools/start-vesper.mjs [--no-open] [--check] [--api-only]\n  --check    只检查依赖和端口，不安装、不启动服务\n  --no-open  不自动打开浏览器\n  --api-only 仅启动网易云接口\n环境变量：VESPER_PORT（或 PORT）、VESPER_NETEASE_PORT、VESPER_NETEASE_API')
    return
  }
  if (config.check) {
    const statuses = await inspectServices(config)
    for (const service of statuses) console.log(`${service.name}: ${service.url} — ${service.state}${service.missing.length ? '，缺少依赖：' + service.missing.join(', ') : ''}`)
    if (statuses.some((service) => ['conflict', 'unreachable'].includes(service.state) || service.missing.length)) process.exitCode = 1
    return
  }
  const stack = await startStack(config)
  if (config.services.some((service) => service.kind === 'app')) {
    console.log(`\nVesper 已就绪：${config.appUrl}`)
    if (config.open) await openBrowser(config.appUrl).catch(() => console.log('浏览器未自动打开，请手动打开上面的地址。'))
  }
  if (!stack.owned.length) {
    console.log('服务已在其他窗口运行；本窗口可以关闭。')
    await stack.stop()
    return
  }
  console.log('保持本窗口打开；按 Ctrl+C 退出。仅停止本窗口启动的服务。')
  // A parent launcher can keep this runner alive without a visible terminal.
  const keepAlive = setInterval(() => {}, 60000)
  await stack.stopped
  clearInterval(keepAlive)
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => { console.error('\n' + (error?.message || String(error))); process.exitCode = 1 })
}
