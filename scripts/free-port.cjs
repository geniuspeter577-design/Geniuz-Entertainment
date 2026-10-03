const { spawnSync } = require('node:child_process');

const port = Number(process.argv[2]);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  console.error('Provide a valid TCP port number.');
  process.exit(2);
}

function findListeners() {
  const lsof = spawnSync('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN'], {
    encoding: 'utf8',
  });
  if (!lsof.error && (lsof.status === 0 || lsof.status === 1)) {
    return (lsof.stdout ?? '')
      .split(/\s+/)
      .filter((value) => /^\d+$/.test(value))
      .map(Number);
  }
  if (lsof.error?.code !== 'ENOENT') {
    throw new Error('Could not inspect TCP listeners with lsof.');
  }

  const fuser = spawnSync('fuser', ['-n', 'tcp', String(port)], { encoding: 'utf8' });
  if (fuser.error?.code === 'ENOENT') {
    throw new Error('Install lsof or fuser to safely inspect port listeners.');
  }
  if (fuser.status !== 0 && fuser.status !== 1) {
    throw new Error('Could not inspect TCP listeners with fuser.');
  }
  return `${fuser.stdout ?? ''} ${fuser.stderr ?? ''}`
    .split(/\s+/)
    .filter((value) => /^\d+$/.test(value))
    .map(Number);
}

const listeners = [...new Set(findListeners())];
if (listeners.length === 0) {
  console.log(`Port ${port} is already free.`);
  process.exit(0);
}

for (const pid of listeners) {
  try {
    process.kill(pid, 'SIGTERM');
    console.log(`Sent SIGTERM to PID ${pid}, which was listening on port ${port}.`);
  } catch (error) {
    if (error.code !== 'ESRCH') {
      throw error;
    }
  }
}

const deadline = Date.now() + 10_000;
const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

(async () => {
  while (Date.now() < deadline) {
    if (findListeners().length === 0) {
      console.log(`Port ${port} is free.`);
      return;
    }
    await wait(250);
  }
  throw new Error(`A process is still listening on port ${port}; refusing to start another server.`);
})().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
