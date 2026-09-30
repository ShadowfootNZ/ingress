window.INGRESS_BOUNTY_CAMPAIGNS = [
  {
    slug: "cygnus",
    name: "Cygnus",
    title: "Ingress Cygnus",
    subtitle: "Progress using remaining Daily Bounties",
    tokenLabel: "Cygnus Tokens",
    dailySourceLabel: "Daily Bounties",
    inputLabel: "Total Cygnus Tokens",
    startDate: "2026-10-01",
    endDate: "2026-12-31",
    dailyBonusTokens: 60,
    dailyRateLabel: "60 Cygnus Tokens/day",
    inputStep: 10,
    tiers: [
      {
        slug: "bronze",
        label: "Bronze",
        threshold: 6000,
        icon: "icons/cygnus-bronze.webp"
      },
      {
        slug: "silver",
        label: "Silver",
        threshold: 12000,
        icon: "icons/cygnus-silver.webp"
      },
      {
        slug: "gold",
        label: "Gold",
        threshold: 24000,
        icon: "icons/cygnus-gold.webp"
      }
    ],
    officialNewsLink: "https://ingress.com/news/2026-cygnus",
    officialNewsLabel: "Cygnus Anomaly Season",
    otherSourcesLink: "http://anomaly.day",
    otherSourcesLabel: "anomaly.day"
  }
];
