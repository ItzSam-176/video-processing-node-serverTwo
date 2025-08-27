const winkNLP = require("wink-nlp");
const winkModel = require("wink-eng-lite-web-model");
const natural = require("natural");

class HashtagService {
  constructor() {
    this.nlp = winkNLP(winkModel);
    this.TfIdf = natural.TfIdf;
    this.tfidf = new this.TfIdf();
    this.processedVideos = new Map(); // Store processed video corpus
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;
    console.log("[HASHTAG] Initializing hashtag service...");
    this.initialized = true;
    console.log("[HASHTAG] ✅ Hashtag service ready");
  }

  // Extract keywords using wink-nlp
  extractKeywords(text) {
    try {
      const doc = this.nlp.readDoc(text.toLowerCase());

      // Extract entities, important nouns, and significant terms
      const entities = doc.entities().out();
      const tokens = doc.tokens().filter((t) => {
        return (
          (t.out(this.nlp.its.type) === "word" &&
            t.out(this.nlp.its.pos) === "NOUN") ||
          t.out(this.nlp.its.pos) === "PROPN" ||
          (t.out(this.nlp.its.pos) === "ADJ" && t.out().length > 4) ||
          (t.out(this.nlp.its.pos) === "VERB" && t.out().length > 4)
        );
      });

      const keywords = [...entities.map((e) => e.value), ...tokens.out()];

      // Clean and filter keywords
      return [...new Set(keywords)]
        .filter(
          (word) =>
            word.length >= 3 &&
            word.length <= 15 &&
            !/^\d+$/.test(word) && // No pure numbers
            ![
              "the",
              "and",
              "for",
              "are",
              "but",
              "not",
              "you",
              "all",
              "can",
              "had",
              "her",
              "was",
              "one",
              "our",
              "out",
              "day",
              "get",
              "has",
              "him",
              "his",
              "how",
              "man",
              "new",
              "now",
              "old",
              "see",
              "two",
              "way",
              "who",
              "boy",
              "did",
              "its",
              "let",
              "put",
              "say",
              "she",
              "too",
              "use",
            ].includes(word.toLowerCase())
        )
        .slice(0, 20); // Limit to top 20 keywords
    } catch (error) {
      console.error("[HASHTAG] Keyword extraction failed:", error);
      return [];
    }
  }

  // Calculate TF-IDF scores for keywords
  calculateTFIDF(keywords, videoId) {
    try {
      // Add current document to corpus
      this.tfidf.addDocument(keywords.join(" "));

      const scores = [];
      keywords.forEach((keyword) => {
        const score = this.tfidf.tfidf(
          keyword,
          this.tfidf.documents.length - 1
        );
        if (score > 0) {
          scores.push({ keyword, score });
        }
      });

      // Sort by TF-IDF score and return top scoring keywords
      return scores
        .sort((a, b) => b.score - a.score)
        .map((item) => item.keyword);
    } catch (error) {
      console.error("[HASHTAG] TF-IDF calculation failed:", error);
      return keywords; // Fallback to original keywords
    }
  }

  // Convert keywords to hashtags
  keywordsToHashtags(keywords, count = 3) {
    return keywords
      .slice(0, count)
      .map((keyword) => {
        // Clean and format as hashtag
        const cleaned = keyword
          .replace(/[^a-zA-Z0-9]/g, "")
          .replace(/^\d+/, "") // Remove leading numbers
          .toLowerCase();

        if (cleaned.length < 2) return null;

        // Capitalize first letter
        return "#" + cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
      })
      .filter((hashtag) => hashtag && hashtag.length > 2);
  }

  // Main processing function
  async generateHashtags(textArray, options = {}) {
    try {
      await this.initialize();

      const { count = 3, videoId = `video_${Date.now()}` } = options;

      if (!textArray || textArray.length === 0) {
        return {
          success: false,
          hashtags: [],
          message: "No text provided for hashtag generation",
        };
      }

      // Combine all subtitle text
      const fullText = textArray.join(" ");

      console.log(
        `[HASHTAG] Processing text for ${videoId}: ${fullText.substring(
          0,
          100
        )}...`
      );

      // Extract keywords using wink-nlp
      const keywords = this.extractKeywords(fullText);

      if (keywords.length === 0) {
        return {
          success: false,
          hashtags: [],
          message: "No meaningful keywords extracted from text",
        };
      }

      // Calculate TF-IDF scores
      const rankedKeywords = this.calculateTFIDF(keywords, videoId);

      // Convert to hashtags
      const hashtags = this.keywordsToHashtags(rankedKeywords, count);

      // Store processed video info
      this.processedVideos.set(videoId, {
        keywords: rankedKeywords,
        hashtags,
        processedAt: new Date(),
      });

      console.log(
        `[HASHTAG] ✅ Generated ${hashtags.length} hashtags for ${videoId}`
      );

      return {
        success: true,
        hashtags,
        keywords: rankedKeywords.slice(0, count * 2), // Return more keywords than hashtags
        totalKeywords: keywords.length,
        message: `Generated ${hashtags.length} hashtags from ${keywords.length} keywords`,
      };
    } catch (error) {
      console.error("[HASHTAG] Generation failed:", error);
      return {
        success: false,
        hashtags: [],
        error: error.message,
        message: "Hashtag generation failed",
      };
    }
  }

  // Get corpus statistics
  getCorpusStats() {
    return {
      totalVideosProcessed: this.processedVideos.size,
      corpusDocuments: this.tfidf.documents.length,
      lastProcessed:
        this.processedVideos.size > 0
          ? Math.max(
              ...Array.from(this.processedVideos.values()).map((v) =>
                v.processedAt.getTime()
              )
            )
          : null,
    };
  }
}

module.exports = new HashtagService();
