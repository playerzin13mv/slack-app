// Launches the built app in Electron. Extra CLI args are forwarded to Electron.
// ELECTRON_RUN_AS_NODE (set by VS Code and some other tools) would make Electron
// behave like plain Node and crash on startup, so it is removed from the environment.
import electron from 'electron';
import { spawn } from 'node:child_process';

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(electron, ['.', ...process.argv.slice(2)], { stdio: 'inherit', env });
child.on('exit', (code) => process.exit(code ?? 0));
