const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const config = require('./config');
require('./db/db');
const { requireAuth } = require('./middleware/auth');
const { notFound, errorHandler } = require('./middleware/errors');

const app = express();
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:'],
      scriptSrc: ["'self'"],
      connectSrc: ["'self'"],
    },
  },
}));
app.use(cors());
app.use(express.json({ limit: '200kb' }));

// public auth routes (/api/signup, /api/login) and /api/me
app.use('/api', require('./routes/auth'));

// everything below needs a valid JWT
const api = express.Router();
api.use(requireAuth);
require('./routes/entities').forEach((r) => api.use(r));
api.use(require('./routes/setup'));
api.use(require('./routes/timetables'));
app.use('/api', api);
app.use('/api', notFound);

app.use(express.static(config.frontendDir));
app.use((req, res) => res.sendFile(path.join(config.frontendDir, 'index.html')));
app.use(errorHandler);

if (require.main === module) {
  app.listen(config.port, () => console.log(`Smart Timetable running at http://localhost:${config.port}`));
}
module.exports = app;
