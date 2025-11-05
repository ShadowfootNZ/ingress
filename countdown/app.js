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
  .map(a => {
    let dateStr = a.date.trim();

    // If it's date-only (no time), assume midnight local time
    if (!dateStr.includes('T')) {
      dateStr += 'T00:00:00';
    }
    // Parse it in its local timezone
    const localDate = DateTime.fromISO(dateStr, { zone: a.timezone });
    // If still invalid, log it for debugging
    if (!localDate.isValid) {
      console.warn(`Invalid DateTime for ${a.city}:`, dateStr, a.timezone, localDate.invalidReason);
    }
    return {
      ...a,
      utcDate: localDate.isValid ? localDate.toUTC() : null
    };
  })
  // Drop invalid or unparsable dates
  .filter(a => a.utcDate)
  // Sort chronologically by UTC milliseconds
  .sort((a, b) => a.utcDate.toMillis() - b.utcDate.toMillis());

  if (!upcoming.length) {
    errorEl.textContent = "No upcoming or current anomalies found.";
    return;
  }

  let previousSeries = null;
  upcoming.forEach((a, index) => {
    try {
      // ✅ Insert series break when the series changes (except before the first)
      if (index > 0 && a.series !== previousSeries) {
        const hr = document.createElement('div');
        hr.className = 'series-break';
        container.appendChild(hr);
      }
      previousSeries = a.series;

      const eventLocal = a.utcDate.setZone(a.timezone);
      const userLocal  = a.utcDate.setZone(DateTime.local().zoneName);
      const hasTime    = a.date.includes("T");
      const isPast     = eventLocal.startOf('day') < DateTime.now().setZone(a.timezone).startOf('day');

      // sanitize external URLs before use
      const resUrl = sanitizeUrl(a["url-res"]);
      const enlUrl = sanitizeUrl(a["url-enl"]);
      const pageUrl = sanitizeUrl(a.url);
      const winner   = (a.winner || "").toLowerCase(); // "resistance" | "enlightened" | ""
  
      // timing windows
      const eventEnd = hasTime ? a.utcDate.plus({ hours: 3 }) : a.utcDate.endOf('day');
      const sameDay  = a.utcDate.hasSame(now, 'day');
  
      // state flags
      const isActive = hasTime && now >= a.utcDate && now <= eventEnd;
      const isPrep   = !isActive && !!resUrl && !!enlUrl; // both sides organising
      let state = "future";
      if (sameDay) {
        if (hasTime) {
          if (now < a.utcDate) state = "today-upcoming";
          else if (isActive)    state = "active";
          else if (now > eventEnd && now <= eventEnd.plus({ hours: 6 })) state = "today-complete";
        } else {
          state = "today-upcoming";
        }
      }

      // build card
      const anomalyEl = document.createElement("div");
      anomalyEl.className = "anomaly border-default";

      let html = `
        <div class="anomaly-inner">
          <div class="side res-side">
            ${resUrl ? `<a href="${resUrl}" target="_blank" rel="noopener noreferrer"><img src="${(resUrl.endsWith('.webp')) ? resUrl : '../img/resistance.webp'}" alt="Resistance Logo" class="faction-logo"></a>` : ""}
          </div>
 
          <div class="center-content">
            <div class="series">${a.series}</div>
            <h2 class="location">
              ${pageUrl ? `<a href="${pageUrl}" target="_blank" rel="noopener noreferrer">${a.city}, ${a.country}</a>` : `${a.city}, ${a.country}`}
            </h2>
            <div class="time-info">
            ${hasTime
              ? isPast
                ? `<div class="local-time"> ${eventLocal.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}</div>`
                : `<div class="local-time">${eventLocal.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}</div>
                   <div class="user-time">${userLocal.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)} <span class="tz-label">(${DateTime.local().zoneName}</span>)</div>`
              : `<div class="local-time">${eventLocal.toLocaleString(DateTime.DATE_FULL)}</div>`}
          </div>
            <div class="countdown" id="cd-${a.series.replace(/[^a-zA-Z0-9_-]+/g,'')}-${a.city.replace(/[^a-zA-Z0-9_-]+/g,'')}"></div>
          </div>
 
          <div class="side enl-side">
            ${enlUrl ? `<a href="${enlUrl}" target="_blank" rel="noopener noreferrer"><img src="${enlUrl.endsWith('.webp') ? enlUrl : '../img/enlightened.webp'}" alt="Enlightened Logo" class="faction-logo"></a>` : ""}
          </div>
        </div>
      `;
   
      const validBadges = validateSeriesLogos(a["series-logos"]);
      console.log(`Badges for ${a.series}:`, validBadges);
      if (validBadges.length) {
        const badges = validBadges
          .map(name => `<img src="img/${name}" alt="${a.series} badge" class="series-badge">`)
          .join("");
        html += `<div class="series-badges">${badges}</div>`;
      }
 
       anomalyEl.innerHTML = html;
       container.appendChild(anomalyEl);
 
       // apply border classes in priority order
       if (isActive) {
         anomalyEl.classList.replace('border-default', 'border-active');
       } else if (winner === 'resistance') {
         anomalyEl.classList.replace('border-default', 'border-res');
       } else if (winner === 'enlightened') {
         anomalyEl.classList.replace('border-default', 'border-enl');
       } else if (isPrep) {
         anomalyEl.classList.replace('border-default', 'border-prep');
       }
       if (state === "today-upcoming") anomalyEl.classList.add("highlight-today");
       if (state === "today-complete")  anomalyEl.classList.add("dim");
 
       // grab the rendered countdown div
       const countdownEl = anomalyEl.querySelector('.countdown');
 
       // If start time has passed, do not create a timer.
       const startPassed = now >= a.utcDate;
       if (startPassed) {
         if (winner === 'resistance' || winner === 'enlightened') {
           const winnerText = winner.toUpperCase();
           countdownEl.textContent = winnerText;
           // apply winner colour class: 'res' or 'enl'
           countdownEl.classList.add(winner === 'resistance' ? 'res' : 'enl');
         }
       } else {
         // countdown updater (future events only)
         const tick = () => {
           const nowUtc = DateTime.utc();
           const diff = a.utcDate.diff(nowUtc, ['days','hours','minutes','seconds']);
           if (diff.valueOf() <= 0 && !isActive) {
             return;
           }
           const d = Math.floor(diff.days);
           const h = String(Math.floor(diff.hours)).padStart(2,"0");
           const m = String(Math.floor(diff.minutes)).padStart(2,"0");
           const s = String(Math.floor(diff.seconds)).padStart(2,"0");
           // Simplified countdown display
           if (diff.valueOf() <= 0 && !isActive) return;
           
           const totalSeconds = diff.as('seconds');
           const days = Math.floor(totalSeconds / 86400);
           const hours = Math.floor((totalSeconds % 86400) / 3600);
           const minutes = Math.floor((totalSeconds % 3600) / 60);
           
           let display = '';
           if (days >= 1) {
             display = `${days} day${days !== 1 ? 's' : ''}`;
           } else if (hours >= 1) {
             display = `${hours} hour${hours !== 1 ? 's' : ''}`;
           } else {
             display = `${minutes} minute${minutes !== 1 ? 's' : ''}`;
           }
           
           countdownEl.textContent = `in ${display}`;
         };
         tick();
         const interval = setInterval(tick, 1000);
         intervals.add(interval);
       }
     } catch (err) {
       console.error(`Error rendering anomaly ${a.city}:`, err);
     }
   });
 
  // register unload listener once (cleanup all intervals)
  window.addEventListener('unload', () => {
    intervals.forEach(i => clearInterval(i));
    intervals.clear();
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
    if (!Array.isArray(logos)) {
      console.warn("Expected series-logos to be an array, got:", logos);
      return [];
    }
  
    console.log("Raw series-logos input:", logos);
  
    const valid = logos.filter(logo =>
      typeof logo === 'string' &&
      /^[a-zA-Z0-9-_.]+$/.test(logo) // note: added '.' if filenames include extensions
    );
  
    console.log("Validated series-logos output:", valid);
  
    return valid;
  }
 }
 
 loadAnomalies();
