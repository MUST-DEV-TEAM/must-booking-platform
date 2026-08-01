import { createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

const secret = process.env.WEBHOOK_SECRET;
if (!secret) throw new Error('WEBHOOK_SECRET must be set.');

const port = Number(process.env.PORT ?? 8090);
const deployScript = process.env.DEPLOY_SCRIPT ?? '/deploy/deploy.sh';

function verifySignature(body, header) {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', secret).update(body).digest('hex');
  const provided = header.slice('sha256='.length);
  const expectedBuffer = Buffer.from(expected, 'hex');
  const providedBuffer = Buffer.from(provided, 'hex');
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function runDeploy() {
  console.log(`[deploy-webhook] triggering deploy: ${deployScript}`);
  const child = spawn('bash', [deployScript], { stdio: 'inherit', detached: true });
  child.unref();
  child.on('error', (error) => console.error('[deploy-webhook] failed to start deploy:', error));
}

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200).end('ok');
    return;
  }

  if (request.method !== 'POST' || request.url !== '/webhook') {
    response.writeHead(404).end();
    return;
  }

  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    const body = Buffer.concat(chunks);

    if (!verifySignature(body, request.headers['x-hub-signature-256'])) {
      console.warn('[deploy-webhook] rejected: invalid signature');
      response.writeHead(401).end();
      return;
    }

    const event = request.headers['x-github-event'];
    if (event !== 'workflow_run') {
      response.writeHead(200).end('ignored: not a workflow_run event');
      return;
    }

    let payload;
    try {
      payload = JSON.parse(body.toString('utf8'));
    } catch {
      response.writeHead(400).end('invalid JSON');
      return;
    }

    const run = payload.workflow_run;
    const isDeployable =
      payload.action === 'completed' &&
      run?.name === 'CI' &&
      run?.head_branch === 'main' &&
      run?.conclusion === 'success';

    if (!isDeployable) {
      console.log(
        `[deploy-webhook] ignored: action=${payload.action} name=${run?.name} branch=${run?.head_branch} conclusion=${run?.conclusion}`,
      );
      response.writeHead(200).end('ignored: not a successful main CI run');
      return;
    }

    response.writeHead(202).end('deploy triggered');
    runDeploy();
  });
});

server.listen(port, () => console.log(`[deploy-webhook] listening on :${port}`));
