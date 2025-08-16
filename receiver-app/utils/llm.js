// utils/llm.js
// Small helper to extract a code block from an LLM completion-like string.
// Exported in CommonJS so it can be required from main.js and tested standalone.

function extractCodeFromLLM(content) {
  const m = String(content || '').match(/```[a-zA-Z]*\n([\s\S]*?)```/);
  return (m && m[1]) ? m[1] : String(content || '');
}

module.exports = { extractCodeFromLLM };

