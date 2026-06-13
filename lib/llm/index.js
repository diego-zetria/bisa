// lib/llm/index.js — STUB Fase 0 (implementação real: Fase 1).
const express = require('express');
module.exports = function makeLlm(deps) {
  const { headless } = deps;
  return {
    router: express.Router(),
    handleWsMessage: () => {},
    attachLoop: () => {},
    runHeadlessForJob: (_job, ...a) => headless.runClaudeHeadless(...a),
    microTask: async () => null,
  };
};
