import { createDebugLogger } from './debug.js';
import { CameraController } from './camera.js';
import { rgbaToGray, sobelEdges, detectDocumentBounds, computeSharpness, computeGlare } from './receipt_detection.js';
import { drawPreviewOverlay, drawResultOverlay } from './overlay.js';
import { buildOcrReadyVariantsFromSelection } from './image_processing.js';
import { OcrEngine } from './ocr.js';
import { parseReceiptText, scoreOcrResult, buildOverlayValues } from './parser.js';
import { loadStoredReadings, saveStoredReadings, makeStoredReading, clusterStoredValues, chooseConsensus } from './consensus.js';

const $ = id => document.getElementById(id);
const els = {
  video:$('video'), previewOverlay:$('previewOverlay'), analysisCanvas:$('analysisCanvas'), captureCanvas:$('captureCanvas'), guidance:$('guidance'),
  receiptScore:$('receiptScore'), sharpnessScore:$('sharpnessScore'), glareScore:$('glareScore'), stabilityScore:$('stabilityScore'), captureApi:$('captureApi'),
  startBtn:$('startBtn'), stopBtn:$('stopBtn'), manualCaptureBtn:$('manualCaptureBtn'), resetBtn:$('resetBtn'), autoCapture:$('autoCapture'),
  runOcrAfterCapture:$('runOcrAfterCapture'), runOcrBtn:$('runOcrBtn'), showOcrOverlay:$('showOcrOverlay'), downloadImageLink:$('downloadImageLink'),
  emptyState:$('emptyState'), capturedWrap:$('capturedWrap'), capturedImage:$('capturedImage'), resultOverlay:$('resultOverlay'), ocrPanel:$('ocrPanel'),
  ocrStatus:$('ocrStatus'), ocrProgress:$('ocrProgress'), chosenVariant:$('chosenVariant'), itemSum:$('itemSum'), subtotalValue:$('subtotalValue'),
  subtotalDiff:$('subtotalDiff'), reconcileBanner:$('reconcileBanner'), parsedLines:$('parsedLines'), variantGallery:$('variantGallery'), ocrText:$('ocrText'),
  comparisonSummary:$('comparisonSummary'), comparisonTable:$('comparisonTable'), storeReadingBtn:$('storeReadingBtn'), clearReadingsBtn:$('clearReadingsBtn'),
  debugLog:$('debugLog'), copyDebugBtn:$('copyDebugBtn'), clearDebugBtn:$('clearDebugBtn')
};

const CFG = { analysisWidth:480, interval:120, stableNeeded:6, minReceipt:.60, minSharp:.52, maxGlare:.12, minStability:.75, attempts:10, goodScore:.58, excellent:.72 };
const debug = createDebugLogger(els.debugLog);
const camera = new CameraController({ videoEl:els.video, analysisCanvas:els.analysisCanvas, captureCanvas:els.captureCanvas, debug });
const ocr = new OcrEngine(debug);
const qualityCanvas = document.createElement('canvas');
const qualityCtx = qualityCanvas.getContext('2d',{willReadFrequently:true});
let timer=null,lastCorners=null,stableFrames=0,locked=false,busy=false,latest=null,currentBest=null,currentOverlay=null;
let stored=loadStoredReadings();

debug.log('Receipt Scanner Laboratory v8-single-best-grader loaded');
renderStored();
els.copyDebugBtn.onclick=()=>debug.copy(); els.clearDebugBtn.onclick=()=>debug.clear();
els.startBtn.onclick=start; els.stopBtn.onclick=stop; els.manualCaptureBtn.onclick=()=>captureCycle('manual'); els.resetBtn.onclick=reset;
els.runOcrBtn.onclick=runOcr; els.showOcrOverlay.onchange=drawOverlay; els.capturedImage.onload=drawOverlay; window.onresize=drawOverlay;
els.storeReadingBtn.onclick=storeReading; els.clearReadingsBtn.onclick=()=>{stored=[];saveStoredReadings(stored);renderStored();debug.log('Stored readings cleared');};

