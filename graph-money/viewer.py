# -*- coding: utf-8 -*-
"""
Экран просмотра: один HTML-файл, работает офлайн (vis-network встроен в файл).

Что умеет: поиск по gid, окружение узла на 1–2 шага, топ-50 со связями, вся сеть,
раскраска по ролям / кластерам / коленам, карточка узла по клику, запрос
«кто общий получатель / плательщик у этих узлов».
"""
import json
from pathlib import Path

import pandas as pd

ASSET = Path(__file__).resolve().parent / "assets" / "vis-network.min.js"
ROLE_COLORS = {"coordinator": "#c0392b", "consolidator": "#e67e22", "distributor": "#8e44ad",
               "transit": "#2471a3", "terminal": "#1e8449", "peripheral": "#aab2bd"}


def _payload(R, n_cp=5):
    N, e, top, cl = R["N"], R["e"], R["top"], R["clusters"]
    rank = dict(zip(top.gid.astype("int64"), top["rank"]))
    inc = {g: d.nlargest(n_cp, "sum_kzt") for g, d in e.groupby("dst")}
    out = {g: d.nlargest(n_cp, "sum_kzt") for g, d in e.groupby("src")}
    nodes = []
    for g, r in N.iterrows():
        g = int(g)
        nodes.append(dict(
            id=str(g), role=r.role, rs=round(float(r.role_score), 3), pr=round(float(r.priority_score), 4),
            cl=int(r.cluster_id), dp=int(r.depth), sd=bool(r.is_seed), tr=bool(r.flag_truncated),
            ind=int(r.in_deg), outd=int(r.out_deg), ins=round(float(r.in_sum)), outs=round(float(r.out_sum)),
            ss=round(float(r.seed_share), 3), tier=r.tier, weak=bool(r.weak_seed_link),
            stab=None if pd.isna(r.role_stability) else round(float(r.role_stability), 2),
            rk=int(rank[g]) if g in rank else None, ev=r.evidence,
            ci=[[str(int(s)), round(float(v))] for s, v in zip(inc[g].src, inc[g].sum_kzt)] if g in inc else [],
            co=[[str(int(d)), round(float(v))] for d, v in zip(out[g].dst, out[g].sum_kzt)] if g in out else [],
        ))
    edges = [[str(int(s)), str(int(d)), round(float(w)), int(k)]
             for s, d, w, k in e[["src", "dst", "sum_kzt", "n_tx"]].itertuples(index=False)]
    clusters = {} if cl is None else {str(int(c)): dict(h=h, n=int(n), s=int(s), t=t)
                                      for c, h, n, s, t in zip(cl.cluster_id, cl.hypothesis, cl.n_nodes,
                                                               cl.n_seed, cl.cluster_type)}
    meta = dict(period=R["meta"]["period"], n=len(N), top=[str(int(x)) for x in top.gid],
                maxsum=float(e.sum_kzt.max()) if len(e) else 1.0)
    return dict(nodes=nodes, edges=edges, clusters=clusters, meta=meta, colors=ROLE_COLORS)


