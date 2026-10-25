class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

function notFound(req, res) {
  res.status(404).json({ error: 'Not found' });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, ...err.extra });
  }
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON body' });
  }
  if (err && /UNIQUE constraint failed/.test(err.message || '')) {
    return res.status(409).json({ error: 'That name already exists' });
  }
  console.error(err);
  res.status(500).json({ error: 'Internal server error' });
}

module.exports = { HttpError, asyncHandler, notFound, errorHandler };
