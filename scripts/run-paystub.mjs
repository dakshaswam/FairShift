import fs from 'node:fs'
import { spawn } from 'node:child_process'
const executable = process.platform === 'win32' ? '.venv/Scripts/python.exe' : '.venv/bin/python'
if (!fs.existsSync(executable)) {
  console.error('Create the Python .venv and install requirements.txt first; see README.')
  process.exit(1)
}
const child = spawn(executable, ['-m', 'fairshift_paystub.web'], { stdio: 'inherit', windowsHide: true })
child.on('error', () => { console.error('Could not start the local paystub service.'); process.exitCode = 1 })
child.on('exit', code => { process.exitCode = code ?? 1 })
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal))
