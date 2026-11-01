'use strict';
const $ = id => document.getElementById(id);
const number = (v,d=0) => new Intl.NumberFormat('en-GB',{useGrouping:true,minimumFractionDigits:d,maximumFractionDigits:d}).format(v);
const percent = (v,d=1) => v == null ? '—' : `${number(v*100,d)}%`;
const esc = s => String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const CLASS_NAMES = Object.freeze({basophil:'Basophil',eosinophil:'Eosinophil',erythroblast:'Erythroblast',immature_granulocyte:'Immature granulocyte',lymphocyte:'Lymphocyte',monocyte:'Monocyte',neutrophil:'Neutrophil',platelet:'Platelet'});
const COLLECTION_NAMES = Object.freeze({final_test:'Final test',validation:'Development validation'});
const COLLECTION_PATHS = Object.freeze({final_test:'data/final_test.json',validation:'data/validation.json'});
const HASH_PATTERN = /^[a-f0-9]{64}$/;
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;
const IMAGE_CACHE_LIMIT = 24;
const imageCache = new Map();
const imageSlots = new Map();
const sessionProgress = new Map();
let data, catalog, manifest, state, storageKey, revealed=false, collectionRequest=0, ready=false, failed=false;
const budget = () => data.review.budgets[state.budget];
const current = () => data.cases[state.position];
const title = () => COLLECTION_NAMES[data.collection_id];
const protocolLabel = value => value.split('/').pop().replace(/^PROTOCOLO_/,'Protocol ').replace(/\.md$/,'');
const imagePath = id => `images/${data.collection_id}/${id}.jpg`;
const requireCondition = (condition,message) => { if(!condition) throw new Error(message); };
const fraction = v => typeof v==='number' && Number.isFinite(v) && v>=0 && v<=1;
const count = v => Number.isSafeInteger(v) && v>=0;

