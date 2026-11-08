function notFound(req, res) {
  res.status(404).json({ error: 'Endpoint not found.' });
}

function errorHandler(error, req, res, next) {
  console.error(error);
  if (res.headersSent) return next(error);
  res.status(error.status || 500).json({
    error: process.env.NODE_ENV === 'production' ? 'Something went wrong.' : error.message
  });
}

module.exports = { notFound, errorHandler };
