# sudden death

A typing drill for accuracy. Miss a word and you stay on it until you can type it five times clean in a row.

## Running it

The page uses ES modules and `fetch`, so it needs a real server. Opening `index.html` as a `file://` URL will not work.

```
npm run serve
```

The dev server sends `cache-control: no-store`. That is deliberate. A static server without it let a browser hold on to an old `js/main.js`, which cost real time twice: once with a test suite validating code that was no longer on disk, and once with a fix that looked like it had not worked.

Then open http://127.0.0.1:8777.

No build step, no dependencies. The `package.json` exists for the test scripts.

## The rules

A run is 10, 25, or 50 words. It ends on the last letter of the last word. There is no trailing space to press.

The `text` control picks where those words come from. **Words** draws from a frequency ordered list of the 1000 most common English words. **Sentences** lays out real sentences with their capitals and punctuation intact. A sentence run takes whole sentences, so it overshoots the requested count rather than cutting a sentence in half. The word counter shows the planned total until the last sentence has been chosen, then the real one.

Word mode has three switches. **Contractions** is on by default and leaves contractions in the list, so `don't` and `I'm` are drawn like any other word. Off removes them. `I` stays either way, because it is a word and not a contraction. **Punctuation** is off by default and adds one trailing mark from `, . ? ! ; :` to about one word in five. **Capitals** is off by default and capitalises the first letter of about one word in five. With both on, one word can carry both. The marks and capitals are added after the words are chosen, so a hot or slow word still gets its reserved place, and `Time,` tracks as `time`.

Sentence mode has two settings. **Length** keeps sentences to short (3 to 6 words), medium (5 to 12, the default), long (10 to 30) or any. **Vocabulary** limits how many rare words a sentence may hold: any, mostly common (up to 15% of its words beyond the 3000 most frequent) or common only (none). Which of the remaining sentences you get is decided by a score that favours the words you miss and the words you are slow on, described under How a sentence run is chosen.

In sentence mode a word is whatever sits between two spaces, punctuation included. `time,` is one word and you have to get the comma right; miss it and you drill `time,` with the comma. A capital is just a character, so typing `t` where `T` belongs is a wrong key like any other and drops you into sudden death.

Typing goes into a focused, invisible `<input>` rather than being caught loose on the document. That is what keeps Firefox out of the way: its quick find checks whether the key landed on an editable element, and declines to open when it did. Calling `preventDefault` is not enough on its own, because quick find is handled in the browser chrome rather than in the page. The input also gives mobile keyboards something to attach to.

Focus is returned to that input whenever it is lost, and deliberately released while the settings screen is open so the controls and the browser's own find still work.

Every printable key is consumed by the page. That is not just tidiness: Firefox opens Quick Find on `'` and `/` whenever the page has not called `preventDefault`, so typing `don't` in sentence mode used to pop a search box. Keys with a modifier are left alone, so `ctrl+f` still belongs to the browser.

A wrong key never lands. The cursor refuses to advance, the word shakes red, and every key is ignored while the penalty runs. The `penalty` slider sets that length from 0 to 1000ms, default 250. Backspace does nothing, in normal typing and in sudden death alike. There is no way to repair a word, so there is no repair habit to pick up.

The moment you hit a wrong key, that word drops into sudden death. The cursor goes back to the start of the word and you owe a run of clean reps. A rep works exactly like a normal word: type it, the cursor parks at the end, and space banks it and snaps the cursor back to the start. One wrong key during a rep puts the streak back to zero.

The `reps` control sets how many you owe. Three is a light tap on the brakes, ten will keep you on one word for a while. Five is the default. Changing it starts a new run, and the setting is recorded with each run so you can tell later which runs were drilled hard.