async function start(){
  try{const hi=await camera.start();els.captureApi.textContent=hi?'takePhoto':'canvas';els.guidance.textContent='Find a receipt';clearInterval(timer);timer=setInterval(analyzeLive,CFG.interval);}
  catch(e){debug.log('Camera start failed',e);els.guidance.textContent=`Camera error: ${e.message}`;}
}
function stop(){camera.stop();clearInterval(timer);timer=null;els.guidance.textContent='Camera inactive';}
function analyzeLive(){
  const image=camera.getAnalysisFrame(CFG.analysisWidth); if(!image)return;
  const {width:w,height:h,data}=image, gray=rgbaToGray(data,w,h), edges=sobelEdges(gray,w,h), bounds=detectDocumentBounds(gray,edges,w,h);
  const sharp=computeSharpness(gray,w,h,bounds), glare=computeGlare(data,gray,w,h,bounds), stability=stabilityScore(bounds,w,h);
  els.receiptScore.textContent=pct(bounds.score);els.sharpnessScore.textContent=pct(sharp);els.glareScore.textContent=pct(1-glare);els.stabilityScore.textContent=pct(stability);
  const good=bounds.score>=CFG.minReceipt&&sharp>=CFG.minSharp&&glare<=CFG.maxGlare&&stability>=CFG.minStability;
  els.guidance.textContent=!bounds||bounds.score<CFG.minReceipt?'Move closer and show all edges':sharp<CFG.minSharp?'Hold still — image is soft':glare>CFG.maxGlare?'Tilt phone to reduce glare':stability<CFG.minStability?'Hold steady':stableFrames<CFG.stableNeeded?'Good — keep holding':'Ready';
  drawPreviewOverlay(els.previewOverlay,bounds,w,h,good);
  if(good&&stableFrames>=CFG.stableNeeded&&els.autoCapture.checked&&!busy&&!locked)captureCycle('auto');
}
function stabilityScore(bounds,w,h){
  if(!lastCorners){lastCorners=bounds.corners.map(p=>({...p}));stableFrames=0;return 0;}
  let d=0;for(let i=0;i<4;i++)d+=Math.hypot(bounds.corners[i].x-lastCorners[i].x,bounds.corners[i].y-lastCorners[i].y);
  lastCorners=bounds.corners.map(p=>({...p}));const s=clamp(1-(d/(4*Math.hypot(w,h)))*35,0,1);stableFrames=s>=CFG.minStability?stableFrames+1:0;return s;
}

async function captureCycle(trigger){
  if(busy||locked)return; busy=true;locked=true;els.manualCaptureBtn.disabled=true;stableFrames=0;
  try{
    debug.log('Candidate capture started',{trigger});const candidates=[];let good=0;
    for(let attempt=1;attempt<=CFG.attempts;attempt++){
      els.guidance.textContent=`Grading images… good ${good}/3`;
      const blob=await camera.captureFrameBlob(), q=await grade(blob);candidates.push({blob,quality:q,attempt});if(q.qualityScore>=CFG.goodScore)good++;
      debug.log('Candidate',{attempt,score:r3(q.qualityScore),textSharpness:r3(q.textSharpness),worstTile:r3(q.worstTileSharpness),contrast:r3(q.textContrast),coverage:r3(q.coverageScore),exposure:r3(q.exposureScore),glare:r3(q.glare),textTiles:q.textTileCount});
      const best=candidates.reduce((a,b)=>b.quality.qualityScore>a.quality.qualityScore?b:a);
      if(good>=3&&best.quality.qualityScore>=CFG.excellent)break;
      await sleep(120);
    }
    candidates.sort((a,b)=>b.quality.qualityScore-a.quality.qualityScore);const top=candidates.slice(0,3);
    debug.log('Best frame selected',{attempt:top[0].attempt,score:r3(top[0].quality.qualityScore)});
    els.ocrPanel.classList.remove('hidden');latest=await buildOcrReadyVariantsFromSelection(top,debug);renderVariants(latest.variants);await showProcessed(latest);
    if(els.runOcrAfterCapture.checked)await runOcr();else{els.ocrStatus.textContent='Preprocessed; OCR skipped';els.reconcileBanner.className='reconcile-banner warn';els.reconcileBanner.textContent='Best frame selected and preprocessed. Press Run OCR now to test local Tesseract.';}
  }catch(e){debug.log('Capture failed',e);els.guidance.textContent=`Capture failed: ${e.message}`;}
  finally{busy=false;els.guidance.textContent='Preprocessing complete — press Reset to scan again';}
}

