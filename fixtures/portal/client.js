const query = selector => document.querySelector(selector);
async function api(path, value) {
  const response = await fetch(path, value === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || data.status || '操作未接纳');
  return data;
}
function notice(value) { query('#notice').textContent = typeof value === 'string' ? value : JSON.stringify(value); }
window.addEventListener('unhandledrejection', event => { event.preventDefault(); notice(event.reason.message); });

if ('serviceWorker' in navigator) {
  const registration = await navigator.serviceWorker.register('/service-worker.js');
  await navigator.serviceWorker.ready;
  registration.update().catch(() => {});
}

let store = JSON.parse(localStorage.getItem('workdesk') || 'null');
if (!store) {
  const remote = await api('/api/inspections');
  store = { selected: null, items: {}, events: [] };
  for (const [id, item] of Object.entries(remote.items))
    store.items[id] = { title: item.title, value: item.value, baseVersion: item.version,
      status: 'remote', receipt: null, changeId: null, note: '' };
  store.selected = Object.keys(store.items)[0];
}

function persist() { localStorage.setItem('workdesk', JSON.stringify(store)); }
function transition(id, to, detail = '') {
  const item = store.items[id];
  store.events.push({ at: new Date().toISOString(), item: id, from: item.status, to, detail });
  item.status = to;
}
function render() {
  const nav = query('#items');
  nav.innerHTML = '';
  for (const [id, item] of Object.entries(store.items)) {
    const tab = document.createElement('button');
    tab.textContent = item.title;
    tab.dataset.item = id;
    tab.disabled = id === store.selected;
    tab.onclick = () => { store.selected = id; persist(); render(); };
    nav.append(tab);
  }
  const current = store.items[store.selected];
  query('#inspection').value = current.value;
  query('#local-status').textContent = `本机：${current.status}`;
  query('#remote-status').textContent = `基底版本：${current.baseVersion}`;
  const board = query('#board');
  board.innerHTML = '';
  for (const [id, item] of Object.entries(store.items)) {
    const row = document.createElement('div');
    row.dataset.item = id;
    row.dataset.status = item.status;
    row.dataset.base = item.baseVersion;
    row.dataset.receipt = item.receipt || '';
    row.dataset.title = item.title;
    row.dataset.note = item.note || '';
    row.textContent = `${item.title}：${item.status}（基底 v${item.baseVersion}` +
      `${item.receipt ? `，回执 ${item.receipt}` : ''}${item.note ? `，${item.note}` : ''}）`;
    board.append(row);
  }
  const events = query('#events');
  events.innerHTML = '';
  for (const event of store.events) {
    const row = document.createElement('div');
    row.dataset.item = event.item;
    row.dataset.from = event.from;
    row.dataset.to = event.to;
    row.textContent = `${event.at} ${event.item} ${event.from}→${event.to} ${event.detail}`;
    events.append(row);
  }
  persist();
}

query('#save').onclick = () => {
  const item = store.items[store.selected];
  const value = query('#inspection').value;
  if (value === item.value) return notice('没有新的改动');
  item.value = value;
  item.changeId = crypto.randomUUID();
  item.note = '';
  transition(store.selected, 'local-only', '保存到本机');
  render();
  notice('已保存在本机');
};

query('#sync').onclick = async () => {
  const id = store.selected;
  const item = store.items[id];
  if (item.status === 'syncing') return notice('正在同步，请勿重复点击');
  if (item.status === 'accepted') return notice('已有管理端回执，无需重复同步');
  if (item.status === 'conflict' || item.status === 'rejected') return notice('需人工处理，不再自动重试');
  if (item.status !== 'local-only') return notice('没有待同步的本机改动');
  transition(id, 'syncing', '发起同步');
  render();
  try {
    const response = await fetch('/api/sync', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id, baseVersion: item.baseVersion, value: item.value, changeId: item.changeId }) });
    const result = await response.json();
    query('#proof').textContent = JSON.stringify(result);
    if (result.status === 'accepted') {
      item.baseVersion = result.remote.version;
      item.receipt = result.remote.receipt;
      item.note = result.duplicate ? '管理端确认为重复提交，回执不变' : '';
      transition(id, 'accepted', `回执 ${result.remote.receipt}`);
    } else if (result.status === 'conflict') {
      item.note = `对端已改为「${result.remote.value}」`;
      transition(id, 'conflict', item.note);
    } else if (result.status === 'rejected') {
      item.note = result.reason || '管理端拒收';
      transition(id, 'rejected', item.note);
    } else {
      item.note = '管理端回应无法识别';
      transition(id, 'local-only', item.note);
    }
  } catch {
    transition(id, 'local-only', '未连接管理端');
    notice('未连接管理端');
  }
  render();
};

query('#receipt').onclick = async () => {
  query('#proof').textContent = JSON.stringify(await api('/api/inspections'));
};

window.addEventListener('online', () => notice('已联网，可以同步'));
window.addEventListener('offline', () => notice('已断网，改动只保存在本机'));

render();
notice('工作台已打开');
