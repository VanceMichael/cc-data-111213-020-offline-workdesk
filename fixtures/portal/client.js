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

if('serviceWorker' in navigator){await navigator.serviceWorker.register('/service-worker.js');await navigator.serviceWorker.ready;}
let local=JSON.parse(localStorage.getItem('inspection')||'null');
if(!local){const remote=await api('/api/inspection');local={value:remote.value,baseVersion:remote.version,status:'remote'};}
function render(){query('#inspection').value=local.value;query('#local-status').textContent=`本机：${local.status}`;query('#remote-status').textContent=`基底版本：${local.baseVersion}`;localStorage.setItem('inspection',JSON.stringify(local));}
query('#save').onclick=()=>{local.value=query('#inspection').value;local.status='local-only';render();notice('已保存在本机');};
query('#sync').onclick=async()=>{local.status='syncing';render();try{const response=await fetch('/api/sync',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(local)});const result=await response.json();local.status=result.status;if(result.status==='accepted'){local.baseVersion=result.remote.version;local.receipt=result.remote.receipt;}query('#proof').textContent=JSON.stringify(result);}catch{local.status='local-only';notice('未连接管理端');}render();};
query('#receipt').onclick=async()=>{query('#proof').textContent=JSON.stringify(await api('/api/inspection'));};
render();notice('工作台已打开');
