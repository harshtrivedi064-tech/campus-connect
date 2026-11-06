const express = require('express');
const db = require('../db');
const asyncHandler = require('../async-handler');
const { verifyToken } = require('./auth');

const router = express.Router();
router.use(verifyToken);

router.get('/', asyncHandler(async (req, res) => {
  const data = await db.read();
  const userId = String(req.user.id);

  const posts = data.posts
    .filter(post => String(post.userId) === userId)
    .map(post => ({
      id: post.id,
      text: post.text,
      createdAt: post.time,
      likeCount: Array.isArray(post.likes) ? post.likes.length : 0,
      commentCount: Array.isArray(post.comments) ? post.comments.length : 0
    }))
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const postComments = data.posts.flatMap(post =>
    (Array.isArray(post.comments) ? post.comments : [])
      .filter(comment => String(comment.userId) === userId)
      .map(comment => ({
        id: comment.id,
        postId: post.id,
        postText: post.text,
        text: comment.text,
        createdAt: comment.time
      }))
  ).sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const postReactions = data.posts.flatMap(post => {
    const reaction = (Array.isArray(post.likes) ? post.likes : []).some(id => String(id) === userId)
      ? 'Liked'
      : (Array.isArray(post.dislikes) ? post.dislikes : []).some(id => String(id) === userId)
        ? 'Disliked'
        : null;
    return reaction ? [{ postId: post.id, postText: post.text, reaction }] : [];
  });

  const hostedEvents = data.events
    .filter(event => String(event.organizerId) === userId)
    .map(event => ({
      id: event.id,
      title: event.title,
      date: event.date,
      time: event.time,
      location: event.location
    }))
    .sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  const eventResponses = data.events.flatMap(event => {
    const rsvp = (Array.isArray(event.rsvps) ? event.rsvps : [])
      .find(entry => String(entry.userId) === userId);
    if (!rsvp) return [];
    return [{
      eventId: event.id,
      title: event.title,
      date: event.date,
      time: event.time,
      location: event.location,
      status: rsvp.status,
      updatedAt: rsvp.updatedAt,
      registration: rsvp.registration
        ? {
            name: rsvp.registration.name,
            email: rsvp.registration.email,
            program: rsvp.registration.program
          }
        : null
    }];
  }).sort((a, b) => `${a.date}T${a.time}`.localeCompare(`${b.date}T${b.time}`));

  const postedInternships = data.internships
    .filter(internship => String(internship.postedById) === userId)
    .map(internship => ({
      id: internship.id,
      title: internship.title,
      company: internship.company,
      deadline: internship.deadline
    }));

  const internshipApplications = data.internships.flatMap(internship =>
    (Array.isArray(internship.applications) ? internship.applications : [])
      .filter(application => String(application.userId) === userId)
      .map(application => ({
        id: application.id,
        internshipId: internship.id,
        title: internship.title,
        company: internship.company,
        submittedAt: application.submittedAt,
        coverLetter: application.coverLetter,
        resumeUrl: application.resumeUrl || ''
      }))
  ).sort((a, b) => String(b.submittedAt).localeCompare(String(a.submittedAt)));

  const attendanceSessions = data.attendanceSessions
    .filter(session => req.user.role === 'student'
      ? session.records.some(record => String(record.userId) === userId)
      : String(session.instructorId) === userId)
    .map(session => {
      if (req.user.role !== 'student') {
        return {
          id: session.id,
          className: session.className,
          date: session.date,
          studentCount: session.records.length,
          presentCount: session.records.filter(record => record.status === 'present').length
        };
      }

      const record = session.records.find(entry => String(entry.userId) === userId);
      return {
        id: session.id,
        className: session.className,
        date: session.date,
        status: record.status
      };
    })
    .sort((a, b) => b.date.localeCompare(a.date));

  const attendanceReports = data.attendanceReports
    .filter(report => String(report.studentId) === userId)
    .map(report => {
      const session = data.attendanceSessions.find(entry => entry.id === report.sessionId);
      return {
        id: report.id,
        className: session ? session.className : 'Class unavailable',
        date: session ? session.date : '',
        reason: report.reason,
        status: report.status,
        createdAt: report.createdAt
      };
    })
    .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));

  const markedAttendance = attendanceSessions.filter(entry =>
    entry.status === 'present' || entry.status === 'absent'
  );
  const presentAttendance = markedAttendance.filter(entry => entry.status === 'present').length;
  const attendanceRate = markedAttendance.length
    ? Math.round((presentAttendance / markedAttendance.length) * 100)
    : null;

  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      email: req.user.email,
      role: req.user.role,
      createdAt: req.user.createdAt || null
    },
    stats: {
      posts: posts.length,
      comments: postComments.length,
      reactions: postReactions.length,
      hostedEvents: hostedEvents.length,
      eventResponses: eventResponses.length,
      postedInternships: postedInternships.length,
      internshipApplications: internshipApplications.length,
      attendanceClasses: attendanceSessions.length,
      attendanceRate
    },
    activity: {
      posts,
      postComments,
      postReactions,
      hostedEvents,
      eventResponses,
      postedInternships,
      internshipApplications,
      attendanceSessions,
      attendanceReports
    }
  });
}));

module.exports = router;