async function grade(blob){
  const bmp=await createImageBitmap(blob),w=520,h=Math.max(1,Math.round(bmp.height*(w/bmp.width)));qualityCanvas.width=w;qualityCanvas.height=h;qualityCtx.drawImage(bmp,0,0,w,h);
  const img=qualityCtx.getImageData(0,0,w,h),gray=rgbaToGray(img.data,w,h),edges=sobelEdges(gray,w,h),bounds=detectDocumentBounds(gray,edges,w,h),paper=detectBrightPaperCrop(gray,w,h),b=paper||bounds;
  const glare=computeGlare(img.data,gray,w,h,b),cropArea=((b.right-b.left)*(b.bottom-b.top))/(w*h),cropAspect=(b.bottom-b.top)/Math.max(1,b.right-b.left),coverage=scoreCoverage(cropArea,cropAspect);
  const t=analyzeTextTiles(gray,w,h,b),exposure=exposureScore(gray,w,h,b),motion=gradientBalance(gray,w,h,b),cropConfidence=paper?.92:clamp(bounds.score,0,.72);
  const weighted=.34*t.textSharpness+.22*t.worstTileSharpness+.15*t.textContrast+.10*coverage+.09*exposure+.05*(1-glare)+.03*cropConfidence+.02*motion;
  const penalty=(glare>.18?.55:glare>.10?.78:1)*(cropArea<.035?.55:cropArea<.06?.78:1)*(t.textTileCount<3?.60:t.textTileCount<6?.82:1)*(exposure<.40?.72:1);
  return {receiptScore:coverage,sharpness:t.textSharpness,textSharpness:t.textSharpness,worstTileSharpness:t.worstTileSharpness,textContrast:t.textContrast,textTileCount:t.textTileCount,glare,cropArea,cropAspect,coverageScore:coverage,exposureScore:exposure,motionBalance:motion,cropConfidence,usedPaperCrop:!!paper,cropRectNorm:{x0:b.left/w,y0:b.top/h,x1:b.right/w,y1:b.bottom/h},qualityScore:clamp(weighted*penalty,0,1)};
}
function analyzeTextTiles(gray,w,h,b){
  const stats=[];for(let r=0;r<8;r++)for(let c=0;c<4;c++){const x0=Math.round(b.left+c*(b.right-b.left)/4),x1=Math.round(b.left+(c+1)*(b.right-b.left)/4),y0=Math.round(b.top+r*(b.bottom-b.top)/8),y1=Math.round(b.top+(r+1)*(b.bottom-b.top)/8),s=tileStats(gray,w,h,x0,y0,x1,y1);if(s.darkRatio>=.006&&s.darkRatio<=.42&&s.contrast>=16&&s.edgeDensity>=.01)stats.push(s);}
  const u=stats.length?stats:[tileStats(gray,w,h,b.left,b.top,b.right,b.bottom)],sh=u.map(x=>x.sharpness).sort((a,b)=>a-b),co=u.map(x=>x.contrastScore).sort((a,b)=>a-b);
  return{textSharpness:percentile(sh,.55),worstTileSharpness:percentile(sh,.20),textContrast:percentile(co,.55),textTileCount:stats.length};
}
function tileStats(gray,w,h,x0,y0,x1,y1){
  let sum=0,count=0,dark=0,edge=0,min=255,max=0,ls=0,l2=0,ln=0;
  for(let y=Math.max(1,y0);y<Math.min(h-1,y1);y+=2)for(let x=Math.max(1,x0);x<Math.min(w-1,x1);x+=2){const i=y*w+x,v=gray[i];sum+=v;count++;min=Math.min(min,v);max=Math.max(max,v);if(Math.abs(gray[i+1]-gray[i-1])+Math.abs(gray[i+w]-gray[i-w])>42)edge++;const l=gray[i-w]+gray[i+w]+gray[i-1]+gray[i+1]-4*v;ls+=l;l2+=l*l;ln++;}
  const mean=count?sum/count:0;for(let y=Math.max(1,y0);y<Math.min(h-1,y1);y+=2)for(let x=Math.max(1,x0);x<Math.min(w-1,x1);x+=2){const v=gray[y*w+x];if(v<mean-22&&v<190)dark++;}
  const lm=ln?ls/ln:0,lv=ln?l2/ln-lm*lm:0,contrast=max-min;return{darkRatio:count?dark/count:0,edgeDensity:count?edge/count:0,contrast,contrastScore:clamp((contrast-18)/95,0,1),sharpness:clamp(Math.log1p(Math.max(0,lv))/8.2,0,1)};
}
function exposureScore(gray,w,h,b){let n=0,hi=0,lo=0,sum=0;for(let y=b.top;y<b.bottom;y+=3)for(let x=b.left;x<b.right;x+=3){const v=gray[Math.round(y)*w+Math.round(x)];if(v>248)hi++;if(v<5)lo++;sum+=v;n++;}if(!n)return 0;return clamp(1-Math.abs(sum/n-178)/120,0,1)*clamp(1-(hi/n*8+lo/n*4),0,1);}
function gradientBalance(gray,w,h,b){let gx=0,gy=0,n=0;for(let y=Math.max(1,b.top);y<Math.min(h-1,b.bottom);y+=3)for(let x=Math.max(1,b.left);x<Math.min(w-1,b.right);x+=3){const i=Math.round(y)*w+Math.round(x);gx+=Math.abs(gray[i+1]-gray[i-1]);gy+=Math.abs(gray[i+w]-gray[i-w]);n++;}if(!n||!gx||!gy)return .5;return clamp(1-Math.abs(Math.log(gx/gy))/1.8,0,1);}
function scoreCoverage(area,aspect){const a=area<.04?area/.04*.45:area<.30?.45+(area-.04)/.26*.55:1,as=clamp(1-Math.abs(aspect-2.2)/2.8,0,1);return clamp(.72*a+.28*as,0,1);}
function percentile(a,p){if(!a.length)return 0;return a[clamp(Math.round((a.length-1)*p),0,a.length-1)];}

