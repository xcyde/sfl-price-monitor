import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import sql from './index';

const migrationsDir = join(__dirname, 'migrations');

export async function migrate() {
  await sql`CREATE TABLE IF NOT EXISTS migrations (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    executed_at TIMESTAMP DEFAULT NOW()
  )`;

  const files = await readdir(migrationsDir);
  const sqlFiles = files.filter(file => file.endsWith('.sql')).sort();

  const executedMigrations = await sql`SELECT name FROM migrations`;
  const executedMigrationNames = executedMigrations.map(row => row.name);

  const pendingMigrations = sqlFiles.filter(file => !executedMigrationNames.includes(file));

  for (const file of pendingMigrations) {
    const filePath = join(migrationsDir, file);
    const sqlContent = await readFile(filePath, 'utf-8');

    await sql.begin(sql => [
      sql.unsafe(sqlContent),
      sql`INSERT INTO migrations (name) VALUES (${file})`,
    ]);
    // await sql.unsafe(sqlContent);
    // await sql`INSERT INTO migrations (name) VALUES (${file})`;
    console.log(`Executed migration: ${file}`);
  }
}
