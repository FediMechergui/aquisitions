import { z } from 'zod';

export const signupSchema = z.object({
  name: z.string().max(255).trim(),
  email: z.email().toLowerCase().max(255).trim(),
  password: z.string().min(6).max(128),
  role: z.enum(['user', 'admin']).default('user')
});

export const signinSchema = z.object({
  email: z.email().toLowerCase().trim(),
  password: z.string().min(1),
});