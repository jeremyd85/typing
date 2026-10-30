# Third party notices

This project ships data derived from the sources below. Each is listed with the notice its licence requires.

## English Speller Database (ESDB)

ESDB, formerly SCOWL, is the dictionary behind `data/english-common.json`. It decides which tokens count as words. Its notice, exactly as it appears in the word list the data was built from:

```text
Custom wordlist generated from https://app.aspell.net/create using
the English Speller Database (ESDB) with parameters:
  Size: 35 (small)
  Spelling: US
  Variant Level: 1 *default*
  Special: <none>
  Diacritics: strip

https://wordlist.aspell.net

ESDB Git Revision: Wed Jun 24 14:30:42 2026 -0400 [1e5b7d3]
App Git Revision: Thu Jun 25 15:43:51 2026 -0400 [156fb4e]

Copyright 2000-2026 by Kevin Atkinson

Permission to use, copy, modify, distribute, and sell any part of the English
Speller Database (ESDB, previously known as SCOWLv2), or word lists
created from it, is hereby granted without fee, provided that the above
copyright notice appears in all copies and that both the above copyright
notice and this notice appear in supporting documentation.  Kevin Atkinson
makes no representations about the suitability of this database for any
purpose.  It is provided "as is" without express or implied warranty.

ESDB is derived from many sources, most of which are in the Public Domain.
Data from the Corpus of Contemporary American English (COCA) was also used.

All data from COCA comes from 3-gram data that is not freely available;
however, the usage is within the rights given by the NDA that was signed when
purchasing the data.  More information on COCA is available at
https://www.english-corpora.org/coca/.

The primary source of words for ESDB comes from 12dicts and ENABLE2K.  Both
are in the Public Domain, but Alan Beale <biljir@pobox.com> deserves special
credit as he is the author of 12dicts and a major contributor to ENABLE2K.  In
addition, he gave me an incredible amount of feedback and created a number of
special lists in order to help improve the overall quality of ESDB.
```

## Tatoeba sentences

`data/english-sentences.json` holds 100,000 sentences from the [Tatoeba Project](https://tatoeba.org), written by 2,441 authors and licensed under [CC BY 2.0 FR](https://creativecommons.org/licenses/by/2.0/fr/). Sentences are copyright of their authors and are used unmodified.

Every row in the data file carries the id of the original sentence and the name of its author. `credits.html` lists the authors with the number of sentences each wrote and links to their Tatoeba profiles, and the game links to that page. After a sentence run the results screen credits the sentences you typed, each with a link to its original. The same corpus supplies the word frequencies behind the ordering of `data/english-common.json`.

## Colemak Mod-DH

The matrix layout in `js/layouts.js` follows the layout published by the [ColemakMods project](https://colemakmods.github.io/mod-dh/). Only the positions of the keys are used.
