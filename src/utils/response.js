const sendSuccess = (res, message, data = null, statusCode = 200) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  return res.status(statusCode).json(response);
};

const sendError = (res, message, statusCode = 400, error = null) => {
  const response = { 
    success: false, 
    message: message || "An unexpected error occurred"
  };

  // Always include error details if provided, but format them safely
  if (error) {
    if (typeof error === 'string') {
      response.error = error;
    } else if (error.message) {
      response.error = error.message;
      // Include stack trace only in development
      if (process.env.NODE_ENV === "development") {
        response.stack = error.stack;
      }
    } else {
      response.details = error;
    }
  }

  return res.status(statusCode).json(response);
};

const paginate = (data, total, page, perPage) => ({
  success: true,
  data,
  pagination: {
    total,
    page,
    per_page: perPage,
    total_pages: Math.ceil(total / perPage),
  },
});

module.exports = { sendSuccess, sendError, paginate };