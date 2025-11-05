const { DateTime } = luxon;

async function loadAnomalies() {
  try {
    const res = await fetch('anomalies.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid anomalies data format');
    }

    // Flatten into a list of anomalies with series carried through
    const anomalies = data.flatMap(seriesObj => {
      if (!Array.isArray(seriesObj.sites)) {
        throw new Error(`Invalid sites data for series ${seriesObj.series}`);
      }
      return seriesObj.sites.map(site => ({
        series: seriesObj.series,
        ...site
      }));
    });

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

  // Store intervals for cleanup
  const intervals = new Set();

  const now = DateTime.utc();

  // Filter + sort
  const upcoming = anomalies
    .map(a => ({ ...a, utcDate: DateTime.fromISO(a.date, { zone: 'utc' }) }))
    .filter(a => {
      const hasTime = a.date.includes("T");
      const endTime = hasTime ? a.utcDate.plus({ hours: 3 }) : a.utcDate.endOf('day');
      // keep current day or future anomalies, or within 6 hours post-event
      return endTime.plus({ hours: 6 }) >= now;
    })
    .sort((a, b) => a.utcDate - b.utcDate);

  if (!upcoming.length) {
    errorEl.textContent = "No upcoming or current anomalies found.";
    return;
  }

  upcoming.forEach(a => {
    try {
      const eventLocal = a.utcDate.setZone(a.timezone);
      const userLocal = a.utcDate.setZone(DateTime.local().zoneName);
      const hasTime = a.date.includes("T");

      const anomalyEl = document.createElement("div");
      anomalyEl.className = "anomaly";

      const eventEnd = hasTime ? a.utcDate.plus({ hours: 3 }) : a.utcDate.endOf('day');
      const sameDay = a.utcDate.hasSame(now, 'day');

      // Determine display state
      let state = "future";
      if (sameDay) {
        if (hasTime) {
          if (now < a.utcDate) state = "today-upcoming";
          else if (now >= a.utcDate && now <= eventEnd) state = "active";
          else if (now > eventEnd && now <= eventEnd.plus({ hours: 6 })) state = "today-complete";
        } else {
          state = "today-upcoming";
        }
      }

      // Apply style class
      if (state === "active") anomalyEl.classList.add("pulse");
      else if (state === "today-upcoming") anomalyEl.classList.add("highlight-today");
      else if (state === "today-complete") anomalyEl.classList.add("dim");

      // Build HTML content
      const countdownEl = document.createElement("div");
      countdownEl.className = "countdown";
      countdownEl.id = `cd-${a.series.replace(/\s+/g,'')}-${a.city.replace(/\s+/g,'')}`;

      let html = `
      <div class="anomaly-inner">
        <div class="side res-side">
          ${a["url-res"] ? `<img src="../img/resistance.svg" alt="Resistance Logo" class="faction-logo">` : ""}
        </div>
    
        <div class="center-content">
        <div class="series">
        ${a.series}
      </div>
          <h2 class="location">
            ${a.url 
              ? `<a href="${a.url}" target="_blank" rel="noopener noreferrer">${a.city}, ${a.country}</a>` 
              : `${a.city}, ${a.country}` }
          </h2>

          <div class="time-info">
            <div class="local-time"><strong>Local Time:</strong> ${eventLocal.toFormat("dd LLLL yyyy HH:mm")}</div>
            <div class="user-time">(${userLocal.toFormat("dd LLLL yyyy HH:mm Z")})</div>
            <div class="countdown" id="cd-${a.series.replace(/\s+/g,'')}-${a.city.replace(/\s+/g,'')}"></div>
          </div>
        </div>
    
        <div class="side enl-side">
          ${a["url-enl"] ? `<img src="../img/enlightened.svg" alt="Enlightened Logo" class="faction-logo">` : ""}
        </div>
      </div>
    `;
    
    // Add optional series badge images if available
    if (a["series-logos"] && Array.isArray(a["series-logos"])) {
      const badges = a["series-logos"]
        .map(name => `<img src="img/${name}.svg" alt="${a.series} badge" class="series-badge">`)
        .join("");
      html += `<div class="series-badges">${badges}</div>`;
    }

      anomalyEl.innerHTML = html;
      //anomalyEl.appendChild(countdownEl);
      container.appendChild(anomalyEl);

      // Countdown updater with cleanup
      const tick = () => {
        const nowUtc = DateTime.utc();
        const diff = a.utcDate.diff(nowUtc, ['days','hours','minutes','seconds']);
        if (diff.valueOf() <= 0 && state !== "active") {
          countdownEl.textContent = "In progress or complete";
          // Clear interval when countdown is complete
          intervals.forEach(interval => clearInterval(interval));
          return;
        }
        const d = Math.floor(diff.days);
        const h = String(Math.floor(diff.hours)).padStart(2,"0");
        const m = String(Math.floor(diff.minutes)).padStart(2,"0");
        const s = String(Math.floor(diff.seconds)).padStart(2,"0");
        countdownEl.textContent = hasTime
          ? `${d}d ${h}h ${m}m ${s}s`
          : `in ${d} day${d !== 1 ? "s" : ""}`;
      };
      
      tick();
      const interval = setInterval(tick, 1000);
      intervals.add(interval);

      // Cleanup on page unload
      window.addEventListener('unload', () => {
        intervals.forEach(interval => clearInterval(interval));
      });
    } catch (err) {
      console.error(`Error rendering anomaly ${a.city}:`, err);
      // Skip this anomaly but continue with others
    }
  });

  // Sanitize URLs before use
  function sanitizeUrl(url) {
    if (!url) return '';
    try {
      const parsed = new URL(url);
      return parsed.href;
    } catch {
      return '';
    }
  }

  // Validate series-logos
  function validateSeriesLogos(logos) {
    if (!Array.isArray(logos)) return [];
    return logos.filter(logo => 
      typeof logo === 'string' && 
      /^[a-zA-Z0-9-_]+$/.test(logo)
    );
  }
}

loadAnomalies();
