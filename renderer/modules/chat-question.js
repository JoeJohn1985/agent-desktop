/* global tabs, activeTabId, sendMessage */
'use strict';

window.chatQuestions = {
  render(el, raw, tab, reply, actionable = true) {
    const parsed = window.ChatQuestion.parse(raw);
    if (!parsed) return;
    reply = window.ChatQuestion.answerText(reply);
    el.innerHTML = window.markdown.render(parsed.text);
    el._question = { parsed, reply, actionable };
    const panel = document.createElement('section');
    panel.className = 'chat-question';
    const title = document.createElement('strong');
    title.textContent = parsed.question;
    panel.appendChild(title);
    const options = document.createElement('div');
    options.className = 'chat-question__options';
    panel.appendChild(options);
    for (const text of parsed.options) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = text;
      button.disabled = reply !== undefined || !actionable || !!tab.isProcessing;
      button.setAttribute('aria-pressed', String(reply === text));
      button.addEventListener('click', async () => {
        const id = [...tabs].find(([, candidate]) => candidate === tab)?.[0];
        if (id == null || id !== activeTabId || tab.isProcessing || el._question.reply !== undefined || el._question.pending) return;
        el._question.pending = true;
        for (const btn of options.children) btn.disabled = true;
        try {
          await sendMessage({ tabId: id, text, questionEl: el });
        } finally {
          el._question.pending = false;
          if (el._question.reply === undefined && tabs.get(id) === tab && !tab.isProcessing) {
            for (const btn of options.children) btn.disabled = !actionable;
          }
        }
      });
      options.appendChild(button);
    }
    el.appendChild(panel);
  },
  answer(tab, text) {
    const nodes = [...(tab._prunedNodes || []).flat(), ...tab.streamEl.children];
    for (const el of nodes) {
      if (!el?._question || el._question.reply !== undefined) continue;
      el._question.reply = text;
      for (const button of el.querySelectorAll('.chat-question button')) {
        button.disabled = true;
        button.setAttribute('aria-pressed', String(button.textContent === text));
      }
    }
  },
  complete(tab, code) {
    const responses = [...tab.streamEl.querySelectorAll('.stream-response')];
    const last = responses[responses.length - 1];
    if (code === 0 && last?._questionRaw && !last._question && !last._questionCommentary) {
      this.render(last, last._questionRaw, tab);
    }
    for (const el of responses) delete el._questionRaw;
  },
};
