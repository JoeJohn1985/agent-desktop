// ── Chat Search Module ────────────────────────────────────────
// Extracted from app.js — in-chat search bar (Ctrl+F) with incremental
// highlighting and match navigation.
// Relies on globals provided elsewhere: tabs/activeTabId (app.js tab
// management). Exposes window._openSearch for the keyboard-shortcuts module.
'use strict';

/**
 * Initialize the in-chat search bar (Ctrl+F). Implements incremental
 * text highlighting with mark elements and keyboard navigation.
 */
function initChatSearch() {
  const searchBar = document.getElementById('chatSearchBar');
  const searchInput = document.getElementById('chatSearchInput');
  const searchCount = document.getElementById('chatSearchCount');
  let searchMarks = [];
  let searchActiveIdx = -1;

  function clearSearchHighlights() {
    searchMarks.forEach(m => {
      const parent = m.parentNode;
      parent.replaceChild(document.createTextNode(m.textContent), m);
      parent.normalize();
    });
    searchMarks = [];
    searchActiveIdx = -1;
    searchCount.textContent = '';
  }

  function highlightSearch(query) {
    clearSearchHighlights();
    if (!query || !activeTabId) return;
    const tab = tabs.get(activeTabId);
    if (!tab) return;
    const walker = document.createTreeWalker(tab.streamEl, NodeFilter.SHOW_TEXT, null);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    const lowerQ = query.toLowerCase();
    for (const node of textNodes) {
      const text = node.textContent;
      const lower = text.toLowerCase();
      let idx = lower.indexOf(lowerQ);
      if (idx === -1) continue;
      const frag = document.createDocumentFragment();
      let lastIdx = 0;
      while (idx !== -1) {
        frag.appendChild(document.createTextNode(text.substring(lastIdx, idx)));
        const mark = document.createElement('mark');
        mark.className = 'chat-search-highlight';
        mark.textContent = text.substring(idx, idx + query.length);
        frag.appendChild(mark);
        searchMarks.push(mark);
        lastIdx = idx + query.length;
        idx = lower.indexOf(lowerQ, lastIdx);
      }
      frag.appendChild(document.createTextNode(text.substring(lastIdx)));
      node.parentNode.replaceChild(frag, node);
    }
    searchCount.textContent = searchMarks.length ? `${searchMarks.length} Treffer` : 'Keine Treffer';
    if (searchMarks.length > 0) jumpToMatch(0);
  }

  function jumpToMatch(idx) {
    if (searchMarks.length === 0) return;
    if (searchActiveIdx >= 0 && searchActiveIdx < searchMarks.length) {
      searchMarks[searchActiveIdx].classList.remove('chat-search-highlight--active');
    }
    searchActiveIdx = ((idx % searchMarks.length) + searchMarks.length) % searchMarks.length;
    const mark = searchMarks[searchActiveIdx];
    mark.classList.add('chat-search-highlight--active');
    mark.scrollIntoView({ block: 'center', behavior: 'smooth' });
    searchCount.textContent = `${searchActiveIdx + 1}/${searchMarks.length}`;
  }

  function openSearch() {
    searchBar.classList.add('chat-search--visible');
    searchInput.focus();
    searchInput.select();
  }

  function closeSearch() {
    searchBar.classList.remove('chat-search--visible');
    clearSearchHighlights();
    searchInput.value = '';
  }

  // Store openSearch globally for keyboard shortcut access
  window._openSearch = openSearch;

  searchInput.addEventListener('input', () => highlightSearch(searchInput.value));
  searchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) jumpToMatch(searchActiveIdx - 1);
      else jumpToMatch(searchActiveIdx + 1);
    }
    if (e.key === 'Escape') closeSearch();
  });
  document.getElementById('chatSearchPrev').addEventListener('click', () => jumpToMatch(searchActiveIdx - 1));
  document.getElementById('chatSearchNext').addEventListener('click', () => jumpToMatch(searchActiveIdx + 1));
  document.getElementById('chatSearchClose').addEventListener('click', () => closeSearch());
}
