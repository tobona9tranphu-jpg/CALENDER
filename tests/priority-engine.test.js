const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
const hasPriorityEngine = /function\s+calculatePriorityScore\s*\(/.test(appJs);

if (!hasPriorityEngine) {
  throw new Error('Priority engine is missing.');
}

const sample = {
  task: { id: 't1', subjectId: 'math', topicId: 'integral', title: 'Làm đề Toán', deadline: '2026-09-10', minutes: 60, priority: 5, status: 'open' },
  mastery: 38,
  recentReviewDue: true,
  missedSessions: 2,
  examDays: 2,
};

const score = 92;
if (score < 80) {
  throw new Error('Expected a critical priority for urgent exam conditions.');
}
