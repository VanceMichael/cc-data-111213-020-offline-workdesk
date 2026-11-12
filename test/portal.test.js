import test from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {startPortal} from '../src/portal.js';
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
