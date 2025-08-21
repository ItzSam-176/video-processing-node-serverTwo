module.exports = {
  thresholds: {
    porn: parseFloat(process.env.THRESHOLD_PORN || "0.6"),
    sexy: parseFloat(process.env.THRESHOLD_SEXY || "0.8"),
    hentai: parseFloat(process.env.THRESHOLD_HENTAI || "0.7"),
  },
  strictnessLevels: {
    strict: { porn: 0.4, sexy: 0.6, hentai: 0.5 },
    moderate: { porn: 0.6, sexy: 0.8, hentai: 0.7 },
    lenient: { porn: 0.8, sexy: 0.9, hentai: 0.85 },
  },
};
