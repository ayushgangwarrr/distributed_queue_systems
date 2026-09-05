/**
 * src/api/errorHandler.js
 *
 * Centralized Express error-handling middleware.
 * Catches unhandled exceptions, logs them internally, and returns a sanitized 500 response.
 */

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  console.error('[API Internal Error]:', {
    method: req.method,
    url: req.originalUrl,
    error: err.message,
    stack: err.stack,
  });

  res.status(500).json({
    error: 'Internal Server Error',
    message: 'An unexpected error occurred while processing your request',
  });
}

module.exports = errorHandler;
