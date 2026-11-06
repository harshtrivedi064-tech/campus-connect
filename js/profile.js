const PROFILE_API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
  ? 'http://localhost:3000'
  : '';

function clearProfileSession() {
  localStorage.removeItem('token');
  localStorage.removeItem('currentUser');
  window.location.replace('login.html');
}

function profileText(parent, tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  element.textContent = text == null ? '' : String(text);
  parent.appendChild(element);
  return element;
}

function profileDate(value) {
  if (!value) return 'Date unavailable';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? 'Date unavailable'
    : date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function profileEmpty(container, message) {
  container.replaceChildren();
  profileText(container, 'p', 'profile-empty', message);
}

function profileEntry(container, title, detail, meta) {
  const card = document.createElement('article');
  card.className = 'profile-entry';
  profileText(card, 'h3', '', title);
  if (detail) profileText(card, 'p', 'profile-entry-detail', detail);
  if (meta) profileText(card, 'p', 'profile-entry-meta', meta);
  container.appendChild(card);
  return card;
}

function renderProfile(profile) {
  const { user, stats, activity } = profile;
  document.title = `${user.name} | Campus Loop Profile`;

  const overview = document.getElementById('profileOverview');
  document.getElementById('profileAvatar').textContent = user.name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map(part => part[0] || '')
    .join('')
    .toUpperCase();
  document.getElementById('profileName').textContent = user.name;
  document.getElementById('profileEmail').textContent = user.email;
  document.getElementById('profileRole').textContent =
    user.role.charAt(0).toUpperCase() + user.role.slice(1);
  document.getElementById('profileMemberSince').textContent =
    user.createdAt ? `Member since ${profileDate(user.createdAt)}` : 'Member since date unavailable';
  overview.hidden = false;

  const statsContainer = document.getElementById('profileStats');
  const statValues = [
    ['Posts', stats.posts],
    ['Comments', stats.comments],
    ['Reactions', stats.reactions],
    ['Event responses', stats.eventResponses],
    ['Events hosted', stats.hostedEvents],
    ['Internship applications', stats.internshipApplications],
    ['Opportunities posted', stats.postedInternships],
    [user.role === 'student' ? 'Attendance rate' : 'Classes taught',
      user.role === 'student'
        ? stats.attendanceRate === null ? '—' : `${stats.attendanceRate}%`
        : stats.attendanceClasses]
  ];
  statsContainer.replaceChildren();
  statValues.forEach(([label, value]) => {
    const stat = document.createElement('article');
    stat.className = 'profile-stat';
    profileText(stat, 'strong', '', value);
    profileText(stat, 'span', '', label);
    statsContainer.appendChild(stat);
  });
  statsContainer.hidden = false;
  document.getElementById('profileActivity').hidden = false;
  document.getElementById('profilePrivacy').hidden = false;
  document.getElementById('profileStatus').hidden = true;

  const posts = document.getElementById('profilePosts');
  if (!activity.posts.length && !activity.postComments.length && !activity.postReactions.length) {
    profileEmpty(posts, 'Your posts, comments, and reactions will appear here.');
  } else {
    posts.replaceChildren();
    activity.posts.forEach(post => {
      profileEntry(posts, post.text, '', `${profileDate(post.createdAt)} · ${post.likeCount} likes · ${post.commentCount} comments`);
    });
    activity.postComments.forEach(comment => {
      profileEntry(posts, `Your comment on: ${comment.postText}`, comment.text,
        profileDate(comment.createdAt));
    });
    activity.postReactions.forEach(reaction => {
      profileEntry(posts, `${reaction.reaction} a campus post`, reaction.postText, '');
    });
  }

  const events = document.getElementById('profileEvents');
  if (!activity.eventResponses.length && !activity.hostedEvents.length) {
    profileEmpty(events, 'Your event registrations and hosted events will appear here.');
  } else {
    events.replaceChildren();
    activity.eventResponses.forEach(event => {
      const card = profileEntry(events, event.title,
        `${event.date} · ${event.time} · ${event.location}`,
        `Your response: ${event.status.replace('_', ' ')}${event.registration?.program ? ` · ${event.registration.program}` : ''}`);
      if (event.registration?.email) {
        profileText(card, 'p', 'profile-entry-meta', `Registered with ${event.registration.email}`);
      }
      if (event.status === 'going' && event.registration) {
        profileText(card, 'span', 'profile-entry-badge', 'Registered');
      }
    });
    activity.hostedEvents.forEach(event => {
      profileEntry(events, event.title, `${event.date} · ${event.time} · ${event.location}`, 'Hosted by you');
    });
  }

  const internships = document.getElementById('profileInternships');
  if (!activity.internshipApplications.length && !activity.postedInternships.length) {
    profileEmpty(internships, 'Your applications and posted opportunities will appear here.');
  } else {
    internships.replaceChildren();
    activity.internshipApplications.forEach(application => {
      const card = profileEntry(internships, application.title, application.company,
        `Applied ${profileDate(application.submittedAt)}`);
      if (application.coverLetter) {
        profileText(card, 'p', 'profile-entry-detail', application.coverLetter);
      }
      if (application.resumeUrl) {
        try {
          const resumeUrl = new URL(application.resumeUrl);
          if (['http:', 'https:'].includes(resumeUrl.protocol)) {
            const link = profileText(card, 'a', 'profile-entry-link', 'View submitted resume');
            link.href = resumeUrl.href;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          }
        } catch (error) {
          console.warn('Skipped an invalid saved resume URL on the profile page.');
        }
      }
    });
    activity.postedInternships.forEach(internship => {
      profileEntry(internships, internship.title, internship.company,
        `Applications close ${profileDate(internship.deadline)} · Posted by you`);
    });
  }

  const attendance = document.getElementById('profileAttendance');
  if (!activity.attendanceSessions.length && !activity.attendanceReports.length) {
    profileEmpty(attendance, 'Your attendance sessions and correction requests will appear here.');
  } else {
    attendance.replaceChildren();
    activity.attendanceSessions.forEach(session => {
      const detail = user.role === 'student'
        ? `Status: ${session.status}`
        : `${session.presentCount} present · ${session.studentCount} students`;
      profileEntry(attendance, session.className, `${session.date} · ${detail}`, '');
    });
    activity.attendanceReports.forEach(report => {
      profileEntry(attendance, `${report.className} · correction request`,
        report.reason, `${profileDate(report.createdAt)} · ${report.status}`);
    });
  }
}

async function loadProfile() {
  const token = localStorage.getItem('token');
  if (!token) {
    clearProfileSession();
    return;
  }

  try {
    const response = await fetch(`${PROFILE_API}/profile`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (response.status === 401) {
      clearProfileSession();
      return;
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Could not load your profile.');
    renderProfile(data);
  } catch (error) {
    const status = document.getElementById('profileStatus');
    status.textContent = error.message || 'Could not load your profile. Please try again.';
    status.classList.add('profile-status-error');
  }
}

document.getElementById('profileLogout').addEventListener('click', event => {
  event.preventDefault();
  clearProfileSession();
});

loadProfile();
