import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  // Create a test user first
  const hashedPassword = await bcrypt.hash('testpassword123', 10);

  const testUser = await prisma.user.upsert({
    where: { email: 'test@flowpay.cm' },
    update: {},
    create: {
      email: 'test@flowpay.cm',
      username: 'testuser',
      passwordHash: hashedPassword,
      businessName: 'Test Business',
      isVerified: true,
    },
  });

  console.log('Test User created:', testUser.email);

  // Create test API key for the user
  const testApiKey = await prisma.apiKey.upsert({
    where: { key: 'test_key_flowpay_dev_2025' },
    update: {},
    create: {
      key: 'test_key_flowpay_dev_2025',
      name: 'Development Test Key',
      userId: testUser.id,
      isActive: true,
    },
  });

  console.log('✅ Seed completed');
  console.log('Test API Key:', testApiKey.key);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
