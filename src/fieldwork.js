import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { startPortal } from './portal.js';

export const CATEGORY_LABEL = {
  'needs-manual': '需人工处理',
  'confirmed': '管理端确认',
  'syncing': '正在同步',
  'local-only': '只在这台浏览器',
  'unchanged': '与管理端一致',
};

// 现场要填的五项巡检；note 留空用于触发管理端拒收
const EDITS = {
  pressure: '压力正常（甲）',
  temperature: '温度 36.5',
  note: '',
  photos: '照片已拍',
  valve: '阀门已紧固',
};

async function control(portal, body) {
  const response = await fetch(`${portal.url}/api/control`, { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) throw new Error(`控制端操作失败：${response.status}`);
  return response.json();
}

async function selectItem(page, id) {
  const tab = page.locator(`#items button[data-item="${id}"]`);
  if (await tab.isDisabled()) return; // 已是当前项
  await tab.click();
  await page.waitForFunction(id => document.querySelector(`#items button[data-item="${id}"]`).disabled, id);
}

function waitStatus(page, id, status) {
  return page.waitForFunction(([id, status]) =>
    document.querySelector(`#board [data-item="${id}"]`)?.dataset.status === status, [id, status]);
}

// 只读页面公开的状态板（#board），不触碰本机存储与离线队列
function boardOf(page) {
  return page.evaluate(() => [...document.querySelectorAll('#board [data-item]')].map(row => ({
    id: row.dataset.item, title: row.dataset.title, status: row.dataset.status,
    baseVersion: Number(row.dataset.base), receipt: row.dataset.receipt || null,
    note: row.dataset.note || '',
  })));
}

// 只读页面公开的状态转换记录（#events）
function eventsOf(page) {
  return page.evaluate(() => [...document.querySelectorAll('#events [data-item]')].map(row => ({
    item: row.dataset.item, from: row.dataset.from, to: row.dataset.to, text: row.textContent,
  })));
}

const summarize = board => board.map(row => `${row.id}:${row.status}`).join('，');

export function buildReport({ board, remote, audit, generatedAt = new Date().toISOString() }) {
  const items = board.map(row => {
    const server = remote[row.id];
    const entry = { id: row.id, title: row.title, localStatus: row.status,
      baseVersion: row.baseVersion, remoteVersion: server?.version ?? null,
      receipt: row.receipt, verified: false, category: 'needs-manual', detail: '' };
    switch (row.status) {
      case 'accepted': {
        const ok = Boolean(row.receipt && server?.receipt === row.receipt &&
          audit.some(record => record.id === row.id && record.receipt === row.receipt));
        entry.verified = ok;
        entry.category = ok ? 'confirmed' : 'needs-manual';
        entry.detail = ok
          ? `回执 ${row.receipt}（管理端 v${server.version}，台账已核对）`
          : '本机显示已接纳，但管理端没有对应回执，需人工核实';
        break;
      }
      case 'local-only':
        entry.category = 'local-only';
        if (!server) entry.detail = '管理端没有这项巡检，需人工核实';
        else if (server.version !== row.baseVersion)
          entry.detail = `本机改动尚未送达；远端已更新到 v${server.version}，直接同步将冲突`;
        else { entry.verified = true; entry.detail = '本机已保存，尚未送达管理端'; }
        break;
      case 'syncing':
        entry.category = 'syncing';
        entry.verified = Boolean(server) && !server.receipt;
        entry.detail = entry.verified
          ? '已发起同步，等待管理端回应'
          : '本机显示同步中，但管理端已有回执，需人工核实';
        break;
      case 'conflict':
        entry.category = 'needs-manual';
        entry.verified = Boolean(server) && server.version > row.baseVersion;
        entry.detail = entry.verified
          ? `与管理端冲突：本机基底 v${row.baseVersion}，远端已 v${server.version}` +
            `${row.note ? `（${row.note}）` : ''}；本机改动未送达，待人工合并`
          : '本机显示冲突，但管理端版本对不上，需人工核实';
        break;
      case 'rejected':
        entry.category = 'needs-manual';
        entry.verified = Boolean(server) && server.version === row.baseVersion;
        entry.detail = `被管理端拒收：${row.note || '原因不明'}；本机改动未送达`;
        break;
      case 'remote':
        entry.category = 'unchanged';
        entry.verified = Boolean(server) && server.version === row.baseVersion;
        entry.detail = entry.verified ? '与管理端一致，无本机改动' : '本机基底与管理端不一致，需人工核实';
        break;
      default:
        entry.category = 'needs-manual';
        entry.detail = `本机状态 ${row.status} 无法归类，需人工核实`;
    }
    return entry;
  });
  return { generatedAt, items };
}

export function formatReport(report) {
  const order = ['needs-manual', 'confirmed', 'syncing', 'local-only', 'unchanged'];
  const lines = [`巡检同步清单（${report.generatedAt}）`];
  for (const category of order) {
    const rows = report.items.filter(item => item.category === category);
    if (!rows.length) continue;
    lines.push(`【${CATEGORY_LABEL[category]}】`);
    for (const row of rows)
      lines.push(`· ${row.id}（${row.title}）：${row.detail}${row.verified ? '' : '［未通过核对］'}`);
  }
  return lines.join('\n');
}

export async function runFieldwork(options = {}) {
  const portal = options.portal ?? await startPortal();
  const ownPortal = !options.portal;
  const root = options.userDataRoot ?? await mkdtemp(join(tmpdir(), 'fieldwork-'));
  const headless = process.env.HEADED !== '1';
  const count = Object.keys(EDITS).length;
  const timeline = [];
  const record = (actor, event, detail = '') =>
    timeline.push({ at: new Date().toISOString(), actor, event, detail });
  const launch = name => chromium.launchPersistentContext(join(root, name),
    { headless, args: ['--no-sandbox'] });
  let deviceA = null;
  let deviceB = null;
  try {
    // —— 设备甲上线打开工作台，认识各项巡检 ——
    deviceA = await launch('device-a');
    let pageA = await deviceA.newPage();
    await pageA.goto(portal.url);
    await pageA.waitForFunction(() => document.querySelector('#notice').textContent.length > 0);
    await pageA.evaluate(() => navigator.serviceWorker.ready);
    record('甲', '打开工作台', summarize(await boardOf(pageA)));

    // —— 断网：现场填写，只落本机 ——
    await deviceA.setOffline(true);
    for (const [id, value] of Object.entries(EDITS)) {
      await selectItem(pageA, id);
      await pageA.getByRole('textbox', { name: '巡检内容' }).fill(value);
      await pageA.locator('#save').click();
      await waitStatus(pageA, id, 'local-only');
    }
    record('甲', '断网保存', summarize(await boardOf(pageA)));

    // —— 关页重开：整个浏览器关闭，用同一份本机档案回来，仍然断网，页面由缓存提供 ——
    await pageA.close();
    await deviceA.close();
    deviceA = await launch('device-a');
    await deviceA.setOffline(true);
    pageA = await deviceA.newPage();
    await pageA.goto(portal.url, { waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(n => document.querySelectorAll('#board [data-item]').length === n, count);
    let board = await boardOf(pageA);
    if (!board.every(row => row.status === 'local-only')) throw new Error('关页重开后本机状态丢失');
    record('甲', '断网重开', `页面来自本机缓存，${summarize(board)}`);

    // —— 管理端发布新版（缓存代次升级），另一台合成设备改动同一项巡检 ——
    await control(portal, { generation: 2 });
    record('管理端', '发布新版', '缓存代次升级为 workdesk-v2');
    deviceB = await launch('device-b');
    const pageB = await deviceB.newPage();
    await pageB.goto(portal.url);
    await pageB.waitForFunction(() => document.querySelector('#notice').textContent.length > 0);
    await selectItem(pageB, 'pressure');
    await pageB.getByRole('textbox', { name: '巡检内容' }).fill('压力正常（乙）');
    await pageB.locator('#save').click();
    await waitStatus(pageB, 'pressure', 'local-only');
    await pageB.locator('#sync').click();
    await waitStatus(pageB, 'pressure', 'accepted');
    await deviceB.close();
    deviceB = null;
    record('乙', '对端改动', '乙的 pressure 已获管理端接纳，远端升为 v2');

    // —— 甲仍在离线：缓存页面所示基底版本已过时，不能据此销办 ——
    board = await boardOf(pageA);
    const staleBase = board.find(row => row.id === 'pressure')?.baseVersion;
    const actual = (await (await fetch(`${portal.url}/api/state`)).json()).inspections.pressure.version;
    record('甲', '缓存页面', `离线中所示 pressure 基底 v${staleBase}，管理端实际已 v${actual}；联网后以回执核对为准`);

    // —— 甲重新联网：缓存升级生效，本机状态不丢 ——
    await deviceA.setOffline(false);
    await pageA.reload();
    await pageA.waitForFunction(async () => (await caches.keys()).join(',') === 'workdesk-v2');
    board = await boardOf(pageA);
    if (!board.every(row => row.status === 'local-only')) throw new Error('缓存升级后本机状态丢失');
    record('甲', '缓存升级', `旧缓存已清理（当前 workdesk-v2），${summarize(board)}`);

    // —— 联网同步：valve 挂起、pressure 冲突、temperature 接纳、note 拒收、photos 不动 ——
    await control(portal, { hold: 'valve' });
    await selectItem(pageA, 'valve');
    await pageA.locator('#sync').click();
    await waitStatus(pageA, 'valve', 'syncing');
    record('甲', 'valve 同步中', '管理端暂未回应');

    await selectItem(pageA, 'pressure');
    await pageA.locator('#sync').click();
    await waitStatus(pageA, 'pressure', 'conflict');
    record('甲', 'pressure 冲突', '本机基底 v1，远端已被乙更新为 v2');
    // 再次点击：客户端拒绝重试，不会制造第二份
    await pageA.locator('#sync').click();
    await pageA.waitForFunction(() => document.querySelector('#notice').textContent.includes('需人工处理'));

    await selectItem(pageA, 'temperature');
    await pageA.locator('#sync').click();
    await waitStatus(pageA, 'temperature', 'accepted');
    record('甲', 'temperature 接纳', '已拿到管理端回执');

    await selectItem(pageA, 'note');
    await pageA.locator('#sync').click();
    await waitStatus(pageA, 'note', 'rejected');
    record('甲', 'note 拒收', '巡检内容为空');

    // —— 联网核对：页面公开的回执查看入口 + 管理端台账 ——
    await pageA.locator('#receipt').click();
    await pageA.waitForFunction(() => document.querySelector('#proof').textContent.includes('"items"'));
    const remote = JSON.parse(await pageA.locator('#proof').textContent()).items;
    const management = await (await fetch(`${portal.url}/api/state`)).json();
    board = await boardOf(pageA);
    const report = buildReport({ board, remote, audit: management.audit });
    record('值班', '生成清单', report.items.map(item => `${item.id}=${item.category}`).join('，'));

    // —— 放行挂起的 valve，确认真实落地 ——
    await control(portal, { hold: null });
    await waitStatus(pageA, 'valve', 'accepted');
    record('甲', 'valve 落地', '挂起的同步已获管理端回执');

    // —— 升级后的缓存离线可用 ——
    await deviceA.setOffline(true);
    await pageA.reload({ waitUntil: 'domcontentloaded' });
    await pageA.waitForFunction(n => document.querySelectorAll('#board [data-item]').length === n, count);
    record('甲', '升级后离线重开', summarize(await boardOf(pageA)));
    await deviceA.setOffline(false);

    // —— 最终清单：再次经页面回执入口与管理端台账核对 ——
    await pageA.locator('#receipt').click();
    await pageA.waitForFunction(() => document.querySelector('#proof').textContent.includes('"items"'));
    const finalRemote = JSON.parse(await pageA.locator('#proof').textContent()).items;
    const finalManagement = await (await fetch(`${portal.url}/api/state`)).json();
    const finalReport = buildReport({ board: await boardOf(pageA),
      remote: finalRemote, audit: finalManagement.audit });
    record('值班', '最终清单', finalReport.items.map(item => `${item.id}=${item.category}`).join('，'));

    const pageEvents = await eventsOf(pageA);
    return { report, finalReport, timeline, pageEvents, audit: finalManagement.audit };
  } finally {
    if (deviceA) await deviceA.close().catch(() => {});
    if (deviceB) await deviceB.close().catch(() => {});
    if (!options.userDataRoot) await rm(root, { recursive: true, force: true });
    if (ownPortal) await portal.close();
  }
}
