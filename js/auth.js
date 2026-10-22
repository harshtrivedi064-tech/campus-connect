const API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';

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
        showMessage('Cannot reach the server. Is the backend running?', 'red');
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
        showMessage('Cannot reach the server. Is the backend running?', 'red');
    }
}

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