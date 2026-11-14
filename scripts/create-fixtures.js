import {writeFile,mkdir} from 'node:fs/promises';
await mkdir('fixtures',{recursive:true});
const inspection=title=>({title,version:1,value:'尚未巡检',receipt:null});
await writeFile('fixtures/state.json',JSON.stringify({generation:1,inspections:{pressure:inspection('压力'),temperature:inspection('温度'),note:inspection('备注'),photos:inspection('照片'),valve:inspection('阀门')}},null,2));
await writeFile('fixtures/portal.json',JSON.stringify({"title": "离线工作台的远端确认采集", "local": true, "roles": ["人工使用者"], "entry": "/", "scenario": "offline-workdesk"},null,2));
await writeFile('fixtures/certificate.txt','合成检测证明：SYN-001\n');
