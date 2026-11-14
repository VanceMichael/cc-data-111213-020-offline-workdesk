import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startPortal} from '../src/portal.js';

test('管理端同步语义：接纳、幂等、冲突、拒收',{timeout:10000},async()=>{
  const portal=await startPortal();
  try{
    const sync=body=>fetch(`${portal.url}/api/sync`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
    let response=await sync({id:'temperature',baseVersion:1,value:'36.5',changeId:'c1'});
    assert.equal((await response.json()).status,'accepted');
    assert.equal(portal.state.inspections.temperature.version,2);
    response=await sync({id:'temperature',baseVersion:1,value:'36.5',changeId:'c1'});
    const duplicate=await response.json();
    assert.equal(duplicate.status,'accepted');
    assert.equal(duplicate.duplicate,true);
    assert.equal(portal.state.inspections.temperature.version,2,'重复提交不得产生第二份');
    response=await sync({id:'temperature',baseVersion:1,value:'37',changeId:'c2'});
    assert.equal(response.status,409);
    assert.equal((await response.json()).status,'conflict');
    response=await sync({id:'note',baseVersion:1,value:'  ',changeId:'c3'});
    assert.equal(response.status,422);
    assert.equal((await response.json()).status,'rejected');
    response=await sync({id:'nope',baseVersion:1,value:'x',changeId:'c4'});
    assert.equal(response.status,404);
    assert.equal(portal.audit.length,1,'只有真实接纳才入台账');
  }finally{await portal.close();}
});

test('本地门户现有人工操作可执行且保持业务边界',{timeout:25000},async()=>{
  const portal=await startPortal();
  const browser=await chromium.launch({headless:true,args:['--no-sandbox']});
  try{const page=await browser.newPage();await page.goto(portal.url);await page.waitForFunction(()=>document.querySelector('#notice').textContent.length>0);

await page.evaluate(()=>navigator.serviceWorker.ready);
await page.reload();await page.waitForSelector('#local-status');
await page.getByRole('textbox',{name:'巡检内容'}).fill('压力正常');
await page.context().setOffline(true);await page.locator('#save').click();
await page.waitForFunction(()=>document.querySelector('#local-status').textContent.includes('local-only'));
assert.equal(portal.state.inspection.version,1);
await page.context().setOffline(false);await page.locator('#sync').click();
await page.waitForFunction(()=>document.querySelector('#local-status').textContent.includes('accepted'));
assert.equal(portal.state.inspection.version,2);
assert.ok(portal.state.inspection.receipt);

  }finally{await browser.close();await portal.close();}
});
