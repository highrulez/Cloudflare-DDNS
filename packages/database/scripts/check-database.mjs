import mariadb from 'mariadb';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('MariaDB connectivity check failed: DATABASE_URL is not set');
  process.exit(2);
}

let connection;

try {
  const url = new URL(databaseUrl);
  if (url.protocol !== 'mysql:') {
    throw new Error('DATABASE_URL must use the mysql protocol');
  }

  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!database) {
    throw new Error('DATABASE_URL must include a database name');
  }

  connection = await mariadb.createConnection({
    host: url.hostname,
    port: Number(url.port || 3306),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    database,
    connectTimeout: 5_000,
    socketTimeout: 5_000
  });

  await connection.query('SELECT 1');
  console.log(
    `MariaDB connectivity check succeeded for ${url.hostname}:${url.port || '3306'}/${database}`
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`MariaDB connectivity check failed: ${message}`);
  process.exitCode = 1;
} finally {
  await connection?.end();
}