function announce(message){$('live').textContent=message;}
function showStorageNote(){
  $('storage-note').textContent='This browser cannot save progress. It will be kept for this session only.';
  $('storage-note').hidden=false;
}
function save(){
  const snapshot={...state,reviewed:[...state.reviewed]};
  sessionProgress.set(storageKey,snapshot);
  try{localStorage.setItem(storageKey,JSON.stringify(snapshot));}
  catch{showStorageNote();}
}
function fail(error){
  failed=true;ready=false;collectionRequest++;
  clearImages();
  $('main').hidden=true;$('loading').hidden=true;$('fatal-error').hidden=false;
  $('fatal-detail').textContent=error instanceof Error?error.message:String(error);
  announce('The collection could not be loaded or verified. No substitute results are shown.');
}
async function fetchBytes(path,signal){
  const response=await fetch(`./${path}`,{cache:'no-cache',credentials:'omit',redirect:'error',referrerPolicy:'no-referrer',signal});
  requireCondition(response.ok,`Unable to load ${path} (HTTP ${response.status}).`);
  return response.arrayBuffer();
}
function parseJSON(bytes,path){
  try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
  catch{throw new Error(`Invalid JSON or text encoding in ${path}.`);}
}
function fileEntry(path){
  requireCondition(Object.hasOwn(manifest.files,path),`The integrity manifest does not include ${path}.`);
  return manifest.files[path];
}
async function verifiedBytes(path,signal){
  const entry=fileEntry(path), bytes=await fetchBytes(path,signal);
  requireCondition(bytes.byteLength===entry.bytes,`File size does not match the manifest: ${path}.`);
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
  requireCondition(hash===entry.sha256,`SHA-256 does not match the manifest: ${path}.`);
  return bytes;
}
async function verifiedJSON(path){return parseJSON(await verifiedBytes(path),path);}
function validateManifest(value){
  requireCondition(value?.schema_version===1 && value.files && typeof value.files==='object' && !Array.isArray(value.files),'Unsupported or incomplete integrity manifest.');
  for(const [path,entry] of Object.entries(value.files)){
    requireCondition(/^[A-Za-z0-9_.\/-]+$/.test(path) && !path.startsWith('/') && path.split('/').every(part=>part && part!=='.' && part!=='..'),`Invalid path in the integrity manifest: ${path}.`);
    requireCondition(entry && HASH_PATTERN.test(entry.sha256) && count(entry.bytes),`Invalid integrity entry for ${path}.`);
  }
  manifest=value;
  ['data/catalog.json',...Object.values(COLLECTION_PATHS)].forEach(fileEntry);
}
function validateCatalog(value){
  requireCondition(value?.version===2 && value.default_id==='final_test' && value.final_test_available===true && value.notice==null && Array.isArray(value.collections) && value.collections.length===2,'The published catalogue must include the completed final test and development validation.');
  const ids=new Set();
  for(const c of value.collections){
    requireCondition(Object.hasOwn(COLLECTION_PATHS,c.collection_id) && !ids.has(c.collection_id) && HASH_PATTERN.test(c.fingerprint) && c.evaluated_split===(c.collection_id==='final_test'?'test':'validation'),'The collection catalogue is incomplete or inconsistent.');
    ids.add(c.collection_id);
  }
  return value;
}
function validateCollection(value,id){
  const entry=catalog.collections.find(c=>c.collection_id===id);
  requireCondition(value?.version===2 && value.collection_id===id && value.evaluated_split===entry.evaluated_split && value.fingerprint===entry.fingerprint && value.final_test_evaluated===true,`The ${id} collection does not match its catalogue.`);
  requireCondition(Array.isArray(value.classes) && value.classes.length===8 && new Set(value.classes.map(c=>c.id)).size===8 && value.classes.every(c=>Object.hasOwn(CLASS_NAMES,c.id)),`Invalid category definitions in ${id}.`);
  requireCondition(Array.isArray(value.cases) && value.cases.length>0 && value.cases.every(c=>c && ID_PATTERN.test(c.id)),`Invalid image identifiers in ${id}.`);
  requireCondition(new Set(value.cases.map(c=>c.id)).size===value.cases.length,`Repeated image identifiers in ${id}.`);
  const cls=value.classification, review=value.review;
  requireCondition(cls && fraction(cls.accuracy) && fraction(cls.macro_f1) && count(value.training_count) && count(value.reserved_test_count) && count(value.training_runs_this_phase) && typeof value.protocol==='string' && Number.isFinite(Date.parse(value.evaluated_at_utc)),`Invalid experiment metadata in ${id}.`);
  requireCondition(review && count(review.total_errors) && review.total_errors<=value.cases.length && review.random_repeats===1000 && Array.isArray(review.budgets) && review.budgets.length===4,`Invalid review results in ${id}.`);
  const expectedBudgets=[.05,.1,.2,.4];
  review.budgets.forEach((b,i)=>{
    requireCondition(b.fraction===expectedBudgets[i] && b.n_reviewed===Math.ceil(b.fraction*value.cases.length) && count(b.uncertainty?.errors_found) && b.uncertainty.errors_found<=b.n_reviewed && fraction(b.uncertainty.error_precision) && fraction(b.uncertainty.error_recall),`Invalid review budget in ${id}.`);
    for(const key of ['mean','q025','q975']) requireCondition(typeof b.random?.errors_found?.[key]==='number' && Number.isFinite(b.random.errors_found[key]) && b.random.errors_found[key]>=0 && b.random.errors_found[key]<=b.n_reviewed,`Invalid random comparison in ${id}.`);
  });
  requireCondition(Array.isArray(cls.confusion_matrix) && cls.confusion_matrix.length===8 && cls.confusion_matrix.every(row=>Array.isArray(row) && row.length===8 && row.every(count)),`Invalid confusion matrix in ${id}.`);
  value.classes.forEach(c=>requireCondition(count(cls.support_per_class?.[c.id]) && fraction(cls.recall_per_class?.[c.id]) && fraction(cls.f1_per_class?.[c.id]),`Invalid category metrics in ${id}.`));
  value.cases.forEach((c,i)=>{
    requireCondition(c.rank===i+1 && Object.hasOwn(CLASS_NAMES,c.prediction) && Object.hasOwn(CLASS_NAMES,c.reference) && typeof c.error==='boolean' && c.error===(c.reference!==c.prediction) && typeof c.filename==='string' && fraction(c.uncertainty) && Array.isArray(c.scores) && c.scores.length===8 && c.scores.every(fraction),`Invalid saved prediction in ${id}, position ${i+1}.`);
    fileEntry(`images/${id}/${c.id}.jpg`);
  });
  requireCondition(id!=='final_test' || (value.comparison===null && value.training_runs_this_phase===0),'Development comparison or new training is present in final-test data.');
  if(id==='validation'){
    const comparison=value.comparison;
    requireCondition(comparison?.n_images===400 && comparison.evaluated_split==='validation' && comparison.subset==='original_pilot_validation' && Array.isArray(comparison.image_ids) && comparison.image_ids.length===400 && new Set(comparison.image_ids).size===400,'The historical same-image validation comparison is missing or invalid.');
    const availableIds=new Set(value.cases.map(c=>c.id));
    requireCondition(comparison.image_ids.every(imageId=>availableIds.has(imageId)),'The historical comparison includes images outside development validation.');
    for(const model of ['pilot','expanded']){
      const result=comparison[model];
      requireCondition(result?.classification && fraction(result.classification.accuracy) && fraction(result.classification.macro_f1) && count(result.errors_count) && result.errors_count<=400,'Invalid historical comparison results.');
    }
    for(const transition of ['corrected','new_disagreements','still_disagree']) requireCondition(count(comparison.transitions?.[transition]?.count) && comparison.transitions[transition].count<=400,'Invalid historical disagreement transitions.');
  }
  return value;
}

