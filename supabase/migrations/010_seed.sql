-- ============================================================
-- Vilasa Cafe — 010_seed.sql
-- SEED / SAMPLE DATA. Safe to run once on a fresh database.
-- The restaurant row + settings are REQUIRED (app expects one
-- restaurant). Categories/products below are SAMPLE data you can
-- delete and manage from the admin panel.
-- ============================================================

-- Fixed restaurant id so the backend can reference it via env.
-- VILASA_RESTAURANT_ID must match this in backend .env.
insert into restaurants (id, name, slug, phone, address)
values (
  '11111111-1111-1111-1111-111111111111',
  'Vilasa Cafe',
  'vilasa-cafe',
  '9000000000',
  'Andhra Pradesh, India'
)
on conflict (id) do nothing;

insert into restaurant_settings (restaurant_id, is_open, min_order_value)
values ('11111111-1111-1111-1111-111111111111', true, 0)
on conflict (restaurant_id) do nothing;

-- ---- SAMPLE categories (delete/edit freely in admin) -------
insert into categories (restaurant_id, name, slug, display_order) values
  ('11111111-1111-1111-1111-111111111111', 'Breakfast', 'breakfast', 1),
  ('11111111-1111-1111-1111-111111111111', 'Snacks',    'snacks',    2),
  ('11111111-1111-1111-1111-111111111111', 'Meals',     'meals',     3),
  ('11111111-1111-1111-1111-111111111111', 'Biryani',   'biryani',   4),
  ('11111111-1111-1111-1111-111111111111', 'Beverages', 'beverages', 5),
  ('11111111-1111-1111-1111-111111111111', 'Desserts',  'desserts',  6)
on conflict (restaurant_id, slug) do nothing;

-- ---- SAMPLE products ---------------------------------------
insert into products (restaurant_id, category_id, name, description, price, is_available, is_featured, display_order)
select
  '11111111-1111-1111-1111-111111111111',
  c.id,
  v.name, v.description, v.price, true, v.featured, v.ord
from (values
  ('breakfast', 'Masala Dosa',    'Crispy dosa with spiced potato filling', 70.00, true, 1),
  ('breakfast', 'Idli Vada',      'Steamed idli with medu vada and chutney', 60.00, false, 2),
  ('snacks',    'Samosa (2 pcs)', 'Golden fried samosas with chutney', 40.00, true, 1),
  ('snacks',    'Veg Puff',       'Flaky puff with spiced vegetable filling', 30.00, false, 2),
  ('meals',     'Veg Thali',      'Rice, dal, sabzi, roti, curd and sweet', 130.00, true, 1),
  ('biryani',   'Chicken Biryani','Hyderabadi dum biryani with raita', 180.00, true, 1),
  ('biryani',   'Veg Biryani',    'Fragrant basmati with mixed vegetables', 150.00, false, 2),
  ('beverages', 'Masala Chai',    'Freshly brewed spiced tea', 20.00, false, 1),
  ('beverages', 'Cold Coffee',    'Chilled coffee with ice cream', 80.00, true, 2),
  ('desserts',  'Gulab Jamun (2)','Warm gulab jamun in sugar syrup', 50.00, false, 1)
) as v(cat_slug, name, description, price, featured, ord)
join categories c
  on c.slug = v.cat_slug
 and c.restaurant_id = '11111111-1111-1111-1111-111111111111'
where not exists (
  select 1 from products p
  where p.restaurant_id = '11111111-1111-1111-1111-111111111111'
    and p.name = v.name
);

-- ---- Make yourself an admin --------------------------------
-- After signing in once with Google, find your user id in Supabase
-- Auth, then run (replace the uuid):
--   update profiles set role = 'admin' where id = '<your-auth-user-id>';
