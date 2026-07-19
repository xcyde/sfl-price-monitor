import postgres from 'postgres'
import { env } from '../config/env';

const sql = postgres(env.DATABASE_URL);

export default sql;
