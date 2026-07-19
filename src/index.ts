import 'dotenv/config';
import { migrate } from './db/migrate';
import { startPriceFetcherCron } from './jobs/priceFetcher';

async function main() {
  await migrate();
  console.log('Database migration completed successfully.');

  startPriceFetcherCron();
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
