const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const asyncHandler = require('../async-handler');
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
    session => session.id === sessionId && session.instructorId === instructorId
  );
}

router.use(verifyToken);

router.get('/students', requireRole('instructor'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const students = data.users
    .filter(user => (user.role || 'student') === 'student')
    .map(({ id, name, email }) => ({ id, name, email }));
  res.json(students);
}));

router.get('/sessions', requireRole('instructor'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const sessions = data.attendanceSessions
    .filter(session => session.instructorId === req.user.id)
    .map(session => ({
      id: session.id,
      className: session.className,
      date: session.date,
      studentCount: session.records.length,
      presentCount: session.records.filter(record => record.status === 'present').length
    }))
    .sort((a, b) => b.date.localeCompare(a.date));
  res.json(sessions);
}));

router.get('/report', requireRole('instructor'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const students = new Map(data.users.map(user => [user.id, user]));
  const records = data.attendanceSessions
    .filter(session => session.instructorId === req.user.id)
    .flatMap(session => session.records.map(record => {
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
}));

router.post('/sessions', requireRole('instructor'), asyncHandler(async (req, res) => {
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
  const outcome = await db.update(data => {
    const students = data.users.filter(
      user => (user.role || 'student') === 'student' && selectedIds.includes(user.id)
    );
    if (students.length !== selectedIds.length) return { error: 'students' };

    const session = {
      id: crypto.randomUUID(),
      className: cleanClassName,
      date,
      instructorId: req.user.id,
      records: students.map(student => ({ userId: student.id, status: 'unmarked' }))
    };
    data.attendanceSessions.unshift(session);
    return { session };
  });

  if (outcome.error) {
    return res.status(400).json({ error: 'One or more selected students are not available.' });
  }

  res.status(201).json({
    id: outcome.session.id,
    className: outcome.session.className,
    date: outcome.session.date,
    studentCount: outcome.session.records.length,
    presentCount: 0
  });
}));

router.get('/sessions/:id', requireRole('instructor'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const session = findOwnedSession(data, req.params.id, req.user.id);
  if (!session) {
    return res.status(404).json({ error: 'Class session not found.' });
  }

  const students = new Map(data.users.map(user => [user.id, user]));
  const records = session.records.map(record => {
    const student = students.get(record.userId);
    return {
      userId: record.userId,
      name: student ? student.name : 'Student account unavailable',
      email: student ? student.email : '',
      status: record.status
    };
  });
  res.json({ id: session.id, className: session.className, date: session.date, records });
}));

router.patch('/sessions/:id/records/:studentId', requireRole('instructor'),
  asyncHandler(async (req, res) => {
    const { status } = req.body || {};
    if (!['present', 'absent'].includes(status)) {
      return res.status(400).json({ error: 'Attendance must be marked present or absent.' });
    }

    const studentId = Number(req.params.studentId);
    const outcome = await db.update(data => {
      const session = findOwnedSession(data, req.params.id, req.user.id);
      if (!session) return 'session';
      const record = session.records.find(entry => entry.userId === studentId);
      if (!record) return 'student';
      record.status = status;
      data.attendanceReports.forEach(report => {
        if (report.sessionId === session.id && report.studentId === studentId &&
            report.status === 'pending') {
          report.status = status === 'present' ? 'corrected' : 'rejected';
          report.reviewedAt = new Date().toISOString();
        }
      });
      return 'updated';
    });

    if (outcome === 'session') {
      return res.status(404).json({ error: 'Class session not found.' });
    }
    if (outcome === 'student') {
      return res.status(404).json({ error: 'Student is not on this class roster.' });
    }
    res.json({ userId: studentId, status });
  })
);

router.post('/reports', requireRole('student'), asyncHandler(async (req, res) => {
  const sessionId = String(req.body?.sessionId || '');
  const reason = String(req.body?.reason || '').trim();
  if (!sessionId || !reason) {
    return res.status(400).json({ error: 'Select an absent class and explain the correction.' });
  }
  if (reason.length > 500) {
    return res.status(400).json({ error: 'The explanation must be 500 characters or fewer.' });
  }

  const outcome = await db.update(data => {
    const session = data.attendanceSessions.find(entry => entry.id === sessionId);
    if (!session) return 'session';
    const record = session.records.find(entry => entry.userId === req.user.id);
    if (!record || record.status !== 'absent') return 'not-absent';
    const existing = data.attendanceReports.find(report =>
      report.sessionId === sessionId &&
      report.studentId === req.user.id &&
      report.status === 'pending'
    );
    if (existing) return 'pending';

    const report = {
      id: crypto.randomUUID(),
      sessionId,
      studentId: req.user.id,
      instructorId: session.instructorId,
      reason,
      status: 'pending',
      createdAt: new Date().toISOString()
    };
    data.attendanceReports.push(report);
    return 'created';
  });

  if (outcome === 'session') return res.status(404).json({ error: 'Class session not found.' });
  if (outcome === 'not-absent') {
    return res.status(400).json({ error: 'You can only report a class currently marked absent.' });
  }
  if (outcome === 'pending') {
    return res.status(409).json({ error: 'A report for this class is already awaiting review.' });
  }
  res.status(201).json({ message: 'Your correction request was sent to the instructor.' });
}));

router.get('/reports/mine', requireRole('student'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const sessions = new Map(data.attendanceSessions.map(session => [session.id, session]));
  const reports = data.attendanceReports
    .filter(report => report.studentId === req.user.id)
    .map(report => {
      const session = sessions.get(report.sessionId);
      return {
        ...report,
        className: session ? session.className : 'Class unavailable',
        date: session ? session.date : ''
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(reports);
}));

router.get('/reports', requireRole('instructor'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const users = new Map(data.users.map(user => [user.id, user]));
  const sessions = new Map(data.attendanceSessions.map(session => [session.id, session]));
  const reports = data.attendanceReports
    .filter(report => report.instructorId === req.user.id)
    .map(report => {
      const session = sessions.get(report.sessionId);
      const student = users.get(report.studentId);
      return {
        ...report,
        className: session ? session.className : 'Class unavailable',
        date: session ? session.date : '',
        studentName: student ? student.name : 'Student account unavailable',
        studentEmail: student ? student.email : ''
      };
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  res.json(reports);
}));

router.patch('/reports/:id', requireRole('instructor'), asyncHandler(async (req, res) => {
  const { decision } = req.body || {};
  if (!['corrected', 'rejected'].includes(decision)) {
    return res.status(400).json({ error: 'Choose whether to correct or reject this report.' });
  }

  const outcome = await db.update(data => {
    const report = data.attendanceReports.find(entry =>
      entry.id === req.params.id && entry.instructorId === req.user.id
    );
    if (!report) return 'missing';
    if (report.status !== 'pending') return 'already-reviewed';

    if (decision === 'corrected') {
      const session = findOwnedSession(data, report.sessionId, req.user.id);
      const record = session?.records.find(entry => entry.userId === report.studentId);
      if (!record) return 'record';
      record.status = 'present';
    }

    report.status = decision;
    report.reviewedAt = new Date().toISOString();
    return 'reviewed';
  });

  if (outcome === 'missing') return res.status(404).json({ error: 'Report not found.' });
  if (outcome === 'already-reviewed') {
    return res.status(409).json({ error: 'This report has already been reviewed.' });
  }
  if (outcome === 'reviewed') return res.json({ status: decision });
  if (outcome === 'record') {
    return res.status(409).json({ error: 'The attendance record is no longer available.' });
  }
}));

router.get('/mine', requireRole('student'), asyncHandler(async (req, res) => {
  const data = await db.read();
  const instructors = new Map(data.users.map(user => [user.id, user.name]));
  const records = data.attendanceSessions.flatMap(session => {
    const record = session.records.find(entry => entry.userId === req.user.id);
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
}));

module.exports = router;
