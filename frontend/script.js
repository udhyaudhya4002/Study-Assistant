document.getElementById('promptForm').addEventListener('submit', async (e) => {
  e.preventDefault();

  const prompt = document.getElementById('prompt').value;
  const mode = document.getElementById('modeSelect').value;
  const file = document.getElementById('fileInput').files[0];
  const fileType = document.getElementById('fileType')?.value || 'book';
  const examTime = document.getElementById('examTime')?.value;
  const syllabus = document.getElementById('syllabus')?.value;
  const studyHours = document.getElementById('studyHours')?.value;

  const formData = new FormData();
  formData.append('prompt', prompt);
  formData.append('mode', mode);
  formData.append('fileType', fileType);
  if (file) formData.append('file', file);
  if (mode === 'examprep') {
    formData.append('examTime', examTime);
    formData.append('syllabus', syllabus);
    formData.append('studyHours', studyHours);
  }

  const responseDiv = document.getElementById('response');
  responseDiv.innerHTML = "<strong>Processing...</strong>";

  try {
    const res = await fetch('http://localhost:5000/process', {
      method: 'POST',
      body: formData
    });

    const data = await res.json();
    window.fullContext = data.context || '';

    if (mode === 'mcq') {
      renderMCQs(data.response);
    } else {
      responseDiv.innerHTML = mode === 'examprep' ? formatTable(data.response) : formatResponse(data.response, mode);
    }

    await fetchHistory();
  } catch (err) {
    console.error(err);
    responseDiv.innerHTML = "❌ Error fetching response.";
  }
});

async function fetchHistory() {
  try {
    const res = await fetch('http://localhost:5000/history');
    const data = await res.json();
    const historyList = document.getElementById('history');
    historyList.innerHTML = '';

    data.history.forEach(item => {
      const li = document.createElement('li');
      li.classList.add('history-item');

      const span = document.createElement('span');
      span.innerHTML = `<strong>${item.mode.toUpperCase()}</strong> - ${new Date(item.timestamp).toLocaleString()}`;

      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'delete-btn';
      deleteBtn.innerText = '🗑️';
      deleteBtn.title = 'Delete';
      deleteBtn.setAttribute('data-id', item.id);

      li.appendChild(span);
      li.appendChild(deleteBtn);

      li.addEventListener('click', () => {
        const responseDiv = document.getElementById('response');
        document.getElementById('prompt').value = item.prompt;
        document.getElementById('modeSelect').value = item.mode;
        window.fullContext = item.context || '';

        if (item.mode === 'mcq') {
          renderMCQs(item.response);
        } else {
          responseDiv.innerHTML = item.mode === 'examprep'
            ? formatTable(item.response)
            : formatResponse(item.response, item.mode);
        }
      });

      deleteBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (!confirm("Delete this chat?")) return;
        try {
          const res = await fetch('http://localhost:5000/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: item.id })
          });
          const result = await res.json();
          if (result.success) {
            fetchHistory();
          } else {
            alert("❌ Could not delete.");
          }
        } catch (err) {
          alert("❌ Error deleting chat.");
        }
      });

      historyList.appendChild(li);
    });
  } catch (err) {
    console.error("❌ Failed to load history", err);
  }
}

document.addEventListener('DOMContentLoaded', fetchHistory);

function formatResponse(text, mode = "") {
  if (mode === "summarize" || mode === "explain") {
    return `<div class="markdown-body">${marked.parse(text)}</div>`;
  } else {
    return `<pre>${text}</pre>`;
  }
}

function formatTable(text) {
  const lines = text.split('\n');
  let html = '<table border="1" cellpadding="6" cellspacing="0" style="width:100%;border-collapse:collapse;">';
  lines.forEach((line, idx) => {
    if (/^\|.*\|$/.test(line)) {
      const cells = line.split('|').slice(1, -1).map(cell => cell.trim());
      const row = cells.map(cell => `<td>${cell}</td>`).join('');
      html += idx === 0 ? `<tr>${row.replace(/<td>/g, '<th>').replace(/<\/td>/g, '</th>')}</tr>` : `<tr>${row}</tr>`;
    }
  });
  html += '</table>';
  return html;
}

