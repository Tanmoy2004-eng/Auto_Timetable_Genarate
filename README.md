# Smart Timetable Generator

A full-stack web app that automatically generates **clash-free weekly timetables** for teachers, rooms and classes.

- **Frontend:** vanilla HTML / CSS / JavaScript (ES modules, no build step)
- **Backend:** Node.js + Express
- **Database:** SQLite (file based, zero setup)
- **Auth:** JWT + bcrypt, every user only sees their own data

## Quick start

Requires **Node.js 22 or newer** (needed by the bundled SQLite driver, which ships prebuilt binaries for Windows, macOS and Linux, so no C++ compiler is required).

```bash
cd backend
npm install       # use npm install (not npm ci); no lockfile is shipped on purpose
npm run seed      # optional: creates a demo account with sample data
npm run dev       # or: npm start
```

Open **http://localhost:3000**.

Demo login (after `npm run seed`): `demo@demo.com` / `Demo@1234`

The Express server also serves the `Frontend/` folder, so there is nothing else to run.
An optional `.env` file can be created from `backend/.env.example` (port, JWT secret, database path).
**Set a strong `JWT_SECRET` in production** (the server refuses to start in production without one).

## How to use it

1. **Settings**: working days, periods per day, start time, period length, lunch break, lab block length.
2. Add **Teachers** (theory / lab / both, max periods per day), **Rooms** (classroom / lab, capacity),
   **Batches** (name, number of students) and **Subjects** (theory / lab, periods per week).
3. **Assign**: for each batch tick its subjects and choose the teacher for each one.
4. Click **Generate Timetable** on the dashboard.
5. View it as a weekly grid (by batch, teacher or room) or a table. Click a cell, or use **Move**, to edit by hand;
   the server rejects any move that creates a clash. Export to **PDF** or **Excel**, or **Print**.
   Every generation is saved, so you can switch between earlier timetables.

## Project structure

```
Auto_Timetable_Genarate/
├── backend/
│   ├── src/
│   │   ├── server.js                  Express app, security headers, static frontend
│   │   ├── config.js                  environment config
│   │   ├── db/ (schema.sql, db.js, seed.js)
│   │   ├── middleware/ (auth.js, errors.js)
│   │   ├── routes/ (auth, entities, setup, timetables)
│   │   └── services/ (timetableGenerator, exportService, timetableData, context, timeUtil)
│   ├── tests/ (generator.test.js, api.test.js)
│   ├── .env.example
│   └── package.json
├── Frontend/
│   ├── index.html
│   ├── css/style.css
│   └── js/ (main, api, ui, entities, timetable, theme)
├── .gitignore
└── README.md
```

## API

All endpoints are under `/api`. Everything except signup/login needs `Authorization: Bearer <token>`.
Errors are always `{ "error": "message" }` with a proper status code (400, 401, 404, 409, 422, 500).

| Method | Endpoint | Description |
|---|---|---|
| POST | `/signup` | `{name,email,password}` returns `{token,user}` (password min 8 chars) |
| POST | `/login` | `{email,password}` returns `{token,user}` |
| GET | `/me` | current user |
| GET/POST | `/teachers` | list / create `{name,type,max_periods_per_day}` |
| GET/POST | `/rooms` | list / create `{name,capacity,type}` |
| GET/POST | `/batches` | list / create `{name,strength}` |
| GET/POST | `/subjects` | list / create `{name,type,periods_per_week}` |
| PUT/DELETE | `/teachers`, `/rooms`, `/batches`, `/subjects` + `/:id` | update / delete. Delete returns 409 `{inUse:true}` if used in saved timetables; add `?force=true` to delete anyway |
| GET/PUT | `/batches/:id/subjects` | read / replace `{assignments:[{subject_id,teacher_id}]}` |
| GET/PUT | `/settings` | timetable settings |
| POST | `/generate` | generate and save a timetable; returns `{id,timetable:[...],unplaced,warnings,score,...}` |
| GET | `/timetables` | history |
| GET | `/timetables/:id` | full timetable with settings and time slots |
| PUT | `/timetables/:id/entries/:entryId` | move `{day,period,room_id}` (clash checked, 409 on conflict) |
| DELETE | `/timetables/:id/entries/:entryId` | remove one session |
| DELETE | `/timetables/:id` | delete timetable |
| GET | `/timetables/:id/export?format=pdf` or `xlsx` | download |
| GET | `/stats` | counts and last generated time |

Example:

```bash
TOKEN=$(curl -s -X POST localhost:3000/api/login -H 'Content-Type: application/json' \
  -d '{"email":"demo@demo.com","password":"Demo@1234"}' | node -pe 'JSON.parse(require("fs").readFileSync(0)).token')
curl -s -X POST localhost:3000/api/generate -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' -d '{}'
```

## How the generator works

`backend/src/services/timetableGenerator.js` is a pure function (no database access), so it is easy to test.

**Hard rules (never broken):** no teacher, room or batch in two places at once; room capacity must fit the batch;
labs use lab rooms and theory uses classrooms; a lab runs as one consecutive block that never crosses the lunch break;
teachers never exceed their daily limit; every subject gets exactly its periods per week (or is reported as unplaced).

**Soft rules (optimised):** spread a subject over different days, avoid free gaps inside a day, balance teacher
workload across days, vary the period of a subject, put labs after lunch, keep days compact, keep a batch in one home room.

**Method:** randomized-restart greedy construction. Labs are placed first, then theory sessions in random order;
each session takes the lowest-cost valid slot. The whole build repeats many times (up to 3 seconds) and the best result wins
(fewest unplaced sessions, then lowest penalty). This is a heuristic, not an exhaustive search: if the data is
over-constrained you get the best partial timetable plus a clear list of what could not be placed and why
(for example "Dr. Rao has reached the daily teaching limit"). An independent `verify()` function re-checks every result
before it is saved.

## Tests

```bash
cd backend
npm test
```

19 tests: the generator (clash-freedom, exact periods per week, capacity, lab blocks and lunch, daily limits,
impossible input, manual-move validation, performance with 10 batches / 15 teachers) and the API
(signup/login, validation, CRUD, data isolation between users, full generate/edit/export flow).

## Security notes

Passwords are hashed with bcrypt; JWTs expire after 7 days; auth routes are rate limited; all SQL is parameterised;
every query is scoped to the logged-in user; helmet security headers and a strict Content-Security-Policy are enabled;
the frontend builds the DOM with `textContent` (no `innerHTML`), so user text cannot inject HTML.

## Known limitations

- The generator is a heuristic, so for very tight inputs it may leave sessions unplaced even when a perfect solution exists.
  Run Generate again (it is randomized) or relax a limit.
- One timetable setting applies to the whole account (no separate semesters or shifts yet).
- Teachers have no individual unavailable time slots yet.
- The token is stored in browser storage (localStorage, or sessionStorage if "Remember me" is unticked).
  For a public deployment, serve over HTTPS.
