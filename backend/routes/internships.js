const crypto = require('crypto');
const express = require('express');
const db = require('../db');
const asyncHandler = require('../async-handler');
const { verifyToken } = require('./auth');

const router = express.Router();
router.use(verifyToken);

function isValidDate(value) {
  const parts = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!parts) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return date.getUTCFullYear() === Number(parts[1]) &&
    date.getUTCMonth() + 1 === Number(parts[2]) &&
    date.getUTCDate() === Number(parts[3]);
}

function requireOpportunityManager(req, res, next) {
  if (!['admin', 'instructor'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Only instructors and admins can post internships.' });
  }
  next();
}

function cleanText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

router.get('/', asyncHandler(async (req, res) => {
  const data = await db.read();
  const internships = data.internships.slice()
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(internship => {
      const { applications, ...publicInternship } = internship;
      const submittedApplications = Array.isArray(applications) ? applications : [];
      return {
        ...publicInternship,
        applicationCount: submittedApplications.length,
        hasApplied: submittedApplications.some(application => application.userId === req.user.id)
      };
    });
  res.json(internships);
}));

router.post('/', requireOpportunityManager, asyncHandler(async (req, res) => {
  const body = req.body || {};
  const title = cleanText(body.title);
  const company = cleanText(body.company);
  const location = cleanText(body.location);
  const type = cleanText(body.type);
  const workMode = cleanText(body.workMode);
  const stipend = cleanText(body.stipend);
  const deadline = cleanText(body.deadline);
  const description = cleanText(body.description);
  const eligibility = cleanText(body.eligibility);

  if (!title || !company || !location || !type || !workMode || !deadline || !description) {
    return res.status(400).json({ error: 'Complete all required internship details.' });
  }
  if (!['Internship', 'Co-op', 'Part-time'].includes(type)) {
    return res.status(400).json({ error: 'Choose a valid opportunity type.' });
  }
  if (!['On-site', 'Hybrid', 'Remote'].includes(workMode)) {
    return res.status(400).json({ error: 'Choose a valid work mode.' });
  }
  if (!isValidDate(deadline)) {
    return res.status(400).json({ error: 'Enter a valid application deadline.' });
  }
  if (title.length > 100 || company.length > 100 || location.length > 100 ||
      stipend.length > 80 || description.length > 3000 || eligibility.length > 1000) {
    return res.status(400).json({ error: 'Internship details exceed the allowed length.' });
  }

  const internship = {
    id: crypto.randomUUID(),
    title,
    company,
    location,
    type,
    workMode,
    stipend,
    deadline,
    description,
    eligibility,
    postedBy: req.user.name,
    postedById: req.user.id,
    applications: [],
    createdAt: new Date().toISOString()
  };
  await db.update(data => data.internships.unshift(internship));
  const { applications, ...publicInternship } = internship;
  res.status(201).json({ ...publicInternship, applicationCount: applications.length, hasApplied: false });
}));

router.post('/:id/applications', asyncHandler(async (req, res) => {
  if (req.user.role !== 'student') {
    return res.status(403).json({ error: 'Only students can apply for internships.' });
  }

  const coverLetter = cleanText(req.body?.coverLetter);
  const resumeUrl = cleanText(req.body?.resumeUrl);
  if (!coverLetter) {
    return res.status(400).json({ error: 'A short introduction is required.' });
  }
  if (coverLetter.length > 2000) {
    return res.status(400).json({ error: 'Your introduction must be 2,000 characters or fewer.' });
  }
  if (resumeUrl) {
    try {
      const parsedUrl = new URL(resumeUrl);
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error('Invalid protocol.');
    } catch {
      return res.status(400).json({ error: 'Enter a valid HTTP or HTTPS resume link.' });
    }
    if (resumeUrl.length > 500) {
      return res.status(400).json({ error: 'The resume link must be 500 characters or fewer.' });
    }
  }

  const outcome = await db.update(data => {
    const internship = data.internships.find(entry => entry.id === req.params.id);
    if (!internship) return { error: 'missing' };
    if (isValidDate(internship.deadline) &&
        new Date(`${internship.deadline}T23:59:59.999Z`) < new Date()) {
      return { error: 'closed' };
    }

    const applications = Array.isArray(internship.applications)
      ? internship.applications
      : [];
    if (applications.some(application => application.userId === req.user.id)) {
      return { error: 'duplicate' };
    }
    applications.push({
      id: crypto.randomUUID(),
      userId: req.user.id,
      name: req.user.name,
      email: req.user.email,
      coverLetter,
      ...(resumeUrl ? { resumeUrl } : {}),
      submittedAt: new Date().toISOString()
    });
    internship.applications = applications;
    return { applicationId: applications[applications.length - 1].id };
  });

  if (outcome.error === 'missing') return res.status(404).json({ error: 'Internship not found.' });
  if (outcome.error === 'closed') return res.status(400).json({ error: 'Applications for this internship are closed.' });
  if (outcome.error === 'duplicate') return res.status(409).json({ error: 'You have already applied for this internship.' });
  res.status(201).json({ message: 'Your application has been submitted.', applicationId: outcome.applicationId });
}));

router.get('/:id/applications', asyncHandler(async (req, res) => {
  const data = await db.read();
  const internship = data.internships.find(entry => entry.id === req.params.id);
  if (!internship) return res.status(404).json({ error: 'Internship not found.' });
  if (internship.postedById !== req.user.id && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Only the internship poster can view applications.' });
  }
  res.json(Array.isArray(internship.applications) ? internship.applications : []);
}));

router.delete('/:id', requireOpportunityManager, asyncHandler(async (req, res) => {
  const outcome = await db.update(data => {
    const internship = data.internships.find(entry => entry.id === req.params.id);
    if (!internship) return 'missing';
    if (internship.postedById !== req.user.id && req.user.role !== 'admin') {
      return 'forbidden';
    }
    data.internships = data.internships.filter(entry => entry.id !== req.params.id);
    return 'deleted';
  });
  if (outcome === 'missing') return res.status(404).json({ error: 'Internship not found.' });
  if (outcome === 'forbidden') {
    return res.status(403).json({ error: 'Only the internship poster can remove it.' });
  }
  res.json({ message: 'Internship removed.' });
}));

module.exports = router;
