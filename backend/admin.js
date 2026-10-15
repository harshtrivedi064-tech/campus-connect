
const bcrypt = require('bcryptjs');
const db = require('./db');

async function createAdmin() {
    const name = (process.env.ADMIN_NAME || '').trim();
    const email = (process.env.ADMIN_EMAIL || '').trim().toLowerCase();
    const password = process.env.ADMIN_PASSWORD || '';

    if (!name || !email || password.length < 10) {
        console.error(
            'Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD (at least 10 characters).'
        );
        process.exitCode = 1;
        return;
    }

    const data = db.load();
    data.users = Array.isArray(data.users) ? data.users : [];

    const existing = data.users.find(user => user.email === email);
    const passwordHash = await bcrypt.hash(password, 10);

    if (existing) {
        existing.name = name;
        existing.password = passwordHash;
        existing.role = 'admin';
    } else {
        data.users.push({
            id: Date.now(),
            name,
            email,
            password: passwordHash,
            role: 'admin'
        });
    }

    db.save(data);
    console.log(`Admin account ready for ${email}`);
}

createAdmin().catch(error => {
    console.error('Could not create admin:', error.message);
    process.exitCode = 1;
});
