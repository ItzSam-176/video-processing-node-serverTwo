// ✅ FIXED: Proper destructuring import
const { upload } = require("../config/multer");
const whisperService = require("../services/whisperService");
const { validateVideoFile } = require("../utils/validation");

const generateSubtitles = [
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),

  async (req, res) => {
    let tempFiles = [];

    try {
      console.log("[SUBTITLES] === REQUEST DEBUG INFO ===");
      console.log(
        "[SUBTITLES] Files received:",
        req.files ? Object.keys(req.files) : "No files"
      );
      console.log("[SUBTITLES] Body received:", Object.keys(req.body || {}));

      if (req.files && req.files.video) {
        console.log("[SUBTITLES] Video file info:", {
          originalname: req.files.video[0].originalname,
          size: req.files.video.size,
          path: req.files.video.path,
        });
      }

      if (!req.files || !req.files.video) {
        console.error("[SUBTITLES] No video file found in request");
        return res.status(400).json({
          success: false,
          error: "No video file provided",
          debug: {
            files_received: req.files ? Object.keys(req.files) : [],
            body_received: Object.keys(req.body || {}),
          },
        });
      }

      const videoFile = req.files.video[0];
      const audioFile = req.files.audio ? req.files.audio : null;

      tempFiles.push(videoFile.path);
      if (audioFile) tempFiles.push(audioFile.path);

      await validateVideoFile(videoFile.path);

      const params = {
        language: req.body.language || "auto",
        translateToEnglish: req.body.translate_to_english === "true",
        trimStart: 0, // Always full video for subtitles
        trimEnd: null,
      };

      console.log("[SUBTITLES] Processing with params:", params);

      // ✅ Use the existing generateSubtitles method
      const result = await whisperService.generateSubtitles(
        audioFile?.path || videoFile.path,
        params
      );
      // NEW: Generate hashtags if requested
      let hashtagResult = null;
      if (req.body.generate_hashtags === "true" && result.subtitles) {
        const videoId = `video_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        hashtagResult = await hashtagService.processVideo(
          videoId,
          result.subtitles,
          {
            topN: parseInt(req.body.hashtag_count || 10),
          }
        );
      }

      console.log("[SUCCESS] Subtitles generated:", result.segments_count);

      // Enhanced response with hashtags
      const response = {
        ...result,
        hashtags: hashtagResult?.hashtags || [],
        hashtagGeneration: hashtagResult
          ? {
              success: hashtagResult.success,
              totalKeywords: hashtagResult.totalKeywords,
              message: hashtagResult.message,
            }
          : null,
      };

      res.json(response);
    } catch (error) {
      console.error("[ERROR] Subtitle generation failed:", error);
      res.status(500).json({
        success: false,
        error: error.message,
        message: "Subtitle generation failed",
      });
    } finally {
      // Cleanup temp files
      setTimeout(() => {
        tempFiles.forEach((file) => {
          require("fs-extra")
            .remove(file)
            .catch(() => {});
        });
      }, 5000);
    }
  },
];

module.exports = { generateSubtitles };
