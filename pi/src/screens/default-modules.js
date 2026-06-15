/**
 * Default screen modules — pre-built HTML/CSS/JS modules.
 * These are seeded into the module registry on first boot.
 */

export const DEFAULT_MODULES = [
  {
    id: 'clock',
    name: 'Clock',
    category: 'standard',
    icon: 'clock',
    html: `
<div class="clock-screen">
  <div class="header">
    <img src="/icons/clock.png" class="icon">
    <span class="label" id="date"></span>
  </div>
  <div class="time" id="time"></div>
  <div class="remote">
    <div id="remote-label"></div>
    <div id="remote-time"></div>
  </div>
</div>`,
    css: `
.clock-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 16px; }
.header .label { font-size: 24px; }
.time {
  font-size: 145px;
  margin-top: 10px;
  line-height: 1;
}
.remote {
  margin-top: auto;
  font-size: 32px;
  line-height: 1.3;
}`,
    js: `
const localTz = window.NINJA_DATA?.local_tz || 'Asia/Tokyo';
const remoteTz = window.NINJA_DATA?.remote_tz || 'Europe/Stockholm';
const remoteLabel = window.NINJA_DATA?.remote_label || 'Sweden';

function update() {
  const now = new Date();
  const local = new Date(now.toLocaleString('en-US', {timeZone: localTz}));
  const remote = new Date(now.toLocaleString('en-US', {timeZone: remoteTz}));

  const pad = n => String(n).padStart(2, '0');

  document.getElementById('date').textContent =
    local.toLocaleDateString('en-US', {weekday: 'long', day: 'numeric', month: 'long', timeZone: localTz});
  document.getElementById('time').textContent =
    pad(local.getHours()) + ':' + pad(local.getMinutes());
  document.getElementById('remote-label').textContent = 'And in ' + remoteLabel;
  document.getElementById('remote-time').textContent =
    "it's " + pad(remote.getHours()) + ':' + pad(remote.getMinutes());
}
update();
setInterval(update, 1000);`,
  },

  {
    id: 'spotify',
    name: 'Spotify',
    category: 'standard',
    icon: 'spotify-icon',
    html: `
<div class="spotify-screen">
  <div class="header">
    <img src="/icons/spotify-icon.png" class="icon">
    <span class="label">Now playing</span>
  </div>
  <div class="track" id="track"></div>
  <div class="artist" id="artist"></div>
  <div class="progress-bar">
    <div class="progress-fill" id="progress"></div>
  </div>
  <div class="bottom-icons">
    <img src="/icons/ninja-headphones.png" class="bottom-icon">
    <div class="right-icons">
      <img src="/icons/tape.png" class="bottom-icon">
      <img src="/icons/audi-bars.png" class="bottom-icon">
    </div>
  </div>
</div>`,
    css: `
.spotify-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 16px; }
.header .label { font-size: 24px; }
.track {
  font-size: 50px;
  margin-top: 25px;
  line-height: 0.9;
  word-wrap: break-word;
}
.artist {
  font-size: 32px;
  margin-top: 12px;
}
.progress-bar {
  margin-top: 12px;
  height: 8px;
  background: rgba(255,255,255,0.15);
  border-radius: 0;
}
.progress-fill {
  height: 100%;
  background: #d2cba6;
  width: 0%;
}
.bottom-icons {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
}
.right-icons { display: flex; gap: 6px; }
.bottom-icon { width: 24px; height: 24px; }`,
    js: `
async function update() {
  try {
    const res = await fetch('/api/spotify/now-playing');
    const np = await res.json();
    if (np && np.playing) {
      let track = np.track || '';
      if (track.length > 37) track = track.slice(0, 36) + '...';
      document.getElementById('track').textContent = track;
      let artist = np.artist || '';
      if (artist.length > 21) artist = artist.slice(0, 20) + '...';
      document.getElementById('artist').textContent = artist;
      const pct = np.durationMs > 0 ? (np.progressMs / np.durationMs * 100) : 0;
      document.getElementById('progress').style.width = pct + '%';
    }
  } catch(e) {}
}
update();
setInterval(update, 1000);`,
  },

  {
    id: 'todo',
    name: 'Todo',
    category: 'standard',
    icon: 'list',
    html: `
<div class="todo-screen">
  <div class="header">
    <img src="/icons/list.png" class="icon">
    <span class="label">Todo!</span>
  </div>
  <div class="tasks" id="tasks"></div>
  <div class="more" id="more"></div>
</div>`,
    css: `
.todo-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 13px; }
.header .label { font-size: 24px; }
.tasks { margin-top: 20px; }
.task {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}
.checkbox {
  width: 14px;
  height: 14px;
  border: 2px solid #d2cba6;
  flex-shrink: 0;
  margin-top: 3px;
}
.task-text { font-size: 24px; line-height: 1.2; }
.more {
  margin-top: auto;
  text-align: right;
  font-size: 24px;
  opacity: 0.5;
}`,
    js: `
async function update() {
  try {
    const res = await fetch('/api/tasks?date=' + new Date().toISOString().slice(0,10));
    const data = await res.json();
    const tasks = (data.tasks || []).filter(t => !t.done);
    const container = document.getElementById('tasks');
    container.innerHTML = tasks.slice(0, 5).map(t =>
      '<div class="task"><div class="checkbox"></div><div class="task-text">' +
      t.text + '</div></div>'
    ).join('');
    const remaining = tasks.length - 5;
    document.getElementById('more').textContent = remaining > 0 ? '+ ' + remaining + ' more' : '';
  } catch(e) {}
}
update();
setInterval(update, 10000);`,
  },

  {
    id: 'habits',
    name: 'Habits',
    category: 'standard',
    icon: 'list',
    html: `
<div class="habits-screen">
  <div class="header">
    <img src="/icons/list.png" class="icon">
    <span class="label">Habits!</span>
  </div>
  <div class="habits" id="habits"></div>
  <div class="more" id="more"></div>
</div>`,
    css: `
.habits-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 13px; }
.header .label { font-size: 24px; }
.habits { margin-top: 20px; }
.habit {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  margin-bottom: 8px;
}
.checkbox {
  width: 14px;
  height: 14px;
  border: 2px solid #d2cba6;
  flex-shrink: 0;
  margin-top: 3px;
}
.checkbox.checked {
  background: #d2cba6;
  border-color: #d2cba6;
}
.habit.done .habit-text { opacity: 0.5; }
.habit-text { font-size: 24px; line-height: 1.2; }
.more {
  margin-top: auto;
  text-align: right;
  font-size: 24px;
  opacity: 0.5;
}`,
    js: `
async function update() {
  try {
    const res = await fetch('/api/habits?date=' + new Date().toISOString().slice(0,10));
    const data = await res.json();
    const habits = data.habits || [];
    const container = document.getElementById('habits');
    container.innerHTML = habits.slice(0, 5).map(h =>
      '<div class="habit ' + (h.checkedOnDate ? 'done' : '') + '">' +
      '<div class="checkbox ' + (h.checkedOnDate ? 'checked' : '') + '"></div>' +
      '<div class="habit-text">' + h.name + '</div></div>'
    ).join('');
    const remaining = habits.length - 5;
    document.getElementById('more').textContent = remaining > 0 ? '+ ' + remaining + ' more' : '';
  } catch(e) {}
}
update();
setInterval(update, 10000);`,
  },

  {
    id: 'ninja-says',
    name: 'Ninja Says',
    category: 'standard',
    icon: 'ninja-face',
    html: `
<div class="ninja-says-screen">
  <div class="header">
    <img src="/icons/ninja-face.png" class="icon">
    <span class="label">Ninja says!</span>
  </div>
  <div class="text" id="text"></div>
</div>`,
    css: `
.ninja-says-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header {
  display: flex;
  align-items: center;
  gap: 6px;
}
.header .icon { width: 16px; height: 18px; }
.header .label { font-size: 24px; }
.text {
  font-size: 32px;
  margin-top: 25px;
  line-height: 1.3;
  word-wrap: break-word;
}`,
    js: `
// Text is set via window.NINJA_DATA.text
function update() {
  const text = window.NINJA_DATA?.text || '';
  document.getElementById('text').textContent = text;
}
update();`,
  },

  {
    id: 'gif',
    name: 'GIF',
    category: 'standard',
    icon: '',
    html: `
<div class="gif-screen">
  <img id="gif" src="" style="width:240px;height:320px;object-fit:contain;">
</div>`,
    css: `
.gif-screen {
  width: 240px;
  height: 320px;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}`,
    js: `
const tag = window.NINJA_DATA?.gif_tag || 'cat pixelart';
const apiKey = window.NINJA_DATA?.tenor_key || 'LIVDSRZULELA';

async function fetchGif() {
  try {
    const res = await fetch('https://g.tenor.com/v1/random?q=' + encodeURIComponent(tag) + '&key=' + apiKey + '&limit=1');
    const data = await res.json();
    const url = data.results?.[0]?.media?.[0]?.tinygif?.url;
    if (url) document.getElementById('gif').src = url;
  } catch(e) {}
}
fetchGif();
setInterval(fetchGif, 60000);`,
  },
];
