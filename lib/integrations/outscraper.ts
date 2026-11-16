export function outscraperConfigured() {
  return Boolean(process.env.OUTSCRAPER_API_KEY?.trim());
}
