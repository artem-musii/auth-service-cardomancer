import { spawn } from 'child_process'
import { createServer } from 'net'

const findFreePort = (startPort) =>
  new Promise((resolve) => {
    const server = createServer()
    server.listen(startPort, () => {
      server.close(() => resolve(startPort))
    })
    server.on('error', () => resolve(findFreePort(startPort + 1)))
  })

const port = await findFreePort(parseInt(process.env.PORT || '3001', 10))
console.log(`Starting dev server on port ${port}...`)

const child = spawn('bun', ['run', '--watch', 'src/index.js'], {
  stdio: 'inherit',
  env: { ...process.env, PORT: String(port) },
})

child.on('exit', (code) => process.exit(code ?? 0))
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
