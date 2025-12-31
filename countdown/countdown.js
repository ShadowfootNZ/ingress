const { DateTime } = luxon;

// Configuration constants
const CONFIG = {
  SERIES_CUTOFF_MONTHS: 1,
  EVENT_DURATION_HOURS: 3,
  POST_EVENT_DISPLAY_HOURS: 6,
  CACHE_VERSION: '1.0.0' // Use version instead of timestamp
};

// Active intervals for cleanup
let activeIntervals = new Set();

/**
 * Escapes HTML special characters to prevent XSS
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/**
 * Validates and sanitizes a URL
 */
function sanitizeUrl(url) {
  if (!url) return '';
  try {
    const parsed = new URL(url);
    return parsed.href;
  } catch {
    return '';
  }
}

/**
 * Validates series logo filenames
 */
function validateSeriesLogos(logos) {
  if (!Array.isArray(logos)) {
    console.warn("Expected series-logos to be an array, got:", logos);
    return [];
  }
  
  return logos.filter(logo =>
    typeof logo === 'string' &&
    /^[a-zA-Z0-9-_.]+$/.test(logo)
  );
}

/**
 * Clears all active countdown intervals
 */
function clearAllIntervals() {
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.clear();
}

/**
 * Normalizes date string to ISO format
 */
function normalizeDateString(dateStr) {
  const trimmed = dateStr.trim();
  return trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`;
}

/**
 * Main function to load and display anomalies
 */
async function loadAnomalies() {
  const container = document.getElementById('anomalyList');
  const errorEl = document.getElementById('error');
  
  // Clear previous intervals before loading new data
  clearAllIntervals();
  
  try {
    const res = await fetch(`anomaly-countdown.json?v=${CONFIG.CACHE_VERSION}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid anomalies data format');
    }

    const anomalies = processAnomaliesData(data);
    renderAnomalies(anomalies, container, errorEl);
    
  } catch (err) {
    errorEl.textContent = `Failed to load anomalies: ${err.message}`;
    console.error('Error loading anomalies:', err);
  }
}

/**
 * Processes raw JSON data into flat anomaly list
 */
function processAnomaliesData(data) {
  let anomalies = data.flatMap(seriesObj => {
    if (!Array.isArray(seriesObj.sites)) {
      throw new Error(`Invalid sites data for series ${seriesObj.series}`);
    }
    return seriesObj.sites.map(site => ({
      series: seriesObj.series,
      "series-logos": seriesObj["series-logos"] || [],
      ...site
    }));
  });

  // Add test anomaly if ?test=true
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('test') === 'true') {
    const nowLocal = DateTime.local();
    anomalies.push({
      series: "Local Test",
      "series-logos": [],
      date: nowLocal.toISO({ suppressMilliseconds: true }),
      city: "Test City",
      country: "Test Country",
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone
    });
    console.log("✅ Added local test anomaly:", nowLocal.toISO());
  }

  return anomalies;
}

/**
 * Filters and sorts anomalies, removing old series
 */
function filterAndSortAnomalies(anomalies) {
  const now = DateTime.utc();
  const cutoff = now.minus({ months: CONFIG.SERIES_CUTOFF_MONTHS });
  
  // Build map of latest event per series
  const seriesLatest = {};
  
  anomalies.forEach(a => {
    if (!a.date || !a.timezone) return;
    
    const dateStr = normalizeDateString(a.date);
    const localDate = DateTime.fromISO(dateStr, { zone: a.timezone });
    
    if (!localDate.isValid) return;
    
    const utcDate = localDate.toUTC();
    const key = a.series || "(no series)";
    
    if (!seriesLatest[key] || utcDate > seriesLatest[key]) {
      seriesLatest[key] = utcDate;
    }
  });

  // Filter and attach UTC dates
  return anomalies
    .map(a => {
      const dateStr = normalizeDateString(a.date);
      const localDate = DateTime.fromISO(dateStr, { zone: a.timezone });
      
      if (!localDate.isValid) {
        console.warn(`Invalid DateTime for ${a.city}:`, dateStr, a.timezone, localDate.invalidReason);
        return null;
      }
      
      return { ...a, utcDate: localDate.toUTC() };
    })
    .filter(a => a !== null && a.utcDate)
    .filter(a => {
      const key = a.series || "(no series)";
      const lastUtc = seriesLatest[key];
      return !lastUtc || lastUtc >= cutoff;
    })
    .sort((a, b) => a.utcDate.toMillis() - b.utcDate.toMillis());
}

/**
 * Renders all anomalies to the DOM
 */
function renderAnomalies(anomalies, container, errorEl) {
  container.innerHTML = "";
  errorEl.textContent = "";

  const upcoming = filterAndSortAnomalies(anomalies);

  if (!upcoming.length) {
    errorEl.textContent = "No upcoming or current anomalies found.";
    return;
  }

  let previousSeries = null;
  
  upcoming.forEach((anomaly, index) => {
    try {
      // Insert series break between different series
      if (index > 0 && anomaly.series !== previousSeries) {
        const hr = document.createElement('div');
        hr.className = 'series-break';
        container.appendChild(hr);
      }
      previousSeries = anomaly.series;

      const anomalyEl = createAnomalyCard(anomaly);
      container.appendChild(anomalyEl);
      
    } catch (err) {
      console.error(`Error rendering anomaly ${anomaly.city}:`, err);
    }
  });
}

/**
 * Creates a single anomaly card element
 */