async function showProcessed(ds){const blob=await new Promise(r=>ds.displayCanvas.toBlob(r,'image/jpeg',.94)),url=URL.createObjectURL(blob);els.capturedImage.src=url;els.capturedWrap.classList.remove('hidden');els.emptyState.classList.add('hidden');els.downloadImageLink.href=url;els.downloadImageLink.download='receipt-preprocessed.jpg';els.ocrStatus.textContent='Preprocessed';els.chosenVariant.textContent='Preprocessed image';}
function renderVariants(vs){els.variantGallery.innerHTML='';for(const v of vs){const card=document.createElement('div');card.className='variant-card';card.dataset.variant=v.id;const img=document.createElement('img');img.src=v.canvas.toDataURL('image/jpeg',.9);const title=document.createElement('strong');title.textContent=v.name;const meta=document.createElement('small');meta.textContent=v.ocrPreferred?'OCR-preferred variant':'Preprocessed image';card.append(img,title,meta);els.variantGallery.appendChild(card);}}
async function runOcr(){
  if(!latest){debug.log('OCR requested before preprocessing');return;}els.ocrStatus.textContent='Running OCR…';els.reconcileBanner.className='reconcile-banner';els.reconcileBanner.textContent='Running local Tesseract.';
  try{const results=[];for(let i=0;i<latest.ocrVariants.length;i++){const v=latest.ocrVariants[i];els.ocrStatus.textContent=`OCR ${i+1}/${latest.ocrVariants.length}: ${v.name}`;const d=await ocr.recognize(v.canvas),parsed=parseReceiptText(d.text||''),score=scoreOcrResult(d.confidence||0,parsed);results.push({name:v.name,text:d.text||'',confidence:d.confidence||0,parsed,score,words:Array.isArray(d.words)?d.words:[],sourceWidth:v.canvas.width,sourceHeight:v.canvas.height});}results.sort((a,b)=>b.score-a.score);renderOcr(results[0]);els.ocrStatus.textContent='Complete';}
  catch(e){debug.log('OCR failed',e);els.ocrStatus.textContent='OCR failed';els.reconcileBanner.className='reconcile-banner fail';els.reconcileBanner.textContent=e.message;}
}
function renderOcr(best){currentBest=best;currentOverlay=buildOverlayValues(best);els.chosenVariant.textContent=best.name;els.itemSum.textContent=money(best.parsed.itemSum);els.subtotalValue.textContent=best.parsed.subtotal==null?'Not found':money(best.parsed.subtotal);els.subtotalDiff.textContent=best.parsed.difference==null?'—':money(best.parsed.difference);els.ocrText.textContent=best.text||'(No text recognized)';els.parsedLines.innerHTML='';for(const e of best.parsed.parsed){const row=document.createElement('div');row.className='parsed-line'+(e.excluded?' excluded':'')+(e.isSubtotal?' subtotal':'');row.textContent=`${e.line}${e.amount==null?'':`   ${money(e.amount)}`}`;els.parsedLines.appendChild(row);}els.reconcileBanner.className='reconcile-banner '+(best.parsed.reconciles?'pass':best.parsed.subtotal==null?'warn':'fail');els.reconcileBanner.textContent=best.parsed.reconciles?'PASS: item prices match subtotal within 2¢.':best.parsed.subtotal==null?'UNRESOLVED: no reliable SUBTOTAL detected.':`FAIL: item sum differs by ${money(best.parsed.difference)}.`;drawOverlay();}
function drawOverlay(){drawResultOverlay(els.resultOverlay,els.capturedImage,currentOverlay,els.showOcrOverlay.checked,money);}
function storeReading(){if(!currentBest||!currentOverlay)return debug.log('Run OCR before storing');stored.push(makeStoredReading(currentBest,currentOverlay));if(stored.length>12)stored.shift();saveStoredReadings(stored);renderStored();}
function renderStored(){els.comparisonTable.innerHTML='';if(!stored.length){els.comparisonSummary.textContent='No stored readings yet.';return;}const cs=clusterStoredValues(stored);els.comparisonSummary.textContent=`${stored.length} reading(s), ${cs.length} number region(s).`;for(const c of cs){const row=document.createElement('div');row.className='comparison-row '+(c.distinctValues.length>1?'disagree':c.observations.length>=2?'agree':'');row.textContent=`${Math.round(c.cx*100)}%,${Math.round(c.cy*100)}  ${c.distinctValues.map(money).join(' / ')}  → ${money(chooseConsensus(c.observations).value)}`;els.comparisonTable.appendChild(row);}}
function reset(){locked=false;busy=false;els.manualCaptureBtn.disabled=false;latest=null;currentBest=null;currentOverlay=null;els.capturedImage.src='';els.capturedWrap.classList.add('hidden');els.ocrPanel.classList.add('hidden');els.emptyState.classList.remove('hidden');els.guidance.textContent=camera.stream?'Ready for next receipt':'Camera inactive';}

