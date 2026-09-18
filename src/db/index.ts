import postgres from 'postgres'
import { env } from '../config/env.ts';

const sql = postgres(env.DATABASE_URL);

export default sql;