// Blob URLs are created only after verification. References protect images that
// are currently displayed; unused entries are evicted from a bounded cache.
function trimImageCache(){
  for(const [path,entry] of imageCache){
    if(imageCache.size<=IMAGE_CACHE_LIMIT) break;
    if(entry.references>0) continue;
    if(entry.url) URL.revokeObjectURL(entry.url);
    entry.controller.abort();imageCache.delete(path);
  }
}
function releaseImage(img){
  const slot=imageSlots.get(img);
  if(slot){slot.entry.references--;imageSlots.delete(img);}
  img.removeAttribute('src');img.hidden=true;
  trimImageCache();
}
function clearImages(){
  for(const img of Array.from(imageSlots.keys())) releaseImage(img);
  for(const entry of imageCache.values()){
    entry.controller.abort();if(entry.url) URL.revokeObjectURL(entry.url);
  }
  imageCache.clear();
}
function getImageEntry(path){
  let entry=imageCache.get(path);
  if(entry){imageCache.delete(path);imageCache.set(path,entry);}
  else{
    entry={references:0,url:null,controller:new AbortController(),promise:null};
    imageCache.set(path,entry);
    entry.promise=verifiedBytes(path,entry.controller.signal).then(bytes=>{
      if(entry.controller.signal.aborted) throw new Error('Image request cancelled.');
      entry.url=URL.createObjectURL(new Blob([bytes],{type:'image/jpeg'}));
      return entry.url;
    });
  }
  entry.references++;trimImageCache();return entry;
}
async function setVerifiedImage(img,path,isMain=false){
  releaseImage(img);
  const entry=getImageEntry(path),slot={entry};imageSlots.set(img,slot);
  const request=collectionRequest;
  try{
    const url=await entry.promise;
    if(imageSlots.get(img)!==slot || request!==collectionRequest || failed)return;
    img.src=url;
    await img.decode();
    if(imageSlots.get(img)!==slot || request!==collectionRequest || failed)return;
    img.hidden=false;
    if(isMain){$('image-loading').hidden=true;$('mark-reviewed').disabled=false;}
  }catch(error){
    if(imageSlots.get(img)!==slot || request!==collectionRequest || failed)return;
    if(isMain){$('image-error').textContent=`The original image could not be loaded or verified: ${path}.`;$('image-error').hidden=false;}
    fail(new Error(`Image unavailable or invalid: ${path}. ${error.message}`));
  }finally{trimImageCache();}
}
function progress(){
  const n=budget().n_reviewed,reviewed=data.cases.slice(0,n).filter(c=>state.reviewed.has(c.id)).length;
  $('progress-count').textContent=`${number(reviewed)} / ${number(n)}`;
  $('progress').max=n;$('progress').value=reviewed;
  $('progress').setAttribute('aria-label',`${reviewed} of ${n} images marked as reviewed`);
  $('complete-note').hidden=reviewed!==n;
}
function renderQueue(){
  const n=budget().n_reviewed,start=Math.min(Math.max(0,state.position-2),Math.max(0,n-6)),end=Math.min(start+6,n);
  $('queue-window').textContent=`${start+1}–${end}`;
  $('queue').querySelectorAll('img').forEach(releaseImage);$('queue').replaceChildren();
  for(let i=start;i<end;i++){
    const c=data.cases[i],b=document.createElement('button');
    b.type='button';b.className=`queue-item${i===state.position?' active':''}`;
    b.setAttribute('aria-label',`Image ${i+1}, prediction ${CLASS_NAMES[c.prediction]}, uncertainty ${number(c.uncertainty,3)}${state.reviewed.has(c.id)?', reviewed':''}`);
    if(i===state.position)b.setAttribute('aria-current','true');
    b.innerHTML=`<span class="queue-thumbnail"><img alt="" hidden></span><span class="queue-text"><span class="queue-name">${esc(CLASS_NAMES[c.prediction])}</span><span class="queue-meta">${String(i+1).padStart(2,'0')} · H ${number(c.uncertainty,3)}</span></span><span class="queue-check">${state.reviewed.has(c.id)?'✓':''}</span>`;
    b.addEventListener('click',()=>go(i));$('queue').append(b);
    setVerifiedImage(b.querySelector('img'),imagePath(c.id));
  }
}
function renderReference(){
  const c=current();
  $('reveal').textContent=revealed?'Hide reference':'Reveal reference';
  $('reveal').setAttribute('aria-expanded',String(revealed));$('reference-result').hidden=!revealed;
  $('reference-label').textContent=revealed?CLASS_NAMES[c.reference]:'';
  $('agreement').textContent=revealed?(c.error?'Disagrees with the prediction':'Matches the prediction'):'';
  $('agreement').className=`agreement ${c.error?'mismatch':'match'}`;
  $('source-filename').textContent=revealed?c.filename:'';
}
function renderCase(){
  const c=current(),n=budget().n_reviewed;
  $('image-number').textContent=`Image ${number(state.position+1)} of ${number(n)}`;
  $('jump-position').max=String(n);$('jump-position').value=String(state.position+1);$('image-id').textContent=c.id;
  $('image-error').hidden=true;$('image-loading').hidden=false;$('mark-reviewed').disabled=true;
  const img=$('cell-image');img.classList.remove('zoomed');img.alt=`PBC cell image, queue position ${state.position+1}`;
  $('zoom-out').setAttribute('aria-pressed','true');$('zoom-in').setAttribute('aria-pressed','false');
  setVerifiedImage(img,imagePath(c.id),true);
  $('prediction-label').textContent=CLASS_NAMES[c.prediction];$('uncertainty').textContent=number(c.uncertainty,3);
  $('uncertainty-fill').style.width=`${c.uncertainty*100}%`;
  const scores=data.classes.map((cls,i)=>({id:cls.id,value:c.scores[i]})).sort((a,b)=>b.value-a.value);
  $('scores').innerHTML=scores.map(s=>`<div class="score-row${s.id===c.prediction?' winner':''}"><div><span>${esc(CLASS_NAMES[s.id])}</span><span>${number(s.value,3)}</span></div><div class="score-track" aria-hidden="true"><span style="width:${s.value*100}%"></span></div></div>`).join('');
  $('previous').disabled=state.position===0;$('next').disabled=state.position===n-1;
  $('reviewed-badge').hidden=!state.reviewed.has(c.id);
  $('mark-reviewed').innerHTML=state.reviewed.has(c.id)?'Unmark reviewed':'Mark reviewed <span aria-hidden="true">✓</span>';
  renderReference();progress();renderQueue();
}
function go(index){
  if(!ready)return;
  state.position=Math.max(0,Math.min(index,budget().n_reviewed-1));revealed=false;save();renderCase();
  announce(`Image ${state.position+1} of ${budget().n_reviewed}. Prediction: ${CLASS_NAMES[current().prediction]}.`);
}
function table(headers,rows){return `<thead><tr>${headers.map(h=>`<th scope="col">${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map(r=>`<tr>${r.map((c,i)=>i===0?`<th scope="row">${esc(c)}</th>`:`<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody>`;}
function renderResults(){
  const cls=data.classification,review=data.review;
  const cards=[['Accuracy',percent(cls.accuracy,2),'On the final test'],['Macro-F1',number(cls.macro_f1,3),'Mean across the eight categories'],['Disagreements',number(review.total_errors),`Among ${number(data.cases.length)} images`],['Images',number(data.cases.length),title()]];
  $('metrics-cards').innerHTML=cards.map(([label,value,detail])=>`<article class="metric"><span class="metric-label">${label}</span><strong>${value}</strong><span>${detail}</span></article>`).join('');
  const max=Math.max(1,...review.budgets.flatMap(b=>[b.uncertainty.errors_found,b.random.errors_found.mean]));
  $('review-chart').innerHTML=review.budgets.map(b=>`<div class="chart-group"><div class="chart-label">Review ${number(b.n_reviewed)} images · ${percent(b.fraction,0)}</div><div class="chart-row"><div class="chart-track"><div class="chart-bar" style="width:${b.uncertainty.errors_found/max*100}%"></div></div><span class="chart-number">${number(b.uncertainty.errors_found)}</span></div><div class="chart-row"><div class="chart-track"><div class="chart-bar random" style="width:${b.random.errors_found.mean/max*100}%"></div></div><span class="chart-number">${number(b.random.errors_found.mean,1)}</span></div></div>`).join('');
  $('review-table').innerHTML=table(['Reviews','Uncertainty','Random · mean','Random · P2.5–P97.5','Disagreement recall'],review.budgets.map(b=>[number(b.n_reviewed),number(b.uncertainty.errors_found),number(b.random.errors_found.mean,1),`${number(b.random.errors_found.q025,1)}–${number(b.random.errors_found.q975,1)}`,percent(b.uncertainty.error_recall,2)]));
  const focus=review.budgets.find(b=>b.fraction===.1);
  $('intro-result-scope').textContent='Final test · 10% reviewed';
  $('intro-found').textContent=number(focus.uncertainty.errors_found);
  $('intro-random').textContent=number(focus.random.errors_found.mean,1);
  $('intro-result-context').textContent=`Reviewing ${number(focus.n_reviewed)} images (10%). ${number(review.total_errors-focus.uncertainty.errors_found)} disagreements remain outside this selection.`;
  $('focus-title').textContent=`At 10%: ${number(focus.n_reviewed)} images`;
  $('focus-summary').innerHTML=`<div class="focus-value">${number(focus.uncertainty.errors_found)}</div><p class="focus-description">disagreements found by uncertainty, compared with <strong>${number(focus.random.errors_found.mean,1)}</strong> on average at random.</p><div class="focus-pair"><div><strong>${percent(focus.uncertainty.error_precision,2)}</strong><span>of reviewed images contain a disagreement</span></div><div><strong>${percent(focus.uncertainty.error_recall,2)}</strong><span>of all disagreements are recovered</span></div></div><p class="small muted">${number(review.total_errors-focus.uncertainty.errors_found)} disagreements remain outside this selection.</p>`;
  $('class-table').innerHTML=table(['Reference','Images','Recall','F1'],data.classes.map(c=>[CLASS_NAMES[c.id],number(cls.support_per_class[c.id]),percent(cls.recall_per_class[c.id],2),number(cls.f1_per_class[c.id],3)]));
  const monocyteIndex=data.classes.findIndex(c=>c.id==='monocyte'),immatureIndex=data.classes.findIndex(c=>c.id==='immature_granulocyte');
  const pairDisagreements=cls.confusion_matrix[monocyteIndex][immatureIndex]+cls.confusion_matrix[immatureIndex][monocyteIndex];
  $('class-insight').textContent=`Recall is ${percent(cls.recall_per_class.monocyte,2)} for monocytes and ${percent(cls.recall_per_class.immature_granulocyte,2)} for immature granulocytes, compared with ${percent(cls.recall_per_class.platelet,2)} for platelets. The model predicts ${number(cls.confusion_matrix[monocyteIndex][immatureIndex])} monocytes as immature granulocytes and ${number(cls.confusion_matrix[immatureIndex][monocyteIndex])} in the reverse direction. Together, these ${number(pairDisagreements)} confusions account for approximately ${percent(review.total_errors?pairDisagreements/review.total_errors:0,0)} of all final-test disagreements, making this pair a useful focus for further error analysis.`;
  const abbr={basophil:'BA',eosinophil:'EO',erythroblast:'ER',immature_granulocyte:'IG',lymphocyte:'LY',monocyte:'MO',neutrophil:'NE',platelet:'PL'};
  $('confusion-table').innerHTML=`<thead><tr><th scope="col">Reference / prediction</th>${data.classes.map(c=>`<th scope="col" title="${esc(CLASS_NAMES[c.id])}">${abbr[c.id]}</th>`).join('')}</tr></thead><tbody>${data.classes.map((c,i)=>`<tr><th scope="row">${esc(CLASS_NAMES[c.id])}</th>${cls.confusion_matrix[i].map((v,j)=>`<td class="${i===j?'good':''}">${number(v)}</td>`).join('')}</tr>`).join('')}</tbody>`;
  $('method-facts').innerHTML=`<dt>Evaluation set</dt><dd>${esc(title())}</dd><dt>Images used to train the classifier</dt><dd>${number(data.training_count)}</dd><dt>Images evaluated in the final test</dt><dd>${number(data.cases.length)}</dd><dt>Classifier fits in this phase</dt><dd>${number(data.training_runs_this_phase)} · frozen baseline reused</dd><dt>Protocol</dt><dd>${esc(protocolLabel(data.protocol))}</dd><dt>Priority rule</dt><dd>Normalized entropy · highest first · identifier breaks ties</dd><dt>Experiment identifier</dt><dd>${esc(data.run)}</dd><dt>Prediction fingerprint</dt><dd class="mono">${esc(data.fingerprint)}</dd>`;
}
function route(moveFocus=false){
  let view=location.hash.slice(1)||'review';
  if(!['review','results','method'].includes(view))view='review';
  document.querySelectorAll('.view').forEach(el=>el.hidden=el.id!==`view-${view}`);
  $('intro-panel').hidden=view!=='review';
  document.querySelectorAll('nav a').forEach(el=>{if(el.dataset.view===view)el.setAttribute('aria-current','page');else el.removeAttribute('aria-current');});
  if(moveFocus&&ready)$(view==='review'?'intro-title':`${view}-heading`).focus({preventScroll:true});
}
async function loadFinalTest(){
  const id='final_test';
  const request=++collectionRequest;ready=false;revealed=false;clearImages();
  $('main').hidden=true;$('loading').hidden=false;$('loading').textContent='Loading and checking saved collection data…';
  try{
    const incoming=validateCollection(await verifiedJSON(COLLECTION_PATHS[id]),id);
    if(request!==collectionRequest||failed)return;
    data=incoming;storageKey=`cellreview:space:review:v1:${data.collection_id}:${data.fingerprint}`;
    let stored=sessionProgress.get(storageKey)||{};
    if(!sessionProgress.has(storageKey)){
      try{stored=JSON.parse(localStorage.getItem(storageKey)||'{}')||{};}catch{showStorageNote();}
    }
    const ids=new Set(data.cases.map(c=>c.id));
    state={position:Number.isInteger(stored.position)?stored.position:0,budget:Number.isInteger(stored.budget)&&data.review.budgets[stored.budget]?stored.budget:1,reviewed:new Set(Array.isArray(stored.reviewed)?stored.reviewed.filter(id=>ids.has(id)):[])};
    state.position=Math.max(0,Math.min(state.position,budget().n_reviewed-1));
    $('collection-count').textContent=number(data.cases.length);
    $('budget').innerHTML=data.review.budgets.map((b,i)=>`<option value="${i}">${percent(b.fraction,0)} · ${number(b.n_reviewed)} images</option>`).join('');$('budget').value=String(state.budget);
    // Older links may specify a collection. The public demo now shows only test.
    const url=new URL(location.href);url.searchParams.delete('collection');history.replaceState(null,'',url);
    ready=true;renderResults();renderCase();route();$('main').hidden=false;$('loading').hidden=true;
    announce(`${title()}. ${number(data.cases.length)} images.`);
  }catch(error){if(request===collectionRequest&&!failed)fail(error);}
}
function bindControls(){
  $('intro-title').tabIndex=-1;
  $('start-review').addEventListener('click',()=>{
    if(!ready)return;
    go(0);$('image-number').focus({preventScroll:true});
    document.querySelector('.review-main').scrollIntoView({block:'start'});
  });
  document.querySelectorAll('a[href="#review"],a[href="#results"],a[href="#method"]').forEach(link=>link.addEventListener('click',event=>{
    if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
    if(location.hash===link.getAttribute('href')){event.preventDefault();route(true);window.scrollTo(0,0);}
  }));
  document.querySelector('.skip').addEventListener('click',event=>{
    if(!ready)return;
    event.preventDefault();$('main').focus({preventScroll:true});$('main').scrollIntoView({block:'start'});
  });
  $('budget').addEventListener('change',()=>{if(ready){state.budget=Number($('budget').value);go(state.position);}});
  $('jump-form').addEventListener('submit',e=>{e.preventDefault();if(!ready)return;const p=Number($('jump-position').value);if(Number.isInteger(p)&&p>=1&&p<=budget().n_reviewed)go(p-1);});
  $('previous').addEventListener('click',()=>go(state.position-1));$('next').addEventListener('click',()=>go(state.position+1));
  $('mark-reviewed').addEventListener('click',()=>{
    if(!ready)return;const c=current();
    if(state.reviewed.has(c.id)){state.reviewed.delete(c.id);save();renderCase();announce('Review unmarked.');}
    else{state.reviewed.add(c.id);go(Math.min(state.position+1,budget().n_reviewed-1));announce('Image marked as reviewed. '+$('image-number').textContent);}
  });
  $('reveal').addEventListener('click',()=>{if(!ready)return;revealed=!revealed;renderReference();announce(revealed?`Reference: ${CLASS_NAMES[current().reference]}. ${$('agreement').textContent}.`:'Reference hidden.');});
  $('zoom-in').addEventListener('click',()=>{$('cell-image').classList.add('zoomed');$('zoom-in').setAttribute('aria-pressed','true');$('zoom-out').setAttribute('aria-pressed','false');});
  $('zoom-out').addEventListener('click',()=>{$('cell-image').classList.remove('zoomed');$('zoom-out').setAttribute('aria-pressed','true');$('zoom-in').setAttribute('aria-pressed','false');});
  window.addEventListener('keydown',e=>{
    if(!ready||$('view-review').hidden||['SELECT','INPUT','TEXTAREA','BUTTON','A','SUMMARY'].includes(document.activeElement.tagName)||e.altKey||e.ctrlKey||e.metaKey)return;
    if(e.key==='ArrowRight'){e.preventDefault();go(state.position+1);}else if(e.key==='ArrowLeft'){e.preventDefault();go(state.position-1);}
  });
  window.addEventListener('hashchange',()=>{route(true);window.scrollTo(0,0);});
  window.addEventListener('pagehide',clearImages);
  // Restore revoked image URLs if the browser restores this page from its cache.
  window.addEventListener('pageshow',event=>{if(event.persisted&&ready)renderCase();});
}
async function init(){
  $('retry').addEventListener('click',()=>location.reload());
  try{
    requireCondition(globalThis.crypto?.subtle,'File verification requires HTTPS or localhost and a browser with Web Crypto support.');
    validateManifest(parseJSON(await fetchBytes('manifest.json'),'manifest.json'));
    catalog=validateCatalog(await verifiedJSON('data/catalog.json'));
    bindControls();
    await loadFinalTest();
  }catch(error){fail(error);}
}
init();
