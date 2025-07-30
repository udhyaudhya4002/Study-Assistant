from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import google.generativeai as genai
import mimetypes
import fitz  # PyMuPDF
from PIL import Image
import pytesseract
from dotenv import load_dotenv
import mysql.connector
import os
from datetime import datetime

# ------------------------
# Flask setup - serve frontend
# ------------------------
app = Flask(__name__, static_folder="../frontend", static_url_path="")
CORS(app)

# ------------------------
# Load environment variables
# ------------------------
load_dotenv()
genai.configure(api_key=os.getenv("google_api"))

# ------------------------
# MySQL configuration
# ------------------------
db_config = {
    "host": os.getenv("MYSQL_HOST", "localhost"),
    "user": os.getenv("MYSQL_USER", "root"),
    "password": os.getenv("MYSQL_PASSWORD", ""),
    "database": os.getenv("MYSQL_DATABASE", "gemini_study_assistant"),
}
print("DB Config:", db_config)

# ------------------------
# Save chat to database
# ------------------------
def save_chat_to_db(mode, prompt, response, context):
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS chat_history (
                id INT AUTO_INCREMENT PRIMARY KEY,
                mode VARCHAR(50),
                prompt TEXT,
                response LONGTEXT,
                context LONGTEXT,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        """)
        cursor.execute("""
            INSERT INTO chat_history (mode, prompt, response, context)
            VALUES (%s, %s, %s, %s)
        """, (mode, prompt, response, context))
        conn.commit()
        cursor.close()
        conn.close()
    except Exception as e:
        print("❌ Failed to save chat history:", e)

# ------------------------
# Extract text from file
# ------------------------
def extract_text(file):
    filetype = mimetypes.guess_type(file.filename)[0]
    if filetype == "application/pdf":
        doc = fitz.open(stream=file.read(), filetype="pdf")
        raw_text = "\n".join(page.get_text() for page in doc)
    elif filetype and "text" in filetype:
        raw_text = file.read().decode("utf-8", errors="ignore")
    elif filetype and filetype.startswith("image/"):
        image = Image.open(file)
        raw_text = pytesseract.image_to_string(image)
    else:
        return "Unsupported file type."

    block_keywords = [
        ".com", ".in", ".org", ".net", ".edu", "http", "https",
        "www.", "tutorial", "youtube", "reference", "blog", "site"
    ]
    cleaned_lines = [
        line.strip()
        for line in raw_text.splitlines()
        if line.strip() and not any(k in line.lower() for k in block_keywords)
    ]
    return "\n".join(cleaned_lines) if cleaned_lines else ""

# ------------------------
# Process request
# ------------------------
@app.route('/process', methods=['POST'])
def process():
    prompt = request.form.get('prompt', '').strip()
    mode = request.form.get('mode', '').strip().lower()
    file = request.files.get('file')
    exam_time = request.form.get('examTime', '').strip()
    syllabus = request.form.get('syllabus', '').strip()
    study_hours = request.form.get('studyHours', '').strip()

    context = extract_text(file) if file else ""
    if not context and not prompt:
        return jsonify({'response': "⚠️ Please provide either a file or a prompt."})

    if mode == "summarize":
        system_prompt = (
            "You are a helpful tutor. Summarize the following lecture notes clearly and effectively for a student.\n"
            "- Use topic headers.\n"
            "- Keep explanations short and clear.\n"
            "- Format for revision.\n\n"
            "Now summarize this:\n"
        )
    elif mode == "mcq":
        system_prompt = (
            "You are a multiple-choice question (MCQ) generator.\n"
            "Generate 10–15 MCQs based on the content.\n"
            "Ignore links or URLs. Format:\n"
            "Q: ...\nA. ...\nB. ...\nC. ...\nD. ...\nAnswer: ...\nExplanation: ...\n"
        )
    elif mode == "explain":
        system_prompt = (
            "Explain the following content in a simple, clear, and structured way:\n"
            "- Use plain language.\n"
            "- Avoid jargon unless explained.\n"
            "- Use examples.\n"
            "- Add headings and bullet points.\n"
        )
    elif mode == "examprep":
        system_prompt = (
            "You are a smart study planner assistant.\n"
            "Generate a day-by-day study timetable in table format: Day | Time Slot | Activity.\n"
            "Add tips at the end."
        )
        if exam_time or syllabus or study_hours:
            context += f"\n⏳ Exam in {exam_time} days\n📚 Syllabus: {syllabus}\n⏱️ Study Hours/Day: {study_hours}"

    full_prompt = f"{system_prompt}\n\n{prompt}\n\n{context}"
    model = genai.GenerativeModel('models/gemini-1.5-flash-8b')

    try:
        response = model.generate_content(full_prompt)
        save_chat_to_db(mode, prompt, response.text, context)
        return jsonify({'response': response.text, 'context': context})
    except Exception as e:
        return jsonify({'response': f"❌ Error from Gemini: {str(e)}"}), 500

# ------------------------
# Clarify MCQ Doubt
# ------------------------
@app.route('/clarify', methods=['POST'])
def clarify_mcq_doubt():
    mcq_question = request.form.get('question', '').strip()
    user_doubt = request.form.get('doubt', '').strip()
    context = request.form.get('context', '').strip()

    if not mcq_question or not user_doubt:
        return jsonify({'response': "❌ Missing question or doubt."}), 400

    full_prompt = (
        "You are a friendly tutor.\n"
        "Explain this MCQ clearly.\n"
        "- Use simple language.\n"
        "- Clarify with examples.\n"
        f"\nContext:\n{context}\n"
        f"\nQuestion:\n{mcq_question}\n"
        f"\nDoubt:\n{user_doubt}\n"
        "---\nExplanation:"
    )

    model = genai.GenerativeModel('models/gemini-1.5-flash-8b')
    try:
        response = model.generate_content(full_prompt)
        return jsonify({'response': response.text})
    except Exception as e:
        return jsonify({'response': f"❌ Gemini Error: {str(e)}"}), 500

# ------------------------
# Chat history
# ------------------------
@app.route('/history', methods=['GET'])
def get_history():
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor(dictionary=True)
        cursor.execute("""
            SELECT id, mode, prompt, response, context, timestamp
            FROM chat_history
            ORDER BY timestamp DESC LIMIT 20
        """)
        history = cursor.fetchall()
        cursor.close()
        conn.close()
        return jsonify({'history': history})
    except Exception as e:
        print("❌ Error fetching history:", e)
        return jsonify({'history': []})

# ------------------------
# Delete chat
# ------------------------
@app.route('/delete', methods=['POST'])
def delete_chat():
    chat_id = request.json.get('id')
    try:
        conn = mysql.connector.connect(**db_config)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM chat_history WHERE id = %s", (chat_id,))
        conn.commit()
        cursor.close()
        conn.close()
        return jsonify({'success': True})
    except Exception as e:
        print("❌ Failed to delete chat:", e)
        return jsonify({'success': False, 'error': str(e)}), 500

# ------------------------
# Serve frontend
# ------------------------
@app.route("/")
def serve_index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def serve_static_files(path):
    return send_from_directory(app.static_folder, path)

# ------------------------
# Run the app
# ------------------------
if __name__ == '__main__':
    app.run(debug=False, host="0.0.0.0", port=int(os.environ.get("PORT", 5000)))
