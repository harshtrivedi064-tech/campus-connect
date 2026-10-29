const API = window.location.protocol === 'file:' ||
    /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const CONNECTION_ERROR =
    'Cannot connect to Campus Loop. Run the backend with "npm start" from the backend folder, or open the deployed site and try again.';

function showSignup() {
    document.getElementById('loginSection').style.display = 'none';
    document.getElementById('signupSection').style.display = 'block';
    document.getElementById('message').textContent = '';
}

function showLogin() {
    document.getElementById('signupSection').style.display = 'none';
    document.getElementById('loginSection').style.display = 'block';
    document.getElementById('message').textContent = '';
}

function showMessage(text, color) {
    const message = document.getElementById('message');
    message.style.color = color;
    message.textContent = text;
}

function startGoogleLogin() {
    window.location.href = API + '/auth/google';
}

function handleGoogleLoginReturn() {
    const params = new URLSearchParams(window.location.search);
    const googleError = params.get('google_error');

    if (googleError) {
        const messages = {
            not_configured: 'Google sign-in is not configured on this server yet.',
            cancelled: 'Google sign-in was cancelled.',
            state: 'Google sign-in could not be verified. Please try again.',
            email: 'Google did not provide a verified email address.',
            account: 'This Google account is linked to a different Campus Loop account.',
            failed: 'Google sign-in failed. Please try again.'
        };
        showMessage(messages[googleError] || messages.failed, 'red');
        window.history.replaceState(null, '', window.location.pathname);
        return;
    }

    const hash = new URLSearchParams(window.location.hash.slice(1));
    const googleResult = hash.get('google');
    if (!googleResult) return;

    window.history.replaceState(null, '', window.location.pathname + window.location.search);
    try {
        const result = new URLSearchParams(googleResult);
        const token = result.get('token');
        const encodedUser = result.get('user');
        if (!token || !encodedUser) throw new Error('Missing Google sign-in details.');

        const base64 = encodedUser.replace(/-/g, '+').replace(/_/g, '/');
        const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, '=');
        const bytes = Uint8Array.from(atob(padded), character => character.charCodeAt(0));
        const user = JSON.parse(new TextDecoder().decode(bytes));
        if (!user || !Number.isSafeInteger(user.id) || !user.email ||
            !['student', 'instructor'].includes(user.role)) {
            throw new Error('Invalid Google sign-in details.');
        }

        localStorage.setItem('token', token);
        localStorage.setItem('currentUser', JSON.stringify(user));
        window.location.replace('feed.html');
    } catch (error) {
        showMessage('Could not complete Google sign-in. Please try again.', 'red');
    }
}

async function signup() {
    const name = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('signupPassword').value;
    const role = document.getElementById('signupRole').value;

    if (!name || !email || !password) {
        showMessage('Please fill in all fields.', 'red');
        return;
    }

    try {
        const res = await fetch(API + '/auth/signup', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, email, password, role })
        });
        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error, 'red');
            return;
        }

        showLogin();
        showMessage(data.message, 'green');
    } catch (err) {
        showMessage(CONNECTION_ERROR, 'red');
    }
}

async function login() {
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;

    try {
        const res = await fetch(API + '/auth/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password })
        });
        const data = await res.json();

        if (!res.ok) {
            showMessage(data.error, 'red');
            return;
        }

        localStorage.setItem('token', data.token);
        localStorage.setItem('currentUser', JSON.stringify(data.user));
        window.location.href = 'feed.html';
    } catch (err) {
        showMessage(CONNECTION_ERROR, 'red');
    }
}

handleGoogleLoginReturn();

// Press Enter to submit the visible form
document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter') return;
    const signupVisible = document.getElementById('signupSection').style.display !== 'none';
    if (signupVisible) {
        signup();
    } else {
        login();
    }
});