function renderMCQs(text) {
  const container = document.getElementById('response');
  container.innerHTML = '';

  const questions = text.split(/Q:\s*/).filter(q => q.trim());

  questions.forEach((block, index) => {
    const qBlock = document.createElement('div');
    qBlock.classList.add('mcq-block');

    const [questionText, ...rest] = block.split('\n');
    const options = rest.filter(l => /^[A-D]\./.test(l.trim()));
    const answerLine = rest.find(l => /Answer:/i.test(l));
    const explanationLine = rest.find(l => /Explanation:/i.test(l));
    const correctAnswer = answerLine ? answerLine.split(':')[1].trim().toUpperCase() : '';

    const qId = `q_${index}`;
    const resultDiv = document.createElement('div');
    resultDiv.classList.add('result-div');
    const chatDiv = document.createElement('div');
    chatDiv.classList.add('chat-div');

    qBlock.innerHTML = `<p><strong>Q${index + 1}:</strong> ${questionText}</p>`;

    options.forEach(opt => {
      const value = opt.charAt(0);
      const label = opt.substring(2);
      const inputId = `${qId}_${value}`;

      const optionWrapper = document.createElement('div');
      optionWrapper.className = 'option-wrapper';
      optionWrapper.innerHTML = `
        <input type="radio" name="${qId}" id="${inputId}" value="${value}" style="display:none;">
        <label for="${inputId}">${value}. ${label}</label>
      `;

      optionWrapper.addEventListener('click', () => {
        qBlock.querySelectorAll('.option-wrapper').forEach(el => el.classList.remove('selected'));
        optionWrapper.classList.add('selected');
        qBlock.querySelector(`#${inputId}`).checked = true;
      });

      qBlock.appendChild(optionWrapper);
    });

    const checkBtn = document.createElement('button');
    checkBtn.innerText = 'Check Answer';
    checkBtn.onclick = () => {
      const selected = qBlock.querySelector(`input[name="${qId}"]:checked`);
      if (!selected) {
        resultDiv.innerHTML = '<p style="color:red;">Please select an option.</p>';
        return;
      }

      const isCorrect = selected.value === correctAnswer;
      resultDiv.innerHTML = `<p style="color:${isCorrect ? 'green' : 'red'};">${isCorrect ? '✅ Correct!' : `❌ Wrong. Correct: ${correctAnswer}`}</p>`;
      if (explanationLine) {
        resultDiv.innerHTML += `<p><em>${explanationLine}</em></p>`;
      }

      chatDiv.innerHTML = `
        <label>💬 Have a doubt?</label>
        <textarea rows="2" placeholder="Type your doubt..."></textarea>
        <button class="ask-btn">Ask</button>
        <div class="chat-response"></div>
      `;

      chatDiv.querySelector('.ask-btn').onclick = async () => {
        const doubt = chatDiv.querySelector('textarea').value.trim();
        if (!doubt) return chatDiv.querySelector('.chat-response').innerText = "❌ Please enter a doubt.";

        const fullQuestion = `Q: ${questionText}\n${options.join('\n')}\n${answerLine}`;
        chatDiv.querySelector('.chat-response').innerHTML = "⏳ Thinking...";
        try {
          const res = await fetch('http://localhost:5000/clarify', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ question: fullQuestion, doubt, context: window.fullContext || '' })
          });
          const data = await res.json();
          chatDiv.querySelector('.chat-response').innerHTML = `<p>${data.response}</p>`;
        } catch (err) {
          chatDiv.querySelector('.chat-response').innerHTML = "❌ Could not fetch explanation.";
        }
      };
    };

    qBlock.appendChild(checkBtn);
    qBlock.appendChild(resultDiv);
    qBlock.appendChild(chatDiv);
    container.appendChild(qBlock);
  });
}