Sudden death happens in the line, at the word's own place in the stream. The rest of the stream dims and a bar underneath shows one pip per rep you owe, plus the slip count. On the last rep the rest of the stream fades back to full brightness. The bar, the pips, and the word's own colour all stay put, so you still know where you are, but you can read ahead and line up the next word instead of being released into text you have not looked at. Once the word is fully typed that bar reads `space to bank rep 3 of 5`, so there is no guessing about what the parked cursor wants.

A drilled word carries a dot in the gap where its space goes, in the same colour as the word itself: the untyped colour while letters remain, the typed colour once the word is complete. The space you owe is visible rather than remembered. The dot is drawn as an absolutely positioned pseudo-element inside the word's trailing gap, so it costs no layout width and the stream does not rewrap when a drill opens or closes. Nothing moves and no panel opens over the top, so when you escape the drill you are already looking at where you left off.

When you miss, the letter you got wrong is marked where you missed it. A translucent panel appears over that position holding the key you actually pressed, outlined in red, with the letter it should have been still legible behind it. Over the 250ms penalty the panel slides to the front of the word and narrows until it is exactly the width of the cursor, landing on the caret you are about to type from. The error and the place you have to restart from are the same object moving, so there is nothing to work out.

The cursor is hidden for exactly as long as the keyboard is locked, so the thing telling you that you cannot type is the absence of the thing you type at. The slip panel is the only mark on screen during that window, and it arrives at the front of the word and turns into the cursor at the same moment input comes back. Set the penalty to zero and the cursor never leaves.

The engine records `slip` on every penalty as `{ index, key, word }`. Render turns that into the panel and animates it with the Web Animations API, keyed to the same `PENALTY_MS` the engine locks input for, so the block reaches the cursor exactly as the keyboard comes back.

The word itself shows how close you are. At zero reps it is the same red as the error that put you there. Each banked rep moves it further along a red, orange, yellow, green ramp, fills the progress bar above the word by another fifth, and raises a green glow behind the letters. At four of five the word is green, so you can read how close you are without counting pips. A slip drains it back to red over 260ms.

That ramp is one registered custom property. `--charge` is set on the word stream from `streak / target`, and CSS derives the colour, the bar width, and the glow radius from it. It sits on the stream rather than the word because the word is rebuilt on every keystroke, and a fresh element has nothing to animate from.

Pressing space before a word is complete counts as a wrong key, and so does typing past its last letter. Both hold inside sudden death too. Nothing about how a word is typed changes when you are drilling it, which is the point: the reps have to feel like the thing you are training for.

Sudden death time is measured separately from typing time. The wpm and accuracy on the readout cover normal typing only, so a word you are stuck on does not drag down the number you are tracking. Drill time and slip counts are reported on their own.

## Coaching

A wrong key is not one thing. The engine classifies every slip from the data it already had, `{ word, index, key }`, with no extra bookkeeping:

| Class | How it is recognised | What it means |
| --- | --- | --- |
| `race` | the key belongs one or two letters further on | a later finger fired first. The classic transposition |
| `shift` | the right letter in the wrong case | shift held too long, or never pressed |
| `bounce` | the key is the letter just before it | the finger restruck instead of lifting |
| `neighbour` | the key sits next to the target on your layout | plain targeting, the finger landed short |
| `other` | none of the above | |

Transposition and anticipation are the same event here. The keyboard locks on the wrong key, so we see the second letter arrive early but never the first letter that would complete the swap. The coaching is identical either way, so the distinction does not earn its keep.

The class is named in the drill bar in words, and carries its own colour on the mark under the letter. Both matter: the colour is faster to read, and the words are what make the colour learnable.

### Keyboard layout

`neighbour` only means anything if the app knows which keys are physically next to each other, so adjacency is derived from a layout rather than hardcoded. A layout is three rows of keys plus a horizontal offset per row, and two keys are neighbours when they are within one row and one key width of each other.

