/**
 * shared-utils.js - Common utilities for countdown and map
 * Import this module to avoid code duplication
 */

// Access luxon DateTime from global scope (loaded via script tag)
const { DateTime } = window.luxon || {};

// Validate luxon is available
if (!DateTime) {
  console.error('Luxon library not loaded. Ensure luxon is loaded before this module.');
}

const CONFIG = {
  SERIES_CUTOFF_MONTHS: 1,
  EVENT_DURATION_HOURS: 3,
  POST_EVENT_DISPLAY_HOURS: 6,
  RECHARGE_RANGE_KM: 4000,
  CACHE_VERSION: '1.0.0'
};

// Reuse single div for HTML escaping
const escapeDiv = document.createElement('div');

/**
 * Escapes HTML special characters efficiently
 */
function escapeHtml(str) {
  escapeDiv.textContent = str;
  return escapeDiv.innerHTML;
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
 * Normalizes date string to ISO format
 */
function normalizeDateString(dateStr) {
  const trimmed = dateStr.trim();
  return trimmed.includes('T') ? trimmed : `${trimmed}T00:00:00`;
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
 * Loads and parses anomaly data from JSON
 * Returns flattened array with DateTime objects attached
 */
async function loadAnomalyData(includeTest = false) {
  if (!DateTime) {
    throw new Error('Luxon DateTime not available');
  }
  
  try {
    const res = await fetch(`anomaly-countdown.json?v=${CONFIG.CACHE_VERSION}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    
    const data = await res.json();
    
    if (!Array.isArray(data)) {
      throw new Error('Invalid anomalies data format');
    }

    // Flatten series structure
    let anomalies = data.flatMap(seriesObj => {
      if (!Array.isArray(seriesObj.sites)) {
        throw new Error(`Invalid sites data for series ${seriesObj.series}`);
      }
      return seriesObj.sites.map(site => ({
        series: seriesObj.series,
        "series-logos": seriesObj["series-logos"] || [],
        "series-results": seriesObj["series-results"] || "",
        "series-details": seriesObj["series-details"] || "",
        "anomaly-badges": seriesObj["anomaly-badges"] || [],
        ...site
      }));
    });

    // Add test anomaly if requested
    if (includeTest) {
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
    }

    // Parse and validate dates in single pass
    return anomalies
      .map(a => {
        if (!a.date || !a.timezone) return null;
        
        const dateStr = normalizeDateString(a.date);
        const localDate = DateTime.fromISO(dateStr, { zone: a.timezone });
        
        if (!localDate.isValid) {
          console.warn(`Invalid DateTime for ${a.city}:`, dateStr, a.timezone, localDate.invalidReason);
          return null;
        }
        
        return { ...a, utcDate: localDate.toUTC() };
      })
      .filter(a => a !== null && a.utcDate);
      
  } catch (err) {
    console.error('Error loading anomaly data:', err);
    throw err;
  }
}

/**
 * Filters anomalies to upcoming events, removing old series
 * More efficient single-pass implementation
 */
function filterUpcomingAnomalies(anomalies, cutoffMonths = CONFIG.SERIES_CUTOFF_MONTHS) {
  if (!DateTime) {
    throw new Error('Luxon DateTime not available');
  }
  
  const now = DateTime.utc();
  const cutoff = now.minus({ months: cutoffMonths });
  
  // Build series latest map
  const seriesLatest = new Map();
  
  for (const a of anomalies) {
    const key = a.series || "(no series)";
    const existing = seriesLatest.get(key);
    
    if (!existing || a.utcDate > existing) {
      seriesLatest.set(key, a.utcDate);
    }
  }
  
  // Filter based on series cutoff
  return anomalies
    .filter(a => {
      const key = a.series || "(no series)";
      const lastUtc = seriesLatest.get(key);
      return !lastUtc || lastUtc >= cutoff;
    })
    .sort((a, b) => a.utcDate.toMillis() - b.utcDate.toMillis());
}

/**
 * Generates a stable color for a series name
 * Avoids blue (190-230°) and green (110-170°) for faction clarity
 */
const seriesColorCache = new Map();

function getSeriesColor(series) {
  if (!seriesColorCache.has(series)) {
    // Generate stable hash
    let hash = 0;
    for (let i = 0; i < series.length; i++) {
      hash = series.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Map to non-faction hue ranges
    const availableRange = 260;
    const hueOffset = Math.abs(hash) % availableRange;
    
    let hue;
    if (hueOffset < 110) {
      hue = hueOffset; // Red to yellow
    } else if (hueOffset < 130) {
      hue = 170 + (hueOffset - 110); // Cyan/teal
    } else {
      hue = 230 + (hueOffset - 130); // Purple to magenta
    }
    
    seriesColorCache.set(series, `hsl(${hue}, 80%, 55%)`);
  }
  
  return seriesColorCache.get(series);
}

// Export for ES modules
export {
  DateTime,
  CONFIG,
  escapeHtml,
  sanitizeUrl,
  normalizeDateString,
  validateSeriesLogos,
  loadAnomalyData,
  filterUpcomingAnomalies,
  getSeriesColor
};

// Also expose globally for non-module scripts
if (typeof window !== 'undefined') {
  window.AnomalyUtils = {
    DateTime,
    CONFIG,
    escapeHtml,
    sanitizeUrl,
    normalizeDateString,
    validateSeriesLogos,
    loadAnomalyData,
    filterUpcomingAnomalies,
    getSeriesColor
  };
}