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

import { migrate } from './db/migrate';
import { startPriceFetcherCron } from './jobs/priceFetcher';
import { pricesRoutes } from './api/routes/prices';
import { authRoutes } from './api/routes/auth';
import { env } from './config/env';

async function main() {
  await migrate();
  console.log('Database migration completed successfully.');

  startPriceFetcherCron();

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

  // TODO(security, до прода): /docs открыт всем и показывает поле x-bot-secret.
  // Перед деплоем — выключить Swagger UI в проде (или закрыть за авторизацией),
  // чтобы секрет бота не светился в браузере. См. также loginHeadersSchema.
  await app.register(swaggerUi, {
    routePrefix: '/docs',
  });

  await app.register(authRoutes, { prefix: '/api/auth' });
  await app.register(pricesRoutes, { prefix: '/api/prices' });

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
