window.INGRESS_BOUNTY_CAMPAIGNS = [
  {
    slug: "apollo",
    name: "Apollo",
    title: "Ingress Apollo",
    subtitle: "Bounty bonus progress",
    startDate: "2026-07-01",
    endDate: "2026-09-18",
    dailyBonusTokens: 60,
    dailyRateLabel: "60 bonus tokens/day",
    inputStep: 10,
    tiers: [
      {
        slug: "bronze",
        label: "Bronze",
        threshold: 4000,
        icon: "icons/apollo-bronze.webp"
      },
      {
        slug: "silver",
        label: "Silver",
        threshold: 8000,
        icon: "icons/apollo-silver.webp"
      },
      {
        slug: "gold",
        label: "Gold",
        threshold: 16000,
        icon: "icons/apollo-gold.webp"
      }
    ],
    officialNewsLink: "https://ingress.com/news/2026-apollo",
    officialNewsLabel: "Apollo Anomaly Season",
    otherSourcesLink: "http://anomaly.day",
    otherSourcesLabel: "anomaly.day"
  }
];
