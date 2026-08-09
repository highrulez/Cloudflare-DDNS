import 'dotenv/config';
import { db } from '@ddns/database';

try {
  await db.ipDetectionRun.findFirst({
    select: {
      id: true,
      ipv4Status: true,
      ipv6Status: true
    }
  });
  process.stdout.write('Prisma schema verification passed\n');
} finally {
  await db.$disconnect();
}
