const API = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)
    ? 'http://localhost:3000'
    : '';
const token = localStorage.getItem('token');
const PAGE_SIZE = 10;

let currentUser = null;
let allFeedPosts = [];
let currentPage = 1;
let hasMorePosts = false;
let loadingPosts = false;
let reloadAfterCurrent = false;
let searchTimer = null;
let attachmentPreviewUrl = null;

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
    const headers = { Authorization: `Bearer ${token}` };
    const options = { method, headers };
    if (body instanceof FormData) {
        options.body = body;
    } else if (body !== undefined) {
        headers['Content-Type'] = 'application/json';
        options.body = JSON.stringify(body);
    }

    const response = await fetch(API + path, options);
    if (response.status === 401) {
        logout();
        throw new Error('Please log in again.');
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to complete the request.');
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
    image.loading = 'lazy';
    image.src = url.href;
    image.addEventListener('error', () => {
        image.remove();
        avatar.textContent = fallback;
    }, { once: true });
    avatar.replaceChildren(image);
}

function postAttachmentUrl(post) {
    if (!post.attachment?.url) return '';
    try {
        const url = new URL(post.attachment.url, API || window.location.origin);
        const apiOrigin = new URL(API || window.location.origin, window.location.origin).origin;
        if (url.origin !== apiOrigin || !url.pathname.startsWith('/posts/attachments/')) return '';
        return url.href;
    } catch {
        return '';
    }
}

function makeButton(parent, className, label, handler) {
    const button = addFeedText(parent, 'button', className, label);
    button.type = 'button';
    button.addEventListener('click', handler);
    return button;
}

function updatePostLocally(postId, changes) {
    const post = allFeedPosts.find(entry => String(entry.id) === String(postId));
    if (!post) return;
    Object.assign(post, changes);
    renderFeedPosts();
}

async function voteForPost(post) {
    const vote = post.userVote === 'like' ? 'none' : 'like';
    try {
        const outcome = await apiRequest(
            `/posts/${encodeURIComponent(post.id)}/vote`, 'POST', { vote }
        );
        updatePostLocally(post.id, outcome);
    } catch (error) {
        showFeedMessage(error.message, true);
    }
}

async function toggleSave(post) {
    try {
        const outcome = await apiRequest(
            `/posts/${encodeURIComponent(post.id)}/save`, 'POST', { saved: !post.isSaved }
        );
        updatePostLocally(post.id, { isSaved: outcome.saved });
    } catch (error) {
        showFeedMessage(error.message, true);
    }
}

function renderAttachment(post, parent) {
    const url = postAttachmentUrl(post);
    if (!url) return;
    const attachment = post.attachment;
    if (attachment.type === 'image') {
        const link = document.createElement('a');
        link.className = 'feed-post-attachment';
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        const image = document.createElement('img');
        image.src = url;
        image.alt = attachment.name || 'Post image';
        image.loading = 'lazy';
        link.appendChild(image);
        parent.appendChild(link);
        return;
    }

    const link = document.createElement('a');
    link.className = 'feed-post-attachment pdf';
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    addFeedText(link, 'span', 'feed-attachment-icon', 'PDF');
    const description = document.createElement('span');
    addFeedText(description, 'strong', '', attachment.name || 'Study material');
    addFeedText(description, 'small', 'feed-muted',
        `${Math.max(1, Math.round((attachment.size || 0) / 1024))} KB · Open PDF`);
    link.appendChild(description);
    parent.appendChild(link);
}

