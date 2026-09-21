'use strict';
const $ = id => document.getElementById(id);
const C = StudyCore;
const STORAGE = C.STUDY_ID;
const DRAFT_STORAGE = STORAGE + ':drafts';
const SERVICE = 'https://settled-gathered-exercises-maximize.trycloudflare.com';
// Local reviews always use preview mode; all study resources stay on this site.
const localReview = ['', 'localhost', '127.0.0.1', '::1'].includes(location.hostname);
const resourceBase = new URL('./', document.baseURI);
const resourceURL = path => new URL(path, resourceBase).href;
const previewId = new URLSearchParams(location.search).get('preview') || (localReview ? 'g1' : null);
let manifest, key, session, group, cases, index = 0, videos = [], urls = [];
let controller, generation = 0, ready = false, playing = false, watched = 0;
let duration = 0, openedAt = 0, previousTime = 0, previousTick = 0, saving = false, lastSync = 0;
let pendingAnswer = null;
let resumeOnVisible = false;
let buffering = false, playRequest = 0;
let validationShown = false;
let confirmedCount = 0;
const answerDrafts = new Map();
// Keep only the current and next comparison, including completed downloads when
// retrying one failed file so the other files do not need to be downloaded again.
const mediaCache = new Map();
function mediaIds(item) { return item ? [item.input,item.camera,...item.candidates].filter(Boolean) : []; }
function retainMedia(current, next) {
  const keep = new Set([...mediaIds(current),...mediaIds(next)]);
  for (const [id,entry] of mediaCache) if (!keep.has(id)) {
    entry.controller.abort(); mediaCache.delete(id);
  }
}
function loadAsset(id) {
  if (mediaCache.has(id)) return mediaCache.get(id).promise;
  const asset = manifest.assets[id], entry = {controller:new AbortController(),complete:false};
  mediaCache.set(id,entry);
  entry.promise = (async () => {
    let timeout;
    // Allow slow downloads to finish while bytes continue arriving.
    const resetTimeout = () => { clearTimeout(timeout); timeout = setTimeout(() => entry.controller.abort(new DOMException('No download progress','TimeoutError')),45000); };
    try {
      resetTimeout();
      const response = await fetch(resourceURL(asset.src),{signal:entry.controller.signal});
      if (!response.ok) throw new Error('A video could not download. Please retry loading.');
      const reader = response.body.getReader(), chunks = [];
      while (true) {
        const {done,value} = await reader.read();
        if (done) break;
        chunks.push(value); resetTimeout();
      }
      clearTimeout(timeout);
      let blob = new Blob(chunks,{type:asset.mime});
      if (asset.encrypted) {
        const bytes = await blob.arrayBuffer();
        const plain = await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),additionalData:new TextEncoder().encode('interaction-study-20260917-v1')},key,bytes.slice(12));
        blob = new Blob([plain],{type:asset.mime});
      }
      entry.complete = true; return blob;
    } catch (err) {
      if (mediaCache.get(id) === entry) mediaCache.delete(id);
      if (err.name === 'TimeoutError') throw new Error('The video download stopped responding. Please retry loading; completed downloads are kept.');
      throw err;
    } finally { clearTimeout(timeout); }
  })();
  return entry.promise;
}

