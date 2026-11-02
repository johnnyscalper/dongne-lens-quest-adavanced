// Client integration checks: real local engines and app source, minimal DOM adapter.
// Layout, native dialogs and focus still require browser QA.
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const root = require('node:path').resolve(__dirname, '..');
const ids = new Map(); const elements = new Set(); const events = [];
const documentListeners = new Map(); const windowListeners = new Map();
let document;
class El {
  constructor(tag='div') { this.tagName=tag.toUpperCase(); this.children=[]; this.dataset={}; this.attributes={}; this.style={}; this.listeners=new Map(); this.value=''; this.hidden=false; this._text=''; this.valid=true; this.mounted=false; elements.add(this); }
  append(...children) { for(const child of children){ if(typeof child==='string')continue; if(child.parent)child.remove();child.parent=this;this.children.push(child); } }
  replaceChildren(...children){ for(const c of this.children)c.parent=null;this.children=[];this.append(...children); }
  set textContent(v){this._text=String(v);this.replaceChildren();} get textContent(){return this._text+this.children.map(c=>c.textContent).join('');}
  setAttribute(k,v){this.attributes[k]=String(v);if(k==='id'){this.id=String(v);ids.set(this.id,this);}if(k==='class')this.className=String(v);}
  getAttribute(k){return this.attributes[k]??null;}
  addEventListener(k,fn){if(!this.listeners.has(k))this.listeners.set(k,[]);this.listeners.get(k).push(fn);}
  fire(type){for(const fn of this.listeners.get(type)||[])fn({preventDefault(){},target:this});}
  focus(){document.activeElement=this;}
  checkValidity(){return this.valid;}
  get options(){return this.children;}
  get selectedOptions(){const found=this.children.find(x=>x.value===this.value);return [found||{textContent:({all:'전체 면적',small:'60㎡ 이하',medium:'60~85㎡',large:'85㎡ 초과'})[this.value]||this.value}];}
  get isConnected(){return this.mounted||Boolean(this.parent?.isConnected);}
  remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;this.mounted=false;}
  closest(selector){if(selector==='[data-transaction]'&&this.dataset.transaction)return this;if(selector==='[data-region-query]'&&this.dataset.regionQuery)return this;return this.parent?.closest(selector)||null;}
}
const get=(id)=>{if(!ids.has(id)){const e=new El();e.id=id;e.mounted=true;ids.set(id,e);}return ids.get(id);};
document={readyState:'complete',body:get('body'),activeElement:null,getElementById:get,createElement:tag=>new El(tag),createElementNS:(_,tag)=>new El(tag),querySelector:s=>s==='main'?get('main'):null,
 querySelectorAll:s=>[...elements].filter(e=>e.isConnected&&(s==='[data-transaction]'?e.dataset.transaction:s==='.apartment-save[data-save-key]'?e.dataset.saveKey:s==='[data-region-query]'?e.dataset.regionQuery:false)),
 addEventListener:(k,fn)=>{if(!documentListeners.has(k))documentListeners.set(k,[]);documentListeners.get(k).push(fn);}};
get('mode-select').value='demo'; for(const v of ['demo','live']){const o=new El('option');o.value=v;get('mode-select').append(o);}
get('period-select').value='6';get('area-select').value='all';get('budget-input').value='150000';get('equity-input').value='70000';get('rate-input').value='4.5';
const transactionButtons={};for(const t of ['sale','jeonse','monthly']){const b=new El('button');b.dataset.transaction=t;b.mounted=true;transactionButtons[t]=b;}
const click=e=>{for(const fn of documentListeners.get('click')||[])fn({target:e,preventDefault(){}});};
const context=vm.createContext({document,URL,URLSearchParams,AbortController,TextEncoder,TextDecoder,Intl,Date,performance,console,setTimeout,clearTimeout,Blob,
 CustomEvent:class {constructor(type,{detail}){this.type=type;this.detail=detail;}},navigator:{},location:{search:'',protocol:'https:',href:'https://example.test/'},history:{replaceState(){}},
 addEventListener:(k,fn)=>{if(!windowListeners.has(k))windowListeners.set(k,[]);windowListeners.get(k).push(fn);},
 dispatchEvent:e=>{events.push(e);for(const fn of windowListeners.get(e.type)||[])fn(e);},DONGNE_RUNTIME:'local',DONGNE_REGIONS:JSON.parse(fs.readFileSync(root+'/data/regions.json','utf8'))});
