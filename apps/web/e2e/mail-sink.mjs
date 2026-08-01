import { createServer } from 'node:http';
import process from 'node:process';
import { URL } from 'node:url';

const port = 3130;
const messages = [];

function sendJson(response, status, body) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) request.destroy();
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://127.0.0.1:${port}`);

  if (request.method === 'GET' && url.pathname === '/health') {
    sendJson(response, 200, { ok: true });
    return;
  }

  if (request.method === 'POST' && url.pathname === '/emails') {
    try {
      const body = JSON.parse(await readBody(request));
      messages.push({ ...body, receivedAt: new Date().toISOString() });
      sendJson(response, 200, { id: `e2e-email-${messages.length}` });
    } catch {
      sendJson(response, 400, { message: 'Invalid email payload.' });
    }
    return;
  }

  if (request.method === 'GET' && url.pathname === '/messages') {
    const recipient = url.searchParams.get('to')?.toLowerCase();
    sendJson(
      response,
      200,
      recipient
        ? messages.filter((message) =>
            Array.isArray(message.to)
              ? message.to.some((email) => String(email).toLowerCase() === recipient)
              : false,
          )
        : messages,
    );
    return;
  }

  if (request.method === 'POST' && url.pathname === '/messages/reset') {
    messages.length = 0;
    sendJson(response, 204, null);
    return;
  }

  sendJson(response, 404, { message: 'Not found.' });
});

server.listen(port, '127.0.0.1');

function close() {
  server.close(() => process.exit(0));
}

process.once('SIGINT', close);
process.once('SIGTERM', close);