def build(R, path):
    if not ASSET.exists():
        raise FileNotFoundError(f"Нет {ASSET} — файл vis-network должен лежать в assets/")
    data = json.dumps(_payload(R), ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    vis = ASSET.read_text(encoding="utf-8").replace("</script", "<\\/script")
    html = TEMPLATE.replace("/*__VIS__*/", vis).replace("/*__DATA__*/", data)
    Path(path).write_text(html, encoding="utf-8")
    return path


TEMPLATE = r"""<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Граф денег</title>
<style>
:root{--bg:#f6f7f9;--panel:#fff;--ink:#1f2328;--muted:#5d6670;--line:#dfe3e8;--acc:#2f6fdb}
*{box-sizing:border-box}html,body{margin:0;height:100%;font:14px/1.45 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:var(--ink);background:var(--bg)}
#app{display:grid;grid-template-columns:360px 1fr;height:100vh}
#side{background:var(--panel);border-right:1px solid var(--line);overflow:auto;padding:14px 16px}
#net{position:relative}#graph{position:absolute;inset:0}
h1{font-size:17px;margin:0 0 2px}h2{font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);margin:18px 0 6px}
.sub{color:var(--muted);font-size:12px}
input,select,textarea,button{font:inherit}
input[type=text],textarea,select{width:100%;padding:7px 9px;border:1px solid var(--line);border-radius:6px;background:#fff}
textarea{height:64px;resize:vertical}
.row{display:flex;gap:6px;margin-top:6px;flex-wrap:wrap}
button{padding:6px 10px;border:1px solid var(--line);border-radius:6px;background:#fff;cursor:pointer}
button:hover{border-color:var(--acc)}button.pri{background:var(--acc);border-color:var(--acc);color:#fff}
.legend span{display:inline-flex;align-items:center;margin:2px 10px 2px 0;font-size:12px}
.dot{width:10px;height:10px;border-radius:50%;display:inline-block;margin-right:5px}
#card{border:1px solid var(--line);border-radius:8px;padding:10px 12px;margin-top:6px;background:#fbfcfd}
#card .k{color:var(--muted)}#card b{font-weight:600}
.gid{color:var(--acc);cursor:pointer;text-decoration:underline dotted}
.list div{padding:3px 0;border-bottom:1px dashed var(--line);font-size:13px}
.warn{color:#9a5b00}
#status{position:absolute;left:12px;top:10px;background:rgba(255,255,255,.92);border:1px solid var(--line);border-radius:6px;padding:4px 8px;font-size:12px;z-index:5}
.vis-tooltip{position:absolute;visibility:hidden;padding:6px 8px;white-space:pre-wrap;max-width:420px;font-size:12px;background:#fff;border:1px solid #ccc;border-radius:4px;box-shadow:0 2px 6px rgba(0,0,0,.15);pointer-events:none;z-index:10}
@media (max-width:800px){#app{grid-template-columns:1fr;grid-template-rows:auto 70vh}}
</style></head><body>
<div id="app">
<div id="side">
  <h1>Граф денег</h1><div class="sub" id="meta"></div>
  <h2>Поиск по gid</h2>
  <input type="text" id="q" list="gids" placeholder="введите gid и Enter">
  <datalist id="gids"></datalist>
  <div class="row"><button class="pri" id="bEgo1">Окружение 1 шаг</button><button id="bEgo2">2 шага</button></div>
  <h2>Вид</h2>
  <div class="row"><button id="bTop">Топ-50 и связи</button><button id="bAll">Вся сеть</button></div>
  <div class="row"><select id="color"><option value="role">Цвет: роль</option><option value="cl">Цвет: кластер</option><option value="dp">Цвет: колено</option></select></div>
  <div class="legend" id="legend"></div>
  <div class="sub">★ seed · размер = приоритет · стрелка = направление денег · толщина = сумма · светлые = обрыв выгрузки</div>
  <h2>Карточка узла</h2><div id="card" class="sub">Кликните по узлу или найдите gid.</div>
  <h2>Запрос по графу</h2>
  <div class="sub">Кто общий получатель (или плательщик) у этих узлов — до 3 шагов.</div>
  <textarea id="qq" placeholder="несколько gid через пробел или запятую"></textarea>
  <div class="row"><button id="bDown">Кто получает от них</button><button id="bUp">Кто им платит</button></div>
  <div id="qres" class="list"></div>
  <h2>Топ-50</h2><div id="toplist" class="list"></div>
</div>
<div id="net"><div id="status"></div><div id="graph"></div></div>
</div>
<script>/*__VIS__*/</script>
<script>
const D=/*__DATA__*/;
const RU={coordinator:"координатор",consolidator:"консолидатор",distributor:"распределитель",transit:"транзит",terminal:"конечный получатель",peripheral:"периферия"};
const byId=new Map(D.nodes.map(n=>[n.id,n]));
const OUT=new Map(),IN=new Map();
for(const n of D.nodes){OUT.set(n.id,[]);IN.set(n.id,[])}
D.edges.forEach((e,i)=>{OUT.get(e[0]).push(i);IN.get(e[1]).push(i)});
const $=id=>document.getElementById(id);
const money=x=>x>=1e6?(x/1e6).toFixed(1)+" млн":x>=1e3?Math.round(x/1e3)+" тыс":String(Math.round(x));
const esc=s=>String(s).replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
function hue(i){return `hsl(${(i*137.5)%360},62%,${i%2?45:58}%)`}
const DEPTHC=["#c0392b","#e67e22","#27ae60","#2471a3","#7d3c98","#555"];
function colorOf(n){
  const m=$("color").value;
  if(m==="cl")return n.cl===0?"#cfd4da":hue(n.cl);
  if(m==="dp")return DEPTHC[Math.min(n.dp,5)];
  if(n.tr&&n.role==="peripheral")return "#e4e7eb";
  return D.colors[n.role];
}
function legend(){
  const m=$("color").value;let h="";
  if(m==="role")for(const k in D.colors)h+=`<span><i class="dot" style="background:${D.colors[k]}"></i>${RU[k]}</span>`;
  else if(m==="dp")DEPTHC.slice(0,5).forEach((c,i)=>h+=`<span><i class="dot" style="background:${c}"></i>колено ${i}${i?"":" (seed)"}</span>`);
  else h='<span>цвет = номер кластера (серые — кластер 0: нет переводов)</span>';
  $("legend").innerHTML=h;
}
let labelAll=false,current=[],focus=null;
function visNode(n){
  const lab=labelAll||n.sd||n.rk||n.id===focus;
  return {id:n.id,label:lab?n.id:"",shape:n.sd?"star":"dot",size:7+26*n.pr,
    color:{background:colorOf(n),border:n.id===focus?"#000":"#fff",highlight:{background:colorOf(n),border:"#000"}},
    borderWidth:n.id===focus?3:1,font:{size:11},
    title:`gid ${n.id}${n.sd?"  [SEED]":""}\nроль: ${RU[n.role]} (уверенность ${n.rs})\nприоритет: ${n.pr}${n.rk?" (место "+n.rk+")":""} | кластер ${n.cl} | колено ${n.dp}\nполучил ${money(n.ins)} от ${n.ind}, отправил ${money(n.outs)} на ${n.outd}\n${n.ev}`};
}
const nodesDS=new vis.DataSet(),edgesDS=new vis.DataSet();
const net=new vis.Network($("graph"),{nodes:nodesDS,edges:edgesDS},{
  physics:{solver:"forceAtlas2Based",forceAtlas2Based:{gravitationalConstant:-45,springLength:90},stabilization:{iterations:250}},
  edges:{smooth:false,arrows:{to:{enabled:true,scaleFactor:.45}},color:{color:"#9aa3ad",highlight:"#2f6fdb"}},
  interaction:{hover:true,tooltipDelay:120},layout:{improvedLayout:false}});
net.on("stabilizationIterationsDone",()=>{net.setOptions({physics:false});status()});
function status(extra){$("status").textContent=`узлов на схеме: ${nodesDS.length}, связей: ${edgesDS.length}`+(extra?" · "+extra:"")}
function show(ids,opts={}){
  const set=new Set(ids);current=[...set];labelAll=!!opts.labels;
  nodesDS.clear();edgesDS.clear();
  nodesDS.add(current.map(id=>visNode(byId.get(id))));
  const es=[];
  for(const id of current)for(const i of OUT.get(id)){const e=D.edges[i];if(set.has(e[1]))
    es.push({id:i,from:e[0],to:e[1],width:.6+5*Math.log1p(e[2])/Math.log1p(D.meta.maxsum),title:`${e[0]} → ${e[1]}\n${money(e[2])} KZT, переводов: ${e[3]}`})}
  edgesDS.add(es);
  net.setOptions({physics:{enabled:true}});net.stabilize(current.length>800?120:250);
  status(opts.note);
}
function neighbors(id){const s=new Set();for(const i of OUT.get(id))s.add(D.edges[i][1]);for(const i of IN.get(id))s.add(D.edges[i][0]);return s}
function ego(id,r){
  if(!byId.has(id)){alert("gid "+id+" нет в данных");return}
  focus=id;let layer=new Set([id]),all=new Set([id]);
  for(let k=0;k<r;k++){const nx=new Set();for(const x of layer)for(const y of neighbors(x))if(!all.has(y)){nx.add(y);all.add(y)}layer=nx}
  show([...all],{labels:all.size<=120,note:`окружение ${id} на ${r} шаг(а)`});
  card(id);setTimeout(()=>{net.selectNodes([id]);net.focus(id,{scale:1.1,animation:true})},400);
}
function topView(){
  focus=null;const s=new Set(D.meta.top);
  for(const n of D.nodes)if(n.sd)s.add(n.id);
  for(const id of D.meta.top)for(const y of neighbors(id)){const n=byId.get(y);if(n.role!=="peripheral"||n.sd)s.add(y)}
  show([...s],{note:"топ-50, seed и их значимые соседи"});
}
function gidLink(id){return `<span class="gid" data-g="${id}">${id}</span>`}
function card(id){
  const n=byId.get(id);if(!n)return;
  const c=D.clusters[String(n.cl)]||{};
  const cp=(arr)=>arr.length?arr.map(([g,s])=>`${gidLink(g)} — ${money(s)} (${RU[byId.get(g).role]}${byId.get(g).sd?", seed":""})`).join("<br>"):"—";
  const w=[];
  if(n.tr)w.push("исходящие не выгружены — запросить следующее колено");
  if(n.weak&&n.role!=="peripheral")w.push("связь с seed-деньгами слабая — возможна легальная активность");
  $("card").className="";
  $("card").innerHTML=`<b>${n.id}</b>${n.sd?" · <b>SEED</b>":""}<br>
  <span class="k">роль:</span> <b>${RU[n.role]}</b> · уверенность ${n.rs} · уровень ${n.tier}${n.stab!==null?" · устойчива в "+Math.round(n.stab*100)+"% порогов":""}<br>
  <span class="k">приоритет:</span> ${n.pr}${n.rk?" (место "+n.rk+")":""} · <span class="k">колено</span> ${n.dp} · <span class="k">кластер</span> ${n.cl}<br>
  <span class="k">получил</span> ${money(n.ins)} от ${n.ind} · <span class="k">отправил</span> ${money(n.outs)} на ${n.outd} · seed-денег ~${Math.round(n.ss*100)}%<br>
  <span class="k">почему:</span> ${esc(n.ev)}<br>
  <span class="k">крупнейшие плательщики:</span><br>${cp(n.ci)}<br>
  <span class="k">крупнейшие получатели:</span><br>${cp(n.co)}<br>
  <span class="k">кластер ${n.cl}:</span> ${esc(c.h||"")}
  ${w.length?`<div class="warn">⚠ ${w.join("; ")}</div>`:""}`;
}
function query(dir){
  const ids=[...new Set($("qq").value.split(/[\s,;]+/).filter(Boolean))];
  const bad=ids.filter(x=>!byId.has(x));
  if(bad.length){$("qres").innerHTML=`<div class="warn">нет в данных: ${bad.join(", ")}</div>`;return}
  if(ids.length<2){$("qres").innerHTML='<div class="warn">нужно минимум 2 gid</div>';return}
  const reach=new Map(),parents=[];
  ids.forEach((src,si)=>{
    const par=new Map([[src,null]]);let layer=[src];
    for(let k=0;k<3;k++){const nx=[];for(const x of layer){
      const lst=dir==="down"?OUT.get(x).map(i=>D.edges[i][1]):IN.get(x).map(i=>D.edges[i][0]);
      for(const y of lst)if(!par.has(y)){par.set(y,x);nx.push(y)}}layer=nx}
    parents.push(par);
    for(const y of par.keys())if(y!==src){if(!reach.has(y))reach.set(y,new Set());reach.get(y).add(si)}
  });
  const res=[...reach.entries()].filter(([y,s])=>s.size>=2&&!ids.includes(y))
    .sort((a,b)=>b[1].size-a[1].size||byId.get(b[0]).pr-byId.get(a[0]).pr).slice(0,15);
  if(!res.length){$("qres").innerHTML='<div>общих узлов в пределах 3 шагов нет</div>';return}
  const word=dir==="down"?"получает от":"платит";
  $("qres").innerHTML=res.map(([y,s])=>`<div>${gidLink(y)} — ${word} ${s.size} из ${ids.length} (${RU[byId.get(y).role]}, приоритет ${byId.get(y).pr})</div>`).join("");
  const keep=new Set(ids);
  for(const [y,s] of res)for(const si of s){let x=y;while(x!==null&&x!==undefined){keep.add(x);x=parents[si].get(x)}}
  focus=null;show([...keep],{labels:true,note:"пути до общих узлов"});
}
document.addEventListener("click",ev=>{const g=ev.target.dataset&&ev.target.dataset.g;if(g){$("q").value=g;ego(g,1)}});
net.on("click",p=>{if(p.nodes.length)card(p.nodes[0])});
net.on("doubleClick",p=>{if(p.nodes.length){$("q").value=p.nodes[0];ego(p.nodes[0],1)}});
$("q").addEventListener("keydown",e=>{if(e.key==="Enter")ego($("q").value.trim(),1)});
$("bEgo1").onclick=()=>ego($("q").value.trim(),1);$("bEgo2").onclick=()=>ego($("q").value.trim(),2);
$("bTop").onclick=topView;$("bAll").onclick=()=>{focus=null;show(D.nodes.map(n=>n.id),{note:"вся сеть"})};
$("color").onchange=()=>{legend();nodesDS.update(current.map(id=>visNode(byId.get(id))))};
$("bDown").onclick=()=>query("down");$("bUp").onclick=()=>query("up");
$("meta").textContent=`Период: ${D.meta.period} · узлов: ${D.meta.n} · двойной клик по узлу — окружение`;
$("gids").innerHTML=D.nodes.map(n=>`<option value="${n.id}">`).join("");
$("toplist").innerHTML=D.meta.top.map((id,i)=>{const n=byId.get(id);return `<div>${i+1}. ${gidLink(id)} — ${RU[n.role]}, ${n.pr}</div>`}).join("");
legend();topView();
</script></body></html>
"""
