export const valid_bigrams = new Set([
  "for example", "in fact", "of course", "such as", "in particular",
  "as well", "due to", "in general", "this means", "this suggests",
  "in conclusion", "as shown", "in short", "in turn", "on average",
  "as expected", "more importantly", "in summary", "at least", "most likely",
  "less than", "more than", "according to", "as noted", "for instance",
  "so that", "such that", "even though", "as a", "on top", "as mentioned",
  "from which", "in contrast", "in addition", "in response", "as discussed",
  "by contrast", "to ensure", "with regard", "with respect", "as stated",
  "in brief", "on purpose", "in effect", "in excess", "in theory",
  "at best", "at worst", "it seems", "it appears",
  "for this", "in spite", "in line", "by using", "on behalf", "in turn",
  "in favor", "by means", "at times", "among others", "to conclude",
  "for instance", "on occasion", "it means", "for comparison", "with this",
  "in context", "with regard", "over time", "in reference", "in depth",
  "in support", "to illustrate", "to emphasize", "for emphasis", "under consideration",
  "above all", "as follows", "in summary", "more precisely", "more clearly",
  "in reality", "as previously", "in brief", "at present", "in practice",
  "in theory", "in contrast", "by contrast", "by definition", "without doubt",
  "beyond that", "more generally", "from there", "with caution", "as required",
  "in hindsight", "at large"
]);

export const valid_trigrams = new Set([
  "as a result", "on the other", "in terms of", "as well as",
  "one of the", "in order to", "the end of", "the fact that",
  "on the basis", "at the same", "at the end", "in the case",
  "the rest of", "in addition to", "the purpose of", "the use of",
  "the development of", "with respect to", "as a consequence",
  "in the process", "as part of", "due to the", "the nature of",
  "it is important", "it is necessary", "it should be", "the number of",
  "there is a", "there are a", "from the point", "in the context",
  "in the light", "on the part", "at the beginning", "it is possible",
  "it is clear", "it is evident", "according to the", "with regard to"
]);

export const valid_fourgrams = new Set([
  "as a result of", "at the end of", "in the case of", "as can be seen",
  "in the context of", "on the basis of", "at the same time",
  "in terms of the", "in the process of", "with the help of",
  "as a part of", "as shown in figure", "it is important to",
  "in relation to the", "this is due to", "the role of the",
  "as illustrated in figure", "in this study we", "the results of the",
  "it is necessary to", "there is a need", "at the beginning of",
  "one of the most", "from the point of", "with respect to the"
]);

export function countLexicalBundles(text) {
  const tokens = (text.toLowerCase().match(/\b[a-z]+\b/g) || []);
  const bigrams = [];
  const trigrams = [];
  const fourgrams = [];
  for (let i = 0; i < tokens.length; i++) {
    if (i + 1 < tokens.length) {
      const b = tokens[i] + " " + tokens[i + 1];
      if (valid_bigrams.has(b)) bigrams.push(b);
    }
    if (i + 2 < tokens.length) {
      const t = tokens[i] + " " + tokens[i + 1] + " " + tokens[i + 2];
      if (valid_trigrams.has(t)) trigrams.push(t);
    }
    if (i + 3 < tokens.length) {
      const f = tokens[i] + " " + tokens[i + 1] + " " + tokens[i + 2] + " " + tokens[i + 3];
      if (valid_fourgrams.has(f)) fourgrams.push(f);
    }
  }
  return {
    bigram_count: bigrams.length,
    trigram_count: trigrams.length,
    fourgram_count: fourgrams.length,
    bigram_matches: bigrams,
    trigram_matches: trigrams,
    fourgram_matches: fourgrams
  };
}
