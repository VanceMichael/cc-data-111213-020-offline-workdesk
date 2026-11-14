import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

export async function startPortal(options = {}) {
  const state = JSON.parse(await readFile('fixtures/state.json', 'utf8'));
  const firstId = Object.keys(state.inspections)[0];
  // 兼容既有查看入口：state.inspection 始终指向第一项巡检
  Object.defineProperty(state, 'inspection', { get: () => state.inspections[firstId] });
  const sessions = new Map();
  const audit = [];
  // 同步闸门：hold 中的巡检项请求会被挂起，直到放行；用于还原“管理端迟迟不回应”的真实现场
  const gate = { held: new Set(), waiting: [] };
  const release = () => { gate.held.clear(); while (gate.waiting.length) gate.waiting.pop()(); };
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
        const { hold, ...rest } = body;
        Object.assign(state, rest);
        if (hold !== undefined) {
          if (hold) gate.held.add(hold);
          else release();
        }
        return json(response, { ok: true });
      }
      if (url.pathname === '/api/state') return json(response, { ...state, identity, audit });
      if (url.pathname === '/api/inspections') return json(response, { items: state.inspections });
      if (url.pathname === '/api/inspection') {
        const item = state.inspections[url.searchParams.get('id') || firstId];
        return item ? json(response, item) : json(response, { error: '没有这项巡检' }, 404);
      }
      if (request.method === 'POST' && url.pathname === '/api/sync') {
        const item = state.inspections[body.id];
        if (!item) return json(response, { error: '没有这项巡检' }, 404);
        if (gate.held.has(body.id)) await new Promise(resolve => gate.waiting.push(resolve));
        if (item.lastChangeId && item.lastChangeId === body.changeId)
          return json(response, { status: 'accepted', remote: item, duplicate: true });
        if (body.baseVersion !== item.version)
          return json(response, { status: 'conflict', remote: item }, 409);
        if (!body.value?.trim())
          return json(response, { status: 'rejected', reason: '巡检内容为空' }, 422);
        Object.assign(item, { version: item.version + 1, value: body.value,
          receipt: randomUUID(), lastChangeId: body.changeId });
        audit.push({ action: 'sync', id: body.id, receipt: item.receipt, version: item.version });
        return json(response, { status: 'accepted', remote: item });
      }
      if (url.pathname === '/service-worker.js') {
        const source = await readFile('fixtures/portal/service-worker.js', 'utf8');
        response.setHeader('content-type', 'text/javascript');
        response.setHeader('cache-control', 'no-cache');
        return response.end(source.replaceAll('workdesk-v1', `workdesk-v${state.generation ?? 1}`));
      }
      const allowed = { '/': ['portal.html', 'text/html; charset=utf-8'],
        '/client.js': ['client.js', 'text/javascript'] };
      if (allowed[url.pathname]) {
        const [name, type] = allowed[url.pathname];
        response.setHeader('content-type', type);
        response.setHeader('cache-control', 'no-cache');
        return response.end(await readFile(`fixtures/portal/${name}`));
      }
      json(response, { error: '没有这个入口' }, 404);
    } catch (error) { json(response, { error: error.message }, 500); }
  });
  await new Promise(resolve => server.listen(options.port ?? 0, options.host ?? '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}`, state, audit,
    close: () => new Promise(resolve => { release(); server.close(resolve); }) };
}

if (process.argv[1]?.endsWith('/portal.js')) {
  const portIndex = process.argv.indexOf('--port');
  const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('端口无效');
  const portal = await startPortal({ port });
  console.log(`本地门户：${portal.url}`);
}
