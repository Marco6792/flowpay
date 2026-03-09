import { User, UserSettings } from '@prisma/client';
import { prisma } from '../utils/database.ts';
import bcrypt from 'bcrypt';

export interface UserCreateInput {
  email: string;
  password: string;
  businessName: string;
  phoneNumber?: string;
}

export interface UserUpdateInput {
  email?: string;
  businessName?: string;
  phoneNumber?: string;
  isVerified?: boolean;
}

export interface UserWithSettings extends User {
  settings: UserSettings | null;
}

export class UserModel {
  /**
   * Create a new user
   */
  static async create(data: UserCreateInput): Promise<User> {
    const hashedPassword = await bcrypt.hash(data.password, 10);

    return prisma.user.create({
      data: {
        email: data.email,
        username: data.email.split('@')[0], // Use email prefix as username
        passwordHash: hashedPassword,
        businessName: data.businessName,
        phoneNumber: data.phoneNumber,
        settings: {
          create: {
            webhookUrl: null,
            webhookSecret: null,
            notificationEmail: data.email,
            enableEmail: true,
            enableSMS: false,
            timezone: 'Africa/Douala',
          },
        },
      },
    });
  }

  /**
   * Find user by ID
   */
  static async findById(id: string): Promise<UserWithSettings | null> {
    return prisma.user.findUnique({
      where: { id },
      include: { settings: true },
    });
  }

  /**
   * Find user by email
   */
  static async findByEmail(email: string): Promise<User | null> {
    return prisma.user.findUnique({
      where: { email },
    });
  }

  /**
   * Update user
   */
  static async update(id: string, data: UserUpdateInput): Promise<User> {
    return prisma.user.update({
      where: { id },
      data,
    });
  }

  /**
   * Verify user password
   */
  static async verifyPassword(user: User, password: string): Promise<boolean> {
    return bcrypt.compare(password, user.passwordHash);
  }

  /**
   * Update password
   */
  static async updatePassword(id: string, newPassword: string): Promise<User> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    return prisma.user.update({
      where: { id },
      data: { passwordHash: hashedPassword },
    });
  }

  /**
   * List all users (admin only)
   */
  static async list(limit = 100, offset = 0): Promise<User[]> {
    return prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      skip: offset,
    });
  }

  /**
   * Count users
   */
  static async count(): Promise<number> {
    return prisma.user.count();
  }

  /**
   * Delete user (soft delete)
   */
  static async delete(id: string): Promise<User> {
    // First deactivate all API keys
    await prisma.apiKey.updateMany({
      where: { userId: id },
      data: { isActive: false },
    });

    // Mark user as deleted
    return prisma.user.update({
      where: { id },
      data: {
        isVerified: false,
        email: `deleted_${Date.now()}_${id}@deleted.com`,
      },
    });
  }

  /**
   * Get user statistics
   */
  static async getStats(userId: string): Promise<{
    totalApiKeys: number;
    activeApiKeys: number;
    totalPayments: number;
    totalRevenue: number;
  }> {
    const [apiKeys, activeApiKeys, payments] = await Promise.all([
      prisma.apiKey.count({ where: { userId } }),
      prisma.apiKey.count({ where: { userId, isActive: true } }),
      prisma.payment.findMany({
        where: {
          apiKey: { userId },
          status: 'COMPLETED',
        },
        select: { amount: true },
      }),
    ]);

    const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);

    return {
      totalApiKeys: apiKeys,
      activeApiKeys,
      totalPayments: payments.length,
      totalRevenue,
    };
  }
}
