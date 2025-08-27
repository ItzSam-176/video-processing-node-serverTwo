const hashtagService = require("../services/hashtagService");

const generateHashtags = async (req, res) => {
  try {
    const { subtitles, video_id, top_n = 10 } = req.body;

    if (!subtitles || !Array.isArray(subtitles)) {
      return res.status(400).json({
        success: false,
        error: "Subtitles array is required",
      });
    }

    const videoId = video_id || `video_${Date.now()}`;
    const result = await hashtagService.processVideo(videoId, subtitles, {
      topN: top_n,
    });

    res.json({
      success: result.success,
      hashtags: result.hashtags,
      keywords: result.keywords,
      stats: {
        totalKeywords: result.totalKeywords,
        hashtagsGenerated: result.hashtags?.length || 0,
        corpusStats: hashtagService.getCorpusStats(),
      },
      message: result.message,
    });
  } catch (error) {
    console.error("[HASHTAG] Controller error:", error);
    res.status(500).json({
      success: false,
      error: "Hashtag generation failed",
      details: error.message,
    });
  }
};

const getCorpusStats = async (req, res) => {
  try {
    const stats = hashtagService.getCorpusStats();
    res.json({ success: true, stats });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = { generateHashtags, getCorpusStats };
