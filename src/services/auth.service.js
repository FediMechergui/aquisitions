import logger from '#config/logger.js';
import bcrypt from 'bcryptjs';
import { db } from '#config/database.js';
import { users } from '#models/user.module.js';
import { eq } from 'drizzle-orm';

export const hashPassword = async (password) => {
  try {
    return await bcrypt.hash(password, 10);
  } catch (e) {
    logger.error('Error hashing password:', e);
    throw new Error('Password hashing failed');
  }
};

export const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (e) {
    logger.error('Error comparing password:', e);
    throw new Error('Password comparison failed');
  }
};

export const createUser = async ({ name, email, password, role = 'user' }) => {
  try {
    const existingUser = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (existingUser.length > 0) {
      throw new Error('User with this email already exists');
    }

    const password_hash = await hashPassword(password);
    const [newUser] = await db
      .insert(users)
      .values({
        name,
        email,
        password: password_hash,
        role,
      })
      .returning({
        id: users.id,
        name: users.name,
        email: users.email,
        role: users.role,
        created_at: users.created_at,
      });

    logger.info(`Created new user: ${email} with role: ${role}`);
    return newUser;
  } catch (e) {
    logger.error('Error creating user:', e);
    if (e.message === 'User with this email already exists') {
      throw e;
    }
    throw new Error(`User creation failed: ${e.message}`);
  }
};

export const authenticateUser = async ({ email, password }) => {
  try {
    const [user] = await db
      .select()
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user) {
      throw new Error('Invalid email or password');
    }

    const isMatch = await comparePassword(password, user.password);

    if (!isMatch) {
      throw new Error('Invalid email or password');
    }

    logger.info(`Authenticated user: ${email}`);
    return user;
  } catch (e) {
    logger.error('Error authenticating user:', e);
    throw e;
  }
};
