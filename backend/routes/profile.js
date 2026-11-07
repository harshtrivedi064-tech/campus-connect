const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const db = require('../db');
const asyncHandler = require('../async-handler');
const { verifyToken } = require('./auth');

const router = express.Router();
const photoTypes = {
  'image/jpeg': { extension: 'jpg', matches: buffer =>
    buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff },
  'image/png': { extension: 'png', matches: buffer =>
    buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  'image/webp': { extension: 'webp', matches: buffer =>
    buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' &&
    buffer.toString('ascii', 8, 12) === 'WEBP' },
  'image/gif': { extension: 'gif', matches: buffer =>
    buffer.length >= 6 && ['GIF87a', 'GIF89a'].includes(buffer.toString('ascii', 0, 6)) }
};
const profilePhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 0 },
  fileFilter: (req, file, callback) => {
    if (!photoTypes[file.mimetype]) {
      return callback(new Error('Choose a JPG, PNG, WEBP, or GIF image.'));
    }
    callback(null, true);
  }
});
router.use(verifyToken);

function parseProfilePhoto(req, res, next) {
  profilePhotoUpload.single('picture')(req, res, error => {
    if (!error) return next();
    if (error instanceof multer.MulterError && error.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: 'The photo must be 5 MB or smaller.' });
    }
    if (error instanceof multer.MulterError || error.message.startsWith('Choose a ')) {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  });
}

router.put('/picture', parseProfilePhoto, asyncHandler(async (req, res, next) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Choose a profile picture to upload.' });
  }

  const photoType = photoTypes[req.file.mimetype];
  if (!photoType.matches(req.file.buffer)) {
    return res.status(400).json({ error: 'The uploaded file is not a valid image.' });
  }

  const filename = `${crypto.randomUUID()}.${photoType.extension}`;
  const profilePicture = `/uploads/profiles/${filename}`;
  try {
    await db.saveProfilePhoto(filename, req.file.mimetype, req.file.buffer);
    const previousPicture = await db.update(data => {
      const user = data.users.find(entry => String(entry.id) === String(req.user.id));
      if (!user) return null;
      const previous = user.profilePicture;
      user.profilePicture = profilePicture;
      return previous;
    });
    if (previousPicture === null) {
      await db.deleteProfilePhoto(filename);
      return res.status(404).json({ error: 'User not found.' });
    }
    if (typeof previousPicture === 'string') {
      const previousFilename = previousPicture.match(/^\/uploads\/profiles\/([0-9a-f-]+\.(?:jpg|png|webp|gif))$/i)?.[1];
      if (previousFilename) {
        try {
          await db.deleteProfilePhoto(previousFilename);
        } catch (error) {
          console.error('Unable to remove replaced profile photo:', error);
        }
      }
    }
    res.json({ profilePicture });
  } catch (error) {
    try {
      await db.deleteProfilePhoto(filename);
    } catch (cleanupError) {
      console.error('Unable to remove unsaved profile photo:', cleanupError);
    }
    next(error);
  }
}));

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
      createdAt: req.user.createdAt || null,
      ...(typeof req.user.profilePicture === 'string'
        ? { profilePicture: req.user.profilePicture }
        : {}),
      ...(typeof req.user.avatarUrl === 'string'
        ? { avatarUrl: req.user.avatarUrl }
        : {})
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
