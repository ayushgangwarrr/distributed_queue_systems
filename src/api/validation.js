/**
 * src/api/validation.js
 *
 * Request payload validation using Zod.
 */

const { z } = require('zod');

const jobSubmissionSchema = z.object({
  type: z
    .string({
      required_error: 'type is required',
      invalid_type_error: 'type must be a string',
    })
    .min(1, 'type cannot be empty'),
  data: z.record(z.any(), {
    required_error: 'data is required',
    invalid_type_error: 'data must be an object',
  }),
  priority: z
    .number({ invalid_type_error: 'priority must be a number' })
    .int('priority must be an integer')
    .min(1, 'priority must be at least 1')
    .max(10, 'priority cannot exceed 10')
    .optional()
    .default(5),
  maxRetries: z
    .number({ invalid_type_error: 'maxRetries must be a number' })
    .int('maxRetries must be an integer')
    .min(0, 'maxRetries must be at least 0')
    .max(10, 'maxRetries cannot exceed 10')
    .optional()
    .default(3),
});

/**
 * Express middleware to validate job submission against the Zod schema.
 * Returns 400 with formatted validation errors if invalid.
 */
function validateJobSubmission(req, res, next) {
  const result = jobSubmissionSchema.safeParse(req.body);

  if (!result.success) {
    const issues = result.error.issues || [];
    const details = issues.map((err) => ({
      field: err.path && err.path.length > 0 ? err.path.join('.') : 'body',
      message: err.message,
    }));

    return res.status(400).json({
      error: 'Validation failed',
      details,
    });
  }

  // Replace req.body with parsed/sanitized data (including defaults)
  req.body = result.data;
  next();
}

module.exports = {
  jobSubmissionSchema,
  validateJobSubmission,
};
