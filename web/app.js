"use strict";
const $ = id => document.getElementById(id);
const labels = {ALARMA:"Alarma",PRECAUCION:"Precaución",SIN_ALERTA:"Sin alerta",SIN_DATOS:"Sin datos",INCOMPLETO:"Incompleto",FALLO:"Fallo"};
let key = sessionStorage.getItem("canari_operator") || "", busy=false, sound=null, newestEvent=0, lastRows=[], staleWindow=15;
const element=(tag,text,cls)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
const fmt=(x,d=2)=>x===null||x===undefined?"Sin medición":Number(x).toFixed(d);
const date=x=>new Date(x*1000).toLocaleString("es-CO");
let demo = false;
async function api(path, options={}){
 const r=await fetch(path,{...options,headers:{...(demo ? {} : {Authorization:"Bearer "+key}),...options.headers},signal:AbortSignal.timeout(8000)});
 if(!r.ok){let body=await r.json().catch(()=>({}));throw new Error(body.error||"No se pudo consultar el servidor");}
 return r;
}
function badge(level){return element("span",labels[level]||level,"badge "+level);}
function drawNodes(nodes){
 $("nodes").replaceChildren();
 $("total").textContent = nodes.length;
 $("alarm").textContent = nodes.filter(n => n.level === "ALARMA").length;
 $("issues").textContent = nodes.filter(n => ["FALLO","SIN_DATOS","INCOMPLETO"].includes(n.level)).length;
 for(const n of nodes){
  const c=element("article",undefined,"node "+n.level),top=element("div",undefined,"topline");
  top.append(element("span",n.id+" · "+(n.source==="simulation"?"SIMULADO":"LABORATORIO")),badge(n.level));c.append(top,element("h3",n.label));
  const valid=n.latest&&n.level!=="SIN_DATOS"&&n.level!=="FALLO", v=valid?n.latest:{};
  const main=element("div",fmt(v.ch4_vol_pct),"metric-main");main.append(element("small"," % vol CH₄"));c.append(main);
  const metrics=element("div",undefined,"metrics");
  for(const [name,label,unit] of [["o2_vol_pct","OXÍGENO","% vol"],["temperature_c","TEMPERATURA","°C"],["humidity_pct","HUMEDAD","% HR"]]){
   const m=element("div");m.append(element("small",label),element("strong",fmt(v[name],1)),element("small",unit));metrics.append(m);
  }c.append(metrics,element("p",n.reasons.join(". "),"detail"),element("div",`Alarma CH₄ ≥ ${n.ch4_alarm_vol_pct} % vol · Antigüedad: ${n.age_seconds===null?"sin muestra":n.age_seconds+" s"}`,"detail"));const link=element("a","Analizar nodo →"); link.href="#analysis"; link.setAttribute("aria-label","Analizar "+n.label); link.addEventListener("click",()=>{$("node").value=n.id;changeQuery();}); c.append(link); $("nodes").append(c);
 }
 $("counts").textContent=`${nodes.length} nodos · ${nodes.filter(n=>n.level==="ALARMA").length} en alarma`;
}
let recentEvents = [];
function drawEvents(events){
 recentEvents = events;
 $("pending").textContent = events.filter(e => !e.acknowledged_ts).length;
 const activity = $("activity");
 activity.replaceChildren(...events.slice(0, 4).map(e => {
  const row = element("div", undefined, "activity-row");
  row.append(element("time", new Date(e.created_ts*1000).toLocaleTimeString("es-CO")), badge(e.level),
   element("strong", e.node_id), element("span", JSON.parse(e.reasons).join(". ")));
  return row;
 }));
 if (!events.length) activity.textContent = "Sin eventos disponibles.";
 const filter = $("event-filter").value;
 const visible = events.filter(e => filter === "all" || (filter === "pending" ? !e.acknowledged_ts : e.level === filter));
 $("event-count").textContent = visible.length + " de " + events.length + " eventos recientes";
 const tbody=$("events");tbody.replaceChildren();
 for(const e of visible){
  const tr=element("tr"),state=element("td"),action=element("td");state.append(badge(e.level));
  if(e.acknowledged_ts){action.textContent="Leído · "+date(e.acknowledged_ts);}
  else if (demo) {action.textContent="Pendiente";}
  else {const b=element("button","Reconocer","secondary");b.addEventListener("click",async()=>{b.disabled=true;try{await api(`/api/events/${e.id}/ack`,{method:"POST"});await refresh();}catch(err){$("message").textContent=err.message;}finally{b.disabled=false;}});action.append(b);}
  tr.append(element("td",date(e.created_ts)),element("td",e.node_id),state,element("td",JSON.parse(e.reasons).join(". ")),action);tbody.append(tr);
 }
 if(!visible.length){const tr=element("tr"),td=element("td","Sin eventos para este filtro.");td.colSpan=5;tr.append(td);tbody.append(tr);}
 if(sound&&events.some(e=>e.id>newestEvent&&["ALARMA","SIN_DATOS","FALLO"].includes(e.level))){
  const osc=sound.createOscillator(),gain=sound.createGain();osc.connect(gain);gain.connect(sound.destination);osc.frequency.value=700;gain.gain.value=.08;osc.start();osc.stop(sound.currentTime+.22);
 }if(events.length)newestEvent=Math.max(newestEvent,...events.map(e=>e.id));
}
function svg(tag,attrs,text){const e=document.createElementNS("http://www.w3.org/2000/svg",tag);for(const [k,v] of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
function drawChart(){
 const chart=$("chart"),metric=$("metric").value,rows=[...lastRows].sort((a,b)=>a.captured_ts-b.captured_ts);
 chart.replaceChildren();
 const valid=rows.filter(r=>r[metric]!==null&&r.device_status==="ok");
 showSummary(valid, metric);
 if(!valid.length){chart.append(svg("text",{x:35,y:100,fill:"#61717b","font-size":16},"No hay lecturas válidas para esta variable."));return;}
 const lo=Math.min(...valid.map(r=>r[metric])),hi=Math.max(...valid.map(r=>r[metric])),pad=Math.max((hi-lo)*.15,.1),min=metric==="temperature_c"?lo-pad:Math.max(0,lo-pad),max=hi+pad;
 const start=rows[0].captured_ts,end=rows[rows.length-1].captured_ts;
 const x=t=>65+790*(t-start)/Math.max(1,end-start),y=v=>205-165*(v-min)/Math.max(.1,max-min);
 for(let i=0;i<=4;i++){const v=min+(max-min)*i/4,yy=y(v);chart.append(svg("line",{x1:65,y1:yy,x2:855,y2:yy,stroke:"#e5ecef"}),svg("text",{x:55,y:yy+4,fill:"#61717b","font-size":12,"text-anchor":"end"},v.toFixed(2)));}
 let segment=[];
 const flush=()=>{if(segment.length)chart.append(svg("polyline",{points:segment.join(" "),fill:"none",stroke:"#14766c","stroke-width":2.5}));segment=[];};
 let prev=null;
 for(const row of rows){if(row[metric]===null||row.device_status!=="ok"){flush();prev=null;continue;}if(prev!==null&&row.captured_ts-prev>staleWindow)flush();segment.push(x(row.captured_ts)+","+y(row[metric]));prev=row.captured_ts;chart.append(svg("circle",{cx:x(row.captured_ts),cy:y(row[metric]),r:2.5,fill:"#14766c"}));}flush();
 chart.append(svg("text",{x:65,y:237,fill:"#61717b","font-size":12},date(start)),svg("text",{x:855,y:237,fill:"#61717b","font-size":12,"text-anchor":"end"},date(end)));
}
function drawHistory(rows){lastRows=rows;$("history").replaceChildren();for(const r of rows.slice(0,25)){const tr=element("tr");for(const v of [date(r.captured_ts),fmt(r.ch4_vol_pct),fmt(r.o2_vol_pct),fmt(r.temperature_c),fmt(r.humidity_pct),r.source,labels[r.level]])tr.append(element("td",v));$("history").append(tr);}$("history-info").textContent=`Últimas ${Math.min(25,rows.length)} de ${rows.length} muestras consultadas. El CSV incluye hasta 10 000 del mismo nodo y periodo.`;drawChart();}
function showSummary(rows, metric) {
 const values = rows.map(row => row[metric]);
 const unit = {ch4_vol_pct: "% vol", o2_vol_pct: "% vol", temperature_c: "°C", humidity_pct: "% HR"}[metric];
 const display = value => values.length ? fmt(value) + " " + unit : "—";
 const entries = [
  ["Muestras válidas", String(values.length)],
  ["Mínimo", display(Math.min(...values))],
  ["Máximo", display(Math.max(...values))]
 ];
 $("summary").replaceChildren(...entries.map(([label, value]) => {
  const item = element("div");
  item.append(element("dt", label), element("dd", value));
  return item;
 }));
}
let serverTime = 0;
function readingQuery(limit) {
 const params = new URLSearchParams({node_id: $("node").value, limit: String(limit)});
 const seconds = Number($("period").value);
 if (seconds) params.set("since", new Date(serverTime - seconds * 1000).toISOString());
 return params;
}
let revision = 0;
function clearReadings() {
 drawHistory([]);
 $("history-info").textContent = "Sin lecturas para la consulta actual.";
 $("export").disabled = true;
}
async function refresh() {
 if ((!key && !demo) || busy) return;
 busy = true;
 const request = revision;
 try {
  const [status, events] = await Promise.all([
   api("/api/status").then(response => response.json()),
   api("/api/events").then(response => response.json())
  ]);
  if (request !== revision) return;
  serverTime = Date.parse(status.server_time);
  staleWindow = status.config.stale_after_seconds;
  const select = $("node");
  const selected = select.value;
  if (Array.from(select.options, o => o.value).join("|") !== status.nodes.map(n => n.id).join("|")) {
   select.replaceChildren(...status.nodes.map(n => new Option(n.id + " · " + n.label, n.id)));
   if (status.nodes.some(n => n.id === selected)) select.value = selected;
  }
  drawNodes(status.nodes);
  drawEvents(events);
  const data = await api("/api/readings?" + readingQuery(100)).then(response => response.json());
  if (request !== revision) return;
  drawHistory(data.readings);
  $("export").disabled = !data.readings.length;
  document.body.classList.add("connected");
  $("login").hidden = true;
  $("logout").hidden = demo;
  $("connection").textContent = demo ? "Simulación en vivo" : "Conectado al servidor";
  $("updated").textContent = "Última consulta: " + new Date(status.server_time).toLocaleTimeString("es-CO");
  $("message").textContent = "";
 } catch (err) {
  if (request !== revision) return;
  document.body.classList.remove("connected");
  $("login").hidden = demo;
  $("connection").textContent = "Sin conexión de datos";
  $("updated").textContent = "No se pueden confirmar lecturas actuales";
  $("message").textContent = err.message;
  $("nodes").replaceChildren(element("p", "Lecturas actuales no disponibles.", "empty"));
  $("counts").textContent = "Sin datos actuales";
  drawEvents([]);
  for (const id of ["total","alarm","issues","pending"]) $(id).textContent = "—";
  clearReadings();
 } finally {
  busy = false;
  if (request !== revision) refresh();
 }
}
function changeQuery() {
 revision++;
 clearReadings();
 refresh();
}
$("login").addEventListener("submit", event => {
 event.preventDefault();
 key = $("key").value.trim();
 sessionStorage.setItem("canari_operator", key);
 $("key").value = "";
 changeQuery();
});
$("logout").addEventListener("click", () => {
 sessionStorage.removeItem("canari_operator");
 location.reload();
});
$("node").addEventListener("change", changeQuery);
$("period").addEventListener("change", changeQuery);
$("metric").addEventListener("change", drawChart);
$("event-filter").addEventListener("change", () => drawEvents(recentEvents));
$("export").disabled = true;
$("sound").addEventListener("click",async()=>{if(sound){await sound.close();sound=null;$("sound").textContent="Activar sonido";}else{sound=new AudioContext();await sound.resume();$("sound").textContent="Desactivar sonido";}});
$("export").addEventListener("click",async()=>{try{const r=await api("/api/export.csv?"+readingQuery(10000));const url=URL.createObjectURL(await r.blob());const a=element("a");a.href=url;a.download="canari_lecturas.csv";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(err){$("message").textContent=err.message;}});
function showPage() {
 const pages = [...document.querySelectorAll("[data-page]")];
 const wanted = location.hash.slice(1);
 const view = pages.some(page => page.dataset.page === wanted) ? wanted : "overview";
 for (const page of pages) page.hidden = page.dataset.page !== view;
 for (const link of document.querySelectorAll("[data-view]")) {
  if (link.dataset.view === view) {
   link.setAttribute("aria-current","page");
   $("breadcrumb").textContent = link.textContent;
  } else link.removeAttribute("aria-current");
 }
 window.scrollTo(0,0);
}
window.addEventListener("hashchange",showPage);
showPage();
async function initialize() {
 try {
  const response = await fetch("/health", {signal:AbortSignal.timeout(5000)});
  demo = (await response.json()).public_simulation === true;
 } catch { /* Operator access can still be retried through the login form. */ }
 if (demo) $("login").hidden = true;
 await refresh();
}
initialize();
setInterval(refresh,3000);
