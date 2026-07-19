import 'dotenv/config';
import Fastify from 'fastify';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { migrate } from './db/migrate';
import { startPriceFetcherCron } from './jobs/priceFetcher';
import { pricesRoutes } from './api/routes/prices';
import { env } from './config/env';

async function main() {
  await migrate();
  console.log('Database migration completed successfully.');

  startPriceFetcherCron();

  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Sunflower Land Price Monitor API',
        version: '1.0.0',
      },
    },
    transform: jsonSchemaTransform,
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(pricesRoutes, { prefix: '/api/prices' });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
