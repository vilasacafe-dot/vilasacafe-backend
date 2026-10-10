import { z } from 'zod';

export const COLLEGES = ['SRM UNIVERSITY AP', 'VIT AP', 'AMRITA AP'];
const phoneRegex = /^[6-9][0-9]{9}$/;

export const profileSchema = z.object({
  full_name: z.string().trim().min(2, 'Please enter your full name.').max(80),
  phone: z.string().trim().regex(phoneRegex, 'Enter a valid 10-digit Indian mobile number.'),
  college: z.enum(COLLEGES, { errorMap: () => ({ message: 'Select a valid college.' }) }),
});

const uuid = z.string().uuid('Invalid id.');

export const cartItemSchema = z.object({
  product_id: uuid,
  quantity: z.number().int().positive().max(50),
});

export const couponPreviewSchema = z.object({
  code: z.string().trim().min(1, 'Enter a coupon code.').max(40),
  items: z.array(cartItemSchema).min(1, 'Your cart is empty.'),
});

export const placeOrderSchema = z.object({
  items: z.array(cartItemSchema).min(1, 'Your cart is empty.'),
  coupon_code: z.string().trim().max(40).optional().nullable(),
  notes: z.string().trim().max(300).optional().nullable(),
  idempotency_key: z.string().trim().min(8).max(100),
});

export const categorySchema = z.object({
  name: z.string().trim().min(1).max(60),
  slug: z.string().trim().min(1).max(60).regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, numbers and dashes.'),
  is_active: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

export const productSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().trim().max(600).optional().nullable(),
  price: z.number().nonnegative().max(100000),
  category_id: uuid.optional().nullable(),
  is_available: z.boolean().optional(),
  is_featured: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
  image_key: z.string().optional().nullable(),
  image_url: z.string().url().optional().nullable(),
});

export const couponSchema = z.object({
  code: z.string().trim().min(2).max(40),
  description: z.string().trim().max(200).optional().nullable(),
  discount_type: z.enum(['percentage', 'fixed']),
  discount_value: z.number().positive(),
  min_order_value: z.number().nonnegative().optional(),
  max_discount: z.number().positive().optional().nullable(),
  target: z.enum(['all', 'category', 'product']),
  starts_at: z.string().datetime().optional(),
  expires_at: z.string().datetime().optional().nullable(),
  repeat_daily: z.boolean().optional(),
  // Daily cutoff time "HH:MM" or "HH:MM:SS" (interpreted in Asia/Kolkata).
  daily_until: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/, 'Enter a valid time (HH:MM).')
    .optional()
    .nullable(),
  is_active: z.boolean().optional(),
  usage_limit: z.number().int().positive().optional().nullable(),
  per_user_limit: z.number().int().positive().optional().nullable(),
  category_ids: z.array(uuid).optional(),
  product_ids: z.array(uuid).optional(),
}).refine(
  (d) => d.discount_type !== 'percentage' || d.discount_value <= 100,
  { message: 'Percentage discount cannot exceed 100.', path: ['discount_value'] }
).refine(
  (d) => d.target !== 'category' || (d.category_ids && d.category_ids.length > 0),
  { message: 'Select at least one category for this coupon.', path: ['category_ids'] }
).refine(
  (d) => d.target !== 'product' || (d.product_ids && d.product_ids.length > 0),
  { message: 'Select at least one product for this coupon.', path: ['product_ids'] }
);

export const bannerSchema = z.object({
  title: z.string().trim().max(120).optional().nullable(),
  image_key: z.string().min(1),
  image_url: z.string().url(),
  link_url: z.string().url().optional().nullable(),
  is_active: z.boolean().optional(),
  display_order: z.number().int().min(0).optional(),
});

export const statusUpdateSchema = z.object({
  status: z.enum(['ACCEPTED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED']),
});