function renderComment(comment, post, parent, isReply = false) {
    const item = document.createElement('article');
    item.className = `feed-comment${isReply ? ' feed-comment-reply' : ''}`;
    const meta = addFeedText(item, 'p', 'feed-comment-meta', comment.name || 'Campus member');
    const time = new Date(comment.time);
    if (!Number.isNaN(time.getTime())) {
        meta.append(' · ', document.createTextNode(time.toLocaleString()));
    }
    addFeedText(item, 'p', 'feed-comment-text', comment.text);
    const mayDelete = currentUser &&
        (String(comment.userId) === String(currentUser.id) ||
            String(post.userId) === String(currentUser.id) ||
            currentUser.role === 'admin');
    if (mayDelete) {
        makeButton(item, 'feed-comment-delete', 'Delete', async () => {
            if (!window.confirm('Delete this comment and its replies?')) return;
            try {
                await apiRequest(
                    `/posts/${encodeURIComponent(post.id)}/comments/${encodeURIComponent(comment.id)}`,
                    'DELETE'
                );
                post.comments = post.comments.filter(entry =>
                    entry.id !== comment.id && entry.parentCommentId !== comment.id);
                updatePostLocally(post.id, { comments: post.comments, commentCount: post.comments.length });
            } catch (error) {
                showFeedMessage(error.message, true);
            }
        });
    }
    if (!isReply) {
        makeButton(item, 'feed-comment-reply-button', 'Reply', () => {
            const existing = item.querySelector('.feed-reply-form');
            if (existing) {
                existing.remove();
                return;
            }
            const form = document.createElement('form');
            form.className = 'feed-comment-form feed-reply-form';
            const input = document.createElement('input');
            input.type = 'text';
            input.maxLength = 500;
            input.placeholder = `Reply to ${comment.name || 'this comment'}…`;
            input.setAttribute('aria-label', 'Reply to comment');
            input.required = true;
            const submit = addFeedText(form, 'button', 'feed-button', 'Reply');
            submit.type = 'submit';
            form.prepend(input);
            form.addEventListener('submit', event => {
                event.preventDefault();
                submit.disabled = true;
                apiRequest(`/posts/${encodeURIComponent(post.id)}/comments`, 'POST', {
                    text: input.value,
                    parentCommentId: comment.id
                }).then(reply => {
                    post.comments.push(reply);
                    updatePostLocally(post.id, {
                        comments: post.comments,
                        commentCount: post.comments.length
                    });
                }).catch(error => {
                    submit.disabled = false;
                    showFeedMessage(error.message, true);
                });
            });
            item.appendChild(form);
            input.focus();
        });
    }
    parent.appendChild(item);
}

function renderComments(post, section) {
    const commentList = document.createElement('div');
    commentList.className = 'feed-comment-list';
    const comments = Array.isArray(post.comments) ? post.comments : [];
    comments.filter(comment => !comment.parentCommentId)
        .forEach(comment => {
            renderComment(comment, post, commentList);
            comments.filter(reply => reply.parentCommentId === comment.id)
                .forEach(reply => renderComment(reply, post, commentList, true));
        });
    section.appendChild(commentList);

    const form = document.createElement('form');
    form.className = 'feed-comment-form';
    const input = document.createElement('input');
    input.type = 'text';
    input.maxLength = 500;
    input.placeholder = 'Write a thoughtful comment…';
    input.setAttribute('aria-label', 'Write a comment');
    input.required = true;
    const submit = addFeedText(form, 'button', 'feed-button', 'Comment');
    submit.type = 'submit';
    form.prepend(input);
    form.addEventListener('submit', event => {
        event.preventDefault();
        submit.disabled = true;
        apiRequest(`/posts/${encodeURIComponent(post.id)}/comments`, 'POST', {
            text: input.value
        }).then(comment => {
            post.comments = [...comments, comment];
            updatePostLocally(post.id, {
                comments: post.comments,
                commentCount: post.comments.length
            });
        }).catch(error => {
            submit.disabled = false;
            showFeedMessage(error.message, true);
        });
    });
    section.appendChild(form);
}

