const API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const token = localStorage.getItem('token');

let currentUser = null;
let allFeedPosts = [];
try {
    currentUser = JSON.parse(localStorage.getItem('currentUser') || 'null');
} catch {
    currentUser = null;
}

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = 'login.html';
}

async function apiRequest(path, method = 'GET', body) {
    const headers = {};
    const options = { method, headers };

    if (token) headers.Authorization = `Bearer ${token}`;
    if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(API + path, options);
    if (response.status === 401) {
        logout();
        throw new Error('Please log in again.');
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
        throw new Error(data.error || 'Unable to complete the request.');
    }
    return data;
}

function addFeedText(parent, tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    element.textContent = String(text ?? '');
    parent.appendChild(element);
    return element;
}

function showFeedMessage(text, isError = false) {
    const message = document.getElementById('quickPostMessage');
    message.textContent = text;
    message.classList.toggle('feed-message-error', isError);
}

function renderPost(post) {
    const article = document.createElement('article');
    article.className = 'feed-post';

    const header = document.createElement('div');
    header.className = 'feed-post-header';

    addFeedText(header, 'div', 'feed-avatar',
        (post.name || 'Campus Loop').trim().charAt(0).toUpperCase() || 'C');

    const identity = document.createElement('div');
    addFeedText(identity, 'strong', '', post.name || 'Campus Loop');
    const timestamp = new Date(post.time);
    addFeedText(identity, 'small', '',
        Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleString());
    header.appendChild(identity);
    article.appendChild(header);

    addFeedText(article, 'p', 'feed-post-content', post.text);

    if (currentUser && post.userId === currentUser.id) {
        const actions = document.createElement('div');
        actions.className = 'feed-post-actions';
        const remove = addFeedText(actions, 'button', '', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', () => deletePost(post.id, remove));
        article.appendChild(actions);
    }

    return article;
}

function renderFeedPosts() {
    const list = document.getElementById('quickFeedPosts');
    const query = document.getElementById('feedSearch').value.trim().toLocaleLowerCase();
    const sortOrder = document.getElementById('feedSort').value;
    const matchingPosts = allFeedPosts.filter(post =>
        String(post.text || '').toLocaleLowerCase().includes(query) ||
        String(post.name || '').toLocaleLowerCase().includes(query)
    );

    matchingPosts.sort((first, second) => {
        const firstTime = new Date(first.time).getTime() || 0;
        const secondTime = new Date(second.time).getTime() || 0;
        return sortOrder === 'oldest'
            ? firstTime - secondTime
            : secondTime - firstTime;
    });

    list.replaceChildren();
    const count = document.getElementById('feedResultCount');
    count.textContent = query
        ? `${matchingPosts.length} of ${allFeedPosts.length} posts`
        : `${allFeedPosts.length} ${allFeedPosts.length === 1 ? 'post' : 'posts'}`;

    if (!matchingPosts.length) {
        addFeedText(list, 'p', 'feed-muted', query
            ? 'No posts match your search.'
            : 'No posts yet. Be the first to share something!');
        return;
    }

    matchingPosts.forEach(post => list.appendChild(renderPost(post)));
}

async function loadPosts() {
    const list = document.getElementById('quickFeedPosts');
    list.replaceChildren();
    addFeedText(list, 'p', 'feed-muted', 'Loading posts...');
    document.getElementById('feedResultCount').textContent = '';

    try {
        const posts = await apiRequest('/posts');
        if (!Array.isArray(posts)) {
            throw new Error('The server returned an invalid posts response.');
        }
        allFeedPosts = posts;
        renderFeedPosts();
    } catch (error) {
        allFeedPosts = [];
        list.replaceChildren();
        addFeedText(list, 'p', 'feed-muted', error.message);
        const retry = addFeedText(list, 'button', 'feed-button', 'Try again');
        retry.type = 'button';
        retry.addEventListener('click', loadPosts);
        document.getElementById('feedResultCount').textContent = '';
    }
}

async function addPost(event) {
    event.preventDefault();
    const form = document.getElementById('quickPostForm');
    const input = document.getElementById('quickPostContent');
    const submit = form.querySelector('button[type="submit"]');
    const text = input.value.trim();

    if (!text) {
        showFeedMessage('Write something before sharing.', true);
        return;
    }

    submit.disabled = true;
    showFeedMessage('Sharing your post...');
    try {
        await apiRequest('/posts', 'POST', { text });
        input.value = '';
        showFeedMessage('Your post was shared.');
        await loadPosts();
    } catch (error) {
        showFeedMessage(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

async function deletePost(id, button) {
    if (!window.confirm('Delete this post?')) return;

    button.disabled = true;
    try {
        await apiRequest(`/posts/${encodeURIComponent(id)}`, 'DELETE');
        await loadPosts();
    } catch (error) {
        button.disabled = false;
        showFeedMessage(error.message, true);
    }
}

function initializeFeed() {
    if (!token || !currentUser || typeof currentUser.name !== 'string') {
        window.location.replace('login.html');
        return;
    }

    document.getElementById('quickPostForm').addEventListener('submit', addPost);
    document.getElementById('feedSearch').addEventListener('input', renderFeedPosts);
    document.getElementById('feedSort').addEventListener('change', renderFeedPosts);
    loadPosts();
}

initializeFeed();