function detectBrightPaperCrop(gray,w,h){const th=Math.max(128,otsu(gray)+8),vis=new Uint8Array(w*h),q=new Int32Array(w*h),min=Math.round(w*h*.015);let best=null;for(let s=0;s<gray.length;s+=2){if(vis[s]||gray[s]<th)continue;let a=0,z=0;q[z++]=s;vis[s]=1;let count=0,l=w,r=0,t=h,b=0;while(a<z){const p=q[a++],x=p%w,y=Math.floor(p/w);count++;l=Math.min(l,x);r=Math.max(r,x);t=Math.min(t,y);b=Math.max(b,y);for(const n of [p-1,p+1,p-w,p+w]){if(n<0||n>=gray.length||vis[n])continue;const nx=n%w;if((n===p-1&&nx===w-1)||(n===p+1&&nx===0))continue;if(gray[n]>=th){vis[n]=1;q[z++]=n;}}}if(count<min)continue;const bw=r-l+1,bh=b-t+1,area=bw*bh/(w*h),aspect=bh/Math.max(1,bw),fill=count/Math.max(1,bw*bh),score=count*(.45+.35*clamp(1-Math.abs(aspect-2.2)/2.6,0,1)+.15*clamp((area-.03)/.4,0,1)+.05*clamp((fill-.22)/.5,0,1));if(!best||score>best.score)best={left:l,right:r,top:t,bottom:b,score};}if(!best)return null;const px=Math.round((best.right-best.left)*.035),py=Math.round((best.bottom-best.top)*.035);return{left:clamp(best.left-px,0,w-1),right:clamp(best.right+px,0,w-1),top:clamp(best.top-py,0,h-1),bottom:clamp(best.bottom+py,0,h-1),score:best.score};}
function otsu(gray){const hist=new Uint32Array(256);for(const v of gray)hist[v]++;let total=gray.length,sum=0;for(let i=0;i<256;i++)sum+=i*hist[i];let sb=0,wb=0,max=0,th=128;for(let t=0;t<256;t++){wb+=hist[t];if(!wb)continue;const wf=total-wb;if(!wf)break;sb+=t*hist[t];const mb=sb/wb,mf=(sum-sb)/wf,v=wb*wf*(mb-mf)**2;if(v>max){max=v;th=t;}}return th;}
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v)),pct=v=>`${Math.round(clamp(v,0,1)*100)}%`,r3=v=>Math.round(v*1000)/1000,sleep=ms=>new Promise(r=>setTimeout(r,ms));
function money(v){if(v==null||!Number.isFinite(Number(v)))return'—';const n=Number(v);return`${n<0?'-':''}$${Math.abs(n).toFixed(2)}`;}