function renderEditForm(post, article) {
    const form = document.createElement('form');
    form.className = 'feed-post-edit-form';
    const text = document.createElement('textarea');
    text.maxLength = 2000;
    text.value = post.text || '';
    text.setAttribute('aria-label', 'Edit post text');
    const category = document.createElement('select');
    category.setAttribute('aria-label', 'Edit post category');
    ['Technology', 'Placement', 'Events', 'Study Material', 'General'].forEach(value => {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = value;
        option.selected = value === (post.category || 'General');
        category.appendChild(option);
    });
    const attachment = document.createElement('input');
    attachment.type = 'file';
    attachment.accept = 'image/jpeg,image/png,image/webp,application/pdf';
    attachment.setAttribute('aria-label', 'Replace post attachment');
    const removeLabel = document.createElement('label');
    const removeAttachment = document.createElement('input');
    removeAttachment.type = 'checkbox';
    removeAttachment.name = 'removeAttachment';
    removeLabel.hidden = !post.attachment;
    removeLabel.append(removeAttachment, document.createTextNode(' Remove current attachment'));
    const save = addFeedText(form, 'button', 'feed-button', 'Save changes');
    save.type = 'submit';
    const cancel = makeButton(form, 'feed-edit-button', 'Cancel', () => form.remove());
    form.replaceChildren(text, category, attachment, removeLabel, save, cancel);
    form.addEventListener('submit', async event => {
        event.preventDefault();
        save.disabled = true;
        const body = new FormData();
        body.append('text', text.value);
        body.append('category', category.value);
        body.append('removeAttachment', String(removeAttachment.checked));
        if (attachment.files[0]) body.append('attachment', attachment.files[0]);
        try {
            await apiRequest(`/posts/${encodeURIComponent(post.id)}`, 'PUT', body);
            showFeedMessage('Your post was updated.');
            await loadPosts(true);
        } catch (error) {
            save.disabled = false;
            showFeedMessage(error.message, true);
        }
    });
    article.insertBefore(form, article.querySelector('.feed-post-actions'));
}

async function showLikers(post, container) {
    const existing = container.querySelector('.feed-liker-list');
    if (existing) {
        existing.remove();
        return;
    }
    try {
        const users = await apiRequest(`/posts/${encodeURIComponent(post.id)}/likes`);
        const list = document.createElement('div');
        list.className = 'feed-liker-list feed-muted';
        list.textContent = users.length
            ? `Liked by ${users.map(user => user.name).join(', ')}`
            : 'No likes yet.';
        container.appendChild(list);
    } catch (error) {
        showFeedMessage(error.message, true);
    }
}

async function sharePost(post) {
    const url = new URL('feed.html', window.location.href);
    url.searchParams.set('post', post.id);
    try {
        if (navigator.share) {
            await navigator.share({ title: 'Campus Loop post', url: url.href });
        } else if (navigator.clipboard?.writeText) {
            await navigator.clipboard.writeText(url.href);
            showFeedMessage('Post link copied to clipboard.');
        } else {
            window.prompt('Copy this link to share the post:', url.href);
        }
    } catch (error) {
        if (error.name !== 'AbortError') showFeedMessage('Unable to share this post.', true);
    }
}

async function reportPost(post) {
    const reason = window.prompt(
        'Why are you reporting this post? Enter: spam, harassment, misinformation, inappropriate, or other.'
    );
    if (!reason) return;
    const details = window.prompt('Add any context for the moderators (optional).') || '';
    try {
        const result = await apiRequest(`/posts/${encodeURIComponent(post.id)}/report`, 'POST', {
            reason: reason.trim().toLowerCase(),
            details
        });
        showFeedMessage(result.message);
    } catch (error) {
        showFeedMessage(error.message, true);
    }
}

