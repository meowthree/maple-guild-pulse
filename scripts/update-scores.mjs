import fs from 'node:fs/promises';
import { chromium } from 'playwright';

const ROOT=new URL('..',import.meta.url).pathname;
const config=JSON.parse(await fs.readFile(`${ROOT}/data/config.json`,'utf8'));
const members=JSON.parse(await fs.readFile(`${ROOT}/data/members.json`,'utf8'));
const history=JSON.parse(await fs.readFile(`${ROOT}/data/history.json`,'utf8'));
const base='https://mapleidle.gg';
const server=config.server;
if(!server || server==='YOUR-SERVER') throw new Error('Set data/config.json server before running the collector.');

function weekKey(){
  const now=new Date(); const parts=new Intl.DateTimeFormat('en-CA',{timeZone:config.timezone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now).reduce((a,p)=>(a[p.type]=p.value,a),{});
  const d=new Date(`${parts.year}-${parts.month}-${parts.day}T12:00:00`); const diff=d.getDay(); d.setDate(d.getDate()-diff); // latest Sunday anchor
  d.setDate(d.getDate()+6); return d.toISOString().slice(0,10);
}
function clean(t){return t.replace(/\s+/g,' ').trim()}
function firstNumber(s){const m=clean(s).match(/([0-9][0-9,]*(?:\.\d+)?\s*(?:[KMBTQqAaEePp])?)/);return m?m[1].replace(/,/g,''):null}
function parseScore(text,labels){
  const t=clean(text);
  for(const label of labels){
    const i=t.toLowerCase().indexOf(label.toLowerCase());
    if(i<0) continue;
    const window=t.slice(i,i+180);
    const n=firstNumber(window.replace(label,'')); if(n)return {raw:n, value:parseCompact(n)};
  }
  return null;
}
function parseCompact(s){
  const m=String(s).trim().match(/^([0-9]+(?:\.\d+)?)\s*([KMBTQAE]?)/i); if(!m)return null;
  const mult={K:1e3,M:1e6,B:1e9,T:1e12,Q:1e15,A:1e18,E:1e18}; return Math.round(Number(m[1])*(mult[m[2].toUpperCase()]||1));
}
const browser=await chromium.launch({headless:true}); const page=await browser.newPage({userAgent:'Mozilla/5.0 MapleGuildPulse/1.0'});
const out={week:weekKey(),capturedAt:new Date().toISOString(),source:'automated mapleidle.gg character pages',scores:{guild_conquest:{},guild_war:{}}};
for(const member of members.filter(x=>x.enabled!==false)){
  const url=`${base}/characters/${encodeURIComponent(server)}/${encodeURIComponent(member.name)}`;
  try{
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(1200);
    const text=await page.locator('body').innerText();
    const conquest=parseScore(text,['Guild Conquest','Conquest']);
    const war=parseScore(text,['Guild War','War']);
    out.scores.guild_conquest[member.name]={current:conquest?.value??null, raw:conquest?.raw??null, url};
    out.scores.guild_war[member.name]={current:war?.value??null, raw:war?.raw??null, url};
    console.log(member.name,conquest?.raw??'-',war?.raw??'-');
  } catch(e){
    out.scores.guild_conquest[member.name]={current:null,note:`fetch failed: ${e.message}`,url};
    out.scores.guild_war[member.name]={current:null,note:`fetch failed: ${e.message}`,url};
    console.log('FAILED',member.name,e.message);
  }
}
await browser.close();
// Convert newest snapshot into previous/current pairs for display.
const previous=[...history.snapshots].sort((a,b)=>String(b.week).localeCompare(String(a.week))).find(x=>x.week!=='demo');
for(const metric of ['guild_conquest','guild_war']){
  for(const member of members){
    const x=out.scores[metric][member.name];
    const p=previous?.scores?.[metric]?.[member.name]?.current ?? previous?.scores?.[metric]?.[member.name]?.previous ?? null;
    x.previous=p;
  }
}
history.snapshots=history.snapshots.filter(x=>x.week!=='demo'); history.snapshots.push(out); history.snapshots.sort((a,b)=>String(a.week).localeCompare(String(b.week)));
await fs.writeFile(`${ROOT}/data/history.json`,JSON.stringify(history,null,2)+'\n');
