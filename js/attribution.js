export const TATOEBA_HOME = 'https://tatoeba.org';

export function sentenceUrl(id) {
  return `${TATOEBA_HOME}/en/sentences/show/${id}`;
}

export function profileUrl(author) {
  return `${TATOEBA_HOME}/en/user/profile/${encodeURIComponent(author)}`;
}
