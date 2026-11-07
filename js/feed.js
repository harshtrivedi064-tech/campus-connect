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

function setFeedAvatar(avatar, name, imageUrl) {
    const fallback = (name || 'Campus Loop').trim().charAt(0).toUpperCase() || 'C';
    avatar.textContent = fallback;
    if (typeof imageUrl !== 'string' || !imageUrl.trim()) return;

    let url;
    try {
        url = new URL(imageUrl, API || window.location.origin);
    } catch {
        return;
    }
    const apiOrigin = new URL(API || window.location.origin, window.location.origin).origin;
    if (!['http:', 'https:'].includes(url.protocol) ||
        (url.origin !== window.location.origin && url.origin !== apiOrigin)) return;

    const image = document.createElement('img');
    image.alt = '';
    image.src = url.href;
    image.addEventListener('error', () => {
        image.remove();
        avatar.textContent = fallback;
    }, { once: true });
    avatar.replaceChildren(image);
}

function renderPost(post) {
    const article = document.createElement('article');
    article.className = 'feed-post';

    const header = document.createElement('div');
    header.className = 'feed-post-header';

    const avatar = addFeedText(header, 'div', 'feed-avatar', '');
    setFeedAvatar(avatar, post.name, post.profilePicture || post.avatarUrl);

    const identity = document.createElement('div');
    addFeedText(identity, 'strong', '', post.name || 'Campus Loop');
    const timestamp = new Date(post.time);
    addFeedText(identity, 'small', '',
        Number.isNaN(timestamp.getTime()) ? '' : timestamp.toLocaleString());
    header.appendChild(identity);
    article.appendChild(header);

    addFeedText(article, 'p', 'feed-post-content', post.text);

    const actions = document.createElement('div');
    actions.className = 'feed-post-actions';

    [
        { vote: 'like', label: `Like · ${post.likeCount || 0}` },
        { vote: 'dislike', label: `Dislike · ${post.dislikeCount || 0}` }
    ].forEach(({ vote, label }) => {
        const button = addFeedText(actions, 'button', 'feed-reaction', label);
        button.type = 'button';
        button.classList.toggle('active', post.userVote === vote);
        button.setAttribute('aria-pressed', String(post.userVote === vote));
        button.addEventListener('click', async () => {
            button.disabled = true;
            try {
                await apiRequest(`/posts/${encodeURIComponent(post.id)}/vote`, 'POST', {
                    vote: post.userVote === vote ? 'none' : vote
                });
                await loadPosts();
            } catch (error) {
                showFeedMessage(error.message, true);
                button.disabled = false;
            }
        });
    });

    const commentToggle = addFeedText(
        actions, 'button', 'feed-reaction',
        `Comments · ${(post.comments || []).length}`
    );
    commentToggle.type = 'button';
    commentToggle.setAttribute('aria-expanded', 'true');

    if (currentUser && post.userId === currentUser.id) {
        const remove = addFeedText(actions, 'button', '', 'Delete');
        remove.type = 'button';
        remove.addEventListener('click', () => deletePost(post.id, remove));
    }
    article.appendChild(actions);

    const comments = document.createElement('section');
    comments.className = 'feed-comments';
    comments.setAttribute('aria-label', 'Post comments');
    const commentList = document.createElement('div');
    commentList.className = 'feed-comment-list';

    (post.comments || []).forEach(comment => {
        const item = document.createElement('article');
        item.className = 'feed-comment';
        const detail = addFeedText(item, 'p', 'feed-comment-meta', comment.name || 'Campus member');
        const time = new Date(comment.time);
        if (!Number.isNaN(time.getTime())) {
            detail.append(' · ', document.createTextNode(time.toLocaleString()));
        }
        addFeedText(item, 'p', 'feed-comment-text', comment.text);
        if (currentUser &&
            (comment.userId === currentUser.id || post.userId === currentUser.id)) {
            const remove = addFeedText(item, 'button', 'feed-comment-delete', 'Delete comment');
            remove.type = 'button';
            remove.addEventListener('click', async () => {
                remove.disabled = true;
                try {
                    await apiRequest(
                        `/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(comment.id)}`,
                        'DELETE'
                    );
                    await loadPosts();
                } catch (error) {
                    showFeedMessage(error.message, true);
                    remove.disabled = false;
                }
            });
        }
        commentList.appendChild(item);
    });
    comments.appendChild(commentList);

    const commentForm = document.createElement('form');
    commentForm.className = 'feed-comment-form';
    const commentInput = document.createElement('input');
    commentInput.type = 'text';
    commentInput.maxLength = 500;
    commentInput.placeholder = 'Write a thoughtful comment...';
    commentInput.setAttribute('aria-label', 'Write a comment');
    commentInput.required = true;
    const send = addFeedText(commentForm, 'button', 'feed-button', 'Comment');
    send.type = 'submit';
    commentForm.prepend(commentInput);
    commentForm.addEventListener('submit', async event => {
        event.preventDefault();
        send.disabled = true;
        try {
            await apiRequest(`/posts/${encodeURIComponent(post.id)}/comments`, 'POST', {
                text: commentInput.value
            });
            await loadPosts();
        } catch (error) {
            showFeedMessage(error.message, true);
            send.disabled = false;
        }
    });
    comments.appendChild(commentForm);
    commentToggle.addEventListener('click', () => {
        comments.hidden = !comments.hidden;
        commentToggle.setAttribute('aria-expanded', String(!comments.hidden));
    });
    article.appendChild(comments);

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