function show(id) { for (const name of ['welcome','study','done']) $(name).hidden = name !== id; $('preview-banner').hidden = id !== 'study'; }
function error(message) { $('global-error').textContent = message || ''; $('global-error').hidden = !message; }
function persist() { if (!previewId) localStorage.setItem(STORAGE, JSON.stringify(session)); }
function readSaved() { try { const s = JSON.parse(localStorage.getItem(STORAGE)); return s?.studyId === C.STUDY_ID ? s : null; } catch { return null; } }
function savedExample() { return !previewId && index < confirmedCount; }
function persistDrafts() {
  if (!previewId) localStorage.setItem(DRAFT_STORAGE,JSON.stringify({sessionId:session.sessionId,choices:[...answerDrafts]}));
}
function rememberChoices() {
  if (!ready || saving || pendingAnswer || !cases?.[index] || savedExample()) return;
  const draft = choices();
  if (Object.keys(draft).length) answerDrafts.set(cases[index].id,draft);
  persistDrafts();
}
function restoreDrafts() {
  if (previewId) return;
  try {
    const saved = JSON.parse(localStorage.getItem(DRAFT_STORAGE));
    if (saved?.sessionId !== session.sessionId || !Array.isArray(saved.choices)) return;
    const ids = new Set(cases.slice(confirmedCount).map(c => c.id));
    for (const [id,draft] of saved.choices) if (ids.has(id)) answerDrafts.set(id,draft);
  } catch { /* Server-confirmed answers remain available if local drafts are unreadable. */ }
}
function updateNavigation() {
  $('preview-case').disabled = saving || !!pendingAnswer || !cases;
  if (!cases) return;
  for (const [i,option] of [...$('preview-case').options].entries()) {
    const state = !previewId && i < confirmedCount ? ' · Saved' : answerDrafts.has(cases[i].id) ? ' · Draft' : '';
    option.textContent = `Example ${i+1}${state}`;
  }
  $('progress-text').textContent = previewId ? `${index+1} of ${cases.length}` : `${confirmedCount} of ${cases.length} saved`;
  $('progress').value = previewId ? index : confirmedCount;
}
async function api(path, payload) {
  const body = JSON.stringify({studyId:C.STUDY_ID, revision:manifest.revision || 'r1', ...payload});
  for (let attempt=0;attempt<2;attempt++) {
    try {
      const response = await fetch(SERVICE + path, {method:'POST', headers:{'Content-Type':'application/json'}, body, signal:AbortSignal.timeout(20000)});
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        const failure = new Error(data.error || 'Saving is temporarily unavailable. Please retry.');
        failure.retryable = response.status >= 500 || response.status === 429;
        throw failure;
      }
      if (!data.sessionId || !Array.isArray(data.responses)) throw new TypeError('Incomplete service response.');
      return data;
    } catch (err) {
      const transient = err.retryable || err instanceof TypeError || ['TimeoutError','AbortError'].includes(err.name);
      if (!transient) throw err;
      if (attempt === 1) throw new Error('The connection could not complete. Your answers are kept in this browser. Please retry.');
      $(path.endsWith('/save') ? 'save-status' : 'welcome-status').textContent = 'Connection interrupted. Retrying automatically…';
      // Both endpoints reuse the same session and immutable answer prefix.
      await new Promise(resolve => setTimeout(resolve,750));
    }
  }
}
function pause() { playing = false; playRequest++; if (buffering) $('media-status').textContent = ''; buffering = false; videos.forEach(v => v.pause()); $('play').textContent = 'Play all'; }
function logicalTime() { const v = videos[videos.length - 1]; return v ? v.currentTime / v.playbackRate : 0; }
function clock(time = logicalTime()) { $('clock').textContent = `${Math.min(time,duration).toFixed(1)} / ${duration.toFixed(1)} s`; $('seek').value = duration ? Math.min(time / duration,1) * 1000 : 0; }
function seek(time) { const t = Math.max(0,Math.min(time,(cases[index].frames-1)/cases[index].fps)); videos.forEach(v => { v.currentTime = t * v.playbackRate; }); previousTime = t; clock(t); }
function bufferedAt(video, time) {
  if (video.readyState < 2 || video.seeking) return false;
  const start = time * video.playbackRate;
  const end = Math.min(video.duration, (time + .375) * video.playbackRate);
  for (let i=0;i<video.buffered.length;i++) {
    if (video.buffered.start(i) <= start + .02 && video.buffered.end(i) >= end - .02) return true;
  }
  return false;
}
function playbackFailure(message = 'A video could not play. Please retry.') {
  pause(); ready = false; $('media-status').textContent = message;
  $('retry').hidden = false; updateAnswers();
}
async function play() {
  if (!ready || document.hidden || saving || pendingAnswer) return;
  resumeOnVisible = false;
  const token = generation, request = ++playRequest;
  if (logicalTime() >= duration - 1 / cases[index].fps) seek(0);
  playing = true; buffering = true; $('play').textContent = 'Pause';
  videos.forEach(v => v.pause());
  const target = Math.min(...videos.map(v => v.currentTime / v.playbackRate));
  seek(target);
  $('media-status').textContent = 'Buffering videos together…';
  const bufferDeadline = performance.now() + 45000;
  try {
    while (!videos.every(v => bufferedAt(v,target))) {
      if (token !== generation || request !== playRequest || !playing) return;
      if (videos.some(v => v.error)) { playbackFailure(); return; }
      if (performance.now() > bufferDeadline) { playbackFailure('Video buffering timed out. Please retry loading.'); return; }
      await new Promise(resolve => setTimeout(resolve,50));
    }
    if (token !== generation || request !== playRequest || !playing) return;
    buffering = false; previousTime = target; previousTick = performance.now();
    await Promise.all(videos.map(v => v.play()));
    if (token === generation && request === playRequest && playing) $('media-status').textContent = '';
  } catch (err) {
    if (token === generation && request === playRequest) {
      pause();
      $('media-status').textContent = err.name === 'NotAllowedError'
        ? 'Autoplay was blocked. Press Play all to start.'
        : 'Playback paused. Press Play all to retry.';
    }
  }
}
function finish() {
  if (!playing) return;
  // Ignore a delayed ended event from the previous loop after seeking back to zero.
  if (logicalTime() < duration - 1 / cases[index].fps && !videos[videos.length-1].ended) return;
  pause();
  // Loop all videos on one shared timeline rather than looping each element independently.
  seek(0);
  if (!document.hidden) void play();
  else resumeOnVisible = true;
}
function tick(now) {
  if (playing && !buffering && videos.length) {
    const time = logicalTime();
    const delta = Math.max(0,time - previousTime);
    if (!document.hidden && videos.every(v => v.readyState >= 2)) watched += Math.min(delta,Math.max(0,now-previousTick)/1000 + .025);
    previousTime = time; previousTick = now;
    if (time >= duration - .025 || videos[videos.length-1].ended) finish();
    else {
      if (now - lastSync > 200) {
        videos.slice(0,-1).forEach(v => { if (Math.abs(v.currentTime/v.playbackRate-time) > .08) v.currentTime = time * v.playbackRate; });
        lastSync = now;
      }
      clock(time);
    }
  }
  requestAnimationFrame(tick);
}
function choices() { return Object.fromEntries(new FormData($('answers')).entries()); }
function incompleteCases(limit = cases.length) {
  const missing = [];
  for (let i = 0; i < limit; i++) {
    const response = session.responses[i], item = cases[i];
    if (!response || response.caseId !== item.id || !C.validChoices(response.choices || {},group.kind,group.allowTie)
      || !Array.isArray(response.candidates) || response.candidates.length !== item.candidates.length
      || response.candidates.some((id,j) => id !== item.candidates[j])) missing.push(i);
  }
  return missing;
}
async function returnToIncomplete(missing) {
  await openCase(missing[0]);
  if (index !== missing[0] || !ready) return;
  validationShown = true;
  updateValidation(true);
  $('answer-error').hidden = false;
  $('answer-error').textContent = `Your choices are kept as a draft. ${missing.length} earlier ${missing.length === 1 ? 'example still needs' : 'examples still need'} answers. Please complete Example ${index+1} before continuing.`;
}
function updateValidation(focus = false) {
  const missing = [];
  for (const field of $('questions').querySelectorAll('fieldset')) {
    const unanswered = !field.querySelector('input:checked');
    if (unanswered) missing.push(field);
    const invalid = validationShown && unanswered;
    field.classList.toggle('unanswered',invalid);
    for (const input of field.querySelectorAll('input')) {
      if (invalid) { input.setAttribute('aria-invalid','true'); input.setAttribute('aria-describedby','answer-error'); }
      else { input.removeAttribute('aria-invalid'); input.removeAttribute('aria-describedby'); }
    }
  }
  const showError = validationShown && missing.length > 0;
  $('answer-error').hidden = !showError;
  $('answer-error').textContent = showError
    ? `Please answer the ${missing.length === 1 ? 'remaining question' : `${missing.length} remaining questions`} before continuing.`
    : '';
  if (focus && missing.length) {
    missing[0].scrollIntoView?.({block:'nearest'});
    missing[0].querySelector('input').focus({preventScroll:true});
  }
}
function updateAnswers() {
  document.querySelectorAll('#questions input').forEach(el => { el.disabled = !ready || saving || !!pendingAnswer || savedExample(); });
  $('next').disabled = saving || (!pendingAnswer && !ready);
  $('seek').disabled = !ready;
  updateValidation();
  if (!saving && !pendingAnswer) {
    $('next').textContent = savedExample() ? 'Next example →' : index === cases.length-1 ? 'Submit & finish →' : 'Save & next →';
    $('save-status').textContent = !ready ? 'Loading videos…' : savedExample()
      ? 'These answers are already saved. You can review this example or jump to another.'
      : 'Choose your answers, then continue. Unsaved choices stay in this browser as drafts.';
  }
  updateNavigation();
}
function renderQuestions() {
  $('questions').replaceChildren();
  const pair = group.kind !== 'criteria', overall = group.kind === 'overall';
  const saved = (savedExample() ? session.responses[index]?.choices : answerDrafts.get(cases[index].id)) || session.responses[index]?.choices || {};
  $('answer-instruction').innerHTML = overall
    ? 'Choose A or B if one video is clearly better overall. <strong>If neither video is clearly better, select “About the same.”</strong>'
    : group.allowTie ? 'Choose A or B for each question. <strong>If neither video is clearly better for that question, select “About the same.”</strong>' : 'Choose one video for each question.';
  const questionOrder = overall ? C.questions(group.kind) : ['interaction', 'quality', 'camera'];
  for (const id of questionOrder) {
    const field = document.createElement('fieldset'), legend = document.createElement('legend'), copy = document.createElement('p'), row = document.createElement('div');
    legend.textContent = C.QUESTIONS[id][0]; copy.textContent = C.QUESTIONS[id][1]; copy.className = 'question-copy'; row.className = 'choices' + (pair ? ' pair' : '') + (group.allowTie && !overall ? ' has-tie' : '');
    for (const value of (overall || group.allowTie ? ['a','b','tie'] : pair ? ['a','b'] : ['a','b','c','d'])) {
      const label = document.createElement('label'), input = document.createElement('input'), text = document.createElement('span');
      label.className = 'choice' + (value === 'tie' ? ' tie' : ''); input.type = 'radio'; input.name = id; input.value = value; input.disabled = true; input.required = true;
      input.checked = saved[id] === value;
      text.textContent = value === 'tie' ? 'About the same' : value.toUpperCase();
      input.addEventListener('change', () => {
        try { rememberChoices(); } catch { error('Your draft could not be saved in this browser. Keep this page open and retry.'); }
        updateAnswers();
      }); label.append(input,text); row.append(label);
    }
    field.append(legend,copy,row); $('questions').append(field);
  }
}
function figure(label, letter, note) {
  const fig = document.createElement('figure'), cap = document.createElement('figcaption'), title = document.createElement('span'), video = document.createElement('video');
  title.className = 'caption-title';
  if (letter) { const badge = document.createElement('span'); badge.className = 'letter'; badge.textContent = letter; title.append(badge); }
  if (!letter) title.append(document.createTextNode(label));
  cap.append(title); video.muted = true; video.defaultMuted = true; video.playsInline = true; video.disablePictureInPicture = true; video.preload = 'auto'; fig.append(cap,video);
  if (note) { const small = document.createElement('small'); small.textContent = note; fig.append(small); }
  return {fig,video};
}
async function loadVideo(video, id, signal) {
  const asset = manifest.assets[id];
  const blob = await loadAsset(id);
  if (signal.aborted) throw new DOMException('Comparison changed', 'AbortError');
  const url = URL.createObjectURL(blob); urls.push(url);
  video.addEventListener('waiting',() => { if (ready && playing && !buffering) void play(); },{signal});
  video.addEventListener('error',() => { if (ready) playbackFailure(); },{signal});
  await new Promise((resolve,reject) => {
    const timeout = setTimeout(() => complete(new Error('A video took too long to load. Please retry.')),45000);
    const onReady = () => complete(); const onError = () => complete(new Error('A video could not play. Please retry.'));
    const onAbort = () => complete(new DOMException('Comparison changed','AbortError'));
    function complete(err) { clearTimeout(timeout); video.removeEventListener('loadeddata',onReady); video.removeEventListener('error',onError); signal.removeEventListener('abort',onAbort); if (err) reject(err); else resolve(); }
    video.addEventListener('loadeddata',onReady); video.addEventListener('error',onError); signal.addEventListener('abort',onAbort,{once:true});
    video.src = url; video.playbackRate = cases[index].fps / asset.encodedFps; video.defaultPlaybackRate = video.playbackRate; video.load();
  });
}
async function openCase(nextIndex) {
  rememberChoices();
  if (nextIndex >= cases.length) {
    const missing = incompleteCases();
    if (missing.length) return returnToIncomplete(missing);
  }
  pause(); resumeOnVisible = false; const token = ++generation; controller?.abort(); controller = new AbortController();
  videos.forEach(v => { v.removeAttribute('src'); v.load(); }); urls.forEach(url => URL.revokeObjectURL(url)); urls = []; videos = [];
  index = nextIndex; ready = false; watched = 0; pendingAnswer = null; validationShown = false; openedAt = performance.now();
  retainMedia(cases[index],cases[index+1]);
  if (index >= cases.length) return done();
  show('study'); $('study').dataset.kind = group.kind; $('study').dataset.pair = String(group.kind !== 'criteria'); const item = cases[index]; duration = item.frames / item.fps;
  $('case-title').textContent = `Example ${index+1}`; $('progress-text').textContent = `${index+1} of ${cases.length}`; $('progress').value = index;
  $('preview-case').value = index; $('next').textContent = index === cases.length-1 ? 'Submit & finish →' : 'Save & next →';
  ['play','replay','seek'].forEach(id => { $(id).disabled = true; }); $('retry').hidden = true; $('media-status').textContent = 'Loading videos…';
  $('references').replaceChildren(); $('candidates').replaceChildren(); $('references').classList.toggle('single',!item.camera);
  const loads = [];
  const add = (container,id,label,letter,note) => { const view = figure(label,letter,note); $(container).append(view.fig); videos.push(view.video); loads.push(loadVideo(view.video,id,controller.signal)); };
  add('references',item.input,'Input video');
  if (item.camera) add('references',item.camera,group.kind !== 'criteria' ? 'Warp' : 'Camera motion',null,'Viewpoint guide only; ignore holes and visual artifacts.');
  item.candidates.forEach((id,i) => add('candidates',id,`Video ${'ABCD'[i]}`,'ABCD'[i]));
  renderQuestions(); updateAnswers(); clock(0);
  try {
    await Promise.all(loads);
    if (token !== generation) return;
    ready = true; $('play').disabled = false; $('replay').disabled = false; $('media-status').textContent = '';
    updateAnswers();
    videos[videos.length-1].addEventListener('ended',finish);
    if (document.hidden) resumeOnVisible = true;
    else void play();
    // Prefetch only after every current video is local, so it does not compete
    // with current playback for network bandwidth.
    void Promise.allSettled(mediaIds(cases[index+1]).map(loadAsset));
  } catch (err) {
    if (token !== generation) return;
    pause(); $('media-status').textContent = err.name === 'AbortError' ? 'Loading timed out. Please retry.' : err.message; $('retry').hidden = false;
    $('save-status').textContent = 'Retry loading the videos to answer.';
  }
}
async function start() {
  error(''); $('start').disabled = true; $('resume').disabled = true;
  answerDrafts.clear();
  confirmedCount = 0;
  try {
    if (!previewId) {
      session = readSaved() || {studyId:C.STUDY_ID,sessionId:crypto.randomUUID(),responses:[]}; persist();
      $('welcome-status').textContent = 'Preparing your comparisons…';
      const saved = await api('/study/start',{sessionId:session.sessionId});
      const local = session.responses || [];
      session = saved;
      if (local.length > saved.responses.length) session.responses = local;
      // Retry an answer that was saved locally before an interrupted upload.
      if (session.responses.length > saved.responses.length) session = await api('/study/save',{sessionId:session.sessionId,responses:session.responses});
      confirmedCount = session.responses.length;
      persist();
    } else session = {studyId:C.STUDY_ID,sessionId:'preview',groupId:previewId,ordinal:0,responses:[],complete:false};
    cases = C.trials(manifest,session); group = {...manifest.groups.find(g => g.id === session.groupId)};
    if (session.kind) group.kind = session.kind;
    if (typeof session.allowTie === 'boolean') group.allowTie = session.allowTie;
    $('progress').max = cases.length;
    $('preview-case').replaceChildren();
    for (let i=0;i<cases.length;i++) { const option = document.createElement('option'); option.value = i; option.textContent = `Example ${i+1}`; $('preview-case').append(option); }
    restoreDrafts();
    await openCase(session.responses.length);
  } catch (err) {
    show('welcome'); $('welcome-status').textContent = 'Could not start or resume. Your saved progress is safe; please retry.'; error(err.message);
  } finally { $('start').disabled = !manifest || !key; $('resume').disabled = false; }
}
async function submit(event) {
  event.preventDefault(); if (saving) return;
  if (!pendingAnswer && !ready) return;
  if (savedExample()) { await openCase(index+1); return; }
  if (!pendingAnswer && !C.validChoices(choices(),group.kind,group.allowTie)) {
    validationShown = true;
    updateValidation(true);
    return;
  }
  const earlierMissing = incompleteCases(index);
  if (earlierMissing.length) return returnToIncomplete(earlierMissing);
  pause(); resumeOnVisible = false; error(''); saving = true;
  if (!pendingAnswer) {
    pendingAnswer = {caseId:cases[index].id,candidates:cases[index].candidates,choices:choices(),watchedSeconds:Number(watched.toFixed(3)),elapsedSeconds:Number(((performance.now()-openedAt)/1000).toFixed(3)),answeredUtc:new Date().toISOString()};
    answerDrafts.set(cases[index].id,pendingAnswer.choices);
    session.responses[index] = pendingAnswer;
  }
  try {
    persist(); updateAnswers(); $('save-status').textContent = previewId ? 'Preview only…' : 'Saving your answers…';
    if (!previewId) {
      session = await api('/study/save',{sessionId:session.sessionId,responses:session.responses});
      confirmedCount = session.responses.length; persist();
      answerDrafts.delete(cases[index].id); persistDrafts();
    }
    pendingAnswer = null; saving = false; await openCase(index+1); window.scrollTo({top:0,behavior:'instant'});
  } catch (err) {
    saving = false; updateAnswers(); $('next').textContent = 'Retry saving →'; $('save-status').textContent = 'Not yet submitted. Your answers are kept in this browser. Retry to continue.'; error(err.message);
  }
}
function done() {
  show('done'); $('progress').value = cases.length;
  $('done-message').textContent = previewId ? 'Preview complete. No answers were submitted.' : `All ${cases.length} comparisons have been submitted. Thank you for taking part.`;
  $('completion-code').textContent = session.receiptId ? `Completion receipt: ${session.receiptId}` : '';
}
$('start').addEventListener('click',start); $('resume').addEventListener('click',start);
$('play').addEventListener('click',() => { resumeOnVisible = false; if (playing) pause(); else void play(); });
$('replay').addEventListener('click',() => { resumeOnVisible = false; pause(); seek(0); void play(); });
$('seek').addEventListener('input',() => { resumeOnVisible = false; pause(); seek(Number($('seek').value)/1000*duration); });
$('retry').addEventListener('click',() => { void openCase(index); });
$('answers').addEventListener('submit',submit);
$('preview-case').addEventListener('change',async () => {
  if (!cases || saving || pendingAnswer) { $('preview-case').value = index; return; }
  try { await openCase(Number($('preview-case').value)); }
  catch { $('preview-case').value = index; error('Your draft could not be saved in this browser. Keep this page open and retry.'); }
});
// Background tabs cannot accrue viewing credit; resume only if playback was not manually paused.
document.addEventListener('visibilitychange',() => {
  if (document.hidden) {
    resumeOnVisible = resumeOnVisible || playing;
    pause();
  } else if (resumeOnVisible && ready) void play();
});
requestAnimationFrame(tick);
(async () => {
  try {
    const responses = await Promise.all([fetch(resourceURL('study.json?v=20260921-r4')),fetch(resourceURL('study-config.json'))]);
    if (responses.some(r => !r.ok)) throw new Error('The study could not load. Please reload this page.');
    const [inventory,config] = await Promise.all(responses.map(r => r.json()));
    manifest = C.validateManifest(inventory);
    const encoded = config.mediaKey.replaceAll('-','+').replaceAll('_','/');
    key = await crypto.subtle.importKey('raw',Uint8Array.from(atob(encoded),char => char.charCodeAt(0)),{name:'AES-GCM'},false,['decrypt']);
    if (previewId && !manifest.groups.some(g => g.id === previewId)) throw new Error('This preview link is invalid.');
    const counts = [...new Set(manifest.groups.map(g=>g.cases.length))].sort((a,b)=>a-b);
    document.querySelector('.facts').textContent = `${previewId ? manifest.groups.find(g=>g.id===previewId).cases.length : counts.join('–')} examples · 10–15 minutes`;
    if (!previewId) $('resume').hidden = !readSaved();
    $('welcome-status').textContent = '';
    $('start').disabled = false;
  } catch (err) { error(err.message); $('welcome-status').textContent = 'Please reload the page to try again.'; }
})();
