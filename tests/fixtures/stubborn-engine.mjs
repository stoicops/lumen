// Owned test fixture: a fake engine that never answers MCP, ignores SIGTERM and stdin EOF, and owns a grandchild.
import { spawn } from 'node:child_process';
process.on('SIGTERM', () => {});
process.stdin.resume();
const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
process.stderr.write(`grandchild ${child.pid}\n`);
setInterval(() => {}, 1000);
