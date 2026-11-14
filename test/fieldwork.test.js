import test from 'node:test';
import assert from 'node:assert/strict';
import { runFieldwork } from '../src/fieldwork.js';

test('离线巡检全流程：断网、关页重开、缓存升级、对端改动与回执核对', { timeout: 120000 }, async () => {
  const { report, finalReport, timeline, pageEvents, audit } = await runFieldwork();

  // 快照清单：五种真实结果各归其位，且全部通过管理端核对
  const byId = Object.fromEntries(report.items.map(item => [item.id, item]));
  assert.equal(byId.pressure.category, 'needs-manual');
  assert.match(byId.pressure.detail, /冲突/);
  assert.equal(byId.note.category, 'needs-manual');
  assert.match(byId.note.detail, /拒收/);
  assert.equal(byId.temperature.category, 'confirmed');
  assert.equal(byId.temperature.verified, true);
  assert.ok(byId.temperature.receipt, '已接纳项必须带真实回执');
  assert.equal(byId.valve.category, 'syncing');
  assert.equal(byId.photos.category, 'local-only');
  assert.ok(report.items.every(item => item.verified), '清单每行都要与管理端核对一致');

  // 挂起项放行后真实落地，最终清单转为管理端确认
  const finalById = Object.fromEntries(finalReport.items.map(item => [item.id, item]));
  assert.equal(finalById.valve.category, 'confirmed');
  assert.ok(finalById.valve.verified);
  assert.equal(finalById.photos.category, 'local-only', '从未同步的改动仍只在这台浏览器');

  // 没有第二份：每项被接纳的改动在管理端台账中只出现一次
  assert.equal(audit.filter(record => record.id === 'pressure').length, 1, '只有乙的那次接纳');
  assert.equal(audit.filter(record => record.id === 'temperature').length, 1);
  assert.equal(audit.filter(record => record.id === 'valve').length, 1);
  assert.equal(audit.length, 3, '冲突与拒收不得入台账');

  // 页面公开的状态转换记录：冲突只尝试一次，没有无限重试
  const attempts = item => pageEvents.filter(event => event.item === item && event.to === 'syncing');
  assert.equal(attempts('pressure').length, 1);
  assert.equal(attempts('valve').length, 1);
  const temperaturePath = pageEvents.filter(event => event.item === 'temperature').map(event => event.to);
  assert.deepEqual(temperaturePath, ['local-only', 'syncing', 'accepted']);

  // 时间线记录了真实经历的关键环节
  const steps = timeline.map(entry => entry.event).join('\n');
  for (const key of ['打开工作台', '断网保存', '断网重开', '发布新版', '对端改动', '缓存页面', '缓存升级', '生成清单', '最终清单'])
    assert.ok(steps.includes(key), `时间线缺少环节：${key}`);
});
