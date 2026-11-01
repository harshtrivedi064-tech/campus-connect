const crypto = require('crypto');
const express = require('express');
const path = require('path');
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
const eventPhotoUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5, fieldSize: 1024 },
  fileFilter: (req, file, callback) => {
    if (!photoTypes[file.mimetype]) {
      return callback(new Error('Choose a JPG, PNG, WEBP, or GIF image.'));
    }
    callback(null, true);
  }
});

router.use(verifyToken);

function requireEventOrganizer(req, res, next) {
  if (!['admin', 'instructor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only instructors and admins can publish events.' });
  }
  next();
}

function parseEventPhoto(req, res, next) {
  eventPhotoUpload.single('photo')(req, res, error => {
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

router.get('/', asyncHandler(async (req, res) => {
  const data = await db.read();
  const events = data.events.slice().sort((a, b) => {
    const aDate = new Date(`${a.date}T${a.time || '00:00'}`);
    const bDate = new Date(`${b.date}T${b.time || '00:00'}`);
    return aDate - bDate;
  }).map(event => {
    const rsvps = Array.isArray(event.rsvps) ? event.rsvps : [];
    const userRsvp = rsvps.find(entry => entry.userId === req.user.id);
    return {
      ...event,
      rsvps,
      attendingCount: rsvps.filter(entry => entry.status === 'going').length,
      interestedCount: rsvps.filter(entry => entry.status === 'interested').length,
      declinedCount: rsvps.filter(entry => entry.status === 'not_going').length,
      userRsvp: userRsvp ? userRsvp.status : null
    };
  });
  res.json(events);
}));

router.post('/', requireEventOrganizer, parseEventPhoto, asyncHandler(async (req, res, next) => {
  const { title, date, time, location, description } = req.body || {};
  const cleanTitle = String(title || '').trim();
  const cleanLocation = String(location || '').trim();
  const cleanDescription = String(description || '').trim();

  if (!cleanTitle || !date || !time || !cleanLocation) {
    return res.status(400).json({ error: 'Event title, date, time, and location are required.' });
  }

  const dateParts = String(date).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const timeParts = String(time).match(/^(\d{2}):(\d{2})$/);
  const eventDate = new Date(`${date}T${time}`);
  const validDate = dateParts && eventDate.getFullYear() === Number(dateParts[1]) &&
    eventDate.getMonth() + 1 === Number(dateParts[2]) &&
    eventDate.getDate() === Number(dateParts[3]);
  const validTime = timeParts && Number(timeParts[1]) < 24 && Number(timeParts[2]) < 60;
  if (!validDate || !validTime || Number.isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: 'Please use a valid date and time.' });
  }
  if (cleanTitle.length > 80 || cleanLocation.length > 80 || cleanDescription.length > 280) {
    return res.status(400).json({ error: 'Event details exceed the allowed length.' });
  }

  let photoUrl;
  let photoFilename;
  if (req.file) {
    const photoType = photoTypes[req.file.mimetype];
    if (!photoType.matches(req.file.buffer)) {
      return res.status(400).json({ error: 'The uploaded file is not a valid image.' });
    }
    photoFilename = `${crypto.randomUUID()}.${photoType.extension}`;
    try {
      await db.savePhoto(photoFilename, req.file.mimetype, req.file.buffer);
      photoUrl = `/uploads/events/${photoFilename}`;
    } catch (error) {
      return next(error);
    }
  }

  let event;
  try {
    event = {
      id: crypto.randomUUID(),
      title: cleanTitle,
      date,
      time,
      location: cleanLocation,
      description: cleanDescription || 'No extra details provided.',
      organizer: req.user.name,
      organizerId: req.user.id,
      rsvps: [],
      createdAt: new Date().toISOString(),
      ...(photoUrl ? { photo: photoUrl } : {})
    };
    await db.update(data => data.events.unshift(event));
  } catch (error) {
    if (photoFilename) {
      try {
        await db.deletePhoto(photoFilename);
      } catch (cleanupError) {
        if (cleanupError.code !== 'ENOENT') console.error('Unable to remove unsaved event photo:', cleanupError);
      }
    }
    return next(error);
  }

  res.status(201).json(event);
}));

router.post('/:id/rsvp', asyncHandler(async (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['going', 'interested', 'not_going'].includes(status)) {
    return res.status(400).json({ error: 'Choose a valid RSVP status.' });
  }

  const outcome = await db.update(data => {
    const event = data.events.find(entry => entry.id === req.params.id);
    if (!event) return null;

    const rsvps = Array.isArray(event.rsvps) ? event.rsvps : [];
    const existing = rsvps.find(entry => entry.userId === req.user.id);
    if (existing) {
      existing.status = status;
      existing.name = req.user.name;
      existing.updatedAt = new Date().toISOString();
    } else {
      rsvps.push({
        userId: req.user.id,
        name: req.user.name,
        status,
        updatedAt: new Date().toISOString()
      });
    }
    event.rsvps = rsvps;
    return {
      eventId: event.id,
      status,
      attendingCount: rsvps.filter(entry => entry.status === 'going').length,
      interestedCount: rsvps.filter(entry => entry.status === 'interested').length,
      declinedCount: rsvps.filter(entry => entry.status === 'not_going').length
    };
  });

  if (!outcome) return res.status(404).json({ error: 'Event not found.' });
  res.json(outcome);
}));

router.delete('/:id', asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    const event = data.events.find(entry => entry.id === req.params.id);
    if (!event) return { error: 'missing' };
    if (event.organizerId !== req.user.id && req.user.role !== 'admin') {
      return { error: 'forbidden' };
    }
    data.events = data.events.filter(entry => entry.id !== req.params.id);
    return { event };
  });

  if (outcome.error === 'missing') {
    return res.status(404).json({ error: 'Event not found.' });
  }
  if (outcome.error === 'forbidden') {
    return res.status(403).json({ error: 'Only the event organizer can remove it.' });
  }

  const { event } = outcome;
  if (event.photo && /^\/uploads\/events\/[0-9a-f-]+\.(jpg|png|webp|gif)$/i.test(event.photo)) {
    try {
      await db.deletePhoto(path.basename(event.photo));
    } catch (error) {
      console.error('Unable to remove deleted event photo:', error);
    }
  }
  res.json({ message: 'Event removed.' });
}));

module.exports = router;
