import 'dotenv/config';
import Fastify from 'fastify';
import fastifyJwt from '@fastify/jwt';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import {
  serializerCompiler,
  validatorCompiler,
  jsonSchemaTransform,
  type ZodTypeProvider,
} from 'fastify-type-provider-zod';

import { migrate } from './db/migrate.ts';
import { startPriceFetcherCron } from './jobs/priceFetcher.ts';
import { createNftFetchJob, startNftFetcherCron } from './jobs/nftFetcher.ts';
import { fetchNfts } from './modules/nfts/nftsFetcher.ts';
import { nftSnapshotRepository } from './modules/nfts/nftsRepository.ts';
import { pricesRoutes } from './api/routes/prices.ts';
import { authRoutes } from './api/routes/auth.ts';
import { env } from './config/env.ts';

async function main() {
  await migrate();
  console.log('Database migration completed successfully.');

  startPriceFetcherCron();

  const nftFetchJob = createNftFetchJob({
    fetchSnapshot: () => fetchNfts(env.NFTS_API_URL),
    repository: nftSnapshotRepository,
    now: () => new Date(),
    logger: console,
  });
  startNftFetcherCron(nftFetchJob);
  nftFetchJob
    .runNftCatchUpIfNeeded()
    .catch((err) => console.error('[nftFetcher] catch-up failed:', err));

  const app = Fastify({ logger: true }).withTypeProvider<ZodTypeProvider>();

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  await app.register(fastifyJwt, {
    secret: env.JWT_SECRET,
    sign: { expiresIn: env.JWT_ACCESS_TTL },
  });

  // Guard для защищённых роутов: проверяет access-токен и кладёт payload
  // в request.user. Декорируем корневой инстанс до регистрации роутов —
  // дочерние плагины (роуты) наследуют декоратор.
  app.decorate('authenticate', async function (request, reply) {
    try {
      await request.jwtVerify();
    } catch {
      reply.code(401).send({ message: 'unauthorized' });
    }
  });

  if (env.ENABLE_SWAGGER) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'Sunflower Land Price Monitor API',
          version: '1.0.0',
        },
        components: {
          securitySchemes: {
            bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
          },
        },
      },
      transform: jsonSchemaTransform,
    });

    await app.register(swaggerUi, {
      routePrefix: '/docs',
    });
  }

  app.get(
    '/health',
    { schema: { hide: true }, logLevel: 'silent' },
    async () => ({ status: 'ok' })
  );

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(pricesRoutes, { prefix: '/api/prices' });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });

  async function shutdown() {
    await app.close();
    process.exit(0);
  }

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