function createAnomalyCard(a) {
  const now = DateTime.utc();
  const eventLocal = a.utcDate.setZone(a.timezone);
  const userLocal = a.utcDate.setZone(DateTime.local().zoneName);
  const hasTime = a.date.includes("T");
  const isPast = eventLocal.startOf('day') < DateTime.now().setZone(a.timezone).startOf('day');

  // Sanitize URLs
  const resUrl = sanitizeUrl(a["url-res"]);
  const enlUrl = sanitizeUrl(a["url-enl"]);
  const pageUrl = sanitizeUrl(a.url);
  const winner = (a.winner || "").toLowerCase();

  // Calculate timing
  const eventEnd = hasTime 
    ? a.utcDate.plus({ hours: CONFIG.EVENT_DURATION_HOURS }) 
    : a.utcDate.endOf('day');
  const isActive = hasTime && now >= a.utcDate && now <= eventEnd;
  const isPrep = !isActive && !!resUrl && !!enlUrl;

  // Create card element
  const anomalyEl = document.createElement("div");
  anomalyEl.className = "anomaly";
  
  // Apply border styling
  applyBorderClass(anomalyEl, isActive, winner, isPrep);

  // Build HTML content
  anomalyEl.innerHTML = buildAnomalyHTML(a, {
    resUrl, enlUrl, pageUrl, eventLocal, userLocal, hasTime, isPast
  });

  // Setup countdown if applicable
  const countdownEl = anomalyEl.querySelector('.countdown');
  const startPassed = now >= a.utcDate;
  
  if (startPassed) {
    displayWinner(countdownEl, winner);
  } else {
    setupCountdown(countdownEl, a.utcDate, isActive);
  }

  return anomalyEl;
}

/**
 * Applies appropriate border class based on anomaly state
 */
function applyBorderClass(element, isActive, winner, isPrep) {
  if (isActive) {
    element.classList.add('border-active');
  } else if (winner === 'resistance') {
    element.classList.add('border-res');
  } else if (winner === 'enlightened') {
    element.classList.add('border-enl');
  } else if (isPrep) {
    element.classList.add('border-prep');
  } else {
    element.classList.add('border-default');
  }
}

/**
 * Builds the HTML content for an anomaly card
 */
function buildAnomalyHTML(a, { resUrl, enlUrl, pageUrl, eventLocal, userLocal, hasTime, isPast }) {
  const cityCountry = `${escapeHtml(a.city)}, ${escapeHtml(a.country)}`;
  const locationHTML = pageUrl 
    ? `<a href="${pageUrl}" target="_blank" rel="noopener noreferrer">${cityCountry}</a>`
    : cityCountry;

  const validBadges = validateSeriesLogos(a["series-logos"]);
  const badgesHTML = validBadges.length
    ? `<div class="series-badges">
         ${validBadges.map(name => 
           `<img src="img/${escapeHtml(name)}" alt="${escapeHtml(a.series)} badge" class="series-badge">`
         ).join("")}
       </div>`
    : "";

  const timeHTML = hasTime
    ? isPast
      ? `<div class="local-time">${eventLocal.toLocaleString(DateTime.DATE_MED_WITH_WEEKDAY)}</div>`
      : `<div class="local-time">${eventLocal.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)}</div>
         <div class="user-time">${userLocal.toLocaleString(DateTime.DATETIME_MED_WITH_WEEKDAY)} 
         <span class="tz-label">(${DateTime.local().zoneName})</span></div>`
    : `<div class="local-time">${eventLocal.toLocaleString(DateTime.DATE_FULL)}</div>`;

  const resLogoHTML = resUrl 
    ? `<a href="${resUrl}" target="_blank" rel="noopener noreferrer">
         <img src="${resUrl.endsWith('.webp') ? resUrl : '../img/resistance.webp'}" 
              alt="Resistance Logo" class="faction-logo">
       </a>` 
    : "";

  const enlLogoHTML = enlUrl 
    ? `<a href="${enlUrl}" target="_blank" rel="noopener noreferrer">
         <img src="${enlUrl.endsWith('.webp') ? enlUrl : '../img/enlightened.webp'}" 
              alt="Enlightened Logo" class="faction-logo">
       </a>` 
    : "";

  const countdownId = `cd-${a.series.replace(/[^a-zA-Z0-9_-]+/g,'')}-${a.city.replace(/[^a-zA-Z0-9_-]+/g,'')}`;

  return `
    <div class="anomaly-inner">
      <div class="side res-side">${resLogoHTML}</div>
      <div class="center-content">
        <h2 class="location">${locationHTML}</h2>
        <div class="series-block">
          <div class="series">${escapeHtml(a.series)}</div>
          ${badgesHTML}
        </div>
        <div class="time-info">${timeHTML}</div>
        <div class="countdown" id="${countdownId}"></div>
      </div>
      <div class="side enl-side">${enlLogoHTML}</div>
    </div>
  `;
}

/**
 * Displays winner text in countdown element
 */
function displayWinner(element, winner) {
  if (winner === 'resistance' || winner === 'enlightened') {
    element.textContent = winner.toUpperCase();
    element.classList.add(winner === 'resistance' ? 'res' : 'enl');
  }
}

/**
 * Sets up a countdown timer
 */
function setupCountdown(element, targetDate, isActive) {
  const tick = () => {
    const nowUtc = DateTime.utc();
    const diff = targetDate.diff(nowUtc, ['seconds']);
    
    if (diff.valueOf() <= 0 && !isActive) {
      return;
    }
    
    const totalSeconds = Math.floor(diff.as('seconds'));
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
    
    element.textContent = `in ${display}`;
  };
  
  tick();
  const interval = setInterval(tick, 1000);
  activeIntervals.add(interval);
}

// Cleanup on page unload
window.addEventListener('unload', clearAllIntervals);

// Initialize
loadAnomalies();