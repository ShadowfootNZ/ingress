const { DateTime } = luxon;

async function loadAnomalies() {
  try {
    const res = await fetch('anomalies.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const anomalies = await res.json();
    renderAnomalies(anomalies);
  } catch (err) {
    document.getElementById('error').textContent =
      `Failed to load anomalies: ${err.message}`;
  }
}

function renderAnomalies(anomalies) {
  const container = document.getElementById('anomalyList');
  const errorEl = document.getElementById('error');
  container.innerHTML = "";
  errorEl.textContent = "";

  const now = DateTime.utc();
  const startOfToday = now.startOf('day');

  const upcoming = anomalies
    .map(a => ({ ...a, utcDate: DateTime.fromISO(a.date, { zone: 'utc' }) }))
    .filter(a => {
      const hasTime = a.date.includes("T");
      const endTime = hasTime ? a.utcDate.plus({ hours: 3 }) : a.utcDate.endOf('day');
      // keep events from today onward or within 6 hours after ending
      return endTime.plus({ hours: 6 }) >= now;
    })
    .sort((a, b) => a.utcDate - b.utcDate);

  if (!upcoming.length) {
    errorEl.textContent = "No upcoming or current anomalies found.";
    return;
  }

  upcoming.forEach(a => {
    const eventLocal = a.utcDate.setZone(a.timezone);
    const userLocal = a.utcDate.setZone(DateTime.local().zoneName);
    const hasTime = a.date.includes("T");

    const anomalyEl = document.createElement("div");
    anomalyEl.className = "anomaly";

    const eventEnd = hasTime ? a.utcDate.plus({ hours: 3 }) : a.utcDate.endOf('day');
    const sameDay = a.utcDate.hasSame(now, 'day');

    let state = "future";
    if (sameDay && hasTime) {
      if (now < a.utcDate) state = "today-upcoming";
      else if (now >= a.utcDate && now <= eventEnd) state = "active";
      else if (now > eventEnd && now <= eventEnd.plus({ hours: 6 })) state = "today-complete";
    }

    if (state === "active") anomalyEl.classList.add("pulse");
    else if (state === "today-upcoming") anomalyEl.classList.add("highlight-today");
    else if (state === "today-complete") anomalyEl.classList.add("dim");

    const countdownEl = document.createElement("div");
    countdownEl.className = "countdown";
    countdownEl.id = `cd-${a.series.replace(/\s+/g,'')}-${a.city.replace(/\s+/g,'')}`;

    let html = `
      <h2>${a.series}</h2>
      <div class="location">${a.city}, ${a.country}</div>
      <div class="time-info">
        <div><strong>Event UTC:</strong> ${a.utcDate.toFormat("yyyy-LL-dd HH:mm 'UTC'")}</div>
        <div><strong>Local Time (${a.city}):</strong> ${eventLocal.toFormat("yyyy-LL-dd HH:mm z")}</div>
        <div><strong>Your Time:</strong> ${userLocal.toFormat("yyyy-LL-dd HH:mm z")}</div>
      </div>
    `;
    if (a.irl) {
      html += `<a class="irl-link" href="${a.irl}" target="_blank" rel="noopener noreferrer">More details</a>`;
    }

    anomalyEl.innerHTML = html;
    anomalyEl.appendChild(countdownEl);
    container.appendChild(anomalyEl);

    const tick = () => {
      const nowUtc = DateTime.utc();
      const diff = a.utcDate.diff(nowUtc, ['days','hours','minutes','seconds']);
      if (diff.valueOf() <= 0 && state !== "active") {
        countdownEl.textContent = "In progress or complete";
        return;
      }
      const d = Math.floor(diff.days);
      const h = String(Math.floor(diff.hours)).padStart(2,"0");
      const m = String(Math.floor(diff.minutes)).padStart(2,"0");
      const s = String(Math.floor(diff.seconds)).padStart(2,"0");
      countdownEl.textContent = hasTime
        ? `${d}d ${h}h ${m}m ${s}s`
        : `${d} day${d !== 1 ? "s" : ""} remaining`;
    };
    tick();
    setInterval(tick, 1000);
  });
}


loadAnomalies();
