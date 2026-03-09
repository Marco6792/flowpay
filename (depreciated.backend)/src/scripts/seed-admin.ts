#!/usr/bin/env node
/**
 * Script to seed an admin user
 * Run: npx tsx src/scripts/seed-admin.ts
 */

import bcrypt from 'bcrypt';
import { prisma } from '../utils/database.ts';
import { logger } from '../utils/logger.ts';

async function seedAdmin() {
  try {
    const adminEmail = 'admin@flowpay.com';
    const adminUsername = 'superadmin';
    const adminPassword = 'Admin@123456'; // Change this in production!

    // Check if admin already exists
    const existingAdmin = await prisma.user.findUnique({
      where: { email: adminEmail },
    });

    if (existingAdmin) {
      if (existingAdmin.role !== 'SUPER_ADMIN' && existingAdmin.role !== 'ADMIN') {
        // Update existing user to admin
        const updated = await prisma.user.update({
          where: { email: adminEmail },
          data: {
            role: 'SUPER_ADMIN',
            isVerified: true,
          },
        });

        console.log('✅ Existing user upgraded to SUPER_ADMIN:', {
          id: updated.id,
          email: updated.email,
          role: updated.role,
        });
      } else {
        console.log('ℹ️ Admin user already exists:', {
          id: existingAdmin.id,
          email: existingAdmin.email,
          role: existingAdmin.role,
        });
      }
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(adminPassword, 10);

    // Create super admin user
    const admin = await prisma.user.create({
      data: {
        email: adminEmail,
        username: adminUsername,
        passwordHash,
        businessName: 'FlowPay Administration',
        businessType: 'ADMIN',
        phoneNumber: '+237600000000',
        country: 'CM',
        role: 'SUPER_ADMIN',
        isVerified: true,
        kycStatus: 'APPROVED',
        tier: 'ENTERPRISE',
      },
    });

    console.log('✅ Super Admin created successfully!');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('📧 Email:', adminEmail);
    console.log('👤 Username:', adminUsername);
    console.log('🔑 Password:', adminPassword);
    console.log('🆔 User ID:', admin.id);
    console.log('🏷️  Role:', admin.role);
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    console.log('🔐 Login at: http://localhost:5000/api/v1/admin/auth/login');
    console.log('');
    console.log('⚠️  IMPORTANT: Change the password in production!');

  } catch (error) {
    console.error('❌ Error seeding admin:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

// Run the seed
seedAdmin();
