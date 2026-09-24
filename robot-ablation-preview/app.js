'use strict';
const $ = id => document.getElementById(id);
const roles = ['input', 'warp', 'clean16', 'A'];
const videos = roles.map(role => $(`video-${role}`));
let catalog, current = 0, generation = 0, loadController;
let playing = false, duration = 0, rates = [], lastSync = 0;

function pause() {
  playing = false;
  videos.forEach(video => video.pause());
  $('play').textContent = '同步播放';
}

function logicalTime() { return videos[2].currentTime / (rates[2] || 1); }

function updateClock(time = logicalTime()) {
  $('seek').value = duration ? Math.round(Math.min(time / duration, 1) * 1000) : 0;
  $('clock').textContent = `${Math.min(time, duration).toFixed(1)} / ${duration.toFixed(1)} s`;
}

function seek(time) {
  const item = catalog.cases[current];
  // Stop at the last selected frame, including the 41-frame pot-on-cooker interval.
  const position = Math.max(0, Math.min(time, (item.frames - 1) / item.fps));
  videos.forEach((video, i) => { video.currentTime = position * rates[i]; });
  updateClock(position);
}

async function play() {
  const token = generation;
  if (logicalTime() >= duration - 1 / catalog.cases[current].fps) seek(0);
  playing = true;
  $('play').textContent = '暂停';
  try {
    await Promise.all(videos.map(video => video.play()));
    if (token !== generation) return;
    $('media-status').textContent = '四个视频同步播放';
  } catch (error) {
    if (token !== generation) return;
    pause();
    $('media-status').textContent = '播放中断，请点击同步播放重试。';
  }
}

function finish() {
  if (!playing) return;
  pause();
  if ($('loop').checked) { seek(0); void play(); }
  else { seek(duration); $('media-status').textContent = '本案例播放完毕'; }
}

function tick(now) {
  if (playing) {
    const time = logicalTime();
    if (time >= duration - .015 || videos[2].ended) finish();
    else {
      if (now - lastSync > 200) {
        // Match frame positions even when a reused MP4 was encoded at another FPS.
        videos.forEach((video, i) => {
          if (i !== 2 && Math.abs(video.currentTime / rates[i] - time) > .08) video.currentTime = time * rates[i];
        });
        lastSync = now;
      }
      updateClock(time);
    }
  }
  requestAnimationFrame(tick);
}

function renderList() {
  const query = $('search').value.trim().toLowerCase();
  $('case-list').replaceChildren();
  let count = 0;
  catalog.cases.forEach((item, index) => {
    if (query && !`${item.title} ${item.dataset} ${item.id}`.toLowerCase().includes(query)) return;
    count++;
    const button = document.createElement('button');
    button.className = 'case-item';
    button.dataset.caseId = item.id;
    button.setAttribute('aria-current', String(index === current));
    const number = document.createElement('span');
    number.className = 'number'; number.textContent = String(index + 1).padStart(2, '0');
    const text = document.createElement('span');
    const name = document.createElement('span'); name.className = 'name'; name.textContent = item.title;
    const dataset = document.createElement('span'); dataset.className = 'dataset'; dataset.textContent = item.dataset;
    text.append(name, dataset); button.append(number, text);
    button.addEventListener('click', () => { void openCase(index); });
    $('case-list').append(button);
  });
  $('list-count').textContent = query ? `${count} / ${catalog.caseCount} 个案例` : `${catalog.caseCount} 个案例 · 已保存顺序`;
}

function loadVideo(video, asset, rate, signal) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => complete(new Error('视频加载超时')), 45000);
    const onReady = () => complete();
    const onError = () => complete(new Error('视频无法加载'));
    const onAbort = () => complete(new DOMException('Case changed', 'AbortError'));
    function complete(error) {
      clearTimeout(timer);
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
      signal.removeEventListener('abort', onAbort);
      if (error) reject(error); else resolve();
    }
    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    signal.addEventListener('abort', onAbort, {once: true});
    video.src = asset.src;
    video.defaultPlaybackRate = rate;
    video.playbackRate = rate;
    video.load();
  });
}

async function openCase(index) {
  pause();
  const token = ++generation;
  if (loadController) loadController.abort();
  loadController = new AbortController();
  current = index;
  const item = catalog.cases[index];
  duration = item.frames / item.fps;
  rates = roles.map(role => item.fps / item.videos[role].encodedFps);
  $('review').hidden = false;
  $('case-title').textContent = item.title;
  $('case-meta').textContent = `${String(index + 1).padStart(2, '0')} / ${catalog.caseCount} · ${item.dataset}`;
  $('case-id').textContent = item.id;
  $('position').textContent = `${index + 1} / ${catalog.caseCount}`;
  $('frame-info').textContent = `${item.frames} 帧 · ${item.fps} FPS · 同步视角`;
  $('previous').disabled = index === 0;
  $('next').disabled = index === catalog.cases.length - 1;
  ['play', 'replay', 'seek'].forEach(id => { $(id).disabled = true; });
  $('media-status').textContent = '正在加载视频…';
  $('retry').hidden = true;
  updateClock(0);
  renderList();
  history.replaceState(null, '', `#${item.id}`);
  try {
    await Promise.all(videos.map((video, i) => loadVideo(video, item.videos[roles[i]], rates[i], loadController.signal)));
    if (token !== generation) return;
    ['play', 'replay', 'seek'].forEach(id => { $(id).disabled = false; });
    $('media-status').textContent = '视频已就绪 · 点击同步播放';
  } catch (error) {
    if (token !== generation) return;
    $('media-status').textContent = `${error.message}，请重新加载。`;
    $('retry').hidden = false;
  }
}

$('play').addEventListener('click', () => { if (playing) pause(); else void play(); });
$('replay').addEventListener('click', () => { pause(); seek(0); void play(); });
$('seek').addEventListener('input', () => { pause(); seek(Number($('seek').value) / 1000 * duration); });
$('retry').addEventListener('click', () => { void openCase(current); });
$('previous').addEventListener('click', () => { if (current > 0) void openCase(current - 1); });
$('next').addEventListener('click', () => { if (current + 1 < catalog.cases.length) void openCase(current + 1); });
$('search').addEventListener('input', () => { if (catalog) renderList(); });
videos[2].addEventListener('ended', finish);
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });
document.querySelectorAll('.expand').forEach(button => button.addEventListener('click', () => {
  const figure = $(`video-${button.dataset.video}`).closest('figure');
  if (document.fullscreenElement) void document.exitFullscreen();
  else if (figure.requestFullscreen) void figure.requestFullscreen().catch(() => {});
}));
requestAnimationFrame(tick);
(async () => {
  try {
    const response = await fetch('catalog.json?v=20260924-labeled');
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    catalog = await response.json();
    $('intro').textContent = `当前保留 ${catalog.caseCount} 个案例 · 按已保存顺序排列 · Source CFG 1.5`;
    for (const model of catalog.models) {
      const p = document.createElement('p');
      p.textContent = `${model.label} · ${model.checkpoint}\n${model.experiment}`;
      $('model-details').append(p);
    }
    const index = catalog.cases.findIndex(item => `#${item.id}` === location.hash);
    await openCase(index < 0 ? 0 : index);
  } catch (error) {
    $('error').hidden = false;
    $('error').textContent = `页面加载失败，请刷新重试：${error.message}`;
  }
})();
