// A child owns exactly one local server. If its launcher disappears (including a
// closed Windows console), the IPC channel closes and this process shuts down.
import { pathToFileURL } from 'node:url'

if (typeof process.send !== 'function' || !process.argv[2]) {
  console.error('This helper must be started by tools/start-vesper.mjs.')
  process.exit(1)
}
process.once('disconnect', () => process.exit(0))
process.once('SIGINT', () => process.exit(0))
process.once('SIGTERM', () => process.exit(0))
try {
  const entry = process.argv[2]
  process.argv = [process.argv[0], entry, ...process.argv.slice(3)]
  await import(pathToFileURL(entry).href)
} catch (error) {
  console.error('服务启动失败：' + (error?.message || String(error)))
  process.exit(1)
}
