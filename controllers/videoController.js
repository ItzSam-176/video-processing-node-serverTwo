const { upload } = require("../config/multer");
const videoProcessingService = require("../services/videoProcessingService");
const { validateVideoFile } = require("../utils/validation");
const { v4: uuidv4 } = require("uuid");
const path = require("path");

const processVideo = [
  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "audio", maxCount: 1 },
  ]),

  async (req, res) => {
    let tempFiles = [];

    try {
      console.log("[UPLOAD] Video processing request received");

      if (!req.files || !req.files.video) {
        return res.status(400).json({
          success: false,
          error: "No video file uploaded",
        });
      }

      const videoFile = req.files.video[0];
      const audioFile = req.files.audio ? req.files.audio : null;

      tempFiles.push(videoFile.path);
      if (audioFile) tempFiles.push(audioFile.path);

      // Validate video file
      await validateVideoFile(videoFile.path);

      console.log("[UPLOAD] Video validation passed");

      // Parse parameters
      const params = {
        startTime: parseFloat(req.body.start_time || 0),
        endTime: parseFloat(req.body.end_time || 10),
        audioStartTime: parseFloat(req.body.audio_start_time || 0),
        enableSubtitles: req.body.enable_subtitles === "true",
        subtitleFontSize: parseInt(req.body.subtitle_font_size || 32),
        subtitleColor: req.body.subtitle_color || "#FFFFFF",
        subtitleBgColor: req.body.subtitle_bg_color || "black",
        subtitleLanguage: req.body.subtitle_language || "auto",
        translateToEnglish: req.body.translate_to_english === "true",
      };

      console.log("[PROCESSING] Parameters:", params);

      // Generate output filename
      const outputFilename = `processed_${uuidv4()}.mp4`;
      const outputPath = path.join(__dirname, "../processed", outputFilename);

      // Process video
      await videoProcessingService.processVideo(
        videoFile.path,
        audioFile?.path,
        outputPath,
        params
      );

      // Generate response URL
      const videoUrl = `http://${req.get(
        "host"
      )}/processed-videos/${outputFilename}`;

      console.log("[SUCCESS] Video processed successfully:", videoUrl);

      res.json({
        processed_video_uri: videoUrl,
        success: true,
        message: "Video processed successfully with Node.js",
      });
    } catch (error) {
      console.error("[ERROR] Video processing failed:", error);

      res.status(500).json({
        success: false,
        error: error.message,
        message: "Video processing failed",
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

module.exports = { processVideo };
