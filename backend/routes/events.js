const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const { verifyToken } = require('./auth');

const router = express.Router();

router.use(verifyToken);

router.get('/', (req, res) => {
  const data = db.load();
  const events = (data.events || []).slice().sort((a, b) => {
    const aDate = new Date(`${a.date}T${a.time || '00:00'}`);
    const bDate = new Date(`${b.date}T${b.time || '00:00'}`);
    return aDate - bDate;
  }).map((event) => {
    const rsvps = Array.isArray(event.rsvps) ? event.rsvps : [];
    const userRsvp = rsvps.find((entry) => entry.userId === req.user.id);

    return {
      ...event,
      rsvps,
      attendingCount: rsvps.filter((entry) => entry.status === 'going').length,
      interestedCount: rsvps.filter((entry) => entry.status === 'interested').length,
      declinedCount: rsvps.filter((entry) => entry.status === 'not_going').length,
      userRsvp: userRsvp ? userRsvp.status : null
    };
  });

  res.json(events);
});

router.post('/', (req, res) => {
  const { title, date, time, location, description } = req.body || {};
  const cleanTitle = String(title || '').trim();
  const cleanLocation = String(location || '').trim();
  const cleanDescription = String(description || '').trim();

  if (!cleanTitle || !date || !time || !cleanLocation) {
    return res.status(400).json({ error: 'Event title, date, time, and location are required.' });
  }

  const eventDate = new Date(`${date}T${time}`);
  if (Number.isNaN(eventDate.getTime())) {
    return res.status(400).json({ error: 'Please use a valid date and time.' });
  }

  const data = db.load();
  const event = {
    id: crypto.randomUUID(),
    title: cleanTitle,
    date,
    time,
    location: cleanLocation,
    description: cleanDescription || 'No extra details provided.',
    organizer: req.user.name,
    organizerId: req.user.id,
    rsvps: [],
    createdAt: new Date().toISOString()
  };

  data.events.unshift(event);
  db.save(data);

  res.status(201).json(event);
});

router.post('/:id/rsvp', (req, res) => {
  const status = String(req.body?.status || '').trim();
  if (!['going', 'interested', 'not_going'].includes(status)) {
    return res.status(400).json({ error: 'Choose a valid RSVP status.' });
  }

  const data = db.load();
  const event = (data.events || []).find((entry) => entry.id === req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  const rsvps = Array.isArray(event.rsvps) ? event.rsvps : [];
  const existing = rsvps.find((entry) => entry.userId === req.user.id);

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
  db.save(data);

  res.json({
    eventId: event.id,
    status,
    attendingCount: rsvps.filter((entry) => entry.status === 'going').length,
    interestedCount: rsvps.filter((entry) => entry.status === 'interested').length,
    declinedCount: rsvps.filter((entry) => entry.status === 'not_going').length
  });
});

router.delete('/:id', (req, res) => {
  const data = db.load();
  const event = (data.events || []).find((entry) => entry.id === req.params.id);

  if (!event) {
    return res.status(404).json({ error: 'Event not found.' });
  }

  if (event.organizerId !== req.user.id && req.user.role !== 'instructor') {
    return res.status(403).json({ error: 'Only the event organizer can remove it.' });
  }

  data.events = (data.events || []).filter((entry) => entry.id !== req.params.id);
  db.save(data);

  res.json({ message: 'Event removed.' });
});

module.exports = router;
