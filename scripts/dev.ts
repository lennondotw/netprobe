import { spawn } from 'node:child_process'

/** Run the API server (with reload) and the Vite dev server together; Ctrl-C stops both. */
const children = [
  spawn('node', ['--watch', 'src/server/main.ts'], { stdio: 'inherit' }),
  spawn('pnpm', ['exec', 'vite'], { stdio: 'inherit' }),
]

const stop = () => {
  for (const child of children) child.kill('SIGTERM')
}
process.once('SIGINT', stop)
process.once('SIGTERM', stop)
for (const child of children) child.on('exit', stop)
