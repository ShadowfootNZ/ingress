(function () {
  const campaigns = window.INGRESS_BOUNTY_CAMPAIGNS || [];
  const msPerDay = 1000 * 60 * 60 * 24;
  const STORAGE_KEY = "ingress-bounty-progress-last-score";

  const elements = {
    card: document.getElementById("progressCard"),
    campaignTitle: document.getElementById("campaignTitle"),
    campaignSubtitle: document.getElementById("campaignSubtitle"),
    dailySourceLabel: document.getElementById("dailySourceLabel"),
    dailyRate: document.getElementById("dailyRate"),
    daysRemaining: document.getElementById("daysRemaining"),
    remainingTokens: document.getElementById("remainingTokens"),
    remainingTokenLabel: document.getElementById("remainingTokenLabel"),
    startDateSection: document.getElementById("startDateSection"),
    startDateDisplay: document.getElementById("startDateDisplay"),
    endDateDisplay: document.getElementById("endDateDisplay"),
    score: document.getElementById("score"),
    calculateButton: document.getElementById("calculateButton"),
    result: document.getElementById("result"),
    infoLink: document.getElementById("infoLink")
  };

  let activeCampaign = null;

  function parseDate(value, endOfDay) {
    const suffix = endOfDay ? "T23:59:59" : "T00:00:00";
    return new Date(`${value}${suffix}`);
  }

  function formatDate(date) {
    return date.toLocaleDateString(undefined, {
      day: "2-digit",
      month: "short",
      year: "numeric"
    });
  }

  function formatNumber(value) {
    return value.toLocaleString();
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function daysBetweenInclusiveUTC(start, end) {
    const startUTC = Date.UTC(start.getFullYear(), start.getMonth(), start.getDate());
    const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((endUTC - startUTC) / msPerDay) + 1);
  }

  function daysRemainingFromTodayUTC(today, end) {
    const todayUTC = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const endUTC = Date.UTC(end.getFullYear(), end.getMonth(), end.getDate());
    return Math.max(0, Math.floor((endUTC - todayUTC) / msPerDay));
  }

  function getCurrentCampaign() {
    return campaigns[0];
  }

  function removeSavedScore() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage may be unavailable in private browsing or restricted contexts.
    }
  }

  function saveScore(rawValue) {
    if (rawValue === "") {
      removeSavedScore();
      return;
    }

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        campaign: activeCampaign.slug,
        score: rawValue
      }));
    } catch {
      // The calculator still works when storage is unavailable.
    }
  }

  function loadSavedScore(campaign) {
    let savedValue;

    try {
      savedValue = localStorage.getItem(STORAGE_KEY);
    } catch {
      return "";
    }

    if (!savedValue) return "";

    try {
      const saved = JSON.parse(savedValue);
      const scoreIsValid = typeof saved?.score === "string" || typeof saved?.score === "number";

      if (saved?.campaign === campaign.slug && scoreIsValid) {
        return String(saved.score);
      }
    } catch {
      // Legacy values were stored as an unscoped score and must not carry over.
    }

    removeSavedScore();
    return "";
  }

  function renderIcon(tier) {
    if (!tier.icon) {
      return `<span class="tier-fallback" aria-hidden="true">${escapeHtml(tier.label.slice(0, 2).toUpperCase())}</span>`;
    }

    return `<img class="target-icon" src="${escapeHtml(tier.icon)}" alt="${escapeHtml(tier.label)} icon">`;
  }

  function renderInfoLink(campaign) {
    if (!campaign.officialNewsLink) {
      elements.infoLink.innerHTML = "";
      return;
    }

    const officialLink = `<a href="${escapeHtml(campaign.officialNewsLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(campaign.officialNewsLabel || "official overview")}</a>`;

    if (!campaign.otherSourcesLink) {
      elements.infoLink.innerHTML = `See ${officialLink} for other sources.`;
      return;
    }

    const otherSourcesLink = `<a href="${escapeHtml(campaign.otherSourcesLink)}" target="_blank" rel="noopener noreferrer">${escapeHtml(campaign.otherSourcesLabel || campaign.otherSourcesLink)}</a>`;
    elements.infoLink.innerHTML = `See ${officialLink} or ${otherSourcesLink} for other sources.`;
  }

  function updateTierGlow(score) {
    const tierClasses = campaigns
      .flatMap((campaign) => campaign.tiers.map((tier) => tier.slug))
      .filter((slug, index, values) => values.indexOf(slug) === index);

    elements.card.classList.remove(...tierClasses);

    const achieved = [...activeCampaign.tiers]
      .reverse()
      .find((tier) => score >= tier.threshold);

    if (achieved) {
      elements.card.classList.add(achieved.slug);
    }
  }

  function calculate() {
    if (!activeCampaign) return;

    const rawValue = elements.score.value.trim();
    saveScore(rawValue);

    const score = Math.max(0, parseInt(rawValue, 10) || 0);
    const startDate = parseDate(activeCampaign.startDate, false);
    const endDate = parseDate(activeCampaign.endDate, true);
    const today = new Date();
    const campaignHasStarted = today >= startDate;

    const daysLeft = campaignHasStarted
      ? daysRemainingFromTodayUTC(today, endDate)
      : daysBetweenInclusiveUTC(startDate, endDate);

    const availableTokens = daysLeft * activeCampaign.dailyBonusTokens;

    elements.daysRemaining.textContent = formatNumber(daysLeft);
    elements.remainingTokens.textContent = formatNumber(availableTokens);
    elements.startDateDisplay.textContent = formatDate(startDate);
    elements.endDateDisplay.textContent = formatDate(endDate);
    elements.startDateSection.style.display = campaignHasStarted ? "none" : "inline";

    const targetItems = activeCampaign.tiers.map((tier) => {
      const tokensNeeded = tier.threshold - score;
      const threshold = formatNumber(tier.threshold);
      const icon = renderIcon(tier);

      if (tokensNeeded <= 0) {
        return `<li>${icon}<div class="tier-label">${escapeHtml(tier.label.toUpperCase())} (${threshold}): <span class="checkmark">&#10003;</span></div></li>`;
      }

      const daysNeeded = Math.ceil(tokensNeeded / activeCampaign.dailyBonusTokens);
      const daysClass = daysNeeded > daysLeft ? " class=\"warn\"" : "";

      return `<li>
        ${icon}
        <div class="tier-label">
          ${escapeHtml(tier.label.toUpperCase())} (${threshold}):
          <span class="warn">${formatNumber(tokensNeeded)}</span> tokens short
          <span${daysClass}>(${formatNumber(daysNeeded)} days)</span>
        </div>
      </li>`;
    }).join("");

    elements.result.innerHTML = `<h3>Targets</h3><ul>${targetItems}</ul>`;
    updateTierGlow(score);
  }

  function loadCampaign() {
    activeCampaign = getCurrentCampaign();
    elements.campaignTitle.textContent = activeCampaign.title;
    elements.campaignSubtitle.textContent = activeCampaign.subtitle;
    elements.dailySourceLabel.textContent = activeCampaign.dailySourceLabel || "Daily Bounties";
    elements.dailyRate.textContent = activeCampaign.dailyRateLabel || `${formatNumber(activeCampaign.dailyBonusTokens)} ${activeCampaign.tokenLabel || "tokens"}/day`;
    elements.remainingTokenLabel.textContent = activeCampaign.tokenLabel || "tokens";
    elements.score.step = activeCampaign.inputStep || 1;
    elements.score.placeholder = activeCampaign.inputLabel || `Total ${activeCampaign.tokenLabel || "tokens"}`;
    elements.score.value = loadSavedScore(activeCampaign);

    renderInfoLink(activeCampaign);

    calculate();
  }

  function init() {
    if (campaigns.length === 0) {
      elements.result.textContent = "No campaigns configured.";
      return;
    }

    loadCampaign();

    elements.calculateButton.addEventListener("click", calculate);

    elements.score.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        calculate();
      }
    });

    elements.score.addEventListener("input", calculate);
  }

  window.addEventListener("DOMContentLoaded", init);
})();