function renderPost(post) {
    const article = document.createElement('article');
    article.className = 'feed-post';
    article.dataset.postId = post.id;

    const header = document.createElement('div');
    header.className = 'feed-post-header';
    const avatar = addFeedText(header, 'div', 'feed-avatar', '');
    setFeedAvatar(avatar, post.name, post.profilePicture || post.avatarUrl);
    const identity = document.createElement('div');
    const name = addFeedText(identity, 'strong', '', post.name || 'Campus Loop');
    name.classList.add('feed-author-link');
    const time = new Date(post.time);
    const timestamp = addFeedText(identity, 'small', '',
        Number.isNaN(time.getTime()) ? '' : time.toLocaleString());
    if (!Number.isNaN(time.getTime())) {
        const timeElement = document.createElement('time');
        timeElement.dateTime = time.toISOString();
        timeElement.textContent = time.toLocaleString();
        timestamp.replaceWith(timeElement);
    }
    if (post.editedAt) addFeedText(identity, 'small', '', 'Edited');
    header.appendChild(identity);
    article.appendChild(header);
    addFeedText(article, 'span', 'feed-post-category', post.category || 'General');
    if (post.text) addFeedText(article, 'p', 'feed-post-content', post.text);
    renderAttachment(post, article);

    const actions = document.createElement('div');
    actions.className = 'feed-post-actions';
    const like = makeButton(actions, 'feed-reaction',
        `♡ Like · ${post.likeCount || 0}`, () => voteForPost(post));
    like.classList.toggle('active', post.userVote === 'like');
    like.setAttribute('aria-pressed', String(post.userVote === 'like'));
    makeButton(actions, 'feed-like-names', 'Who liked this?', () => showLikers(post, article));
    const comments = Array.isArray(post.comments) ? post.comments : [];
    const commentToggle = makeButton(actions, 'feed-reaction',
        `Comments · ${post.commentCount ?? comments.length}`, () => {
            const section = article.querySelector('.feed-comments');
            section.hidden = !section.hidden;
            commentToggle.setAttribute('aria-expanded', String(!section.hidden));
        });
    commentToggle.setAttribute('aria-expanded', 'true');
    const saved = makeButton(actions, 'feed-save-button',
        post.isSaved ? 'Saved' : 'Save', () => toggleSave(post));
    saved.setAttribute('aria-pressed', String(Boolean(post.isSaved)));
    makeButton(actions, 'feed-share-button', 'Share link', () => sharePost(post));

    const isOwner = currentUser && String(post.userId) === String(currentUser.id);
    if (isOwner) {
        makeButton(actions, 'feed-edit-button', 'Edit', () => {
            const existing = article.querySelector('.feed-post-edit-form');
            if (existing) existing.remove();
            else renderEditForm(post, article);
        });
    }
    if (isOwner || currentUser?.role === 'admin') {
        makeButton(actions, 'feed-delete-button', 'Delete', async event => {
            if (!window.confirm('Delete this post and its attachment?')) return;
            event.currentTarget.disabled = true;
            try {
                await apiRequest(`/posts/${encodeURIComponent(post.id)}`, 'DELETE');
                allFeedPosts = allFeedPosts.filter(entry =>
                    String(entry.id) !== String(post.id));
                renderFeedPosts();
                showFeedMessage('Post deleted.');
            } catch (error) {
                event.currentTarget.disabled = false;
                showFeedMessage(error.message, true);
            }
        });
    } else {
        makeButton(actions, 'feed-report-button', 'Report', () => reportPost(post));
    }
    article.appendChild(actions);

    const commentSection = document.createElement('section');
    commentSection.className = 'feed-comments';
    commentSection.setAttribute('aria-label', 'Post comments');
    renderComments(post, commentSection);
    article.appendChild(commentSection);
    return article;
}

function renderFeedPosts() {
    const list = document.getElementById('quickFeedPosts');
    const savedOnly = document.getElementById('feedSaved').value === 'saved';
    const posts = savedOnly ? allFeedPosts.filter(post => post.isSaved) : allFeedPosts;
    const sort = document.getElementById('feedSort').value;
    posts.sort((first, second) => {
        if (sort === 'most-liked') return (second.likeCount || 0) - (first.likeCount || 0);
        if (sort === 'trending') {
            const score = post => (post.likeCount || 0) * 2 + (post.commentCount || 0);
            return score(second) - score(first) ||
                String(second.time || '').localeCompare(String(first.time || ''));
        }
        const time = String(first.time || '').localeCompare(String(second.time || ''));
        return sort === 'oldest' ? time : -time;
    });
    list.replaceChildren();
    const count = document.getElementById('feedResultCount');
    count.textContent = `${posts.length} ${posts.length === 1 ? 'post' : 'posts'} loaded`;

    if (!posts.length) {
        addFeedText(list, 'p', 'feed-muted', savedOnly
            ? 'You have not saved any posts yet.'
            : 'No posts match these filters. Try another search or be the first to share.');
    } else {
        posts.forEach(post => list.appendChild(renderPost(post)));
    }
    document.getElementById('loadMorePosts').hidden = !hasMorePosts;
}

