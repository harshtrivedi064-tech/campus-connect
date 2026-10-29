const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

function requireRole(role) {
  return (req, res, next) => {
    if (req.user.role !== role) {
      return res.status(403).json({ error: `This feature is only available to ${role}s.` });
    }
    next();
  };
}

function findOwnedSession(data, sessionId, instructorId) {
  return data.attendanceSessions.find(
    (session) => session.id === sessionId && session.instructorId === instructorId
  );
}

router.use(verifyToken);

router.get('/students', requireRole('instructor'), (req, res) => {
  const data = db.load();
  const students = data.users
    .filter((user) => (user.role || 'student') === 'student')
    .map(({ id, name, email }) => ({ id, name, email }));

  res.json(students);
});

router.get('/sessions', requireRole('instructor'), (req, res) => {
  const data = db.load();
  const sessions = data.attendanceSessions
    .filter((session) => session.instructorId === req.user.id)
    .map((session) => ({
      id: session.id,
      className: session.className,
      date: session.date,
      studentCount: session.records.length,
      presentCount: session.records.filter((record) => record.status === 'present').length
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  res.json(sessions);
});

router.get('/report', requireRole('instructor'), (req, res) => {
  const data = db.load();
  const students = new Map(data.users.map((user) => [user.id, user]));
  const records = data.attendanceSessions
    .filter((session) => session.instructorId === req.user.id)
    .flatMap((session) => session.records.map((record) => {
      const student = students.get(record.userId);
      return {
        sessionKey: session.id,
        date: session.date,
        className: session.className,
        student: student ? student.name : 'Student account unavailable',
        email: student ? student.email : '',
        status: record.status
      };
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  res.json(records);
});

router.post('/sessions', requireRole('instructor'), (req, res) => {
  const { className, date, studentIds } = req.body || {};
  const cleanClassName = String(className || '').trim();

  if (!cleanClassName || cleanClassName.length > 80) {
    return res.status(400).json({ error: 'Enter a class name of 1 to 80 characters.' });
  }

  const parsedDate = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)
    ? new Date(`${date}T00:00:00.000Z`)
    : null;
  if (!parsedDate || !Number.isFinite(parsedDate.getTime()) ||
      parsedDate.toISOString().slice(0, 10) !== date) {
    return res.status(400).json({ error: 'Choose a valid class date.' });
  }

  if (!Array.isArray(studentIds) || studentIds.length === 0) {
    return res.status(400).json({ error: 'Select at least one student for this class.' });
  }

  const selectedIds = [...new Set(studentIds)];
  const data = db.load();
  const students = data.users.filter(
    (user) => (user.role || 'student') === 'student' && selectedIds.includes(user.id)
  );

  if (students.length !== selectedIds.length) {
    return res.status(400).json({ error: 'One or more selected students are not available.' });
  }

  const session = {
    id: crypto.randomUUID(),
    className: cleanClassName,
    date,
    instructorId: req.user.id,
    records: students.map((student) => ({ userId: student.id, status: 'unmarked' }))
  };
  data.attendanceSessions.unshift(session);
  db.save(data);

  res.status(201).json({
    id: session.id,
    className: session.className,
    date: session.date,
    studentCount: session.records.length,
    presentCount: 0
  });
});

router.get('/sessions/:id', requireRole('instructor'), (req, res) => {
  const data = db.load();
  const session = findOwnedSession(data, req.params.id, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'Class session not found.' });
  }

  const students = new Map(data.users.map((user) => [user.id, user]));
  const records = session.records.map((record) => {
    const student = students.get(record.userId);
    return {
      userId: record.userId,
      name: student ? student.name : 'Student account unavailable',
      email: student ? student.email : '',
      status: record.status
    };
  });

  res.json({
    id: session.id,
    className: session.className,
    date: session.date,
    records
  });
});

router.patch('/sessions/:id/records/:studentId', requireRole('instructor'), (req, res) => {
  const { status } = req.body || {};
  if (!['present', 'absent'].includes(status)) {
    return res.status(400).json({ error: 'Attendance must be marked present or absent.' });
  }

  const data = db.load();
  const session = findOwnedSession(data, req.params.id, req.user.id);

  if (!session) {
    return res.status(404).json({ error: 'Class session not found.' });
  }

  const studentId = Number(req.params.studentId);
  const record = session.records.find((entry) => entry.userId === studentId);
  if (!record) {
    return res.status(404).json({ error: 'Student is not on this class roster.' });
  }

  record.status = status;
  db.save(data);
  res.json({ userId: studentId, status });
});

router.get('/mine', requireRole('student'), (req, res) => {
  const data = db.load();
  const instructors = new Map(data.users.map((user) => [user.id, user.name]));
  const records = data.attendanceSessions.flatMap((session) => {
    const record = session.records.find((entry) => entry.userId === req.user.id);
    return record ? [{
      sessionId: session.id,
      className: session.className,
      date: session.date,
      instructor: instructors.get(session.instructorId) || 'Instructor',
      status: record.status
    }] : [];
  });

  records.sort((a, b) => b.date.localeCompare(a.date));
  res.json(records);
});

module.exports = router;
