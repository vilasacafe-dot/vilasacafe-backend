import { asyncHandler } from '../utils/asyncHandler.js';
import { processAndUpload } from '../services/imageService.js';

/**
 * Admin: upload an image (product or banner). Sharp converts to WebP,
 * resizes/compresses, then uploads to Cloudflare R2. Returns { key, url }
 * which the client stores on the product/banner record.
 * Query: ?kind=product|banner
 */
export const uploadImage = asyncHandler(async (req, res) => {
  const kind = req.query.kind === 'banner' ? 'banner' : 'product';
  const { key, url } = await processAndUpload(req.file.buffer, kind);
  res.status(201).json({ key, url });
});
