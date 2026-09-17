import '@fastify/jwt';

/**
 * Module augmentation для @fastify/jwt.
 *
 * Сам плагин уже добавляет `app.jwt`, `request.jwtVerify()`, `request.user`
 * и т.п. в типы Fastify. Здесь мы уточняем ФОРМУ данных токена:
 *  - payload — что мы кладём в jwt.sign(...)
 *  - user    — что окажется в request.user после успешной проверки токена
 *
 * Благодаря этому TypeScript будет знать поля userId / telegramId
 * без каких-либо кастов (в отличие от временного демо-плагина).
 */
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: { userId: number; telegramId: string };
    user: { userId: number; telegramId: string };
  }
}
