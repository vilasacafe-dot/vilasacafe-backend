/**
 * Operational error with an HTTP status + safe client message.
 */
export class ApiError extends Error {
  constructor(statusCode, message, code = undefined) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
  }

  static badRequest(msg, code) {
    return new ApiError(400, msg, code);
  }
  static unauthorized(msg = 'Authentication required.', code) {
    return new ApiError(401, msg, code);
  }
  static forbidden(msg = 'You do not have permission to do that.', code) {
    return new ApiError(403, msg, code);
  }
  static notFound(msg = 'Not found.', code) {
    return new ApiError(404, msg, code);
  }
  static conflict(msg, code) {
    return new ApiError(409, msg, code);
  }
}
