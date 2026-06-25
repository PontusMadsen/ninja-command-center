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
    id: 'calendar',
    name: 'Calendar',
    category: 'standard',
    icon: '',
    html: `
<div class="cal-screen">
  <div class="header">
    <span class="label">Upcoming</span>
  </div>
  <div class="events" id="events"></div>
</div>`,
    css: `
.cal-screen {
  height: 320px;
  display: flex;
  flex-direction: column;
  padding: 15px;
}
.header .label { font-size: 24px; }
.events { margin-top: 16px; }
.event {
  margin-bottom: 12px;
  border-left: 3px solid #d2cba6;
  padding-left: 10px;
}
.event-time {
  font-size: 12px;
  opacity: 0.5;
}
.event-title {
  font-size: 20px;
  margin-top: 2px;
  line-height: 1.2;
}
.event.all-day .event-time { display: none; }
.event.all-day::before {
  content: 'All day';
  font-size: 12px;
  opacity: 0.5;
}
.no-events {
  font-size: 16px;
  opacity: 0.4;
  margin-top: 40px;
}`,
    js: `
async function update() {
  try {
    const res = await fetch('/api/calendar/events');
    const data = await res.json();
    const events = data.events || [];
    const container = document.getElementById('events');
    if (!events.length) {
      container.innerHTML = '<div class="no-events">Nothing scheduled</div>';
      return;
    }
    container.innerHTML = events.slice(0, 5).map(e => {
      const allDay = e.allDay ? ' all-day' : '';
      let time = '';
      if (!e.allDay && e.start) {
        const d = new Date(e.start);
        time = d.toLocaleTimeString('en-US', {hour:'2-digit', minute:'2-digit', hour12:false});
        const today = new Date();
        if (d.toDateString() !== today.toDateString()) {
          time = d.toLocaleDateString('en-US', {weekday:'short'}) + ' ' + time;
        }
      }
      return '<div class="event' + allDay + '">' +
        '<div class="event-time">' + time + '</div>' +
        '<div class="event-title">' + (e.title || '') + '</div>' +
      '</div>';
    }).join('');
  } catch(e) {}
}
update();
setInterval(update, 60000);`,
  },

  {
    id: 'weather',
    name: 'Weather',
    category: 'standard',
    icon: '',
    html: `
<div class="weather-screen">
  <div class="header">
    <span class="label">Weather</span>
  </div>
  <div class="temp" id="temp">--°</div>
  <div class="desc" id="desc">Loading...</div>
  <div class="city" id="city">{{remote_label}}</div>
  <div class="details">
    <div class="detail"><span class="detail-label">Feels like</span><span id="feels">--°</span></div>
    <div class="detail"><span class="detail-label">Humidity</span><span id="humidity">--%</span></div>
  </div>
  <div class="forecast" id="forecast"></div>
</div>`,
    css: `
.weather-screen {
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
.header .label { font-size: 24px; }
.temp {
  font-size: 120px;
  margin-top: 10px;
  line-height: .75;
}
.desc {
  font-size: 38px;
  margin-top: 0px;
  text-transform: capitalize;
}
.city {
  font-size: 26px;
  margin-top: 4px;
  opacity: 0.5;
}
.details {
  display: flex;
  gap: 20px;
  margin-top: 20px;
}
.detail { font-size: 16px; }
.detail-label {
  display: block;
  font-size: 22px;
  opacity: 0.5;
}
.forecast {
  margin-top: auto;
  display: flex;
  gap: 8px;
}
.fc-item {
  font-size: 22px;
  opacity: 0.6;
}
.fc-item .fc-temp { font-size: 26px; opacity: 1; }`,
    js: `
async function update() {
  try {
    const res = await fetch('/api/weather');
    const w = await res.json();
    if (w && w.temp != null) {
      document.getElementById('temp').textContent = Math.round(w.temp) + '°';
      document.getElementById('desc').textContent = w.description || '';
      document.getElementById('city').textContent = w.city || '';
      document.getElementById('feels').textContent = Math.round(w.feelsLike || w.temp) + '°';
      document.getElementById('humidity').textContent = (w.humidity || '--') + '%';
      if (w.forecast && w.forecast.length) {
        document.getElementById('forecast').innerHTML = w.forecast.map(f => {
          const time = f.time ? f.time.split(' ')[1].slice(0,5) : '';
          return '<div class="fc-item"><div>' + time + '</div><div class="fc-temp">' + Math.round(f.temp) + '°</div></div>';
        }).join('');
      }
    }
  } catch(e) {}
}
update();
setInterval(update, 60000);`,
  },

  {
    id: 'gif',
    name: 'GIF',
    category: 'standard',
    icon: '',
    html: `
<div class="gif-screen">
  <img id="gif" src="">
</div>`,
    css: `
.gif-screen {
  width: 240px;
  height: 320px;
  background: #000;
  display: flex;
  align-items: center;
  justify-content: center;
}
.gif-screen img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  image-rendering: pixelated;
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
