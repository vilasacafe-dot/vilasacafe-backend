import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { categorySchema } from '../validators/schemas.js';
import { z } from 'zod';

/**
 * Public list — active categories only (for the customer menu).
 */
export const listCategories = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .eq('is_active', true)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new ApiError(500, 'Could not load categories.');
  res.json({ categories: data });
});

/**
 * Admin list — includes inactive categories.
 */
export const listAllCategories = asyncHandler(async (_req, res) => {
  const { data, error } = await supabaseAdmin
    .from('categories')
    .select('*')
    .eq('restaurant_id', env.restaurantId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (error) throw new ApiError(500, 'Could not load categories.');
  res.json({ categories: data });
});

export const createCategory = asyncHandler(async (req, res) => {
  const body = categorySchema.parse(req.body);
  const { data, error } = await supabaseAdmin
    .from('categories')
    .insert({ ...body, restaurant_id: env.restaurantId })
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('A category with that slug already exists.');
    throw new ApiError(500, 'Could not create category.');
  }
  res.status(201).json({ category: data });
});

export const updateCategory = asyncHandler(async (req, res) => {
  const body = categorySchema.partial().parse(req.body);
  const { data, error } = await supabaseAdmin
    .from('categories')
    .update(body)
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .select('*')
    .single();
  if (error) {
    if (error.code === '23505') throw ApiError.conflict('A category with that slug already exists.');
    throw ApiError.notFound('Category not found.');
  }
  res.json({ category: data });
});

export const deleteCategory = asyncHandler(async (req, res) => {
  const { error } = await supabaseAdmin
    .from('categories')
    .delete()
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId);
  if (error) throw new ApiError(500, 'Could not delete category.');
  res.json({ ok: true });
});

const reorderSchema = z.object({
  order: z.array(z.object({ id: z.string().uuid(), display_order: z.number().int().min(0) })).min(1),
});

export const reorderCategories = asyncHandler(async (req, res) => {
  const { order } = reorderSchema.parse(req.body);
  await Promise.all(
    order.map((o) =>
      supabaseAdmin
        .from('categories')
        .update({ display_order: o.display_order })
        .eq('id', o.id)
        .eq('restaurant_id', env.restaurantId)
    )
  );
  res.json({ ok: true });
});
