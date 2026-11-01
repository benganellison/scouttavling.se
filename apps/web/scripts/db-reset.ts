/** DEV ONLY: drops and recreates the public schema, so the migrations then run on an empty database. */
import postgres from 'postgres';

const url = process.env.DATABASE_URL!;
if (!/127\.0\.0\.1|localhost/.test(url)) throw new Error('db:reset refuses to run against a non-local database');
const sql = postgres(url, { max: 1 });
await sql.unsafe('drop schema public cascade; create schema public;');
console.log('schema reset');
await sql.end();