Two are built in. **QWERTY** carries the usual row stagger of 0, 0.25 and 0.75 key widths, and joins the hands, so `g` and `h` are neighbours. **Colemak-DH** is the matrix layout, taken from the [official xmodmap](https://github.com/ColemakMods/mod-dh/blob/master/xmodmap/colemak_dh_matrix.xmodmap) rather than transcribed from a picture, with no stagger and no adjacency across the gap, since on a split board like a Corne the two halves are separate objects.

The difference is not cosmetic. On QWERTY `d` reaches `e`; on Colemak-DH it reaches `t` instead and never touches `e`. Classifying a Colemak typist's slips against a QWERTY grid labels the wrong things as targeting errors.

The default is Colemak-DH. A test asserts adjacency is symmetric in both layouts, that no key neighbours itself, and that the split board never reaches across the hands.

### Caution tape

A `race` lays striped tape across three letters, one either side of the one that lost. The pair is the unit at fault, not the single key, so marking a point would misdescribe it.

A zone is one absolutely positioned element spanning the whole run, not a background on each character, so the diagonal stripes are a single continuous field by construction. It is placed in `ch` units, which needs no measurement because every advance in a monospace font is identical.

The first attempt did paint the stripes per character and offset each one by its own position. That renders identically to no offset at all: a CSS gradient with no `background-size` sizes its image to the element's own box and tiles it with period equal to the element width, so shifting by exactly one character width lands on an identical tile. The test asserted the computed `background-position-x` values rather than the rendering, so it passed against a change that did nothing.

What replaced it reads pixels. It hides the glyph ink, screenshots a one pixel line across the tape, decodes it on a canvas in the page, and finds the stripe edges. The stripe period has to be a property of the pattern and not of the character grid: about 11.3px, which is the 8px diagonal period divided by cos 45. When the stripes restart per character the measured period becomes 16.9px instead, the character advance, so the check fails. That was confirmed by simulating the old behaviour and watching it fail.

The tape only marks. It does not enforce a speed limit. Rejecting a correct keystroke for arriving too fast would break the one rule the whole game rests on, that only a wrong key fails to land.

### On the colour budget

Colour was spent early and badly. Red carried four meanings at once: a key was wrong, this word is in sudden death, zero reps are banked, and this is the key you mistyped. The largest consumer was a red to green charge ramp encoding drill progress, which the pips and the drill bar already stated twice over. The most informative variable on screen, which kind of mistake you just made, had no encoding at all.

So the hue axis was reclaimed. Charge is now one green that grows in brightness and glow, and the freed hues name the class of mistake. Amber for a race, blue for a shift, violet for a bounce, red for everything else.

A per letter rhythm trace above the word was tried and removed. It measured something real, how far ahead of your own median each keystroke ran, but a row of bars twitching above the text you are reading is a cost paid on every keystroke for information you need on the rare one. The interval recording went with it rather than being left behind unused.

## The mistake map

While a word is in sudden death, the key you got wrong appears in small red type under the letter you got it wrong at. Miss the same letter twice and the mark gets stronger. Bank clean reps and it fades. If you keep hitting `q` where an `s` belongs, you can see that before you do it again and aim the finger deliberately.

Each letter keeps a count per wrong key and a heat value. A miss adds 0.55 to that letter's heat, capped at 1. Every banked rep takes 0.18 off every letter. The mark shows the highest counted key at that position, at an opacity equal to the heat.

This lives on the drill, not on your profile. It is built when a word drops into sudden death and thrown away when the word is cleared, so it only ever describes the word in front of you.

The marks are drawn as `::after` pseudo-elements on each character, in the leading between text rows, so they take no layout width or height. The charge bar sits above the word rather than under it, because under it the two collide. A check reads the computed bands for the bar, the glyphs and the marks and asserts the three never overlap. A check asserts the word positions are byte for byte identical before and after a mark appears, because anything that changes the stream's wrapping mid-drill would move text under your hands.

## Where the text comes from

Both corpora are rebuilt by `npm run build:data`, which downloads the sources into `.cache/` and writes `data/`, `credits.html` and `THIRD_PARTY_NOTICES.md`. The first run downloads the Tatoeba export with authors, 33 MB compressed and about 190 MB unpacked, and the script raises Node's memory limit because it holds the whole corpus at once. The script is the only record of how the data was derived, so changing a rule means rerunning it rather than hand editing a JSON file.

**Ranking.** Every word in the Tatoeba corpus is counted under the same key the game tracks it by, `wordKey` in `js/storage.js`: lowercase, punctuation stripped from both ends, anything inside kept. So `don't` has its own frequency and its own rank, and `well-known` is one word, because that is how you type it. A word is ranked only if it is acceptable: a word in the dictionary, the pronoun `I`, a contraction on the list in `tools/corpus.mjs`, or a possessive of a dictionary word. Everything else goes unranked, which covers names, typos, foreign words, hyphenated compounds and any apostrophe form that is not on the list. Names go unranked because the dictionary holds lowercase words only, and `tom` and `mary` are not among them. A sentence that contains an unranked word is not removed. The word counts as rare.

**Words.** The first 1000 ranked tokens, in order. `I` and its contractions are stored with their capital, since nobody means to type `i'm`. The dictionary is the [English Speller Database](https://wordlist.aspell.net) (ESDB, formerly SCOWL) at size 35, US spelling, no variants. Its licence grants use, modification and redistribution of lists built from it, free of charge, provided the copyright notice travels with them. That notice is reproduced exactly in `data/english-common.json`, `THIRD_PARTY_NOTICES.md` and `credits.html`. ESDB supplies the dictionary but not a frequency ranking, because its bands are alphabetical inside, so the ordering comes from the corpus. Conversational frequency is also closer to what you type than book or web frequency would be.

**Sentences.** [Tatoeba](https://tatoeba.org), CC BY 2.0 FR. A sentence is eligible if it has a recorded author, which is what makes it creditable, uses only letters and `, . ' ! ? ; : -`, starts with a capital letter and ends in `.`, `!` or `?`. That is 1.94 million of the 2.04 million English sentences. There is no filter on length and none on content, so the pool holds one word sentences and 200 word ones, and it holds whatever Tatoeba's contributors wrote. Length is a setting, not a rule of the data. The typeable characters and the capital and full stop are the only shape rules, because they decide whether a sentence can be typed on a plain keyboard and reads as a sentence.

Sentences with no author are left out because only 24 of the 44,450 are confirmed CC0, and Tatoeba's terms do not say what licence the rest are under.

The shipped pool is 100,000 of the eligible sentences, 8.1 MB and about 3 MB gzipped. Shipping all 1.94 million would be about 127 MB, over GitHub's 100 MB file limit and far too much to download. The pool is drawn in two steps with a fixed seed, so a rebuild reproduces the same file. First, coverage: every one of the 5,000 most common words is given at least 20 sentences and every other ranked word at least 5, or every sentence that contains it when fewer exist, preferring sentences of 20 words or fewer and serving the rarest words first. That takes about 87,000 sentences. Second, the rest is filled with sentences drawn at random with no condition. A guarantee of 20 for every ranked word does not fit: 11,066 of the 33,690 ranked words appear in fewer than 5 sentences anywhere in the corpus.

Each sentence stores its **rarity**, the share of its words that are unranked or rank beyond 3000. A word is counted once per occurrence, so a ten word sentence with one rare word has rarity 0.1. The rows are ordered by rarity, and each row is `[text, rarity, Tatoeba id, author]`.

## How a sentence run is chosen

Every sentence in the pool gets a score, and each next sentence is a weighted random draw that favours the highest scores.

The score has three parts. **Need** is the same figure word mode uses: a word's need is 8 times its heat plus 3 times how much slower than your median it is. A sentence adds up the need of its distinct words and divides by the square root of its length, so one word you keep missing counts for more in a short sentence than in a long one. **Rarity** subtracts 2 times the sentence's rarity, a gentle push toward everyday vocabulary. **Recency** subtracts 3 if the sentence was among the last 600 you used.

The draw adds noise from a Gumbel distribution to each score and takes the highest. That is exactly sampling in proportion to the exponential of the score without replacement, done in one pass with no sort. A sentence's chance falls away smoothly down the ranking instead of being cut off. With nothing to practise every sentence scores about the same apart from rarity, so the picks vary widely. A word you keep missing pulls its sentences up within a draw or two.

The length and vocabulary settings remove sentences before any scoring, and no sentence is drawn twice in one run.

The scores are kept up to date incrementally. When a word is finished, only the sentences that contain it are touched, so recording a result costs almost nothing. Choosing one sentence scans all 100,000 scores and takes about 2 ms, measured in Node. The run is fed to the engine as you type and kept 36 words ahead of the cursor, which is enough to fill the three lines on screen. Sentences already on screen never change, so what you have just missed or been slow on can only shape sentences beyond those 36 words. In a 10 or 25 word run the whole run is on screen from the start and nothing is left to adapt. In a 50 word run one or two sentences are.

The sentences you used are saved when a run finishes, 600 at most, and count against those sentences in later runs.

The sentence file is downloaded the first time you choose sentence mode and not before.

## Credits

Credits ship in five places, and the build writes the first two from the data it has just produced, so they cannot drift from the sentences that are actually in the game.

- `credits.html` is the page the game links to, from the play screen and from settings. It lists every author with the number of sentences they wrote, each linked to their Tatoeba profile, states the licence with a link, says how the sentences were chosen, credits the keyboard layout source, and reproduces the dictionary notice exactly. It lists authors and not sentences because 100,000 sentences would make the page about 15 MB. The credit for an individual sentence lives in the data file and on the results screen.
- `THIRD_PARTY_NOTICES.md` carries the same information for someone reading the repository.
- `data/english-sentences.json` gives every row the id of the original sentence and the name of its author, so the credit travels with the data if the file is copied elsewhere. `data/english-common.json` carries the dictionary notice verbatim.
- The settings screen has a short credit that names both sources and the licence and links to the full page.
- The results screen after a sentence run lists the sentences you just typed, each with its author and a link to the original. Nothing is added while you type, so zen mode and the stable stream are unchanged. Word mode shows no sentences, so it shows no list. The links open in a new tab so a click does not abandon the session.

Tatoeba requires the author of each sentence to be named, so the build reads the export that includes authors. A sentence with no recorded author is never shipped. 44,450 English sentences have none, and they still count towards word frequencies, because a frequency is not a copy of a sentence. The sentences are used unmodified, which matters because CC BY 2.0 only asks for changes to be indicated on derivative works. Tatoeba also asks to be told how sentences were selected, and `credits.html` says.

The tests check that the credits match the data. Every author in the data must be on the credits page with the right sentence count, every author on the page must have a sentence in the data, the page must not grow back into a list of sentences, and the dictionary notice must be identical in the word list, the notices file and the page.

## Rejected sources

Two sources were considered and rejected. Monkeytype's lists are GPL-3.0, which would pull this project under copyleft. `google-10000-english` carries a tangle of LDC terms, Norvig's MIT grant and a fair use claim, and its own author advises against commercial use without licensing from the LDC.

## Zen mode and settings

Zen is on by default and the screen is built around it. While you are typing, everything that is not the words fades out: the title, the readout, the hint, the problem word list, the lifetime line. Your wpm cannot tick upward in the corner of your eye because it is not on screen. It all fades back when the run ends, alongside the results.

Numbers that move while you are trying to be accurate are a pull toward speed, which is the opposite of what this is for. Before a run and after one they are useful; during one they are a distraction with no action attached.

Everything fades with `opacity`, never `display`, so nothing moves. The words sit in exactly the same place whether the chrome is there or not, and a check asserts every word's position is unchanged across the transition.

Moving the mouse brings the chrome back mid run, since otherwise the settings button would be unreachable until the run ended. The next keystroke hushes it again.

The controls themselves live on a settings screen rather than a toolbar above the words. `Escape` closes it, and the keyboard is handed back to the game only once it is shut, so stray typing cannot leak into a run you are not looking at.

## Slow words

Finishing a word cleanly records how long it took, from its first letter to the space that commits it. A word that went to sudden death records nothing, because the number would measure the drill rather than the word.

That time is divided by the word's length and kept as a pace in milliseconds per character, so a long word and a short one can be compared. Each new sample moves the stored pace 30% of the way toward it, which means the number follows what you can do now rather than averaging in how you typed last week. A sample slower than 1.2 seconds per character is discarded as a pause rather than typing.

A word counts as slow when its pace is above the median of your own paces, and nothing counts until at least 12 words have been timed. Below that a median is noise.

Slow words get a place in a run two ways. They are reserved a slot, but only after every word you actually got wrong has taken one, so errors always come first. They also get a weight boost in the random draw for the remaining slots, smaller than the boost a missed word gets. The ordering is deliberate: accuracy is still the point, and speed is what you work on once the errors are gone. In sentence mode the same figures feed the sentence score, with a missed word weighing 8 against 3 for a slow one.

## Problem words

In sentence mode a word is whatever sits between two spaces, so `end.`, `End` and `end` are three things to type but one word to track. `wordKey` in `js/storage.js` is the only definition of that: it lowercases and strips punctuation from both ends, keeping anything inside, so `don't` and `well-known` survive intact. Storage writes through it and the word draw looks up through it, so the two cannot drift apart.

Without it, missing a word at the end of a sentence left an `end.` entry that nothing in word mode could ever match, and the problem list filled with near duplicates.

A word you miss is written to your profile with a heat value. Heat rises 0.5 per miss and falls 0.08 every time you type that word clean, and it is clamped to the range 0 to 1.

Heat feeds the next word run two ways. The hottest words are placed directly into up to 30% of the run's slots, and heat also multiplies a word's weight in the random draw for the remaining slots. A word you keep missing keeps showing up. A word you fix drops off the list after about seven clean passes. Sentence runs use heat through the sentence score instead.

## Where progress lives

One JSON object in `localStorage` under the key `typing-game/profile/v1`:

- `runs` holds the last 200 runs: wpm, accuracy, which words were drilled, and how long the drills took.
- `words` holds per-word `seen`, `misses`, `drills`, and `heat`.

`export json` downloads that object as a file. `import json` reads one back and replaces what is stored, rejecting anything whose `version` does not match. `reset progress` erases it.

Text source, keyboard layout, run length, rep count, penalty length, theme, zen, and sound are stored separately under `typing-game/prefs/v1`.

## Sound

Off by default. Three sounds: a low two note thud on an error, a short blip when a rep banks, and a two note chime when a drill clears. They are fixed sine tones at musical pitches. No frequency sweeps, no filters, no compressor.

Everything here was learned by measuring rather than guessing, because the first two attempts sounded bad:

- Each tone used to leave its `GainNode` connected to the destination forever. After a few dozen errors there were hundreds of live nodes summing into the output. Nodes now disconnect themselves on `ended`.
- The error sound was a triangle wave swept 170Hz down to 64Hz at a peak of 0.5. The sweep made it a retro arcade noise, 64Hz is below what a laptop speaker can reproduce so it came out as rattle, and the level slammed a limiter hard enough to pump. It now peaks at -22 dBFS with no limiter in the chain, because at that level nothing can clip.
- Envelopes ramp to true zero rather than stopping at a small value, and tones are scheduled 10ms ahead rather than at `currentTime` exactly, so the audio thread never starts a ramp that is already in the past. Both of those produce clicks.

The test browser launches with `--mute-audio`, and the sound checks render through an `OfflineAudioContext` rather than the speakers, so running the suite is silent.

`tests/browser.mjs` renders each sound through an `OfflineAudioContext` and measures the samples: peak level, whether anything clips, whether the buffer starts and ends at silence, and the largest jump between consecutive samples. That last number is the click detector. A clean sine at these levels moves at most 0.004 per sample, so anything above 0.01 is a discontinuity you would hear.

Each sound is imported under its own query string. Without that, `import()` hands back the one cached module whose audio context is already bound to the first offline render, the second render comes back as an empty buffer, and the click check passes against silence. A peak level assertion guards that, since silence cannot peak.

## Theme and layout

`theme` is auto, light, or dark. Auto follows the system setting and tracks it live, so flipping macOS to light changes the page without a reload. A small classic script, `js/theme-boot.js`, loads from the head of both `index.html` and `credits.html` and reads the stored choice before the page paints, which is what stops a light mode user seeing a dark flash on every load. It is the only script in the project that is not a module.

The cursor is positioned from the first word's box rather than from its own `getBoundingClientRect`, because the stream scrolls with a 120ms CSS transition. Measuring the character directly during that transition placed the cursor at whatever position the animation happened to be passing through, and it stayed there, a line off, until the next keystroke moved it. Both boxes carry the same transform, so the difference between them is transform free, and the target scroll offset is added back explicitly.

The stream carries 3px of left padding so the cursor at the first character of a line has somewhere to sit. Without it the cursor was drawn at -1px and the `overflow: hidden` clipped it to half width.

The cursor is a single absolutely positioned element placed from JavaScript, not a pseudo-element hanging off the character it sits beside. Monospace advance widths are rarely a whole number of pixels: at 28px the font here advances 16.859375px per character, so a 2px bar anchored to a character landed on a different subpixel offset at every position, and the browser spread it across two or three device pixels with partial coverage. It read as the cursor changing thickness while you typed. Rounding one element's absolute left edge to the device pixel grid gives the same two solid pixels at every position.

Type size is a `clamp()` on viewport width rather than a breakpoint, so the stream scales smoothly instead of jumping at one size. The stream window is three lines at every width, since its height is derived from the same variable. Resizing re-runs the wrap and the scroll offset through a `ResizeObserver` on the stream, debounced to one animation frame.

## Files

| path | contents |
| --- | --- |
| `js/engine.js` | the rules, as pure functions. `pressKey(state, key, at)` returns a new state and touches no DOM, no timer, and no storage. |
| `js/wordbank.js` | loads the word and sentence lists and draws a word run |
| `js/selector.js` | scores the sentence pool and draws the next sentence, keeping scores current as words are finished |
| `js/need.js` | how much a word needs practice, from its heat and its pace, shared by word mode and sentence mode |
| `js/storage.js` | the localStorage profile and the heat model |
| `js/render.js` | paints state into the DOM |
| `js/main.js` | the only module that connects keyboard events to the engine and the engine to the screen |
| `js/layouts.js` | keyboard geometry and the adjacency it implies |
| `js/audio.js` | three WebAudio tones, off by default |
| `js/theme-boot.js` | applies the stored theme before first paint, shared by both pages |
| `js/attribution.js` | the Tatoeba links for a sentence and for its author, used by the game and by the credits page |
| `credits.html` | generated. every author with their sentence count, the licences, and how the sentences were chosen |
| `THIRD_PARTY_NOTICES.md` | generated. the notices the licences of the data require |
| `data/english-common.json` | the 1000 most common English words and contractions, ordered by frequency |
| `data/english-sentences.json` | 100,000 sentences, each with its rarity, the id of the original and its author |
| `tools/build-data.mjs` | rebuilds both from their sources |
| `tools/corpus.mjs` | the rules that decide which words and sentences are acceptable, how rarity is scored and how the pool is drawn |
| `tools/credits.mjs` | renders `credits.html` and `THIRD_PARTY_NOTICES.md` from the chosen sentences |
| `tools/serve.mjs` | a dev server that sends `cache-control: no-store` |

The engine takes the current time as an argument rather than calling `performance.now()` itself. That is what lets the tests run the whole game, penalty windows included, against a fake clock.

## Tests

```
npm test
```

268 unit tests across the engine, keyboard layouts, the heat and pace model, the word draw and its options, the sentence selector, the corpus rules that build the data, the credits, and the shape of the data that ships.

`npm run test:firefox` drives real Firefox over WebDriver BiDi, with no driver binary needed: Firefox prints its BiDi socket on stderr at startup and the test connects straight to it. It covers what is checkable, that focus lands in the typing input and stays there and that keys reach the engine.

It cannot check quick find itself. Firefox's find handlers live in the parent process, and keys synthesised by WebDriver never reach them. That was confirmed rather than assumed: with `accessibility.typeaheadfind` forced on, a bare page that consumes nothing still received every keystroke. So no automated test here can tell you whether quick find opens, and any claim that it is fixed rests on the mechanism plus checking it by hand.

The browser check drives real Chrome over the DevTools protocol and needs the server running in another shell. It disables the HTTP cache on the connection, which is not optional: without it Chrome's heuristic freshness served a stale `js/main.js` from the reused profile and the suite silently validated code that was no longer on disk. The symptom was a check failing against a fix that was definitely present in the served file.

```
npm run test:browser
```

137 checks. It types a clean word, forces a typo, confirms sudden death opens on that word, fails a rep on purpose, clears the drill, finishes the run, and confirms the missed word is seeded into the next run. A 50 word run verifies the stream scrolls and the cursor is never off screen. It then resizes the viewport to 520px and back, checking the cursor stays visible, the stream rewraps, and the three line window holds. It walks the cursor through a word and asserts its width never changes and both edges land on whole device pixels, which is the check that would have caught the subpixel bug above. It drills with the rep count set to three and flips the theme, measuring the painted colours rather than trusting the class names. It draws several runs under each text option and asserts on what reached the screen: no apostrophes with contractions off, marks and capitals present when on, no rare word in any sentence under common only, and every sentence inside the chosen length. It follows the credits link from the play screen, checks the page lists every author with counts adding up to the shipped sentences, and checks it picks up a light theme. It finishes a sentence run and asserts the results screen credits exactly the sentences typed, in order, each with the author and original link from the shipped data. Finally it checks that the sentence file is not downloaded until sentence mode is chosen, that a 50 word run is topped up with more sentences as you type and still ends on a whole sentence, and that the sentences used are remembered.

Two of those checks exist because of bugs that were easy to ship and hard to see:

- It records every word's `offsetLeft` and `offsetTop` at the start of a run and asserts they never change while you type. An earlier caret drew the end-of-word position as a real 1ch span, which widened the active word, changed where the stream wrapped, and shifted whole rows under your hands.
- It asserts computed visibility rather than the `hidden` property, because a CSS `display` rule overrides `[hidden]`. The sudden death panel stayed on screen after a run ended while `element.hidden` reported `true`.

## Not built yet

- Digits and symbols. The sentence filter strips them, so nothing in either corpus trains the number row or the shifted symbols.
- A harder word list. The vocabulary is capped at the 1000 most frequent words, which leaves out most of the awkward letter pairs where accuracy actually breaks.
- Cross session key analysis. The mistake map is thrown away with each drill by design. A per key view over many sessions would be a different feature with different storage.
- Pace feedback. Interval timing was built and removed with the rhythm trace. If it comes back it should report in the drill bar in words, not as a bar chart over the text you are reading.
- Same finger and mirror hand classes. Both need a finger assignment on top of the key positions `js/layouts.js` already holds.
- Longer passages. Sentences are 4 to 16 words and stand alone. Paragraph length prose would test reading ahead rather than single word recall.
