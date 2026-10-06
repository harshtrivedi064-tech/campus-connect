// If the user is not logged in, send them to the login page
const currentUser = JSON.parse(localStorage.getItem('currentUser'));
if (!currentUser) {
    window.location.href = 'login.html';
}

document.getElementById('welcome').textContent = 'Welcome, ' + currentUser.name;

function addPost() {
    const text = document.getElementById('postText').value.trim();
    if (!text) return;

    const posts = JSON.parse(localStorage.getItem('posts')) || [];
    posts.unshift({
        name: currentUser.name,
        text: text,
        time: new Date().toLocaleString()
    });
    localStorage.setItem('posts', JSON.stringify(posts));

    document.getElementById('postText').value = '';
    showPosts();
}

function showPosts() {
    const posts = JSON.parse(localStorage.getItem('posts')) || [];
    const list = document.getElementById('postList');
    list.innerHTML = '';

    posts.forEach(p => {
        const div = document.createElement('div');
        div.className = 'post';

        const name = document.createElement('strong');
        name.textContent = p.name;

        const time = document.createElement('small');
        time.textContent = ' • ' + p.time;

        const text = document.createElement('p');
        text.textContent = p.text;

        div.append(name, time, text);
        list.appendChild(div);
    });
}

function logout() {
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

showPosts();