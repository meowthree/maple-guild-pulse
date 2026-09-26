const state={metric:'guild_conquest',history:null,members:[],config:null};
const $=s=>document.querySelector(s);
const escapeHtml=s=>String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const fmt=n=>n==null?'—':new Intl.NumberFormat('en-US',{maximumFractionDigits:0}).format(n);
function pct(prev,cur){return prev>0&&cur!=null?(cur-prev)/prev:null}
function latest(){return [...state.history.snapshots].sort((a,b)=>String(b.week).localeCompare(String(a.week)))[0]}
function previousSnapshot(){const arr=[...state.history.snapshots].sort((a,b)=>String(b.week).localeCompare(String(a.week)));return arr[1]||null}
function buildRows(){
  const snap=latest(); const metric=snap?.scores?.[state.metric]||{}; const priorSnap=previousSnapshot();
  const fromLegacy=Object.keys(metric).length>0?metric:{};
  return state.members.filter(m=>m.enabled!==false).map((m,i)=>{
    const x=fromLegacy[m.name]||{};
    let prev=x.previous??null, cur=x.current??null, note=x.note||'';
    if(cur==null && priorSnap?.scores?.[state.metric]?.[m.name]){
      prev=priorSnap.scores[state.metric][m.name].current??priorSnap.scores[state.metric][m.name].previous??prev;
    }
    const growth=pct(prev,cur); const pass=growth!=null&&growth>=state.config.threshold;
    return {name:m.name,previous:prev,current:cur,growth,note,pass};
  });
}
function render(){
  const rows=buildRows();
  const q=$('#search').value.trim().toLowerCase(); const sort=$('#sort').value;
  const filtered=rows.filter(r=>r.name.toLowerCase().includes(q));
  filtered.sort((a,b)=>sort==='name'?a.name.localeCompare(b.name):sort==='growth'?(b.growth??-999)-(a.growth??-999):sort==='status'?Number(b.pass)-Number(a.pass):(b.current??-1)-(a.current??-1));
  $('#memberRows').innerHTML=filtered.map((r,idx)=>{
    const status=r.current==null?'new':r.pass?'good':'bad';
    const growthText=r.growth==null?'—':`${r.growth>=0?'+':''}${(r.growth*100).toFixed(1)}%`;
    const pulse=r.current==null?'◆ Missing':r.pass?'▲ Improved':'▼ Check';
    return `<tr class="row-${status}"><td>${idx+1}</td><td><span class="member-badge"><span class="maple-leaf">★</span><span class="member-name">${escapeHtml(r.name)}</span></span></td><td class="num score">${fmt(r.previous)}</td><td class="num score">${fmt(r.current)}</td><td class="growth ${status}">${growthText}</td><td class="trend-col"><span class="arrow ${status}">${pulse}</span></td></tr>`;
  }).join('');
  $('#empty').classList.toggle('hidden',filtered.length>0);
  const valid=rows.filter(r=>r.current!=null&&r.previous!=null); const good=valid.filter(r=>r.pass); const attention=valid.filter(r=>!r.pass);
  const biggest=valid.reduce((a,b)=>(b.growth??-Infinity)>(a?.growth??-Infinity)?b:a,null);
  $('#membersCount').textContent=rows.length; $('#improvedCount').textContent=good.length; $('#attentionCount').textContent=attention.length; $('#biggestJump').textContent=biggest?`${biggest.growth>=0?'+':''}${(biggest.growth*100).toFixed(1)}%`:'—'; $('#biggestName').textContent=biggest?.name||'—';
  const snap=latest(); $('#weekLabel').textContent=String(snap?.week||'DEMO').toUpperCase(); $('#lastUpdated').textContent=snap?.capturedAt?new Date(snap.capturedAt).toLocaleString('en-SG',{dateStyle:'medium',timeStyle:'short'}):'No snapshot yet'; $('#sourceStatus').textContent=snap?.source?.startsWith('manual')?'Demo snapshot loaded':'Live scheduled snapshot loaded';
}
async function init(){
  const [members,config,history]=await Promise.all([fetch('data/members.json').then(r=>r.json()),fetch('data/config.json').then(r=>r.json()),fetch('data/history.json').then(r=>r.json())]);
  state.members=members;state.config=config;state.history=history;render();
}
$('#search').addEventListener('input',render); $('#sort').addEventListener('change',render);
$('#metricToggle').addEventListener('click',e=>{const el=e.target.closest('[data-metric]');if(!el)return;state.metric=el.dataset.metric;document.querySelectorAll('[data-metric]').forEach(x=>x.classList.toggle('active',x.dataset.metric===state.metric));render()});
$('#copyReport').addEventListener('click',async()=>{const rows=buildRows();const title=state.metric==='guild_conquest'?'Guild Conquest':'Guild War';const good=rows.filter(r=>r.pass);const attention=rows.filter(r=>r.current!=null&&!r.pass);let txt=`🍁 WEEKLY ${title.toUpperCase()}\n${latest()?.week||''}\n\n✅ ≥5% improvement: ${good.length}\n🔴 Needs attention: ${attention.length}\n\n`;txt+=rows.map(r=>`${r.pass?'✅':r.current==null?'🆕':'🔴'} ${r.name}: ${fmt(r.current)} ${r.growth==null?'':'('+((r.growth*100).toFixed(1))+'%)'}`).join('\n');await navigator.clipboard.writeText(txt);const b=$('#copyReport');const old=b.textContent;b.textContent='Copied ✓';setTimeout(()=>b.textContent=old,1200)});
init().catch(err=>{$('#sourceStatus').textContent='Could not load data';$('#lastUpdated').textContent=err.message});
