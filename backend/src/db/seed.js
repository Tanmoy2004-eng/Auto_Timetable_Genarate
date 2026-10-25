// Creates a demo account with realistic data. Run: npm run seed
const bcrypt = require('bcryptjs');
const db = require('./db');

const EMAIL = 'demo@demo.com';
const PASSWORD = 'Demo@1234';

db.transaction(() => {
  db.prepare('DELETE FROM users WHERE email=?').run(EMAIL); // cascades to all demo data
  const uid = db.prepare('INSERT INTO users (name,email,password_hash) VALUES (?,?,?)')
    .run('Demo Admin', EMAIL, bcrypt.hashSync(PASSWORD, 10)).lastInsertRowid;
  db.prepare('INSERT INTO settings (user_id) VALUES (?)').run(uid);

  const add = (table, cols, rows) => {
    const stmt = db.prepare(`INSERT INTO ${table} (user_id,${cols.join(',')}) VALUES (?,${cols.map(() => '?').join(',')})`);
    return rows.map((r) => Number(stmt.run(uid, ...r).lastInsertRowid));
  };

  const [sharma, mehta, iyer, khan, rao, dsouza] = add('teachers', ['name', 'type', 'max_periods_per_day'], [
    ['Dr. Sharma', 'theory', 5], ['Prof. Mehta', 'both', 5], ['Ms. Iyer', 'theory', 5],
    ['Mr. Khan', 'both', 5], ['Dr. Rao', 'theory', 5], ["Ms. D'Souza", 'lab', 4],
  ]);
  add('rooms', ['name', 'capacity', 'type'], [
    ['R-101', 70, 'classroom'], ['R-102', 70, 'classroom'], ['R-103', 60, 'classroom'],
    ['Computer Lab 1', 60, 'lab'], ['Computer Lab 2', 60, 'lab'],
  ]);
  const batches = add('batches', ['name', 'strength'], [['CSE-A', 58], ['CSE-B', 55], ['IT-A', 50]]);
  const [math, phy, ds, dbms, eng, os, dsLab, dbmsLab] = add('subjects', ['name', 'type', 'periods_per_week'], [
    ['Mathematics', 'theory', 4], ['Physics', 'theory', 3], ['Data Structures', 'theory', 4],
    ['DBMS', 'theory', 3], ['English', 'theory', 2], ['Operating Systems', 'theory', 3],
    ['DS Lab', 'lab', 2], ['DBMS Lab', 'lab', 2],
  ]);
  const plan = [[math, sharma], [phy, iyer], [ds, mehta], [dbms, khan], [eng, iyer], [os, rao], [dsLab, dsouza], [dbmsLab, khan]];
  const ins = db.prepare('INSERT INTO batch_subjects (user_id,batch_id,subject_id,teacher_id) VALUES (?,?,?,?)');
  batches.forEach((b) => plan.forEach(([s, t]) => ins.run(uid, b, s, t)));
})();

console.log(`Seeded demo account -> email: ${EMAIL}  password: ${PASSWORD}`);
