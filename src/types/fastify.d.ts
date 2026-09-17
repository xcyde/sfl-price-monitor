import 'fastify';
import type { FastifyRequest, FastifyReply } from 'fastify';

/**
 * Декоратор-guard, навешиваемый в index.ts.
 * Используется как preHandler на защищённых роутах:
 *   app.get('/me', { preHandler: [app.authenticate] }, handler)
 * Внутри вызывает request.jwtVerify(): при валидном токене кладёт payload
 * в request.user, при невалидном — отвечает 401 и прерывает цепочку.
 */
declare module 'fastify' {
  interface FastifyInstance {
    authenticate(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
