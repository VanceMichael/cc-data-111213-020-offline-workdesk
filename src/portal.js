import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID, createHash } from 'node:crypto';

export async function startPortal(options = {}) {
  const state = JSON.parse(await readFile('fixtures/state.json', 'utf8'));
  const sessions = new Map();
  const audit = [];
  const json = (response, value, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' });
    response.end(JSON.stringify(value));
  };
  const server = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://localhost');
      const buffers = [];
      for await (const part of request) buffers.push(part);
      const raw = Buffer.concat(buffers);
      const body = raw.length ? JSON.parse(raw) : {};
      const token = /session=([^;]+)/.exec(request.headers.cookie || '')?.[1];
      const identity = sessions.get(token);
      if (request.method === 'POST' && url.pathname === '/api/control') {
        Object.assign(state, body);
        return json(response, { ok: true });
      }
      if (url.pathname === '/api/state') return json(response, { ...state, identity, audit });
      if (url.pathname === '/api/inspection') return json(response, state.inspection);
      if (url.pathname === '/api/sync' && request.method === 'POST') {
        if (body.baseVersion !== state.inspection.version) return json(response, { status: 'conflict', remote: state.inspection }, 409);
        if (!body.value?.trim()) return json(response, { status: 'rejected', reason: '巡检内容为空' }, 422);
        state.inspection = { version: state.inspection.version + 1, value: body.value, receipt: randomUUID() };
        audit.push({ action: 'sync', receipt: state.inspection.receipt, version: state.inspection.version });
        return json(response, { status: 'accepted', remote: state.inspection });
      }
      const allowed = { '/': ['portal.html','text/html; charset=utf-8'], '/client.js': ['client.js','text/javascript'],
        '/service-worker.js': ['service-worker.js','text/javascript'] };
      if (allowed[url.pathname]) {
        const [name,type] = allowed[url.pathname];
        response.setHeader('content-type',type); response.setHeader('cache-control','no-cache');
        return response.end(await readFile(`fixtures/portal/${name}`));
      }
      json(response, { error: '没有这个入口' }, 404);
    } catch (error) { json(response, { error: error.message }, 500); }
  });
  await new Promise(resolve => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, state,
    close: () => new Promise(resolve => server.close(resolve)) };
}

if (process.argv[1]?.endsWith('/portal.js')) {
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效');
  const portal = await startPortal({ port });
  console.log(`本地门户：${portal.url}`);
}
