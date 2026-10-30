import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLEMAK_URL,
  ESDB_URL,
  LEGAL_CODE_URL,
  LICENSE_URL,
  escapeHtml,
  groupByAuthor,
  profileUrl,
  renderCreditsPage,
  renderNotices,
  selectionSummary,
  sentenceUrl,
} from '../tools/credits.mjs';

const HEADER = 'Copyright 2000-2026 by Kevin Atkinson\n\nSpecial: <none>\nPermission is granted & so on.';

const PICKED = [
  { id: 30, text: 'Third one here.', rarity: 0.4, author: 'zoe' },
  { id: 10, text: 'First one here.', rarity: 0, author: 'Alice' },
  { id: 20, text: 'Second one here.', rarity: 0.2, author: 'alice' },
  { id: 11, text: 'Another from Alice.', rarity: 0.1, author: 'Alice' },
  { id: 40, text: 'Last one here.', rarity: 0.5, author: 'bob' },
];

const SELECTION = {
  corpus: 2039120,
  eligible: 1937458,
  pool: 5,
  covered: 3,
  filled: 2,
  topWords: 5000,
  topMin: 20,
  restMin: 5,
};

const page = () => renderCreditsPage({ picked: PICKED, esdbHeader: HEADER, selection: SELECTION });

test('markup characters are escaped', () => {
  assert.equal(escapeHtml(`<a href="x">Tom & 'Jerry'</a>`), '&lt;a href=&quot;x&quot;&gt;Tom &amp; &#39;Jerry&#39;&lt;/a&gt;');
});

test('a sentence links to its page on Tatoeba', () => {
  assert.equal(sentenceUrl(1276), 'https://tatoeba.org/en/sentences/show/1276');
});

test('an author links to their profile, encoded', () => {
  assert.equal(profileUrl('CK'), 'https://tatoeba.org/en/user/profile/CK');
  assert.equal(profileUrl('a b/c'), 'https://tatoeba.org/en/user/profile/a%20b%2Fc');
});

test('authors are counted by the sentences they wrote', () => {
  const groups = groupByAuthor(PICKED);
  assert.equal(groups.find((group) => group.author === 'Alice').count, 2);
  assert.equal(groups.find((group) => group.author === 'zoe').count, 1);
});

test('authors sort without regard to case, and case variants stay distinct', () => {
  assert.deepEqual(
    groupByAuthor(PICKED).map((group) => group.author),
    ['Alice', 'alice', 'bob', 'zoe'],
  );
});

test('counting drops nothing', () => {
  const total = groupByAuthor(PICKED).reduce((sum, group) => sum + group.count, 0);
  assert.equal(total, PICKED.length);
});

test('the credits page names every author, links their profile and gives their count', () => {
  const html = page();
  for (const { author, count } of groupByAuthor(PICKED)) {
    assert.ok(
      html.includes(`<li><a href="${profileUrl(author)}">${escapeHtml(author)}</a> <span class="count">${count}</span></li>`),
      `no credit for ${author}`,
    );
  }
});

test('the credits page lists authors rather than every sentence', () => {
  const html = page();
  for (const { id, text } of PICKED) {
    assert.ok(!html.includes(escapeHtml(text)), `the text of sentence ${id} is on the page`);
    assert.ok(!html.includes(`/sentences/show/${id}`), `a link to sentence ${id} is on the page`);
  }
});

test('the credits page says where per sentence credit lives', () => {
  const html = page();
  assert.match(html, /records the id of the original and the name of its author/);
  assert.match(html, /results screen after a sentence run credits the sentences you typed/);
});

test('the credits page states the licence and links it', () => {
  const html = page();
  assert.ok(html.includes(`href="${LICENSE_URL}"`));
  assert.ok(html.includes(`href="${LEGAL_CODE_URL}"`));
  assert.match(html, /Creative Commons Attribution 2\.0 France/);
  assert.match(html, /copyright of their authors/);
  assert.match(html, /used unmodified/);
});

test('the credits page carries the dictionary notice exactly, escaped for html', () => {
  const html = page();
  assert.ok(html.includes('Copyright 2000-2026 by Kevin Atkinson'));
  assert.ok(html.includes('Special: &lt;none&gt;'));
  assert.ok(html.includes('Permission is granted &amp; so on.'));
  assert.ok(html.includes(`href="${ESDB_URL}"`));
});

test('the credits page credits the keyboard layout source', () => {
  assert.ok(page().includes(`href="${COLEMAK_URL}"`));
});

test('the credits page says how the sentences were chosen', () => {
  const html = page();
  assert.ok(html.includes('2,039,120'));
  assert.ok(html.includes('1,937,458'));
  assert.match(html, /no filter on length or on content/);
});

test('the credits page counts its authors and sentences', () => {
  assert.match(page(), /4 authors wrote the 5 sentences in use/);
});

test('hostile text in an author name cannot inject markup', () => {
  const hostile = [{ id: 1, text: 'Fine.', rarity: 0, author: '<script>alert(1)</script>' }];
  const html = renderCreditsPage({ picked: hostile, esdbHeader: HEADER, selection: SELECTION });

  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('the credits page uses the shared stylesheet, theme script and a way back', () => {
  const html = page();
  assert.ok(html.includes('href="css/style.css"'));
  assert.ok(html.includes('src="js/theme-boot.js"'));
  assert.ok(html.includes('href="index.html"'));
});

test('the selection summary reads in plain numbers', () => {
  const summary = selectionSummary(SELECTION);
  assert.match(summary, /holds 2,039,120 sentences/);
  assert.match(summary, /5 were drawn at random for this game/);
});

test('the selection summary states the coverage rule it applied', () => {
  const summary = selectionSummary(SELECTION);
  assert.match(summary, /3 were drawn first/);
  assert.match(summary, /5,000 most common words at least 20 sentences/);
  assert.match(summary, /every other word at least 5/);
  assert.match(summary, /remaining 2 were drawn with no condition at all/);
});

test('the selection summary admits the sentences carry no length or content filter', () => {
  assert.match(selectionSummary(SELECTION), /no filter on length or on content/);
});

test('the notices file reproduces the dictionary notice verbatim in a code block', () => {
  const notices = renderNotices({ esdbHeader: HEADER, picked: 100000, authors: 2434 });
  assert.ok(notices.includes('```text\n' + HEADER + '\n```'));
});

test('the notices file names the sentence licence, count and authors', () => {
  const notices = renderNotices({ esdbHeader: HEADER, picked: 100000, authors: 2434 });
  assert.ok(notices.includes(LICENSE_URL));
  assert.match(notices, /100,000 sentences/);
  assert.match(notices, /2,434 authors/);
  assert.match(notices, /credits\.html/);
});

test('the notices file says the results screen credits what was typed', () => {
  const notices = renderNotices({ esdbHeader: HEADER, picked: 1, authors: 1 });
  assert.match(notices, /results screen credits the sentences you typed/);
});

test('the notices file credits the keyboard layout source', () => {
  const notices = renderNotices({ esdbHeader: HEADER, picked: 1, authors: 1 });
  assert.ok(notices.includes(COLEMAK_URL));
});
