const winkNLP = require("wink-nlp");
const model = require("wink-eng-lite-web-model");
const natural = require("natural");
const TfIdf = natural.TfIdf;

class HashtagService {
  constructor() {
    // Initialize wink-nlp
    this.nlp = winkNLP(model);
    this.its = this.nlp.its;
    this.as = this.nlp.as;

    // Initialize TF-IDF corpus
    this.tfidf = new TfIdf();
    this.documentIds = new Map(); // Track which document belongs to which video
    this.initialized = false;
  }

  // Step 1: Extract entities and keywords using wink-nlp
  extractKeywords(subtitles) {
    if (!subtitles || !Array.isArray(subtitles)) return [];

    // Combine all subtitle text
    const fullText = subtitles.map((sub) => sub.text).join(" ");
    const doc = this.nlp.readDoc(fullText);

    const keywords = new Set();

    // Extract entities (locations, organizations, persons, etc.)
    const entities = doc.entities().out(this.its.detail);
    entities.forEach((entity) => {
      if (["PERSON", "ORG", "GPE", "LOCATION", "EVENT"].includes(entity.type)) {
        keywords.add(this.cleanKeyword(entity.value));
      }
    });

    // Extract nouns and adjectives
    const tokens = doc.tokens().out(this.its.detail);
    tokens.forEach((token) => {
      if (
        ["NOUN", "PROPN", "ADJ"].includes(token.pos) &&
        token.value.length > 2 &&
        !token.stopWordFlag
      ) {
        keywords.add(this.cleanKeyword(token.value));
      }
    });

    return Array.from(keywords).filter((keyword) => keyword.length > 0);
  }

  cleanKeyword(keyword) {
    return keyword
      .toLowerCase()
      .replace(/[^a-zA-Z0-9\s]/g, "") // Remove special chars
      .replace(/\s+/g, "") // Remove spaces for hashtag format
      .trim();
  }

  // Step 2: Add document to TF-IDF corpus
  addDocumentToCorpus(videoId, keywords) {
    if (!keywords || keywords.length === 0) return;

    // Join keywords as a document for TF-IDF
    const keywordDocument = keywords.join(" ");

    // Add to TF-IDF corpus
    this.tfidf.addDocument(keywordDocument);

    // Track which document index belongs to which video
    this.documentIds.set(this.tfidf.documents.length - 1, videoId);

    console.log(
      `[HASHTAG] Added ${keywords.length} keywords for video ${videoId} to corpus`
    );
  }

  // Step 3: Generate hashtags with TF-IDF scoring
  generateHashtags(videoId, keywords, topN = 10) {
    if (!keywords || keywords.length === 0) return [];

    // Find the document index for this video
    let documentIndex = -1;
    for (let [docIndex, vId] of this.documentIds.entries()) {
      if (vId === videoId) {
        documentIndex = docIndex;
        break;
      }
    }

    if (documentIndex === -1) {
      console.warn(`[HASHTAG] Video ${videoId} not found in corpus`);
      return this.fallbackHashtags(keywords, topN);
    }

    // Calculate TF-IDF scores for all keywords
    const scoredKeywords = keywords.map((keyword) => {
      const score = this.tfidf.tfidf(keyword, documentIndex);
      return { keyword, score };
    });

    // Sort by TF-IDF score (descending) and take top N
    const topKeywords = scoredKeywords
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, topN)
      .map((item) => item.keyword);

    // Convert to hashtags
    return this.hashtagify(topKeywords);
  }

  // Fallback when TF-IDF isn't available
  fallbackHashtags(keywords, topN = 10) {
    return this.hashtagify(keywords.slice(0, topN));
  }

  // Step 4: Convert keywords to hashtags
  hashtagify(keywords) {
    return keywords
      .filter((keyword) => keyword && keyword.length >= 2)
      .map((keyword) => {
        // Clean and format as hashtag
        let hashtag = keyword
          .toLowerCase()
          .replace(/[^a-zA-Z0-9]/g, "") // Remove all non-alphanumeric
          .replace(/\s+/g, ""); // Remove any remaining spaces

        // Capitalize first letter of each word for readability
        hashtag = hashtag.replace(/\b\w/g, (l) => l.toUpperCase());

        return `#${hashtag}`;
      })
      .filter((hashtag) => hashtag.length > 2); // Filter out too-short hashtags
  }

  // Process a single video's subtitles
  async processVideo(videoId, subtitles, options = {}) {
    try {
      console.log(
        `[HASHTAG] Processing video ${videoId} for hashtag generation`
      );

      // Step 1: Extract keywords
      const keywords = this.extractKeywords(subtitles);
      console.log(
        `[HASHTAG] Extracted ${keywords.length} keywords:`,
        keywords.slice(0, 5)
      );

      if (keywords.length === 0) {
        return {
          success: false,
          hashtags: [],
          message: "No keywords extracted",
        };
      }

      // Step 2: Add to corpus for future TF-IDF calculations
      this.addDocumentToCorpus(videoId, keywords);

      // Step 3: Generate hashtags
      const hashtags = this.generateHashtags(
        videoId,
        keywords,
        options.topN || 10
      );

      console.log(
        `[HASHTAG] Generated ${hashtags.length} hashtags for video ${videoId}`
      );

      return {
        success: true,
        hashtags,
        keywords: keywords.slice(0, 15), // Return top keywords for debugging
        totalKeywords: keywords.length,
        message: `Generated ${hashtags.length} hashtags`,
      };
    } catch (error) {
      console.error(`[HASHTAG] Error processing video ${videoId}:`, error);
      return { success: false, hashtags: [], error: error.message };
    }
  }

  // Get corpus statistics
  getCorpusStats() {
    return {
      totalDocuments: this.tfidf.documents.length,
      vocabularySize: Object.keys(this.tfidf.vocabulary).length,
      documentsTracked: this.documentIds.size,
    };
  }
}

module.exports = new HashtagService();
