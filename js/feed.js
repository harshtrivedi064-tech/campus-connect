const API = 'http://localhost:3000';

// If the user is not logged in, send them to the login page
const token = localStorage.getItem('token');
const currentUser = JSON.parse(localStorage.getItem('currentUser'));
if (!token || !currentUser) {
    window.location.href = 'login.html';
}

document.getElementById('welcome').textContent = 'Welcome, ' + currentUser.name;

const postText = document.getElementById('postText');
const counter = document.getElementById('counter');

postText.addEventListener('input', function () {
    counter.textContent = postText.value.length + ' / 300';
});

// Helper: sends a request with the login token
async function apiRequest(path, method, body) {
    const res = await fetch(API + path, {
        method: method || 'GET',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': 'Bearer ' + token
        },
        body: body ? JSON.stringify(body) : undefined
    });

    if (res.status === 401) {
        logout();
        return null;
    }

    const data = await res.json();
    if (!res.ok) {
        alert(data.error || 'Something went wrong.');
        return null;
    }
    return data;
}

async function addPost() {
    const text = postText.value.trim();
    if (!text) return;

    const post = await apiRequest('/posts', 'POST', { text });
    if (!post) return;

    postText.value = '';
    counter.textContent = '0 / 300';
    showPosts();
}

async function deletePost(id) {
    if (!confirm('Delete this post?')) return;
    const result = await apiRequest('/posts/' + id, 'DELETE');
    if (result) showPosts();
}

async function showPosts() {
    const list = document.getElementById('postList');

    let posts;
    try {
        posts = await apiRequest('/posts');
    } catch (err) {
        list.innerHTML = '';
        const msg = document.createElement('p');
        msg.className = 'empty';
        msg.textContent = 'Cannot reach the server. Is the backend running?';
        list.appendChild(msg);
        return;
    }
    if (!posts) return;

    list.innerHTML = '';

    if (posts.length === 0) {
        const empty = document.createElement('p');
        empty.className = 'empty';
        empty.textContent = 'No posts yet. Be the first to share something!';
        list.appendChild(empty);
        return;
    }

    posts.forEach(p => {
        const div = document.createElement('div');
        div.className = 'post';

        const header = document.createElement('div');
        header.className = 'post-header';

        const avatar = document.createElement('div');
        avatar.className = 'avatar';
        avatar.textContent = p.name.charAt(0).toUpperCase();

        const info = document.createElement('div');
        info.className = 'post-info';

        const name = document.createElement('strong');
        name.textContent = p.name;

        const time = document.createElement('small');
        time.textContent = new Date(p.time).toLocaleString();

        info.append(name, time);
        header.append(avatar, info);

        if (p.userId === currentUser.id) {
            const del = document.createElement('button');
            del.className = 'delete-btn';
            del.textContent = 'Delete';
            del.onclick = function () { deletePost(p.id); };
            header.appendChild(del);
        }

        const text = document.createElement('p');
        text.className = 'post-text';
        text.textContent = p.text;

        div.append(header, text);
        list.appendChild(div);
    });
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

showPosts();