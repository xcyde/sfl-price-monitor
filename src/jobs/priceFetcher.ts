import cron from 'node-cron';
import { fetchPrices } from '../modules/prices/pricesFetcher';
import { savePrices } from '../modules/prices/pricesRepository';

export async function runPriceFetch(): Promise<void> {
  const entries = await fetchPrices();
  await savePrices(entries);
  console.log(`[priceFetcher] saved ${entries.length} prices`);
}

export function startPriceFetcherCron(): void {
  cron.schedule('*/15 * * * *', async () => {
    try {
      await runPriceFetch();
    } catch (err) {
      console.error('[priceFetcher] failed:', err);
    }
  });
}