function showLoadingSkeleton() {
    const list = document.getElementById('quickFeedPosts');
    list.replaceChildren();
    for (let index = 0; index < 3; index++) {
        const skeleton = document.createElement('div');
        skeleton.className = 'feed-skeleton';
        skeleton.setAttribute('aria-hidden', 'true');
        list.appendChild(skeleton);
    }
}

async function loadPosts(reset = false) {
    if (loadingPosts) {
        if (reset) reloadAfterCurrent = true;
        return;
    }
    if (reset) {
        currentPage = 1;
        allFeedPosts = [];
        showLoadingSkeleton();
    } else if (!hasMorePosts && currentPage > 1) {
        return;
    }

    loadingPosts = true;
    const query = new URLSearchParams({
        page: String(currentPage),
        limit: String(PAGE_SIZE),
        search: document.getElementById('feedSearch').value.trim(),
        category: document.getElementById('feedCategory').value,
        author: document.getElementById('feedAuthor').value.trim(),
        sort: document.getElementById('feedSort').value
    });
    if (document.getElementById('feedSaved').value === 'saved') query.set('saved', 'true');
    const button = document.getElementById('loadMorePosts');
    button.disabled = true;
    button.textContent = 'Loading…';
    try {
        const response = await fetch(`${API}/posts?${query}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        if (response.status === 401) {
            logout();
            return;
        }
        const posts = await response.json().catch(() => null);
        if (!response.ok) {
            throw new Error(posts?.error || 'Unable to load campus posts.');
        }
        if (!Array.isArray(posts)) throw new Error('The server returned an invalid posts response.');
        allFeedPosts = reset ? posts : allFeedPosts.concat(posts);
        hasMorePosts = response.headers.get('X-Has-More') === 'true';
        currentPage++;
        renderFeedPosts();
    } catch (error) {
        if (reset) allFeedPosts = [];
        const list = document.getElementById('quickFeedPosts');
        if (reset) {
            list.replaceChildren();
            addFeedText(list, 'p', 'feed-muted', error.message);
            const retry = addFeedText(list, 'button', 'feed-button', 'Try again');
            retry.type = 'button';
            retry.addEventListener('click', () => loadPosts(true));
        } else {
            showFeedMessage(error.message, true);
        }
    } finally {
        loadingPosts = false;
        button.disabled = false;
        button.textContent = 'Load more';
        if (reloadAfterCurrent) {
            reloadAfterCurrent = false;
            loadPosts(true);
        }
    }
}

async function loadModerationQueue() {
    const panel = document.getElementById('moderationPanel');
    if (currentUser?.role !== 'admin') return;
    panel.hidden = false;
    const list = document.getElementById('moderationReports');
    try {
        const reports = await apiRequest('/posts/moderation/reports');
        list.replaceChildren();
        if (!reports.length) {
            addFeedText(list, 'p', 'feed-muted', 'No open reports. You’re all caught up.');
            return;
        }
        reports.forEach(report => {
            const item = document.createElement('article');
            item.className = 'feed-moderation-report';
            addFeedText(item, 'strong', '', `${report.reason} · ${report.reporterName}`);
            addFeedText(item, 'p', '', report.postText || 'Attachment-only post');
            if (report.details) addFeedText(item, 'p', 'feed-muted', report.details);
            const actions = document.createElement('div');
            actions.className = 'feed-moderation-actions';
            makeButton(actions, 'feed-edit-button', 'Dismiss report', async () => {
                try {
                    await apiRequest(
                        `/posts/moderation/reports/${encodeURIComponent(report.id)}/resolve`,
                        'POST',
                        {}
                    );
                    await loadModerationQueue();
                } catch (error) {
                    showFeedMessage(error.message, true);
                }
            });
            makeButton(actions, 'feed-report-button', 'Remove post', async () => {
                if (!window.confirm('Remove this reported post?')) return;
                try {
                    await apiRequest(`/posts/${encodeURIComponent(report.postId)}`, 'DELETE');
                    await Promise.all([loadPosts(true), loadModerationQueue()]);
                } catch (error) {
                    showFeedMessage(error.message, true);
                }
            });
            item.appendChild(actions);
            list.appendChild(item);
        });
    } catch (error) {
        list.replaceChildren();
        addFeedText(list, 'p', 'feed-message feed-message-error', error.message);
    }
}

function queueFilterReload() {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => loadPosts(true), 250);
}

function clearAttachmentPreview() {
    if (attachmentPreviewUrl) URL.revokeObjectURL(attachmentPreviewUrl);
    attachmentPreviewUrl = null;
    document.getElementById('attachmentPreview').replaceChildren();
    document.getElementById('attachmentPreview').hidden = true;
}

function previewAttachment() {
    const input = document.getElementById('postAttachment');
    const preview = document.getElementById('attachmentPreview');
    const file = input.files[0];
    clearAttachmentPreview();
    if (!file) return;
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];
    if (!allowed.includes(file.type) || file.size > 10 * 1024 * 1024) {
        input.value = '';
        showFeedMessage('Choose a JPG, PNG, WEBP image, or PDF under 10 MB.', true);
        return;
    }
    preview.hidden = false;
    if (file.type.startsWith('image/')) {
        attachmentPreviewUrl = URL.createObjectURL(file);
        const image = document.createElement('img');
        image.src = attachmentPreviewUrl;
        image.alt = 'Attachment preview';
        preview.appendChild(image);
    } else {
        addFeedText(preview, 'span', 'feed-attachment-icon', 'PDF');
    }
    addFeedText(preview, 'span', '', `${file.name} · ${Math.ceil(file.size / 1024)} KB`);
    makeButton(preview, 'feed-edit-button', 'Remove', () => {
        input.value = '';
        clearAttachmentPreview();
    });
}

async function addPost(event) {
    event.preventDefault();
    const form = document.getElementById('quickPostForm');
    const input = document.getElementById('quickPostContent');
    const file = document.getElementById('postAttachment').files[0];
    const submit = form.querySelector('button[type="submit"]');
    if (!input.value.trim() && !file) {
        showFeedMessage('Write a post or attach a file before publishing.', true);
        return;
    }
    submit.disabled = true;
    showFeedMessage('Sharing your post…');
    const body = new FormData();
    body.append('text', input.value.trim());
    body.append('category', document.getElementById('postCategory').value);
    if (file) body.append('attachment', file);
    try {
        await apiRequest('/posts', 'POST', body);
        input.value = '';
        document.getElementById('postAttachment').value = '';
        clearAttachmentPreview();
        showFeedMessage('Your post was shared.');
        await loadPosts(true);
    } catch (error) {
        showFeedMessage(error.message, true);
    } finally {
        submit.disabled = false;
    }
}

function initializeFeed() {
    if (!token || !currentUser || typeof currentUser.name !== 'string') {
        window.location.replace('login.html');
        return;
    }
    document.getElementById('quickPostForm').addEventListener('submit', addPost);
    document.getElementById('postAttachment').addEventListener('change', previewAttachment);
    document.getElementById('feedSearch').addEventListener('input', queueFilterReload);
    document.getElementById('feedAuthor').addEventListener('input', queueFilterReload);
    document.getElementById('feedCategory').addEventListener('change', () => loadPosts(true));
    document.getElementById('feedSort').addEventListener('change', () => loadPosts(true));
    document.getElementById('feedSaved').addEventListener('change', () => loadPosts(true));
    document.getElementById('loadMorePosts').addEventListener('click', () => loadPosts(false));
    loadPosts(true);
    loadModerationQueue();
}

initializeFeed();
