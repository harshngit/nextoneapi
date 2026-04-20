const sendSuccess = (res, message, data = null, statusCode = 200) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  return res.status(statusCode).json(response);
};

const sendError = (res, message, statusCode = 400, error = null) => {
  const response = { success: false, message };
  if (error && process.env.NODE_ENV === "development") response.error = error;
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