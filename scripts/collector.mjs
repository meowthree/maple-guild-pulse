/*
 * Collector adapter.
 *
 * The UI is complete, but the exact undocumented data endpoint used by
 * mapleidle.gg is intentionally not guessed. Start by replacing extractScores()
 * with the live profile/ranking extraction confirmed for your world/server.
 */
import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const members = JSON.parse(await fs.readFile('data/members.json','utf8'));
const history = JSON.parse(await fs.readFile('data/history.json','utf8'));
const date = new Date().toISOString().slice(0,10);

async function extractScores(page, member){
  // Character profile URL shape used by the public site is commonly represented
  // as /characters/<world>/<name>. Verify the live route for your selected world.
  const url = `https://mapleidle.gg/characters/${encodeURIComponent(members.world)}/${encodeURIComponent(member.name)}`;
  await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
  const text = await page.locator('body').innerText();
  // Return nulls until the exact field labels / embedded JSON are confirmed.
  // This prevents silently recording incorrect numbers.
  return {conquest:null, war:null, source:url, sample:text.slice(0,500)};
}

const browser = await chromium.launch({headless:true});
const page = await browser.newPage();
const conquest = {}, war = {};
for (const member of members.members){
  try{
    const r=await extractScores(page,member);
    if (Number.isFinite(r.conquest)) conquest[member.name]=r.conquest;
    if (Number.isFinite(r.war)) war[member.name]=r.war;
  }catch(e){ console.log(`skip ${member.name}: ${e.message}`); }
}
await browser.close();

const existing = history.snapshots.find(s=>s.date===date);
const snapshot = {date,label:new Date().toLocaleDateString('en-SG',{weekday:'short',day:'2-digit',month:'short'}),conquest,war};
if(existing) Object.assign(existing,snapshot); else history.snapshots.push(snapshot);
await fs.writeFile('data/history.json',JSON.stringify(history,null,2)+'\n');
console.log(`Wrote ${date}: ${Object.keys(conquest).length} conquest, ${Object.keys(war).length} war`);
