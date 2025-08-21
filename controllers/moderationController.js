const moderationService = require("../services/moderationService");
const whisperService = require("../services/whisperService");

const moderateVideo = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    const { check_audio = "false" } = req.body;
    let subtitles = [];

    // Optionally check audio content
    if (check_audio === "true") {
      console.log("[MODERATION] Generating subtitles for audio check...");
      subtitles = await whisperService.generateSubtitles(req.file.path, {
        language: "auto",
        translateToEnglish: false,
      });
    }

    // Moderate video content
    const moderationResult = await moderationService.moderateVideo(
      req.file.path,
      subtitles
    );

    if (moderationResult.flagged) {
      return res.status(400).json({
        error: "Content violation detected",
        flagged: true,
        details: moderationResult,
      });
    }

    res.json({
      message: "Content approved",
      flagged: false,
      moderation: moderationResult,
    });
  } catch (error) {
    console.error("[MODERATION] Controller error:", error);
    res.status(500).json({
      error: "Moderation failed",
      details: error.message,
    });
  }
};

const moderateVideoOnly = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No video file provided" });
    }

    // Visual moderation only
    const moderationResult = await moderationService.moderateVisualContent(
      req.file.path
    );

    res.json({
      flagged: moderationResult.flagged,
      moderation: moderationResult,
    });
  } catch (error) {
    console.error("[MODERATION] Visual moderation error:", error);
    res.status(500).json({
      error: "Visual moderation failed",
      details: error.message,
    });
  }
};

module.exports = {
  moderateVideo,
  moderateVideoOnly,
};
