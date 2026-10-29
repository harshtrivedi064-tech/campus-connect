const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');
const db = require('../db');

const router = express.Router();
const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);
const GOOGLE_STATE_COOKIE = 'campus_google_state';
const SECRET = process.env.JWT_SECRET ||
  (process.env.NODE_ENV === 'production' ? '' : 'campus-loop-local-development-only');

if (!SECRET) {
  throw new Error('JWT_SECRET must be configured in production.');
}

function googleOAuthConfig() {
  const { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI } = process.env;
  return GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET && GOOGLE_REDIRECT_URI
    ? { clientId: GOOGLE_CLIENT_ID, clientSecret: GOOGLE_CLIENT_SECRET, redirectUri: GOOGLE_REDIRECT_URI }
    : null;
}

function clearGoogleStateCookie(res) {
  res.setHeader('Set-Cookie',
    `${GOOGLE_STATE_COOKIE}=; HttpOnly; SameSite=Lax; Path=/auth/google/callback; Max-Age=0` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));
}

function issueLoginToken(user) {
  return {
    token: jwt.sign({ id: user.id }, SECRET, { expiresIn: '7d' }),
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role || 'student'
    }
  };
}

router.get('/google', (req, res) => {
  const config = googleOAuthConfig();
  if (!config) {
    return res.redirect('/login.html?google_error=not_configured');
  }

  const state = crypto.randomBytes(32).toString('base64url');
  res.setHeader('Set-Cookie',
    `${GOOGLE_STATE_COOKIE}=${state}; HttpOnly; SameSite=Lax; Path=/auth/google/callback; Max-Age=600` +
      (process.env.NODE_ENV === 'production' ? '; Secure' : ''));

  const authorizationUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  authorizationUrl.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    prompt: 'select_account'
  }).toString();
  res.redirect(authorizationUrl.toString());
});

router.get('/google/callback', async (req, res) => {
  const config = googleOAuthConfig();
  const cookies = Object.fromEntries(
    (req.headers.cookie || '').split(';').map(cookie => {
      const separator = cookie.indexOf('=');
      return separator < 0
        ? ['', '']
        : [cookie.slice(0, separator).trim(), cookie.slice(separator + 1).trim()];
    }).filter(([name]) => name)
  );
  const expectedState = cookies[GOOGLE_STATE_COOKIE];
  clearGoogleStateCookie(res);

  if (!config) {
    return res.redirect('/login.html?google_error=not_configured');
  }
  if (req.query.error) {
    return res.redirect('/login.html?google_error=cancelled');
  }

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  if (!expectedState || !state ||
      Buffer.byteLength(state) !== Buffer.byteLength(expectedState) ||
      !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(expectedState))) {
    return res.redirect('/login.html?google_error=state');
  }

  if (typeof req.query.code !== 'string') {
    return res.redirect('/login.html?google_error=failed');
  }

  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: req.query.code,
        client_id: config.clientId,
        client_secret: config.clientSecret,
        redirect_uri: config.redirectUri,
        grant_type: 'authorization_code'
      })
    });
    const tokens = await tokenResponse.json();
    if (!tokenResponse.ok || !tokens.id_token) {
      console.error('Google token exchange failed:', tokens.error || tokenResponse.status);
      return res.redirect('/login.html?google_error=failed');
    }

    const ticket = await googleClient.verifyIdToken({
      idToken: tokens.id_token,
      audience: config.clientId
    });
    const profile = ticket.getPayload();
    if (!profile || !profile.sub || !profile.email || profile.email_verified !== true) {
      return res.redirect('/login.html?google_error=email');
    }

    const data = db.load();
    const email = profile.email.trim().toLowerCase();
    let user = data.users.find(entry => entry.googleId === profile.sub) ||
      data.users.find(entry => entry.email === email);

    if (user && user.googleId && user.googleId !== profile.sub) {
      return res.redirect('/login.html?google_error=account');
    }
    if (!user) {
      let id = Date.now();
      while (data.users.some(entry => entry.id === id)) id++;
      user = {
        id,
        name: profile.name || email.split('@')[0],
        email,
        password: null,
        role: 'student',
        googleId: profile.sub
      };
      data.users.push(user);
    } else if (!user.googleId) {
      user.googleId = profile.sub;
    }

    db.save(data);
    const login = issueLoginToken(user);
    const fragment = new URLSearchParams({
      token: login.token,
      user: Buffer.from(JSON.stringify(login.user)).toString('base64url')
    });
    res.redirect(`/login.html#google=${encodeURIComponent(fragment.toString())}`);
  } catch (error) {
    console.error('Google sign-in failed:', error);
    res.redirect('/login.html?google_error=failed');
  }
});

router.post('/signup', async (req, res) => {
  const { name, email, password, role } = req.body || {};

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Please fill in all fields.' });
  }

  if (String(password).length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  if (!['student', 'instructor'].includes(role)) {
    return res.status(400).json({ error: 'Choose whether you are a student or instructor.' });
  }

  const data = db.load();
  const cleanEmail = String(email).trim().toLowerCase();

  if (data.users.some((user) => user.email === cleanEmail)) {
    return res.status(400).json({ error: 'This email is already registered.' });
  }

  const hash = await bcrypt.hash(String(password), 10);
  data.users.push({
    id: Date.now(),
    name: String(name).trim(),
    email: cleanEmail,
    password: hash,
    role
  });
  db.save(data);

  res.json({ message: 'Account created! Please log in.' });
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  const data = db.load();
  const user = data.users.find((entry) => entry.email === String(email || '').trim().toLowerCase());

  if (!user || !user.password ||
      !(await bcrypt.compare(String(password || ''), user.password))) {
    return res.status(401).json({ error: 'Incorrect email or password.' });
  }

  res.json(issueLoginToken(user));
});

function verifyToken(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token) {
    return res.status(401).json({ error: 'Please log in again.' });
  }

  try {
    const payload = jwt.verify(token, SECRET);
    const data = db.load();
    const user = data.users.find((entry) => entry.id === payload.id);

    if (!user) {
      return res.status(401).json({ error: 'User not found.' });
    }

    req.user = { ...user, role: user.role || 'student' };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Please log in again.' });
  }
}

module.exports = { router, verifyToken };
