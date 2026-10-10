const fs = require('fs');
const path = require('path');

const FILE = process.env.CAMPUS_CONNECT_DATA_FILE || path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(FILE)) {
    const initialData = { users: [], posts: [], attendanceSessions: [], events: [] };
    fs.writeFileSync(FILE, JSON.stringify(initialData, null, 2));
  }

  const data = JSON.parse(fs.readFileSync(FILE, 'utf8'));
  data.users = data.users || [];
  data.posts = data.posts || [];
  data.attendanceSessions = data.attendanceSessions || [];
  data.events = data.events || [];
  return data;
}

function save(data) {
  fs.writeFileSync(FILE, JSON.stringify(data, null, 2));
}

module.exports = { load, save };
