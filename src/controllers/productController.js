import { supabaseAdmin } from '../config/supabase.js';
import { env } from '../config/env.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/ApiError.js';
import { productSchema } from '../validators/schemas.js';
import { deleteObject } from '../services/imageService.js';

/**
 * Public menu list. Optional ?category_id filter. ?all=1 (admin) shows
 * unavailable products too. Customers get all products (available flag
 * lets the UI show "unavailable" without hiding items).
 */
export const listProducts = asyncHandler(async (req, res) => {
  const { category_id } = req.query;
  let query = supabaseAdmin
    .from('products')
    .select('id, name, description, price, image_url, image_key, is_available, is_featured, display_order, category_id')
    .eq('restaurant_id', env.restaurantId)
    .order('display_order', { ascending: true })
    .order('name', { ascending: true });

  if (category_id) query = query.eq('category_id', category_id);

  const { data, error } = await query;
  if (error) throw new ApiError(500, 'Could not load products.');
  res.json({ products: data });
});

export const getProduct = asyncHandler(async (req, res) => {
  const { data, error } = await supabaseAdmin
    .from('products')
    .select('*')
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .single();
  if (error || !data) throw ApiError.notFound('Product not found.');
  res.json({ product: data });
});

export const createProduct = asyncHandler(async (req, res) => {
  const body = productSchema.parse(req.body);
  const { data, error } = await supabaseAdmin
    .from('products')
    .insert({ ...body, restaurant_id: env.restaurantId })
    .select('*')
    .single();
  if (error) throw new ApiError(500, 'Could not create product.');
  res.status(201).json({ product: data });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const body = productSchema.partial().parse(req.body);

  // If the image changed, delete the old R2 object afterwards.
  let oldKey = null;
  if (body.image_key !== undefined) {
    const { data: existing } = await supabaseAdmin
      .from('products')
      .select('image_key')
      .eq('id', req.params.id)
      .eq('restaurant_id', env.restaurantId)
      .single();
    if (existing && existing.image_key && existing.image_key !== body.image_key) {
      oldKey = existing.image_key;
    }
  }

  const { data, error } = await supabaseAdmin
    .from('products')
    .update(body)
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .select('*')
    .single();
  if (error || !data) throw ApiError.notFound('Product not found.');

  if (oldKey) await deleteObject(oldKey);
  res.json({ product: data });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const { data: existing } = await supabaseAdmin
    .from('products')
    .select('image_key')
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId)
    .single();

  const { error } = await supabaseAdmin
    .from('products')
    .delete()
    .eq('id', req.params.id)
    .eq('restaurant_id', env.restaurantId);
  if (error) throw new ApiError(500, 'Could not delete product.');

  if (existing?.image_key) await deleteObject(existing.image_key);
  res.json({ ok: true });
});
