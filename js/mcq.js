const API = 'http://localhost:3000';

// If the user is not logged in, send them to the login page
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '../login.html';
}

let questions = [];
let answered = 0;
let score = 0;

function logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('currentUser');
    window.location.href = '../login.html';
}

function setStatus(text, color) {
    const status = document.getElementById('status');
    status.style.color = color;
    status.textContent = text;
}

async function generate() {
    const fileInput = document.getElementById('pdfFile');
    const count = document.getElementById('qCount').value;
    const button = document.getElementById('generateBtn');

    if (!fileInput.files.length) {
        setStatus('Please choose a PDF file first.', 'red');
        return;
    }

    const file = fileInput.files[0];
    if (file.size > 10 * 1024 * 1024) {
        setStatus('PDF is too large (max 10 MB).', 'red');
        return;
    }

    const form = new FormData();
    form.append('count', count);
    form.append('pdf', file);

    button.disabled = true;
    setStatus('Reading your PDF and creating questions...', '#6b7280');
    document.getElementById('quiz').innerHTML = '';
    document.getElementById('scoreBar').style.display = 'none';

    try {
        const res = await fetch(API + '/mcq', {
            method: 'POST',
            headers: { 'Authorization': 'Bearer ' + token },
            body: form
        });

        if (res.status === 401) {
            logout();
            return;
        }

        const data = await res.json();

        if (!res.ok) {
            setStatus(data.error || 'Something went wrong.', 'red');
            return;
        }

        questions = data.questions;
        answered = 0;
        score = 0;

        let msg = 'Created ' + questions.length + ' questions from ' + data.pages + ' page(s).';
        if (questions.length < Number(count)) {
            msg += ' (The PDF did not have enough content for ' + count + '.)';
        }
        setStatus(msg, 'green');

        renderQuiz();
        updateScore();
    } catch (err) {
        console.error(err);
        setStatus('Cannot reach the server. Is the backend running?', 'red');
    } finally {
        button.disabled = false;
    }
}

function renderQuiz() {
    const quiz = document.getElementById('quiz');
    quiz.innerHTML = '';

    questions.forEach((q, qi) => {
        const card = document.createElement('div');
        card.className = 'q-card';

        const title = document.createElement('p');
        title.className = 'q-text';
        title.textContent = (qi + 1) + '. ' + q.question;
        card.appendChild(title);

        const buttons = [];

        q.options.forEach((opt, oi) => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';
            btn.textContent = String.fromCharCode(65 + oi) + ') ' + opt;
            btn.onclick = function () {
                if (card.dataset.done) return;
                card.dataset.done = 'yes';

                answered++;
                if (oi === q.answer) {
                    btn.classList.add('correct');
                    score++;
                } else {
                    btn.classList.add('wrong');
                    buttons[q.answer].classList.add('correct');
                }
                updateScore();
            };
            buttons.push(btn);
            card.appendChild(btn);
        });

        quiz.appendChild(card);
    });
}

function updateScore() {
    const bar = document.getElementById('scoreBar');
    bar.style.display = 'block';

    if (answered < questions.length) {
        bar.textContent = 'Score: ' + score + ' / ' + answered + ' answered (' + questions.length + ' total)';
    } else {
        const percent = Math.round((score / questions.length) * 100);
        bar.textContent = 'Finished! You scored ' + score + ' / ' + questions.length + ' (' + percent + '%)';
    }
}