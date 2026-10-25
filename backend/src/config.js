require('dotenv').config();
const path = require('path');

const isProd = process.env.NODE_ENV === 'production';
if (isProd && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  port: Number(process.env.PORT) || 3000,
  jwtSecret: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  dbFile: path.resolve(__dirname, '..', process.env.DB_FILE || './data/timetable.db'),
  frontendDir: path.resolve(__dirname, '..', '..', 'Frontend'),
};
