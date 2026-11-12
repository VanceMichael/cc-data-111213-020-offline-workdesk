import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { startPortal } from './portal.js';
export const sample='fixtures/portal.json';
export async function inspect(filename){return JSON.parse(await readFile(filename,'utf8'));}
export async function livePreview(){
  const portal=await startPortal();
  const browser=await chromium.launch({headless:process.env.HEADED!=='1',args:['--no-sandbox']});
  try{const page=await browser.newPage();await page.goto(portal.url);await page.waitForFunction(()=>document.querySelector('#notice').textContent.length>0);
    return {title:await page.title(),status:await page.locator('#notice').textContent(),origin:portal.url};
  }finally{await browser.close();await portal.close();}
}
