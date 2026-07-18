/**
 * countdown.js - Refactored to use shared utilities
 * Displays upcoming Ingress anomalies with countdown timers
 */

import {
  DateTime,
  CONFIG,
  escapeHtml,
  sanitizeUrl,
  validateSeriesLogos,
  loadAnomalyData,
  filterUpcomingAnomalies
} from './shared-utils.js';

// Active intervals for cleanup
let activeIntervals = new Set();

/**
 * Clears all active countdown intervals
 */
function clearAllIntervals() {
  activeIntervals.forEach(interval => clearInterval(interval));
  activeIntervals.clear();
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
    // Load data using shared utility
    const anomalies = await loadAnomalyData(true); // true = include test mode
    
    // Filter to upcoming events using shared utility
    const upcoming = filterUpcomingAnomalies(anomalies);

    cachedAnomalies = upcoming;
    renderedSignature = computeStateSignature(upcoming);
    renderAnomalies(upcoming, container, errorEl);

  } catch (err) {
    errorEl.textContent = `Failed to load anomalies: ${err.message}`;
    console.error('Error loading anomalies:', err);
  }
}

/**
 * Renders all anomalies to the DOM
 */
function renderAnomalies(anomalies, container, errorEl) {
  clearAllIntervals();
  container.innerHTML = "";
  errorEl.textContent = "";

  if (!anomalies.length) {
    errorEl.textContent = "No upcoming or current anomalies found.";
    return;
  }

  let previousSeries = null;
  
  anomalies.forEach((anomaly, index) => {
    try {
      if (anomaly.series !== previousSeries) {
        if (index > 0) {
          const hr = document.createElement('div');
          hr.className = 'series-break';
          container.appendChild(hr);
        }
        container.appendChild(createSeriesHeading(anomaly));
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
 * Creates the h2 series heading for a group of anomaly cards
 */
function createSeriesHeading(anomaly) {
  const heading = document.createElement('h2');
  heading.className = 'series-heading';

  const detailsUrl = sanitizeUrl(anomaly["series-details"]);
  const nameEl = document.createElement(detailsUrl ? 'a' : 'span');
  if (detailsUrl) {
    nameEl.href = detailsUrl;
    nameEl.target = '_blank';
    nameEl.rel = 'noopener noreferrer';
  }
  nameEl.textContent = anomaly.series;
  heading.appendChild(nameEl);

  const validLogos = validateSeriesLogos(anomaly["series-logos"]);
  if (validLogos.length) {
    const badgesEl = document.createElement('div');
    badgesEl.className = 'series-badges';
    validLogos.forEach(name => {
      const img = document.createElement('img');
      img.src = `img/${name}`;
      img.alt = `${anomaly.series} badge`;
      img.className = 'series-badge';
      badgesEl.appendChild(img);
    });
    heading.appendChild(badgesEl);
  }

  return heading;
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

  // Sanitize URLs using shared utility
  const resUrl = sanitizeUrl(a["url-res"]);
  const enlUrl = sanitizeUrl(a["url-enl"]);
  const pageUrl = sanitizeUrl(a.url);
  const winner = (a.winner || "").toLowerCase();

  // Calculate timing
  const eventEnd = hasTime 
    ? a.utcDate.plus({ hours: CONFIG.EVENT_DURATION_HOURS }) 
    : a.utcDate.endOf('day');
  const isActive = hasTime && now >= a.utcDate && now <= eventEnd;
  const hoursUntil = a.utcDate.diff(now, 'hours').hours;
  const isImminent = hasTime && !isActive && hoursUntil > 0
    && hoursUntil <= CONFIG.IMMINENT_WINDOW_HOURS;

  // Create card element
  const anomalyEl = document.createElement("div");
  anomalyEl.className = "anomaly";

  // Apply border styling
  applyBorderClass(anomalyEl, isActive, isImminent, winner, resUrl, enlUrl);

  // Build HTML content
  anomalyEl.innerHTML = buildAnomalyHTML(a, {
    resUrl, enlUrl, pageUrl, eventLocal, userLocal, hasTime, isPast
  });

  if (isActive) {
    const liveBadge = document.createElement('span');
    liveBadge.className = 'live-badge';
    liveBadge.textContent = 'LIVE';
    anomalyEl.appendChild(liveBadge);
  }

  // Setup countdown if applicable
  const countdownEl = anomalyEl.querySelector('.countdown');
  const startPassed = now >= a.utcDate;
  
  if (startPassed) {
    displayWinner(countdownEl, winner, sanitizeUrl(a["series-results"]));
  } else {
    setupCountdown(countdownEl, a.utcDate, isActive);
  }

  return anomalyEl;
}

/**
 * Applies appropriate border class based on anomaly state
 */
function applyBorderClass(element, isActive, isImminent, winner, resUrl, enlUrl) {
  let duration = null;

  if (isActive) {
    element.classList.add('border-active');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-active-duration')) || 2.5;
  } else if (winner === 'resistance') {
    element.classList.add('border-res');
  } else if (winner === 'enlightened') {
    element.classList.add('border-enl');
  } else if (resUrl && enlUrl) {
    element.classList.add('border-prep-both');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-prep-duration')) || 7;
  } else if (resUrl) {
    element.classList.add('border-prep-res');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-res-duration')) || 4;
  } else if (enlUrl) {
    element.classList.add('border-prep-enl');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-enl-duration')) || 4;
  } else {
    element.classList.add('border-default');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-red-duration')) || 3;
  }

  // Modifier: <24h to start accelerates whichever prep animation is present
  if (isImminent) {
    element.classList.add('imminent');
    duration = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--pulse-imminent-duration')) || 3;
  }

  if (duration !== null) {
    const offset = -(Math.random() * duration).toFixed(2);
    element.style.animationDelay = `${offset}s`;
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

  const validBadges = validateSeriesLogos(a["anomaly-badges"]);
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
    ? `<a href="${resUrl}" target="_blank" rel="noopener noreferrer" class="faction-logo-wrapper" data-tooltip="${escapeHtml(resUrl)}">
         <img src="${resUrl.endsWith('.webp') ? resUrl : 'img/resistance.webp'}"
              alt="Resistance Logo" class="faction-logo">
       </a>`
    : `<span class="faction-logo-wrapper" data-tooltip="Resistance team link missing — can you share it?">
         <img src="../img/resistance.webp" alt="Resistance Logo" class="faction-logo faction-logo-missing">
       </span>`;

  const enlLogoHTML = enlUrl
    ? `<a href="${enlUrl}" target="_blank" rel="noopener noreferrer" class="faction-logo-wrapper" data-tooltip="${escapeHtml(enlUrl)}">
         <img src="${enlUrl.endsWith('.webp') ? enlUrl : 'img/enlightened.webp'}"
              alt="Enlightened Logo" class="faction-logo">
       </a>`
    : `<span class="faction-logo-wrapper" data-tooltip="Enlightened team link missing — can you share it?">
         <img src="img/enlightened.webp" alt="Enlightened Logo" class="faction-logo faction-logo-missing">
       </span>`;

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
 * Displays winner text in countdown element, linked to results page if available
 */
function displayWinner(element, winner, resultsUrl) {
  if (winner === 'resistance' || winner === 'enlightened') {
    const label = winner.toUpperCase();
    if (resultsUrl) {
      const a = document.createElement('a');
      a.href = resultsUrl;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.textContent = label;
      element.appendChild(a);
    } else {
      element.textContent = label;
    }
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

// Rendered state tracking so cards promote prep → imminent → active
// without a reload if the page is left open
let cachedAnomalies = null;
let renderedSignature = '';

/**
 * Encodes each anomaly's border state (active/imminent/upcoming/no-time)
 * so a change can trigger a re-render
 */
function computeStateSignature(anomalies) {
  const now = DateTime.utc();
  return anomalies.map(a => {
    if (!a.date.includes("T")) return 'n';
    const eventEnd = a.utcDate.plus({ hours: CONFIG.EVENT_DURATION_HOURS });
    if (now >= a.utcDate && now <= eventEnd) return 'a';
    const hoursUntil = a.utcDate.diff(now, 'hours').hours;
    if (hoursUntil > 0 && hoursUntil <= CONFIG.IMMINENT_WINDOW_HOURS) return 'i';
    return 'u';
  }).join('');
}

setInterval(() => {
  if (!cachedAnomalies) return;
  const signature = computeStateSignature(cachedAnomalies);
  if (signature !== renderedSignature) {
    renderedSignature = signature;
    renderAnomalies(
      cachedAnomalies,
      document.getElementById('anomalyList'),
      document.getElementById('error')
    );
  }
}, 30000);

// Cleanup on page unload
window.addEventListener('unload', clearAllIntervals);

// Initialize
loadAnomalies();