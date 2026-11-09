#!/usr/bin/env node
// 跨平台采集入口。代理环境变量必须在Node启动前生效（NODE_USE_ENV_PROXY仅启动时读取），故设置后重启子进程执行。
import { spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

process.env.NODE_USE_ENV_PROXY = '1';
process.env.NO_PROXY = [process.env.NO_PROXY, process.env.no_proxy, 'localhost,127.0.0.1,::1'].filter(Boolean).join(',');
process.env.no_proxy = process.env.NO_PROXY;
const child = spawn(process.execPath, [join(dirname(fileURLToPath(import.meta.url)), '..', 'collector', 'run.ts'), ...process.argv.slice(2)], { stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
