import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Archive } from './archive.js';
import { inspect, sample } from './domain.js';

const [command = 'demo', file, directory = '.local/archive'] = process.argv.slice(2);
async function run() {
  if (command === 'inspect') {
    if (!file) throw new Error('需要资料路径');
    console.log(JSON.stringify(await inspect(resolve(file)), null, 2));
  } else if (command === 'capture') {
    if (!file) throw new Error('需要资料路径');
    const inventory = await inspect(resolve(file));
    const receipt = await new Archive(directory).accept(await readFile(file),
      { source: resolve(file), inventory });
    console.log(JSON.stringify(receipt, null, 2));
  } else if (command === 'list') {
    console.log(JSON.stringify(await new Archive(file || directory).receipts(), null, 2));
  } else if (command === 'demo') {
    const temporary = await mkdtemp(join(tmpdir(), 'intake-'));
    try {
      const inventory = await inspect(resolve(sample));
      const archive = new Archive(temporary);
      const receipt = await archive.accept(await readFile(sample), { source: sample, inventory });
      console.log(JSON.stringify({ inventory, receipt, verified: (await archive.read(receipt.sha256)).length }, null, 2));
      const domain = await import('./domain.js');
      console.log(JSON.stringify(await domain.livePreview(), null, 2));
    } finally { await rm(temporary, { recursive: true, force: true }); }
  } else if (command === 'fieldwork') {
    const { runFieldwork, formatReport } = await import('./fieldwork.js');
    const outcome = await runFieldwork();
    console.log('状态转换时间线');
    for (const t of outcome.timeline)
      console.log(`${t.at}【${t.actor}】${t.event}${t.detail ? `：${t.detail}` : ''}`);
    console.log(`\n${formatReport(outcome.report)}`);
    console.log('\n—— 挂起项落地之后 ——\n');
    console.log(formatReport(outcome.finalReport));
  } else { throw new Error('支持 inspect、capture、list、demo、fieldwork'); }
}
run().catch(error => { console.error(error.message); process.exitCode = 1; });
