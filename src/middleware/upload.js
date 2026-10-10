import multer from 'multer';
import { env } from '../config/env.js';
import { ApiError } from '../utils/ApiError.js';

const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);

/**
 * In-memory upload so Sharp can process the buffer before it ever
 * touches disk or storage. Size + MIME are validated here; the true
 * format is re-validated by Sharp in the image service.
 */
export const uploadImage = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.upload.maxFileBytes },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED_MIME.has(file.mimetype)) {
      return cb(new ApiError(400, 'Unsupported image type. Use JPEG, PNG, WebP, GIF or AVIF.'));
    }
    cb(null, true);
  },
}).single('image');

/**
 * Wrap multer to translate its errors into ApiError responses.
 */
export function handleUpload(req, res, next) {
  uploadImage(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return next(new ApiError(400, 'Image is too large.'));
      }
      return next(err instanceof ApiError ? err : new ApiError(400, 'Image upload failed.'));
    }
    if (!req.file) {
      return next(new ApiError(400, 'No image file provided (field name must be "image").'));
    }
    next();
  });
}