context.window=context;context.globalThis=context;
for(const file of ['local-analytics.js','local-insights.js','local-api.js'])vm.runInContext(fs.readFileSync(root+'/public/'+file,'utf8'),context,{filename:file});
const baseRequest=context.DongneLocal.request;
let held=null;let release=null;let delayRegion=null;
context.DongneLocal={request:async(url,options)=>{if(delayRegion && String(url).includes(`/api/market?region=${delayRegion}`)){delayRegion=null;held=await baseRequest(url,options);await new Promise(r=>{release=r;});return held;}return baseRequest(url,options);}};
vm.runInContext(fs.readFileSync(root+'/public/app.js','utf8'),context,{filename:'app.js'});
const flush=async()=>{for(let i=0;i<8;i++)await new Promise(setImmediate);};
const count=type=>events.filter(e=>e.type===type).length;
(async()=>{
 await flush(); assert(context.DongneApp.getSnapshot().analysis);assert.equal(count('lens:ready'),1);assert.equal(count('lens:search-success'),0);
 assert.equal(get('warnings').children.length,0); // Duplicate demo boilerplate is not repeated.
 assert.equal(await context.DongneApp.search('서울특별시 성동구 성수동1가'),true);
 assert.equal(count('lens:search-success'),1);assert.equal(context.DongneApp.getSnapshot().filters.neighborhood,'성수동1가');
 assert.equal(context.DongneApp.getSnapshot().market.region.code,'11200');
 assert.equal(await context.DongneApp.search('강남구',{navigate:false}),true);assert.equal(count('lens:search-success'),1);
 get('scenario-form').fire('submit');await flush();assert.equal(count('lens:search-success'),1);
 get('area-select').value='medium';get('area-select').fire('change');await flush();assert.equal(count('lens:search-success'),1);
 click(transactionButtons.monthly);assert.equal(transactionButtons.monthly.getAttribute('aria-pressed'),'true');assert(get('apartment-list').children.length>0);
 const first=get('apartment-list').children[0];const footer=first.children.at(-1);footer.children[0].fire('click');
 const detail=events.filter(e=>e.type==='lens:apartment').at(-1).detail;
 assert.equal(detail.apartment.transaction_type,'monthly');assert.equal(detail.filters.area_band,'medium');assert(detail.apartment.monthly_count>0);assert(Number.isFinite(detail.apartment.monthly_deposit_krw));
 footer.children[1].fire('click');assert.equal(events.filter(e=>e.type==='lens:save').at(-1).detail.key,detail.key);
 context.dispatchEvent(new context.CustomEvent('lens:saved-changed',{detail:{keys:[detail.key]}}));assert.equal(footer.children[1].getAttribute('aria-pressed'),'true');
 context.dispatchEvent(new context.CustomEvent('lens:saved-changed',{detail:{keys:[]}}));assert.equal(footer.children[1].getAttribute('aria-pressed'),'false');
 get('scenario-form').valid=false;const previous=count('lens:search-success');assert.equal(await context.DongneApp.search('송파구'),false);assert.equal(count('lens:search-success'),previous);assert(count('lens:search-error')>0);assert.equal(context.DongneApp.getSnapshot().analysis,null);
 get('scenario-form').valid=true;
 assert.equal(await context.DongneApp.search('부산'),false);assert.equal(context.DongneApp.getSnapshot().market,null);assert.equal(get('apartment-list').children.length,0);assert.equal(get('home-sale').textContent,'—');
 delayRegion='11680';const outdated=context.DongneApp.search('강남구');await flush();assert(release);assert.equal(await context.DongneApp.search('성동구'),true);release();assert.equal(await outdated,false);assert.equal(context.DongneApp.getSnapshot().market.region.code,'11200');
 assert.equal(events.filter(e=>e.type==='lens:search-success').at(-1).detail.region.code,'11200');
 assert.equal(events.filter(e=>e.type==='lens:busy').at(-1).detail.loading,false);
 assert.equal(events.filter(e=>e.type==='lens:busy').at(-1).detail.analyzing,false);
 const beforeCancel = count('lens:search-success');
 delayRegion='11680'; release=null; const canceled=context.DongneApp.search('강남구'); await flush(); assert(release);
 context.DongneApp.cancelPendingNavigation();
 // Reopening the UI issues no new search. A's data can finish, but its route cannot revive.
 release(); assert.equal(await canceled,false); assert.equal(count('lens:search-success'),beforeCancel);
 assert.equal(context.DongneApp.getSnapshot().market.region.code,'11680');
 assert.equal(await context.DongneApp.search('성동구'),true);
 assert.equal(count('lens:search-success'),beforeCancel+1);
 console.log('PASS: init/explicit/silent/finance/filter navigation, qualified region, transaction cards, snapshot save, invalid funds, unsupported region, stale race, busy cleanup, cancel-reopen late response, next-search navigation');
})().catch(e=>{console.error(e);process.exitCode=1;});
