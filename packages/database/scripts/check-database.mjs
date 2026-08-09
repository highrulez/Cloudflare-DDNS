import mariadb from "mariadb";

const url = new URL(process.env.DATABASE_URL);
const connection = await mariadb.createConnection({
  host: url.hostname,
  port: Number(url.port || 3306),
  user: decodeURIComponent(url.username),
  password: decodeURIComponent(url.password),
  database: url.pathname.slice(1),
  connectTimeout: Number(process.env.DATABASE_CONNECT_TIMEOUT_MS || 5000),
});

try {
  await connection.query({ sql: "SELECT 1", timeout: Number(process.env.DATABASE_QUERY_TIMEOUT_MS || 10000) });
} finally {
  await connection.end();
}
