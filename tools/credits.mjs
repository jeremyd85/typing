import { TATOEBA_HOME, profileUrl, sentenceUrl } from '../js/attribution.js';

export { TATOEBA_HOME, profileUrl, sentenceUrl };

export const LICENSE_URL = 'https://creativecommons.org/licenses/by/2.0/fr/';
export const LEGAL_CODE_URL = 'https://creativecommons.org/licenses/by/2.0/fr/legalcode';
export const ESDB_URL = 'https://wordlist.aspell.net';
export const COLEMAK_URL = 'https://colemakmods.github.io/mod-dh/';

export function escapeHtml(text) {
  return String(text)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function groupByAuthor(picked) {
  const counts = new Map();
  for (const item of picked) counts.set(item.author, (counts.get(item.author) ?? 0) + 1);

  const folded = (name) => name.toLowerCase();
  return [...counts.entries()]
    .map(([author, count]) => ({ author, count }))
    .sort((a, b) => {
      if (folded(a.author) !== folded(b.author)) return folded(a.author) < folded(b.author) ? -1 : 1;
      return a.author < b.author ? -1 : 1;
    });
}

const number = (value) => value.toLocaleString('en-US');

export function selectionSummary(selection) {
  return (
    `The English export of the Tatoeba Project holds ${number(selection.corpus)} sentences. ` +
    `${number(selection.eligible)} of them were eligible: they have a recorded author, use only letters and basic punctuation, start with a capital, and end in a full stop, exclamation mark or question mark. ` +
    'There is no filter on length or on content. ' +
    `${number(selection.pool)} were drawn at random for this game. ` +
    `${number(selection.covered)} were drawn first, to give each of the ${number(selection.topWords)} most common words at least ${selection.topMin} sentences and every other word at least ${selection.restMin}, or every sentence that exists when a word has fewer. ` +
    `The remaining ${number(selection.filled)} were drawn with no condition at all.`
  );
}

function authorItem({ author, count }) {
  return `<li><a href="${profileUrl(author)}">${escapeHtml(author)}</a> <span class="count">${count}</span></li>`;
}

export function renderCreditsPage({ picked, esdbHeader, selection }) {
  const authors = groupByAuthor(picked);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>credits and licences for sudden death</title>
<link rel="stylesheet" href="css/style.css">
<script src="js/theme-boot.js"></script>
</head>
<body>
<div class="page credits-page">

  <header class="masthead">
    <div>
      <h1>credits and licences</h1>
      <p class="tagline"><a href="index.html">back to the game</a></p>
    </div>
  </header>

  <main class="credits-body">

    <section>
      <h2>word list</h2>
      <p>The dictionary that decides which tokens count as words comes from the <a href="${ESDB_URL}">English Speller Database</a> (ESDB, formerly SCOWL). Its notice follows exactly as it appears in the word list the data was built from.</p>
      <pre class="notice-text">${escapeHtml(esdbHeader)}</pre>
    </section>

    <section>
      <h2>keyboard layouts</h2>
      <p>The key positions for the Colemak Mod-DH matrix layout follow the layout published by the <a href="${COLEMAK_URL}">ColemakMods project</a>. Only the positions of the keys are used.</p>
    </section>

    <section>
      <h2>sentences</h2>
      <p>Every sentence in sentence mode comes from the <a href="${TATOEBA_HOME}">Tatoeba Project</a>. Sentences are copyright of their authors and are licensed under <a href="${LICENSE_URL}">Creative Commons Attribution 2.0 France</a> (<a href="${LEGAL_CODE_URL}">legal code</a>). They are used unmodified. The same corpus supplies the word frequencies that order the word list.</p>
      <p>${escapeHtml(selectionSummary(selection))}</p>
      <p>Each sentence in the game's data file records the id of the original and the name of its author, and the results screen after a sentence run credits the sentences you typed, each with a link to its original on Tatoeba. ${number(authors.length)} authors wrote the ${number(picked.length)} sentences in use. They are listed below with the number each wrote, linked to their Tatoeba profile.</p>
      <ul class="author-list">
${authors.map(authorItem).join('\n')}
      </ul>
    </section>

  </main>
</div>
</body>
</html>
`;
}

export function renderNotices({ esdbHeader, picked, authors }) {
  return `# Third party notices

This project ships data derived from the sources below. Each is listed with the notice its licence requires.

## English Speller Database (ESDB)

ESDB, formerly SCOWL, is the dictionary behind \`data/english-common.json\`. It decides which tokens count as words. Its notice, exactly as it appears in the word list the data was built from:

\`\`\`text
${esdbHeader}
\`\`\`

## Tatoeba sentences

\`data/english-sentences.json\` holds ${number(picked)} sentences from the [Tatoeba Project](${TATOEBA_HOME}), written by ${number(authors)} authors and licensed under [CC BY 2.0 FR](${LICENSE_URL}). Sentences are copyright of their authors and are used unmodified.

Every row in the data file carries the id of the original sentence and the name of its author. \`credits.html\` lists the authors with the number of sentences each wrote and links to their Tatoeba profiles, and the game links to that page. After a sentence run the results screen credits the sentences you typed, each with a link to its original. The same corpus supplies the word frequencies behind the ordering of \`data/english-common.json\`.

## Colemak Mod-DH

The matrix layout in \`js/layouts.js\` follows the layout published by the [ColemakMods project](${COLEMAK_URL}). Only the positions of the keys are used.
`;
}
