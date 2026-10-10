import { Router } from 'express';
import rateLimit from 'express-rate-limit';

import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { handleUpload } from '../middleware/upload.js';

import * as auth from '../controllers/authController.js';
import * as restaurant from '../controllers/restaurantController.js';
import * as categories from '../controllers/categoryController.js';
import * as products from '../controllers/productController.js';
import * as coupons from '../controllers/couponController.js';
import * as banners from '../controllers/bannerController.js';
import * as orders from '../controllers/orderController.js';
import * as uploads from '../controllers/uploadController.js';

const router = Router();

// Tighter limit on order placement to blunt accidental/abusive retries.
const orderLimiter = rateLimit({ windowMs: 60 * 1000, max: 20, standardHeaders: true, legacyHeaders: false });

/* ----------------------- Public ----------------------- */
router.get('/restaurant/status', restaurant.getStatus);
router.get('/categories', categories.listCategories);
router.get('/products', products.listProducts);
router.get('/products/:id', products.getProduct);
router.get('/banners', banners.listActiveBanners);

/* --------------------- Authenticated (customer) --------------------- */
router.get('/me', requireAuth, auth.getMe);
router.put('/me/profile', requireAuth, auth.updateProfile);

router.post('/coupons/preview', requireAuth, coupons.previewCoupon);

router.post('/orders', requireAuth, orderLimiter, orders.placeOrder);
router.get('/orders/mine', requireAuth, orders.myOrders);
router.get('/orders/:id', requireAuth, orders.getOrder);

/* ------------------------- Admin ------------------------- */
const admin = Router();
admin.use(requireAuth, requireAdmin);

admin.put('/restaurant/settings', restaurant.updateSettings);

admin.get('/categories', categories.listAllCategories);
admin.post('/categories', categories.createCategory);
admin.put('/categories/reorder', categories.reorderCategories);
admin.put('/categories/:id', categories.updateCategory);
admin.delete('/categories/:id', categories.deleteCategory);

admin.post('/products', products.createProduct);
admin.put('/products/:id', products.updateProduct);
admin.delete('/products/:id', products.deleteProduct);

admin.get('/coupons', coupons.listCoupons);
admin.post('/coupons', coupons.createCoupon);
admin.put('/coupons/:id', coupons.updateCoupon);
admin.delete('/coupons/:id', coupons.deleteCoupon);

admin.get('/banners', banners.listAllBanners);
admin.post('/banners', banners.createBanner);
admin.put('/banners/:id', banners.updateBanner);
admin.delete('/banners/:id', banners.deleteBanner);

admin.get('/orders', orders.listOrders);
admin.put('/orders/:id/status', orders.changeStatus);
admin.get('/dashboard/summary', orders.dashboardSummary);

admin.post('/uploads', handleUpload, uploads.uploadImage);

router.use('/admin', admin);

export default router;
